import pytest

import main as _main_module
from routes import sso as _sso_routes
from config.settings import settings

if not any(getattr(route, "path", "").startswith("/api/v1/sso") for route in _main_module.app.routes):
    _main_module.app.include_router(
        _sso_routes.router, prefix="/api/v1/sso", tags=["hr_module · SSO"]
    )

pytestmark = pytest.mark.anyio


async def test_login_not_configured_returns_503_not_500(client):
    assert not settings.GOOGLE_OAUTH_CLIENT_ID
    response = await client.get("/api/v1/sso/google/login")
    assert response.status_code == 503
    assert "not configured" in response.json()["detail"].lower()


async def test_callback_not_configured_returns_503_not_500(client):
    assert not settings.GOOGLE_OAUTH_CLIENT_ID
    response = await client.get("/api/v1/sso/google/callback", params={"code": "abc", "state": "xyz"})
    assert response.status_code == 503


async def test_callback_missing_state_returns_400_when_configured(client, monkeypatch):
    monkeypatch.setattr(settings, "GOOGLE_OAUTH_CLIENT_ID", "test-client-id")
    monkeypatch.setattr(settings, "GOOGLE_OAUTH_CLIENT_SECRET", "test-client-secret")
    monkeypatch.setattr(settings, "GOOGLE_OAUTH_REDIRECT_URI", "http://localhost/callback")

    response = await client.get("/api/v1/sso/google/callback", params={"code": "abc", "state": "bogus-state-never-issued"})
    assert response.status_code == 400
    assert "state" in response.json()["detail"].lower()


async def test_callback_missing_code_or_state_returns_400_when_configured(client, monkeypatch):
    monkeypatch.setattr(settings, "GOOGLE_OAUTH_CLIENT_ID", "test-client-id")
    monkeypatch.setattr(settings, "GOOGLE_OAUTH_CLIENT_SECRET", "test-client-secret")
    monkeypatch.setattr(settings, "GOOGLE_OAUTH_REDIRECT_URI", "http://localhost/callback")

    response = await client.get("/api/v1/sso/google/callback")
    assert response.status_code == 400
