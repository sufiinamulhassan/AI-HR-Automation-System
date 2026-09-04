import pytest

import main as _main_module
from routes import branding as _branding_routes
from routes import notification_settings as _notification_settings_routes
from config.database import get_db

if not any(getattr(route, "path", "").startswith("/api/v1/branding") for route in _main_module.app.routes):
    _main_module.app.include_router(
        _branding_routes.router, prefix="/api/v1/branding", tags=["hr_module · Branding"]
    )
if not any(getattr(route, "path", "").startswith("/api/v1/notification-settings") for route in _main_module.app.routes):
    _main_module.app.include_router(
        _notification_settings_routes.router,
        prefix="/api/v1/notification-settings",
        tags=["hr_module · Notification Settings"],
    )

pytestmark = pytest.mark.anyio


@pytest.fixture(autouse=True)
async def _clean_branding_collections():
    """branding_settings/notification_settings are brand-new collections
    owned entirely by this feature — safe to clear before/after each test
    (no shared fixture data lives here, unlike users/jobs/resumes/candidates)."""
    db = get_db()
    if db is not None:
        await db.branding_settings.delete_many({})
        await db.notification_settings.delete_many({})
    yield
    if db is not None:
        await db.branding_settings.delete_many({})
        await db.notification_settings.delete_many({})


async def test_public_branding_requires_no_auth(client):
    response = await client.get("/api/v1/branding/public")
    assert response.status_code == 200
    body = response.json()
    assert body["primary_color"] == "#fca311"
    assert body["accent_color"] == "#14213d"
    assert body["company_logo_url"] == ""


async def test_public_branding_upserts_defaults_once(client):
    first = await client.get("/api/v1/branding/public")
    second = await client.get("/api/v1/branding/public")
    assert first.status_code == second.status_code == 200

    db = get_db()
    count = await db.branding_settings.count_documents({})
    assert count == 1, "GET /public must never create more than one branding_settings document"


async def test_get_branding_requires_admin(client, standard_headers):
    response = await client.get("/api/v1/branding", headers=standard_headers)
    assert response.status_code == 403


async def test_patch_branding_requires_admin(client, standard_headers):
    response = await client.patch(
        "/api/v1/branding", json={"primary_color": "#123456"}, headers=standard_headers,
    )
    assert response.status_code == 403


async def test_patch_branding_updates_colors_and_logo(client, admin_headers):
    response = await client.patch(
        "/api/v1/branding",
        json={"primary_color": "#112233", "accent_color": "#445566", "company_logo_url": "https://x.test/logo.png"},
        headers=admin_headers,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["primary_color"] == "#112233"
    assert body["accent_color"] == "#445566"
    assert body["company_logo_url"] == "https://x.test/logo.png"

    public_resp = await client.get("/api/v1/branding/public")
    assert public_resp.json()["primary_color"] == "#112233"

    db = get_db()
    count = await db.branding_settings.count_documents({})
    assert count == 1, "PATCH must update the existing singleton, never insert a second document"


async def test_patch_branding_rejects_invalid_hex_color(client, admin_headers):
    response = await client.patch(
        "/api/v1/branding", json={"primary_color": "not-a-color"}, headers=admin_headers,
    )
    assert response.status_code == 400

    public_resp = await client.get("/api/v1/branding/public")
    assert public_resp.json()["primary_color"] == "#fca311"


async def test_patch_branding_ignores_unknown_fields(client, admin_headers):
    response = await client.patch(
        "/api/v1/branding",
        json={"primary_color": "#abcdef", "not_a_real_field": "dropped"},
        headers=admin_headers,
    )
    assert response.status_code == 200
    assert "not_a_real_field" not in response.json()


async def test_get_notification_settings_requires_admin(client, standard_headers):
    response = await client.get("/api/v1/notification-settings", headers=standard_headers)
    assert response.status_code == 403


async def test_get_notification_settings_upserts_defaults(client, admin_headers):
    response = await client.get("/api/v1/notification-settings", headers=admin_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["notify_email"] == ""
    event_names = {e["event"] for e in body["events"]}
    assert {
        "offer_declined",
        "candidate_flagged_for_integrity",
        "job_import_failed",
        "coding_submission_execution_failed",
        "webhook_delivery_failed",
    } <= event_names
    assert all(e["enabled"] is False for e in body["events"])

    db = get_db()
    doc = await db.notification_settings.find_one({"_id": "singleton"})
    assert doc is not None


async def test_patch_notification_settings_requires_admin(client, standard_headers):
    response = await client.patch(
        "/api/v1/notification-settings", json={"notify_email": "a@b.com"}, headers=standard_headers,
    )
    assert response.status_code == 403


async def test_patch_notification_settings_partial_update(client, admin_headers):
    await client.get("/api/v1/notification-settings", headers=admin_headers)

    response = await client.patch(
        "/api/v1/notification-settings",
        json={"notify_email": "alerts@example.com", "events": {"offer_declined": True}},
        headers=admin_headers,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["notify_email"] == "alerts@example.com"
    events_by_name = {e["event"]: e["enabled"] for e in body["events"]}
    assert events_by_name["offer_declined"] is True
    assert events_by_name["job_import_failed"] is False

    response2 = await client.patch(
        "/api/v1/notification-settings",
        json={"events": {"job_import_failed": True}},
        headers=admin_headers,
    )
    assert response2.status_code == 200
    events_by_name2 = {e["event"]: e["enabled"] for e in response2.json()["events"]}
    assert events_by_name2["offer_declined"] is True
    assert events_by_name2["job_import_failed"] is True
    assert response2.json()["notify_email"] == "alerts@example.com"

    db = get_db()
    count = await db.notification_settings.count_documents({})
    assert count == 1


async def test_patch_notification_settings_rejects_invalid_email(client, admin_headers):
    response = await client.patch(
        "/api/v1/notification-settings", json={"notify_email": "not-an-email"}, headers=admin_headers,
    )
    assert response.status_code == 400


async def test_patch_notification_settings_ignores_unknown_event_keys(client, admin_headers):
    response = await client.patch(
        "/api/v1/notification-settings",
        json={"events": {"totally_made_up_event": True, "offer_declined": True}},
        headers=admin_headers,
    )
    assert response.status_code == 200
    event_names = {e["event"] for e in response.json()["events"]}
    assert "totally_made_up_event" not in event_names
