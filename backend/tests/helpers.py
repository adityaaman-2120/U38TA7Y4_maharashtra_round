import base64
import re

from django.core import mail
from django.core.cache import cache
from django.test import TestCase
from eth_account import Account
from eth_account.messages import encode_defunct
from rest_framework.test import APIClient

ORIGIN = "http://localhost:3000"


def make_blob(account, public_key=None, ct_len=48, iterations=600_000):
    """A well-formed sealed key blob (the server cannot tell it from a real one, and must not need to)."""
    b64 = lambda n: base64.b64encode(b"\x01" * n).decode()
    return {
        "v": 1,
        "address": account.address.lower(),
        "publicKey": public_key or "0x04" + "ab" * 64,
        "kdf": {"name": "PBKDF2-SHA256", "iterations": iterations, "salt": b64(16)},
        "cipher": {"name": "AES-256-GCM", "iv": b64(12), "ct": b64(ct_len)},
    }


def sign_in(client: APIClient, account, chain_id=31337) -> dict:
    r = client.post("/api/auth/nonce", {"address": account.address, "chain_id": chain_id, "uri": ORIGIN}, format="json")
    assert r.status_code == 200, r.content
    sig = Account.sign_message(encode_defunct(text=r.json()["message"]), account.key).signature.hex()
    r = client.post("/api/auth/verify", {"address": account.address, "signature": "0x" + sig.removeprefix("0x")}, format="json")
    assert r.status_code == 200, r.content
    return r.json()


def invite_token_from_mail() -> str:
    body = mail.outbox[-1].body
    return re.search(r"/invite/(\S+)", body).group(1)


class ApiTest(TestCase):
    def setUp(self):
        cache.clear()  # nonces and throttle counters live in the cache

    def client_for(self, account, **profile):
        c = APIClient()
        sign_in(c, account)
        if profile:
            r = c.put("/api/me", profile, format="json")
            assert r.status_code == 200, r.content
        return c
