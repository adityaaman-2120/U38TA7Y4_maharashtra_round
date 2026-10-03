from django.conf import settings
from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .emails import invite_link, send_invite_email
from .models import Invite
from .serializers import InviteCreateSerializer, InviteSerializer, TokenSerializer
from .tokens import resolve_token

NOT_FOUND = {"detail": "This invitation is invalid or has expired."}


def _with_link(data: dict, invite: Invite) -> dict:
    # In development there is no real mailbox, so hand the link back to the owner too. Never in production.
    if settings.DEBUG:
        data["link"] = invite_link(invite)
    return data


class InviteListCreateView(APIView):
    throttle_scope = "default"

    def get(self, request):
        invites = Invite.objects.filter(owner=request.user).select_related("invitee", "invitee__key_blob")
        return Response(InviteSerializer(invites, many=True).data)

    def post(self, request):
        user = request.user
        if not user.name:
            return Response({"detail": "Add your name to your profile first, so invitees know who is asking."}, status=400)
        s = InviteCreateSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        if d["email"] == user.email.lower():
            return Response({"detail": "You cannot invite yourself."}, status=400)
        live = Invite.objects.filter(owner=user, status__in=["pending", "accepted"]).count()
        if live >= settings.MAX_ACTIVE_INVITES_PER_OWNER:
            return Response({"detail": "Too many active invitations."}, status=400)

        # An expired pending invite for the same person/role blocks the unique constraint, so retire it first.
        Invite.objects.filter(owner=user, email=d["email"], role=d["role"], status="pending", expires_at__lte=timezone.now()).update(status="revoked")
        try:
            with transaction.atomic():
                invite = Invite.objects.create(
                    owner=user, email=d["email"], role=d["role"], name=d.get("name", ""),
                    nonce=Invite.new_nonce(), expires_at=Invite.new_expiry(),
                )
        except IntegrityError:
            return Response({"detail": "You already invited this person in this role."}, status=409)
        sent = send_invite_email(invite)
        data = InviteSerializer(invite).data
        data["email_sent"] = sent
        return Response(_with_link(data, invite), status=status.HTTP_201_CREATED)


class InviteDetailView(APIView):
    throttle_scope = "default"

    def delete(self, request, pk):
        invite = get_object_or_404(Invite, pk=pk, owner=request.user)
        if invite.status == Invite.Status.REVOKED:
            return Response(status=status.HTTP_204_NO_CONTENT)
        # Removing an accepted contact only stops offering them in the app; anything already on-chain is unchanged.
        invite.status = Invite.Status.REVOKED
        invite.nonce = Invite.new_nonce()  # kills any link still in an inbox
        invite.save(update_fields=["status", "nonce"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class InviteResendView(APIView):
    throttle_scope = "invite_resend"

    def post(self, request, pk):
        invite = get_object_or_404(Invite, pk=pk, owner=request.user, status=Invite.Status.PENDING)
        invite.nonce = Invite.new_nonce()  # older links stop working
        invite.expires_at = Invite.new_expiry()
        invite.save(update_fields=["nonce", "expires_at"])
        data = InviteSerializer(invite).data
        data["email_sent"] = send_invite_email(invite)
        return Response(_with_link(data, invite))


class InvitePreviewView(APIView):
    """What an invitee sees before signing in. Reveals only who is asking and for what."""

    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_scope = "invite_preview"

    def post(self, request):
        s = TokenSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        invite = resolve_token(s.validated_data["token"])
        if invite is None:
            return Response(NOT_FOUND, status=status.HTTP_404_NOT_FOUND)
        return Response({"role": invite.role, "inviter": invite.owner.name or "Someone", "email": invite.email})


class InviteAcceptView(APIView):
    throttle_scope = "default"

    def post(self, request):
        s = TokenSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        invite = resolve_token(s.validated_data["token"])
        if invite is None:
            return Response(NOT_FOUND, status=status.HTTP_404_NOT_FOUND)
        user = request.user
        if invite.owner_id == user.id:
            return Response({"detail": "You cannot accept your own invitation."}, status=400)
        if not user.profile_complete:
            return Response({"detail": "Complete your profile first."}, status=400)
        if user.email.lower() != invite.email:
            return Response({"detail": "This invitation was sent to a different email address than your profile."}, status=409)
        if not hasattr(user, "key_blob"):
            return Response({"detail": "Set up your encryption key before accepting."}, status=400)

        with transaction.atomic():
            invite = Invite.objects.select_for_update().get(pk=invite.pk)
            if invite.status != Invite.Status.PENDING or invite.is_expired:  # lost a race or just expired
                return Response(NOT_FOUND, status=status.HTTP_404_NOT_FOUND)
            invite.status = Invite.Status.ACCEPTED
            invite.invitee = user
            invite.accepted_at = timezone.now()
            invite.save(update_fields=["status", "invitee", "accepted_at"])
        return Response(InviteSerializer(invite).data)


class ContactListView(APIView):
    """People who have accepted one of the owner's invitations: the only people the owner can add on-chain."""

    throttle_scope = "default"

    def get(self, request):
        role = request.query_params.get("role")
        qs = Invite.objects.filter(owner=request.user, status=Invite.Status.ACCEPTED, invitee__isnull=False).select_related("invitee", "invitee__key_blob")
        if role in Invite.Role.values:
            qs = qs.filter(role=role)
        return Response(InviteSerializer(qs, many=True).data)
