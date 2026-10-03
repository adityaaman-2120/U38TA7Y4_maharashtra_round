"""Builds a node client for a deployed contract. One place, so callers (and tests) can swap it."""
from .chains import load_chains
from .client import ChainClient, Web3Client


def get_client(chain_id: int, address: str) -> ChainClient:
    for cfg in load_chains():
        if cfg.chain_id == chain_id and cfg.address == address.lower():
            return Web3Client(cfg)
    raise LookupError("no deployment configured for this contract")
