"""Escalation of a raised claim to the vault owner (and, near the end, the guardians).

  * when the claim is raised          -> email the owner a single-use "I'm alive" link (expires when the challenge ends)
  * `ALERT_SMS_AFTER_SECONDS` later   -> SMS the owner a fresh link, if there has been no check-in and the challenge is still running
  * `ALERT_GUARDIAN_BEFORE_END_SECONDS` before the challenge ends -> alert the guardians who have not responded yet

Every stage is idempotent (one row per claim/person/stage/channel in AlertLog; only a "sent" row stops a retry), so it is safe to run
from both the event pipeline and the periodic task. "Now" is the chain's clock, as for reminders. Logs carry ids and short codes only.
"""
import logging
from datetime import UTC, datetime
from urllib.parse import quote

from django.conf import settings
from django.core.mail import send_mail
from django.db import IntegrityError, transaction
from django.utils import timezone

from accounts.models import User
from indexer.clients import get_client
from indexer.models import ChainEvent, IndexerState
from notifications import derive
from notifications.models import Notification
from notifications.reminders import CLOSING

from . import sms
from .models import AlertLink, AlertLog, AlertPreference, ClaimEscalation
from .tokens import make_token

log = logging.getLogger(__name__)

OWNER_EMAIL = "owner_claim_raised"
OWNER_SMS = "owner_claim_escalation"
GUARDIAN = "guardian_challenge_ending"


# ---- state ------------------------------------------------------------------------------------------

def chain_now(chain_id: int, address: str) -> int:
    return IndexerState.objects.filter(chain_id=chain_id, address=address).values_list("head_time", flat=True).first() or 0


def prefs_for(user: User) -> AlertPreference:
    return AlertPreference.objects.get_or_create(user=user)[0]


def ensure_escalation(raised: ChainEvent) -> ClaimEscalation | None:
    """Looks the claim's challenge end up once (it needs the asset's policy from the chain) and remembers it."""
    existing = ClaimEscalation.objects.filter(chain_id=raised.chain_id, address=raised.address, claim_id=raised.claim_id).first()
    if existing:
        return existing
    asset = derive.asset_added(raised)
    if asset is None:
        return None  # an event we cannot place: the indexer started mid-history
    try:
        challenge = int(get_client(raised.chain_id, raised.address).asset_policy(raised.asset_id)["challengePeriod"])
    except Exception as e:
        log.warning("alerts: could not read the challenge period (chain=%s claim=%s): %s", raised.chain_id, raised.claim_id, type(e).__name__)
        return None  # the periodic task tries again
    esc, _ = ClaimEscalation.objects.get_or_create(
        chain_id=raised.chain_id, address=raised.address, claim_id=raised.claim_id,
        defaults=dict(asset_id=raised.asset_id, owner=asset.args["owner"].lower(), raised_at=raised.timestamp, ends_at=raised.timestamp + challenge),
    )
    return esc


def is_closed(esc: ClaimEscalation) -> bool:
    """The claim is over, or the owner has already checked in (which voids it): nobody needs alerting."""
    ev = derive.scope(esc.chain_id, esc.address)
    if ev.filter(claim_id=esc.claim_id, event_name__in=CLOSING).exists():
        return True
    return ev.filter(event_name="Heartbeat", owner=esc.owner, timestamp__gte=esc.raised_at).exists()


def alive_link(esc: ClaimEscalation, user: User, channel: str) -> str:
    link = AlertLink.objects.create(escalation=esc, user=user, channel=channel)
    return f"{settings.FRONTEND_URL}/alive?claim={esc.claim_id}&t={quote(make_token(link), safe='')}"


def _utc(ts: int) -> str:
    return datetime.fromtimestamp(ts, UTC).strftime("%Y-%m-%d %H:%M UTC")


# ---- one logged attempt -----------------------------------------------------------------------------

