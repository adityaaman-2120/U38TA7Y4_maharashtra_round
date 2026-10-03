from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.addresses import checksum
from indexer.clients import get_client

from . import service, sms, verification
from .models import AlertLink, AlertLog
from .tokens import resolve_token


class SettingsSerializer(serializers.Serializer):
    email_enabled = serializers.BooleanField()
    sms_enabled = serializers.BooleanField()


def _settings_payload(user) -> dict:
    prefs = service.prefs_for(user)
    recent = AlertLog.objects.filter(user=user).exclude(status="skipped")[:10]
    return {
        "email_enabled": prefs.email_enabled,
        "sms_enabled": prefs.sms_enabled,
        "has_email": bool(user.email),
        "has_phone": bool(user.phone),
        "email_verified": user.email_verified,
        "phone_verified": user.phone_verified,
        "sms_available": sms.get_backend().available(),
        # What was sent, never to where or what it said.
        "recent": [{"kind": a.kind, "channel": a.channel, "status": a.status, "claim_id": a.claim_id, "at": a.created_at} for a in recent],
    }


class AlertSettingsView(APIView):
    throttle_scope = "default"

    def get(self, request):
        return Response(_settings_payload(request.user))

    def put(self, request):
        s = SettingsSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        user, d = request.user, s.validated_data
        if d["sms_enabled"] and not (user.phone and user.phone_verified):
            return Response({"detail": "Verify your phone number before turning on text-message alerts."}, status=400)
        if d["sms_enabled"] and not sms.get_backend().available():
            return Response({"detail": "Text messages are not set up on this server."}, status=400)
        prefs = service.prefs_for(user)
        prefs.email_enabled, prefs.sms_enabled = d["email_enabled"], d["sms_enabled"]
        prefs.save()
        return Response(_settings_payload(user))


class ChannelSerializer(serializers.Serializer):
    channel = serializers.ChoiceField(choices=verification.CHANNELS)


class ConfirmSerializer(ChannelSerializer):
    code = serializers.RegexField(r"^\s*\d{6}\s*$", max_length=12)


class VerifyStartView(APIView):
    throttle_scope = "verify_start"

    def post(self, request):
        s = ChannelSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        try:
            verification.start(request.user, s.validated_data["channel"])
        except verification.VerificationError as e:
            return Response({"detail": str(e)}, status=400)
        return Response(status=status.HTTP_204_NO_CONTENT)


class VerifyConfirmView(APIView):
    throttle_scope = "verify_confirm"

    def post(self, request):
        s = ConfirmSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        try:
            verification.confirm(request.user, s.validated_data["channel"], s.validated_data["code"])
        except verification.VerificationError as e:
            return Response({"detail": str(e)}, status=400)
        return Response(_settings_payload(request.user))


# ---- the emailed "I'm alive" link ----------------------------------------------------------------

def _gone(reason: str, detail: str):
    return Response({"detail": detail, "reason": reason}, status=status.HTTP_410_GONE)


def _resolve(token: str, claim) -> tuple[AlertLink | None, Response | None]:
    """Judges a link: authentic, for this claim, unused, claim still open, challenge not over. Returns (link, None) or (None, error)."""
    link = resolve_token(token or "")
    if link is None or (claim not in (None, "") and str(claim) != str(link.escalation.claim_id)):
        return None, Response({"detail": "This link is not valid.", "reason": "invalid"}, status=status.HTTP_404_NOT_FOUND)
    esc = link.escalation
    if link.used_at:
        return None, _gone("used", "This link has already been used.")
    if esc.closed_at or service.is_closed(esc):
        return None, _gone("closed", "This claim is no longer open, so there is nothing left to cancel with this link.")
    now = service.chain_now(esc.chain_id, esc.address)
    if now and now >= esc.ends_at:
        return None, _gone("expired", "This link expired when the challenge period ended.")
    return link, None


class AlivePreviewView(APIView):
    """What the /alive page needs before it asks for a wallet. Public: the signed token is the credential, and it grants no power by
    itself (a check-in is a transaction only the owner's wallet can sign)."""

    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_scope = "alive_preview"

    def get(self, request):
        link, error = _resolve(request.query_params.get("t", ""), request.query_params.get("claim"))
        if error:
            return error
        esc = link.escalation
        return Response({"claim_id": esc.claim_id, "asset_id": esc.asset_id, "chain_id": esc.chain_id, "owner": checksum(esc.owner), "ends_at": esc.ends_at})


class AliveConsumeView(APIView):
    """Called after the owner's check-in transaction. The server confirms on-chain that the claim really is void, then retires every
    link for it: that is what makes the link single-use."""

    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_scope = "alive_consume"

    def post(self, request):
        link, error = _resolve(str(request.data.get("t", "")), request.data.get("claim"))
        if error:
            return error
        esc = link.escalation
        try:
            invalidated = get_client(esc.chain_id, esc.address).claim_invalidated(esc.claim_id)
        except Exception:
            return Response({"detail": "Could not check the blockchain just now. Try again in a moment."}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        if not invalidated:
            return Response({"detail": "No check-in has been recorded on-chain yet.", "reason": "pending"}, status=status.HTTP_409_CONFLICT)
        AlertLink.objects.filter(escalation=esc, used_at__isnull=True).update(used_at=timezone.now())
        return Response({"ok": True})
