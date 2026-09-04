import pytest

pytestmark = pytest.mark.anyio


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
    assert {"superadmin", "admin", "standard"}.issubset(roles)
    assert all("password_hash" not in u for u in list_resp.json())


async def test_admin_lists_only_standard_users(client, admin_headers):
    response = await client.get("/api/v1/auth/users", headers=admin_headers)
    assert response.status_code == 200
    users = response.json()
    assert users
    assert {u["role"] for u in users} == {"standard"}
    assert all("password_hash" not in u for u in users)
