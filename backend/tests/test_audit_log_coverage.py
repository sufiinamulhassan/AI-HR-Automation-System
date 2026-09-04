"""Regression tests for MVP2 §2.1 audit-log coverage on the workflow and
webhook route files (task C2).

Each test performs a real mutation through the HTTP layer, then polls
`audit_log` directly (bypassing the route/response) to confirm a matching
entry was actually written — not just that the endpoint itself succeeded.

The write is fire-and-forget (`asyncio.create_task(log_audit_event(...))`,
never awaited inline — see services/hr_module/audit_service.py), so every
test gives the task a brief moment to land before asserting, matching the
existing pattern in tests/test_rbac.py (test_department_create_is_audit_logged
/ test_user_create_is_audit_logged).
"""
import asyncio
import uuid

import pytest

from config.database import get_db

pytestmark = pytest.mark.anyio


async def _wait_for_audit_entry(db, query: dict, attempts: int = 20, delay: float = 0.15):
    """Poll audit_log for up to ~3s for the fire-and-forget write to land."""
    for _ in range(attempts):
        entry = await db.audit_log.find_one(query)
        if entry is not None:
            return entry
        await asyncio.sleep(delay)
    return None


async def test_workflow_rule_create_update_delete_are_audit_logged(client, admin_headers):
    db = get_db()
    assert db is not None

    create_resp = await client.post(
        "/api/v1/workflows",
        json={
            "name": f"Audit rule {uuid.uuid4().hex[:8]}",
            "trigger_type": "resume_processed",
            "conditions": [],
            "action_type": "fire_webhook",
            "action_params": {},
        },
        headers=admin_headers,
    )
    assert create_resp.status_code == 200
    rule_id = create_resp.json()["rule_id"]

    try:
        create_entry = await _wait_for_audit_entry(
            db, {"action": "workflow_rule_created", "resource_type": "workflow_rule", "resource_id": rule_id}
        )
        assert create_entry is not None
        assert create_entry["actor_email"] == "demo-admin@hirely.ai"

        update_resp = await client.patch(
            f"/api/v1/workflows/{rule_id}",
            json={"is_active": False},
            headers=admin_headers,
        )
        assert update_resp.status_code == 200
        update_entry = await _wait_for_audit_entry(
            db, {"action": "workflow_rule_updated", "resource_type": "workflow_rule", "resource_id": rule_id}
        )
        assert update_entry is not None
        assert update_entry["details"]["is_active"] is False

        delete_resp = await client.delete(f"/api/v1/workflows/{rule_id}", headers=admin_headers)
        assert delete_resp.status_code == 200
        delete_entry = await _wait_for_audit_entry(
            db, {"action": "workflow_rule_deleted", "resource_type": "workflow_rule", "resource_id": rule_id}
        )
        assert delete_entry is not None
    finally:
        await db.workflow_rules.delete_one({"rule_id": rule_id})
        await db.audit_log.delete_many({"resource_id": rule_id})


async def test_webhook_create_update_delete_are_audit_logged(client, admin_headers):
    db = get_db()
    assert db is not None

    create_resp = await client.post(
        "/api/v1/webhooks",
        json={
            "url": "https://example.com:81/hook",
            "event_types": ["candidate.invited"],
            "secret": "s3cr3t",
        },
        headers=admin_headers,
    )
    assert create_resp.status_code == 200
    webhook_id = create_resp.json()["webhook_id"]

    try:
        create_entry = await _wait_for_audit_entry(
            db, {"action": "webhook_created", "resource_type": "webhook_subscription", "resource_id": webhook_id}
        )
        assert create_entry is not None
        assert create_entry["actor_email"] == "demo-admin@hirely.ai"
        assert "secret" not in create_entry["details"]

        update_resp = await client.patch(
            f"/api/v1/webhooks/{webhook_id}",
            json={"is_active": False},
            headers=admin_headers,
        )
        assert update_resp.status_code == 200
        update_entry = await _wait_for_audit_entry(
            db, {"action": "webhook_updated", "resource_type": "webhook_subscription", "resource_id": webhook_id}
        )
        assert update_entry is not None
        assert update_entry["details"]["is_active"] is False

        delete_resp = await client.delete(f"/api/v1/webhooks/{webhook_id}", headers=admin_headers)
        assert delete_resp.status_code == 200
        delete_entry = await _wait_for_audit_entry(
            db, {"action": "webhook_deleted", "resource_type": "webhook_subscription", "resource_id": webhook_id}
        )
        assert delete_entry is not None
    finally:
        await db.webhook_subscriptions.delete_one({"webhook_id": webhook_id})
        await db.audit_log.delete_many({"resource_id": webhook_id})
