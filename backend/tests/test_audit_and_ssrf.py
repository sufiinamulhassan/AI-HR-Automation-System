import asyncio
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from config.tenancy import DEFAULT_COMPANY_ID
from jose import jwt
from passlib.context import CryptContext

from config.database import get_db, get_platform_db
from config.settings import settings
from services.hr_module import url_safety, webhook_service
from shared.safe_http import SafeResponse, UnsafeTarget

pytestmark = pytest.mark.anyio

pwd_ctx = CryptContext(schemes=["bcrypt"])


@pytest.fixture(autouse=True)
async def _clean_branding():
    db = get_db()
    await db.branding_settings.delete_many({})
    yield
    await db.branding_settings.delete_many({})


@pytest.mark.parametrize("url", [
    "http://example.com/logo.png",
    "ftp://example.com/logo.png",
    "javascript:alert(1)",
    "https://localhost/logo.png",
    "https://127.0.0.1/logo.png",
    "https://[::1]/logo.png",
    "https://10.0.0.5/logo.png",
    "https://192.168.1.1/logo.png",
    "https://172.16.0.9/logo.png",
    "https://169.254.169.254/latest/meta-data/",
    "https://0.0.0.0/logo.png",
    "https://user:secret@example.com/logo.png",
    "https://example.com:8443/logo.png",
    "https:///logo.png",
    "not a url",
    "https://exa mple.com/logo.png",
])
async def test_an_unsafe_logo_address_is_refused_and_not_saved(client, admin_headers, url):
    resp = await client.patch("/api/v1/branding", headers=admin_headers, json={"company_logo_url": url})
    assert resp.status_code == 400, f"{url}: {resp.status_code}"
    assert isinstance(resp.json()["detail"], str) and resp.json()["detail"]
    saved = (await client.get("/api/v1/branding", headers=admin_headers)).json()
    assert saved["company_logo_url"] == ""


async def test_a_public_https_logo_address_is_saved_and_a_blank_clears_it(client, admin_headers, monkeypatch):
    monkeypatch.setattr(webhook_service, "is_url_ssrf_safe", lambda url: True)
    ok = await client.patch("/api/v1/branding", headers=admin_headers, json={"company_logo_url": "  https://cdn.example.com/logo.png  "})
    assert ok.status_code == 200 and ok.json()["company_logo_url"] == "https://cdn.example.com/logo.png"
    cleared = await client.patch("/api/v1/branding", headers=admin_headers, json={"company_logo_url": ""})
    assert cleared.status_code == 200 and cleared.json()["company_logo_url"] == ""


async def test_a_host_that_resolves_to_a_private_address_is_refused(client, admin_headers, monkeypatch):
    monkeypatch.setattr(webhook_service, "is_url_ssrf_safe", lambda url: False)
    resp = await client.patch("/api/v1/branding", headers=admin_headers, json={"company_logo_url": "https://rebind.example.com/l.png"})
    assert resp.status_code == 400 and "public" in resp.json()["detail"].lower()


async def test_other_branding_fields_save_without_touching_the_logo_check(client, admin_headers):
    resp = await client.patch("/api/v1/branding", headers=admin_headers, json={"primary_color": "#123456"})
    assert resp.status_code == 200 and resp.json()["primary_color"] == "#123456"


def _answer(*, status=200, headers=None, content=b""):
    return SafeResponse(status, {k.lower(): v for k, v in (headers or {}).items()}, content)


def _fake_request(monkeypatch, responses, seen=None, kwargs_seen=None):
    queue = list(responses)

    async def fake(method, url, **kwargs):
        if seen is not None:
            seen.append(url)
        if kwargs_seen is not None:
            kwargs_seen.update(kwargs)
        step = queue.pop(0)
        if isinstance(step, Exception):
            raise step
        return step

    monkeypatch.setattr(url_safety, "safe_request", fake)


PRIVATE = UnsafeTarget("The address points to a private or reserved network.")


async def test_the_fetch_is_bounded_in_time_size_and_port(monkeypatch):
    kwargs: dict = {}
    _fake_request(monkeypatch, [_answer(headers={"content-type": "image/png"}, content=b"abc")], kwargs_seen=kwargs)
    data = await url_safety.fetch_public_image("https://cdn.example.com/l.png")
    assert data == b"abc"
    assert kwargs["timeout"] == url_safety.FETCH_TIMEOUT_SECONDS <= 10
    assert kwargs["max_bytes"] == url_safety.MAX_IMAGE_BYTES
    assert kwargs["allowed_ports"] == (443,)


