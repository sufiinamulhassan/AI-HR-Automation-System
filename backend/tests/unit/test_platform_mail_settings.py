from types import SimpleNamespace

import aiosmtplib
import pytest

from config.settings import settings
from config.tenancy import company_context
from services.hr_module import email_service, mail_settings_service as mail

pytestmark = pytest.mark.anyio

ENV_HOST = "env-smtp.example.invalid"
PASSWORD = "platform-pass"


def platform_doc(**extra) -> dict:
    base = {
        "mode": "smtp", "from_name": "Talent Desk", "from_address": "no-reply@platform.test", "reply_to": "",
        "host": "smtp.platform.test", "port": 587, "username": "relay", "password": PASSWORD, "use_tls": True,
    }
    base.update(extra)
    return mail.merge_changes(None, base)


def company_doc() -> dict:
    return mail.merge_changes(None, {
        "mode": "smtp", "from_address": "jobs@acme.test", "host": "smtp.acme.test", "port": 587,
        "username": "acme", "password": "acme-pass", "use_tls": True,
    })


class _Rows:
    def __init__(self, row):
        self.row = row

    async def find_one(self, flt, projection=None):
        return self.row


class _Log:
    def __init__(self):
        self.rows = []

    async def insert_one(self, row):
        self.rows.append(row)


class _Settings:
    def __init__(self):
        self.docs: dict = {}

    async def find_one(self, flt, projection=None):
        return self.docs.get(flt.get("_id"))

    async def update_one(self, flt, update, upsert=False):
        doc = self.docs.setdefault(flt["_id"], {"_id": flt["_id"]})
        doc.update(update["$set"])


@pytest.fixture
def world(monkeypatch):
    w = SimpleNamespace(calls=[], opened=[], log=_Log(), platform=None, fail_with=None)

    async def fake_send(msg, **kwargs):
        w.calls.append({"msg": msg, **kwargs})
        if w.fail_with is not None:
            raise w.fail_with

    async def fake_connect(host, port, **kw):
        w.opened.append((host, port))
        return SimpleNamespace(close=lambda: None)

    async def fake_platform():
        return w.platform

    monkeypatch.setattr(aiosmtplib, "send", fake_send)
    monkeypatch.setattr(mail, "connect_pinned", fake_connect)
    monkeypatch.setattr(mail, "load_platform_mail", fake_platform)
    monkeypatch.setattr(settings, "AWS_SES_ENABLED", False)
    monkeypatch.setattr(settings, "EMAIL_HOST", ENV_HOST)
    monkeypatch.setattr(settings, "EMAIL_FROM", "env@example.com")
    monkeypatch.setattr(settings, "EMAIL_FROM_NAME", "HR Platform")
    w.db = SimpleNamespace(email_log=w.log)
    return w


def profile(monkeypatch, row):
    monkeypatch.setattr(email_service, "get_db", lambda: SimpleNamespace(company_settings=_Rows(row)))


async def send(world):
    return await email_service.send_email(
        to="person@example.com", subject="Hello", html_body="<p>Hi</p>", text_body="Hi", db=world.db, template="t",
    )


async def test_the_platform_server_is_used_when_the_company_has_none(world, monkeypatch):
    world.platform = platform_doc()
    profile(monkeypatch, {"primary_contact_email": "contact@acme.test"})
    with company_context("cmp_mail", {"name": "Acme Hiring"}):
        assert await send(world) is True
    (call,) = world.calls
    assert call["hostname"] == "smtp.platform.test" and call["username"] == "relay" and call["password"] == PASSWORD
    assert world.opened == [("smtp.platform.test", 587)]
    msg = call["msg"]
    assert msg["From"] == "Talent Desk <no-reply@platform.test>" and msg["Reply-To"] == "contact@acme.test"


async def test_the_company_server_still_wins_over_the_platform_server(world, monkeypatch):
    world.platform = platform_doc()
    profile(monkeypatch, {"mail": company_doc()})
    with company_context("cmp_mail", {"name": "Acme Hiring"}):
        assert await send(world) is True
    assert [c["hostname"] for c in world.calls] == ["smtp.acme.test"]


async def test_the_platform_server_is_used_with_no_company_bound(world, monkeypatch):
    world.platform = platform_doc()
    assert await send(world) is True
    assert [c["hostname"] for c in world.calls] == ["smtp.platform.test"]


