from unittest import mock

from django.core import mail
from django.test import TestCase, override_settings

from indexer.models import ChainEvent, IndexerState
from notifications import emails, reminders
from notifications.models import Notification
from notifications.notify import process_pending_events

from .chainfake import EMPTY_CHAIN_DIR, T0, FakeChain, addr, ingest, raise_claim, scenario, user


@override_settings(CELERY_TASK_ALWAYS_EAGER=True)
class EventNotificationTests(TestCase):
    def setUp(self):
        self.o, self.g1, self.g2, self.g3, self.b = (addr() for _ in range(5))
        self.users = {
            "o": user(self.o, "Olivia Owner", "olivia@x.io"),
            "g1": user(self.g1, "Gary One", "g1@x.io"),
            "g2": user(self.g2, "Gina Two", "g2@x.io"),
            "g3": user(self.g3, "Gus Three", "g3@x.io"),
            "b": user(self.b, "Bea Beneficiary", "bea@x.io"),
        }
        self.chain = FakeChain()
        scenario(self.chain, self.o, [self.g1, self.g2, self.g3], self.b)
        raise_claim(self.chain, self.b, 5)
        ingest(self.chain)
        process_pending_events()
        mail.outbox.clear()
        Notification.objects.all().delete()
        ChainEvent.objects.filter(event_name="ClaimRaised").update(processed=False)

    def run_event(self, name, args, block, sender):
        self.chain.emit(name, args, block, sender)
        ingest(self.chain)
        process_pending_events()

    def who(self):
        return {n.user.name for n in Notification.objects.all()}

    def test_claim_raised_is_urgent_for_owner_and_every_guardian(self):
        process_pending_events()
        self.assertEqual(self.who(), {"Olivia Owner", "Gary One", "Gina Two", "Gus Three"})
        self.assertTrue(all(n.urgent for n in Notification.objects.all()))
        self.assertEqual(len(mail.outbox), 4)
        self.assertTrue(all(m.subject.startswith("[Action needed]") for m in mail.outbox))
        owner_mail = next(m for m in mail.outbox if m.to == ["olivia@x.io"])
        self.assertIn("I'm alive", owner_mail.body)
        self.assertIn("Bea Beneficiary", owner_mail.body)
        guardian_mail = next(m for m in mail.outbox if m.to == ["g1@x.io"])
        self.assertIn("review the evidence", guardian_mail.body)
        self.assertNotIn("bea@x.io", guardian_mail.body)  # no one else's contact details

    def test_attested_goes_to_owner_and_beneficiary_not_to_guardians(self):
        process_pending_events()
        mail.outbox.clear()
        Notification.objects.all().delete()
        self.run_event("Attested", {"claimId": 1, "guardian": self.g1, "approvals": 1}, 6, self.g1)
        self.assertEqual(self.who(), {"Olivia Owner", "Bea Beneficiary"})
        self.assertEqual({m.to[0] for m in mail.outbox}, {"olivia@x.io", "bea@x.io"})
        self.assertIn("1 approval so far", mail.outbox[0].body)

    def test_guardian_rejection_and_closure(self):
        process_pending_events()
        Notification.objects.all().delete()
        self.run_event("ClaimRejectedByGuardian", {"claimId": 1, "guardian": self.g1, "reasonHash": "0x" + "00" * 32, "rejections": 1}, 6, self.g1)
        self.assertEqual(self.who(), {"Olivia Owner", "Bea Beneficiary"})
        Notification.objects.all().delete()
        self.run_event("ClaimRejected", {"claimId": 1}, 7, self.g2)
        self.assertEqual(self.who(), {"Olivia Owner", "Bea Beneficiary", "Gary One", "Gina Two", "Gus Three"})

    def test_fraud_flag_is_urgent_for_owner_and_skips_the_flagging_guardian(self):
        process_pending_events()
        Notification.objects.all().delete()
        mail.outbox.clear()
        self.run_event("FraudFlagged", {"claimId": 1, "guardian": self.g2}, 6, self.g2)
        self.assertEqual(self.who(), {"Olivia Owner", "Bea Beneficiary", "Gary One", "Gus Three"})
        owner = Notification.objects.get(user=self.users["o"])
        self.assertTrue(owner.urgent)
        self.assertFalse(Notification.objects.get(user=self.users["b"]).urgent)
        self.assertIn("Gina Two flagged", owner.body)

    def test_cancelled_goes_to_beneficiary_and_guardians_not_the_owner(self):
        process_pending_events()
        Notification.objects.all().delete()
        self.run_event("ClaimCancelled", {"claimId": 1, "owner": self.o}, 6, self.o)
        self.assertEqual(self.who(), {"Bea Beneficiary", "Gary One", "Gina Two", "Gus Three"})

    def test_finalized_tells_beneficiary_and_asks_guardians_to_release(self):
        process_pending_events()
        Notification.objects.all().delete()
        mail.outbox.clear()
        self.run_event("ClaimFinalized", {"claimId": 1, "by": self.b}, 6, self.b)
        self.assertEqual(self.who(), {"Bea Beneficiary", "Gary One", "Gina Two", "Gus Three"})
        g = Notification.objects.get(user=self.users["g1"])
        self.assertTrue(g.urgent)
        self.assertIn("release your share", g.body)
        self.assertFalse(Notification.objects.get(user=self.users["b"]).urgent)

    def test_share_released_counts_shares(self):
        process_pending_events()
        Notification.objects.all().delete()
        self.run_event("ShareReleased", {"claimId": 1, "guardianIndex": 0, "guardian": self.g1}, 6, self.g1)
        self.run_event("ShareReleased", {"claimId": 1, "guardianIndex": 1, "guardian": self.g2}, 7, self.g2)
        bodies = sorted(n.body for n in Notification.objects.filter(user=self.users["b"]))
        self.assertIn("2 guardians released a share", bodies[1] if "2 guardians" in bodies[1] else bodies[0])
        self.assertEqual(Notification.objects.count(), 2)

    def test_never_notifies_twice(self):
        process_pending_events()
        n = Notification.objects.count()
        ChainEvent.objects.update(processed=False)  # replaying everything
        process_pending_events()
        ingest(self.chain)
        process_pending_events()
        self.assertEqual(Notification.objects.count(), n)
        self.assertEqual(len(mail.outbox), 4)

    def test_users_without_email_get_in_app_only_and_strangers_are_skipped(self):
        self.users["g3"].email = ""
        self.users["g3"].save()
        self.users["g2"].delete()  # an address that never signed up
        process_pending_events()
        self.assertEqual(self.who(), {"Olivia Owner", "Gary One", "Gus Three"})
        self.assertEqual(sorted(m.to[0] for m in mail.outbox), ["g1@x.io", "olivia@x.io"])
        self.assertTrue(Notification.objects.get(user=self.users["g3"]).email_sent_at is None)

    def test_email_failure_is_recorded_and_can_be_retried(self):
        process_pending_events()
        n = Notification.objects.filter(user=self.users["g1"]).get()
        n.email_sent_at = None
        n.save()
        with mock.patch("notifications.emails.send_mail", side_effect=OSError("smtp down")):
            with self.assertRaises(OSError):
                emails.send(n)
        n.refresh_from_db()
        self.assertIsNone(n.email_sent_at)
        self.assertIn("smtp down", n.email_error)
        self.assertTrue(emails.send(n))
        n.refresh_from_db()
        self.assertIsNotNone(n.email_sent_at)
        self.assertFalse(emails.send(n))  # already sent: never a duplicate

    def test_events_that_cannot_be_placed_are_ignored(self):
        ChainEvent.objects.filter(event_name="AssetAdded").delete()
        Notification.objects.all().delete()
        ChainEvent.objects.update(processed=False)
        self.assertEqual(process_pending_events(), 2)  # the two that remain were processed without error
        self.assertEqual(Notification.objects.count(), 0)


