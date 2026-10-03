"""Chain -> Postgres indexer.

Properties:
  * idempotent: a log's identity is (chain, tx, log index); inserting it twice is a no-op;
  * resumable: progress is a per-deployment `last_block`, advanced in the same transaction as the rows it covers;
  * final: only blocks buried under `confirmations` are indexed, so ordinary reorgs never reach the table;
  * self-healing: if the block we last indexed is no longer on the canonical chain (a deeper reorg, or a local
    dev chain that was reset), orphaned rows are dropped and indexing resumes from the fork point.
"""
import logging
import re
from dataclasses import dataclass

from django.conf import settings
from django.db import transaction

from .chains import ChainConfig
from .client import ChainClient, RawEvent
from .models import ChainEvent, IndexerState

log = logging.getLogger(__name__)
ADDRESS_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")
OWNER_EVENTS = {"VaultCreated", "GuardiansRotated", "Heartbeat", "PanicFrozen", "VaultUnfrozen", "AssetAdded", "AssetSharesUpdated", "ClaimCancelled"}


@dataclass
class IndexResult:
    events: int = 0
    from_block: int | None = None
    to_block: int | None = None
    reorged: bool = False


def _addresses(value) -> list[str]:
    if isinstance(value, str):
        return [value.lower()] if ADDRESS_RE.match(value) else []
    if isinstance(value, (list, tuple)):
        return [a for v in value for a in _addresses(v)]
    return []


def columns_for(ev: RawEvent, tx_from: str, claim_to_asset: dict[int, int]) -> dict:
    a = ev.args
    claim_id = int(a["claimId"]) if "claimId" in a else None
    asset_id = int(a["assetId"]) if "assetId" in a else (claim_to_asset.get(claim_id) if claim_id is not None else None)
    owner = str(a["owner"]).lower() if ev.name in OWNER_EVENTS and "owner" in a else ""
    people = dict.fromkeys(_addresses(list(a.values())) + ([tx_from] if tx_from else []))  # ordered, unique
    return {
        "asset_id": asset_id,
        "claim_id": claim_id,
        "owner": owner,
        "participants": "," + ",".join(people) + "," if people else "",
    }


def _reconcile(cfg: ChainConfig, state: IndexerState, client: ChainClient, head: int) -> bool:
    """Drop rows that are no longer canonical. Returns True if anything was rewound."""
    if state.last_block < cfg.start_block:
        return False
    stale = state.last_block > head
    if not stale and state.last_block_hash:
        try:
            stale = client.block(state.last_block)["hash"] != state.last_block_hash
        except Exception:
            stale = True
    if not stale:
        return False

    scope = ChainEvent.objects.filter(chain_id=cfg.chain_id, address=cfg.address)
    new_last = cfg.start_block - 1
    while True:
        top = scope.order_by("-block_number", "-log_index").first()
        if top is None:
            break
        try:
            canonical = client.block(top.block_number)["hash"] if top.block_number <= head else None
        except Exception:
            canonical = None
        if canonical == top.block_hash:
            new_last = top.block_number  # this block, and so everything before it, is still canonical
            break
        scope.filter(block_number=top.block_number).delete()
    state.last_block = new_last
    state.last_block_hash = client.block(new_last)["hash"] if new_last >= cfg.start_block and new_last <= head else ""
    state.save()
    log.warning("Reorg on chain %s: rewound to block %s", cfg.chain_id, new_last)
    return True


def index_chain(cfg: ChainConfig, client: ChainClient) -> IndexResult:
    result = IndexResult()
    state, _ = IndexerState.objects.get_or_create(
        chain_id=cfg.chain_id, address=cfg.address, defaults={"last_block": cfg.start_block - 1}
    )
    head = client.head()
    head_block = client.block(head)
    state.head_block, state.head_time, state.last_error = head, head_block["timestamp"], ""
    state.save(update_fields=["head_block", "head_time", "last_error", "updated_at"])

    result.reorged = _reconcile(cfg, state, client, head)
    safe = head - cfg.confirmations

    for _ in range(settings.INDEX_MAX_CHUNKS_PER_RUN):
        start = state.last_block + 1
        if start > safe:
            break
        end = min(start + settings.INDEX_CHUNK_BLOCKS - 1, safe)
        raw = client.events(start, end)
        end_hash = client.block(end)["hash"]

        block_meta: dict[int, dict] = {}
        for e in raw:
            if e.block_number not in block_meta:
                block_meta[e.block_number] = client.block(e.block_number)
        scope = ChainEvent.objects.filter(chain_id=cfg.chain_id, address=cfg.address)
        claim_to_asset = {int(e.args["claimId"]): int(e.args["assetId"]) for e in raw if e.name == "ClaimRaised"}

        rows = []
        for e in raw:
            if "claimId" in e.args and int(e.args["claimId"]) not in claim_to_asset:
                known = scope.filter(event_name="ClaimRaised", claim_id=int(e.args["claimId"])).values_list("asset_id", flat=True).first()
                if known is not None:
                    claim_to_asset[int(e.args["claimId"])] = known
            sender = client.tx_from(e.tx_hash)
            rows.append(ChainEvent(
                chain_id=cfg.chain_id, address=cfg.address, block_number=e.block_number, block_hash=e.block_hash,
                timestamp=block_meta[e.block_number]["timestamp"], tx_hash=e.tx_hash, log_index=e.log_index,
                event_name=e.name, args=e.args, tx_from=sender, **columns_for(e, sender, claim_to_asset),
            ))

        with transaction.atomic():
            locked = IndexerState.objects.select_for_update().get(pk=state.pk)
            if locked.last_block != start - 1:
                break  # another worker advanced the same deployment; let it finish
            ChainEvent.objects.bulk_create(rows, ignore_conflicts=True)
            locked.last_block, locked.last_block_hash = end, end_hash
            locked.save(update_fields=["last_block", "last_block_hash", "updated_at"])
        state.last_block, state.last_block_hash = end, end_hash
        result.events += len(rows)
        result.from_block = result.from_block or start
        result.to_block = end
    return result
