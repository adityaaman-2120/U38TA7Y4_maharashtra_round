"""Sign-In With Ethereum (EIP-4361) with server-side nonce storage.

The server builds the exact message, stores it under the address, and later verifies that the signature is
over *that* message. This avoids parsing client-supplied messages entirely.
"""
import secrets
from datetime import datetime, timedelta, timezone

from django.conf import settings
from django.core.cache import cache
from eth_account import Account
from eth_account.messages import encode_defunct


def _key(address: str) -> str:
    return f"siwe:nonce:{address}"


def issue_challenge(address: str, domain: str, uri: str, chain_id: int) -> dict:
    """Creates a single-use challenge for `address` (lower-case) and returns the message to sign."""
    nonce = secrets.token_hex(16)
    issued = datetime.now(timezone.utc).replace(microsecond=0)
    expires = issued + timedelta(seconds=settings.SIWE_NONCE_TTL_SECONDS)
    from .addresses import checksum

    message = (
        f"{domain} wants you to sign in with your Ethereum account:\n"
        f"{checksum(address)}\n\n"
        f"{settings.SIWE_STATEMENT}\n\n"
        f"URI: {uri}\n"
        "Version: 1\n"
        f"Chain ID: {chain_id}\n"
        f"Nonce: {nonce}\n"
        f"Issued At: {issued.isoformat().replace('+00:00', 'Z')}\n"
        f"Expiration Time: {expires.isoformat().replace('+00:00', 'Z')}"
    )
    cache.set(_key(address), message, timeout=settings.SIWE_NONCE_TTL_SECONDS)  # a new challenge replaces any old one
    return {"nonce": nonce, "message": message}


def consume_and_verify(address: str, signature: str) -> bool:
    """True only if `signature` is by `address` over the pending challenge. The challenge is single-use."""
    key = _key(address)
    message = cache.get(key)
    if message is None:
        return False
    if not cache.delete(key):  # lost a race with another request using the same nonce
        return False
    try:
        recovered = Account.recover_message(encode_defunct(text=message), signature=signature)
    except Exception:
        return False
    return recovered.lower() == address
