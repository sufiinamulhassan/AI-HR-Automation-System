from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient

import config.database as database
from config import tenancy
from config.settings import settings
from fake_mongo import FakeRaw
from main import app
from shared import auth

pytestmark = pytest.mark.anyio

SHOWCASE = "cmp_showcase"
CLIENT = {"Authorization": "Bearer demo-superadmin-token"}
PLATFORM = {"Authorization": "Bearer demo-platform-token"}
STALE = {"Authorization": "Bearer demo-superadmin-token"}

COMPANY = {
    "company_id": SHOWCASE,
    "name": "Showcase Co",
    "client_id": "cli_showcase",
    "client_name": "Showcase",
    "kind": "workspace",
    "status": "active",
    "settings": {},
}

SIMULATED = "Demo mode: this action was simulated and nothing was changed."


@pytest.fixture
async def world(monkeypatch):
    raw = FakeRaw()
    monkeypatch.setattr(database, "_db", raw)
    monkeypatch.setattr(tenancy, "_fallback_company_id", None)
    monkeypatch.setattr(settings, "ALLOW_DEMO_AUTH", True)
    monkeypatch.setattr(settings, "HACKATHON_DEMO_MODE", False)
    monkeypatch.setattr(settings, "DEMO_COMPANY_ID", "")

    async def load(company_id):
        return dict(COMPANY) if company_id == SHOWCASE else None

    monkeypatch.setattr(auth, "load_company", load)

    async with AsyncClient(transport=ASGITransport(app=app, raise_app_exceptions=False), base_url="http://t") as client:
        yield SimpleNamespace(raw=raw, client=client)


@pytest.fixture
def pinned(monkeypatch):
    monkeypatch.setattr(settings, "DEMO_COMPANY_ID", SHOWCASE)


def test_without_a_demo_company_nothing_changes(monkeypatch):
    monkeypatch.setattr(settings, "DEBUG", True)
    monkeypatch.setattr(settings, "DEMO_COMPANY_ID", "")
    user = auth._demo_user("demo-admin-token@@cmp_other")
    assert user["company_id"] == "cmp_other"
    assert "demo_read_only" not in user


def test_with_a_demo_company_the_client_demo_is_pinned_to_it(monkeypatch, pinned):
    monkeypatch.setattr(settings, "DEBUG", True)
    for token in ("demo-superadmin-token", "demo-admin-token@@cmp_victim", "demo-standard-token@@cmp_victim"):
        user = auth._demo_user(token)
        assert user["company_id"] == SHOWCASE
        assert user["demo_read_only"] is True


def test_the_platform_demo_is_not_moved_into_the_company_but_is_still_read_only(monkeypatch, pinned):
    monkeypatch.setattr(settings, "DEBUG", True)
    user = auth._demo_user("demo-platform-token")
    assert user["is_platform_admin"] is True
    assert user["company_id"] != SHOWCASE
    assert user["demo_read_only"] is True


async def test_the_client_demo_shows_the_real_company(world, pinned):
    user = await auth.get_current_user("demo-superadmin-token")
    assert user["company_id"] == SHOWCASE
    assert user["company_name"] == "Showcase Co"
    assert user["client_name"] == "Showcase"
    assert tenancy.current_company_id() == SHOWCASE
    assert tenancy.current_company()["name"] == "Showcase Co"


async def test_the_old_demo_company_is_still_used_when_none_is_configured(world):
    user = await auth.get_current_user("demo-superadmin-token")
    assert user["company_id"] == tenancy.DEFAULT_COMPANY_ID
    assert "company_name" not in user
    assert tenancy.current_company()["name"] == "Demo Company"


async def test_a_missing_demo_company_is_reported_instead_of_showing_another_one(world, monkeypatch):
    monkeypatch.setattr(settings, "DEMO_COMPANY_ID", "cmp_gone")
    with pytest.raises(HTTPException) as caught:
        await auth.get_current_user("demo-superadmin-token")
    assert caught.value.status_code == 503
    assert "demo company" in caught.value.detail


async def test_the_company_can_be_read_in_the_demo(world, pinned):
    r = await world.client.get("/api/v1/auth/me", headers=CLIENT)
    assert r.status_code == 200
    body = r.json()
    assert body["company_name"] == "Showcase Co"
    assert body["demo_read_only"] is True


@pytest.mark.parametrize("method, path", [
    ("POST", "/api/v1/jobs"),
    ("PATCH", "/api/v1/jobs/job_1"),
    ("PUT", "/api/v1/company-settings/mail"),
    ("DELETE", "/api/v1/resumes/res_1"),
    ("POST", "/api/v1/resumes/upload"),
    ("PATCH", "/api/v1/auth/me"),
    ("POST", "/api/v1/auth/users"),
    ("POST", "/api/v1/offers"),
    ("PATCH", "/api/v1/company-settings"),
    ("POST", "/api/v1/candidates/c1/send-email"),
    ("POST", "/api/v1/auth/me/avatar"),
])
async def test_every_change_is_simulated_and_nothing_is_written(world, pinned, method, path):
    before = world.raw.writes
    r = await world.client.request(method, path, headers=CLIENT, json={"title": "x"})
    assert r.status_code == 200
    body = r.json()
    assert body["demo"] is True
    assert body["message"] == SIMULATED
    assert body["success"] is True
    assert world.raw.writes == before


async def test_the_platform_demo_cannot_change_anything_either(world, pinned):
    for method, path in (("PATCH", "/api/v1/platform/clients/cli_x"), ("POST", "/api/v1/platform/clients"), ("DELETE", "/api/v1/platform/contact-requests/r1")):
        r = await world.client.request(method, path, headers=PLATFORM, json={"name": "x"})
        assert r.json()["demo"] is True, path


@pytest.mark.parametrize("path", [
    "/api/v1/auth/token",
    "/api/v1/auth/login",
    "/api/v1/auth/verify-otp",
    "/api/v1/auth/forgot-password",
    "/api/v1/auth/reset-password",
])
async def test_signing_in_still_works_with_a_leftover_demo_token(world, pinned, path):
    r = await world.client.post(path, headers=STALE, json={"email": "a@b.co", "password": "x", "otp": "000000", "token": "t", "new_password": "x"})
    assert SIMULATED not in r.text
    assert '"demo"' not in r.text


async def test_without_a_demo_company_ordinary_demo_changes_are_not_blocked(world):
    r = await world.client.patch("/api/v1/auth/me", headers=CLIENT, json={})
    assert '"demo"' not in r.text


async def test_without_a_demo_company_the_old_delete_rule_still_applies_in_demo_mode(world, monkeypatch):
    monkeypatch.setattr(settings, "HACKATHON_DEMO_MODE", True)
    deleted = await world.client.delete("/api/v1/resumes/res_1", headers=CLIENT)
    assert deleted.json()["demo"] is True
    patched = await world.client.patch("/api/v1/auth/me", headers=CLIENT, json={})
    assert '"demo"' not in patched.text


async def test_demo_tokens_are_ignored_when_demo_sign_in_is_off(world, pinned, monkeypatch):
    monkeypatch.setattr(settings, "ALLOW_DEMO_AUTH", False)
    r = await world.client.patch("/api/v1/auth/me", headers=CLIENT, json={"name": "x"})
    assert r.status_code == 401
    assert '"demo"' not in r.text


async def test_a_real_token_is_never_treated_as_a_demo(world, pinned):
    r = await world.client.patch("/api/v1/auth/me", headers={"Authorization": "Bearer not-a-demo"}, json={"name": "x"})
    assert r.status_code == 401
