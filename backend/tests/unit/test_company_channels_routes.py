import copy
from types import SimpleNamespace

import pytest
from httpx import ASGITransport, AsyncClient

from config import tenancy
from config.settings import settings
from config.tenancy import DEFAULT_COMPANY_ID, bind_company
from main import app
from routes import branding as branding_routes
from routes import company_integrations as integrations_routes
from routes import company_mail as mail_routes
from routes import company_settings as company_settings_routes
from services.hr_module import (
    branding_service,
    company_settings_service,
    domains_service,
    email_service,
    mail_settings_service,
    workspace_service,
)
from services.hr_module import integrations_settings_service as integrations
from shared import safe_http, secrets, tenant_deps
from shared.auth import get_current_user

pytestmark = pytest.mark.anyio

API = "/api/v1"
SUPER = {"Authorization": "Bearer demo-superadmin-token"}
ADMIN = {"Authorization": "Bearer demo-admin-token"}
STANDARD = {"Authorization": "Bearer demo-standard-token"}
PLATFORM = {"Authorization": "Bearer demo-platform-token"}
PUBLIC_IP = "93.184.216.34"


class MemCollection:

    def __init__(self):
        self.docs: list[dict] = []

    @staticmethod
    def _ok(doc, flt):
        for key, cond in (flt or {}).items():
            value = doc.get(key)
            if isinstance(cond, dict) and any(k.startswith("$") for k in cond):
                if "$in" in cond and value not in cond["$in"]:
                    return False
                if "$gte" in cond and not (value is not None and value >= cond["$gte"]):
                    return False
            elif value != cond:
                return False
        return True

    async def find_one(self, flt=None, projection=None, sort=None):
        rows = [d for d in self.docs if self._ok(d, flt)]
        if sort:
            rows.sort(key=lambda d: d.get(sort[0][0]) or "", reverse=sort[0][1] == -1)
        return copy.deepcopy(rows[0]) if rows else None

    async def insert_one(self, doc):
        self.docs.append(copy.deepcopy(doc))

    async def update_one(self, flt, update, upsert=False):
        row = next((d for d in self.docs if self._ok(d, flt)), None)
        if row is None:
            if not upsert:
                return
            row = {k: v for k, v in flt.items() if not isinstance(v, dict)}
            self.docs.append(row)
        for path, value in update.get("$set", {}).items():
            target = row
            *parents, last = path.split(".")
            for part in parents:
                target = target.setdefault(part, {})
            target[last] = copy.deepcopy(value)


class MemDB:
    def __init__(self):
        self._collections: dict[str, MemCollection] = {}

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        return self._collections.setdefault(name, MemCollection())


class Limiter:
    def __init__(self):
        self.keys: list[str] = []

    async def __call__(self, db, *, key, limit, window_seconds):
        self.keys.append(key)


@pytest.fixture
def db(monkeypatch):
    memory = MemDB()
    for module in (
        mail_routes, integrations_routes, company_settings_routes, mail_settings_service, integrations,
        company_settings_service, branding_service,
    ):
        monkeypatch.setattr(module, "get_db", lambda: memory)

    async def public(host, port):
        return [PUBLIC_IP]

    monkeypatch.setattr(mail_settings_service, "resolve_public", public)
    monkeypatch.setattr(integrations, "resolve_public", public)
    return memory


@pytest.fixture
def limiter(monkeypatch):
    limiter = Limiter()
    monkeypatch.setattr(mail_routes, "enforce_rate_limit", limiter)
    return limiter


@pytest.fixture
async def http():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client


@pytest.fixture
def signed_in_as():
    def _as(role="superadmin", *, features=None, company_id="cmp_acme", custom_domains=None):
        company = {
            "company_id": company_id, "name": "Acme", "settings": {},
            "client_plan": {"features": features} if features is not None else {},
            "custom_domains": custom_domains or [],
        }

        async def dependency():
            bind_company(company_id, company)
            return {"email": "boss@acme.test", "name": "Boss", "role": role, "company_id": company_id, "is_platform_admin": False}

        app.dependency_overrides[get_current_user] = dependency
    yield _as
    app.dependency_overrides.pop(get_current_user, None)


