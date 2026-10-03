import json
import tempfile
from pathlib import Path

from django.test import override_settings
from eth_account import Account
from rest_framework.test import APIClient

from notifications.models import Notification

from .chainfake import CFG, FakeChain, addr, ingest, raise_claim, scenario
from .helpers import ApiTest

ME = Account.create()


class EventsApiTests(ApiTest):
    def setUp(self):
        super().setUp()
        self.tmp = tempfile.TemporaryDirectory()
        (Path(self.tmp.name) / "deployments.json").write_text(json.dumps({str(CFG.chain_id): {"address": CFG.address, "startBlock": 1}}))
        self.settings_ctx = override_settings(CHAIN_DIR=Path(self.tmp.name), CELERY_TASK_ALWAYS_EAGER=True)
        self.settings_ctx.enable()
        self.o, self.g1, self.g2, self.g3, self.b = (addr() for _ in range(5))
        self.chain = FakeChain()
        scenario(self.chain, self.o, [self.g1, self.g2, self.g3], self.b)
        raise_claim(self.chain, self.b, 5)
        self.chain.emit("Attested", {"claimId": 1, "guardian": self.g1, "approvals": 1}, 6, self.g1)
        raise_claim(self.chain, self.b, 7, claim_id=2)  # a second claim, same asset
        ingest(self.chain)
        self.client = self.client_for(ME, name="Me", email="me@x.io")

    def tearDown(self):
        self.settings_ctx.disable()
        self.tmp.cleanup()

    def get(self, **params):
        r = self.client.get("/api/events", params)
        self.assertEqual(r.status_code, 200, r.content)
        return r.json()

    def test_requires_authentication(self):
        self.assertEqual(APIClient().get("/api/events").status_code, 401)

    def test_lists_newest_first_with_decoded_args(self):
        body = self.get()
        names = [e["event_name"] for e in body["results"]]
        self.assertEqual(names, ["ClaimRaised", "Attested", "ClaimRaised", "AssetAdded", "VaultCreated"])
        raised = body["results"][2]
        self.assertEqual((raised["claim_id"], raised["asset_id"], raised["block_number"]), (1, 0, 5))
        self.assertEqual(raised["args"]["claimant"], self.b)
        self.assertEqual(raised["actor"].lower(), self.b.lower())
        self.assertIsInstance(raised["timestamp"], int)

    def test_filters(self):
        self.assertEqual({e["claim_id"] for e in self.get(claim_id=1)["results"]}, {1})
        self.assertEqual(len(self.get(asset_id=0)["results"]), 4)  # the asset itself plus every claim event on it (claim events carry their asset)
        self.assertEqual([e["event_name"] for e in self.get(event="Attested")["results"]], ["Attested"])
        by_guardian = [e["event_name"] for e in self.get(actor=self.g1)["results"]]
        self.assertEqual(by_guardian, ["Attested", "VaultCreated"])  # sent the Attested tx, and is named in the vault
        self.assertEqual(self.get(actor=self.b.lower())["results"][0]["event_name"], "ClaimRaised")
        self.assertEqual(self.client.get("/api/events", {"actor": "nope"}).status_code, 400)
        self.assertEqual(self.get(chain_id=1)["results"], [])

    def test_pagination(self):
        first = self.get(limit=2)
        self.assertEqual(len(first["results"]), 2)
        self.assertIsNotNone(first["next_before_id"])
        second = self.get(limit=2, before_id=first["next_before_id"])
        third = self.get(limit=2, before_id=second["next_before_id"])
        ids = [e["id"] for p in (first, second, third) for e in p["results"]]
        self.assertEqual(len(ids), 5)
        self.assertEqual(len(set(ids)), 5)
        self.assertIsNone(third["next_before_id"])
        self.assertEqual(len(self.get(limit=9999)["results"]), 5)  # limit is capped, not an error

    def test_reports_indexer_progress(self):
        state = self.get()["indexer"]
        self.assertEqual(len(state), 1)
        self.assertEqual((state[0]["chain_id"], state[0]["last_block"], state[0]["lag_blocks"], state[0]["stale"]), (CFG.chain_id, 7, 0, False))

    def test_old_deployments_are_hidden(self):
        (Path(self.tmp.name) / "deployments.json").write_text(json.dumps({str(CFG.chain_id): {"address": "0x" + "dd" * 20, "startBlock": 1}}))
        self.assertEqual(self.get()["results"], [])


class NotificationApiTests(ApiTest):
    def setUp(self):
        super().setUp()
        self.alice, self.bob = Account.create(), Account.create()
        self.a = self.client_for(self.alice, name="Alice", email="alice@x.io")
        self.b = self.client_for(self.bob, name="Bob", email="bob@x.io")
        from accounts.models import User

        self.ua, self.ub = User.objects.get(address=self.alice.address.lower()), User.objects.get(address=self.bob.address.lower())
        for i in range(3):
            Notification.objects.create(user=self.ua, kind="k", title=f"A{i}", body="b", dedupe_key=f"a{i}", urgent=i == 2, view="guardian", claim_id=i)
        Notification.objects.create(user=self.ub, kind="k", title="B0", body="b", dedupe_key="b0")

    def test_requires_authentication(self):
        self.assertEqual(APIClient().get("/api/notifications").status_code, 401)
        self.assertEqual(APIClient().post("/api/notifications/read", {"all": True}, format="json").status_code, 401)

    def test_lists_only_my_notifications_newest_first(self):
        r = self.a.get("/api/notifications").json()
        self.assertEqual([n["title"] for n in r["results"]], ["A2", "A1", "A0"])
        self.assertEqual(r["unread_count"], 3)
        self.assertEqual((r["results"][0]["urgent"], r["results"][0]["view"], r["results"][0]["read"]), (True, "guardian", False))
        self.assertEqual([n["title"] for n in self.b.get("/api/notifications").json()["results"]], ["B0"])

    def test_mark_read_by_id_and_all(self):
        ids = [n["id"] for n in self.a.get("/api/notifications").json()["results"]]
        r = self.a.post("/api/notifications/read", {"ids": ids[:1]}, format="json").json()
        self.assertEqual((r["updated"], r["unread_count"]), (1, 2))
        self.assertEqual([n["title"] for n in self.a.get("/api/notifications?unread=1").json()["results"]], ["A1", "A0"])
        r = self.a.post("/api/notifications/read", {"all": True}, format="json").json()
        self.assertEqual((r["updated"], r["unread_count"]), (2, 0))
        self.assertEqual(self.a.post("/api/notifications/read", {"all": True}, format="json").json()["updated"], 0)

    def test_cannot_touch_someone_elses_notifications(self):
        bobs = self.b.get("/api/notifications").json()["results"][0]["id"]
        r = self.a.post("/api/notifications/read", {"ids": [bobs]}, format="json").json()
        self.assertEqual(r["updated"], 0)
        self.assertEqual(self.b.get("/api/notifications").json()["unread_count"], 1)

    def test_rejects_malformed_bodies(self):
        for bad in ({}, {"ids": "1"}, {"ids": [1, "2"]}, {"ids": [True]}, {"all": "yes"}, {"ids": list(range(500))}):
            self.assertEqual(self.a.post("/api/notifications/read", bad, format="json").status_code, 400, bad)
