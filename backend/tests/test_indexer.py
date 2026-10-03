from dataclasses import replace

from django.test import TestCase, override_settings

from indexer.models import ChainEvent, IndexerState

from .chainfake import CFG, T0, FakeChain, addr, ingest, raise_claim, scenario


class IndexerTests(TestCase):
    def setUp(self):
        self.o, self.g1, self.g2, self.g3, self.b = (addr() for _ in range(5))
        self.chain = FakeChain()
        scenario(self.chain, self.o, [self.g1, self.g2, self.g3], self.b)

    def events(self):
        return list(ChainEvent.objects.order_by("block_number", "log_index"))

    def test_indexes_logs_with_metadata(self):
        raise_claim(self.chain, self.b, 5)
        self.chain.emit("Attested", {"claimId": 1, "guardian": self.g1, "approvals": 1}, 6, self.g1)
        r = ingest(self.chain)
        self.assertEqual(r.events, 4)
        vault, asset, raised, attested = self.events()
        self.assertEqual((vault.event_name, vault.owner, vault.timestamp, vault.tx_from), ("VaultCreated", self.o.lower(), T0 + 10, self.o.lower()))
        self.assertEqual(asset.asset_id, 0)
        self.assertEqual((raised.claim_id, raised.asset_id), (1, 0))
        self.assertEqual((attested.claim_id, attested.asset_id), (1, 0))  # asset resolved from the claim
        self.assertIn(f",{self.g1.lower()},", attested.participants)
        self.assertTrue(vault.participants.startswith(",") and vault.participants.endswith(","))
        state = IndexerState.objects.get()
        self.assertEqual((state.last_block, state.head_block, state.head_time), (6, 6, T0 + 60))
        self.assertFalse(any(e.processed for e in self.events()))

    def test_idempotent_even_after_a_crash_before_progress_was_saved(self):
        raise_claim(self.chain, self.b, 5)
        ingest(self.chain)
        ingest(self.chain)
        self.assertEqual(ChainEvent.objects.count(), 3)
        IndexerState.objects.update(last_block=0, last_block_hash="")  # progress lost: everything is replayed
        ingest(self.chain)
        self.assertEqual(ChainEvent.objects.count(), 3)

    def test_resumes_from_last_block_and_chunks(self):
        with override_settings(INDEX_CHUNK_BLOCKS=2):
            ingest(self.chain)
            self.assertEqual(IndexerState.objects.get().last_block, 2)
            raise_claim(self.chain, self.b, 9)
            r = ingest(self.chain)
        self.assertEqual((r.from_block, r.to_block, r.events), (3, 9, 1))
        self.assertEqual(ChainEvent.objects.count(), 3)

    def test_waits_for_confirmations(self):
        cfg = replace(CFG, confirmations=5)
        raise_claim(self.chain, self.b, 8)  # head = 8, so only blocks <= 3 are buried deep enough
        ingest(self.chain, cfg)
        self.assertEqual(sorted(e.event_name for e in self.events()), ["AssetAdded", "VaultCreated"])
        self.assertEqual(IndexerState.objects.get().last_block, 3)
        self.chain.head_n = 12  # block 8 now has 4 blocks on top: still not enough
        ingest(self.chain, cfg)
        self.assertEqual(ChainEvent.objects.count(), 2)
        self.chain.head_n = 13
        ingest(self.chain, cfg)
        self.assertEqual(ChainEvent.objects.count(), 3)

    def test_reorg_drops_orphaned_rows_and_reindexes_the_new_fork(self):
        raise_claim(self.chain, self.b, 5)
        self.chain.emit("Attested", {"claimId": 1, "guardian": self.g1, "approvals": 1}, 6, self.g1)
        ingest(self.chain)
        self.chain.reorg(6)  # block 6 onwards replaced
        self.chain.emit("FraudFlagged", {"claimId": 1, "guardian": self.g2}, 6, self.g2)
        self.chain.emit("ClaimCancelled", {"claimId": 1, "owner": self.o}, 7, self.o)
        r = ingest(self.chain)
        names = [e.event_name for e in self.events()]
        self.assertTrue(r.reorged)
        self.assertNotIn("Attested", names)
        self.assertEqual(names[-2:], ["FraudFlagged", "ClaimCancelled"])
        self.assertEqual(IndexerState.objects.get().last_block, 7)
        self.assertEqual(len(self.events()), 5)  # blocks before the fork were kept, not re-created
        self.assertTrue(all(e.block_hash.startswith("0xb") for e in self.events() if e.block_number >= 6))

    def test_local_chain_reset_starts_over(self):
        raise_claim(self.chain, self.b, 5)
        ingest(self.chain)
        fresh = FakeChain(salt="z")  # node restarted: shorter, different chain
        fresh.emit("EncryptionKeyRegistered", {"account": self.o, "pubKey": "0x04"}, 1, self.o)
        r = ingest(fresh)
        self.assertTrue(r.reorged)
        self.assertEqual([e.event_name for e in self.events()], ["EncryptionKeyRegistered"])
        self.assertEqual(IndexerState.objects.get().last_block, 1)

    def test_large_numbers_survive_json(self):
        from indexer.client import _json_safe

        self.assertEqual(_json_safe({"a": 2**64, "b": [b"\x01\x02"], "c": 5}), {"a": str(2**64), "b": ["0x0102"], "c": 5})


