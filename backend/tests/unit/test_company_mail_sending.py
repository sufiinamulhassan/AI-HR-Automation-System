from types import SimpleNamespace

import aiosmtplib
import pytest

from config import tenancy
from config.settings import settings
from config.tenancy import company_context
from services.hr_module import email_service, mail_settings_service as mail
from shared.safe_http import UnsafeTarget

pytestmark = pytest.mark.anyio

PLATFORM_HOST = "platform-smtp.example.invalid"
PASSWORD = "s3cret-pass"


def mail_doc(**extra) -> dict:
    base = {
        "mode": "smtp", "from_name": "Acme Mail", "from_address": "jobs@acme.test", "reply_to": "replies@acme.test",
        "host": "smtp.acme.test", "port": 587, "username": "mailer", "password": PASSWORD, "use_tls": True,
    }
    base.update(extra)
    return mail.merge_changes(None, base)


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


class World:

    def __init__(self):
        self.calls: list[dict] = []
        self.sockets: list = []
        self.opened: list[tuple] = []
        self.fail_with: Exception | None = None
        self.log = _Log()
        self.db = SimpleNamespace(email_log=self.log)


@pytest.fixture
def world(monkeypatch):
    w = World()

    async def fake_send(msg, **kwargs):
        w.calls.append({"msg": msg, **kwargs})
        if w.fail_with is not None:
            raise w.fail_with

    class FakeSocket:
        closed = False

        def close(self):
            self.closed = True

    async def fake_connect(host, port, **kw):
        w.opened.append((host, port))
        sock = FakeSocket()
        w.sockets.append(sock)
        return sock

    monkeypatch.setattr(aiosmtplib, "send", fake_send)
    monkeypatch.setattr(mail, "connect_pinned", fake_connect)
    monkeypatch.setattr(settings, "AWS_SES_ENABLED", False)
    monkeypatch.setattr(settings, "EMAIL_HOST", PLATFORM_HOST)
    monkeypatch.setattr(settings, "EMAIL_FROM", "platform@example.com")
    monkeypatch.setattr(settings, "EMAIL_FROM_NAME", "HR Platform")
    monkeypatch.setattr(settings, "EMAIL_PASSWORD", "platform-secret")
    return w


def profile(monkeypatch, row):
    monkeypatch.setattr(email_service, "get_db", lambda: SimpleNamespace(company_settings=_Rows(row)))


async def send(world, **kwargs):
    return await email_service.send_email(
        to="candidate@example.com", subject="Hello", html_body="<p>Hi</p>", text_body="Hi", db=world.db,
        template="t", **kwargs,
    )


async def test_a_company_with_its_own_server_sends_through_it_from_its_own_address(world, monkeypatch):
    profile(monkeypatch, {"primary_contact_email": "contact@acme.test", "mail": mail_doc()})
    with company_context("cmp_mail", {"name": "Acme Hiring"}):
        assert await send(world) is True
    (call,) = world.calls
    assert call["hostname"] == "smtp.acme.test" and call["sock"] is world.sockets[0]
    assert world.opened == [("smtp.acme.test", 587)]
    assert call["username"] == "mailer" and call["password"] == PASSWORD
    assert call["start_tls"] is True and call["use_tls"] is False and "port" not in call
    msg = call["msg"]
    assert msg["From"] == "Acme Mail <jobs@acme.test>"
    assert msg["Reply-To"] == "replies@acme.test"
    assert msg["To"] == "candidate@example.com"
    assert "platform@example.com" not in msg.as_string() and call["password"] != "platform-secret"
    assert world.log.rows[0]["status"] == "sent"


async def test_the_sender_name_falls_back_to_the_company_and_reply_to_to_its_contact_address(world, monkeypatch):
    doc = mail_doc(from_name="", reply_to="")
    profile(monkeypatch, {"primary_contact_email": "contact@acme.test", "mail": doc})
    with company_context("cmp_mail", {"name": "Acme Hiring"}):
        assert await send(world) is True
    msg = world.calls[0]["msg"]
    assert msg["From"] == "Acme Hiring <jobs@acme.test>" and msg["Reply-To"] == "contact@acme.test"


async def test_implicit_tls_is_used_on_port_465(world, monkeypatch):
    profile(monkeypatch, {"mail": mail_doc(port=465)})
    with company_context("cmp_mail", {"name": "Acme Hiring"}):
        assert await send(world) is True
    call = world.calls[0]
    assert call["use_tls"] is True and call["start_tls"] is False and world.opened == [("smtp.acme.test", 465)]


async def test_a_failure_returns_false_and_is_logged_and_never_falls_back_to_the_platform(world, monkeypatch):
    profile(monkeypatch, {"mail": mail_doc()})
    world.fail_with = aiosmtplib.SMTPAuthenticationError(535, f"5.7.8 bad credentials {PASSWORD} for 93.184.216.34")
    with company_context("cmp_mail", {"name": "Acme Hiring"}):
        assert await send(world) is False
    assert len(world.calls) == 1 and world.calls[0]["hostname"] == "smtp.acme.test"
    assert all(call["hostname"] != PLATFORM_HOST for call in world.calls)
    (row,) = world.log.rows
    assert row["status"] == "failed" and "user name or password" in row["error"]
    assert PASSWORD not in row["error"] and "93.184.216.34" not in row["error"]
    assert world.sockets[0].closed is True


