from django.conf import settings
from django.core import signing

from .models import Invite

SALT = "heirloom.invite.v1"


def make_token(invite: Invite) -> str:
    """Signed (HMAC) and timestamped. Carries only the invite id and its current nonce; no personal data."""
    return signing.dumps({"id": str(invite.id), "n": invite.nonce}, salt=SALT, compress=False)


def resolve_token(token: str) -> Invite | None:
    """The invite a token refers to, if the token is authentic, unexpired, current and still pending. Else None."""
    try:
        data = signing.loads(token, salt=SALT, max_age=settings.INVITE_TTL_SECONDS)
        invite = Invite.objects.select_related("owner").get(pk=data["id"])
    except (signing.BadSignature, Invite.DoesNotExist, KeyError, ValueError, TypeError):
        return None
    if invite.nonce != data["n"] or invite.status != Invite.Status.PENDING or invite.is_expired:
        return None
    return invite
