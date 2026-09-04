import pytest

pytestmark = pytest.mark.anyio


async def test_login_success(client):
    payload = {
        "email": "superadmin@hirely.ai",
        "password": "change-me-in-production"
    }
    response = await client.post("/api/v1/auth/login", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["otp_required"] is False
    assert data["user"]["email"] == "superadmin@hirely.ai"
    assert data["user"]["role"] == "superadmin"


async def test_login_normalization_success(client):
    payload = {
        "email": "  Superadmin@Hirely.ai  ",
        "password": "change-me-in-production"
    }
    response = await client.post("/api/v1/auth/login", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["user"]["email"] == "superadmin@hirely.ai"


async def test_login_invalid_credentials(client):
    payload = {
        "email": "superadmin@hirely.ai",
        "password": "wrong-password"
    }
    response = await client.post("/api/v1/auth/login", json=payload)
    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid credentials"


async def test_oauth2_token_success(client):
    payload = {
        "username": "superadmin@hirely.ai",
        "password": "change-me-in-production"
    }
    response = await client.post("/api/v1/auth/token", data=payload)
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"


async def test_oauth2_token_normalization_success(client):
    payload = {
        "username": "  Superadmin@Hirely.ai  ",
        "password": "change-me-in-production"
    }
    response = await client.post("/api/v1/auth/token", data=payload)
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data


async def test_oauth2_token_invalid_credentials(client):
    payload = {
        "username": "superadmin@hirely.ai",
        "password": "wrong-password"
    }
    response = await client.post("/api/v1/auth/token", data=payload)
    assert response.status_code == 401


async def test_me_no_header(client):
    response = await client.get("/api/v1/auth/me")
    assert response.status_code == 401
    assert response.json()["detail"] == "Not authenticated"


async def test_me_invalid_token(client):
    headers = {"Authorization": "Bearer completely-invalid-token"}
    response = await client.get("/api/v1/auth/me", headers=headers)
    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid or expired credentials"


async def test_me_valid_token(client):
    payload = {
        "email": "hradmin@hirely.ai",
        "password": "Admin@123"
    }
    login_resp = await client.post("/api/v1/auth/login", json=payload)
    token = login_resp.json()["access_token"]
    
    headers = {"Authorization": f"Bearer {token}"}
    response = await client.get("/api/v1/auth/me", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data["email"] == "hradmin@hirely.ai"
    assert data["role"] == "admin"
    assert "password_hash" not in data


async def test_me_demo_superadmin(client):
    headers = {"Authorization": "Bearer demo-superadmin-token"}
    response = await client.get("/api/v1/auth/me", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data["role"] == "superadmin"
    assert "demo" in data["email"]


async def test_me_demo_admin(client):
    headers = {"Authorization": "Bearer demo-admin-token"}
    response = await client.get("/api/v1/auth/me", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data["role"] == "admin"


async def test_me_demo_standard(client):
    headers = {"Authorization": "Bearer demo-standard-token"}
    response = await client.get("/api/v1/auth/me", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data["role"] == "standard"
