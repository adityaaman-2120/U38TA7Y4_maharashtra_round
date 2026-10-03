from django.conf import settings
from django.db import models


class EncryptedKeyBlob(models.Model):
    """A user's encryption private key, sealed in the browser (PBKDF2-SHA256 -> AES-256-GCM).

    The server stores it opaquely so the user can sign in from another device. It cannot decrypt it: the password
    never leaves the browser. `public_key` duplicates the (public) key inside the blob for lookups.
    """

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="key_blob")
    blob = models.JSONField()
    public_key = models.CharField(max_length=132)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f"key blob of {self.user_id}"
