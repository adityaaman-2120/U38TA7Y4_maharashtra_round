from rest_framework import serializers

from accounts.addresses import checksum

from .models import Invite


class InviteCreateSerializer(serializers.Serializer):
    email = serializers.EmailField(max_length=254)
    role = serializers.ChoiceField(choices=Invite.Role.choices)
    name = serializers.CharField(required=False, allow_blank=True, max_length=80)

    def validate_email(self, value):
        return value.strip().lower()

    def validate_name(self, value):
        return value.strip()


class InviteSerializer(serializers.ModelSerializer):
    status = serializers.CharField(source="display_status")
    invitee = serializers.SerializerMethodField()

    class Meta:
        model = Invite
        fields = ["id", "email", "name", "role", "status", "created_at", "expires_at", "accepted_at", "invitee"]

    def get_invitee(self, invite):
        """Only exposed once the person accepted, and only name, address and public key (never email/phone)."""
        user = invite.invitee
        if invite.status != Invite.Status.ACCEPTED or user is None:
            return None
        key = getattr(user, "key_blob", None)
        return {"address": checksum(user.address), "name": user.name, "public_key": key.public_key if key else None}


class TokenSerializer(serializers.Serializer):
    token = serializers.CharField(max_length=2000)
