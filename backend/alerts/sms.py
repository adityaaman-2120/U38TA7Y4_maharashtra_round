"""SMS delivery. The backend is chosen by settings.SMS_BACKEND, so tests and other providers swap in without touching callers."""
import requests
from django.conf import settings
from django.utils.module_loading import import_string


class SmsError(Exception):
    """Delivery failed. The message never contains the phone number or the text."""


class TwilioBackend:
    API = "https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json"

    def available(self) -> bool:
        return bool(settings.TWILIO_ACCOUNT_SID and settings.TWILIO_AUTH_TOKEN and settings.TWILIO_FROM_NUMBER)

    def send(self, to: str, body: str) -> str:
        """Returns the provider's message id."""
        if not self.available():
            raise SmsError("sms_unavailable")
        try:
            r = requests.post(
                self.API.format(sid=settings.TWILIO_ACCOUNT_SID),
                data={"To": to, "From": settings.TWILIO_FROM_NUMBER, "Body": body},
                auth=(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN),
                timeout=10,
            )
        except requests.RequestException as e:
            raise SmsError(f"network:{type(e).__name__}") from None  # the exception text can echo the request, so drop it
        if r.status_code >= 300:
            raise SmsError(f"provider_status:{r.status_code}")
        return str(r.json().get("sid", ""))[:64]


def get_backend():
    return import_string(settings.SMS_BACKEND)()
