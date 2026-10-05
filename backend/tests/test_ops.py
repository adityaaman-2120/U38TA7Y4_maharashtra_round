import json
import tempfile
import time
from pathlib import Path
from unittest import mock

from django.core import mail
from django.core.cache import cache
from django.db import connection
from django.test import Client, TestCase, override_settings
from django.utils import timezone

from alerts.models import AlertLog
from alerts.sms import TwilioBackend
from indexer.chains import load_chains
from indexer.models import ChainEvent
from indexer.service import index_chain
from notifications import delivery
from notifications.models import Notification
from ops.models import TickLock
from ops.tick import run_tick

from .chainfake import CFG, T0, FakeChain, addr, raise_claim, scenario, user

SECRET = "tick-secret-for-tests"


def chain_dir(files: dict) -> Path:
    d = tempfile.mkdtemp(prefix="heirloom-chain-")
    for name, body in files.items():
        (Path(d) / name).write_text(json.dumps(body), encoding="utf-8")
    return Path(d)


DEPLOY = {"31337": {"address": CFG.address, "startBlock": 1}}


@override_settings(TICK_SECRET=SECRET)
class TickEndpointTests(TestCase):
    def setUp(self):
        self.c = Client()

    def post(self, secret=None):
        h = {"HTTP_X_TICK_SECRET": secret} if secret is not None else {}
        return self.c.post("/internal/tick", **h)

    def test_requires_the_secret_header(self):
        self.assertEqual(self.post().status_code, 403)
        self.assertEqual(self.post("").status_code, 403)
        self.assertEqual(self.post("wrong").status_code, 403)
        self.assertEqual(self.post(SECRET + "x").status_code, 403)
        self.assertEqual(TickLock.objects.count(), 0)  # a forbidden call does not even touch the lease

    def test_only_post(self):
        self.assertEqual(self.c.get("/internal/tick", HTTP_X_TICK_SECRET=SECRET).status_code, 405)

    @override_settings(TICK_SECRET="")
    def test_is_disabled_until_a_secret_is_configured(self):
        self.assertEqual(self.post("anything").status_code, 503)
        self.assertEqual(self.post("").status_code, 503)

    def test_the_secret_is_compared_in_constant_time(self):
        with mock.patch("ops.views.hmac.compare_digest", return_value=False) as cmp:
            self.assertEqual(self.post("x").status_code, 403)
        cmp.assert_called_once()

    @override_settings(CHAIN_DIR=Path(tempfile.mkdtemp()))
    def test_a_good_call_runs_every_stage_and_reports_counts_only(self):
        r = self.post(SECRET)
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertTrue(body["ok"])
        for stage in ("index", "notify", "reminders", "escalations", "email_retries"):
            self.assertIn(stage, body)
        self.assertEqual(TickLock.objects.get().locked_until, None)  # released


