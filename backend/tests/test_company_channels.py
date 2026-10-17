import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import aiosmtplib
import httpx
import pytest
from httpx import ASGITransport, AsyncClient
from jose import jwt
from passlib.context import CryptContext
from pymongo.errors import DuplicateKeyError

from config.database import get_db, get_platform_db
from config.settings import settings
from config.tenancy import company_context
from config.tenancy_migration import client_doc, company_doc
from main import app
from services.hr_module import (
    email_service,
    hrms_service,
    mail_settings_service,
    meeting_service,
)
from services.hr_module import integrations_settings_service as integrations
from shared import safe_http, secrets
from shared.safe_http import resolve_public as real_resolve_public

pytestmark = pytest.mark.anyio

API = "/api/v1"
PLATFORM = {"Authorization": "Bearer demo-platform-token"}
PUBLIC_IP = "93.184.216.34"
PASSWORD = "s3cret-pass"
_pwd = CryptContext(schemes=["bcrypt"])


def bearer(email: str) -> dict:
    token = jwt.encode(
        {"sub": email, "exp": datetime.now(timezone.utc) + timedelta(hours=1)},
        settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM,
    )
    return {"Authorization": f"Bearer {token}"}


def mail_body(**extra) -> dict:
    return {
        "mode": "smtp", "from_name": "Acme Hiring", "from_address": "jobs@acme.test", "reply_to": "hr@acme.test",
        "host": "smtp.acme.test", "port": 587, "username": "mailer", "password": PASSWORD, "use_tls": True, **extra,
    }


@pytest.fixture
async def make_company():
    made: list[tuple[str, str, str]] = []

    async def _make(name: str | None = None, *, features: dict | None = None):
        tag = uuid.uuid4().hex[:8]
        client_id, company_id, slug = f"cli_ch{tag}", f"cmp_ch{tag}", f"ch-{tag}"
        email = f"boss-{tag}@example.com"
        raw = get_platform_db()
        client = client_doc(client_id, f"CH Client {tag}", f"ch-client-{tag}")
        if features is not None:
            client["plan"]["features"] = features
        await raw.clients.insert_one(client)
        doc = company_doc(company_id, client_id, name or f"CH Company {tag}", slug)
        await raw.companies.insert_one(dict(doc))
        with company_context(company_id, doc):
            await get_db().users.insert_one({
                "name": "Boss", "email": email, "password_hash": _pwd.hash("Boss@12345"), "role": "superadmin",
                "is_active": True, "otp_required": False, "created_at": datetime.now(timezone.utc).isoformat(),
            })
        made.append((company_id, client_id, email))
        return SimpleNamespace(
            company_id=company_id, client_id=client_id, slug=slug, name=doc["name"], email=email, tag=tag,
            doc=doc, headers=bearer(email),
        )

    yield _make

    raw = get_platform_db()
    for company_id, client_id, email in made:
        for name in await raw.list_collection_names():
            if name not in ("clients", "companies", "settings"):
                await raw[name].delete_many({"company_id": company_id})
        await raw.audit_log.delete_many({"resource_id": company_id})
        await raw.rate_limits.delete_many({"_id": {"$regex": f"^(co:{company_id}:|company_mail_(verify|test):{email})"}})
        await raw.users.delete_many({"email": email})
        await raw.companies.delete_many({"company_id": company_id})
        await raw.clients.delete_many({"client_id": client_id})


@pytest.fixture
async def plain_client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test", follow_redirects=False) as c:
        yield c


@pytest.fixture
def own_ip(monkeypatch):
    import shared.rate_limit as rate_limit

    ip = f"ch-{uuid.uuid4().hex[:10]}"
    monkeypatch.setattr(rate_limit, "client_ip", lambda request: ip)
    return ip


class SmtpWorld:
    def __init__(self):
        self.calls: list[dict] = []
        self.opened: list[tuple] = []
        self.fail_with: Exception | None = None


@pytest.fixture
def smtp(monkeypatch):
    world = SmtpWorld()

    async def fake_send(msg, **kwargs):
        world.calls.append({"msg": msg, **kwargs})
        if world.fail_with is not None:
            raise world.fail_with

    async def fake_connect(host, port, **kwargs):
        world.opened.append((host, port))
        return SimpleNamespace(close=lambda: None)

    async def public(host, port):
        return [PUBLIC_IP]

    monkeypatch.setattr(aiosmtplib, "send", fake_send)
    monkeypatch.setattr(mail_settings_service, "connect_pinned", fake_connect)
    monkeypatch.setattr(mail_settings_service, "resolve_public", public)
    monkeypatch.setattr(settings, "AWS_SES_ENABLED", False)
    monkeypatch.setattr(settings, "EMAIL_HOST", "platform-smtp.example.invalid")
    monkeypatch.setattr(settings, "EMAIL_FROM", "platform@example.com")
    return world


