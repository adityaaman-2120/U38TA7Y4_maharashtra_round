from django.urls import include, path

from ops.views import health, tick

urlpatterns = [
    path("health", health),
    path("api/health", health),
    path("internal/tick", tick),
    path("api/", include("accounts.urls")),
    path("api/", include("keys.urls")),
    path("api/", include("invites.urls")),
    path("api/", include("indexer.urls")),
    path("api/", include("notifications.urls")),
    path("api/", include("alerts.urls")),
]
