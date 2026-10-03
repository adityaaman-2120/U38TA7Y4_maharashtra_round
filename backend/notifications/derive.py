"""Facts about vaults, assets and claims, derived purely from the indexed events (no RPC needed)."""
from django.db.models import Q

from accounts.models import User
from indexer.models import ChainEvent


def scope(chain_id: int, address: str):
    return ChainEvent.objects.filter(chain_id=chain_id, address=address)


def asset_added(ev: ChainEvent) -> ChainEvent | None:
    if ev.asset_id is None:
        return None
    return scope(ev.chain_id, ev.address).filter(event_name="AssetAdded", asset_id=ev.asset_id).first()


def is_crypto(chain_id: int, address: str, asset_id: int | None) -> bool:
    """A crypto asset (funds, not a file) is recognisable by its first deposit event."""
    return asset_id is not None and scope(chain_id, address).filter(event_name="CryptoDeposited", asset_id=asset_id).exists()


def claim_raised(chain_id: int, address: str, claim_id: int) -> ChainEvent | None:
    return scope(chain_id, address).filter(event_name="ClaimRaised", claim_id=claim_id).first()


def guardians_at(raised: ChainEvent, owner: str) -> list[str]:
    """The vault's guardians when the claim was raised (the contract snapshots them into the claim)."""
    latest = (
        scope(raised.chain_id, raised.address)
        .filter(event_name__in=["VaultCreated", "GuardiansRotated"], owner=owner)
        .filter(Q(block_number__lt=raised.block_number) | Q(block_number=raised.block_number, log_index__lt=raised.log_index))
        .order_by("-block_number", "-log_index")
        .first()
    )
    return [g.lower() for g in latest.args["guardians"]] if latest else []


def users_by_address(addresses) -> dict[str, User]:
    wanted = {a.lower() for a in addresses if a}
    return {u.address: u for u in User.objects.filter(address__in=wanted)}


def display_name(address: str, users: dict[str, User]) -> str:
    u = users.get(address.lower())
    return u.name if u and u.name else f"{address[:6]}…{address[-4:]}"