def mail_body(**extra) -> dict:
    return {
        "mode": "smtp", "from_name": "Acme Hiring", "from_address": "jobs@acme.test", "reply_to": "hr@acme.test",
        "host": "smtp.acme.test", "port": 587, "username": "mailer", "password": "s3cret-pass", "use_tls": True, **extra,
    }


def audit_rows(db, action):
    return [r for r in db.audit_log.docs if r["action"] == action]


MAIL_ROUTES = [
    ("GET", f"{API}/company-settings/mail", None),
    ("PUT", f"{API}/company-settings/mail", {"mode": "platform"}),
    ("POST", f"{API}/company-settings/mail/verify", None),
    ("POST", f"{API}/company-settings/mail/test-send", {"to": "someone@example.com"}),
]
INTEGRATION_ROUTES = [
    ("GET", f"{API}/company-settings/integrations", None),
    ("GET", f"{API}/company-settings/integrations/zoom", None),
    ("PUT", f"{API}/company-settings/integrations/zoom", {"account_id": "abcd"}),
]


@pytest.mark.parametrize("method,url,body", MAIL_ROUTES + INTEGRATION_ROUTES)
async def test_only_the_top_administrator_of_the_company_may_use_them(http, db, limiter, monkeypatch, method, url, body):
    async def fake_send(**kwargs):
        return True

    monkeypatch.setattr(email_service, "send_email", fake_send)
    for headers in (STANDARD, ADMIN):
        assert (await http.request(method, url, headers=headers, json=body)).status_code == 403
    assert (await http.request(method, url)).status_code == 401
    assert (await http.request(method, url, headers=SUPER, json=body)).status_code != 403


@pytest.mark.parametrize("method,url,body", MAIL_ROUTES)
async def test_a_plan_without_a_mail_server_answers_402_after_the_role_check(http, db, limiter, signed_in_as, method, url, body):
    signed_in_as("superadmin", features={"custom_smtp": False})
    response = await http.request(method, url, json=body)
    assert response.status_code == 402 and response.json()["detail"] == "Your plan does not include your own mail server."
    signed_in_as("standard", features={"custom_smtp": False})
    assert (await http.request(method, url, json=body)).status_code == 403
    signed_in_as("superadmin", features={"custom_smtp": True, "integrations": False})
    assert (await http.request(method, url, json=body)).status_code != 402


@pytest.mark.parametrize("method,url,body", INTEGRATION_ROUTES)
async def test_a_plan_without_integrations_answers_402(http, db, signed_in_as, method, url, body):
    signed_in_as("superadmin", features={"integrations": False})
    response = await http.request(method, url, json=body)
    assert response.status_code == 402 and "HRMS, Zoom and Teams" in response.json()["detail"]
    signed_in_as("superadmin", features={"custom_smtp": False})
    assert (await http.request(method, url, json=body)).status_code != 402


async def test_the_mail_settings_roundtrip_without_ever_returning_the_password(http, db, limiter):
    url = f"{API}/company-settings/mail"
    fresh = (await http.get(url, headers=SUPER)).json()
    assert fresh["mode"] == "platform" and fresh["has_password"] is False and fresh["complete"] is False

    saved = await http.put(url, headers=SUPER, json=mail_body())
    assert saved.status_code == 200, saved.text
    body = saved.json()
    assert body["mode"] == "smtp" and body["host"] == "smtp.acme.test" and body["has_password"] is True and body["complete"] is True
    assert body["updated_by"] == "demo-superadmin@hirely.ai"
    again = (await http.get(url, headers=SUPER)).json()
    assert again == body
    for text in (saved.text, str(again)):
        assert "s3cret-pass" not in text and secrets.PREFIX not in text and "password" not in {k for k in again if k != "has_password"}

    stored = db.company_settings.docs[0]["mail"]
    assert secrets.decrypt(stored["password"]) == "s3cret-pass" and "s3cret-pass" not in str(stored["password"])
    profile = await company_settings_service.get_company_settings()
    assert "mail" not in profile and "enc:v1" not in str(profile)

    kept = await http.put(url, headers=SUPER, json={"from_name": "Acme Jobs"})
    assert kept.status_code == 200 and kept.json()["has_password"] is True and kept.json()["from_name"] == "Acme Jobs"