class AbiTests(TestCase):
    def test_abi_from_ethers_without_indexed_flags_is_normalised(self):
        import json
        import tempfile
        from pathlib import Path

        abi = [{"type": "event", "name": "E", "inputs": [{"name": "a", "type": "uint256"}, {"name": "b", "type": "address", "indexed": True}]}]
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "Heirloom.abi.json").write_text(json.dumps(abi))
            with override_settings(CHAIN_DIR=Path(d)):
                from indexer.chains import load_abi

                inputs = load_abi()[0]["inputs"]
        self.assertEqual([i["indexed"] for i in inputs], [False, True])


class RealAbiDecodingTests(TestCase):
    """The fake chain skips web3 entirely, so decode a hand-built log with the ABI that actually ships."""

    def test_every_contract_event_is_known_and_a_real_log_decodes(self):
        from unittest import mock

        from eth_abi import encode
        from hexbytes import HexBytes

        from indexer.client import Web3Client

        client = Web3Client(replace(CFG, rpc_url="http://127.0.0.1:1"))
        names = {e["name"] for e in client.by_topic.values()}
        self.assertEqual(len(names), 16)
        self.assertTrue({"VaultCreated", "ClaimRaised", "Attested", "ShareReleased", "FraudFlagged", "PanicFrozen"} <= names)

        owner, guardians = addr(), [addr() for _ in range(3)]
        topic = next(t for t, e in client.by_topic.items() if e["name"] == "VaultCreated")
        log = {
            "topics": [HexBytes(topic), HexBytes("0x" + "00" * 12 + owner[2:])],
            "data": HexBytes(encode(["address[]", "uint8", "uint64"], [guardians, 2, 600])),
            "address": client.address, "blockNumber": 5, "blockHash": HexBytes(b"\x01" * 32),
            "transactionHash": HexBytes(b"\x02" * 32), "logIndex": 3, "transactionIndex": 0, "removed": False,
        }
        with mock.patch.object(client.w3.eth, "get_logs", return_value=[log]):
            (ev,) = client.events(5, 5)
        self.assertEqual((ev.name, ev.block_number, ev.log_index), ("VaultCreated", 5, 3))
        self.assertEqual(ev.args, {"owner": owner, "guardians": guardians, "threshold": 2, "heartbeatInterval": 600})
        self.assertEqual(ev.tx_hash, "0x" + "02" * 32)
