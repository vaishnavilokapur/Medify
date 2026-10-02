import json
from decimal import Decimal
from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse
from medicines.models import Category, Medicine
from .models import Cart, CartItem, Order, OrderItem


class CartCheckoutTests(TestCase):
	def setUp(self):
		self.user = User.objects.create_user(username="cartuser", password="test-password-123")
		category = Category.objects.create(name="Pain Relief")
		self.medicine = Medicine.objects.create(
			category=category,
			name="Pain Relief Tablet",
			description="For temporary relief of pain.",
			price=Decimal("10.00"),
			stock=20,
		)
		self.second_medicine = Medicine.objects.create(
			category=category,
			name="Cold Relief Tablet",
			description="For temporary relief of cold symptoms.",
			price=Decimal("20.00"),
			stock=20,
		)
		cart = Cart.objects.create(user=self.user)
		self.cart_item = CartItem.objects.create(cart=cart, medicine=self.medicine, quantity=3)
		self.second_cart_item = CartItem.objects.create(cart=cart, medicine=self.second_medicine, quantity=2)
		self.client.force_login(self.user)

	def test_cart_displays_item_quantity_and_checkout_actions(self):
		response = self.client.get(reverse("cart"))

		self.assertEqual(response.status_code, 200)
		self.assertContains(response, "Pain Relief Tablet")
		self.assertContains(response, "Quantity 3")
		self.assertContains(response, "Checkout all items")
		self.assertEqual(response.content.count(b"Checkout &amp; Pay"), 0)
		self.assertContains(response, "Remove")

	def test_remove_cart_item_updates_saved_cart(self):
		response = self.client.post(reverse("remove_cart_item", args=[self.cart_item.id]))

		self.assertEqual(response.status_code, 200)
		self.assertEqual(response.json()["cart_count"], 0)
		self.assertFalse(CartItem.objects.filter(id=self.cart_item.id).exists())

	def test_checkout_records_multiple_medicines_in_one_order(self):
		response = self.client.post(
			reverse("create_order"),
			data=json.dumps({
				"items": [
					{"medicine_id": self.medicine.id, "quantity": 2},
					{"medicine_id": self.second_medicine.id, "quantity": 2},
				],
				"patient_name": "Test Patient",
				"payment_id": "test-payment",
			}),
			content_type="application/json",
		)

		self.assertEqual(response.status_code, 200)
		self.assertTrue(response.json()["success"])
		self.assertEqual(response.json()["cart_count"], 1)
		order = Order.objects.get(user=self.user)
		order_items = {item.medicine_id: item for item in OrderItem.objects.filter(order=order)}
		self.assertEqual(order.total_amount, Decimal("60.00"))
		self.assertEqual(len(order_items), 2)
		self.assertEqual(order_items[self.medicine.id].quantity, 2)
		self.assertEqual(order_items[self.medicine.id].price, Decimal("10.00"))
		self.assertEqual(order_items[self.second_medicine.id].quantity, 2)
		self.assertEqual(order_items[self.second_medicine.id].price, Decimal("20.00"))
		self.assertEqual(CartItem.objects.get(cart__user=self.user).quantity, 1)
		self.assertFalse(CartItem.objects.filter(id=self.second_cart_item.id).exists())