async def test_a_host_inside_the_network_is_a_400_with_a_plain_sentence(http, db, limiter, monkeypatch):
    monkeypatch.setattr(mail_settings_service, "resolve_public", safe_http.resolve_public)
    for host in ("10.0.0.5", "127.0.0.1", "169.254.169.254"):
        response = await http.put(f"{API}/company-settings/mail", headers=SUPER, json=mail_body(host=host))
        assert response.status_code == 400 and "public internet" in response.json()["detail"], host
        assert host not in response.text
    assert db.company_settings.docs == []


async def test_a_bad_setting_is_a_400_with_a_plain_sentence_and_saves_nothing(http, db, limiter):
    url = f"{API}/company-settings/mail"
    for change, phrase in (
        ({"port": 80}, "25, 465, 587 or 2525"),
        ({"from_address": "jobs@acme.test\r\nBcc: spy@evil.test"}, "single line"),
        ({"reply_to": "a@b.test, c@d.test"}, "single email address"),
        ({"from_name": "Acme\nHiring"}, "single line"),
        ({"use_tls": False}, "TLS"),
        ({"mode": "carrier-pigeon"}, "platform or smtp"),
    ):
        response = await http.put(url, headers=SUPER, json=mail_body(**change))
        assert response.status_code == 400, (change, response.text)
        assert phrase in response.json()["detail"], (change, response.json())
        assert isinstance(response.json()["detail"], str)
    assert db.company_settings.docs == []


async def test_a_change_is_audited_without_the_password(http, db, limiter):
    await http.put(f"{API}/company-settings/mail", headers=SUPER, json=mail_body())
    (row,) = audit_rows(db, "company_mail_update")
    assert row["actor_email"] == "demo-superadmin@hirely.ai" and row["actor_role"] == "superadmin"
    assert row["details"] == {
        "mode": "smtp", "host": "smtp.acme.test", "port": 587, "from_address": "jobs@acme.test",
        "username_set": True, "use_tls": True, "password_changed": True,
    }
    assert "s3cret-pass" not in str(db.audit_log.docs)


async def test_verify_checks_the_saved_server_and_sends_nothing(http, db, limiter, monkeypatch):
    url = f"{API}/company-settings/mail/verify"
    empty = await http.post(url, headers=SUPER)
    assert empty.status_code == 200 and empty.json() == {"ok": False, "detail": "Save the mail server settings first."}

    await http.put(f"{API}/company-settings/mail", headers=SUPER, json=mail_body())
    checked = []

    async def fake_verify(smtp):
        checked.append(smtp)
        return {"ok": True, "detail": "Connected to the mail server and signed in. No message was sent."}

    async def never_send(**kwargs):
        raise AssertionError("verify must not send a message")

    monkeypatch.setattr(mail_settings_service, "verify_connection", fake_verify)
    monkeypatch.setattr(email_service, "send_email", never_send)
    ok = await http.post(url, headers=SUPER)
    assert ok.status_code == 200 and ok.json()["ok"] is True and set(ok.json()) == {"ok", "detail"}
    assert checked[0]["host"] == "smtp.acme.test" and checked[0]["password"] == "s3cret-pass"
    assert "smtp.acme.test" not in ok.text and "s3cret-pass" not in ok.text
    assert limiter.keys.count("company_mail_verify:demo-superadmin@hirely.ai") == 2
    assert [r["details"] for r in audit_rows(db, "company_mail_verify")] == [{"ok": False}, {"ok": True}]


