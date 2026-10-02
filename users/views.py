from django.contrib.auth import login
from django.contrib.auth.forms import UserCreationForm
from django.shortcuts import redirect, render
from django.utils.http import url_has_allowed_host_and_scheme


def register(request):
	if request.user.is_authenticated:
		return redirect("home")

	next_url = request.POST.get("next") or request.GET.get("next", "")
	form = UserCreationForm(request.POST or None)
	if request.method == "POST" and form.is_valid():
		user = form.save()
		login(request, user)
		if next_url and url_has_allowed_host_and_scheme(next_url, {request.get_host()}):
			return redirect(next_url)
		return redirect("home")

	return render(request, "users/register.html", {"form": form, "next": next_url})
