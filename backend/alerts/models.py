import uuid

from django.conf import settings
from django.db import models


class AlertPreference(models.Model):
    """Which channels a person wants urgent alerts on. Email is on by default; SMS only after the phone is verified."""

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="alert_prefs")
    email_enabled = models.BooleanField(default=True)
    sms_enabled = models.BooleanField(default=False)


class ClaimEscalation(models.Model):
    """What the alerting needs to know about one raised claim, looked up once: who owns the vault and when the challenge ends.
    Times are chain time (unix seconds), because that is the clock the contract compares against."""

    chain_id = models.PositiveIntegerField()
    address = models.CharField(max_length=42)  # lower-case contract address
    claim_id = models.BigIntegerField()
    asset_id = models.BigIntegerField()
    owner = models.CharField(max_length=42)  # lower-case vault owner
    raised_at = models.BigIntegerField()
    ends_at = models.BigIntegerField()  # raised_at + the asset's challenge period
    closed_at = models.DateTimeField(null=True, blank=True)  # set once the claim is over: nothing more to escalate
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["chain_id", "address", "claim_id"], name="one_escalation_per_claim")]


class AlertLink(models.Model):
    """One single-use "I'm alive" link. The emailed token only names this row; validity (expiry, used) lives here."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    escalation = models.ForeignKey(ClaimEscalation, on_delete=models.CASCADE, related_name="links")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="alert_links")
    channel = models.CharField(max_length=10)
    created_at = models.DateTimeField(auto_now_add=True)
    used_at = models.DateTimeField(null=True, blank=True)


class AlertLog(models.Model):
    """A record of every alert attempt. Deliberately holds no destination (email/phone) and no message text, only ids and
    short codes, so the log itself is never a store of personal data."""

    class Status(models.TextChoices):
        SENT = "sent"
        FAILED = "failed"
        SKIPPED = "skipped"

    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="alert_logs")
    escalation = models.ForeignKey(ClaimEscalation, null=True, blank=True, on_delete=models.SET_NULL, related_name="logs")
    chain_id = models.PositiveIntegerField(null=True, blank=True)
    claim_id = models.BigIntegerField(null=True, blank=True)
    kind = models.CharField(max_length=40)  # owner_claim_raised, owner_claim_escalation, guardian_challenge_ending, verification
    channel = models.CharField(max_length=10)  # email / sms
    status = models.CharField(max_length=10, choices=Status.choices)
    reason = models.CharField(max_length=40, blank=True)  # channel_disabled, phone_unverified, no_contact, sms_unavailable, delivery_error
    provider_ref = models.CharField(max_length=64, blank=True)  # e.g. the SMS provider's message id
    attempts = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        constraints = [
            models.UniqueConstraint(fields=["escalation", "user", "kind", "channel"], condition=models.Q(escalation__isnull=False), name="one_alert_per_stage")
        ]


class VerificationCode(models.Model):
    """A pending contact-verification code. Only a keyed hash is stored."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="verification_codes")
    channel = models.CharField(max_length=10)
    code_hash = models.CharField(max_length=64)
    expires_at = models.DateTimeField()
    attempts = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "channel"], name="one_code_per_channel")]
