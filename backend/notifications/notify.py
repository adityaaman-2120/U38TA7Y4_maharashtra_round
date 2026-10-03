"""Turns indexed events into notifications for the right people."""
from dataclasses import dataclass

from django.db import transaction

from indexer.models import ChainEvent

from . import derive
from .models import Notification


@dataclass(frozen=True)
class Message:
    kind: str
    title: str
    body: str
    view: str
    urgent: bool = False


def _plural(n: int, word: str) -> str:
    return f"{n} {word}{'' if n == 1 else 's'}"


def _messages(ev: ChainEvent, names, claim_no: int | None, asset_no: int | None, count: int, crypto: bool = False) -> dict[str, Message]:
    """Role -> message for this event. Roles are resolved to addresses by `_audience`."""
    a = ev.args
    c, s = f"#{claim_no}", f"#{asset_no}"
    actor = names(a.get("guardian") or a.get("by") or a.get("owner") or "")
    name = ev.event_name

    if name == "ClaimRaised":
        who = names(a["claimant"])
        return {
            "owner": Message("claim_raised_owner", "Urgent: a claim was raised on your vault",
                f"{who} raised claim {c} on asset {s}. If you are alive, open Heirloom and press \"I'm alive\": any check-in cancels the claim "
                "immediately. Otherwise your guardians will now review it.", "owner", True),
            "guardian": Message("claim_raised_guardian", "Urgent: a claim needs your review",
                f"{who} raised claim {c} on asset {s}. Open Heirloom, review the evidence, then approve, reject, or flag it as fraud.", "guardian", True),
        }
    if name == "Attested":
        text = f"A guardian approved claim {c} on asset {s} ({_plural(int(a['approvals']), 'approval')} so far)."
        return {"owner": Message("claim_attested", "A guardian approved the claim", text, "owner"),
                "claimant": Message("claim_attested", "A guardian approved your claim", text, "beneficiary")}
    if name == "ClaimRejectedByGuardian":
        text = f"A guardian rejected claim {c} on asset {s}."
        return {"owner": Message("claim_rejected_by_guardian", "A guardian rejected the claim", text, "owner"),
                "claimant": Message("claim_rejected_by_guardian", "A guardian rejected your claim", text, "beneficiary")}
    if name == "ClaimRejected":
        text = f"Claim {c} on asset {s} was closed: too many guardians rejected it for the approval threshold to be reached."
        return {"owner": Message("claim_rejected", "The claim was rejected", text, "owner"),
                "claimant": Message("claim_rejected", "Your claim was rejected", text, "beneficiary"),
                "guardian": Message("claim_rejected", "The claim was closed", text, "guardian")}
    if name == "FraudFlagged":
        text = f"{actor} flagged claim {c} on asset {s} as fraudulent. It cannot be finalized until the owner cancels it."
        return {"owner": Message("claim_fraud_flagged", "Urgent: a claim was flagged as fraud", text, "owner", True),
                "claimant": Message("claim_fraud_flagged", "Your claim was flagged", text, "beneficiary"),
                "guardian": Message("claim_fraud_flagged", "A claim was flagged as fraud", text, "guardian")}
    if name == "ClaimCancelled":
        text = f"The owner cancelled claim {c} on asset {s}."
        return {"claimant": Message("claim_cancelled", "The owner cancelled your claim", text, "beneficiary"),
                "guardian": Message("claim_cancelled", "The claim was cancelled by the owner", text, "guardian")}
    if name == "ClaimFinalized" and crypto:
        # Funds have no key to release: finalizing is the end of the guardians' part, and the beneficiary pulls the money.
        return {
            "claimant": Message("claim_finalized_beneficiary", "Your claim was finalized: withdraw your funds",
                f"Claim {c} on asset {s} was finalized. Open Heirloom and press Withdraw to receive the funds.", "beneficiary", True),
            "guardian": Message("claim_finalized_guardian", "A claim was finalized",
                f"Claim {c} on asset {s} was finalized. This asset holds funds, so there is no share to release; nothing more is needed from you.", "guardian"),
        }
    if name == "ClaimFinalized":
        return {
            "claimant": Message("claim_finalized_beneficiary", "Your claim was finalized",
                f"Claim {c} on asset {s} was finalized. Once enough guardians release their shares you can decrypt the file.", "beneficiary"),
            "guardian": Message("claim_finalized_guardian", "Action needed: release your share",
                f"Claim {c} on asset {s} was finalized. Open Heirloom and release your share so the beneficiary can open the file.", "guardian", True),
        }
    if name == "ShareReleased":
        return {"claimant": Message("share_released", "A guardian released their share",
                f"{_plural(count, 'guardian')} released a share for claim {c} on asset {s}. Open Heirloom to check whether you can decrypt.", "beneficiary")}
    return {}