@override_settings(CHAIN_DIR=chain_dir({"deployments.json": DEPLOY}), TICK_SECRET=SECRET)
class TickTests(TestCase):
    def setUp(self):
        cache.clear()
        self.o, self.g1, self.g2, self.g3, self.b = (addr() for _ in range(5))
        user(self.o, "Olivia Owner", "olivia@x.io")
        user(self.g1, "Gary One", "g1@x.io")
        user(self.g2, "Gina Two", "g2@x.io")
        user(self.g3, "Gus Three", "g3@x.io")
        user(self.b, "Bea Beneficiary", "bea@x.io")
        self.chain = FakeChain()
        scenario(self.chain, self.o, [self.g1, self.g2, self.g3], self.b)
        raise_claim(self.chain, self.b, 5)
        for target in ("indexer.runner.Web3Client", "indexer.clients.get_client", "alerts.service.get_client"):
            p = mock.patch(target, return_value=self.chain)
            p.start()
            self.addCleanup(p.stop)
        mail.outbox.clear()

    def test_indexes_notifies_and_emails_the_owner_once(self):
        first = run_tick()
        self.assertEqual(first["index"][31337]["events"], 3)
        self.assertEqual(ChainEvent.objects.count(), 3)
        owner_mail = [m for m in mail.outbox if m.to == ["olivia@x.io"]]
        self.assertEqual(len(owner_mail), 1)
        self.assertIn("/alive?claim=1", owner_mail[0].body)
        self.assertEqual(len([m for m in mail.outbox if m.to in (["g1@x.io"], ["g2@x.io"], ["g3@x.io"])]), 3)
        sent = len(mail.outbox)
        for _ in range(3):  # a cron retry, a double call, a replay: nothing is sent twice
            run_tick()
        self.assertEqual(len(mail.outbox), sent)
        self.assertEqual(ChainEvent.objects.count(), 3)
        self.assertEqual(AlertLog.objects.filter(kind="owner_claim_raised").count(), 1)

    def test_a_second_overlapping_call_does_nothing(self):
        inner = {}

        def reenter(*a, **k):
            inner.update(run_tick())  # the lease is held, so this must return at once
            return 0

        with mock.patch("notifications.notify.process_pending_events", side_effect=reenter):
            outer = run_tick()
        self.assertEqual(inner, {"skipped": "another tick is running"})
        self.assertEqual(outer["notify"], 0)
        self.assertIsNone(TickLock.objects.get().locked_until)

    def test_a_held_lease_blocks_until_it_expires(self):
        TickLock.objects.create(pk=1, locked_until=timezone.now() + timezone.timedelta(seconds=30))
        self.assertEqual(run_tick(), {"skipped": "another tick is running"})
        self.assertEqual(ChainEvent.objects.count(), 0)
        TickLock.objects.update(locked_until=timezone.now() - timezone.timedelta(seconds=1))  # a crashed run's lease runs out
        self.assertNotIn("skipped", run_tick())

    def test_one_failing_stage_does_not_stop_the_others_or_leak_details(self):
        with mock.patch("notifications.notify.process_pending_events", side_effect=RuntimeError("boom with olivia@x.io")):
            r = run_tick()
        self.assertEqual(r["notify"], {"error": "RuntimeError"})
        self.assertNotIn("olivia", json.dumps(r))
        self.assertIn("reminders", r)
        self.assertIsNone(TickLock.objects.get().locked_until)  # still released
        self.assertGreater(ChainEvent.objects.count(), 0)  # indexing ran before it

    def test_stages_are_skipped_when_the_time_budget_is_spent(self):
        r = run_tick(budget=-1)
        self.assertTrue(all(str(r[s]).startswith("skipped") for s in ("index", "notify", "reminders", "escalations", "email_retries")))

    def test_a_failed_email_is_retried_on_a_later_tick(self):
        with mock.patch("notifications.emails.send_mail", side_effect=OSError("provider down")):
            run_tick()
        pending = Notification.objects.filter(email_sent_at__isnull=True, user__email__in=["g1@x.io", "g2@x.io", "g3@x.io", "bea@x.io"])
        self.assertTrue(pending.exists())
        mail.outbox.clear()
        r = run_tick()
        self.assertGreater(r["email_retries"], 0)
        self.assertFalse(Notification.objects.filter(user__email="g1@x.io", email_sent_at__isnull=True).exists())
        self.assertTrue(any(m.to == ["g1@x.io"] for m in mail.outbox))

    def test_retries_stop_after_the_attempt_limit(self):
        run_tick()
        n = Notification.objects.filter(user__email="g1@x.io").get()
        Notification.objects.filter(pk=n.pk).update(email_sent_at=None, email_attempts=6)
        mail.outbox.clear()
        self.assertEqual(delivery.retry_unsent(), 0)
        self.assertEqual(mail.outbox, [])


class IndexerBudgetTests(TestCase):
    def test_a_past_deadline_stops_before_the_first_chunk(self):
        chain = FakeChain()
        scenario(chain, addr(), [addr(), addr(), addr()], addr())
        chain.head_n = 5
        result = index_chain(CFG, chain, deadline=time.monotonic() - 1)
        self.assertEqual(result.events, 0)
        self.assertEqual(ChainEvent.objects.count(), 0)
        again = index_chain(CFG, chain)  # nothing was lost: the next run continues
        self.assertEqual(again.events, 2)


class ChainConfigTests(TestCase):
    def test_public_networks_and_the_local_chain_come_from_separate_files(self):
        d = chain_dir({
            "deployments.json": {"80002": {"address": "0x" + "A1" * 20, "startBlock": 10}},
            "deployments.local.json": {"31337": {"address": "0x" + "B2" * 20, "startBlock": 3}},
        })
        with override_settings(CHAIN_DIR=d, ACTIVE_CHAIN_IDS=[]):
            self.assertEqual(sorted(c.chain_id for c in load_chains()), [31337, 80002])
        with override_settings(CHAIN_DIR=d, ACTIVE_CHAIN_IDS=[80002]):
            (c,) = load_chains()
            self.assertEqual((c.chain_id, c.address, c.start_block), (80002, "0x" + "a1" * 20, 10))

    def test_per_chain_log_endpoint_and_chunk_size(self):
        d = chain_dir({"deployments.json": {"80002": {"address": "0x" + "a1" * 20, "startBlock": 10}}})
        with override_settings(CHAIN_DIR=d, LOGS_RPC_URLS={80002: "https://logs.example"}, INDEX_CHUNK_BLOCKS_BY_CHAIN={80002: 10}):
            (c,) = load_chains()
        self.assertEqual((c.logs_rpc_url, c.chunk_blocks), ("https://logs.example", 10))


