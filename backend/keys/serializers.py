import base64
import binascii

from rest_framework import serializers

MIN_ITERATIONS = 600_000
MAX_ITERATIONS = 5_000_000


def _b64_len(value: str, expected: int, field: str) -> None:
    try:
        raw = base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError):
        raise serializers.ValidationError(f"{field} must be base64.") from None
    if len(raw) != expected:
        raise serializers.ValidationError(f"{field} has the wrong length.")


def _exact_keys(data: dict, keys: set[str], where: str) -> None:
    if not isinstance(data, dict) or set(data) != keys:
        raise serializers.ValidationError(f"{where} has unexpected fields.")


def validate_blob(blob: dict, address: str) -> str:
    """Strictly validates the sealed-key format and returns its public key.

    The fixed lengths matter: a 32-byte private key can never pass as ciphertext (32 bytes + 16-byte GCM tag
    = 48), so a client bug cannot accidentally upload a plaintext key.
    """
    _exact_keys(blob, {"v", "address", "publicKey", "kdf", "cipher"}, "blob")
    if blob["v"] != 1:
        raise serializers.ValidationError("Unsupported blob version.")
    if not isinstance(blob["address"], str) or blob["address"].lower() != address:
        raise serializers.ValidationError("Blob belongs to a different address.")
    public_key = blob["publicKey"]
    if not isinstance(public_key, str) or len(public_key) != 132 or not public_key.startswith("0x04"):
        raise serializers.ValidationError("publicKey must be an uncompressed secp256k1 key.")
    try:
        int(public_key[2:], 16)
    except ValueError:
        raise serializers.ValidationError("publicKey must be hex.") from None

    kdf, cipher = blob["kdf"], blob["cipher"]
    _exact_keys(kdf, {"name", "iterations", "salt"}, "kdf")
    _exact_keys(cipher, {"name", "iv", "ct"}, "cipher")
    if kdf["name"] != "PBKDF2-SHA256" or cipher["name"] != "AES-256-GCM":
        raise serializers.ValidationError("Unsupported algorithms.")
    iterations = kdf["iterations"]
    if isinstance(iterations, bool) or not isinstance(iterations, int) or not MIN_ITERATIONS <= iterations <= MAX_ITERATIONS:
        raise serializers.ValidationError(f"kdf.iterations must be between {MIN_ITERATIONS} and {MAX_ITERATIONS}.")
    for field, value, size in (("kdf.salt", kdf["salt"], 16), ("cipher.iv", cipher["iv"], 12), ("cipher.ct", cipher["ct"], 48)):
        if not isinstance(value, str):
            raise serializers.ValidationError(f"{field} must be a string.")
        _b64_len(value, size, field)
    return public_key.lower()


class KeyBlobSerializer(serializers.Serializer):
    blob = serializers.JSONField()

    def validate_blob(self, value):
        self.public_key = validate_blob(value, self.context["address"])
        return value
