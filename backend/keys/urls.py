from django.urls import path

from .views import KeyBlobView

urlpatterns = [path("key-blob", KeyBlobView.as_view())]
