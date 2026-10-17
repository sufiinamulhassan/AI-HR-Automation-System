from types import SimpleNamespace

import aiosmtplib
import pytest

from services.hr_module import company_settings_service, mail_settings_service as svc
from services.hr_module.mail_settings_service import MailConfigUnusable, MailSettingsError
from shared import secrets
from shared.safe_http import UnsafeTarget

pytestmark = pytest.mark.anyio

EM_DASH = chr(0x2014)


def good(**extra) -> dict:
    return {
        "mode": "smtp", "from_name": "Acme Hiring", "from_address": "jobs@acme.test", "reply_to": "hr@acme.test",
        "host": "smtp.acme.test", "port": 587, "username": "mailer", "password": "s3cret-pass", "use_tls": True,
        **extra,
    }


class _Collection:

    def __init__(self, doc=None):
        self.doc = doc

    async def find_one(self, flt, projection=None):
        return self.doc

    async def update_one(self, flt, update, upsert=False):
        self.doc = {**(self.doc or {}), **update["$set"]}


@pytest.fixture
def store(monkeypatch):
    collection = _Collection()
    monkeypatch.setattr(svc, "get_db", lambda: SimpleNamespace(company_settings=collection))

    async def ensure_profile():
        return {}

    monkeypatch.setattr(company_settings_service, "get_company_settings", ensure_profile)

    async def public(host, port):
        return ["93.184.216.34"]

    monkeypatch.setattr(svc, "resolve_public", public)
    return collection


async def test_a_complete_configuration_is_saved_and_the_password_is_encrypted(store):
    saved, summary = await svc.save_mail(good(host="SMTP.Acme.TEST"), updated_by="boss@acme.test")
    stored = store.doc["mail"]
    assert stored["host"] == "smtp.acme.test"
    assert stored["password"].startswith(secrets.PREFIX) and "s3cret-pass" not in stored["password"]
    assert secrets.decrypt(stored["password"]) == "s3cret-pass"
    assert stored["updated_by"] == "boss@acme.test" and stored["updated_at"]
    assert saved["mode"] == "smtp" and saved["complete"] is True and saved["has_password"] is True
    assert summary["password_changed"] is True and summary["username_set"] is True
    assert "s3cret-pass" not in repr(summary)


async def test_what_is_shown_back_never_carries_the_password(store):
    await svc.save_mail(good(), updated_by="boss@acme.test")
    shown = await svc.get_view()
    assert "password" not in shown and shown["has_password"] is True
    assert set(shown) == {
        "mode", "from_name", "from_address", "reply_to", "host", "port", "username", "use_tls",
        "has_password", "complete", "updated_at", "updated_by",
    }
    assert "s3cret-pass" not in repr(shown) and secrets.PREFIX not in repr(shown)
    store.doc = None
    empty = await svc.get_view()
    assert empty["mode"] == "platform" and empty["has_password"] is False and empty["complete"] is False
    assert empty["port"] == 587 and empty["use_tls"] is True


async def test_the_password_is_kept_unless_replaced_or_cleared(store):
    await svc.save_mail(good(), updated_by="a@acme.test")
    first = store.doc["mail"]["password"]
    await svc.save_mail({"from_name": "Acme Jobs"}, updated_by="a@acme.test")
    assert store.doc["mail"]["password"] == first and store.doc["mail"]["from_name"] == "Acme Jobs"
    await svc.save_mail({"password": ""}, updated_by="a@acme.test")
    assert store.doc["mail"]["password"] == first
    await svc.save_mail({"password": "another-one"}, updated_by="a@acme.test")
    assert secrets.decrypt(store.doc["mail"]["password"]) == "another-one"
    with pytest.raises(MailSettingsError):
        await svc.save_mail({"clear_password": True}, updated_by="a@acme.test")
    await svc.save_mail({"clear_password": True, "username": "", "mode": "platform"}, updated_by="a@acme.test")
    assert store.doc["mail"]["password"] == "" and store.doc["mail"]["mode"] == "platform"


