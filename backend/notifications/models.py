from django.conf import settings
from django.db import models


class Notification(models.Model):
    """An in-app notification, which is also what gets emailed. One row per (user, dedupe_key), so replaying an event
    or re-running a reminder can never notify the same person twice."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notifications")
    kind = models.CharField(max_length=40)
    title = models.CharField(max_length=160)
    body = models.TextField()
    urgent = models.BooleanField(default=False)
    view = models.CharField(max_length=20, default="owner")  # which dashboard section to open: owner / guardian / beneficiary
    chain_id = models.PositiveIntegerField(null=True, blank=True)
    asset_id = models.BigIntegerField(null=True, blank=True)
    claim_id = models.BigIntegerField(null=True, blank=True)
    event = models.ForeignKey("indexer.ChainEvent", null=True, blank=True, on_delete=models.SET_NULL, related_name="notifications")
    dedupe_key = models.CharField(max_length=160)
    created_at = models.DateTimeField(auto_now_add=True)
    read_at = models.DateTimeField(null=True, blank=True)
    email_sent_at = models.DateTimeField(null=True, blank=True)
    email_attempts = models.PositiveSmallIntegerField(default=0)
    email_error = models.TextField(blank=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        constraints = [models.UniqueConstraint(fields=["user", "dedupe_key"], name="one_notification_per_key")]
        indexes = [models.Index(fields=["user", "read_at"])]
