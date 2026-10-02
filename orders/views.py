from django.contrib.auth.decorators import login_required
from django.db.models import Sum
from django.http import JsonResponse
from django.views.decorators.http import require_POST
from django.views.decorators.csrf import csrf_exempt
from decimal import Decimal
from django.db import transaction
from django.shortcuts import render
from .models import Cart, CartItem, Order, OrderItem
from medicines.models import Medicine
import json

@login_required
def cart_view(request):
    cart_items = list(
        CartItem.objects.filter(cart__user=request.user)
        .select_related("medicine")
        .order_by("medicine__name")
    )
    for item in cart_items:
        item.line_total = item.medicine.price * item.quantity

    cart_count = sum(item.quantity for item in cart_items)
    cart_total = sum((item.line_total for item in cart_items), Decimal("0.00"))
    return render(request, "orders/cart.html", {
        "cart_items": cart_items,
        "cart_count": cart_count,
        "cart_total": cart_total,
    })

@login_required
@require_POST
def add_to_cart(request):
    try:
        data = json.loads(request.body)
        medicine_id = int(data["medicine_id"])
    except (KeyError, TypeError, ValueError, json.JSONDecodeError):
        return JsonResponse({"success": False, "error": "Invalid medicine."}, status=400)

    try:
        medicine = Medicine.objects.get(id=medicine_id, is_active=True)
    except Medicine.DoesNotExist:
        return JsonResponse({"success": False, "error": "Medicine is unavailable."}, status=404)

    cart, _ = Cart.objects.get_or_create(user=request.user)
    item, created = CartItem.objects.get_or_create(cart=cart, medicine=medicine)
    if not created:
        item.quantity += 1
        item.save(update_fields=["quantity"])

    cart_count = cart.items.aggregate(total=Sum("quantity"))["total"] or 0
    return JsonResponse({
        "success": True,
        "cart_count": cart_count,
        "medicine": {
            "id": medicine.id,
            "name": medicine.name,
            "price": str(medicine.price),
        },
    })

@login_required
@require_POST
def remove_cart_item(request, item_id):
    item = CartItem.objects.filter(id=item_id, cart__user=request.user).first()
    if item is None:
        return JsonResponse({"success": False, "error": "Cart item not found."}, status=404)

    item.delete()
    cart_count = CartItem.objects.filter(cart__user=request.user).aggregate(total=Sum("quantity"))["total"] or 0
    return JsonResponse({"success": True, "cart_count": cart_count})

@login_required
@csrf_exempt
@require_POST
def create_order(request):
    try:
        data = json.loads(request.body)
        patient_name = data.get("patient_name", "").strip()
        payment_id = data.get("payment_id", "")
        raw_items = data.get("items")
        if raw_items is None and data.get("medicine_id") is not None:
            raw_items = [{
                "medicine_id": data["medicine_id"],
                "quantity": data.get("quantity", 1),
            }]
        if not patient_name or not isinstance(raw_items, list) or not raw_items:
            return JsonResponse({"success": False, "error": "Invalid checkout details."}, status=400)

        requested_quantities = {}
        for raw_item in raw_items:
            if not isinstance(raw_item, dict):
                return JsonResponse({"success": False, "error": "Invalid checkout items."}, status=400)
            medicine_id = int(raw_item["medicine_id"])
            quantity = int(raw_item["quantity"])
            if quantity < 1:
                return JsonResponse({"success": False, "error": "Invalid checkout quantity."}, status=400)
            requested_quantities[medicine_id] = requested_quantities.get(medicine_id, 0) + quantity

        with transaction.atomic():
            medicines = {
                medicine.id: medicine
                for medicine in Medicine.objects.filter(
                    id__in=requested_quantities,
                    is_active=True,
                )
            }
            if len(medicines) != len(requested_quantities):
                return JsonResponse({"success": False, "error": "A medicine is unavailable."}, status=404)

            cart_items = {
                item.medicine_id: item
                for item in CartItem.objects.select_for_update().filter(
                    cart__user=request.user,
                    medicine_id__in=requested_quantities,
                )
            }
            if any(
                medicine_id not in cart_items or cart_items[medicine_id].quantity < quantity
                for medicine_id, quantity in requested_quantities.items()
            ):
                return JsonResponse({"success": False, "error": "Cart quantities changed. Refresh and try again."}, status=400)

            total_amount = sum(
                (medicines[medicine_id].price * quantity for medicine_id, quantity in requested_quantities.items()),
                Decimal("0.00"),
            )
            order = Order.objects.create(
                user=request.user,
                patient_name=patient_name,
                total_amount=total_amount,
                razorpay_payment_id=payment_id,
                is_paid=True
            )
            for medicine_id, quantity in requested_quantities.items():
                medicine = medicines[medicine_id]
                OrderItem.objects.create(
                    order=order,
                    medicine=medicine,
                    quantity=quantity,
                    price=medicine.price,
                )
                cart_item = cart_items[medicine_id]
                if cart_item.quantity == quantity:
                    cart_item.delete()
                else:
                    cart_item.quantity -= quantity
                    cart_item.save(update_fields=["quantity"])

        cart_count = CartItem.objects.filter(cart__user=request.user).aggregate(total=Sum("quantity"))["total"] or 0
        return JsonResponse({"success": True, "cart_count": cart_count})
    except (KeyError, TypeError, ValueError, json.JSONDecodeError):
        return JsonResponse({"success": False, "error": "Invalid checkout details."}, status=400)
    except Medicine.DoesNotExist:
        return JsonResponse({"success": False, "error": "Medicine is unavailable."}, status=404)