@pytest.fixture
def public_dns(monkeypatch):
    async def public(host, port):
        return [PUBLIC_IP]

    for module in (safe_http, integrations, hrms_service):
        monkeypatch.setattr(module, "resolve_public", public)


async def stored_settings(company_id: str) -> dict:
    return await get_platform_db().company_settings.find_one({"company_id": company_id}) or {}


async def audit(company_id: str, action: str) -> list[dict]:
    cursor = get_platform_db().audit_log.find({"company_id": company_id, "action": action}).sort("created_at", 1)
    return await cursor.to_list(20)


async def test_mail_settings_are_stored_encrypted_in_the_companys_own_document_and_never_returned(client, make_company, smtp):
    acme, other = await make_company(), await make_company()
    url = f"{API}/company-settings/mail"

    fresh = (await client.get(url, headers=acme.headers)).json()
    assert fresh["mode"] == "platform" and fresh["has_password"] is False

    saved = await client.put(url, headers=acme.headers, json=mail_body())
    assert saved.status_code == 200, saved.text
    body = saved.json()
    assert body["mode"] == "smtp" and body["complete"] is True and body["has_password"] is True
    assert body["updated_by"] == acme.email
    assert PASSWORD not in saved.text and secrets.PREFIX not in saved.text
    assert (await client.get(url, headers=acme.headers)).json() == body

    stored = (await stored_settings(acme.company_id))["mail"]
    assert stored["password"].startswith(secrets.PREFIX) and PASSWORD not in stored["password"]
    assert secrets.decrypt(stored["password"]) == PASSWORD

    profile = await client.get(f"{API}/company-settings", headers=acme.headers)
    assert "mail" not in profile.json() and secrets.PREFIX not in profile.text

    assert (await client.get(url, headers=other.headers)).json()["mode"] == "platform"
    assert "mail" not in await stored_settings(other.company_id)

    kept = await client.put(url, headers=acme.headers, json={"from_name": "Acme Jobs"})
    assert kept.json()["has_password"] is True and kept.json()["from_name"] == "Acme Jobs"
    assert secrets.decrypt((await stored_settings(acme.company_id))["mail"]["password"]) == PASSWORD


async def test_a_change_to_the_mail_settings_is_audited_without_the_password(client, make_company, smtp):
    acme = await make_company()
    await client.put(f"{API}/company-settings/mail", headers=acme.headers, json=mail_body())
    (row,) = await audit(acme.company_id, "company_mail_update")
    assert row["actor_email"] == acme.email and row["actor_role"] == "superadmin"
    assert row["details"]["host"] == "smtp.acme.test" and row["details"]["password_changed"] is True
    assert PASSWORD not in str(row) and secrets.PREFIX not in str(row)


async def test_unsafe_mail_settings_are_refused_and_nothing_is_saved(client, make_company, smtp, monkeypatch):
    acme = await make_company()
    url = f"{API}/company-settings/mail"
    monkeypatch.setattr(mail_settings_service, "resolve_public", real_resolve_public)
    for change, phrase in (
        ({"host": "10.0.0.5"}, "public internet"),
        ({"host": "169.254.169.254"}, "public internet"),
        ({"port": 22}, "25, 465, 587 or 2525"),
        ({"from_address": "jobs@acme.test\r\nBcc: spy@evil.test"}, "single line"),
        ({"reply_to": "a@b.test, c@d.test"}, "single email address"),
        ({"use_tls": False}, "TLS"),
    ):
        response = await client.put(url, headers=acme.headers, json=mail_body(**change))
        assert response.status_code == 400 and phrase in response.json()["detail"], (change, response.text)
    assert "mail" not in await stored_settings(acme.company_id)
    assert await audit(acme.company_id, "company_mail_update") == []


async def test_a_message_leaves_through_the_companys_server_and_a_failure_never_falls_back(client, make_company, smtp):
    acme = await make_company()
    await client.put(f"{API}/company-settings/mail", headers=acme.headers, json=mail_body())

    with company_context(acme.company_id, acme.doc):
        ok = await email_service.send_email(
            to="candidate@example.com", subject="Hello", html_body="<p>Hi</p>", text_body="Hi",
            db=get_db(), template="t_ok",
        )
        assert ok is True
        (call,) = smtp.calls
        assert call["hostname"] == "smtp.acme.test" and call["username"] == "mailer" and call["password"] == PASSWORD
        assert call["msg"]["From"] == "Acme Hiring <jobs@acme.test>" and call["msg"]["Reply-To"] == "hr@acme.test"
        assert smtp.opened == [("smtp.acme.test", 587)]

        smtp.calls.clear()
        smtp.fail_with = aiosmtplib.SMTPAuthenticationError(535, f"bad credentials {PASSWORD}")
        failed = await email_service.send_email(
            to="candidate@example.com", subject="Hello again", html_body="<p>Hi</p>", text_body="Hi",
            db=get_db(), template="t_fail",
        )
        assert failed is False
        assert [c["hostname"] for c in smtp.calls] == ["smtp.acme.test"]
        rows = {r["template"]: r for r in await get_db().email_log.find({"template": {"$in": ["t_ok", "t_fail"]}}).to_list(10)}
    assert rows["t_ok"]["status"] == "sent" and rows["t_fail"]["status"] == "failed"
    assert "user name or password" in rows["t_fail"]["error"] and PASSWORD not in rows["t_fail"]["error"]