async def test_verify_checks_a_server_that_is_saved_but_not_switched_on(http, db, limiter, monkeypatch):
    await http.put(f"{API}/company-settings/mail", headers=SUPER, json=mail_body())
    await http.put(f"{API}/company-settings/mail", headers=SUPER, json={"mode": "platform"})
    seen = []

    async def fake_verify(smtp):
        seen.append(smtp["host"])
        return {"ok": True, "detail": "fine"}

    monkeypatch.setattr(mail_settings_service, "verify_connection", fake_verify)
    assert (await http.post(f"{API}/company-settings/mail/verify", headers=SUPER)).json()["ok"] is True
    assert seen == ["smtp.acme.test"]


async def test_a_test_message_goes_through_the_companys_path_and_is_limited_and_audited(http, db, limiter, monkeypatch):
    sent = []

    async def fake_send(**kwargs):
        sent.append(kwargs)
        return True

    monkeypatch.setattr(email_service, "send_email", fake_send)
    url = f"{API}/company-settings/mail/test-send"
    await http.put(f"{API}/company-settings/mail", headers=SUPER, json=mail_body())
    ok = await http.post(url, headers=SUPER, json={"to": "  me@example.com "})
    assert ok.status_code == 200
    assert ok.json() == {"delivered": True, "via": "company", "detail": "The mail server accepted the message."}
    (message,) = sent
    assert message["to"] == "me@example.com" and message["template"] == "company_mail_test"
    assert "test" in message["subject"] and "No action is needed" in message["text_body"]
    assert "s3cret-pass" not in str(message)
    assert "company_mail_test:demo-superadmin@hirely.ai" in limiter.keys
    assert any(key.endswith(":mail_test") and key.startswith("co:") for key in limiter.keys)
    (audit,) = audit_rows(db, "company_mail_test_send")
    assert audit["details"] == {"to": "me@example.com", "delivered": True, "via": "company"}

    await http.put(f"{API}/company-settings/mail", headers=SUPER, json={"mode": "platform"})
    platform = await http.post(url, headers=SUPER, json={"to": "me@example.com"})
    assert platform.json()["via"] == "platform" and "platform" in platform.json()["detail"]


async def test_a_test_message_that_fails_says_why_in_our_words(http, db, limiter, monkeypatch):
    await http.put(f"{API}/company-settings/mail", headers=SUPER, json=mail_body())

    async def failing_send(**kwargs):
        await db.email_log.insert_one({
            "to": kwargs["to"], "template": kwargs["template"], "status": "failed",
            "created_at": "2999-01-01T00:00:00+00:00", "error": "CompanyMailError: The mail server rejected the user name or password.",
        })
        return False

    monkeypatch.setattr(email_service, "send_email", failing_send)
    response = await http.post(f"{API}/company-settings/mail/test-send", headers=SUPER, json={"to": "me@example.com"})
    assert response.status_code == 200
    assert response.json() == {"delivered": False, "via": "company", "detail": "The mail server rejected the user name or password."}
    assert audit_rows(db, "company_mail_test_send")[0]["details"]["delivered"] is False


@pytest.mark.parametrize("to", ["", "nobody", "a@b", "a@b.com, c@d.com", "x@y.com\r\nBcc: z@y.com"])
async def test_a_test_message_needs_one_valid_address(http, db, limiter, monkeypatch, to):
    async def fake_send(**kwargs):
        raise AssertionError("nothing may be sent")

    monkeypatch.setattr(email_service, "send_email", fake_send)
    response = await http.post(f"{API}/company-settings/mail/test-send", headers=SUPER, json={"to": to})
    assert response.status_code == 400 and response.json()["detail"] == "Enter a valid email address."


