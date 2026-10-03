from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from . import siwe
from .auth import clear_session_cookie, set_session_cookie
from .models import User
from .serializers import (
    NonceRequestSerializer,
    ProfileUpdateSerializer,
    UserSerializer,
    VerifyRequestSerializer,
)

INVALID_SIGNIN = {"detail": "Sign-in failed. Request a new challenge and try again."}


class NonceView(APIView):
    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_scope = "auth_nonce"

    def post(self, request):
        s = NonceRequestSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        from urllib.parse import urlparse

        challenge = siwe.issue_challenge(d["address"], urlparse(d["uri"]).netloc, d["uri"], d["chain_id"])
        return Response(challenge)


class VerifyView(APIView):
    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_scope = "auth_verify"

    def post(self, request):
        s = VerifyRequestSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        address, signature = s.validated_data["address"], s.validated_data["signature"]
        if not siwe.consume_and_verify(address, signature):
            return Response(INVALID_SIGNIN, status=status.HTTP_401_UNAUTHORIZED)
        user, _ = User.objects.get_or_create(address=address, defaults={"password": "!"})
        if not user.is_active:
            return Response(INVALID_SIGNIN, status=status.HTTP_401_UNAUTHORIZED)
        response = Response(UserSerializer(user).data)
        set_session_cookie(response, user)  # httpOnly: JavaScript never sees the token
        return response


class LogoutView(APIView):
    authentication_classes: list = []
    permission_classes = [AllowAny]

    def post(self, request):
        # Revoke server-side too, if a valid session was presented.
        from .auth import JWTCookieAuthentication

        try:
            result = JWTCookieAuthentication().authenticate(request)
        except Exception:
            result = None
        if result:
            user = result[0]
            user.session_version += 1
            user.save(update_fields=["session_version"])
        response = Response(status=status.HTTP_204_NO_CONTENT)
        clear_session_cookie(response)
        return response


class MeView(APIView):
    throttle_scope = "default"

    def get(self, request):
        return Response(UserSerializer(request.user).data)

    def put(self, request):
        s = ProfileUpdateSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        user = request.user
        for field, value in s.validated_data.items():
            setattr(user, field, value)
        user.save(update_fields=list(s.validated_data))
        return Response(UserSerializer(user).data)