async def test_a_company_that_did_not_choose_a_server_still_uses_the_platforms(client, make_company, smtp):
    plain = await make_company()
    with company_context(plain.company_id, plain.doc):
        assert await email_service.send_email(
            to="c@example.com", subject="Hello", html_body="<p>Hi</p>", text_body="Hi", db=get_db(), template="t_plain",
        ) is True
    (call,) = smtp.calls
    assert call["hostname"] == "platform-smtp.example.invalid" and "sock" not in call
    assert call["msg"]["From"] == f"{plain.name} <platform@example.com>" and smtp.opened == []


async def test_the_test_message_and_the_check_go_through_the_route(client, make_company, smtp, monkeypatch):
    acme = await make_company()
    base = f"{API}/company-settings/mail"
    checks = []

    async def fake_verify(settings_):
        checks.append(settings_["host"])
        return {"ok": True, "detail": "Connected to the mail server and signed in. No message was sent."}

    monkeypatch.setattr(mail_settings_service, "verify_connection", fake_verify)
    empty = await client.post(f"{base}/verify", headers=acme.headers)
    assert empty.status_code == 200 and empty.json()["ok"] is False
    await client.put(base, headers=acme.headers, json=mail_body())
    verified = await client.post(f"{base}/verify", headers=acme.headers)
    assert verified.json()["ok"] is True and checks == ["smtp.acme.test"] and smtp.calls == []
    assert [r["details"]["ok"] for r in await audit(acme.company_id, "company_mail_verify")] == [False, True]

    sent = await client.post(f"{base}/test-send", headers=acme.headers, json={"to": "me@example.com"})
    assert sent.status_code == 200, sent.text
    assert sent.json() == {"delivered": True, "via": "company", "detail": "The mail server accepted the message."}
    assert smtp.calls[0]["hostname"] == "smtp.acme.test" and smtp.calls[0]["msg"]["To"] == "me@example.com"
    (row,) = await audit(acme.company_id, "company_mail_test_send")
    assert row["details"] == {"to": "me@example.com", "delivered": True, "via": "company"}

    smtp.fail_with = aiosmtplib.SMTPAuthenticationError(535, "no")
    refused = await client.post(f"{base}/test-send", headers=acme.headers, json={"to": "me@example.com"})
    assert refused.json()["delivered"] is False and "user name or password" in refused.json()["detail"]
    assert len(smtp.calls) == 2

    assert (await client.post(f"{base}/test-send", headers=acme.headers, json={"to": "nobody"})).status_code == 400


async def test_test_messages_are_rate_limited_per_administrator(client, make_company, smtp):
    acme = await make_company()
    base = f"{API}/company-settings/mail/test-send"
    codes = [(await client.post(base, headers=acme.headers, json={"to": "me@example.com"})).status_code for _ in range(7)]
    assert codes[:5] == [200] * 5 and codes[5:] == [429, 429]


async def test_a_plan_without_custom_smtp_gets_402_on_every_mail_route_and_changes_nothing(client, make_company, smtp):
    acme = await make_company(features={"custom_smtp": False})
    base = f"{API}/company-settings/mail"
    for method, path, body in (
        ("GET", "", None), ("PUT", "", mail_body()), ("POST", "/verify", None), ("POST", "/test-send", {"to": "me@example.com"}),
    ):
        response = await client.request(method, base + path, headers=acme.headers, json=body)
        assert response.status_code == 402, (method, path, response.text)
        assert response.json()["detail"] == "Your plan does not include your own mail server."
    assert "mail" not in await stored_settings(acme.company_id)
    assert smtp.calls == [] and await audit(acme.company_id, "company_mail_update") == []

    await get_platform_db().clients.update_one({"client_id": acme.client_id}, {"$set": {"plan.features.custom_smtp": True}})
    assert (await client.get(base, headers=acme.headers)).status_code == 200


