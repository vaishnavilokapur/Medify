from django.db.models import Sum
from django.shortcuts import render
from orders.models import CartItem

def home(request):
    cart_count = 0
    if request.user.is_authenticated:
        cart_count = CartItem.objects.filter(cart__user=request.user).aggregate(total=Sum('quantity'))['total'] or 0
    return render(request, 'core/home.html', {'cart_count': cart_count})
