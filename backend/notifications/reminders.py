"""Time-based reminders. "Now" is the chain's own clock (the head block's timestamp), because that is what the
contract compares deadlines against."""
import logging

from django.conf import settings

from indexer.client import ChainClient
from indexer.models import IndexerState

from . import derive
from .models import Notification

log = logging.getLogger(__name__)
CLOSING = ["ClaimCancelled", "ClaimFinalized", "ClaimRejected", "FraudFlagged"]


def _fmt(seconds: int) -> str:
    seconds = max(0, int(seconds))
    for unit, size in (("day", 86400), ("hour", 3600), ("minute", 60)):
        if seconds >= size:
            n = seconds // size
            return f"{n} {unit}{'' if n == 1 else 's'}"
    return f"{seconds} seconds"


def _notify(user, dedupe_key, *, kind, title, body, view, urgent, chain_id, asset_id=None, claim_id=None) -> Notification | None:
    n, created = Notification.objects.get_or_create(
        user=user, dedupe_key=dedupe_key,
        defaults=dict(kind=kind, title=title, body=body, view=view, urgent=urgent, chain_id=chain_id, asset_id=asset_id, claim_id=claim_id),
    )
    return n if created else None


def heartbeat_reminders(state: IndexerState) -> list[Notification]:
    now = state.head_time
    ev = derive.scope(state.chain_id, state.address)
    created = []
    for vault in ev.filter(event_name="VaultCreated"):
        owner = vault.owner
        if not ev.filter(event_name="AssetAdded", owner=owner).exists():
            continue  # nothing is being protected yet, so a missed check-in costs nothing
        interval = int(vault.args["heartbeatInterval"])
        last = max([vault.timestamp, *ev.filter(event_name="Heartbeat", owner=owner).values_list("timestamp", flat=True)])
        remaining = last + interval - now
        users = derive.users_by_address([owner])
        user = users.get(owner)
        if user is None:
            continue
        if remaining <= 0:
            n = _notify(user, f"hb-overdue:{state.chain_id}:{owner}:{last}", kind="heartbeat_overdue",
                        title="Urgent: your check-in is overdue",
                        body=f"You were due to check in {_fmt(-remaining)} ago. Until you do, a beneficiary may be able to raise a claim. Open Heirloom and press \"I'm alive\".",
                        view="owner", urgent=True, chain_id=state.chain_id)
        elif remaining <= interval * settings.HEARTBEAT_REMINDER_FRACTION:
            n = _notify(user, f"hb-due:{state.chain_id}:{owner}:{last}", kind="heartbeat_due", title="Time to check in",
                        body=f"Your next check-in is due in {_fmt(remaining)}. Open Heirloom and press \"I'm alive\" so nobody can start a claim.",
                        view="owner", urgent=False, chain_id=state.chain_id)
        else:
            n = None
        if n:
            created.append(n)
    return created


def deadline_reminders(state: IndexerState, client: ChainClient) -> list[Notification]:
    now = state.head_time
    ev = derive.scope(state.chain_id, state.address)
    created = []
    for raised in ev.filter(event_name="ClaimRaised"):
        cid = raised.claim_id
        if ev.filter(claim_id=cid, event_name__in=CLOSING).exists():
            continue
        asset = derive.asset_added(raised)
        if asset is None:
            continue
        owner = asset.args["owner"].lower()
        if ev.filter(event_name="Heartbeat", owner=owner, timestamp__gte=raised.timestamp).exists():
            continue  # the owner checked in after the claim: it is void and nobody needs to respond
        try:
            window = client.asset_policy(raised.asset_id)["attestationDeadline"]
        except Exception:
            log.warning("Could not read policy of asset %s on chain %s", raised.asset_id, state.chain_id, exc_info=True)
            continue
        remaining = raised.timestamp + window - now
        if not 0 < remaining <= window * settings.DEADLINE_REMINDER_FRACTION:
            continue
        responded = {e.args["guardian"].lower() for e in ev.filter(claim_id=cid, event_name__in=["Attested", "ClaimRejectedByGuardian"])}
        pending = [g for g in derive.guardians_at(raised, owner) if g not in responded]
        users = derive.users_by_address(pending)
        for g in pending:
            if g in users:
                n = _notify(users[g], f"deadline:{state.chain_id}:{cid}", kind="attestation_deadline",
                            title="Action needed: respond to a claim before its deadline",
                            body=f"Claim #{cid} on asset #{raised.asset_id} is waiting for your decision. The attestation deadline is in {_fmt(remaining)}. "
                                 "Open Heirloom, review the evidence, then approve, reject, or flag it.",
                            view="guardian", urgent=True, chain_id=state.chain_id, asset_id=raised.asset_id, claim_id=cid)
                if n:
                    created.append(n)
    return created


def run(client_for) -> int:
    """`client_for(state) -> ChainClient`. Returns how many reminders were created; each is emailed straight away."""
    from indexer.chains import current_deployments

    from . import delivery

    live = set(current_deployments())  # ignore contracts that were since redeployed (local dev chains)
    total = 0
    for state in IndexerState.objects.all():
        if state.head_time == 0 or (live and (state.chain_id, state.address) not in live):
            continue
        made = heartbeat_reminders(state) + deadline_reminders(state, client_for(state))
        for n in made:
            delivery.deliver(n)
        total += len(made)
    return total


def run_all() -> int:
    """The scheduler's entry point: reminders for every live deployment, reading policies from the chain."""
    from indexer.clients import get_client

    return run(lambda state: get_client(state.chain_id, state.address))