async def test_a_plan_without_integrations_gets_402_and_other_features_stay_open(client, make_company, smtp):
    acme = await make_company(features={"integrations": False})
    base = f"{API}/company-settings/integrations"
    for method, path, body in (("GET", "", None), ("GET", "/zoom", None), ("PUT", "/zoom", {"account_id": "acct_1"})):
        response = await client.request(method, base + path, headers=acme.headers, json=body)
        assert response.status_code == 402 and "HRMS, Zoom and Teams integrations" in response.json()["detail"]
    assert (await client.get(f"{API}/company-settings/mail", headers=acme.headers)).status_code == 200


async def test_the_role_is_judged_before_the_plan(client, make_company, smtp):
    acme = await make_company(features={"custom_smtp": False, "integrations": False})
    tag = uuid.uuid4().hex[:6]
    with company_context(acme.company_id, acme.doc):
        await get_db().users.insert_one({
            "name": "Plain", "email": f"plain-{tag}@example.com", "password_hash": _pwd.hash("x"), "role": "standard",
            "is_active": True, "otp_required": False,
        })
    try:
        plain = bearer(f"plain-{tag}@example.com")
        assert (await client.get(f"{API}/company-settings/mail", headers=plain)).status_code == 403
        assert (await client.get(f"{API}/company-settings/integrations/hrms", headers=plain)).status_code == 403
    finally:
        await get_platform_db().users.delete_many({"email": f"plain-{tag}@example.com"})


async def test_the_platform_owner_sets_domains_and_both_audit_logs_say_so(client, make_company):
    acme = await make_company()
    host = f"careers-{acme.tag}.example.com"
    url = f"{API}/platform/companies/{acme.company_id}/domains"

    saved = await client.put(url, headers=PLATFORM, json={"domains": [host.upper(), f"jobs-{acme.tag}.example.com", host]})
    assert saved.status_code == 200, saved.text
    assert saved.json() == {"company_id": acme.company_id, "domains": [host, f"jobs-{acme.tag}.example.com"]}
    assert (await client.get(url, headers=PLATFORM)).json() == {
        "company_id": acme.company_id, "domains": [host, f"jobs-{acme.tag}.example.com"], "plan_allows": True,
    }
    stored = await get_platform_db().companies.find_one({"company_id": acme.company_id})
    assert stored["custom_domains"] == [host, f"jobs-{acme.tag}.example.com"]

    platform_rows = await get_platform_db().audit_log.find({
        "company_id": "cmp_platform", "action": "company_domains_update", "resource_id": acme.company_id,
    }).to_list(5)
    assert len(platform_rows) == 1 and platform_rows[0]["actor_role"] == "platform_owner"
    own_rows = await audit(acme.company_id, "company_domains_update")
    assert len(own_rows) == 1 and own_rows[0]["details"]["domains"] == [host, f"jobs-{acme.tag}.example.com"]


async def test_a_domain_belongs_to_one_company_and_the_database_enforces_it(client, make_company):
    first, second = await make_company(), await make_company()
    host = f"shared-{first.tag}.example.com"
    ok = await client.put(f"{API}/platform/companies/{first.company_id}/domains", headers=PLATFORM, json={"domains": [host]})
    assert ok.status_code == 200
    clash = await client.put(f"{API}/platform/companies/{second.company_id}/domains", headers=PLATFORM, json={"domains": [host.upper()]})
    assert clash.status_code == 409 and clash.json()["detail"] == "That domain is already used by another company."
    assert (await get_platform_db().companies.find_one({"company_id": second.company_id})).get("custom_domains") in (None, [])

    with pytest.raises(DuplicateKeyError):
        await get_platform_db().companies.update_one({"company_id": second.company_id}, {"$set": {"custom_domains": [host]}})
    await get_platform_db().companies.update_one({"company_id": first.company_id}, {"$set": {"custom_domains": []}})
    await get_platform_db().companies.update_one({"company_id": second.company_id}, {"$set": {"custom_domains": []}})


async def test_the_domain_route_refuses_what_is_not_a_plain_host_name(client, make_company):
    acme = await make_company()
    url = f"{API}/platform/companies/{acme.company_id}/domains"
    for bad in (["https://careers.acme.com"], ["careers.acme.com/jobs"], ["careers.acme.com:8080"], ["192.168.1.1"], ["acme"], [f"h{i}.acme.com" for i in range(6)]):
        assert (await client.put(url, headers=PLATFORM, json={"domains": bad})).status_code == 400, bad
    own_host = (settings.FRONTEND_URL.split("//")[-1].split("/")[0].split(":")[0]).lower()
    if "." in own_host:
        own = await client.put(url, headers=PLATFORM, json={"domains": [own_host]})
        assert own.status_code == 400 and "product itself" in own.json()["detail"]
    assert (await client.put(f"{API}/platform/companies/cmp_nobody_here/domains", headers=PLATFORM, json={"domains": []})).status_code == 404
    assert (await get_platform_db().companies.find_one({"company_id": acme.company_id})).get("custom_domains") in (None, [])