async def test_switching_back_to_the_platform_keeps_the_server_for_later(store):
    await svc.save_mail(good(), updated_by="a@acme.test")
    saved, _ = await svc.save_mail({"mode": "platform"}, updated_by="a@acme.test")
    assert saved["mode"] == "platform" and saved["host"] == "smtp.acme.test" and saved["has_password"] is True
    assert svc.smtp_settings(store.doc["mail"]) is None


async def test_platform_mode_may_hold_a_half_finished_form_but_never_bad_syntax(store):
    saved, _ = await svc.save_mail({"mode": "platform", "host": "smtp.acme.test"}, updated_by="a@acme.test")
    assert saved["complete"] is False
    with pytest.raises(MailSettingsError):
        await svc.save_mail({"mode": "platform", "from_address": "not an address"}, updated_by="a@acme.test")


@pytest.mark.parametrize("host", ["127.0.0.1", "10.0.0.5", "192.168.1.20", "169.254.169.254", "0.0.0.0"])
async def test_a_host_that_is_not_on_the_public_internet_is_refused(monkeypatch, host):
    collection = _Collection()
    monkeypatch.setattr(svc, "get_db", lambda: SimpleNamespace(company_settings=collection))
    with pytest.raises(MailSettingsError) as refused:
        await svc.save_mail(good(host=host), updated_by="a@acme.test")
    assert "public internet" in str(refused.value) and host not in str(refused.value)
    assert collection.doc is None


async def test_a_host_that_resolves_to_a_private_address_is_refused(store, monkeypatch):
    async def private(host, port):
        raise UnsafeTarget("The address points to a private or reserved network.")

    monkeypatch.setattr(svc, "resolve_public", private)
    with pytest.raises(MailSettingsError, match="public internet"):
        await svc.save_mail(good(host="rebind.acme.test"), updated_by="a@acme.test")
    assert store.doc is None


async def test_a_host_that_does_not_exist_is_refused_politely(store, monkeypatch):
    async def missing(host, port):
        raise UnsafeTarget("The host name could not be found.")

    monkeypatch.setattr(svc, "resolve_public", missing)
    with pytest.raises(MailSettingsError, match="could not be found"):
        await svc.save_mail(good(host="nowhere.acme.test"), updated_by="a@acme.test")


@pytest.mark.parametrize("host", [
    "smtp.acme.test:587", "https://smtp.acme.test", "smtp.acme.test/path", "user@smtp.acme.test", "smtp acme.test",
    "smtp.acme.test.", "-bad.acme.test", "[::1]", "a" * 64 + ".test", "smtp.acme.test\r\nBcc: x@y.test",
])
def test_a_host_must_be_a_bare_host_name(host):
    with pytest.raises(MailSettingsError):
        svc.clean_host(host)


@pytest.mark.parametrize("port", [0, 22, 80, 443, 993, 8025, 65536, -1, "abc", True, None])
def test_only_the_four_mail_ports_are_allowed(port):
    with pytest.raises(MailSettingsError, match="25, 465, 587 or 2525"):
        svc.clean_port(port)


@pytest.mark.parametrize("port", [25, 465, 587, 2525, "587"])
def test_the_four_mail_ports_are_accepted(port):
    assert svc.clean_port(port) == int(port)


INJECTIONS = [
    "jobs@acme.test\r\nBcc: spy@evil.test", "jobs@acme.test\nBcc: spy@evil.test", "jobs@acme.test\rX-Evil: 1",
    "jobs@acme.test%0d%0aBcc: spy@evil.test", "a@b.test, c@d.test", "Name <a@b.test>", "a@b.test;c@d.test",
]


