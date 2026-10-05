import re
from unittest import mock
from urllib.parse import parse_qs, unquote, urlparse

from django.core import mail
from django.test import TestCase, override_settings
from django.utils import timezone
from eth_account import Account

from alerts import service
from alerts.models import AlertLink, AlertLog, AlertPreference, ClaimEscalation
from alerts.tokens import make_token
from indexer.models import ChainEvent, IndexerState
from notifications.models import Notification
from notifications.notify import process_pending_events

from .chainfake import CFG, EMPTY_CHAIN_DIR, T0, FakeChain, addr, ingest, raise_claim, scenario, user
from .fakes import FakeSms
from .helpers import ApiTest

OWNER_PHONE = "+919876543210"


def link_from(body: str) -> str:
    return re.search(r"https?://\S+/alive\?\S+", body).group(0)


@override_settings(CHAIN_DIR=EMPTY_CHAIN_DIR, SMS_BACKEND="tests.fakes.FakeSms")
class EscalationTests(TestCase):
    def setUp(self):
        FakeSms.sent, FakeSms.configured, FakeSms.fail = [], True, False
        self.o, self.g1, self.g2, self.g3, self.b = (addr() for _ in range(5))
        self.users = {
            "o": user(self.o, "Olivia Owner", "olivia@x.io"),
            "g1": user(self.g1, "Gary One", "g1@x.io"),
            "g2": user(self.g2, "Gina Two", "g2@x.io"),
            "g3": user(self.g3, "Gus Three", "g3@x.io"),
            "b": user(self.b, "Bea Beneficiary", "bea@x.io"),
        }
        self.chain = FakeChain()
        for target in ("alerts.service.get_client", "alerts.views.get_client"):
            p = mock.patch(target, return_value=self.chain)
            p.start()
            self.addCleanup(p.stop)
        p = mock.patch("indexer.chains.current_deployments", return_value=[(CFG.chain_id, CFG.address)])
        p.start()
        self.addCleanup(p.stop)
        scenario(self.chain, self.o, [self.g1, self.g2, self.g3], self.b)  # challenge period 600s
        ingest(self.chain)
        process_pending_events()
        mail.outbox.clear()

    def claim(self, block=5):
        raise_claim(self.chain, self.b, block)
        ingest(self.chain)
        process_pending_events()
        return ChainEvent.objects.get(event_name="ClaimRaised").timestamp

    def move_to(self, ts):
        self.chain.time_offset = ts - (T0 + self.chain.head_n * 10)
        ingest(self.chain)

    def mails_to(self, email):
        return [m for m in mail.outbox if m.to == [email]]

    def verify_phone(self, enable_sms=True):
        u = self.users["o"]
        u.phone, u.phone_verified_at = OWNER_PHONE, timezone.now()
        u.save()
        AlertPreference.objects.update_or_create(user=u, defaults=dict(sms_enabled=enable_sms))

    # ---- email, immediately -----------------------------------------------------------------

    def test_owner_gets_an_email_with_a_single_use_link_the_moment_a_claim_is_raised(self):
        raised_at = self.claim()
        (m,) = self.mails_to("olivia@x.io")
        self.assertTrue(m.subject.startswith("[Action needed]"))
        self.assertIn("Bea Beneficiary", m.body)
        link = link_from(m.body)
        q = parse_qs(urlparse(link).query)
        self.assertEqual(q["claim"], ["1"])
        esc = ClaimEscalation.objects.get()
        self.assertEqual((esc.claim_id, esc.owner, esc.raised_at, esc.ends_at), (1, self.o.lower(), raised_at, raised_at + 600))
        self.assertEqual(AlertLink.objects.get().channel, "email")
        self.assertTrue(unquote(q["t"][0]))
        # exactly one email to the owner (the generic notification email is replaced by this one), and the in-app item still exists
        self.assertTrue(Notification.objects.filter(user=self.users["o"], kind="claim_raised_owner").exists())
        self.assertEqual(AlertLog.objects.get(kind="owner_claim_raised").status, "sent")
        # nobody else receives a check-in link
        self.assertTrue(all("/alive?" not in m.body for m in mail.outbox if m.to != ["olivia@x.io"]))

    def test_never_twice_even_when_everything_runs_again(self):
        self.claim()
        ChainEvent.objects.update(processed=False)
        process_pending_events()
        service.run_all()
        service.run_all()
        self.assertEqual(len(self.mails_to("olivia@x.io")), 1)
        self.assertEqual(AlertLog.objects.filter(kind="owner_claim_raised").count(), 1)

    def test_email_alerts_can_be_turned_off_and_that_is_logged(self):
        AlertPreference.objects.create(user=self.users["o"], email_enabled=False)
        self.claim()
        self.assertEqual(self.mails_to("olivia@x.io"), [])
        row = AlertLog.objects.get(kind="owner_claim_raised")
        self.assertEqual((row.status, row.reason), ("skipped", "channel_disabled"))
        self.assertTrue(Notification.objects.filter(user=self.users["o"], kind="claim_raised_owner").exists())  # still in the app

    def test_a_failed_delivery_is_retried_by_the_periodic_task(self):
        with mock.patch("alerts.service.send_mail", side_effect=OSError("smtp down")):
            self.claim()
        row = AlertLog.objects.get(kind="owner_claim_raised")
        self.assertEqual((row.status, row.reason), ("failed", "delivery_error"))
        service.run_all()
        row.refresh_from_db()
        self.assertEqual((row.status, row.attempts), ("sent", 2))
        self.assertEqual(len(self.mails_to("olivia@x.io")), 1)

    def test_rpc_down_at_first_is_healed_later(self):
        self.chain.fail_policy = True
        self.claim()
        self.assertEqual(self.mails_to("olivia@x.io"), [])
        self.chain.fail_policy = False
        service.run_all()
        self.assertEqual(len(self.mails_to("olivia@x.io")), 1)

    # ---- SMS after the delay ----------------------------------------------------------------

    @override_settings(ALERT_SMS_AFTER_SECONDS=300)
    def test_sms_follows_after_the_delay_if_there_was_no_check_in(self):
        self.verify_phone()
        raised_at = self.claim()
        self.move_to(raised_at + 100)
        service.run_all()
        self.assertEqual(FakeSms.sent, [])  # too early
        self.move_to(raised_at + 400)
        service.run_all()
        ((to, body),) = FakeSms.sent
        self.assertEqual(to, OWNER_PHONE)
        self.assertIn("/alive?claim=1", body)
        self.assertEqual(len(AlertLink.objects.filter(channel="sms")), 1)  # its own single-use link
        service.run_all()
        self.assertEqual(len(FakeSms.sent), 1)  # once
        self.assertEqual(AlertLog.objects.get(kind="owner_claim_escalation").status, "sent")

    @override_settings(ALERT_SMS_AFTER_SECONDS=300)
    def test_sms_is_never_sent_to_an_unverified_number_or_when_off(self):
        u = self.users["o"]
        u.phone = OWNER_PHONE  # entered but not verified
        u.save()
        AlertPreference.objects.create(user=u, sms_enabled=True)
        raised_at = self.claim()
        self.move_to(raised_at + 400)
        service.run_all()
        self.assertEqual(FakeSms.sent, [])
        self.assertEqual(AlertLog.objects.get(kind="owner_claim_escalation").reason, "phone_unverified")
        AlertPreference.objects.filter(user=u).update(sms_enabled=False)
        service.run_all()
        self.assertEqual(AlertLog.objects.get(kind="owner_claim_escalation").reason, "channel_disabled")
        self.assertEqual(FakeSms.sent, [])
        # turning it on later (still before the challenge ends) does send
        u.phone_verified_at = timezone.now()
        u.save()
        AlertPreference.objects.filter(user=u).update(sms_enabled=True)
        service.run_all()
        self.assertEqual(len(FakeSms.sent), 1)

    @override_settings(ALERT_SMS_AFTER_SECONDS=300)
    def test_no_sms_after_a_check_in_or_after_the_challenge_ended(self):
        self.verify_phone()
        raised_at = self.claim()
        self.chain.emit("Heartbeat", {"owner": self.o, "timestamp": raised_at + 50}, 6, self.o)
        self.move_to(raised_at + 400)
        service.run_all()
        self.assertEqual(FakeSms.sent, [])
        self.assertIsNotNone(ClaimEscalation.objects.get().closed_at)

    @override_settings(ALERT_SMS_AFTER_SECONDS=300)
    def test_no_sms_once_the_link_would_already_be_dead(self):
        self.verify_phone()
        raised_at = self.claim()
        self.move_to(raised_at + 700)  # challenge (600s) is over
        service.run_all()
        self.assertEqual(FakeSms.sent, [])

    @override_settings(ALERT_SMS_AFTER_SECONDS=300)
    def test_sms_provider_failure_is_logged_and_retried(self):
        self.verify_phone()
        raised_at = self.claim()
        self.move_to(raised_at + 400)
        FakeSms.fail = True
        service.run_all()
        self.assertEqual(AlertLog.objects.get(kind="owner_claim_escalation").status, "failed")
        FakeSms.fail = False
        service.run_all()
        self.assertEqual(AlertLog.objects.get(kind="owner_claim_escalation").status, "sent")
        self.assertEqual(len(FakeSms.sent), 1)

    # ---- guardians before the end -----------------------------------------------------------

    @override_settings(ALERT_GUARDIAN_BEFORE_END_SECONDS=200)
    def test_guardians_who_have_not_responded_are_warned_before_the_challenge_ends_once(self):
        raised_at = self.claim()
        self.chain.emit("Attested", {"claimId": 1, "guardian": self.g1, "approvals": 1}, 6, self.g1)
        ingest(self.chain)
        mail.outbox.clear()
        self.move_to(raised_at + 300)  # 300s left: not yet inside the 200s window
        service.run_all()
        self.assertEqual([m for m in mail.outbox if "challenge period" in m.subject], [])
        self.move_to(raised_at + 450)  # 150s left
        service.run_all()
        warned = sorted(m.to[0] for m in mail.outbox if "challenge period" in m.subject)
        self.assertEqual(warned, ["g2@x.io", "g3@x.io"])  # g1 already responded
        self.assertTrue(Notification.objects.filter(kind="challenge_ending_guardian", user=self.users["g2"], urgent=True).exists())
        service.run_all()
        self.assertEqual(len([m for m in mail.outbox if "challenge period" in m.subject]), 2)
        self.assertEqual(AlertLog.objects.filter(kind="guardian_challenge_ending", status="sent").count(), 2)

    def test_with_the_default_24h_a_short_challenge_needs_no_extra_warning(self):
        raised_at = self.claim()
        mail.outbox.clear()
        self.move_to(raised_at + 500)
        service.run_all()
        self.assertEqual([m for m in mail.outbox if "challenge period" in m.subject], [])

    @override_settings(ALERT_GUARDIAN_BEFORE_END_SECONDS=200)
    def test_no_guardian_warning_for_a_cancelled_claim(self):
        raised_at = self.claim()
        self.chain.emit("ClaimCancelled", {"claimId": 1, "owner": self.o}, 6, self.o)
        ingest(self.chain)
        mail.outbox.clear()
        self.move_to(raised_at + 450)
        service.run_all()
        self.assertEqual([m for m in mail.outbox if "challenge period" in m.subject], [])

    # ---- the log ----------------------------------------------------------------------------

    @override_settings(ALERT_SMS_AFTER_SECONDS=300, ALERT_GUARDIAN_BEFORE_END_SECONDS=200)
    def test_the_log_and_log_output_hold_no_personal_data(self):
        self.verify_phone()
        with self.assertLogs(level="INFO") as captured:
            raised_at = self.claim()
            self.move_to(raised_at + 450)
            service.run_all()
        self.assertGreaterEqual(AlertLog.objects.filter(status="sent").count(), 4)  # owner email + sms, two guardians
        secrets = [OWNER_PHONE, "olivia@x.io", "g2@x.io", "bea@x.io", "Olivia", "Bea", self.o, self.o.lower(), "/alive?"]
        stored = " ".join(str(v) for row in AlertLog.objects.values() for v in row.values())
        lines = " ".join(captured.output)
        for s in secrets:
            self.assertNotIn(s, stored)
            self.assertNotIn(s, lines)
        self.assertIn("alert kind=owner_claim_raised channel=email status=sent", lines)