async def test_a_plan_without_a_custom_domain_gets_402_but_can_always_clear(client, make_company):
    acme = await make_company(features={"custom_domain": False})
    url = f"{API}/platform/companies/{acme.company_id}/domains"
    refused = await client.put(url, headers=PLATFORM, json={"domains": [f"careers-{acme.tag}.example.com"]})
    assert refused.status_code == 402
    assert (await client.get(url, headers=PLATFORM)).json()["plan_allows"] is False
    assert (await client.put(url, headers=PLATFORM, json={"domains": []})).status_code == 200


async def test_company_accounts_cannot_set_domains(client, make_company):
    acme = await make_company()
    response = await client.put(
        f"{API}/platform/companies/{acme.company_id}/domains", headers=acme.headers, json={"domains": ["careers.acme.com"]},
    )
    assert response.status_code == 403 and "Platform owner access required" in response.text


async def _brand(company, **fields):
    with company_context(company.company_id, company.doc):
        await get_db().branding_settings.insert_one({"_id": "singleton", **fields})


async def test_a_custom_domain_shows_that_companys_branding_and_nobody_elses(plain_client, make_company, own_ip, monkeypatch):
    monkeypatch.setattr(settings, "TERMS_URL", "https://platform.example/terms")
    monkeypatch.setattr(settings, "PRIVACY_URL", "")
    acme, other = await make_company("Acme Hiring"), await make_company("Other Hiring")
    host = f"careers-{acme.tag}.example.com"
    await _brand(acme, primary_color="#112233", accent_color="#445566", company_logo_url="https://cdn.acme.test/logo.png")
    await _brand(other, primary_color="#aaaaaa", accent_color="#bbbbbb")
    with company_context(acme.company_id, acme.doc):
        await get_db().company_settings.insert_one({"_id": "singleton", "privacy_url": "https://acme.test/privacy"})
    owner = await plain_client.put(
        f"{API}/platform/companies/{acme.company_id}/domains", headers=PLATFORM, json={"domains": [host]},
    )
    assert owner.status_code == 200

    url = f"{API}/branding/public"
    by_host = await plain_client.get(url, headers={"Host": host})
    assert by_host.status_code == 200
    assert by_host.json() == {
        "company_logo_url": "https://cdn.acme.test/logo.png", "primary_color": "#112233", "accent_color": "#445566",
        "company_name": "Acme Hiring", "company_slug": acme.slug,
        "terms_url": "https://platform.example/terms", "privacy_url": "https://acme.test/privacy",
    }
    forwarded = await plain_client.get(url, headers={"Host": "api.internal", "X-Forwarded-Host": f"{host.upper()}:443, edge.example.com"})
    assert forwarded.json()["company_name"] == "Acme Hiring"

    defaults = {
        "company_logo_url": "", "primary_color": "#4778f3", "accent_color": "#222022", "company_name": "",
        "company_slug": "", "terms_url": "https://platform.example/terms", "privacy_url": "",
    }
    for stranger in (f"unknown-{acme.tag}.example.com", f"{host}.evil.example", f"x{host}", "test"):
        response = await plain_client.get(url, headers={"Host": stranger})
        assert response.status_code == 200 and response.json() == defaults, stranger
    assert (await plain_client.get(url, params={"company": other.slug})).json()["primary_color"] == "#aaaaaa"


async def test_a_domain_stops_resolving_when_removed_suspended_or_off_plan(plain_client, make_company, own_ip, monkeypatch):
    monkeypatch.setattr(settings, "TERMS_URL", "")
    acme = await make_company("Acme Hiring")
    host = f"careers-{acme.tag}.example.com"
    await _brand(acme, primary_color="#112233", accent_color="#445566")
    raw = get_platform_db()
    set_domains = lambda domains: raw.companies.update_one({"company_id": acme.company_id}, {"$set": {"custom_domains": domains}})

    async def name_seen():
        return (await plain_client.get(f"{API}/branding/public", headers={"Host": host})).json()["company_name"]

    await set_domains([host])
    assert await name_seen() == "Acme Hiring"
    await set_domains([])
    assert await name_seen() == ""
    await set_domains([host])
    await raw.companies.update_one({"company_id": acme.company_id}, {"$set": {"status": "suspended"}})
    assert await name_seen() == ""
    await raw.companies.update_one({"company_id": acme.company_id}, {"$set": {"status": "active"}})
    assert await name_seen() == "Acme Hiring"
    await raw.clients.update_one({"client_id": acme.client_id}, {"$set": {"status": "suspended"}})
    assert await name_seen() == ""
    await raw.clients.update_one({"client_id": acme.client_id}, {"$set": {"status": "active", "plan.features.custom_domain": False}})
    assert await name_seen() == ""


