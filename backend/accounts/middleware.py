from django.conf import settings
from django.http import JsonResponse

UNSAFE = {"POST", "PUT", "PATCH", "DELETE"}


class OriginCheckMiddleware:
    """CSRF defence for the cookie session.

    The session cookie is SameSite=Lax and every endpoint requires a JSON body, but we also reject any
    state-changing request whose Origin header names a site we do not serve. Non-browser clients send no
    Origin and are unaffected (they cannot ride a victim's cookie anyway).
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.method in UNSAFE:
            origin = request.headers.get("Origin")
            if origin and origin.rstrip("/") not in settings.ALLOWED_ORIGINS:
                return JsonResponse({"detail": "Origin not allowed."}, status=403)
        return self.get_response(request)
