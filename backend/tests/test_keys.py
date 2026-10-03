from eth_account import Account
from rest_framework.test import APIClient

from keys.models import EncryptedKeyBlob

from .helpers import ApiTest, make_blob

ALICE = Account.create()
BOB = Account.create()


class KeyBlobTests(ApiTest):
    def test_roundtrip(self):
        c = self.client_for(ALICE)
        self.assertEqual(c.get("/api/key-blob").status_code, 404)
        blob = make_blob(ALICE)
        r = c.put("/api/key-blob", {"blob": blob}, format="json")
        self.assertEqual(r.status_code, 201)
        r = c.get("/api/key-blob")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["blob"], blob)
        self.assertTrue(c.get("/api/me").json()["has_key"])

    def test_reseal_same_key_allowed_different_key_refused(self):
        c = self.client_for(ALICE)
        c.put("/api/key-blob", {"blob": make_blob(ALICE)}, format="json")
        again = make_blob(ALICE)
        again["cipher"]["ct"] = "AgIC" * 16  # new ciphertext for the same key (password change)
        self.assertEqual(c.put("/api/key-blob", {"blob": again}, format="json").status_code, 200)
        other = make_blob(ALICE, public_key="0x04" + "cd" * 64)
        self.assertEqual(c.put("/api/key-blob", {"blob": other}, format="json").status_code, 409)
        self.assertEqual(EncryptedKeyBlob.objects.get().public_key, "0x04" + "ab" * 64)

    def test_cannot_store_someone_elses_blob(self):
        c = self.client_for(ALICE)
        self.assertEqual(c.put("/api/key-blob", {"blob": make_blob(BOB)}, format="json").status_code, 400)

    def test_users_only_see_their_own_blob(self):
        a, b = self.client_for(ALICE), self.client_for(BOB)
        a.put("/api/key-blob", {"blob": make_blob(ALICE)}, format="json")
        self.assertEqual(b.get("/api/key-blob").status_code, 404)

    def test_requires_authentication(self):
        self.assertEqual(APIClient().get("/api/key-blob").status_code, 401)
        self.assertEqual(APIClient().put("/api/key-blob", {"blob": make_blob(ALICE)}, format="json").status_code, 401)

    def test_rejects_anything_that_is_not_a_sealed_blob(self):
        c = self.client_for(ALICE)
        good = make_blob(ALICE)

        def mutate(fn):
            b = make_blob(ALICE)
            fn(b)
            return c.put("/api/key-blob", {"blob": b}, format="json").status_code

        self.assertEqual(mutate(lambda b: b["cipher"].update(ct="AQ" * 16 + "==")), 400)  # 32 bytes: a raw private key, no GCM tag
        self.assertEqual(mutate(lambda b: b.update(privateKey="0x" + "11" * 32)), 400)  # extra field
        self.assertEqual(mutate(lambda b: b.update(v=2)), 400)
        self.assertEqual(mutate(lambda b: b["kdf"].update(iterations=1000)), 400)  # weak KDF
        self.assertEqual(mutate(lambda b: b["kdf"].update(iterations=10**9)), 400)
        self.assertEqual(mutate(lambda b: b["kdf"].update(name="scrypt")), 400)
        self.assertEqual(mutate(lambda b: b["cipher"].update(iv="AAAA")), 400)
        self.assertEqual(mutate(lambda b: b.update(publicKey="0x04abcd")), 400)
        self.assertEqual(mutate(lambda b: b["cipher"].update(ct="not base64!!")), 400)
        for bad in ("string", 5, None, []):
            self.assertEqual(c.put("/api/key-blob", {"blob": bad}, format="json").status_code, 400)
        self.assertEqual(c.put("/api/key-blob", {"blob": good}, format="json").status_code, 201)  # control