def _attempt(esc: ClaimEscalation, user: User, kind: str, channel: str, send) -> bool:
    """Runs `send()` once per (claim, person, stage, channel). `send` returns a provider reference, or raises `Skip(reason)`.
    Returns whether an alert was sent now."""
    try:
        with transaction.atomic():
            row, _ = AlertLog.objects.get_or_create(
                escalation=esc, user=user, kind=kind, channel=channel,
                defaults=dict(chain_id=esc.chain_id, claim_id=esc.claim_id, status=AlertLog.Status.FAILED),
            )
    except IntegrityError:  # a concurrent worker created it first
        row = AlertLog.objects.get(escalation=esc, user=user, kind=kind, channel=channel)
    if row.status == AlertLog.Status.SENT:
        return False
    row.attempts += 1
    try:
        row.provider_ref = send() or ""
        row.status, row.reason = AlertLog.Status.SENT, ""
    except Skip as s:
        row.status, row.reason = AlertLog.Status.SKIPPED, s.reason
    except Exception as e:
        row.status, row.reason = AlertLog.Status.FAILED, "delivery_error"
        log.warning("alert delivery failed kind=%s channel=%s user=%s claim=%s error=%s", kind, channel, user.pk, esc.claim_id, type(e).__name__)
    row.save()
    log.info("alert kind=%s channel=%s status=%s reason=%s user=%s claim=%s", kind, channel, row.status, row.reason, user.pk, esc.claim_id)
    return row.status == AlertLog.Status.SENT


class Skip(Exception):
    def __init__(self, reason: str):
        self.reason = reason


# ---- stages -----------------------------------------------------------------------------------------

def _owner_email(esc: ClaimEscalation, user: User, claimant: str) -> bool:
    def send():
        if not prefs_for(user).email_enabled:
            raise Skip("channel_disabled")
        if not user.email:
            raise Skip("no_contact")
        link = alive_link(esc, user, "email")
        body = (
            f"Hello {user.name or 'there'},\n\n"
            f"{claimant} raised claim #{esc.claim_id} on asset #{esc.asset_id} of your Heirloom vault.\n\n"
            "If you are alive, cancel it now. Open this link, connect your wallet and press \"I'm alive\". "
            "That check-in invalidates the claim immediately:\n\n"
            f"{link}\n\n"
            f"The link works once and expires when the challenge period ends ({_utc(esc.ends_at)}). Opening it does nothing by itself: "
            "only a transaction you approve in your own wallet counts. If you did not expect this, check in anyway and tell your guardians.\n\n"
            "This message contains no file contents or secrets."
        )
        send_mail("[Action needed] A claim was raised on your Heirloom vault", body, settings.DEFAULT_FROM_EMAIL, [user.email], fail_silently=False)
        return ""

    return _attempt(esc, user, OWNER_EMAIL, "email", send)


def _owner_sms(esc: ClaimEscalation, user: User) -> bool:
    def send():
        if not prefs_for(user).sms_enabled:
            raise Skip("channel_disabled")
        if not user.phone:
            raise Skip("no_contact")
        if not user.phone_verified:
            raise Skip("phone_unverified")  # never text a number nobody has proven is theirs
        backend = sms.get_backend()
        if not backend.available():
            raise Skip("sms_unavailable")
        link = alive_link(esc, user, "sms")
        return backend.send(user.phone, f"Heirloom: a claim was raised on your vault and nobody has heard from you. If you are alive, check in before {_utc(esc.ends_at)}: {link}")

    return _attempt(esc, user, OWNER_SMS, "sms", send)