@pytest.mark.parametrize("value", INJECTIONS)
@pytest.mark.parametrize("field", ["from_address", "reply_to"])
async def test_an_address_that_could_add_a_header_or_a_recipient_is_refused(store, field, value):
    with pytest.raises(MailSettingsError):
        await svc.save_mail(good(**{field: value}), updated_by="a@acme.test")
    assert store.doc is None


@pytest.mark.parametrize("field", ["from_name", "username", "host"])
async def test_a_line_break_in_any_text_field_is_refused_not_cleaned(store, field):
    with pytest.raises(MailSettingsError):
        await svc.save_mail(good(**{field: "value\r\nBcc: spy@evil.test"}), updated_by="a@acme.test")
    with pytest.raises(MailSettingsError):
        await svc.save_mail(good(**{field: "value\nmore"}), updated_by="a@acme.test")
    assert store.doc is None


async def test_a_password_with_a_line_break_is_refused(store):
    with pytest.raises(MailSettingsError):
        await svc.save_mail(good(password="pass\r\nQUIT"), updated_by="a@acme.test")
    assert store.doc is None


async def test_the_sender_name_never_carries_an_em_dash(store):
    await svc.save_mail(good(from_name=f"Acme {EM_DASH} Hiring"), updated_by="a@acme.test")
    assert EM_DASH not in store.doc["mail"]["from_name"]


@pytest.mark.parametrize("missing,expected", [
    ("host", "host"), ("from_address", "sender address"),
])
async def test_own_server_needs_a_host_and_a_sender(store, missing, expected):
    with pytest.raises(MailSettingsError, match=expected):
        await svc.save_mail(good(**{missing: ""}), updated_by="a@acme.test")


async def test_a_user_name_and_a_password_go_together(store):
    with pytest.raises(MailSettingsError, match="password"):
        await svc.save_mail(good(password=""), updated_by="a@acme.test")
    with pytest.raises(MailSettingsError, match="user name"):
        await svc.save_mail(good(username=""), updated_by="a@acme.test")
    saved, _ = await svc.save_mail(good(username="", password=""), updated_by="a@acme.test")
    assert saved["complete"] is True and saved["has_password"] is False


async def test_credentials_are_never_sent_over_a_connection_that_is_not_encrypted(store):
    with pytest.raises(MailSettingsError, match="TLS"):
        await svc.save_mail(good(use_tls=False), updated_by="a@acme.test")
    saved, _ = await svc.save_mail(good(use_tls=False, username="", password="", port=25), updated_by="a@acme.test")
    assert saved["use_tls"] is False


async def test_an_unknown_mode_is_refused(store):
    with pytest.raises(MailSettingsError, match="platform or smtp"):
        await svc.save_mail({"mode": "sendgrid"}, updated_by="a@acme.test")


def stored_mail(**extra) -> dict:
    return svc.merge_changes(None, good(**extra))


def test_platform_mode_and_no_settings_mean_the_platform_sender():
    assert svc.smtp_settings(None) is None
    assert svc.smtp_settings({}) is None
    assert svc.smtp_settings(stored_mail(mode="platform")) is None


def test_own_server_gives_the_decrypted_settings():
    smtp = svc.smtp_settings(stored_mail())
    assert smtp == {
        "host": "smtp.acme.test", "port": 587, "username": "mailer", "password": "s3cret-pass", "use_tls": True,
        "from_name": "Acme Hiring", "from_address": "jobs@acme.test", "reply_to": "hr@acme.test",
    }


def test_own_server_that_cannot_be_used_is_an_error_never_the_platform():
    incomplete = stored_mail()
    incomplete["host"] = ""
    with pytest.raises(MailConfigUnusable):
        svc.smtp_settings(incomplete)
    unreadable = stored_mail()
    unreadable["password"] = "enc:v1:not-a-real-token"
    with pytest.raises(MailConfigUnusable, match="password"):
        svc.smtp_settings(unreadable)
    assert svc.view(unreadable)["has_password"] is False and svc.view(unreadable)["complete"] is False


