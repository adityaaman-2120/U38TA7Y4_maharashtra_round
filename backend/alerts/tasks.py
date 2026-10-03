from celery import shared_task
from django.core.cache import cache

from . import service


@shared_task(name="alerts.escalate_claim")
def escalate_claim(event_id: int):
    """Runs right after a ClaimRaised event is processed: the owner's email goes out immediately."""
    return service.escalate_event(event_id)


@shared_task(name="alerts.run_escalations")
def run_escalations():
    """Periodic: SMS after the delay, guardian alerts before the end, and a retry for anything that failed. One run at a time."""
    if not cache.add("lock:escalations", 1, timeout=240):
        return 0
    try:
        return service.run_all()
    finally:
        cache.delete("lock:escalations")