@pytest.mark.parametrize("failure", [
    ConnectionRefusedError("refused"), TimeoutError("slow"), aiosmtplib.SMTPRecipientsRefused([]),
    aiosmtplib.SMTPServerDisconnected("gone"), RuntimeError("anything at all"),
])
async def test_every_kind_of_failure_is_false_and_never_the_platform(world, monkeypatch, failure):
    profile(monkeypatch, {"mail": mail_doc()})
    world.fail_with = failure
    with company_context("cmp_mail", {"name": "Acme Hiring"}):
        assert await send(world) is False
    assert [c["hostname"] for c in world.calls] == ["smtp.acme.test"]
    assert world.log.rows[0]["status"] == "failed"


async def test_a_server_that_cannot_be_reached_is_false_too(world, monkeypatch):
    profile(monkeypatch, {"mail": mail_doc()})

    async def unreachable(host, port, **kw):
        raise ConnectionRefusedError("[Errno 111] Connect call failed ('93.184.216.34', 587)")

    monkeypatch.setattr(mail, "connect_pinned", unreachable)
    with company_context("cmp_mail", {"name": "Acme Hiring"}):
        assert await send(world) is False
    assert world.calls == []
    assert "93.184.216.34" not in world.log.rows[0]["error"]


async def test_the_host_is_checked_again_when_a_message_is_sent(world, monkeypatch):
    monkeypatch.undo()
    monkeypatch.setattr(settings, "AWS_SES_ENABLED", False)
    monkeypatch.setattr(settings, "EMAIL_HOST", PLATFORM_HOST)
    sent = []

    async def fake_send(msg, **kwargs):
        sent.append(kwargs)

    monkeypatch.setattr(aiosmtplib, "send", fake_send)
    profile(monkeypatch, {"mail": mail_doc(host="10.0.0.5")})
    with company_context("cmp_mail", {"name": "Acme Hiring"}):
        assert await send(world) is False
    assert sent == []
    assert "public internet" in world.log.rows[0]["error"] and "10.0.0.5" not in world.log.rows[0]["error"]


async def test_settings_that_cannot_be_used_stop_the_message_instead_of_changing_who_sends_it(world, monkeypatch):
    broken = mail_doc()
    broken["password"] = "enc:v1:not-a-real-token"
    profile(monkeypatch, {"mail": broken})
    with company_context("cmp_mail", {"name": "Acme Hiring"}):
        assert await send(world) is False
    assert world.calls == [] and world.opened == []
    assert world.log.rows[0]["status"] == "failed" and "password" in world.log.rows[0]["error"]

    incomplete = mail_doc()
    incomplete["host"] = ""
    profile(monkeypatch, {"mail": incomplete})
    with company_context("cmp_mail", {"name": "Acme Hiring"}):
        assert await send(world) is False
    assert world.calls == []


async def test_the_sign_in_code_and_reset_emails_follow_the_companys_choice(world, monkeypatch):
    profile(monkeypatch, {"mail": mail_doc()})
    with company_context("cmp_mail", {"name": "Acme Hiring"}):
        assert await email_service.send_otp_email(to_email="p@example.com", otp_code="123456") is True
        assert await email_service.send_password_reset_email(
            to_email="p@example.com", name="P", reset_url="https://app.example.com/reset-password?token=abc",
        ) is True
    assert [c["hostname"] for c in world.calls] == ["smtp.acme.test", "smtp.acme.test"]
    assert all(c["msg"]["From"] == "Acme Mail <jobs@acme.test>" for c in world.calls)


async def test_an_attachment_goes_through_the_companys_server_too(world, monkeypatch):
    profile(monkeypatch, {"mail": mail_doc()})
    with company_context("cmp_mail", {"name": "Acme Hiring"}):
        assert await send(world, attachment_bytes=b"%PDF-1.4 x", attachment_filename="offer.pdf") is True
    parts = world.calls[0]["msg"].get_payload()
    assert any(p.get_filename() == "offer.pdf" for p in parts)


@pytest.mark.parametrize("row", [
    None,
    {"primary_contact_email": "contact@acme.test"},
    {"primary_contact_email": "contact@acme.test", "mail": {"mode": "platform", "host": "smtp.acme.test"}},
    {"mail": mail_doc(mode="platform")},
])
async def test_a_company_that_did_not_choose_a_server_uses_the_platform_exactly_as_before(world, monkeypatch, row):
    profile(monkeypatch, row)
    with company_context("cmp_plain", {"name": "Plain Co"}):
        assert await send(world) is True
    (call,) = world.calls
    assert call["hostname"] == PLATFORM_HOST and "sock" not in call and world.opened == []
    assert call["password"] == "platform-secret"
    msg = call["msg"]
    assert msg["From"] == "Plain Co <platform@example.com>"
    expected = (row or {}).get("primary_contact_email")
    assert msg["Reply-To"] == expected