async def test_an_integration_roundtrips_with_its_secret_hidden(http, db):
    base = f"{API}/company-settings/integrations"
    listed = (await http.get(base, headers=SUPER)).json()["integrations"]
    assert set(listed) == {"hrms", "zoom", "teams"} and all(v["configured"] is False for v in listed.values())

    saved = await http.put(f"{base}/hrms", headers=SUPER, json={
        "url": f"https://{PUBLIC_IP}/hires", "auth_header": "Authorization", "auth_token": "Bearer abc.def", "auto_push_on_hire": True,
    })
    assert saved.status_code == 200, saved.text
    view = saved.json()
    assert view["configured"] is True and view["source"] == "company" and view["has_auth_token"] is True
    assert view["auto_push_on_hire"] is True and view["url"] == f"https://{PUBLIC_IP}/hires"
    assert "auth_token" not in view and "abc.def" not in saved.text
    assert (await http.get(f"{base}/hrms", headers=SUPER)).json() == view
    assert secrets.decrypt(db.company_settings.docs[0]["integrations"]["hrms"]["auth_token"]) == "Bearer abc.def"

    await http.put(f"{base}/hrms", headers=SUPER, json={"auto_push_on_hire": False})
    assert (await http.get(f"{base}/hrms", headers=SUPER)).json()["has_auth_token"] is True
    cleared = await http.put(f"{base}/hrms", headers=SUPER, json={"clear_secret": True})
    assert cleared.json()["has_auth_token"] is False and cleared.json()["auto_push_on_hire"] is False

    zoom = await http.put(f"{base}/zoom", headers=SUPER, json={"account_id": "acct_1", "client_id": "cid_1", "client_secret": "zs3cret"})
    assert zoom.json()["configured"] is True and zoom.json()["has_client_secret"] is True and "zs3cret" not in zoom.text
    teams = await http.put(f"{base}/teams", headers=SUPER, json={
        "tenant_id": "contoso.onmicrosoft.com", "client_id": "11111111-2222-3333-4444-555555555555",
        "client_secret": "ts3cret", "organizer": "boss@contoso.com",
    })
    assert teams.json()["configured"] is True and "ts3cret" not in teams.text
    everything = (await http.get(base, headers=SUPER)).text
    assert "zs3cret" not in everything and "ts3cret" not in everything and secrets.PREFIX not in everything


async def test_a_bad_integration_is_a_400_or_a_404(http, db):
    base = f"{API}/company-settings/integrations"
    assert (await http.get(f"{base}/slack", headers=SUPER)).status_code == 404
    assert (await http.put(f"{base}/slack", headers=SUPER, json={})).status_code == 404
    for name, body in (
        ("hrms", {"url": "http://hrms.example.com/hook"}),
        ("hrms", {"url": "https://user:pw@hrms.example.com/hook"}),
        ("hrms", {"auth_header": "Host"}),
        ("zoom", {"account_id": "a/b"}),
        ("teams", {"organizer": "../x"}),
    ):
        response = await http.put(f"{base}/{name}", headers=SUPER, json=body)
        assert response.status_code == 400 and isinstance(response.json()["detail"], str), (name, body, response.text)
    assert db.company_settings.docs == []


async def test_an_hrms_address_inside_the_network_is_refused(http, db, monkeypatch):
    monkeypatch.setattr(integrations, "resolve_public", safe_http.resolve_public)
    for url in ("https://10.0.0.5/hook", "https://127.0.0.1/hook", "https://169.254.169.254/latest"):
        response = await http.put(f"{API}/company-settings/integrations/hrms", headers=SUPER, json={"url": url})
        assert response.status_code == 400 and "public website" in response.json()["detail"], url
    assert db.company_settings.docs == []


async def test_an_integration_save_is_audited_without_values(http, db):
    await http.put(
        f"{API}/company-settings/integrations/zoom", headers=SUPER,
        json={"account_id": "acct_1", "client_id": "cid_1", "client_secret": "zs3cret"},
    )
    (row,) = audit_rows(db, "company_integration_update")
    assert row["resource_id"] == "integration:zoom"
    assert row["details"] == {"integration": "zoom", "fields": ["account_id", "client_id"], "secret_changed": True, "configured": True}
    assert "zs3cret" not in str(db.audit_log.docs) and "acct_1" not in str(row)


