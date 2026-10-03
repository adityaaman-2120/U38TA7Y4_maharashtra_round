from datetime import timedelta

from django.core import mail
from django.test import override_settings
from django.utils import timezone
from eth_account import Account
from rest_framework.test import APIClient

from invites.models import Invite

from .helpers import ApiTest, invite_token_from_mail, make_blob

OWNER = Account.create()
GUARD = Account.create()
OTHER = Account.create()


class InviteTests(ApiTest):
    def setUp(self):
        super().setUp()
        mail.outbox.clear()
        self.owner = self.client_for(OWNER, name="Olivia Owner", email="olivia@example.com")

    def invite(self, email="gary@example.com", role="guardian", **extra):
        return self.owner.post("/api/invites", {"email": email, "role": role, **extra}, format="json")

    def invitee(self, account=GUARD, email="gary@example.com", key=True):
        c = self.client_for(account, name="Gary Guardian", email=email)
        if key:
            c.put("/api/key-blob", {"blob": make_blob(account)}, format="json")
        return c

    # ---- creating ---------------------------------------------------------------------------
    def test_create_sends_email_with_signed_link(self):
        r = self.invite(name="Gary")
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.json()["status"], "pending")
        self.assertTrue(r.json()["email_sent"])
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["gary@example.com"])
        self.assertIn("Olivia Owner", mail.outbox[0].body)
        self.assertIn("http://localhost:3000/invite/", mail.outbox[0].body)
        self.assertNotIn("link", r.json())  # the link only goes by email (DEBUG is off in tests)

    @override_settings(DEBUG=True)
    def test_debug_returns_link_for_local_development(self):
        self.assertIn("/invite/", self.invite().json()["link"])

    def test_validation(self):
        self.assertEqual(self.invite(email="nope").status_code, 400)
        self.assertEqual(self.invite(role="admin").status_code, 400)
        self.assertEqual(self.invite(email="olivia@example.com").status_code, 400)  # self-invite
        nameless = APIClient()
        from .helpers import sign_in
        sign_in(nameless, OTHER)
        self.assertEqual(nameless.post("/api/invites", {"email": "x@y.co", "role": "guardian"}, format="json").status_code, 400)

    def test_duplicate_live_invite_refused_but_other_role_allowed(self):
        self.assertEqual(self.invite().status_code, 201)
        self.assertEqual(self.invite().status_code, 409)
        self.assertEqual(self.invite(email="GARY@example.com").status_code, 409)  # case-insensitive
        self.assertEqual(self.invite(role="beneficiary").status_code, 201)

    def test_requires_authentication(self):
        self.assertEqual(APIClient().post("/api/invites", {"email": "a@b.co", "role": "guardian"}, format="json").status_code, 401)
        self.assertEqual(APIClient().get("/api/invites").status_code, 401)
        self.assertEqual(APIClient().get("/api/contacts").status_code, 401)

    # ---- the invitee's side -----------------------------------------------------------------
    def test_preview_is_public_and_minimal(self):
        self.invite()
        token = invite_token_from_mail()
        r = APIClient().post("/api/invites/preview", {"token": token}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), {"role": "guardian", "inviter": "Olivia Owner", "email": "gary@example.com"})
        self.assertEqual(APIClient().post("/api/invites/preview", {"token": token + "x"}, format="json").status_code, 404)
        self.assertEqual(APIClient().post("/api/invites/preview", {"token": "garbage"}, format="json").status_code, 404)

    def test_accept_flow(self):
        self.invite(name="Gary")
        token = invite_token_from_mail()
        g = self.invitee()
        r = g.post("/api/invites/accept", {"token": token}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["status"], "accepted")
        self.assertEqual(r.json()["invitee"]["address"], GUARD.address)

        listed = self.owner.get("/api/invites").json()
        self.assertEqual([i["status"] for i in listed], ["accepted"])
        contacts = self.owner.get("/api/contacts").json()
        self.assertEqual(len(contacts), 1)
        self.assertEqual(contacts[0]["invitee"], {"address": GUARD.address, "name": "Gary Guardian", "public_key": "0x04" + "ab" * 64})
        self.assertNotIn("gary@example.com", str(contacts[0]["invitee"]))  # email and phone stay private
        self.assertEqual(len(self.owner.get("/api/contacts?role=beneficiary").json()), 0)

    def test_token_is_single_use(self):
        self.invite()
        token = invite_token_from_mail()
        self.assertEqual(self.invitee().post("/api/invites/accept", {"token": token}, format="json").status_code, 200)
        again = self.client_for(OTHER, name="Eve", email="gary@example.com")
        again.put("/api/key-blob", {"blob": make_blob(OTHER)}, format="json")
        self.assertEqual(again.post("/api/invites/accept", {"token": token}, format="json").status_code, 404)

    def test_accept_preconditions(self):
        self.invite()
        token = invite_token_from_mail()
        self.assertEqual(APIClient().post("/api/invites/accept", {"token": token}, format="json").status_code, 401)
        no_key = self.invitee(key=False)
        self.assertEqual(no_key.post("/api/invites/accept", {"token": token}, format="json").status_code, 400)
        wrong_email = self.client_for(OTHER, name="Eve", email="eve@example.com")
        wrong_email.put("/api/key-blob", {"blob": make_blob(OTHER)}, format="json")
        r = wrong_email.post("/api/invites/accept", {"token": token}, format="json")
        self.assertEqual(r.status_code, 409)
        incomplete = APIClient()
        from .helpers import sign_in
        sign_in(incomplete, Account.create())
        self.assertEqual(incomplete.post("/api/invites/accept", {"token": token}, format="json").status_code, 400)
        self.assertEqual(Invite.objects.get().status, "pending")

    def test_owner_cannot_accept_own_invite(self):
        self.invite(email="olivia2@example.com")
        token = invite_token_from_mail()
        self.owner.put("/api/me", {"name": "Olivia Owner", "email": "olivia2@example.com"}, format="json")
        self.owner.put("/api/key-blob", {"blob": make_blob(OWNER)}, format="json")
        self.assertEqual(self.owner.post("/api/invites/accept", {"token": token}, format="json").status_code, 400)

    def test_expired_invite(self):
        self.invite()
        token = invite_token_from_mail()
        Invite.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.owner.get("/api/invites").json()[0]["status"], "expired")
        self.assertEqual(APIClient().post("/api/invites/preview", {"token": token}, format="json").status_code, 404)
        self.assertEqual(self.invitee().post("/api/invites/accept", {"token": token}, format="json").status_code, 404)
        self.assertEqual(self.invite().status_code, 201)  # an expired invite does not block a new one

    @override_settings(INVITE_TTL_SECONDS=-1)
    def test_signed_token_has_its_own_expiry(self):
        self.invite()
        token = invite_token_from_mail()
        self.assertEqual(APIClient().post("/api/invites/preview", {"token": token}, format="json").status_code, 404)

    def test_revoke_and_resend(self):
        r = self.invite()
        old = invite_token_from_mail()
        iid = r.json()["id"]
        self.assertEqual(self.owner.post(f"/api/invites/{iid}/resend").status_code, 200)
        new = invite_token_from_mail()
        self.assertNotEqual(old, new)
        self.assertEqual(APIClient().post("/api/invites/preview", {"token": old}, format="json").status_code, 404)  # old link is dead
        self.assertEqual(APIClient().post("/api/invites/preview", {"token": new}, format="json").status_code, 200)

        self.assertEqual(self.owner.delete(f"/api/invites/{iid}").status_code, 204)
        self.assertEqual(APIClient().post("/api/invites/preview", {"token": new}, format="json").status_code, 404)
        self.assertEqual(self.owner.get("/api/invites").json()[0]["status"], "revoked")
        self.assertEqual(self.owner.post(f"/api/invites/{iid}/resend").status_code, 404)
        self.assertEqual(self.invite().status_code, 201)  # can invite again after revoking

    def test_removing_an_accepted_contact(self):
        self.invite()
        self.invitee().post("/api/invites/accept", {"token": invite_token_from_mail()}, format="json")
        iid = self.owner.get("/api/invites").json()[0]["id"]
        self.owner.delete(f"/api/invites/{iid}")
        self.assertEqual(self.owner.get("/api/contacts").json(), [])

    # ---- isolation --------------------------------------------------------------------------
    def test_owners_cannot_see_or_touch_each_others_invites(self):
        r = self.invite()
        iid = r.json()["id"]
        rival = self.client_for(OTHER, name="Rival", email="rival@example.com")
        self.assertEqual(rival.get("/api/invites").json(), [])
        self.assertEqual(rival.delete(f"/api/invites/{iid}").status_code, 404)
        self.assertEqual(rival.post(f"/api/invites/{iid}/resend").status_code, 404)
        self.assertEqual(Invite.objects.get().status, "pending")
        self.invitee().post("/api/invites/accept", {"token": invite_token_from_mail()}, format="json")
        self.assertEqual(rival.get("/api/contacts").json(), [])  # contacts are per owner

    def test_email_failure_does_not_lose_the_invite(self):
        from unittest import mock
        with mock.patch("invites.emails.send_mail", side_effect=OSError("smtp down")):
            r = self.invite()
        self.assertEqual(r.status_code, 201)
        self.assertFalse(r.json()["email_sent"])
        self.assertEqual(Invite.objects.count(), 1)
