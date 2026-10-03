"""Test doubles for SMS delivery."""


class FakeSms:
    """Records what would have been sent. Selected with override_settings(SMS_BACKEND="tests.fakes.FakeSms")."""

    sent: list[tuple[str, str]] = []
    configured = True
    fail = False

    def available(self) -> bool:
        return FakeSms.configured

    def send(self, to: str, body: str) -> str:
        if FakeSms.fail:
            raise RuntimeError("provider down")
        FakeSms.sent.append((to, body))
        return f"SM{len(FakeSms.sent):030d}"
