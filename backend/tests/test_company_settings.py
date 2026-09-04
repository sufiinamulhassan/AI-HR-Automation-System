import pytest

import main as _main_module
from routes import company_settings as _company_settings_routes
from config.database import get_db
from config.settings import settings

if not any(getattr(route, "path", "").startswith("/api/v1/company-settings") for route in _main_module.app.routes):
    _main_module.app.include_router(
        _company_settings_routes.router,
        prefix="/api/v1/company-settings",
        tags=["hr_module · Company Settings"],
    )

pytestmark = pytest.mark.anyio


@pytest.fixture(autouse=True)
async def _clean_company_settings():
    """company_settings is a brand-new collection owned entirely by this
    feature — safe to clear before/after each test (no shared fixture data
    lives here, unlike users/jobs/resumes/candidates)."""
    db = get_db()
    if db is not None:
        await db.company_settings.delete_many({})
    yield
    if db is not None:
        await db.company_settings.delete_many({})


async def test_get_requires_admin(client, standard_headers):
    response = await client.get("/api/v1/company-settings", headers=standard_headers)
    assert response.status_code == 403


async def test_get_upserts_blank_defaults_on_fresh_install(client, admin_headers):
    response = await client.get("/api/v1/company-settings", headers=admin_headers)
    assert response.status_code == 200
    body = response.json()
    assert "_id" not in body
    for field in ("company_name", "industry", "size", "website", "address", "primary_contact_email"):
        assert body[field] == ""

    db = get_db()
    doc = await db.company_settings.find_one({"_id": "singleton"})
    assert doc is not None, "first GET must persist the singleton document, not just return defaults in-memory"


async def test_get_is_idempotent_singleton(client, admin_headers):
    first = await client.get("/api/v1/company-settings", headers=admin_headers)
    second = await client.get("/api/v1/company-settings", headers=admin_headers)
    assert first.status_code == second.status_code == 200

    db = get_db()
    count = await db.company_settings.count_documents({})
    assert count == 1, "GET must never create more than one company_settings document"


async def test_patch_requires_admin(client, standard_headers):
    response = await client.patch(
        "/api/v1/company-settings", json={"company_name": "Acme"}, headers=standard_headers,
    )
    assert response.status_code == 403


async def test_patch_updates_only_provided_fields(client, admin_headers):
    await client.get("/api/v1/company-settings", headers=admin_headers)

    patch_resp = await client.patch(
        "/api/v1/company-settings",
        json={"company_name": "Acme Corp", "industry": "Software"},
        headers=admin_headers,
    )
    assert patch_resp.status_code == 200
    body = patch_resp.json()
    assert body["company_name"] == "Acme Corp"
    assert body["industry"] == "Software"
    assert body["website"] == ""

    get_resp = await client.get("/api/v1/company-settings", headers=admin_headers)
    assert get_resp.json()["company_name"] == "Acme Corp"

    db = get_db()
    count = await db.company_settings.count_documents({})
    assert count == 1, "PATCH must update the existing singleton, never insert a second document"


async def test_patch_ignores_unknown_fields(client, admin_headers):
    response = await client.patch(
        "/api/v1/company-settings",
        json={"company_name": "Acme", "not_a_real_field": "should be dropped"},
        headers=admin_headers,
    )
    assert response.status_code == 200
    assert "not_a_real_field" not in response.json()


async def test_integrations_status_requires_admin(client, standard_headers):
    response = await client.get("/api/v1/company-settings/integrations-status", headers=standard_headers)
    assert response.status_code == 403


async def test_integrations_status_never_leaks_secret_values(client, admin_headers):
    response = await client.get("/api/v1/company-settings/integrations-status", headers=admin_headers)
    assert response.status_code == 200
    body = response.json()

    assert "core" in body and "job_sources" in body
    core_by_id = {item["id"]: item for item in body["core"]}
    for expected_id in (
        "openai", "pinecone", "judge0", "google_oauth_sso", "webhook_signing", "smtp_email",
    ):
        assert expected_id in core_by_id
        assert isinstance(core_by_id[expected_id]["configured"], bool)

    serialized = str(body)
    if settings.OPENAI_API_KEY:
        assert settings.OPENAI_API_KEY not in serialized
    if settings.PINECONE_API_KEY:
        assert settings.PINECONE_API_KEY not in serialized

    assert core_by_id["openai"]["configured"] == bool(settings.OPENAI_API_KEY)
    assert core_by_id["pinecone"]["configured"] == bool(settings.PINECONE_API_KEY)
    assert core_by_id["judge0"]["configured"] == bool(settings.JUDGE0_API_URL)
    assert core_by_id["smtp_email"]["configured"] == bool(settings.EMAIL_HOST)


async def test_integrations_status_reuses_job_sources_list_sources(client, admin_headers):
    from services.hr_module.job_sources import list_sources

    response = await client.get("/api/v1/company-settings/integrations-status", headers=admin_headers)
    assert response.status_code == 200
    assert response.json()["job_sources"] == list_sources()