@override_settings(CELERY_TASK_ALWAYS_EAGER=True, CHAIN_DIR=EMPTY_CHAIN_DIR)
class ReminderTests(TestCase):
    INTERVAL = 1000

    def setUp(self):
        self.o, self.g1, self.g2, self.g3, self.b = (addr() for _ in range(5))
        for a, n in ((self.o, "Olivia"), (self.g1, "Gary"), (self.g2, "Gina"), (self.g3, "Gus"), (self.b, "Bea")):
            user(a, n, f"{n.lower()}@x.io")
        self.chain = FakeChain()
        scenario(self.chain, self.o, [self.g1, self.g2, self.g3], self.b, interval=self.INTERVAL)
        ingest(self.chain)
        process_pending_events()
        mail.outbox.clear()

    def at(self, seconds_after_vault):
        """Move the chain clock to `seconds_after_vault` seconds after the vault was created (block 1)."""
        head_ts = T0 + self.chain.head_n * 10
        self.chain.time_offset = (T0 + 10 + seconds_after_vault) - head_ts
        ingest(self.chain)

    def trigger(self):
        return reminders.run(lambda state: self.chain)

    def test_no_reminder_early_then_due_then_overdue_each_once(self):
        self.at(100)
        self.assertEqual(self.trigger(), 0)
        self.at(800)  # 200s left <= 25% of 1000
        self.assertEqual(self.trigger(), 1)
        self.assertEqual(self.trigger(), 0)  # same cycle: no repeat
        n = Notification.objects.get()
        self.assertEqual((n.kind, n.urgent), ("heartbeat_due", False))
        self.assertIn("due in 3 minutes", n.body)
        self.at(1200)
        self.assertEqual(self.trigger(), 1)
        self.assertEqual(self.trigger(), 0)
        overdue = Notification.objects.get(kind="heartbeat_overdue")
        self.assertTrue(overdue.urgent)
        self.assertEqual([m.to[0] for m in mail.outbox], ["olivia@x.io", "olivia@x.io"])
        self.assertTrue(mail.outbox[1].subject.startswith("[Action needed]"))

    def test_a_check_in_starts_a_new_cycle(self):
        self.at(1200)
        self.trigger()
        self.chain.emit("Heartbeat", {"owner": self.o, "timestamp": T0 + 10 + 1200}, self.chain.head_n + 1, self.o)
        self.chain.time_offset = 0
        ingest(self.chain)
        head = T0 + self.chain.head_n * 10
        self.chain.time_offset = (head + 900) - head  # 900s after the check-in: due again
        ingest(self.chain)
        self.assertEqual(self.trigger(), 1)
        self.assertEqual(Notification.objects.filter(kind="heartbeat_due").count(), 1)

    def test_owner_with_nothing_to_protect_is_not_nagged(self):
        ChainEvent.objects.filter(event_name="AssetAdded").delete()
        self.at(5000)
        self.assertEqual(self.trigger(), 0)

    # ---- attestation deadlines --------------------------------------------------------------
    def claim(self, block=5):
        raise_claim(self.chain, self.b, block)
        ingest(self.chain)
        process_pending_events()
        Notification.objects.all().delete()
        mail.outbox.clear()
        return ChainEvent.objects.get(event_name="ClaimRaised").timestamp

    def move_to(self, ts):
        head_ts = T0 + self.chain.head_n * 10
        self.chain.time_offset = ts - head_ts
        ingest(self.chain)

    def test_silent_guardians_are_reminded_before_the_deadline_once(self):
        raised_at = self.claim()
        self.chain.emit("Attested", {"claimId": 1, "guardian": self.g1, "approvals": 1}, 6, self.g1)
        ingest(self.chain)
        self.move_to(raised_at + 500)  # 500s of 1000s left: too early
        self.assertEqual(self.trigger(), 0)
        self.move_to(raised_at + 800)  # 200s left
        reminders.run(lambda s: self.chain)
        pending = {n.user.name for n in Notification.objects.filter(kind="attestation_deadline")}
        self.assertEqual(pending, {"Gina", "Gus"})  # Gary already responded
        self.assertEqual(self.trigger(), 0)
        deadline_mail = next(m for m in mail.outbox if "deadline" in m.body)
        self.assertIn("3 minutes", deadline_mail.body)

    def test_closed_or_void_claims_get_no_deadline_reminder(self):
        raised_at = self.claim()
        self.chain.emit("ClaimCancelled", {"claimId": 1, "owner": self.o}, 6, self.o)
        ingest(self.chain)
        self.move_to(raised_at + 800)
        self.assertEqual(reminders.deadline_reminders(IndexerState.objects.get(), self.chain), [])

    def test_owner_check_in_voids_the_claim_so_no_reminder(self):
        raised_at = self.claim()
        self.chain.emit("Heartbeat", {"owner": self.o, "timestamp": raised_at + 1}, 6, self.o)
        ingest(self.chain)
        self.move_to(raised_at + 800)
        self.assertEqual(reminders.deadline_reminders(IndexerState.objects.get(), self.chain), [])

    def test_unreadable_policy_does_not_break_the_run(self):
        raised_at = self.claim()
        self.move_to(raised_at + 800)
        self.chain.fail_policy = True
        self.assertEqual(reminders.deadline_reminders(IndexerState.objects.get(), self.chain), [])
