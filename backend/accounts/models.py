from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager
from django.db import models

from .addresses import checksum


class UserManager(BaseUserManager):
    def create_for_address(self, address: str) -> "User":
        user = self.model(address=address)
        user.set_unusable_password()  # wallet signatures are the only credential
        user.save(using=self._db)
        return user


class User(AbstractBaseUser):
    """Off-chain profile of a wallet. Name, email and phone never go on-chain."""

    address = models.CharField(max_length=42, unique=True)  # lower-case 0x…
    name = models.CharField(max_length=80, blank=True)
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=24, blank=True)
    email_verified_at = models.DateTimeField(null=True, blank=True)  # cleared whenever the email changes
    phone_verified_at = models.DateTimeField(null=True, blank=True)  # cleared whenever the phone changes
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    session_version = models.PositiveIntegerField(default=0)  # bumped on logout to revoke issued JWTs

    objects = UserManager()
    USERNAME_FIELD = "address"
    REQUIRED_FIELDS: list[str] = []

    def __str__(self) -> str:
        return self.address

    @property
    def checksum_address(self) -> str:
        return checksum(self.address)

    @property
    def email_verified(self) -> bool:
        return bool(self.email and self.email_verified_at)

    @property
    def phone_verified(self) -> bool:
        return bool(self.phone and self.phone_verified_at)

    @property
    def profile_complete(self) -> bool:
        return bool(self.name.strip() and self.email.strip())