async def test_an_oversized_image_is_refused_whether_the_client_or_the_check_notices(monkeypatch):
    cap = url_safety.MAX_IMAGE_BYTES
    _fake_request(monkeypatch, [UnsafeTarget("The response was larger than allowed.")])
    with pytest.raises(ValueError, match="too large"):
        await url_safety.fetch_public_image("https://cdn.example.com/l.png")
    _fake_request(monkeypatch, [_answer(headers={"content-type": "image/png"}, content=b"x" * (cap + 1))])
    with pytest.raises(ValueError, match="too large"):
        await url_safety.fetch_public_image("https://cdn.example.com/l.png")


async def test_only_an_image_is_accepted(monkeypatch):
    _fake_request(monkeypatch, [_answer(headers={"content-type": "text/html"}, content=b"<html>")])
    with pytest.raises(ValueError, match="image"):
        await url_safety.fetch_public_image("https://cdn.example.com/l.png")
    _fake_request(monkeypatch, [_answer(status=500, headers={"content-type": "image/png"})])
    with pytest.raises(Exception):
        await url_safety.fetch_public_image("https://cdn.example.com/l.png")


async def test_an_address_that_is_not_public_when_fetched_is_refused_even_though_it_was_saved(monkeypatch):
    _fake_request(monkeypatch, [PRIVATE])
    with pytest.raises(url_safety.UnsafeUrlError):
        await url_safety.fetch_public_image("https://cdn.example.com/l.png")


async def test_a_redirect_to_a_private_address_is_refused(monkeypatch):
    seen: list[str] = []
    _fake_request(
        monkeypatch,
        [_answer(status=302, headers={"location": "https://169.254.169.254/latest/meta-data/"}), PRIVATE],
        seen=seen,
    )
    with pytest.raises(url_safety.UnsafeUrlError):
        await url_safety.fetch_public_image("https://cdn.example.com/l.png")
    assert seen == ["https://cdn.example.com/l.png", "https://169.254.169.254/latest/meta-data/"]


async def test_a_redirect_to_another_public_https_address_is_followed_a_few_times(monkeypatch):
    seen: list[str] = []
    _fake_request(monkeypatch, [
        _answer(status=301, headers={"location": "/moved.png"}),
        _answer(headers={"content-type": "image/png"}, content=b"png"),
    ], seen=seen)
    assert await url_safety.fetch_public_image("https://cdn.example.com/l.png") == b"png"
    assert seen == ["https://cdn.example.com/l.png", "https://cdn.example.com/moved.png"]
    loop = [_answer(status=301, headers={"location": "/again.png"}) for _ in range(10)]
    _fake_request(monkeypatch, loop)
    with pytest.raises(ValueError, match="redirects"):
        await url_safety.fetch_public_image("https://cdn.example.com/l.png")
    _fake_request(monkeypatch, [_answer(status=301, headers={"location": "http://cdn.example.com/x.png"})])
    with pytest.raises(url_safety.UnsafeUrlError):
        await url_safety.fetch_public_image("https://cdn.example.com/l.png")


async def test_the_offer_pdf_renders_without_a_logo_whose_host_became_unsafe(monkeypatch):
    from services.hr_module import offer_service

    _fake_request(monkeypatch, [PRIVATE])
    pdf = await offer_service.render_offer_pdf(
        {"offer_id": "o", "salary": "1"}, {"title": "T", "company_name": "C"}, {"name": "N"},
        {"company_logo_url": "https://cdn.example.com/l.png"},
    )
    assert pdf[:4] == b"%PDF"


def _slow_audit(done: list):
    async def fake(db, **kwargs):
        await asyncio.sleep(0.25)
        done.append(kwargs["action"])
    return fake


async def test_the_detached_style_is_detectable_by_this_technique(client, admin_headers, monkeypatch):
    import routes.scenarios as scenarios_route

    done: list = []
    monkeypatch.setattr(scenarios_route, "log_audit_event", _slow_audit(done))
    resp = await client.post(
        "/api/v1/scenarios", headers=admin_headers, json={"name": f"ctl {uuid.uuid4().hex[:6]}", "prompt": "p"},
    )
    assert resp.status_code == 200
    assert done == [], "this route is expected to be fire-and-forget; if it changed, pick another control"
    await asyncio.sleep(0.4)
    await get_db().scenarios.delete_one({"scenario_id": resp.json()["scenario_id"]})


async def test_company_settings_save_is_audited_before_the_response(client, admin_headers, monkeypatch):
    import routes.company_settings as route

    done: list = []
    monkeypatch.setattr(route, "log_audit_event", _slow_audit(done))
    resp = await client.patch("/api/v1/company-settings", headers=admin_headers, json={"industry": "Software"})
    assert resp.status_code == 200
    assert done == ["company_settings_update"]


async def test_branding_save_is_audited_before_the_response(client, admin_headers, monkeypatch):
    import routes.branding as route

    done: list = []
    monkeypatch.setattr(route, "log_audit_event", _slow_audit(done))
    resp = await client.patch("/api/v1/branding", headers=admin_headers, json={"accent_color": "#0a0b0c"})
    assert resp.status_code == 200
    assert done == ["branding_update"]


