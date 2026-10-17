import uuid

import pytest
from httpx import ASGITransport, AsyncClient

from jose import jwt

from config.database import get_db, get_platform_db
from config.settings import settings
from config.tenancy import DEFAULT_COMPANY_ID
from config.tenancy_migration import client_doc, company_doc
from main import app
from routes import sso

pytestmark = pytest.mark.anyio


class _Resp:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self._payload


def _fake_google(monkeypatch, *, email: str, verified: bool = True, name: str = "Google Person"):
    class Client:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def post(self, url, data=None):
            return _Resp({"access_token": "fake-access-token"})

        async def get(self, url, headers=None):
            return _Resp({"email": email, "email_verified": verified, "name": name})

    monkeypatch.setattr(sso.httpx, "AsyncClient", Client)


@pytest.fixture
def no_fallback():
    from config import tenancy

    previous = tenancy._fallback_company_id
    tenancy.use_fallback_company(None)
    yield
    tenancy.use_fallback_company(previous)


@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setattr(settings, "GOOGLE_OAUTH_CLIENT_ID", "test-client-id")
    monkeypatch.setattr(settings, "GOOGLE_OAUTH_CLIENT_SECRET", "test-client-secret")
    monkeypatch.setattr(settings, "GOOGLE_OAUTH_REDIRECT_URI", "http://localhost/callback")


async def _callback(monkeypatch, email: str, **kwargs):
    state = f"state-{uuid.uuid4().hex}"
    await get_platform_db().sso_states.insert_one({"state": state, "created_at": "2026-01-01T00:00:00+00:00"})
    raw = AsyncClient(transport=ASGITransport(app=app), base_url="http://test", follow_redirects=False)
    _fake_google(monkeypatch, email=email, **kwargs)
    try:
        return await raw.get("/api/v1/sso/google/callback", params={"code": "c", "state": state})
    finally:
        await raw.aclose()


@pytest.fixture
async def cleanup():
    emails: list[str] = []
    yield emails
    await get_db().users.delete_many({"email": {"$in": emails}})


async def test_the_domain_setting_is_parsed_loosely(monkeypatch):
    monkeypatch.setattr(settings, "SSO_ALLOWED_EMAIL_DOMAINS", "")
    assert sso.allowed_email_domains() == set() and sso.domain_allowed("anyone@anywhere.org")
    monkeypatch.setattr(settings, "SSO_ALLOWED_EMAIL_DOMAINS", " Acme.com , @acme.co.uk,, ")
    assert sso.allowed_email_domains() == {"acme.com", "acme.co.uk"}
    assert sso.domain_allowed("Jane@ACME.com") and sso.domain_allowed("j@acme.co.uk")
    assert not sso.domain_allowed("j@evil-acme.com") and not sso.domain_allowed("j@acme.com.evil.org")
    assert not sso.domain_allowed("j@sub.acme.com")


async def test_an_unclaimed_domain_is_refused_even_with_an_empty_list(client, configured, monkeypatch, cleanup):
    monkeypatch.setattr(settings, "SSO_ALLOWED_EMAIL_DOMAINS", "")
    email = f"anyone.{uuid.uuid4().hex[:8]}@anywhere.org"
    cleanup.append(email)
    resp = await _callback(monkeypatch, email)
    assert resp.status_code == 403
    assert await get_platform_db().users.find_one({"email": email}) is None


async def test_a_company_that_claims_a_domain_gets_its_new_users(client, configured, monkeypatch, cleanup, no_fallback):
    monkeypatch.setattr(settings, "SSO_ALLOWED_EMAIL_DOMAINS", "")
    tag = uuid.uuid4().hex[:8]
    domain = f"claimed-{tag}.example"
    client_id, company_id = f"cli_s{tag}", f"cmp_s{tag}"
    raw = get_platform_db()
    await raw.clients.insert_one(client_doc(client_id, f"SSO {tag}", f"sso-{tag}"))
    await raw.companies.insert_one({**company_doc(company_id, client_id, f"SSO {tag}", f"sso-{tag}"), "sso_domains": [domain]})
    email = f"new.{tag}@{domain}"
    try:
        resp = await _callback(monkeypatch, email)
        assert resp.status_code in (302, 307), resp.text
        assert "/sso-callback?token=" in resp.headers["location"]
        user = await raw.users.find_one({"email": email})
        assert user["company_id"] == company_id
        assert user["role"] == "standard" and user["sso_provider"] == "google" and user["is_active"] is True
        token = resp.headers["location"].split("token=")[1]
        assert jwt.get_unverified_claims(token)["cid"] == company_id

        await raw.companies.update_one({"company_id": company_id}, {"$set": {"status": "suspended"}})
        other = f"second.{tag}@{domain}"
        assert (await _callback(monkeypatch, other)).status_code == 403
        assert await raw.users.find_one({"email": other}) is None
    finally:
        await raw.users.delete_many({"company_id": company_id})
        await raw.companies.delete_many({"company_id": company_id})
        await raw.clients.delete_many({"client_id": client_id})


