import uuid

import pytest
from passlib.context import CryptContext

from config.database import get_db
from services.hr_module.permissions import DEFAULT_ROLE_PERMISSIONS

pytestmark = pytest.mark.anyio

pwd_ctx = CryptContext(schemes=["bcrypt"])


async def test_me_permissions_standard_role(client, standard_headers):
    resp = await client.get("/api/v1/auth/me/permissions", headers=standard_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["role"] == "standard"
    assert set(data["permissions"]) == set(DEFAULT_ROLE_PERMISSIONS["standard"])
    assert "performance:read" not in data["permissions"]
    assert "performance:manage" not in data["permissions"]


async def test_me_permissions_admin_role(client, admin_headers):
    resp = await client.get("/api/v1/auth/me/permissions", headers=admin_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["role"] == "admin"
    assert set(data["permissions"]) == set(DEFAULT_ROLE_PERMISSIONS["admin"])
    assert "users:manage" not in data["permissions"]
    assert "rbac:manage" not in data["permissions"]
    assert "performance:manage" in data["permissions"]


async def test_me_permissions_superadmin_role(client, superadmin_headers):
    resp = await client.get("/api/v1/auth/me/permissions", headers=superadmin_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["role"] == "superadmin"
    assert set(data["permissions"]) == set(DEFAULT_ROLE_PERMISSIONS["superadmin"])
    assert "users:manage" in data["permissions"]
    assert "rbac:manage" in data["permissions"]


async def test_me_permissions_requires_authentication(client):
    resp = await client.get("/api/v1/auth/me/permissions")
    assert resp.status_code == 401


async def test_me_permissions_reflects_custom_role_override(client):
    db = get_db()
    role_name = f"custom_probe_role_{uuid.uuid4().hex[:8]}"
    custom_permissions = ["performance:review", "jobs:read"]
    await db.roles.insert_one({"role_name": role_name, "permissions": custom_permissions})
    email = f"custom-role-{uuid.uuid4().hex[:10]}@example.com"
    password = "Test@12345"
    await db.users.insert_one({
        "name": "Custom Role Probe", "email": email, "password_hash": pwd_ctx.hash(password),
        "role": role_name, "is_active": True,
    })
    try:
        login = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
        assert login.status_code == 200, login.text
        token = login.json()["access_token"]
        resp = await client.get(
            "/api/v1/auth/me/permissions", headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["role"] == role_name
        assert set(data["permissions"]) == set(custom_permissions)
    finally:
        await db.roles.delete_one({"role_name": role_name})
        await db.users.delete_one({"email": email})


async def test_list_models(client, standard_headers):
    response = await client.get("/api/v1/auth/models", headers=standard_headers)
    assert response.status_code == 200
    data = response.json()
    assert "models" in data
    assert "current" in data
    assert len(data["models"]) > 0


async def test_create_user_requires_admin(client, standard_headers):
    response = await client.post(
        "/api/v1/auth/users",
        json={
            "name": "New User",
            "email": "newuser@hirely.ai",
            "password": "Pass@123",
            "role": "standard",
        },
        headers=standard_headers,
    )
    assert response.status_code == 403


async def test_create_and_list_users(client, admin_headers, superadmin_headers):
    create_resp = await client.post(
        "/api/v1/auth/users",
        json={
            "name": "New User",
            "email": "newuser@hirely.ai",
            "password": "Pass@123",
            "role": "standard",
        },
        headers=admin_headers,
    )
    assert create_resp.status_code == 200

    list_resp = await client.get("/api/v1/auth/users", headers=superadmin_headers)
    assert list_resp.status_code == 200
    emails = [u["email"] for u in list_resp.json()]
    roles = {u["role"] for u in list_resp.json()}
    assert "newuser@hirely.ai" in emails
    assert {"admin", "standard"}.issubset(roles)
    assert "superadmin@hirely.ai" not in emails
    assert all("password_hash" not in u for u in list_resp.json())


async def test_admin_lists_only_standard_users(client, admin_headers):
    response = await client.get("/api/v1/auth/users", headers=admin_headers)
    assert response.status_code == 200
    users = response.json()
    assert users
    assert {u["role"] for u in users} == {"standard"}
    assert all("password_hash" not in u for u in users)
