import pytest
from io import BytesIO

from routes.auth import _make_token

pytestmark = pytest.mark.anyio


async def _bearer(email: str) -> str:
    return f"Bearer {await _make_token(email)}"


async def test_upload_resume_requires_admin(client):
    headers = {"Authorization": await _bearer("user@hirely.ai")}
    file_content = b"Mock resume content"
    files = {"file": ("resume.pdf", BytesIO(file_content), "application/pdf")}

    response = await client.post("/api/v1/resumes/upload", files=files, headers=headers)
    assert response.status_code == 403
    assert "Admin access required" in response.json()["detail"]


async def test_upload_resume_success_and_lifecycle(client):
    headers = {"Authorization": await _bearer("hradmin@hirely.ai")}
    file_content = b"Mock resume content for admin upload"
    files = {"file": ("test_resume.pdf", BytesIO(file_content), "application/pdf")}
    data = {"job_id": "optional-job-id-123"}
    
    response = await client.post("/api/v1/resumes/upload", files=files, data=data, headers=headers)
    assert response.status_code == 200
    res = response.json()
    assert "resume_id" in res
    assert res["status"] == "processing"
    
    resume_id = res["resume_id"]
    
    get_headers = {"Authorization": "Bearer demo-standard-token"}
    list_response = await client.get("/api/v1/resumes", headers=get_headers)
    assert list_response.status_code == 200
    list_data = list_response.json()
    assert "resumes" in list_data
    assert any(r["resume_id"] == resume_id for r in list_data["resumes"])
    
    get_res = await client.get(f"/api/v1/resumes/{resume_id}", headers=get_headers)
    assert get_res.status_code == 200
    assert get_res.json()["filename"] == "test_resume.pdf"
    
    search_res = await client.get("/api/v1/resumes?search=test_resume", headers=get_headers)
    assert search_res.status_code == 200
    search_data = search_res.json()
    assert any(r["resume_id"] == resume_id for r in search_data["resumes"])
    
    del_response = await client.delete(f"/api/v1/resumes/{resume_id}", headers=headers)
    assert del_response.status_code == 200
    
    get_res_after_del = await client.get(f"/api/v1/resumes/{resume_id}", headers=get_headers)
    assert get_res_after_del.status_code == 404

async def test_get_resume_not_found(client):
    headers = {"Authorization": await _bearer("user@hirely.ai")}
    response = await client.get("/api/v1/resumes/non-existent-uuid-12345", headers=headers)
    assert response.status_code == 404
    assert "Resume not found" in response.json()["detail"]