async def test_an_allowed_domain_is_provisioned(client, configured, monkeypatch, cleanup):
    monkeypatch.setattr(settings, "SSO_ALLOWED_EMAIL_DOMAINS", "acme.com,acme.co.uk")
    email = f"new.{uuid.uuid4().hex[:8]}@acme.com"
    cleanup.append(email)
    resp = await _callback(monkeypatch, email)
    assert resp.status_code in (302, 307) and "/sso-callback?token=" in resp.headers["location"]
    user = await get_db().users.find_one({"email": email})
    assert user is not None and user["company_id"] == DEFAULT_COMPANY_ID


async def test_another_domain_is_refused_with_a_clear_message_and_nothing_is_created(client, configured, monkeypatch, cleanup):
    monkeypatch.setattr(settings, "SSO_ALLOWED_EMAIL_DOMAINS", "acme.com")
    email = f"outsider.{uuid.uuid4().hex[:8]}@gmail.com"
    cleanup.append(email)
    resp = await _callback(monkeypatch, email)
    assert resp.status_code == 403
    detail = resp.json()["detail"]
    assert isinstance(detail, str) and "domain" in detail.lower() and "administrator" in detail.lower()
    assert await get_db().users.find_one({"email": email}) is None
    lookalike = f"x.{uuid.uuid4().hex[:6]}@acme.com.evil.org"
    cleanup.append(lookalike)
    assert (await _callback(monkeypatch, lookalike)).status_code == 403
    assert await get_db().users.find_one({"email": lookalike}) is None


async def test_an_account_an_admin_already_created_can_sign_in_from_any_domain(client, configured, monkeypatch, cleanup):
    monkeypatch.setattr(settings, "SSO_ALLOWED_EMAIL_DOMAINS", "acme.com")
    email = f"contractor.{uuid.uuid4().hex[:8]}@partner.org"
    cleanup.append(email)
    await get_db().users.insert_one({"name": "C", "email": email, "role": "standard", "is_active": True})
    resp = await _callback(monkeypatch, email)
    assert resp.status_code in (302, 307) and "/sso-callback?token=" in resp.headers["location"]


async def test_a_deactivated_account_is_still_refused(client, configured, monkeypatch, cleanup):
    monkeypatch.setattr(settings, "SSO_ALLOWED_EMAIL_DOMAINS", "")
    email = f"gone.{uuid.uuid4().hex[:8]}@acme.com"
    cleanup.append(email)
    await get_db().users.insert_one({"name": "G", "email": email, "role": "standard", "is_active": False})
    assert (await _callback(monkeypatch, email)).status_code == 403


async def test_an_unverified_google_email_is_still_refused_first(client, configured, monkeypatch, cleanup):
    monkeypatch.setattr(settings, "SSO_ALLOWED_EMAIL_DOMAINS", "acme.com")
    email = f"unverified.{uuid.uuid4().hex[:8]}@acme.com"
    cleanup.append(email)
    resp = await _callback(monkeypatch, email, verified=False)
    assert resp.status_code == 403 and "not verified" in resp.json()["detail"]
    assert await get_db().users.find_one({"email": email}) is None


async def test_the_setting_is_documented_in_env_example():
    from pathlib import Path

    text = (Path(__file__).resolve().parent.parent / ".env.example").read_text(encoding="utf-8")
    assert "SSO_ALLOWED_EMAIL_DOMAINS" in text


async def test_sso_login_redirects_to_google_with_no_company_bound(configured, no_fallback):
    raw = AsyncClient(transport=ASGITransport(app=app), base_url="http://test", follow_redirects=False)
    try:
        resp = await raw.get("/api/v1/sso/google/login")
    finally:
        await raw.aclose()
    assert resp.status_code in (302, 307), resp.text
    assert resp.headers["location"].startswith("https://accounts.google.com/")
    state = resp.headers["location"].split("state=")[1].split("&")[0]
    assert await get_platform_db().sso_states.find_one({"state": state}) is not None
    await get_platform_db().sso_states.delete_many({"state": state})
