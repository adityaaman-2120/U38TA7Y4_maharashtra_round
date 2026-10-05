"""Sending notification emails. There is no queue: a notification is emailed right after it is created, and any that failed
(provider down, rate limit) are retried by the scheduler's tick until they succeed or run out of attempts."""
import logging
import time
from datetime import timedelta

from django.conf import settings
from django.utils import timezone

from . import emails
from .models import Notification

log = logging.getLogger(__name__)
# The owner's claim alert is emailed by the alerts module, because it carries the one-time check-in link.
NOT_EMAILED_HERE = ("claim_raised_owner",)
RETRY_WINDOW = timedelta(days=1)  # older notifications are in-app only: nobody wants yesterday's alert by email later


def deliver(n: Notification) -> bool:
    """Tries once. Never raises: the failure is recorded on the row and retried later. Logs ids only (no addresses, no text)."""
    try:
        return emails.send(n)
    except Exception as e:
        log.warning("notification email failed id=%s attempts=%s error=%s", n.pk, n.email_attempts, type(e).__name__)
        return False


def retry_unsent(deadline: float | None = None, limit: int = 100) -> int:
    """Re-sends emails that have not gone out yet. Returns how many were delivered."""
    pending = (
        Notification.objects.filter(email_sent_at__isnull=True, email_attempts__lt=settings.NOTIFICATION_EMAIL_MAX_ATTEMPTS, created_at__gte=timezone.now() - RETRY_WINDOW)
        .exclude(kind__in=NOT_EMAILED_HERE)
        .exclude(user__email="")
        .select_related("user")
        .order_by("id")[:limit]
    )
    sent = 0
    for n in pending:
        if deadline is not None and time.monotonic() >= deadline:
            break
        sent += int(deliver(n))
    return sent
