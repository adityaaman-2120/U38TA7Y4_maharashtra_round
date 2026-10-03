from eth_utils import is_address, is_checksum_address, to_checksum_address


def normalize_address(value: str) -> str | None:
    """Lower-case 0x address, or None if invalid (a wrong EIP-55 checksum counts as invalid)."""
    if not isinstance(value, str) or not value.startswith("0x") or len(value) != 42:
        return None
    if not is_address(value):
        return None
    body = value[2:]
    if body != body.lower() and body != body.upper() and not is_checksum_address(value):
        return None  # mixed case promises an EIP-55 checksum; a wrong one means a typo
    return value.lower()


def checksum(address: str) -> str:
    return to_checksum_address(address)
