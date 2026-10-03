from django.urls import path

from . import views

urlpatterns = [
    path("alerts/settings", views.AlertSettingsView.as_view()),
    path("alerts/verify/start", views.VerifyStartView.as_view()),
    path("alerts/verify/confirm", views.VerifyConfirmView.as_view()),
    path("alive/preview", views.AlivePreviewView.as_view()),
    path("alive/consume", views.AliveConsumeView.as_view()),
]