async def test_the_older_ways_of_naming_a_company_still_win_over_the_host(plain_client, make_company, own_ip):
    acme, other = await make_company("Acme Hiring"), await make_company("Other Hiring")
    host = f"careers-{acme.tag}.example.com"
    await _brand(acme, primary_color="#112233", accent_color="#445566")
    await _brand(other, primary_color="#aaaaaa", accent_color="#bbbbbb")
    await get_platform_db().companies.update_one({"company_id": acme.company_id}, {"$set": {"custom_domains": [host]}})
    url = f"{API}/branding/public"
    by_slug = await plain_client.get(url, params={"company": other.slug}, headers={"Host": host})
    assert by_slug.json()["company_name"] == "Other Hiring"
    signed_in = await plain_client.get(url, headers={**other.headers, "Host": host})
    assert signed_in.json()["company_name"] == "Other Hiring"
    miss = await plain_client.get(url, params={"company": "no-such-company"}, headers={"Host": host})
    assert miss.json()["company_name"] == "Acme Hiring"


async def test_public_branding_with_a_host_is_counted_like_any_other_lookup(plain_client, monkeypatch):
    import routes.branding as branding

    monkeypatch.setattr(
        branding, "_lookup_throttle",
        branding.public_token_throttle("branding-host-test", ip_limit=3, param=None, window_seconds=86400),
    )
    import shared.rate_limit as rate_limit

    ip = f"ch-{uuid.uuid4().hex[:10]}"
    monkeypatch.setattr(rate_limit, "client_ip", lambda request: ip)
    url = f"{API}/branding/public"
    for _ in range(6):
        assert (await plain_client.get(url)).status_code == 200
        assert (await plain_client.get(url, headers={"Host": "localhost:8000"})).status_code == 200
    codes = [(await plain_client.get(url, headers={"Host": f"nobody-{i}.example.com"})).status_code for i in range(5)]
    assert codes == [200, 200, 200, 429, 429]


def _captured_mail(monkeypatch):
    sent: list[dict] = []

    async def capture(**kwargs):
        sent.append(kwargs)
        return True

    monkeypatch.setattr(email_service, "send_email", capture)
    return sent


async def test_an_invitation_carries_the_companys_domain(client, make_company, monkeypatch):
    sent = _captured_mail(monkeypatch)
    acme, plain = await make_company("Acme Hiring"), await make_company("Plain Co")
    host = f"careers-{acme.tag}.example.com"
    assert (await client.put(
        f"{API}/platform/companies/{acme.company_id}/domains", headers=PLATFORM, json={"domains": [host]},
    )).status_code == 200
    created = []
    try:
        for co, address in ((acme, f"new-{acme.tag}@example.com"), (plain, f"new-{plain.tag}@example.com")):
            created.append(address)
            response = await client.post(
                f"{API}/auth/users", headers=co.headers,
                json={"name": "New Person", "email": address, "role": "standard", "send_invite": True},
            )
            assert response.status_code == 200 and response.json()["email_sent"] is True, response.text
    finally:
        await get_platform_db().users.delete_many({"email": {"$in": created}})
    acme_mail, plain_mail = sent
    assert f"https://{host}/reset-password?token=" in acme_mail["text_body"]
    assert f"https://{host}/reset-password?token=" in acme_mail["html_body"]
    assert "&invite=1" in acme_mail["text_body"] and settings.FRONTEND_URL not in acme_mail["text_body"]
    assert f"{settings.FRONTEND_URL.rstrip('/')}/reset-password?token=" in plain_mail["text_body"]
    assert host not in plain_mail["text_body"]


async def test_the_password_reset_link_follows_the_domain_too(client, make_company, monkeypatch):
    sent = _captured_mail(monkeypatch)
    acme = await make_company("Acme Hiring")
    host = f"careers-{acme.tag}.example.com"
    await client.put(f"{API}/platform/companies/{acme.company_id}/domains", headers=PLATFORM, json={"domains": [host]})
    response = await client.post(f"{API}/auth/forgot-password", json={"email": acme.email})
    assert response.status_code == 200
    import asyncio

    for _ in range(30):
        if sent:
            break
        await asyncio.sleep(0.1)
    assert sent and f"https://{host}/reset-password?token=" in sent[0]["text_body"]


