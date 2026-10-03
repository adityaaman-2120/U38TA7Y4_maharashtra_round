"""A scriptable stand-in for a node, implementing the indexer's ChainClient interface."""
import tempfile
from pathlib import Path

from eth_account import Account

from accounts.models import User
from indexer.chains import ChainConfig
from indexer.client import RawEvent
from indexer.service import index_chain

CFG = ChainConfig(chain_id=31337, address="0x" + "c0" * 20, start_block=1, rpc_url="fake", confirmations=0)
T0 = 1_700_000_000
# Tests must not see the real backend/chain/deployments.json that deploys write.
EMPTY_CHAIN_DIR = Path(tempfile.mkdtemp(prefix="heirloom-test-chain-"))


class FakeChain:
    def __init__(self, head=0, salt="a"):
        self.head_n = head
        self.salt = salt
        self.fork_from = None  # blocks >= this number carry fork_salt in their hash
        self.fork_salt = salt
        self.events_list: list[RawEvent] = []
        self.senders: dict[str, str] = {}
        self.policies: dict[int, dict] = {}
        self.fail_policy = False
        self.time_offset = 0  # lets a test move the head time without mining

    # -- ChainClient --------------------------------------------------------------------------
    def head(self):
        return self.head_n

    def _hash(self, n):
        salt = self.fork_salt if self.fork_from is not None and n >= self.fork_from else self.salt
        return f"0x{salt}{n:063x}"

    def block(self, n):
        if n > self.head_n:
            raise KeyError(n)
        return {"hash": self._hash(n), "timestamp": T0 + n * 10 + (self.time_offset if n == self.head_n else 0)}

    def events(self, a, b):
        return [RawEvent(e.name, e.args, e.block_number, self._hash(e.block_number), e.tx_hash, e.log_index) for e in self.events_list if a <= e.block_number <= b]

    def tx_from(self, tx_hash):
        return self.senders.get(tx_hash, "0x" + "00" * 20)

    def asset_policy(self, asset_id):
        if self.fail_policy:
            raise RuntimeError("rpc down")
        return self.policies[asset_id]

    # -- scripting ----------------------------------------------------------------------------
    def emit(self, name, args, block, sender, log_index=0):
        tx = f"0x{len(self.events_list) + 1:064x}"
        self.senders[tx] = sender.lower()
        self.events_list.append(RawEvent(name, args, block, "", tx, log_index))
        self.head_n = max(self.head_n, block)

    def reorg(self, from_block, new_salt="b"):
        """Everything from `from_block` on gets new hashes and is dropped, as if replaced by a different fork."""
        self.events_list = [e for e in self.events_list if e.block_number < from_block]
        self.fork_from, self.fork_salt = from_block, new_salt


def addr():
    return Account.create().address


def user(address, name="", email=""):
    u = User.objects.create_for_address(address.lower())
    u.name, u.email = name, email
    u.save()
    return u


def ingest(chain, cfg=CFG):
    return index_chain(cfg, chain)


def scenario(chain, owner, guardians, beneficiary, *, interval=1000, start_block=1):
    """Vault + one asset, as the contract would have emitted them."""
    chain.emit("VaultCreated", {"owner": owner, "guardians": guardians, "threshold": 2, "heartbeatInterval": interval}, start_block, owner)
    chain.emit("AssetAdded", {"assetId": 0, "owner": owner, "beneficiary": beneficiary, "storageId": "cid", "contentHash": "0x" + "11" * 32}, start_block + 1, owner)
    chain.policies[0] = {"requiredApprovals": 2, "challengePeriod": 600, "minInactivity": 600, "unlockAfter": 0, "evidenceType": 2, "attestationDeadline": 1000}


def raise_claim(chain, claimant, block, claim_id=1):
    chain.emit("ClaimRaised", {"claimId": claim_id, "assetId": 0, "claimant": claimant, "evidenceType": 0, "evidenceHash": "0x" + "22" * 32, "evidenceStorageId": "ev"}, block, claimant)