def test_tls_switches_follow_the_port():
    assert svc.tls_options(465, True) == {"use_tls": True, "start_tls": False}
    assert svc.tls_options(587, True) == {"use_tls": False, "start_tls": True}
    assert svc.tls_options(25, True) == {"use_tls": False, "start_tls": True}
    assert svc.tls_options(587, False) == {"use_tls": False, "start_tls": False}


def test_the_client_options_leave_the_port_out_because_a_socket_is_handed_over():
    smtp = svc.smtp_settings(stored_mail())
    options = svc.client_options(smtp)
    assert "port" not in options and options["hostname"] == "smtp.acme.test"
    assert options["username"] == "mailer" and options["password"] == "s3cret-pass"
    assert "username" not in svc.client_options(smtp, credentials=False)


def test_a_failure_is_described_in_our_words_not_the_servers():
    cases = [
        (aiosmtplib.SMTPAuthenticationError(535, "5.7.8 bad credentials for 10.1.2.3"), "user name or password"),
        (aiosmtplib.SMTPConnectTimeoutError("Timed out connecting to 10.1.2.3"), "did not answer in time"),
        (aiosmtplib.SMTPConnectError("Error connecting to host: [Errno 111] Connect call failed ('10.1.2.3', 587)"), "Could not connect"),
        (TimeoutError("slow"), "did not answer in time"),
        (ConnectionRefusedError("[Errno 111] Connect call failed ('10.1.2.3', 587)"), "Could not connect"),
        (aiosmtplib.SMTPException("STARTTLS extension not supported by server."), "secure connection"),
        (UnsafeTarget("The address points to a private or reserved network."), "public internet"),
        (RuntimeError("something odd"), "did not accept the message"),
    ]
    for exc, phrase in cases:
        sentence = svc.describe_failure(exc)
        assert phrase in sentence, (type(exc).__name__, sentence)
        assert "10.1.2.3" not in sentence and "bad credentials" not in sentence


def test_the_company_profile_never_returns_the_mail_or_integration_secrets():
    doc = {
        "_id": "singleton", "company_name": "Acme", "mail": {"password": "enc:v1:abc"},
        "integrations": {"hrms": {"auth_token": "enc:v1:def"}}, "sso": {"client_secret": "enc:v1:ghi"},
        "onboarding_dismissed": True,
    }
    shown = company_settings_service._public_view(company_settings_service.mongo_doc(doc))
    assert "mail" not in shown and "integrations" not in shown and "sso" not in shown
    assert shown["company_name"] == "Acme" and shown["onboarding_dismissed"] is True
    assert shown["terms_url"] == "" and shown["privacy_url"] == ""


@pytest.mark.parametrize("value", [
    "http://acme.test/terms", "ftp://acme.test/terms", "javascript:alert(1)", "//acme.test/terms", "acme.test/terms",
    "https://", "https:///terms", "https://user:pw@acme.test/terms", "https://acme.test/te rms",
    "https://acme.test/terms\r\nX: y", "https://acme.test/" + "a" * 300,
])
def test_a_terms_or_privacy_link_must_be_a_plain_https_address(value):
    with pytest.raises(ValueError):
        company_settings_service.clean_legal_url(value, "The terms link")


def test_a_valid_legal_link_is_kept_and_a_blank_clears_it():
    assert company_settings_service.clean_legal_url("  https://acme.test/legal/terms?lang=en ") == "https://acme.test/legal/terms?lang=en"
    assert company_settings_service.clean_legal_url("") == "" and company_settings_service.clean_legal_url(None) == ""
    assert company_settings_service.clean_legal_url("https://acme.test/" + "a" * 270)


def test_a_stored_sender_address_that_is_not_valid_is_never_used():
    corrupt = stored_mail()
    corrupt["from_address"] = "jobs@acme.test\r\nBcc: spy@evil.test"
    with pytest.raises(MailConfigUnusable, match="sender address"):
        svc.smtp_settings(corrupt)
