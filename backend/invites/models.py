import secrets
import uuid
from datetime import timedelta

from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils import timezone


class Invite(models.Model):
    class Role(models.TextChoices):
        GUARDIAN = "guardian"
        BENEFICIARY = "beneficiary"

    class Status(models.TextChoices):
        PENDING = "pending"
        ACCEPTED = "accepted"
        REVOKED = "revoked"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="invites_sent")
    email = models.EmailField()  # lower-case; where the signed link is sent
    name = models.CharField(max_length=80, blank=True)  # the owner's label for this person
    role = models.CharField(max_length=12, choices=Role.choices)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    nonce = models.CharField(max_length=32)  # rotated on resend, which invalidates previously issued links
    invitee = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="invites_received")
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    accepted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["owner", "email", "role"],
                condition=Q(status__in=["pending", "accepted"]),
                name="one_live_invite_per_person_and_role",
            )
        ]

    @staticmethod
    def new_nonce() -> str:
        return secrets.token_hex(16)

    @staticmethod
    def new_expiry():
        return timezone.now() + timedelta(seconds=settings.INVITE_TTL_SECONDS)

    @property
    def is_expired(self) -> bool:
        return self.status == self.Status.PENDING and self.expires_at <= timezone.now()

    @property
    def display_status(self) -> str:
        return "expired" if self.is_expired else self.status
