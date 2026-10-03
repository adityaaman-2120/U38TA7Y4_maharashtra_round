from unittest import mock

from django.core.cache import cache
from eth_account import Account
from eth_account.messages import encode_defunct
from rest_framework.test import APIClient
from rest_framework.throttling import ScopedRateThrottle

from accounts.models import User

from .helpers import ORIGIN, ApiTest, sign_in

ALICE = Account.create()
MALLORY = Account.create()


def challenge(client, account, **over):
    body = {"address": account.address, "chain_id": 31337, "uri": ORIGIN, **over}
    return client.post("/api/auth/nonce", body, format="json")


def sign(account, message):
    return "0x" + Account.sign_message(encode_defunct(text=message), account.key).signature.hex().removeprefix("0x")


class SiweTests(ApiTest):
    def test_full_sign_in_sets_httponly_cookie_and_creates_user(self):
        c = APIClient()
        r = challenge(c, ALICE)
        self.assertEqual(r.status_code, 200)
        msg = r.json()["message"]
        self.assertIn("wants you to sign in with your Ethereum account", msg)
        self.assertIn(ALICE.address, msg)
        self.assertIn("localhost:3000", msg)
        self.assertIn("Chain ID: 31337", msg)
        r = c.post("/api/auth/verify", {"address": ALICE.address, "signature": sign(ALICE, msg)}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["address"], ALICE.address)
        self.assertFalse(r.json()["profile_complete"])
        cookie = r.cookies["heirloom_session"]
        self.assertTrue(cookie["httponly"])
        self.assertEqual(cookie["samesite"], "Lax")
        self.assertNotIn(cookie.value, str(r.json()))  # token only ever travels in the cookie
        self.assertEqual(User.objects.get(address=ALICE.address.lower()).address, ALICE.address.lower())
        self.assertEqual(c.get("/api/me").status_code, 200)

    def test_nonce_is_single_use(self):
        c = APIClient()
        msg = challenge(c, ALICE).json()["message"]
        sig = sign(ALICE, msg)
        self.assertEqual(c.post("/api/auth/verify", {"address": ALICE.address, "signature": sig}, format="json").status_code, 200)
        self.assertEqual(APIClient().post("/api/auth/verify", {"address": ALICE.address, "signature": sig}, format="json").status_code, 401)

    def test_signature_by_wrong_key_is_rejected(self):
        c = APIClient()
        msg = challenge(c, ALICE).json()["message"]
        r = c.post("/api/auth/verify", {"address": ALICE.address, "signature": sign(MALLORY, msg)}, format="json")
        self.assertEqual(r.status_code, 401)
        self.assertNotIn("heirloom_session", r.cookies)
        self.assertFalse(User.objects.exists())

    def test_cannot_sign_a_different_message(self):
        c = APIClient()
        challenge(c, ALICE)
        r = c.post("/api/auth/verify", {"address": ALICE.address, "signature": sign(ALICE, "something else")}, format="json")
        self.assertEqual(r.status_code, 401)

    def test_verify_without_challenge_fails(self):
        r = APIClient().post("/api/auth/verify", {"address": ALICE.address, "signature": sign(ALICE, "x")}, format="json")
        self.assertEqual(r.status_code, 401)

    def test_challenge_cannot_be_used_for_another_address(self):
        c = APIClient()
        msg = challenge(c, ALICE).json()["message"]
        r = c.post("/api/auth/verify", {"address": MALLORY.address, "signature": sign(MALLORY, msg)}, format="json")
        self.assertEqual(r.status_code, 401)  # Mallory has no pending challenge

    def test_expired_challenge_fails(self):
        c = APIClient()
        msg = challenge(c, ALICE).json()["message"]
        cache.clear()  # what TTL expiry does
        r = c.post("/api/auth/verify", {"address": ALICE.address, "signature": sign(ALICE, msg)}, format="json")
        self.assertEqual(r.status_code, 401)

    def test_input_validation(self):
        c = APIClient()
        self.assertEqual(challenge(c, ALICE, address="0x123").status_code, 400)
        self.assertEqual(challenge(c, ALICE, address=ALICE.address.lower().replace("0x", "0X")).status_code, 400)
        self.assertEqual(challenge(c, ALICE, chain_id=1).status_code, 400)
        self.assertEqual(challenge(c, ALICE, uri="https://evil.example").status_code, 400)
        idx = next(j for j, ch in enumerate(ALICE.address) if j > 2 and ch.isalpha())
        mixed = ALICE.address[:idx] + ALICE.address[idx].swapcase() + ALICE.address[idx + 1:]
        self.assertEqual(challenge(c, ALICE, address=mixed).status_code, 400)  # broken EIP-55 checksum
        self.assertEqual(c.post("/api/auth/verify", {"address": ALICE.address, "signature": "0x12"}, format="json").status_code, 400)

    def test_logout_revokes_the_session(self):
        c = APIClient()
        sign_in(c, ALICE)
        stolen = c.cookies["heirloom_session"].value
        self.assertEqual(c.post("/api/auth/logout").status_code, 204)
        thief = APIClient()
        thief.cookies["heirloom_session"] = stolen
        self.assertEqual(thief.get("/api/me").status_code, 401)  # the old JWT is dead even though it has not expired

    def test_tampered_or_missing_token(self):
        self.assertEqual(APIClient().get("/api/me").status_code, 401)
        c = APIClient()
        sign_in(c, ALICE)
        c.cookies["heirloom_session"] = c.cookies["heirloom_session"].value[:-3] + "abc"
        self.assertEqual(c.get("/api/me").status_code, 401)

    def test_alg_none_token_is_rejected(self):
        import base64
        import json
        enc = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()
        c = APIClient()
        sign_in(c, ALICE)
        user = User.objects.get()
        forged = f"{enc({'alg': 'none', 'typ': 'JWT'})}.{enc({'sub': str(user.pk), 'sv': 0, 'exp': 9999999999})}."
        c2 = APIClient()
        c2.cookies["heirloom_session"] = forged
        self.assertEqual(c2.get("/api/me").status_code, 401)

    def test_origin_check_blocks_cross_site_writes(self):
        c = self.client_for(ALICE)
        r = c.put("/api/me", {"name": "A", "email": "a@x.io"}, format="json", HTTP_ORIGIN="https://evil.example")
        self.assertEqual(r.status_code, 403)
        r = c.put("/api/me", {"name": "A", "email": "a@x.io"}, format="json", HTTP_ORIGIN=ORIGIN)
        self.assertEqual(r.status_code, 200)

    def test_rate_limits(self):
        rates = dict(ScopedRateThrottle.THROTTLE_RATES, auth_nonce="3/min", auth_verify="2/min")
        with mock.patch.object(ScopedRateThrottle, "THROTTLE_RATES", rates):
            c = APIClient()
            codes = [challenge(c, ALICE).status_code for _ in range(5)]
            self.assertEqual(codes[:3], [200, 200, 200])
            self.assertEqual(codes[3:], [429, 429])
            bad = [c.post("/api/auth/verify", {"address": ALICE.address, "signature": "0x" + "0" * 130}, format="json").status_code for _ in range(3)]
            self.assertEqual(bad, [401, 401, 429])


class ProfileTests(ApiTest):
    def test_update_and_validation(self):
        c = self.client_for(ALICE)
        r = c.put("/api/me", {"name": " Alice ", "email": "Alice@Example.COM", "phone": "+91 98765 43210"}, format="json")
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual((body["name"], body["email"], body["phone"]), ("Alice", "alice@example.com", "+91 98765 43210"))
        self.assertTrue(body["profile_complete"])
        for bad in ({"name": "", "email": "a@b.co"}, {"name": "A", "email": "nope"}, {"name": "A", "email": "a@b.co", "phone": "abc"}):
            self.assertEqual(c.put("/api/me", bad, format="json").status_code, 400)

    def test_requires_authentication(self):
        self.assertEqual(APIClient().put("/api/me", {"name": "A", "email": "a@b.co"}, format="json").status_code, 401)
