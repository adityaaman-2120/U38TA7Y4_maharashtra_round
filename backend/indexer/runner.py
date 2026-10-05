"""Indexes every configured chain, as plain function calls (the scheduler's tick calls this; there is no task queue)."""
import logging
import time

from .chains import load_chains
from .client import Web3Client
from .models import IndexerState
from .service import index_chain

log = logging.getLogger(__name__)


def index_all(deadline: float | None = None) -> dict:
    """One pass over every chain. A chain that fails (RPC down) is recorded and does not stop the others.
    `deadline` is a time.monotonic() value: no new block range is started after it."""
    summary: dict = {}
    for cfg in load_chains():
        if deadline is not None and time.monotonic() >= deadline:
            summary[cfg.chain_id] = {"skipped": "out of time"}
            continue
        try:
            r = index_chain(cfg, Web3Client(cfg), deadline)
            summary[cfg.chain_id] = {"events": r.events, "to": r.to_block, "reorged": r.reorged}
        except Exception as e:  # one unreachable chain must not stop the others
            log.warning("Indexing chain %s failed: %s", cfg.chain_id, type(e).__name__)
            IndexerState.objects.filter(chain_id=cfg.chain_id, address=cfg.address).update(last_error=f"{type(e).__name__}: {str(e)[:300]}")
            summary[cfg.chain_id] = {"error": type(e).__name__}
    return summary
