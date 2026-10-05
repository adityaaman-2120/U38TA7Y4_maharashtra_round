"""The only module that talks to a node. The service depends on this small interface, so tests swap in a fake."""
from dataclasses import dataclass
from typing import Any, Protocol

from .chains import ChainConfig, load_abi


@dataclass(frozen=True)
class RawEvent:
    name: str
    args: dict[str, Any]  # JSON-safe
    block_number: int
    block_hash: str
    tx_hash: str
    log_index: int


class ChainClient(Protocol):
    def head(self) -> int: ...
    def block(self, number: int) -> dict: ...  # {"hash": str, "timestamp": int}
    def events(self, from_block: int, to_block: int) -> list[RawEvent]: ...
    def tx_from(self, tx_hash: str) -> str: ...
    def asset_policy(self, asset_id: int) -> dict: ...  # attestationDeadline, challengePeriod, requiredApprovals, ...
    def claim_invalidated(self, claim_id: int) -> bool: ...  # the owner checked in after the claim was raised


def _policy_from_asset(abi: list, asset) -> dict:
    """The Asset struct comes back from web3 as a tuple. Field names are read from the ABI, so adding a policy field to the
    contract cannot silently shift or break this."""
    fn = next(e for e in abi if e.get("type") == "function" and e["name"] == "getAsset")
    fields = fn["outputs"][0]["components"]
    index = next(i for i, c in enumerate(fields) if c["name"] == "policy")
    names = [c["name"] for c in fields[index]["components"]]
    return dict(zip(names, (int(x) for x in asset[index]), strict=True))


def _hex(x) -> str:
    return "0x" + bytes(x).hex()


def _json_safe(value):
    """Decoded log values -> JSON: bytes as 0x-hex, huge ints as strings (JS cannot hold them), recursively."""
    if isinstance(value, (bytes, bytearray)):
        return "0x" + bytes(value).hex()
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return value if abs(value) < 2**53 else str(value)
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    if isinstance(value, dict):
        return {k: _json_safe(v) for k, v in value.items()}
    return value


class Web3Client:
    def __init__(self, cfg: ChainConfig):
        from eth_utils import event_abi_to_log_topic, to_checksum_address
        from web3 import Web3

        self.cfg = cfg
        self.w3 = Web3(Web3.HTTPProvider(cfg.rpc_url, request_kwargs={"timeout": 20}))
        # eth_getLogs can go to a different endpoint when the main one limits its block range.
        self.logs_w3 = Web3(Web3.HTTPProvider(cfg.logs_rpc_url, request_kwargs={"timeout": 20})) if cfg.logs_rpc_url else self.w3
        self.address = to_checksum_address(cfg.address)
        abi = load_abi()
        self.contract = self.w3.eth.contract(address=self.address, abi=abi)
        self.by_topic = {_hex(event_abi_to_log_topic(e)): e for e in abi if e["type"] == "event"}
        self._tx_cache: dict[str, str] = {}

    def head(self) -> int:
        return self.w3.eth.block_number

    def block(self, number: int) -> dict:
        b = self.w3.eth.get_block(number)
        return {"hash": _hex(b["hash"]), "timestamp": int(b["timestamp"])}

    def events(self, from_block: int, to_block: int) -> list[RawEvent]:
        from web3._utils.events import get_event_data

        logs = self.logs_w3.eth.get_logs({"address": self.address, "fromBlock": from_block, "toBlock": to_block})
        out = []
        for log in logs:
            topic0 = _hex(log["topics"][0]) if log["topics"] else ""
            abi = self.by_topic.get(topic0)
            if abi is None:
                continue  # not one of ours (e.g. an ABI older than the deployed contract)
            data = get_event_data(self.w3.codec, abi, log)
            out.append(RawEvent(abi["name"], _json_safe(dict(data["args"])), int(log["blockNumber"]), _hex(log["blockHash"]), _hex(log["transactionHash"]), int(log["logIndex"])))
        return out

    def tx_from(self, tx_hash: str) -> str:
        if tx_hash not in self._tx_cache:
            self._tx_cache[tx_hash] = self.w3.eth.get_transaction(tx_hash)["from"].lower()
        return self._tx_cache[tx_hash]

    def asset_policy(self, asset_id: int) -> dict:
        return _policy_from_asset(self.contract.abi, self.contract.functions.getAsset(asset_id).call())

    def claim_invalidated(self, claim_id: int) -> bool:
        return bool(self.contract.functions.isClaimInvalidated(claim_id).call())