@pytest.mark.parametrize("doc", [None, {"mode": "platform", "host": "smtp.platform.test"}])
async def test_without_a_platform_server_the_environment_is_used(world, monkeypatch, doc):
    world.platform = doc
    assert await send(world) is True
    (call,) = world.calls
    assert call["hostname"] == ENV_HOST and world.opened == []


async def test_a_platform_server_failure_is_logged_and_not_retried_elsewhere(world, monkeypatch):
    world.platform = platform_doc()
    world.fail_with = aiosmtplib.SMTPAuthenticationError(535, f"bad credentials {PASSWORD}")
    assert await send(world) is False
    assert [c["hostname"] for c in world.calls] == ["smtp.platform.test"]
    (row,) = world.log.rows
    assert row["status"] == "failed" and row["error"].startswith("PlatformMailError: ")
    assert PASSWORD not in row["error"]


async def test_unusable_platform_settings_stop_the_message(world, monkeypatch):
    world.platform = {"mode": "smtp", "host": "", "from_address": ""}
    assert await send(world) is False
    assert world.calls == []
    assert "platform's mail server settings are incomplete" in world.log.rows[0]["error"]


async def test_saving_platform_mail_encrypts_the_password_and_hides_it(monkeypatch):
    store = _Settings()
    monkeypatch.setattr(mail, "get_platform_db", lambda: SimpleNamespace(settings=store))

    async def public(host, port):
        return None

    monkeypatch.setattr(mail, "assert_public_host", public)
    saved, summary = await mail.save_platform_mail({
        "mode": "smtp", "from_address": "no-reply@platform.test", "host": "smtp.platform.test", "port": 465,
        "username": "relay", "password": PASSWORD, "use_tls": True,
    }, updated_by="owner@platform.test")
    stored = store.docs[mail.PLATFORM_MAIL_ID]["mail"]
    assert stored["password"] != PASSWORD and mail.smtp_settings(stored)["password"] == PASSWORD
    assert "password" not in saved and saved["has_password"] is True and saved["complete"] is True
    assert saved["updated_by"] == "owner@platform.test" and summary["password_changed"] is True
    assert (await mail.get_platform_view())["host"] == "smtp.platform.test"


async def test_saving_incomplete_platform_smtp_is_refused(monkeypatch):
    monkeypatch.setattr(mail, "get_platform_db", lambda: SimpleNamespace(settings=_Settings()))
    with pytest.raises(mail.MailSettingsError):
        await mail.save_platform_mail({"mode": "smtp", "host": "smtp.platform.test"})


async def test_the_active_provider_reports_the_platform_server(monkeypatch):
    from services.hr_module import email_delivery_service as delivery

    async def stored():
        return platform_doc()

    monkeypatch.setattr(mail, "load_platform_mail", stored)
    monkeypatch.setattr(settings, "AWS_SES_ENABLED", False)
    monkeypatch.setattr(settings, "EMAIL_HOST", "")
    assert delivery.current_provider() is None
    assert await delivery.active_provider() == "smtp"


async def test_the_active_provider_falls_back_to_the_environment(monkeypatch):
    from services.hr_module import email_delivery_service as delivery

    async def stored():
        return {"mode": "platform", "host": "smtp.platform.test"}

    monkeypatch.setattr(mail, "load_platform_mail", stored)
    monkeypatch.setattr(settings, "AWS_SES_ENABLED", False)
    monkeypatch.setattr(settings, "EMAIL_HOST", "")
    assert await delivery.active_provider() is None
    monkeypatch.setattr(settings, "EMAIL_HOST", ENV_HOST)
    assert await delivery.active_provider() == "smtp"


async def test_unusable_platform_settings_are_not_reported_as_configured(monkeypatch):
    from services.hr_module import email_delivery_service as delivery

    async def stored():
        return {"mode": "smtp", "host": "", "from_address": ""}

    monkeypatch.setattr(mail, "load_platform_mail", stored)
    monkeypatch.setattr(settings, "EMAIL_HOST", ENV_HOST)
    assert await delivery.active_provider() is None


async def test_platform_health_shows_email_configured_from_the_console(monkeypatch):
    from services.hr_module import platform_service as svc

    async def stored():
        return platform_doc()

    async def ping():
        return {"ok": False, "latency_ms": None}

    monkeypatch.setattr(mail, "load_platform_mail", stored)
    monkeypatch.setattr(settings, "AWS_SES_ENABLED", False)
    monkeypatch.setattr(settings, "EMAIL_HOST", "")
    monkeypatch.setattr(svc, "database_ping", ping)
    result = await svc.health()
    assert result["email"] == {"configured": True, "provider": "smtp"}