def _audience(ev: ChainEvent, role: str, owner: str, claimant: str, guardians: list[str]) -> list[str]:
    actor = (ev.args.get("guardian") or "").lower()
    return {
        "owner": [owner],
        "claimant": [claimant],
        "guardian": [g for g in guardians if g != actor],
    }[role]


def create_for_event(ev: ChainEvent) -> list[Notification]:
    """Creates (idempotently) the notifications an event calls for. Returns only the newly created ones."""
    if ev.claim_id is None:
        return []
    raised = ev if ev.event_name == "ClaimRaised" else derive.claim_raised(ev.chain_id, ev.address, ev.claim_id)
    asset = derive.asset_added(ev)
    if raised is None or asset is None:
        return []  # an event we cannot place (indexer started mid-history); nothing sensible to say
    owner, claimant = asset.args["owner"].lower(), raised.args["claimant"].lower()
    guardians = derive.guardians_at(raised, owner)

    count = ChainEvent.objects.filter(chain_id=ev.chain_id, address=ev.address, event_name="ShareReleased", claim_id=ev.claim_id).count() if ev.event_name == "ShareReleased" else 0
    everyone = {owner, claimant, *guardians}
    users = derive.users_by_address(everyone | {str(v).lower() for v in ev.args.values() if isinstance(v, str) and v.startswith("0x") and len(v) == 42})
    def names(addr: str) -> str:
        return derive.display_name(addr, users) if addr else "Someone"

    messages = _messages(ev, names, ev.claim_id, ev.asset_id, count, crypto=derive.is_crypto(ev.chain_id, ev.address, ev.asset_id))

    created = []
    for role, msg in messages.items():
        for address in _audience(ev, role, owner, claimant, guardians):
            user = users.get(address)
            if user is None:
                continue  # not a registered Heirloom user: there is nobody to notify
            n, was_created = Notification.objects.get_or_create(
                user=user, dedupe_key=f"event:{ev.pk}:{role}",
                defaults=dict(kind=msg.kind, title=msg.title, body=msg.body, urgent=msg.urgent, view=msg.view,
                              chain_id=ev.chain_id, asset_id=ev.asset_id, claim_id=ev.claim_id, event=ev),
            )
            if was_created:
                created.append(n)
    return created


def process_pending_events(limit: int = 500) -> int:
    """Creates notifications for newly indexed events and queues their emails. Safe to run repeatedly."""
    from alerts.tasks import escalate_claim

    from .tasks import send_notification_email

    done = 0
    for ev in ChainEvent.objects.filter(processed=False).order_by("block_number", "log_index")[:limit]:
        with transaction.atomic():
            fresh = create_for_event(ev)
            ChainEvent.objects.filter(pk=ev.pk).update(processed=True)
        for n in fresh:  # queued only once the rows are committed, so a worker can always find them
            if n.kind != "claim_raised_owner":  # the owner's email is the alerts module's: it carries the one-time check-in link
                send_notification_email.delay(n.pk)
        if ev.event_name == "ClaimRaised":
            escalate_claim.delay(ev.pk)
        done += 1
    return done