async def test_the_status_endpoint_reports_the_companys_own_configuration_and_no_hosts(http, db, monkeypatch):
    for name, value in (("HRMS_WEBHOOK_URL", "https://env-hrms.example.com/x"), ("ZOOM_ACCOUNT_ID", "env_a"),
                        ("ZOOM_CLIENT_ID", "env_c"), ("ZOOM_CLIENT_SECRET", "env_s"), ("EMAIL_HOST", "smtp.platform.example")):
        monkeypatch.setattr(settings, name, value)
    other = {"Authorization": "Bearer demo-superadmin-token@@cmp_other_co"}
    status = (await http.get(f"{API}/integrations/status", headers=other)).json()
    assert status["meetings"]["configured_providers"] == [] and status["hrms"]["configured"] is False
    assert status["hrms"]["auto_push_on_hire"] is False
    assert status["email"]["mode"] == "platform"
    text = str(status)
    for needle in ("env-hrms", "env_a", "env_s", "smtp.platform.example"):
        assert needle not in text
    own = (await http.get(f"{API}/integrations/status", headers=SUPER)).json()
    assert own["meetings"]["configured_providers"] == ["zoom"] and own["hrms"]["configured"] is True
    assert "env-hrms" not in str(own) and "env_s" not in str(own)


async def test_the_status_endpoint_says_when_the_company_sends_through_its_own_server(http, db):
    await http.put(f"{API}/company-settings/mail", headers=SUPER, json=mail_body())
    status = (await http.get(f"{API}/integrations/status", headers=SUPER)).json()
    assert status["email"] == {"mode": "smtp", "transport": "smtp"}
    assert "smtp.acme.test" not in str(status)


class Directory:

    def __init__(self):
        self.domains: dict[str, list[str]] = {"cmp_acme": [], "cmp_other": ["taken.example.com"]}
        self.plans: dict[str, dict] = {}
        self.audits: list[tuple] = []


@pytest.fixture
def directory(monkeypatch):
    d = Directory()

    class Companies:
        async def find_one(self, flt, projection=None):
            wanted = set(flt["custom_domains"]["$in"])
            for company_id, domains in d.domains.items():
                if company_id != flt["company_id"]["$ne"] and wanted & set(domains):
                    return {"company_id": company_id}

        async def update_one(self, flt, update):
            d.domains[flt["company_id"]] = update["$set"]["custom_domains"]

    async def load(company_id):
        if company_id not in d.domains:
            return None
        return {"company_id": company_id, "kind": "workspace", "custom_domains": d.domains[company_id],
                "client_plan": d.plans.get(company_id, {})}

    async def audit(actor, action, resource_type, resource_id=None, details=None, *, also_company=None):
        d.audits.append((actor["email"], action, resource_type, resource_id, details, also_company))

    monkeypatch.setattr(domains_service, "get_platform_db", lambda: SimpleNamespace(companies=Companies()))
    monkeypatch.setattr(domains_service, "load_company", load)
    monkeypatch.setattr(workspace_service, "platform_audit", audit)
    return d


async def test_the_platform_owner_sets_a_companys_domains(http, directory):
    url = f"{API}/platform/companies/cmp_acme/domains"
    assert (await http.get(url, headers=PLATFORM)).json() == {"company_id": "cmp_acme", "domains": [], "plan_allows": True}
    saved = await http.put(url, headers=PLATFORM, json={"domains": ["Careers.Acme.com", "jobs.acme.com", "careers.acme.com"]})
    assert saved.status_code == 200
    assert saved.json() == {"company_id": "cmp_acme", "domains": ["careers.acme.com", "jobs.acme.com"]}
    assert (await http.get(url, headers=PLATFORM)).json()["domains"] == ["careers.acme.com", "jobs.acme.com"]
    assert directory.audits == [(
        "demo-superadmin@hirely.ai", "company_domains_update", "company", "cmp_acme",
        {"domains": ["careers.acme.com", "jobs.acme.com"]}, "cmp_acme",
    )]
    cleared = await http.put(url, headers=PLATFORM, json={"domains": []})
    assert cleared.json()["domains"] == []


