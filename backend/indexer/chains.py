"""Which contracts to index. deployments.json is written by contracts/scripts/deploy.js."""
import json
from dataclasses import dataclass

from django.conf import settings


@dataclass(frozen=True)
class ChainConfig:
    chain_id: int
    address: str  # lower-case
    start_block: int
    rpc_url: str
    confirmations: int
    logs_rpc_url: str = ""  # optional endpoint used only for eth_getLogs (some free RPC plans cap its block range)
    chunk_blocks: int = 0  # blocks per getLogs call; 0 = settings.INDEX_CHUNK_BLOCKS


def load_abi() -> list:
    abi = json.loads((settings.CHAIN_DIR / "Heirloom.abi.json").read_text(encoding="utf-8"))
    # ethers omits `"indexed": false` from event inputs; web3.py insists on it.
    for entry in abi:
        if entry.get("type") == "event":
            for i in entry["inputs"]:
                i.setdefault("indexed", False)
    return abi


def _deployments() -> dict:
    """Public networks from deployments.json (committed), overlaid with a local dev chain from deployments.local.json (git-ignored)."""
    merged: dict = {}
    for name in ("deployments.json", "deployments.local.json"):
        path = settings.CHAIN_DIR / name
        if path.exists():
            merged.update(json.loads(path.read_text(encoding="utf-8")))
    return merged


def load_chains() -> list[ChainConfig]:
    out = []
    for chain_id, d in _deployments().items():
        chain_id = int(chain_id)
        if settings.ACTIVE_CHAIN_IDS and chain_id not in settings.ACTIVE_CHAIN_IDS:
            continue  # this environment only watches some of the deployed chains
        rpc = settings.RPC_URLS.get(chain_id)
        if not rpc:
            continue  # a deployment on a chain we have no endpoint for
        out.append(ChainConfig(
            chain_id, d["address"].lower(), int(d["startBlock"]), rpc, settings.CONFIRMATIONS.get(chain_id, 12),
            logs_rpc_url=settings.LOGS_RPC_URLS.get(chain_id, ""), chunk_blocks=settings.INDEX_CHUNK_BLOCKS_BY_CHAIN.get(chain_id, 0),
        ))
    return out


def current_deployments() -> list[tuple[int, str]]:
    """(chain_id, address) pairs that are live right now; older local deployments are ignored by the API."""
    return [(c.chain_id, c.address) for c in load_chains()]
