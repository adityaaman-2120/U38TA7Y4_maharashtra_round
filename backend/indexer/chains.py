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


def load_abi() -> list:
    abi = json.loads((settings.CHAIN_DIR / "Heirloom.abi.json").read_text(encoding="utf-8"))
    # ethers omits `"indexed": false` from event inputs; web3.py insists on it.
    for entry in abi:
        if entry.get("type") == "event":
            for i in entry["inputs"]:
                i.setdefault("indexed", False)
    return abi


def load_chains() -> list[ChainConfig]:
    path = settings.CHAIN_DIR / "deployments.json"
    if not path.exists():
        return []
    out = []
    for chain_id, d in json.loads(path.read_text(encoding="utf-8")).items():
        chain_id = int(chain_id)
        rpc = settings.RPC_URLS.get(chain_id)
        if not rpc:
            continue  # a deployment on a chain we have no endpoint for
        out.append(ChainConfig(chain_id, d["address"].lower(), int(d["startBlock"]), rpc, settings.CONFIRMATIONS.get(chain_id, 12)))
    return out


def current_deployments() -> list[tuple[int, str]]:
    """(chain_id, address) pairs that are live right now; older local deployments are ignored by the API."""
    return [(c.chain_id, c.address) for c in load_chains()]
