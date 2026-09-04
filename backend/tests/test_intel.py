import pytest
from io import BytesIO

pytestmark = pytest.mark.anyio


async def test_resume_stats(client, standard_headers):
    response = await client.get("/api/v1/intel/resumes/stats", headers=standard_headers)
    assert response.status_code == 200
    data = response.json()
    assert "total" in data
    assert "invite_funnel" in data
    assert "auto_invited" in data["invite_funnel"]


async def test_bulk_upload_requires_admin(client, standard_headers):
    files = [("files", ("resume.pdf", BytesIO(b"pdf content"), "application/pdf"))]
    response = await client.post(
        "/api/v1/intel/resumes/upload-bulk",
        files=files,
        headers=standard_headers,
    )
    assert response.status_code == 403


async def test_bulk_upload_and_batch_status(client, admin_headers, standard_headers):
    files = [
        ("files", ("bulk1.pdf", BytesIO(b"resume one"), "application/pdf")),
        ("files", ("bulk2.pdf", BytesIO(b"resume two"), "application/pdf")),
    ]
    upload_resp = await client.post(
        "/api/v1/intel/resumes/upload-bulk",
        files=files,
        headers=admin_headers,
    )
    assert upload_resp.status_code == 200
    batch = upload_resp.json()
    assert "batch_id" in batch
    assert batch["total_files"] == 2
    assert batch["status"] == "processing"

    status_resp = await client.get(
        f"/api/v1/intel/resumes/batch/{batch['batch_id']}/status",
        headers=standard_headers,
    )
    assert status_resp.status_code == 200
    assert status_resp.json()["batch_id"] == batch["batch_id"]


async def test_batch_status_not_found(client, standard_headers):
    response = await client.get(
        "/api/v1/intel/resumes/batch/non-existent-batch/status",
        headers=standard_headers,
    )
    assert response.status_code == 404
