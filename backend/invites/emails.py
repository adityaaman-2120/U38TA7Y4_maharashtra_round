import logging

from django.conf import settings
from django.core.mail import send_mail

from .models import Invite
from .tokens import make_token

log = logging.getLogger(__name__)

ROLE_TEXT = {
    Invite.Role.GUARDIAN: "a guardian",
    Invite.Role.BENEFICIARY: "a beneficiary",
}


def invite_link(invite: Invite) -> str:
    return f"{settings.FRONTEND_URL}/invite/{make_token(invite)}"


def send_invite_email(invite: Invite) -> bool:
    """Returns whether the email was handed to the mail backend. Never raises: the invite exists either way."""
    owner = invite.owner.name or "Someone"
    role = ROLE_TEXT[invite.role]
    body = (
        f"{owner} has invited you to be {role} on Heirloom, a service for passing digital assets on to the right "
        "people without trusting any single party.\n\n"
        f"Open this link to accept (it expires in {settings.INVITE_TTL_SECONDS // 86400} days):\n"
        f"{invite_link(invite)}\n\n"
        "You will connect a wallet, set an encryption password and accept. Nothing is charged for signing in. "
        "If you were not expecting this, you can ignore this email."
    )
    try:
        send_mail(f"{owner} invited you to Heirloom", body, settings.DEFAULT_FROM_EMAIL, [invite.email], fail_silently=False)
        return True
    except Exception:
        log.exception("Could not send invite email for %s", invite.id)
        return False