async def test_integrations_are_the_companys_own_encrypted_and_never_returned(client, make_company, public_dns):
    acme, other = await make_company(), await make_company()
    base = f"{API}/company-settings/integrations"
    saved = await client.put(f"{base}/hrms", headers=acme.headers, json={
        "url": "https://hrms.example.com/hooks/hires", "auth_header": "Authorization", "auth_token": "Bearer abc.def",
        "auto_push_on_hire": True,
    })
    assert saved.status_code == 200, saved.text
    view = saved.json()
    assert view["configured"] is True and view["source"] == "company" and view["has_auth_token"] is True
    assert "abc.def" not in saved.text and "auth_token" not in view
    assert (await client.get(f"{base}/hrms", headers=acme.headers)).json() == view
    stored = (await stored_settings(acme.company_id))["integrations"]["hrms"]
    assert secrets.decrypt(stored["auth_token"]) == "Bearer abc.def" and "abc.def" not in stored["auth_token"]
    profile = await client.get(f"{API}/company-settings", headers=acme.headers)
    assert "integrations" not in profile.json() and "abc.def" not in profile.text

    zoom = await client.put(f"{base}/zoom", headers=acme.headers, json={"account_id": "acct_1", "client_id": "cid_1", "client_secret": "zs3cret"})
    assert zoom.json()["configured"] is True and "zs3cret" not in zoom.text
    everything = await client.get(base, headers=acme.headers)
    assert set(everything.json()["integrations"]) == {"hrms", "zoom", "teams"} and "zs3cret" not in everything.text

    theirs = (await client.get(base, headers=other.headers)).json()["integrations"]
    assert all(v["configured"] is False and v["source"] is None for v in theirs.values())

    await client.put(f"{base}/hrms", headers=acme.headers, json={"auto_push_on_hire": False})
    assert (await client.get(f"{base}/hrms", headers=acme.headers)).json()["has_auth_token"] is True
    cleared = await client.put(f"{base}/hrms", headers=acme.headers, json={"clear_secret": True})
    assert cleared.json()["has_auth_token"] is False

    audited = await audit(acme.company_id, "company_integration_update")
    assert [r["resource_id"] for r in audited] == ["integration:hrms", "integration:zoom", "integration:hrms", "integration:hrms"]
    assert "zs3cret" not in str(audited) and "abc.def" not in str(audited)


async def test_bad_integration_settings_are_refused(client, make_company, public_dns, monkeypatch):
    acme = await make_company()
    base = f"{API}/company-settings/integrations"
    assert (await client.get(f"{base}/slack", headers=acme.headers)).status_code == 404
    for name, body in (
        ("hrms", {"url": "http://hrms.example.com/hook"}), ("hrms", {"url": "https://u:p@hrms.example.com/hook"}),
        ("hrms", {"auth_header": "Host"}), ("zoom", {"account_id": "a/b"}), ("teams", {"organizer": "../x"}),
    ):
        assert (await client.put(f"{base}/{name}", headers=acme.headers, json=body)).status_code == 400, (name, body)
    monkeypatch.setattr(integrations, "resolve_public", real_resolve_public)
    for url in ("https://10.0.0.5/hook", "https://127.0.0.1/hook", "https://169.254.169.254/latest"):
        refused = await client.put(f"{base}/hrms", headers=acme.headers, json={"url": url})
        assert refused.status_code == 400 and "public website" in refused.json()["detail"]
    assert "integrations" not in await stored_settings(acme.company_id)


async def test_the_deployments_environment_belongs_to_the_default_company_only(client, make_company, monkeypatch):
    for name, value in (
        ("HRMS_WEBHOOK_URL", "https://env-hrms.example.com/x"), ("HRMS_AUTO_PUSH_ON_HIRE", True),
        ("ZOOM_ACCOUNT_ID", "env_acct"), ("ZOOM_CLIENT_ID", "env_client"), ("ZOOM_CLIENT_SECRET", "env_secret"),
    ):
        monkeypatch.setattr(settings, name, value)
    acme = await make_company()
    status = (await client.get(f"{API}/integrations/status", headers=acme.headers)).json()
    assert status["meetings"]["configured_providers"] == [] and status["hrms"] == {
        "configured": False, "auto_push_on_hire": False, "record_version": hrms_service.EMPLOYEE_RECORD_VERSION,
    }
    for needle in ("env-hrms", "env_acct", "env_secret"):
        assert needle not in str(status)
    assert (await client.post(f"{API}/integrations/hrms/push/anyone", headers=acme.headers)).status_code == 503
    with company_context(acme.company_id, acme.doc):
        assert await hrms_service.is_configured_for_company() is False and await hrms_service.auto_push_enabled() is False
        with pytest.raises(meeting_service.MeetingServiceError):
            await meeting_service.create_meeting(topic="x", start_iso="2026-11-03T10:00:00Z")
    own = (await client.get(f"{API}/integrations/status", headers={"Authorization": "Bearer demo-admin-token"})).json()
    assert own["meetings"]["configured_providers"] == ["zoom"] and own["hrms"]["configured"] is True
    assert own["hrms"]["auto_push_on_hire"] is True
    assert "env-hrms" not in str(own) and "env_secret" not in str(own)


