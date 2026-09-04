import uuid

import pytest

from config.database import get_db

pytestmark = pytest.mark.anyio

JOB_PAYLOAD = {
    "title": "Backend Engineer",
    "description": "Build APIs and services.",
    "difficulty": "mid",
    "employment_type": "full-time",
    "location": "Remote",
    "salary_min": 90000,
    "salary_max": 130000,
    "is_remote": True,
    "company_name": "Test Corp",
}


async def _create_job(client, headers):
    response = await client.post("/api/v1/jobs", json=JOB_PAYLOAD, headers=headers)
    assert response.status_code == 200
    return response.json()["job_id"]


async def test_create_job_requires_admin(client):
    payload = {
        "title": "Software Engineer",
        "description": "Develop features, write code, run tests.",
        "difficulty": "mid",
        "employment_type": "full-time",
        "location": "Remote",
        "salary_min": 80000,
        "salary_max": 120000,
        "is_remote": True,
        "company_name": "Tech Corp"
    }
    headers = {"Authorization": "Bearer demo-standard-token"}
    response = await client.post("/api/v1/jobs", json=payload, headers=headers)
    assert response.status_code == 403
    assert "Admin access required" in response.json()["detail"]


async def test_create_job_success_and_lifecycle(client):
    payload = {
        "title": "Senior Python Developer",
        "description": "Lead python backend development and system architecture.",
        "difficulty": "senior",
        "employment_type": "full-time",
        "location": "New York",
        "salary_min": 120000,
        "salary_max": 170000,
        "is_remote": False,
        "company_name": "FinTech LLC"
    }
    headers = {"Authorization": "Bearer demo-admin-token"}
    response = await client.post("/api/v1/jobs", json=payload, headers=headers)
    assert response.status_code == 200
    job = response.json()
    assert "job_id" in job
    assert job["title"] == "Senior Python Developer"
    assert job["company_name"] == "FinTech LLC"
    assert job["created_by"] == "demo-admin@hirely.ai"
    
    job_id = job["job_id"]
    
    get_headers = {"Authorization": "Bearer demo-standard-token"}
    get_response = await client.get(f"/api/v1/jobs/{job_id}", headers=get_headers)
    assert get_response.status_code == 200
    assert get_response.json()["title"] == "Senior Python Developer"
    
    list_response = await client.get("/api/v1/jobs", headers=get_headers)
    assert list_response.status_code == 200
    list_data = list_response.json()
    assert list_data["total"] >= 1
    assert any(j["job_id"] == job_id for j in list_data["jobs"])
    
    search_response = await client.get("/api/v1/jobs?search=Senior", headers=get_headers)
    assert search_response.status_code == 200
    search_data = search_response.json()
    assert any(j["job_id"] == job_id for j in search_data["jobs"])


async def test_get_job_not_found(client):
    headers = {"Authorization": "Bearer demo-standard-token"}
    response = await client.get("/api/v1/jobs/non-existent-uuid-12345", headers=headers)
    assert response.status_code == 404
    assert "Job not found" in response.json()["detail"]


async def test_pipeline_hydrates_candidate_id_from_candidates_collection(client, admin_headers):
    """candidate_pipeline array entries are never written with their own
    candidate_id — create_candidate only ever $sets pipeline_stage on the
    matching array element (routes/candidates.py). Every candidate-scoped
    admin action in the pipeline UI (resend invite, regenerate token, offers,
    notes, cross-job history, coding assignment, scheduling, communication
    center) depends on GET .../pipeline resolving candidate_id here instead —
    without it, every one of those actions is permanently unreachable for
    every candidate, invited or not.
    """
    job_id = await _create_job(client, admin_headers)
    db = get_db()
    resume_id = "test-resume-" + uuid.uuid4().hex[:8]
    await db.resumes.insert_one({
        "resume_id": resume_id, "candidate_name": "Alex Kim", "candidate_email": "alex.kim@example.com",
    })
    await db.jobs.update_one(
        {"job_id": job_id},
        {"$push": {"candidate_pipeline": {
            "resume_id": resume_id, "similarity_score": 0.8, "pipeline_stage": "matched",
        }}},
    )

    resp = await client.get(f"/api/v1/jobs/{job_id}/pipeline", headers=admin_headers)
    assert resp.status_code == 200
    row = next(p for p in resp.json()["pipeline"] if p["resume_id"] == resume_id)
    assert row.get("candidate_id") is None

    create_resp = await client.post(
        "/api/v1/candidates",
        json={"job_id": job_id, "name": "Alex Kim", "email": "alex.kim@example.com", "resume_id": resume_id},
        headers=admin_headers,
    )
    assert create_resp.status_code == 200
    created = create_resp.json()

    resp2 = await client.get(f"/api/v1/jobs/{job_id}/pipeline", headers=admin_headers)
    row2 = next(p for p in resp2.json()["pipeline"] if p["resume_id"] == resume_id)
    assert row2["candidate_id"] == created["candidate_id"]
    assert row2["secure_token"] == created["secure_token"]
    assert row2["pipeline_stage"] == "invited"
