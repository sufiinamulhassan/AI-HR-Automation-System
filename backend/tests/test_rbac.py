"""Tests for RBAC — Role/Permission model + AuditLog (MVP2 §2.1)."""
import asyncio
import uuid

import pytest

import main as _main_module
from routes import rbac as _rbac_routes
from config.database import get_db
from services.hr_module.permissions import (
    PERMISSION_CATALOG,
    DEFAULT_ROLE_PERMISSIONS,
    resolve_permissions,
)

if not any(getattr(route, "path", "").startswith("/api/v1/rbac") for route in _main_module.app.routes):
    _main_module.app.include_router(
        _rbac_routes.router, prefix="/api/v1/rbac", tags=["hr_module · RBAC"]
    )

pytestmark = pytest.mark.anyio


async def test_resolve_permissions_builtin_defaults_no_custom_role():
    db = get_db()
    assert db is not None
    await db.roles.delete_many({"role_name": {"$in": ["standard", "admin", "superadmin"]}})

    assert await resolve_permissions("standard") == DEFAULT_ROLE_PERMISSIONS["standard"]
    assert await resolve_permissions("admin") == DEFAULT_ROLE_PERMISSIONS["admin"]
    assert await resolve_permissions("superadmin") == DEFAULT_ROLE_PERMISSIONS["superadmin"]
    assert await resolve_permissions("nonexistent-role") == []


async def test_admin_default_excludes_user_and_role_management():
    assert "users:manage" not in DEFAULT_ROLE_PERMISSIONS["admin"]
    assert "rbac:manage" not in DEFAULT_ROLE_PERMISSIONS["admin"]
    assert "users:manage" in DEFAULT_ROLE_PERMISSIONS["superadmin"]
    assert "rbac:manage" in DEFAULT_ROLE_PERMISSIONS["superadmin"]


async def test_resolve_permissions_custom_role_override():
    db = get_db()
    assert db is not None
    role_name = f"custom_role_{uuid.uuid4().hex[:8]}"
    await db.roles.insert_one({"role_name": role_name, "permissions": ["jobs:read", "offers:read"]})
    try:
        assert await resolve_permissions(role_name) == ["jobs:read", "offers:read"]
    finally:
        await db.roles.delete_one({"role_name": role_name})


async def test_get_permission_catalog_requires_admin(client, standard_headers):
    response = await client.get("/api/v1/rbac/permissions", headers=standard_headers)
    assert response.status_code == 403


