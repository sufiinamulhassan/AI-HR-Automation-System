"""Integration test: POST /jobs/import against unconfigured keyed sources.

Lives at the top level (not tests/unit/) because it needs the real app + test
DB via the `client` fixture from tests/conftest.py — tests/unit overrides that
fixture with a MagicMock (see tests/unit/conftest.py), so it can't be used there.
Named distinctly from tests/unit/test_job_sources.py to avoid a pytest module
basename collision (neither tests/ nor tests/unit/ has an __init__.py).
"""
import pytest

pytestmark = pytest.mark.anyio


@pytest.mark.parametrize("source_id", ["linkedin", "naukri", "dice", "careerbuilder", "indeed"])
async def test_import_unconfigured_keyed_source_returns_400(client, source_id):
    headers = {"Authorization": "Bearer demo-admin-token"}
    payload = {"source": source_id, "query": "engineer", "limit": 5}
    response = await client.post("/api/v1/jobs/import", json=payload, headers=headers)
    assert response.status_code == 400
    assert "not configured" in response.json()["detail"].lower()
