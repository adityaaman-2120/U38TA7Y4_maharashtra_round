from django.urls import path

from . import views

urlpatterns = [
    path("invites", views.InviteListCreateView.as_view()),
    path("invites/preview", views.InvitePreviewView.as_view()),
    path("invites/accept", views.InviteAcceptView.as_view()),
    path("invites/<uuid:pk>", views.InviteDetailView.as_view()),
    path("invites/<uuid:pk>/resend", views.InviteResendView.as_view()),
    path("contacts", views.ContactListView.as_view()),
]
