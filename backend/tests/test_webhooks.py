import pytest

import main as _main_module
from routes import webhooks as _webhooks_routes
from config.database import get_db
from services.hr_module.webhook_service import fire_webhook_event

if not any(getattr(route, "path", "").startswith("/api/v1/webhooks") for route in _main_module.app.routes):
    _main_module.app.include_router(
        _webhooks_routes.router, prefix="/api/v1/webhooks", tags=["hr_module · Webhooks"]
    )

pytestmark = pytest.mark.anyio

WEBHOOK_PAYLOAD = {
    "url": "https://example.com:81/hook",
    "event_types": ["candidate.invited"],
    "secret": "s3cr3t",
}


async def test_create_webhook_requires_admin(client, standard_headers):
    response = await client.post("/api/v1/webhooks", json=WEBHOOK_PAYLOAD, headers=standard_headers)
    assert response.status_code == 403


async def test_list_webhooks_requires_admin(client, standard_headers):
    response = await client.get("/api/v1/webhooks", headers=standard_headers)
    assert response.status_code == 403


async def test_create_list_get_update_delete_roundtrip(client, admin_headers):
    create_resp = await client.post("/api/v1/webhooks", json=WEBHOOK_PAYLOAD, headers=admin_headers)
    assert create_resp.status_code == 200
    webhook = create_resp.json()
    webhook_id = webhook["webhook_id"]
    assert webhook["is_active"] is True

    list_resp = await client.get("/api/v1/webhooks", headers=admin_headers)
    assert list_resp.status_code == 200
    assert any(w["webhook_id"] == webhook_id for w in list_resp.json()["webhooks"])

    get_resp = await client.get(f"/api/v1/webhooks/{webhook_id}", headers=admin_headers)
    assert get_resp.status_code == 200
    assert get_resp.json()["url"] == WEBHOOK_PAYLOAD["url"]

    patch_resp = await client.patch(
        f"/api/v1/webhooks/{webhook_id}", json={"is_active": False}, headers=admin_headers
    )
    assert patch_resp.status_code == 200
    assert patch_resp.json()["is_active"] is False

    delete_resp = await client.delete(f"/api/v1/webhooks/{webhook_id}", headers=admin_headers)
    assert delete_resp.status_code == 200

    get_after_delete = await client.get(f"/api/v1/webhooks/{webhook_id}", headers=admin_headers)
    assert get_after_delete.status_code == 404


async def test_get_unknown_webhook_404(client, admin_headers):
    response = await client.get("/api/v1/webhooks/does-not-exist", headers=admin_headers)
    assert response.status_code == 404


async def test_test_endpoint_requires_admin(client, standard_headers, admin_headers):
    create_resp = await client.post("/api/v1/webhooks", json=WEBHOOK_PAYLOAD, headers=admin_headers)
    webhook_id = create_resp.json()["webhook_id"]

    response = await client.post(f"/api/v1/webhooks/{webhook_id}/test", headers=standard_headers)
    assert response.status_code == 403

    await client.delete(f"/api/v1/webhooks/{webhook_id}", headers=admin_headers)


async def test_test_endpoint_against_unreachable_url_reports_failure_not_500(client, admin_headers):
    create_resp = await client.post("/api/v1/webhooks", json=WEBHOOK_PAYLOAD, headers=admin_headers)
    webhook_id = create_resp.json()["webhook_id"]

    response = await client.post(f"/api/v1/webhooks/{webhook_id}/test", headers=admin_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is False

    await client.delete(f"/api/v1/webhooks/{webhook_id}", headers=admin_headers)


async def test_fire_webhook_event_against_unreachable_url_does_not_raise():
    db = get_db()
    assert db is not None

    await db.webhook_subscriptions.insert_one({
        "webhook_id": "wh_unreachable_test",
        "url": "https://unreachable.invalid.example.test/hook",
        "event_types": ["candidate.invited"],
        "secret": None,
        "is_active": True,
        "created_by": "hradmin@hirely.ai",
        "created_at": "2026-01-01T00:00:00+00:00",
    })

    await fire_webhook_event("candidate.invited", {"candidate_id": "abc"})

    await db.webhook_subscriptions.delete_one({"webhook_id": "wh_unreachable_test"})


async def test_fire_webhook_event_no_matching_subscriptions_is_noop():
    await fire_webhook_event("event.with.no.subscribers", {"anything": True})
