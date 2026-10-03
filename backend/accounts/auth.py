import time
import uuid

import jwt
from django.conf import settings
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed

from .models import User


def issue_token(user: User) -> str:
    now = int(time.time())
    payload = {
        "sub": str(user.pk),
        "addr": user.address,
        "sv": user.session_version,
        "iat": now,
        "exp": now + settings.JWT_LIFETIME_SECONDS,
        "jti": uuid.uuid4().hex,
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def set_session_cookie(response, user: User) -> None:
    response.set_cookie(
        settings.JWT_COOKIE_NAME,
        issue_token(user),
        max_age=settings.JWT_LIFETIME_SECONDS,
        httponly=True,
        secure=settings.JWT_COOKIE_SECURE,
        samesite=settings.JWT_COOKIE_SAMESITE,
        path="/",
    )


def clear_session_cookie(response) -> None:
    response.delete_cookie(settings.JWT_COOKIE_NAME, path="/", samesite=settings.JWT_COOKIE_SAMESITE)


class JWTCookieAuthentication(BaseAuthentication):
    def authenticate(self, request):
        token = request.COOKIES.get(settings.JWT_COOKIE_NAME)
        if not token:
            return None
        try:
            payload = jwt.decode(
                token,
                settings.SECRET_KEY,
                algorithms=[settings.JWT_ALGORITHM],  # fixed: never trust the token's own "alg"
                options={"require": ["exp", "sub", "sv"]},
            )
            user = User.objects.get(pk=int(payload["sub"]), is_active=True)
        except (jwt.PyJWTError, User.DoesNotExist, ValueError):
            raise AuthenticationFailed("Session expired. Please sign in again.") from None
        if user.session_version != payload["sv"]:
            raise AuthenticationFailed("Session expired. Please sign in again.")
        return user, token

    def authenticate_header(self, request):
        return "Session"
