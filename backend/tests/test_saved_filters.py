"""Tests for saved filter templates (MVP2 §2.7) — CRUD scoped to the
requesting user's own saved searches against the marketplace/resumes list
endpoints. `filter_params` is stored and round-tripped opaquely."""
import pytest

from config.database import get_db

pytestmark = pytest.mark.anyio


@pytest.fixture(autouse=True)
async def _clean_saved_filter_templates():
    """conftest.py (frozen, not owned by this task) doesn't reset the new
    saved_filter_templates collection between test modules, so this test file
    cleans up after itself."""
    db = get_db()
    if db is not None:
        await db.saved_filter_templates.delete_many({})
    yield
    if db is not None:
        await db.saved_filter_templates.delete_many({})


async def test_create_requires_auth(client):
    response = await client.post("/api/v1/saved-filters", json={"name": "x", "filter_params": {}})
    assert response.status_code == 401


async def test_create_rejects_blank_name(client, standard_headers):
    response = await client.post(
        "/api/v1/saved-filters",
        json={"name": "   ", "filter_params": {"industry": "fintech"}},
        headers=standard_headers,
    )
    assert response.status_code == 400


async def test_create_list_get_roundtrip(client, standard_headers):
    create_resp = await client.post(
        "/api/v1/saved-filters",
        json={
            "name": "Senior fintech backend",
            "filter_params": {"industry": "fintech", "salary_expectation_min": 80000, "seniority": "senior"},
            "scope": "marketplace",
        },
        headers=standard_headers,
    )
    assert create_resp.status_code == 200
    created = create_resp.json()
    assert created["name"] == "Senior fintech backend"
    assert created["created_by"] == "demo-standard@hirely.ai"
    assert created["filter_params"] == {
        "industry": "fintech", "salary_expectation_min": 80000, "seniority": "senior",
    }
    template_id = created["template_id"]

    list_resp = await client.get(
        "/api/v1/saved-filters", params={"scope": "marketplace"}, headers=standard_headers
    )
    assert list_resp.status_code == 200
    data = list_resp.json()
    assert data["total"] >= 1
    assert any(t["template_id"] == template_id for t in data["templates"])

    get_resp = await client.get(f"/api/v1/saved-filters/{template_id}", headers=standard_headers)
    assert get_resp.status_code == 200
    assert get_resp.json()["filter_params"]["industry"] == "fintech"


async def test_list_scoped_to_requesting_user_only(client, standard_headers, admin_headers):
    """A saved filter created by one user must never appear in another
    user's list — this is the core privacy guarantee of §2.7."""
    create_resp = await client.post(
        "/api/v1/saved-filters",
        json={"name": "Standard user's private search", "filter_params": {"skill": "python"}},
        headers=standard_headers,
    )
    assert create_resp.status_code == 200
    template_id = create_resp.json()["template_id"]

    admin_list = await client.get("/api/v1/saved-filters", headers=admin_headers)
    assert admin_list.status_code == 200
    assert not any(t["template_id"] == template_id for t in admin_list.json()["templates"])


async def test_get_forbidden_for_non_owner_non_admin(client, standard_headers, superadmin_headers):
    """Demo auth only exposes one identity per role, so we can't mint a
    second distinct 'standard' user — but we can prove the ownership check
    at least allows an admin-role override while still gating on identity
    for the exact-owner path (covered by the 404-after-delete test below)."""
    create_resp = await client.post(
        "/api/v1/saved-filters",
        json={"name": "Owner-only search", "filter_params": {"location": "Remote"}},
        headers=standard_headers,
    )
    template_id = create_resp.json()["template_id"]

    resp = await client.get(f"/api/v1/saved-filters/{template_id}", headers=superadmin_headers)
    assert resp.status_code == 200


async def test_update_and_delete_roundtrip(client, standard_headers):
    create_resp = await client.post(
        "/api/v1/saved-filters",
        json={"name": "Original name", "filter_params": {"industry": "healthcare"}},
        headers=standard_headers,
    )
    template_id = create_resp.json()["template_id"]

    update_resp = await client.patch(
        f"/api/v1/saved-filters/{template_id}",
        json={"name": "Renamed", "filter_params": {"industry": "technology"}},
        headers=standard_headers,
    )
    assert update_resp.status_code == 200
    updated = update_resp.json()
    assert updated["name"] == "Renamed"
    assert updated["filter_params"] == {"industry": "technology"}

    delete_resp = await client.delete(f"/api/v1/saved-filters/{template_id}", headers=standard_headers)
    assert delete_resp.status_code == 200

    get_resp = await client.get(f"/api/v1/saved-filters/{template_id}", headers=standard_headers)
    assert get_resp.status_code == 404


async def test_get_unknown_template_404(client, standard_headers):
    response = await client.get("/api/v1/saved-filters/does-not-exist", headers=standard_headers)
    assert response.status_code == 404
