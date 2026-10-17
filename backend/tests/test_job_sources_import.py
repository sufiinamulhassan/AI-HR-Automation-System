import pytest

pytestmark = pytest.mark.anyio


@pytest.mark.parametrize("source_id", ["linkedin", "indeed"])
async def test_import_unconfigured_keyed_source_returns_400(client, source_id):
    headers = {"Authorization": "Bearer demo-admin-token"}
    payload = {"source": source_id, "query": "engineer", "limit": 5}
    response = await client.post("/api/v1/jobs/import", json=payload, headers=headers)
    assert response.status_code == 400
    assert "not configured" in response.json()["detail"].lower()
