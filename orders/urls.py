from django.urls import path
from . import views

urlpatterns = [
    path('cart/add/', views.add_to_cart, name='add_to_cart'),
    path('cart/', views.cart_view, name='cart'),
    path('cart/remove/<int:item_id>/', views.remove_cart_item, name='remove_cart_item'),
    path('create/', views.create_order, name='create_order'),
]