async def test_with_no_company_bound_the_platform_path_is_unchanged(world, monkeypatch):
    previous = tenancy._fallback_company_id
    tenancy.use_fallback_company(None)
    try:
        profile(monkeypatch, {"mail": mail_doc()})
        assert await send(world) is True
    finally:
        tenancy.use_fallback_company(previous)
    (call,) = world.calls
    assert call["hostname"] == PLATFORM_HOST and call["msg"]["From"] == "HR Platform <platform@example.com>"


async def test_a_read_that_fails_leaves_the_platform_path_as_it_always_was(world, monkeypatch):
    def broken():
        raise tenancy.TenantContextMissing("nothing bound")

    monkeypatch.setattr(email_service, "get_db", broken)
    with company_context("cmp_plain", {"name": "Plain Co"}):
        assert await send(world) is True
    assert world.calls[0]["hostname"] == PLATFORM_HOST


async def test_the_unconfigured_deployment_is_unchanged_for_a_company_without_its_own_server(world, monkeypatch):
    monkeypatch.setattr(settings, "EMAIL_HOST", "")
    monkeypatch.setattr(settings, "DEBUG", False)
    profile(monkeypatch, {"primary_contact_email": "contact@acme.test"})
    with company_context("cmp_plain", {"name": "Plain Co"}):
        assert await send(world) is False
    assert world.calls == [] and world.log.rows[0]["status"] == "not_sent"


async def test_a_company_with_its_own_server_does_not_need_the_platform_to_have_one(world, monkeypatch):
    monkeypatch.setattr(settings, "EMAIL_HOST", "")
    monkeypatch.setattr(settings, "DEBUG", False)
    profile(monkeypatch, {"mail": mail_doc()})
    with company_context("cmp_mail", {"name": "Acme Hiring"}):
        assert await send(world) is True
    assert world.calls[0]["hostname"] == "smtp.acme.test"


async def test_unsafe_targets_are_refused_by_the_real_opener():
    for host in ("127.0.0.1", "10.0.0.5", "169.254.169.254"):
        with pytest.raises(UnsafeTarget):
            await mail.connect_pinned(host, 587)


class _FakeSMTP:
    log: list = []

    def __init__(self, **kwargs):
        type(self).log.append(("init", kwargs))

    async def connect(self):
        type(self).log.append("connect")

    async def login(self, username, password):
        type(self).log.append(("login", username, password))

    async def quit(self):
        type(self).log.append("quit")

    def close(self):
        type(self).log.append("close")


async def test_verify_connects_signs_in_and_quits_without_sending(monkeypatch):
    _FakeSMTP.log = []

    async def fake_connect(host, port, **kw):
        return SimpleNamespace(close=lambda: _FakeSMTP.log.append("sock-close"))

    async def never_send(*args, **kwargs):
        raise AssertionError("verify must not send a message")

    monkeypatch.setattr(mail, "connect_pinned", fake_connect)
    monkeypatch.setattr(aiosmtplib, "SMTP", _FakeSMTP)
    monkeypatch.setattr(aiosmtplib, "send", never_send)
    smtp = mail.smtp_settings(mail_doc())
    result = await mail.verify_connection(smtp)
    assert result["ok"] is True and "No message was sent" in result["detail"]
    log = _FakeSMTP.log
    assert log[0][0] == "init" and "port" not in log[0][1] and log[0][1]["hostname"] == "smtp.acme.test"
    assert "username" not in log[0][1]
    assert log[1:4] == ["connect", ("login", "mailer", PASSWORD), "quit"]
    assert PASSWORD not in repr(result)


async def test_verify_reports_a_rejected_login_in_our_words(monkeypatch):
    class Rejecting(_FakeSMTP):
        async def login(self, username, password):
            raise aiosmtplib.SMTPAuthenticationError(535, f"bad credentials {password}")

    async def fake_connect(host, port, **kw):
        return SimpleNamespace(close=lambda: None)

    monkeypatch.setattr(mail, "connect_pinned", fake_connect)
    monkeypatch.setattr(aiosmtplib, "SMTP", Rejecting)
    result = await mail.verify_connection(mail.smtp_settings(mail_doc()))
    assert result["ok"] is False and "user name or password" in result["detail"]
    assert PASSWORD not in result["detail"] and "smtp.acme.test" not in result["detail"]


async def test_verify_of_a_host_that_is_not_public_says_so_without_connecting(monkeypatch):
    called = []
    monkeypatch.setattr(aiosmtplib, "SMTP", lambda **kw: called.append(kw))
    result = await mail.verify_connection(mail.smtp_settings(mail_doc(host="192.168.1.1")))
    assert result["ok"] is False and "public internet" in result["detail"] and called == []
