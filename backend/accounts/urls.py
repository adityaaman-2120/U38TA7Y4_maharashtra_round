from django.urls import path

from . import views

urlpatterns = [
    path("auth/nonce", views.NonceView.as_view()),
    path("auth/verify", views.VerifyView.as_view()),
    path("auth/logout", views.LogoutView.as_view()),
    path("me", views.MeView.as_view()),
]