async def test_the_domain_routes_answer_the_documented_errors(http, directory, monkeypatch):
    url = f"{API}/platform/companies/cmp_acme/domains"
    taken = await http.put(url, headers=PLATFORM, json={"domains": ["taken.example.com"]})
    assert taken.status_code == 409 and taken.json()["detail"] == "That domain is already used by another company."
    for bad in (["https://careers.acme.com"], ["careers"], ["10.0.0.1"], [f"h{i}.acme.com" for i in range(6)]):
        assert (await http.put(url, headers=PLATFORM, json={"domains": bad})).status_code == 400, bad
    monkeypatch.setattr(settings, "FRONTEND_URL", "https://app.hrbot.example")
    own = await http.put(url, headers=PLATFORM, json={"domains": ["app.hrbot.example"]})
    assert own.status_code == 400 and "product itself" in own.json()["detail"]
    assert (await http.put(f"{API}/platform/companies/cmp_nobody/domains", headers=PLATFORM, json={"domains": []})).status_code == 404
    directory.plans["cmp_acme"] = {"features": {"custom_domain": False}}
    no_plan = await http.put(url, headers=PLATFORM, json={"domains": ["careers.acme.com"]})
    assert no_plan.status_code == 402 and "custom domain" in no_plan.json()["detail"]
    assert (await http.put(url, headers=PLATFORM, json={"domains": []})).status_code == 200
    assert directory.domains["cmp_acme"] == []


async def test_a_company_account_may_not_set_domains(http, directory):
    url = f"{API}/platform/companies/cmp_acme/domains"
    for headers in (SUPER, ADMIN, STANDARD):
        response = await http.put(url, headers=headers, json={"domains": ["careers.acme.com"]})
        assert response.status_code == 403 and "Platform owner access required" in response.text
    assert directory.domains["cmp_acme"] == []


@pytest.fixture
def host_lookup(monkeypatch, db):
    companies = {
        "careers.acme.com": {
            "company_id": "cmp_acme", "name": "Acme Hiring", "status": "active", "kind": "workspace",
            "client_status": "active", "client_plan": {}, "settings": {}, "custom_domains": ["careers.acme.com"],
        },
    }
    lookups: list[str] = []

    class Companies:
        async def find_one(self, flt, projection=None):
            lookups.append(flt["custom_domains"])
            company = companies.get(flt["custom_domains"])
            return {"company_id": company["company_id"]} if company and flt["status"] == "active" else None

    async def load(company_id):
        return next((c for c in companies.values() if c["company_id"] == company_id), None)

    monkeypatch.setattr(tenant_deps, "get_platform_db", lambda: SimpleNamespace(companies=Companies()))
    monkeypatch.setattr(tenant_deps, "load_company", load)

    async def no_throttle(request):
        return None

    monkeypatch.setattr(branding_routes, "_lookup_throttle", no_throttle)
    monkeypatch.setattr(settings, "TERMS_URL", "")
    monkeypatch.setattr(settings, "PRIVACY_URL", "")
    tenancy.use_fallback_company(None)
    yield SimpleNamespace(companies=companies, lookups=lookups)
    tenancy.use_fallback_company(DEFAULT_COMPANY_ID)


DEFAULTS = {
    "company_logo_url": "", "primary_color": "#4778f3", "accent_color": "#222022", "company_name": "", "company_slug": "",
    "terms_url": "", "privacy_url": "",
}


async def test_the_sign_in_page_of_a_custom_domain_shows_that_companys_branding(http, host_lookup, db, monkeypatch):
    monkeypatch.setattr(settings, "TERMS_URL", "https://platform.example/terms")
    monkeypatch.setattr(settings, "PRIVACY_URL", "")
    await db.branding_settings.insert_one({
        "_id": "singleton", "primary_color": "#112233", "accent_color": "#445566", "company_logo_url": "https://cdn.acme.test/l.png",
    })
    await db.company_settings.insert_one({"_id": "singleton", "privacy_url": "https://acme.test/privacy"})
    url = f"{API}/branding/public"
    by_host = (await http.get(url, headers={"Host": "careers.acme.com"})).json()
    assert by_host["company_name"] == "Acme Hiring" and by_host["primary_color"] == "#112233"
    assert by_host["company_logo_url"] == "https://cdn.acme.test/l.png"
    assert by_host["privacy_url"] == "https://acme.test/privacy"
    assert by_host["terms_url"] == "https://platform.example/terms"
    forwarded = (await http.get(url, headers={"Host": "api.hrbot.example", "X-Forwarded-Host": "Careers.Acme.com:443, edge.example"})).json()
    assert forwarded["company_name"] == "Acme Hiring"


