"""Django email backend that sends through the Resend HTTP API (https://resend.com/docs/api-reference/emails/send-email).
No SMTP, so it works on hosts that block outbound mail ports. Plain-text messages only, which is all Heirloom sends."""
import logging

import requests
from django.conf import settings
from django.core.mail.backends.base import BaseEmailBackend

log = logging.getLogger(__name__)
API = "https://api.resend.com/emails"


class ResendEmailBackend(BaseEmailBackend):
    def send_messages(self, email_messages) -> int:
        if not settings.RESEND_API_KEY:
            if not self.fail_silently:
                raise RuntimeError("RESEND_API_KEY is not set")
            return 0
        sent = 0
        for m in email_messages:
            try:
                r = requests.post(
                    API,
                    headers={"Authorization": f"Bearer {settings.RESEND_API_KEY}"},
                    json={"from": m.from_email or settings.DEFAULT_FROM_EMAIL, "to": list(m.to), "subject": m.subject, "text": m.body},
                    timeout=10,
                )
                if r.status_code >= 300:
                    # The response can echo addresses; keep only the status in logs and the raised error.
                    raise RuntimeError(f"resend_status:{r.status_code}")
                sent += 1
            except Exception as e:
                log.warning("email delivery failed: %s", type(e).__name__)
                if not self.fail_silently:
                    raise
        return sent
