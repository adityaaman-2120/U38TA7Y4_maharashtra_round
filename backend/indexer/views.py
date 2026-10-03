from datetime import timedelta

from django.conf import settings
from django.db.models import Q
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.addresses import checksum, normalize_address

from .chains import current_deployments
from .models import ChainEvent, IndexerState


def _int(value, default=None):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


class EventListView(APIView):
    """Indexed contract events, newest first. Chain data is public; this is simply a fast, filterable copy of it."""

    throttle_scope = "default"

    def get(self, request):
        q = request.query_params
        live = current_deployments()
        qs = ChainEvent.objects.none()
        scope = Q(pk__in=[])
        for chain_id, address in live:
            scope |= Q(chain_id=chain_id, address=address)
        qs = ChainEvent.objects.filter(scope)

        if (chain := _int(q.get("chain_id"))) is not None:
            qs = qs.filter(chain_id=chain)
        if (asset := _int(q.get("asset_id"))) is not None:
            qs = qs.filter(asset_id=asset)
        if (claim := _int(q.get("claim_id"))) is not None:
            qs = qs.filter(claim_id=claim)
        if q.get("event"):
            qs = qs.filter(event_name=q["event"])
        if q.get("actor"):
            actor = normalize_address(q["actor"])
            if actor is None:
                return Response({"detail": "actor must be an Ethereum address."}, status=400)
            qs = qs.filter(participants__contains=f",{actor},")
        if (before := _int(q.get("before_id"))) is not None:
            qs = qs.filter(pk__lt=before)

        limit = min(max(_int(q.get("limit"), 200), 1), 500)
        rows = list(qs.order_by("-pk")[: limit + 1])
        more = len(rows) > limit
        rows = rows[:limit]

        stale_after = timedelta(seconds=settings.INDEX_STALE_AFTER_SECONDS)
        now = timezone.now()
        states = [
            {
                "chain_id": s.chain_id, "last_block": s.last_block, "head_block": s.head_block,
                "lag_blocks": max(0, s.head_block - s.last_block), "updated_at": s.updated_at,
                "stale": now - s.updated_at > stale_after, "error": s.last_error or None,
            }
            for s in IndexerState.objects.all()
            if (s.chain_id, s.address) in set(live)
        ]
        return Response({
            "results": [
                {
                    "id": e.pk, "chain_id": e.chain_id, "block_number": e.block_number, "tx_hash": e.tx_hash, "log_index": e.log_index,
                    "event_name": e.event_name, "args": e.args, "timestamp": e.timestamp,
                    "actor": checksum(e.tx_from) if e.tx_from else None, "asset_id": e.asset_id, "claim_id": e.claim_id,
                }
                for e in rows
            ],
            "next_before_id": rows[-1].pk if more and rows else None,
            "indexer": states,
        })
