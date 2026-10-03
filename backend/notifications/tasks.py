import logging

from celery import shared_task
from django.core.cache import cache

from . import emails, reminders
from .models import Notification

log = logging.getLogger(__name__)


@shared_task(name="notifications.send_email", bind=True, max_retries=6)
def send_notification_email(self, notification_id: int):
    """Delivers one notification's email, retrying with backoff if the mail server is unavailable."""
    try:
        n = Notification.objects.select_related("user").get(pk=notification_id)
    except Notification.DoesNotExist:
        return
    try:
        emails.send(n)
    except Exception as exc:
        raise self.retry(exc=exc, countdown=min(30 * 2**self.request.retries, 1800)) from exc


@shared_task(name="notifications.send_reminders")
def send_reminders():
    """Heartbeat-due and attestation-deadline reminders. One run at a time, and each reminder at most once."""
    if not cache.add("lock:reminders", 1, timeout=240):
        return 0
    try:
        from indexer.chains import load_chains
        from indexer.client import Web3Client

        configs = {(c.chain_id, c.address): c for c in load_chains()}
        clients: dict = {}

        def client_for(state):
            key = (state.chain_id, state.address)
            if key not in clients:
                clients[key] = Web3Client(configs[key])
            return clients[key]

        return reminders.run(client_for)
    finally:
        cache.delete("lock:reminders")
