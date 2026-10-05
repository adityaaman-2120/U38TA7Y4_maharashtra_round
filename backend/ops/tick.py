"""The scheduler's tick: everything that used to run as periodic background tasks, as one idempotent function.

An external cron service calls POST /internal/tick every minute. Each call:
  1. indexes new contract events (a bounded batch, so it always ends inside the time budget),
  2. creates notifications for them, emails them, and starts the owner's claim alert,
  3. sends due reminders (check-in due/overdue, attestation deadline),
  4. runs the claim escalation stages that have become due (SMS after the delay, guardian warning before the end),
  5. retries emails that failed earlier.

It is safe to call twice at once: a lease row (one compare-and-set UPDATE) lets only one run proceed; the other returns at
once. Every stage is idempotent, and one failing stage never stops the next.
"""
import logging
import time
from datetime import timedelta

from django.conf import settings
from django.db.models import Q
from django.utils import timezone

from .models import TickLock

log = logging.getLogger(__name__)


def _acquire() -> bool:
    TickLock.objects.get_or_create(pk=1)
    now = timezone.now()
    taken = (
        TickLock.objects.filter(pk=1)
        .filter(Q(locked_until__isnull=True) | Q(locked_until__lt=now))
        .update(locked_until=now + timedelta(seconds=settings.TICK_LEASE_SECONDS), last_started_at=now)
    )
    return taken == 1


def _release(result: dict) -> None:
    TickLock.objects.filter(pk=1).update(locked_until=None, last_finished_at=timezone.now(), last_result=result)


def run_tick(budget: float | None = None) -> dict:
    """Runs one tick. Returns a summary (counts and error class names only: no personal data)."""
    from alerts import service as alerts
    from indexer.runner import index_all
    from notifications import delivery, reminders
    from notifications.notify import process_pending_events

    if not _acquire():
        return {"skipped": "another tick is running"}
    started = time.monotonic()
    budget = budget or settings.TICK_BUDGET_SECONDS
    deadline = started + budget
    result: dict = {}

    def stage(name: str, fn):
        if time.monotonic() >= deadline:
            result[name] = "skipped: out of time"
            return
        try:
            result[name] = fn()
        except Exception as e:  # a failing stage must not stop the others, and must not leak details into the response
            log.warning("tick stage %s failed: %s", name, type(e).__name__)  # class only: messages can contain addresses
            log.debug("tick stage %s traceback", name, exc_info=True)
            result[name] = {"error": type(e).__name__}

    try:
        stage("index", lambda: index_all(started + budget * 0.6))
        stage("notify", lambda: process_pending_events(deadline=deadline))
        stage("reminders", reminders.run_all)
        stage("escalations", alerts.run_all)
        stage("email_retries", lambda: delivery.retry_unsent(deadline=deadline))
        result["seconds"] = round(time.monotonic() - started, 2)
        return result
    finally:
        _release(result)