async def test_notification_settings_save_is_audited_before_the_response(client, admin_headers, monkeypatch):
    import routes.notification_settings as route

    done: list = []
    monkeypatch.setattr(route, "log_audit_event", _slow_audit(done))
    resp = await client.patch("/api/v1/notification-settings", headers=admin_headers, json={"notify_email": "ops@example.com"})
    assert resp.status_code == 200
    assert done == ["notification_settings_update"]
    await get_db().notification_settings.delete_many({})


async def test_default_model_change_is_audited_before_the_response(client, admin_headers, monkeypatch):
    import routes.auth as route
    from config.llm import selectable_models

    raw = get_platform_db()
    previous = await raw.companies.find_one({"company_id": DEFAULT_COMPANY_ID}, {"_id": 0, "settings": 1})
    original = settings.DEFAULT_LLM_MODEL
    done: list = []
    monkeypatch.setattr(route, "log_audit_event", _slow_audit(done))
    try:
        resp = await client.patch(
            "/api/v1/auth/models/default", headers=admin_headers, json={"default_model": selectable_models()[0]["id"]},
        )
        assert resp.status_code == 200
        assert done == ["default_model_change"]
        saved = await raw.companies.find_one({"company_id": DEFAULT_COMPANY_ID}, {"_id": 0, "settings": 1})
        assert saved["settings"]["default_llm_model"] == selectable_models()[0]["id"]
        assert settings.DEFAULT_LLM_MODEL == original
    finally:
        await raw.companies.update_one(
            {"company_id": DEFAULT_COMPANY_ID}, {"$set": {"settings": (previous or {}).get("settings") or {}}},
        )


async def test_change_password_is_audited_before_the_response(client, monkeypatch):
    import routes.auth as route

    db = get_db()
    email = f"pw.{uuid.uuid4().hex[:8]}@example.com"
    await db.users.insert_one({
        "name": "P", "email": email, "role": "standard", "is_active": True,
        "password_hash": pwd_ctx.hash("Start@12345"),
    })
    token = jwt.encode(
        {"sub": email, "exp": datetime.now(timezone.utc) + timedelta(hours=1)},
        settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM,
    )
    done: list = []
    monkeypatch.setattr(route, "log_audit_event", _slow_audit(done))
    try:
        resp = await client.post(
            "/api/v1/auth/change-password", headers={"Authorization": f"Bearer {token}"},
            json={"current_password": "Start@12345", "new_password": "Changed@12345"},
        )
        assert resp.status_code == 200
        assert done == ["password_change"]
    finally:
        await db.users.delete_one({"email": email})


async def test_role_create_update_and_delete_are_audited_before_the_response(client, superadmin_headers, monkeypatch):
    import routes.rbac as route

    name = f"audited-{uuid.uuid4().hex[:8]}"
    done: list = []
    monkeypatch.setattr(route, "log_audit_event", _slow_audit(done))
    try:
        created = await client.post("/api/v1/rbac/roles", headers=superadmin_headers, json={"role_name": name, "permissions": ["jobs:read"]})
        assert created.status_code == 200 and done == ["role_create"]
        updated = await client.patch(f"/api/v1/rbac/roles/{name}", headers=superadmin_headers, json={"description": "d"})
        assert updated.status_code == 200 and done == ["role_create", "role_update"]
        deleted = await client.delete(f"/api/v1/rbac/roles/{name}", headers=superadmin_headers)
        assert deleted.status_code == 200 and done == ["role_create", "role_update", "role_delete"]
    finally:
        await get_db().roles.delete_one({"role_name": name})


async def test_security_policy_write_is_audited_before_the_response(client, superadmin_headers, monkeypatch):
    import routes.security_policies as route

    db = get_db()
    await db.security_policies.delete_many({})
    done: list = []
    monkeypatch.setattr(route, "log_audit_event", _slow_audit(done))
    try:
        resp = await client.patch("/api/v1/security-policies", headers=superadmin_headers, json={"password_min_length": 8})
        assert resp.status_code == 200
        assert done == ["security_policy_update"]
    finally:
        await db.security_policies.delete_many({})


async def test_the_audit_rows_are_really_written_with_who_and_what(client, admin_headers):
    resp = await client.patch("/api/v1/branding", headers=admin_headers, json={"primary_color": "#abcdef"})
    assert resp.status_code == 200
    entry = await get_db().audit_log.find_one({"action": "branding_update"}, sort=[("created_at", -1)])
    assert entry["actor_email"] == "demo-admin@hirely.ai" and entry["actor_role"] == "admin"
    assert entry["details"]["primary_color"] == "#abcdef"