@override_settings(CHAIN_DIR=EMPTY_CHAIN_DIR, SMS_BACKEND="tests.fakes.FakeSms")
class AliveLinkTests(ApiTest):
    def setUp(self):
        super().setUp()
        self.chain = FakeChain()
        p = mock.patch("alerts.views.get_client", return_value=self.chain)
        p.start()
        self.addCleanup(p.stop)
        self.owner = Account.create()
        self.client_ = self.client_for(self.owner, name="Olivia", email="olivia@x.io")
        self.user = self.client_.handler  # noqa: F841  (the signed-in client is only needed to create the user row)
        from accounts.models import User

        self.u = User.objects.get(address=self.owner.address.lower())
        self.esc = ClaimEscalation.objects.create(chain_id=31337, address=CFG.address, claim_id=7, asset_id=2, owner=self.u.address, raised_at=1000, ends_at=1600)
        self.link = AlertLink.objects.create(escalation=self.esc, user=self.u, channel="email")
        self.token = make_token(self.link)
        IndexerState.objects.create(chain_id=31337, address=CFG.address, last_block=5, head_time=1100)

    def preview(self, **kw):
        from rest_framework.test import APIClient

        params = {"t": self.token, "claim": 7, **kw}
        return APIClient().get("/api/alive/preview", params)

    def consume(self, **kw):
        from rest_framework.test import APIClient

        return APIClient().post("/api/alive/consume", {"t": self.token, "claim": 7, **kw}, format="json")

    def test_preview_needs_no_login_and_exposes_only_what_the_page_needs(self):
        r = self.preview()
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), {"claim_id": 7, "asset_id": 2, "chain_id": 31337, "owner": self.owner.address, "ends_at": 1600})

    def test_forged_tampered_or_mismatched_links_are_refused(self):
        for params in ({"t": self.token + "x"}, {"t": "nonsense"}, {"t": ""}, {"claim": 8}):
            r = self.preview(**params)
            self.assertEqual((r.status_code, r.json()["reason"]), (404, "invalid"), params)

    def test_expires_when_the_challenge_period_ends(self):
        IndexerState.objects.update(head_time=1600)
        r = self.preview()
        self.assertEqual((r.status_code, r.json()["reason"]), (410, "expired"))
        self.assertEqual(self.consume().status_code, 410)

    def test_a_closed_claim_leaves_nothing_to_cancel(self):
        ChainEvent.objects.create(chain_id=31337, address=CFG.address, block_number=3, block_hash="0x1", timestamp=1200, tx_hash="0x" + "11" * 32, log_index=0,
                                  event_name="ClaimCancelled", args={"claimId": 7, "owner": self.u.address}, claim_id=7, owner=self.u.address)
        r = self.preview()
        self.assertEqual((r.status_code, r.json()["reason"]), (410, "closed"))

    def test_single_use_it_is_retired_only_after_the_chain_confirms_the_check_in(self):
        r = self.consume()  # nothing on-chain yet: the link stays usable
        self.assertEqual((r.status_code, r.json()["reason"]), (409, "pending"))
        self.assertEqual(self.preview().status_code, 200)
        self.chain.invalidated.add(7)
        self.assertEqual(self.consume().status_code, 200)
        self.assertIsNotNone(AlertLink.objects.get(pk=self.link.pk).used_at)
        for r in (self.preview(), self.consume()):
            self.assertEqual((r.status_code, r.json()["reason"]), (410, "used"))

    def test_consume_survives_an_rpc_outage(self):
        with mock.patch("alerts.views.get_client", side_effect=RuntimeError("down")):
            self.assertEqual(self.consume().status_code, 503)
        self.assertIsNone(AlertLink.objects.get(pk=self.link.pk).used_at)


