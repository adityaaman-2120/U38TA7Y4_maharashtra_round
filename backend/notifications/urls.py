from django.urls import path

from .views import MarkReadView, NotificationListView

urlpatterns = [
    path("notifications", NotificationListView.as_view()),
    path("notifications/read", MarkReadView.as_view()),
]
