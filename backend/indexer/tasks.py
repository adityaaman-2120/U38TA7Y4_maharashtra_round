import logging

from celery import shared_task
from django.core.cache import cache

from .chains import load_chains
from .client import Web3Client
from .models import IndexerState
from .service import index_chain

log = logging.getLogger(__name__)
LOCK = "lock:indexer"


@shared_task(name="indexer.index_all_chains")
def index_all_chains() -> dict:
    """Beat runs this every few seconds. The lock keeps slow runs from piling up on each other."""
    if not cache.add(LOCK, 1, timeout=120):
        return {"skipped": True}
    from notifications.notify import process_pending_events

    summary = {}
    try:
        for cfg in load_chains():
            try:
                r = index_chain(cfg, Web3Client(cfg))
                summary[cfg.chain_id] = {"events": r.events, "to": r.to_block, "reorged": r.reorged}
            except Exception as e:  # one unreachable chain must not stop the others
                log.exception("Indexing chain %s failed", cfg.chain_id)
                IndexerState.objects.filter(chain_id=cfg.chain_id, address=cfg.address).update(last_error=str(e)[:500])
                summary[cfg.chain_id] = {"error": str(e)[:200]}
        summary["notified"] = process_pending_events()
    finally:
        cache.delete(LOCK)
    return summary