@override_settings(SMS_BACKEND="tests.fakes.FakeSms")
class AlertSettingsTests(ApiTest):
    def setUp(self):
        super().setUp()
        FakeSms.sent, FakeSms.configured, FakeSms.fail = [], True, False
        self.acct = Account.create()
        self.c = self.client_for(self.acct, name="Olivia", email="olivia@x.io", phone=OWNER_PHONE)
        mail.outbox.clear()

    def code_from(self, text):
        return re.search(r"code is (\d{6})", text).group(1)

    def test_defaults(self):
        d = self.c.get("/api/alerts/settings").json()
        self.assertEqual((d["email_enabled"], d["sms_enabled"], d["email_verified"], d["phone_verified"], d["sms_available"]), (True, False, False, False, True))

    def test_email_verification_with_a_code(self):
        self.assertEqual(self.c.post("/api/alerts/verify/start", {"channel": "email"}, format="json").status_code, 204)
        code = self.code_from(mail.outbox[-1].body)
        r = self.c.post("/api/alerts/verify/confirm", {"channel": "email", "code": "000000" if code != "000000" else "111111"}, format="json")
        self.assertEqual(r.status_code, 400)
        r = self.c.post("/api/alerts/verify/confirm", {"channel": "email", "code": code}, format="json")
        self.assertEqual((r.status_code, r.json()["email_verified"]), (200, True))
        again = self.c.post("/api/alerts/verify/confirm", {"channel": "email", "code": code}, format="json")
        self.assertEqual(again.status_code, 400)  # a code works once

    def test_phone_verification_then_sms_can_be_enabled_but_not_before(self):
        r = self.c.put("/api/alerts/settings", {"email_enabled": True, "sms_enabled": True}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(self.c.post("/api/alerts/verify/start", {"channel": "phone"}, format="json").status_code, 204)
        ((to, body),) = FakeSms.sent
        self.assertEqual(to, OWNER_PHONE)
        r = self.c.post("/api/alerts/verify/confirm", {"channel": "phone", "code": self.code_from(body)}, format="json")
        self.assertTrue(r.json()["phone_verified"])
        r = self.c.put("/api/alerts/settings", {"email_enabled": False, "sms_enabled": True}, format="json")
        self.assertEqual((r.status_code, r.json()["email_enabled"], r.json()["sms_enabled"]), (200, False, True))

    def test_changing_a_contact_unverifies_it_and_switches_sms_off(self):
        self.c.post("/api/alerts/verify/start", {"channel": "phone"}, format="json")
        self.c.post("/api/alerts/verify/confirm", {"channel": "phone", "code": self.code_from(FakeSms.sent[-1][1])}, format="json")
        self.c.put("/api/alerts/settings", {"email_enabled": True, "sms_enabled": True}, format="json")
        r = self.c.put("/api/me", {"name": "Olivia", "email": "olivia@x.io", "phone": "+911111111111"}, format="json")
        self.assertEqual(r.status_code, 200)
        d = self.c.get("/api/alerts/settings").json()
        self.assertEqual((d["phone_verified"], d["sms_enabled"]), (False, False))
        # editing only the name keeps what is verified
        self.c.post("/api/alerts/verify/start", {"channel": "email"}, format="json")
        self.c.post("/api/alerts/verify/confirm", {"channel": "email", "code": self.code_from(mail.outbox[-1].body)}, format="json")
        self.c.put("/api/me", {"name": "Olivia O", "email": "olivia@x.io", "phone": "+911111111111"}, format="json")
        self.assertTrue(self.c.get("/api/alerts/settings").json()["email_verified"])

    def test_a_code_locks_after_five_wrong_guesses(self):
        self.c.post("/api/alerts/verify/start", {"channel": "email"}, format="json")
        code = self.code_from(mail.outbox[-1].body)
        wrong = "000000" if code != "000000" else "111111"
        for _ in range(5):
            self.assertEqual(self.c.post("/api/alerts/verify/confirm", {"channel": "email", "code": wrong}, format="json").status_code, 400)
        self.assertEqual(self.c.post("/api/alerts/verify/confirm", {"channel": "email", "code": code}, format="json").status_code, 400)

    def test_phone_cannot_be_verified_when_sms_is_not_configured(self):
        FakeSms.configured = False
        r = self.c.post("/api/alerts/verify/start", {"channel": "phone"}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertFalse(self.c.get("/api/alerts/settings").json()["sms_available"])

    def test_settings_require_sign_in_and_show_no_contact_details(self):
        from rest_framework.test import APIClient

        self.assertEqual(APIClient().get("/api/alerts/settings").status_code, 401)
        self.c.post("/api/alerts/verify/start", {"channel": "email"}, format="json")
        text = self.c.get("/api/alerts/settings").content.decode()
        self.assertNotIn("olivia@x.io", text)
        self.assertNotIn(OWNER_PHONE, text)