async def test_a_host_that_is_nobodys_gets_the_defaults_and_the_free_hosts_cost_no_lookup(http, host_lookup, monkeypatch):
    url = f"{API}/branding/public"
    for host in ("unknown.example.com", "careers.acme.com.evil.example"):
        assert (await http.get(url, headers={"Host": host})).json() == DEFAULTS
    assert host_lookup.lookups == ["unknown.example.com", "careers.acme.com.evil.example"]
    host_lookup.lookups.clear()
    for host in ("test", "localhost:8000", "127.0.0.1", "app.hrbot.example"):
        monkeypatch.setattr(settings, "FRONTEND_URL", "https://app.hrbot.example")
        assert (await http.get(url, headers={"Host": host})).json() == DEFAULTS
    assert host_lookup.lookups == []


async def test_a_suspended_company_or_a_plan_without_the_feature_is_not_found_by_its_host(http, host_lookup):
    url = f"{API}/branding/public"
    company = host_lookup.companies["careers.acme.com"]
    company["client_status"] = "suspended"
    assert (await http.get(url, headers={"Host": "careers.acme.com"})).json() == DEFAULTS
    company["client_status"] = "active"
    company["client_plan"] = {"features": {"custom_domain": False}}
    assert (await http.get(url, headers={"Host": "careers.acme.com"})).json() == DEFAULTS
    company["client_plan"] = {}
    company["status"] = "suspended"
    assert (await http.get(url, headers={"Host": "careers.acme.com"})).json() == DEFAULTS


async def test_the_bearer_slug_and_link_rules_still_come_before_the_host(http, host_lookup, db, monkeypatch):
    async def never_slug(slug):
        return False

    monkeypatch.setattr(branding_routes, "bind_company_for_slug", never_slug)
    url = f"{API}/branding/public"
    by_host = (await http.get(url, params={"company": "nope"}, headers={"Host": "careers.acme.com"})).json()
    assert by_host["company_name"] == "Acme Hiring"
    signed_in = (await http.get(url, headers={**SUPER, "Host": "careers.acme.com"})).json()
    assert signed_in["company_name"] != "Acme Hiring"
    assert host_lookup.lookups.count("careers.acme.com") == 1


async def test_legal_links_are_saved_on_the_profile_and_validated(http, db):
    url = f"{API}/company-settings"
    saved = await http.patch(url, headers=ADMIN, json={"terms_url": " https://acme.test/terms ", "privacy_url": "https://acme.test/privacy"})
    assert saved.status_code == 200, saved.text
    assert saved.json()["terms_url"] == "https://acme.test/terms" and saved.json()["privacy_url"] == "https://acme.test/privacy"
    for bad in ("http://acme.test/terms", "javascript:alert(1)", "https://acme.test/" + "a" * 300, "https://u:p@acme.test/x"):
        response = await http.patch(url, headers=ADMIN, json={"terms_url": bad})
        assert response.status_code == 400 and isinstance(response.json()["detail"], str), bad
    assert (await http.get(url, headers=ADMIN)).json()["terms_url"] == "https://acme.test/terms"
    cleared = await http.patch(url, headers=ADMIN, json={"terms_url": ""})
    assert cleared.json()["terms_url"] == ""


async def test_a_hostile_stored_link_is_never_published(db, monkeypatch):
    monkeypatch.setattr(settings, "TERMS_URL", "https://platform.example/terms")
    monkeypatch.setattr(settings, "PRIVACY_URL", "")
    await db.company_settings.insert_one({"_id": "singleton", "terms_url": "javascript:alert(1)", "privacy_url": "https://acme.test/p"})
    links = await branding_service._legal_links()
    assert links == {"terms_url": "https://platform.example/terms", "privacy_url": "https://acme.test/p"}