async def test_get_permission_catalog_admin_ok(client, admin_headers):
    response = await client.get("/api/v1/rbac/permissions", headers=admin_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["permissions"] == PERMISSION_CATALOG
    assert "admin" in body["default_role_permissions"]


async def test_list_roles_requires_admin(client, standard_headers):
    response = await client.get("/api/v1/rbac/roles", headers=standard_headers)
    assert response.status_code == 403


async def test_list_roles_admin_ok(client, admin_headers):
    response = await client.get("/api/v1/rbac/roles", headers=admin_headers)
    assert response.status_code == 200
    body = response.json()
    assert "custom_roles" in body
    assert "built_in_defaults" in body


async def test_get_builtin_role_default(client, admin_headers):
    response = await client.get("/api/v1/rbac/roles/standard", headers=admin_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["is_builtin_default"] is True
    assert body["permissions"] == DEFAULT_ROLE_PERMISSIONS["standard"]


async def test_get_unknown_role_404(client, admin_headers):
    response = await client.get(f"/api/v1/rbac/roles/no-such-role-{uuid.uuid4().hex[:8]}", headers=admin_headers)
    assert response.status_code == 404


async def test_create_role_requires_superadmin_not_just_admin(client, admin_headers):
    response = await client.post(
        "/api/v1/rbac/roles",
        json={"role_name": f"role_{uuid.uuid4().hex[:8]}", "permissions": ["jobs:read"]},
        headers=admin_headers,
    )
    assert response.status_code == 403


async def test_create_role_rejects_unknown_permission(client, superadmin_headers):
    response = await client.post(
        "/api/v1/rbac/roles",
        json={"role_name": f"role_{uuid.uuid4().hex[:8]}", "permissions": ["not:a_real_permission"]},
        headers=superadmin_headers,
    )
    assert response.status_code == 400


async def test_create_update_delete_role_roundtrip(client, superadmin_headers, admin_headers):
    role_name = f"recruiter_{uuid.uuid4().hex[:8]}"
    create_resp = await client.post(
        "/api/v1/rbac/roles",
        json={"role_name": role_name, "permissions": ["jobs:read", "candidates:read"], "description": "Recruiter"},
        headers=superadmin_headers,
    )
    assert create_resp.status_code == 200
    assert create_resp.json()["permissions"] == ["jobs:read", "candidates:read"]

    dup_resp = await client.post(
        "/api/v1/rbac/roles",
        json={"role_name": role_name, "permissions": ["jobs:read"]},
        headers=superadmin_headers,
    )
    assert dup_resp.status_code == 409

    get_resp = await client.get(f"/api/v1/rbac/roles/{role_name}", headers=admin_headers)
    assert get_resp.status_code == 200
    assert get_resp.json()["permissions"] == ["jobs:read", "candidates:read"]

    assert await resolve_permissions(role_name) == ["jobs:read", "candidates:read"]

    patch_forbidden = await client.patch(
        f"/api/v1/rbac/roles/{role_name}", json={"permissions": ["jobs:read"]}, headers=admin_headers
    )
    assert patch_forbidden.status_code == 403

    patch_resp = await client.patch(
        f"/api/v1/rbac/roles/{role_name}",
        json={"permissions": ["jobs:read", "candidates:read", "offers:read"]},
        headers=superadmin_headers,
    )
    assert patch_resp.status_code == 200
    assert await resolve_permissions(role_name) == ["jobs:read", "candidates:read", "offers:read"]

    delete_resp = await client.delete(f"/api/v1/rbac/roles/{role_name}", headers=superadmin_headers)
    assert delete_resp.status_code == 200
    assert await resolve_permissions(role_name) == []

    get_after_delete = await client.get(f"/api/v1/rbac/roles/{role_name}", headers=admin_headers)
    assert get_after_delete.status_code == 404


async def test_update_unknown_role_404(client, superadmin_headers):
    response = await client.patch(
        f"/api/v1/rbac/roles/no-such-role-{uuid.uuid4().hex[:8]}",
        json={"permissions": ["jobs:read"]},
        headers=superadmin_headers,
    )
    assert response.status_code == 404


async def test_assign_user_role_requires_superadmin(client, admin_headers):
    response = await client.patch(
        "/api/v1/rbac/users/user@hirely.ai/role", json={"role_name": "admin"}, headers=admin_headers
    )
    assert response.status_code == 403


async def test_assign_user_role_unknown_user_404(client, superadmin_headers):
    response = await client.patch(
        f"/api/v1/rbac/users/no-such-user-{uuid.uuid4().hex[:8]}@hirely.ai/role",
        json={"role_name": "admin"},
        headers=superadmin_headers,
    )
    assert response.status_code == 404


async def test_assign_user_role_unknown_role_400(client, superadmin_headers):
    response = await client.patch(
        "/api/v1/rbac/users/user@hirely.ai/role",
        json={"role_name": f"no-such-role-{uuid.uuid4().hex[:8]}"},
        headers=superadmin_headers,
    )
    assert response.status_code == 400


async def test_assign_user_role_roundtrip(client, superadmin_headers):
    db = get_db()
    assert db is not None
    original = await db.users.find_one({"email": "user@hirely.ai"})
    assert original is not None
    try:
        response = await client.patch(
            "/api/v1/rbac/users/user@hirely.ai/role", json={"role_name": "admin"}, headers=superadmin_headers
        )
        assert response.status_code == 200
        assert response.json()["role"] == "admin"

        updated = await db.users.find_one({"email": "user@hirely.ai"})
        assert updated["role"] == "admin"
    finally:
        await db.users.update_one({"email": "user@hirely.ai"}, {"$set": {"role": original.get("role", "standard")}})


async def test_audit_log_requires_admin(client, standard_headers):
    response = await client.get("/api/v1/rbac/audit-log", headers=standard_headers)
    assert response.status_code == 403


async def test_audit_log_paginated_shape(client, admin_headers):
    response = await client.get("/api/v1/rbac/audit-log?limit=5", headers=admin_headers)
    assert response.status_code == 200
    body = response.json()
    assert set(body.keys()) == {"items", "total", "page", "limit"}
    assert body["limit"] == 5


async def test_audit_log_date_only_end_date_includes_that_day(client, admin_headers):
    """A date-only end_date (what <input type="date"> submits) must cover the
    whole day. Compared raw, "2026-08-07" sorts below every timestamp on
    2026-08-07, so the filter would return nothing for that day.
    """
    db = get_db()
    assert db is not None
    resource_id = f"audit-range-{uuid.uuid4().hex[:10]}"
    try:
        await db.audit_log.insert_one({
            "actor_email": "range-probe@hirely.ai",
            "actor_role": "admin",
            "action": "range_probe",
            "resource_type": "probe",
            "resource_id": resource_id,
            "details": {},
            "created_at": "2026-08-07T09:15:00.123456+00:00",
        })

        response = await client.get(
            "/api/v1/rbac/audit-log?action=range_probe&start_date=2026-08-07&end_date=2026-08-07",
            headers=admin_headers,
        )
        assert response.status_code == 200
        assert resource_id in [item["resource_id"] for item in response.json()["items"]]

        response = await client.get(
            "/api/v1/rbac/audit-log?action=range_probe&end_date=2026-08-06",
            headers=admin_headers,
        )
        assert resource_id not in [item["resource_id"] for item in response.json()["items"]]
    finally:
        await db.audit_log.delete_many({"resource_id": resource_id})


async def test_audit_log_filters_are_substring_and_regex_safe(client, admin_headers):
    db = get_db()
    assert db is not None
    resource_id = f"audit-sub-{uuid.uuid4().hex[:10]}"
    try:
        await db.audit_log.insert_one({
            "actor_email": "Substring.Probe@hirely.ai",
            "actor_role": "admin",
            "action": "substring_probe",
            "resource_type": "probe",
            "resource_id": resource_id,
            "details": {},
            "created_at": "2026-08-07T09:15:00.123456+00:00",
        })

        response = await client.get(
            "/api/v1/rbac/audit-log?actor_email=substring.probe", headers=admin_headers
        )
        assert response.status_code == 200
        assert resource_id in [item["resource_id"] for item in response.json()["items"]]

        response = await client.get(
            "/api/v1/rbac/audit-log?action=substring.probe", headers=admin_headers
        )
        assert response.status_code == 200
        assert resource_id not in [item["resource_id"] for item in response.json()["items"]]
    finally:
        await db.audit_log.delete_many({"resource_id": resource_id})


async def test_audit_log_facets_shape(client, admin_headers, standard_headers):
    response = await client.get("/api/v1/rbac/audit-log/facets", headers=admin_headers)
    assert response.status_code == 200
    body = response.json()
    assert set(body.keys()) == {"actions", "resource_types", "actors"}
    assert all(isinstance(value, list) for value in body.values())

    blocked = await client.get("/api/v1/rbac/audit-log/facets", headers=standard_headers)
    assert blocked.status_code == 403


async def test_department_create_is_audit_logged(client, admin_headers):
    db = get_db()
    assert db is not None
    dept_name = f"Dept {uuid.uuid4().hex[:8]}"
    create_resp = await client.post(
        "/api/v1/admin/departments", json={"name": dept_name, "description": "test"}, headers=admin_headers
    )
    assert create_resp.status_code == 200
    department_id = create_resp.json()["department_id"]

    try:
        await asyncio.sleep(0.3)
        entry = await db.audit_log.find_one({"action": "department_create", "resource_id": department_id})
        assert entry is not None
        assert entry["actor_email"] == "demo-admin@hirely.ai"
        assert entry["details"]["name"] == dept_name
    finally:
        await db.departments.delete_one({"department_id": department_id})
        await db.audit_log.delete_many({"resource_id": department_id})


async def test_user_create_is_audit_logged(client, admin_headers):
    db = get_db()
    assert db is not None
    email = f"audit-test-{uuid.uuid4().hex[:8]}@hirely.ai"
    create_resp = await client.post(
        "/api/v1/auth/users",
        json={"name": "Audit Test", "email": email, "password": "Pass@123", "role": "standard"},
        headers=admin_headers,
    )
    assert create_resp.status_code == 200

    try:
        await asyncio.sleep(0.3)
        entry = await db.audit_log.find_one({"action": "user_create", "resource_id": email})
        assert entry is not None
        assert entry["actor_email"] == "demo-admin@hirely.ai"
    finally:
        await db.users.delete_one({"email": email})
        await db.audit_log.delete_many({"resource_id": email})


async def test_update_user_role_requires_superadmin(client, admin_headers):
    """An `admin` must not be able to promote anyone (including themselves)
    through the auth route — that would bypass rbac:manage entirely."""
    db = get_db()
    assert db is not None
    email = f"gate-test-{uuid.uuid4().hex[:8]}@hirely.ai"
    await db.users.insert_one({
        "name": "Gate Test", "email": email, "password_hash": "x",
        "role": "standard", "is_active": True,
    })
    try:
        resp = await client.patch(
            f"/api/v1/auth/users/{email}", json={"role": "superadmin"}, headers=admin_headers
        )
        assert resp.status_code == 403
        assert (await db.users.find_one({"email": email}))["role"] == "standard"
    finally:
        await db.users.delete_one({"email": email})


async def test_update_user_rejects_unknown_role(client, superadmin_headers):
    """An unvalidated role string resolves to an empty permission set, which
    silently locks the account out of everything — reject it up front."""
    db = get_db()
    assert db is not None
    email = f"gate-test-{uuid.uuid4().hex[:8]}@hirely.ai"
    await db.users.insert_one({
        "name": "Gate Test", "email": email, "password_hash": "x",
        "role": "standard", "is_active": True,
    })
    try:
        resp = await client.patch(
            f"/api/v1/auth/users/{email}",
            json={"role": f"no-such-role-{uuid.uuid4().hex[:8]}"},
            headers=superadmin_headers,
        )
        assert resp.status_code == 400
        assert (await db.users.find_one({"email": email}))["role"] == "standard"
    finally:
        await db.users.delete_one({"email": email})


async def test_update_user_non_role_fields_still_work_for_admin(client, admin_headers):
    """The gate must apply only to `role` — an admin editing a name or
    toggling is_active is unaffected."""
    db = get_db()
    assert db is not None
    email = f"gate-test-{uuid.uuid4().hex[:8]}@hirely.ai"
    await db.users.insert_one({
        "name": "Gate Test", "email": email, "password_hash": "x",
        "role": "standard", "is_active": True,
    })
    try:
        resp = await client.patch(
            f"/api/v1/auth/users/{email}",
            json={"name": "Renamed", "otp_required": True},
            headers=admin_headers,
        )
        assert resp.status_code == 200
        doc = await db.users.find_one({"email": email})
        assert doc["name"] == "Renamed"
        assert doc["otp_required"] is True
    finally:
        await db.users.delete_one({"email": email})


async def test_update_user_role_allowed_for_superadmin(client, superadmin_headers):
    """The endpoint still works for its legitimate caller."""
    db = get_db()
    assert db is not None
    email = f"gate-test-{uuid.uuid4().hex[:8]}@hirely.ai"
    await db.users.insert_one({
        "name": "Gate Test", "email": email, "password_hash": "x",
        "role": "standard", "is_active": True,
    })
    try:
        resp = await client.patch(
            f"/api/v1/auth/users/{email}", json={"role": "admin"}, headers=superadmin_headers
        )
        assert resp.status_code == 200
        assert (await db.users.find_one({"email": email}))["role"] == "admin"
    finally:
        await db.users.delete_one({"email": email})
