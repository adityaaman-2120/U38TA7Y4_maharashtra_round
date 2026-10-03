from django.http import JsonResponse
from django.urls import include, path


def health(_request):
    return JsonResponse({"status": "ok"})


urlpatterns = [
    path("api/health", health),
    path("api/", include("accounts.urls")),
    path("api/", include("keys.urls")),
    path("api/", include("invites.urls")),
    path("api/", include("indexer.urls")),
    path("api/", include("notifications.urls")),
]
