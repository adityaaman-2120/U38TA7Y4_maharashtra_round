import hmac
import logging

import requests
from django.conf import settings
from django.db import connection
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST

from indexer.chains import load_chains

from .tick import run_tick

log = logging.getLogger(__name__)


@csrf_exempt  # not a browser endpoint: it is authenticated by a shared secret header, not a cookie
@require_POST
def tick(request):
    """POST /internal/tick with `X-Tick-Secret`. Called by the external scheduler (cron-job.org) every minute."""
    secret = settings.TICK_SECRET
    if not secret:
        return JsonResponse({"detail": "The scheduler tick is not configured."}, status=503)
    provided = request.headers.get("X-Tick-Secret", "")
    # constant-time comparison, so the secret cannot be guessed byte by byte from response timing
    if not hmac.compare_digest(provided.encode(), secret.encode()):
        return JsonResponse({"detail": "Forbidden."}, status=403)
    return JsonResponse({"ok": True, **run_tick()})


def _rpc_up(url: str) -> bool:
    try:
        r = requests.post(url, json={"jsonrpc": "2.0", "id": 1, "method": "eth_blockNumber", "params": []}, timeout=5)
        return r.ok and "result" in r.json()
    except Exception:
        return False


@require_GET
def health(request):
    """GET /health: the database and every configured chain's RPC. 503 only when the database is down (the app cannot work
    at all); an RPC outage is reported as "degraded" with 200, so a flaky RPC provider never gets the service restarted."""
    try:
        with connection.cursor() as cur:
            cur.execute("SELECT 1")
            cur.fetchone()
        db = True
    except Exception:
        db = False
    rpc = {str(c.chain_id): _rpc_up(c.rpc_url) for c in load_chains()}
    status = "ok" if db and all(rpc.values()) else ("degraded" if db else "down")
    return JsonResponse({"status": status, "db": db, "rpc": rpc}, status=200 if db else 503)
