"""Contact verification: a 6-digit code sent to the email or phone on file, proving the person controls it."""
import hashlib
import hmac
import logging
import secrets
from datetime import timedelta

from django.conf import settings
from django.core.mail import send_mail
from django.utils import timezone

from accounts.models import User

from . import sms
from .models import AlertLog, AlertPreference, VerificationCode

log = logging.getLogger(__name__)
MAX_ATTEMPTS = 5
CHANNELS = ("email", "phone")


class VerificationError(Exception):
    """A message that is safe to show the user."""


def _hash(user: User, channel: str, code: str) -> str:
    return hmac.new(settings.SECRET_KEY.encode(), f"{user.pk}:{channel}:{code}".encode(), hashlib.sha256).hexdigest()


def _record(user: User, channel: str, status: str, reason: str = "") -> None:
    AlertLog.objects.create(user=user, kind="verification", channel="email" if channel == "email" else "sms", status=status, reason=reason, attempts=1)
    log.info("alert kind=verification channel=%s status=%s reason=%s user=%s", channel, status, reason, user.pk)


def start(user: User, channel: str) -> None:
    if channel == "email":
        if not user.email:
            raise VerificationError("Add an email address to your profile first.")
    elif not user.phone:
        raise VerificationError("Add a phone number to your profile first.")
    elif not sms.get_backend().available():
        raise VerificationError("Text messages are not set up on this server, so a phone cannot be verified.")
    code = f"{secrets.randbelow(10**6):06d}"
    text = f"Your Heirloom verification code is {code}. It expires in {settings.VERIFICATION_CODE_TTL_SECONDS // 60} minutes. If you did not ask for it, ignore this message."
    try:
        if channel == "email":
            send_mail("Your Heirloom verification code", text, settings.DEFAULT_FROM_EMAIL, [user.email], fail_silently=False)
        else:
            sms.get_backend().send(user.phone, text)
    except Exception as e:
        _record(user, channel, AlertLog.Status.FAILED, "delivery_error")
        log.warning("verification delivery failed user=%s channel=%s error=%s", user.pk, channel, type(e).__name__)
        raise VerificationError("The code could not be sent. Try again in a moment.") from None
    VerificationCode.objects.update_or_create(
        user=user, channel=channel,
        defaults=dict(code_hash=_hash(user, channel, code), expires_at=timezone.now() + timedelta(seconds=settings.VERIFICATION_CODE_TTL_SECONDS), attempts=0),
    )
    _record(user, channel, AlertLog.Status.SENT)


def confirm(user: User, channel: str, code: str) -> None:
    row = VerificationCode.objects.filter(user=user, channel=channel).first()
    if row is None or row.expires_at <= timezone.now() or row.attempts >= MAX_ATTEMPTS:
        raise VerificationError("That code has expired. Request a new one.")
    row.attempts += 1
    row.save(update_fields=["attempts"])
    if not hmac.compare_digest(row.code_hash, _hash(user, channel, code.strip())):
        raise VerificationError("That code is not right.")
    row.delete()
    field = "email_verified_at" if channel == "email" else "phone_verified_at"
    setattr(user, field, timezone.now())
    user.save(update_fields=[field])


def on_profile_change(user: User, old_email: str, old_phone: str) -> None:
    """A changed contact is unverified again, and a number that is no longer verified can no longer receive SMS."""
    if user.email != old_email:
        user.email_verified_at = None
        VerificationCode.objects.filter(user=user, channel="email").delete()
    if user.phone != old_phone:
        user.phone_verified_at = None
        VerificationCode.objects.filter(user=user, channel="phone").delete()
        AlertPreference.objects.filter(user=user).update(sms_enabled=False)
    user.save(update_fields=["email_verified_at", "phone_verified_at"])