@override_settings(CHAIN_DIR=chain_dir({"deployments.json": {"80002": {"address": "0x" + "a1" * 20, "startBlock": 1}}}))
class HealthTests(TestCase):
    def test_ok_when_the_database_and_rpc_answer(self):
        with mock.patch("ops.views._rpc_up", return_value=True):
            r = Client().get("/health")
        self.assertEqual((r.status_code, r.json()), (200, {"status": "ok", "db": True, "rpc": {"80002": True}}))
        self.assertEqual(Client().get("/api/health").status_code, 200)  # the old path still works

    def test_a_dead_rpc_is_reported_but_does_not_fail_the_check(self):
        with mock.patch("ops.views._rpc_up", return_value=False):
            r = Client().get("/health")
        self.assertEqual((r.status_code, r.json()["status"], r.json()["rpc"]), (200, "degraded", {"80002": False}))

    def test_a_dead_database_fails_it(self):
        with mock.patch.object(connection, "cursor", side_effect=RuntimeError("db down")), mock.patch("ops.views._rpc_up", return_value=True):
            r = Client().get("/health")
        self.assertEqual((r.status_code, r.json()["status"], r.json()["db"]), (503, "down", False))


@override_settings(RESEND_API_KEY="re_test", DEFAULT_FROM_EMAIL="Heirloom <onboarding@resend.dev>")
class ResendBackendTests(TestCase):
    def send(self, **kw):
        from notifications.resend_backend import ResendEmailBackend

        msg = mail.EmailMessage("Subject", "Body text", None, ["someone@x.io"])
        return ResendEmailBackend(**kw).send_messages([msg])

    def test_posts_to_the_resend_api(self):
        with mock.patch("notifications.resend_backend.requests.post", return_value=mock.Mock(status_code=200)) as post:
            self.assertEqual(self.send(), 1)
        args, kwargs = post.call_args
        self.assertEqual(args[0], "https://api.resend.com/emails")
        self.assertEqual(kwargs["headers"]["Authorization"], "Bearer re_test")
        self.assertEqual(kwargs["json"], {"from": "Heirloom <onboarding@resend.dev>", "to": ["someone@x.io"], "subject": "Subject", "text": "Body text"})

    def test_a_rejected_send_raises_without_echoing_the_address(self):
        with mock.patch("notifications.resend_backend.requests.post", return_value=mock.Mock(status_code=403, text="to someone@x.io not allowed")):
            with self.assertRaises(RuntimeError) as cm:
                self.send()
        self.assertEqual(str(cm.exception), "resend_status:403")
        self.assertEqual(self.send_silently(), 0)

    def send_silently(self):
        with mock.patch("notifications.resend_backend.requests.post", side_effect=OSError("network")):
            return self.send(fail_silently=True)

    @override_settings(RESEND_API_KEY="")
    def test_no_key_no_send(self):
        with self.assertRaises(RuntimeError):
            self.send()


class SmsGateTests(TestCase):
    @override_settings(SMS_ENABLED=False, TWILIO_ACCOUNT_SID="AC1", TWILIO_AUTH_TOKEN="t", TWILIO_FROM_NUMBER="+1555")
    def test_off_unless_explicitly_enabled(self):
        self.assertFalse(TwilioBackend().available())

    @override_settings(SMS_ENABLED=True, TWILIO_ACCOUNT_SID="AC1", TWILIO_AUTH_TOKEN="t", TWILIO_FROM_NUMBER="+1555")
    def test_on_when_enabled_and_configured(self):
        self.assertTrue(TwilioBackend().available())

    @override_settings(SMS_ENABLED=True, TWILIO_ACCOUNT_SID="", TWILIO_AUTH_TOKEN="", TWILIO_FROM_NUMBER="")
    def test_enabled_but_unconfigured_is_still_off(self):
        self.assertFalse(TwilioBackend().available())


class DatabaseCacheTests(TestCase):
    def test_nonces_and_counters_live_in_the_database_cache(self):
        from django.conf import settings

        self.assertEqual(settings.CACHES["default"]["BACKEND"], "django.core.cache.backends.db.DatabaseCache")
        cache.set("k", "v", timeout=60)
        self.assertEqual(cache.get("k"), "v")
        self.assertTrue(cache.delete("k"))
        self.assertFalse(cache.delete("k"))  # a nonce can be consumed exactly once


class ProductionSettingsTests(TestCase):
    def test_hosts_origins_and_cookies_are_locked_down(self):
        from django.conf import settings

        self.assertFalse(settings.DEBUG)
        self.assertTrue(settings.JWT_COOKIE_SECURE)
        self.assertEqual(settings.CORS_ALLOWED_ORIGINS, settings.ALLOWED_ORIGINS)
        self.assertEqual(settings.SECURE_HSTS_SECONDS, 31536000)
        self.assertTrue(settings.CORS_ALLOW_CREDENTIALS)
        self.assertEqual(T0, 1_700_000_000)  # (sanity: the fake chain clock the other tests rely on)
