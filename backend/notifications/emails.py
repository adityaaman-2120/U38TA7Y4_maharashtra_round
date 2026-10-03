from django.conf import settings
from django.core.mail import send_mail
from django.utils import timezone

from .models import Notification


def render(n: Notification) -> tuple[str, str]:
    subject = f"{'[Action needed] ' if n.urgent else ''}{n.title}"
    body = (
        f"Hello {n.user.name or 'there'},\n\n"
        f"{n.body}\n\n"
        f"Open Heirloom: {settings.FRONTEND_URL}/app\n\n"
        "You are receiving this because you are part of a Heirloom vault. "
        "This message contains no file contents or secrets."
    )
    return subject, body


def send(n: Notification) -> bool:
    """Sends the email for a notification once. Raises on delivery failure so Celery can retry."""
    if n.email_sent_at or not n.user.email:
        return False
    subject, body = render(n)
    n.email_attempts += 1
    try:
        send_mail(subject, body, settings.DEFAULT_FROM_EMAIL, [n.user.email], fail_silently=False)
    except Exception as e:
        n.email_error = str(e)[:500]
        n.save(update_fields=["email_attempts", "email_error"])
        raise
    n.email_sent_at, n.email_error = timezone.now(), ""
    n.save(update_fields=["email_attempts", "email_sent_at", "email_error"])
    return True
