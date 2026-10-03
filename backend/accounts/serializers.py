import re
from urllib.parse import urlparse

from django.conf import settings
from rest_framework import serializers

from .addresses import normalize_address
from .models import User

PHONE_RE = re.compile(r"^\+?[0-9 ()\-]{7,20}$")


class AddressField(serializers.CharField):
    def to_internal_value(self, data):
        value = normalize_address(super().to_internal_value(data))
        if value is None:
            raise serializers.ValidationError("Enter a valid Ethereum address.")
        return value


class NonceRequestSerializer(serializers.Serializer):
    address = AddressField()
    chain_id = serializers.IntegerField()
    uri = serializers.CharField(max_length=200)  # the frontend origin, e.g. http://localhost:3000

    def validate_chain_id(self, value):
        if value not in settings.SIWE_CHAIN_IDS:
            raise serializers.ValidationError("Unsupported chain.")
        return value

    def validate_uri(self, value):
        value = value.rstrip("/")
        if value not in settings.ALLOWED_ORIGINS or urlparse(value).netloc not in settings.SIWE_ALLOWED_DOMAINS:
            raise serializers.ValidationError("Origin not allowed.")
        return value


class VerifyRequestSerializer(serializers.Serializer):
    address = AddressField()
    signature = serializers.RegexField(r"^0x[0-9a-fA-F]{130}$", max_length=132)


class UserSerializer(serializers.ModelSerializer):
    address = serializers.CharField(source="checksum_address", read_only=True)
    profile_complete = serializers.BooleanField(read_only=True)
    has_key = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["address", "name", "email", "phone", "profile_complete", "has_key", "created_at"]
        read_only_fields = ["created_at"]

    def get_has_key(self, user) -> bool:
        return hasattr(user, "key_blob")


class ProfileUpdateSerializer(serializers.Serializer):
    name = serializers.CharField(min_length=1, max_length=80)
    email = serializers.EmailField(max_length=254)
    phone = serializers.CharField(required=False, allow_blank=True, max_length=24)

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Name is required.")
        return value

    def validate_email(self, value):
        return value.strip().lower()

    def validate_phone(self, value):
        value = value.strip()
        if value and not PHONE_RE.match(value):
            raise serializers.ValidationError("Enter a valid phone number.")
        return value