def _guardians(esc: ClaimEscalation, raised: ChainEvent, now: int) -> int:
    ev = derive.scope(esc.chain_id, esc.address)
    responded = {
        str(e.args.get("guardian", "")).lower()
        for e in ev.filter(claim_id=esc.claim_id, event_name__in=["Attested", "ClaimRejectedByGuardian", "FraudFlagged"])
    }
    pending = [g for g in derive.guardians_at(raised, esc.owner) if g not in responded]
    users = derive.users_by_address(pending)
    hours = max(1, round((esc.ends_at - now) / 3600))
    body_text = (
        f"The challenge period for claim #{esc.claim_id} on asset #{esc.asset_id} ends in about {hours} hour{'' if hours == 1 else 's'} ({_utc(esc.ends_at)}), "
        "and the owner has not checked in. Open Heirloom, review the evidence, then approve, reject, or flag the claim as fraud."
    )
    sent = 0
    for g in pending:
        user = users.get(g)
        if user is None:
            continue
        Notification.objects.get_or_create(
            user=user, dedupe_key=f"challenge-ending:{esc.chain_id}:{esc.claim_id}",
            defaults=dict(kind="challenge_ending_guardian", title="Action needed: a claim's challenge period is about to end", body=body_text,
                          urgent=True, view="guardian", chain_id=esc.chain_id, asset_id=esc.asset_id, claim_id=esc.claim_id),
        )

        def send(user=user):
            if not prefs_for(user).email_enabled:
                raise Skip("channel_disabled")
            if not user.email:
                raise Skip("no_contact")
            body = f"Hello {user.name or 'there'},\n\n{body_text}\n\nOpen Heirloom: {settings.FRONTEND_URL}/app\n\nThis message contains no file contents or secrets."
            send_mail("[Action needed] A claim's challenge period is about to end", body, settings.DEFAULT_FROM_EMAIL, [user.email], fail_silently=False)
            return ""

        sent += _attempt(esc, user, GUARDIAN, "email", send)
    return sent


# ---- driver -----------------------------------------------------------------------------------------

def escalate(esc: ClaimEscalation, raised: ChainEvent) -> dict:
    """Runs every stage that is due. Returns how many alerts went out, per stage."""
    out = {"owner_email": 0, "owner_sms": 0, "guardians": 0}
    if esc.closed_at:
        return out
    if is_closed(esc):
        esc.closed_at = timezone.now()
        esc.save(update_fields=["closed_at"])
        return out
    now = chain_now(esc.chain_id, esc.address)
    if now == 0 or now >= esc.ends_at:
        return out  # the link would already be dead; the claim can only be finalized or checked in on from the app
    owner = derive.users_by_address([esc.owner]).get(esc.owner)
    if owner is not None:
        users = derive.users_by_address([raised.args["claimant"].lower()])
        claimant = derive.display_name(raised.args["claimant"], users)
        out["owner_email"] = int(_owner_email(esc, owner, claimant))
        if now - esc.raised_at >= settings.ALERT_SMS_AFTER_SECONDS:
            out["owner_sms"] = int(_owner_sms(esc, owner))
    window = settings.ALERT_GUARDIAN_BEFORE_END_SECONDS
    # Only when the claim was raised earlier than that window: otherwise the guardians' "a claim needs your review" alert is the warning.
    if esc.ends_at - now <= window and esc.ends_at - esc.raised_at > window:
        out["guardians"] = _guardians(esc, raised, now)
    return out


def escalate_event(event_pk: int) -> dict | None:
    raised = ChainEvent.objects.filter(pk=event_pk, event_name="ClaimRaised").first()
    esc = ensure_escalation(raised) if raised else None
    return escalate(esc, raised) if esc else None


def run_all() -> int:
    """Periodic: every claim that is still open gets whichever stages have become due. Returns alerts sent."""
    from indexer.chains import current_deployments

    total = 0
    for chain_id, address in current_deployments():
        done = set(ClaimEscalation.objects.filter(chain_id=chain_id, address=address, closed_at__isnull=False).values_list("claim_id", flat=True))
        for raised in derive.scope(chain_id, address).filter(event_name="ClaimRaised").exclude(claim_id__in=done):
            esc = ensure_escalation(raised)
            if esc:
                total += sum(escalate(esc, raised).values())
    return total
