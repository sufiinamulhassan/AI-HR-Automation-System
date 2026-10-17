import pytest

from config.settings import settings
from services.hr_module import email_service

pytestmark = pytest.mark.anyio


async def _send():
    return await email_service.send_email(
        to="someone@example.com", subject="Hello", html_body="<p>Hi</p>", text_body="Hi",
    )


async def test_an_unconfigured_deploy_reports_the_email_as_not_sent(monkeypatch):
    monkeypatch.setattr(settings, "AWS_SES_ENABLED", False)
    monkeypatch.setattr(settings, "EMAIL_HOST", "")
    monkeypatch.setattr(settings, "DEBUG", False)
    assert await _send() is False


async def test_local_development_keeps_going_on_the_console_fallback(monkeypatch):
    monkeypatch.setattr(settings, "AWS_SES_ENABLED", False)
    monkeypatch.setattr(settings, "EMAIL_HOST", "")
    monkeypatch.setattr(settings, "DEBUG", True)
    assert await _send() is True