async def test_a_hire_is_pushed_to_the_companys_own_hrms_and_to_nobody_elses(client, make_company, public_dns, monkeypatch):
    acme, other = await make_company(), await make_company()
    seen: list[httpx.Request] = []

    def hrms(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"ok": True})

    monkeypatch.setattr(hrms_service, "_TRANSPORT", httpx.MockTransport(hrms))
    candidate_id = f"cand-ch-{uuid.uuid4().hex[:8]}"
    other_candidate_id = f"{candidate_id}-b"
    for co, cid in ((acme, candidate_id), (other, other_candidate_id)):
        with company_context(co.company_id, co.doc):
            await get_db().candidates.insert_one({
                "doc_type": "candidate", "candidate_id": cid, "job_id": "job-x", "name": "Hired Person",
                "email": "hired@example.com", "status": "hired",
            })
    await client.put(f"{API}/company-settings/integrations/hrms", headers=acme.headers, json={
        "url": "https://hrms.example.com/hooks/hires", "auth_header": "Authorization", "auth_token": "Bearer abc.def",
    })

    pushed = await client.post(f"{API}/integrations/hrms/push/{candidate_id}", headers=acme.headers)
    assert pushed.status_code == 200, pushed.text
    assert pushed.json() == {"status": "sent", "detail": "", "http_status": 200}
    (request,) = seen
    assert str(request.url) == f"https://{PUBLIC_IP}/hooks/hires" and request.headers["host"] == "hrms.example.com"
    assert request.headers["authorization"] == "Bearer abc.def"
    with company_context(acme.company_id, acme.doc):
        log = await hrms_service.sync_log(candidate_id)
    assert [row["status"] for row in log] == ["sent"]

    refused = await client.post(f"{API}/integrations/hrms/push/{other_candidate_id}", headers=other.headers)
    assert refused.status_code == 503 and "not set up" in refused.json()["detail"]
    assert len(seen) == 1


async def test_terms_and_privacy_links_are_on_the_profile_and_in_the_public_branding(client, plain_client, make_company, own_ip, monkeypatch):
    monkeypatch.setattr(settings, "TERMS_URL", "https://platform.example/terms")
    monkeypatch.setattr(settings, "PRIVACY_URL", "https://platform.example/privacy")
    acme = await make_company("Acme Hiring")
    public = f"{API}/branding/public"

    fallback = (await plain_client.get(public, params={"company": acme.slug})).json()
    assert fallback["terms_url"] == "https://platform.example/terms" and fallback["privacy_url"] == "https://platform.example/privacy"

    saved = await client.patch(
        f"{API}/company-settings", headers=acme.headers,
        json={"terms_url": " https://acme.test/legal/terms ", "privacy_url": "https://acme.test/legal/privacy"},
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["terms_url"] == "https://acme.test/legal/terms"
    assert (await client.get(f"{API}/company-settings", headers=acme.headers)).json()["privacy_url"] == "https://acme.test/legal/privacy"
    own = (await plain_client.get(public, params={"company": acme.slug})).json()
    assert own["terms_url"] == "https://acme.test/legal/terms" and own["privacy_url"] == "https://acme.test/legal/privacy"
    assert set(own) == {"company_logo_url", "primary_color", "accent_color", "company_name", "company_slug", "terms_url", "privacy_url"}

    await client.patch(f"{API}/company-settings", headers=acme.headers, json={"terms_url": ""})
    after = (await plain_client.get(public, params={"company": acme.slug})).json()
    assert after["terms_url"] == "https://platform.example/terms" and after["privacy_url"] == "https://acme.test/legal/privacy"

    anonymous = (await plain_client.get(public)).json()
    assert anonymous["company_name"] == "" and anonymous["terms_url"] == "https://platform.example/terms"


async def test_a_legal_link_must_be_a_short_plain_https_address(client, make_company):
    acme = await make_company()
    url = f"{API}/company-settings"
    for bad in ("http://acme.test/terms", "javascript:alert(1)", "//acme.test/terms", "acme.test/terms",
                "https://user:pw@acme.test/terms", "https://acme.test/te rms", "https://acme.test/" + "a" * 300):
        response = await client.patch(url, headers=acme.headers, json={"privacy_url": bad})
        assert response.status_code == 400 and isinstance(response.json()["detail"], str), bad
    assert (await client.get(url, headers=acme.headers)).json()["privacy_url"] == ""
    ok = await client.patch(url, headers=acme.headers, json={"privacy_url": "https://acme.test/" + "a" * 280})
    assert ok.status_code == 200 and len(ok.json()["privacy_url"]) <= 300
