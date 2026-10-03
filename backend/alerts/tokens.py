from django.core import signing

from .models import AlertLink

SALT = "heirloom.alive.v1"


def make_token(link: AlertLink) -> str:
    """Signed and carrying only the link id: no address, name or claim data."""
    return signing.dumps({"l": str(link.id)}, salt=SALT, compress=False)


def resolve_token(token: str) -> AlertLink | None:
    """The link row a token names, if the signature is authentic. Expiry and use are judged by the caller."""
    try:
        data = signing.loads(token, salt=SALT)
        return AlertLink.objects.select_related("escalation", "user").get(pk=data["l"])
    except (signing.BadSignature, AlertLink.DoesNotExist, KeyError, ValueError, TypeError):
        return None
