import pytest

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


async def test_create_candidate_requires_admin(client, standard_headers):
    response = await client.post(
        "/api/v1/candidates",
        json={
            "job_id": "any-job",
            "name": "Jane Doe",
            "email": "jane@example.com",
        },
        headers=standard_headers,
    )
    assert response.status_code == 403


async def test_create_candidate_job_not_found(client, admin_headers):
    response = await client.post(
        "/api/v1/candidates",
        json={
            "job_id": "non-existent-job-id",
            "name": "Jane Doe",
            "email": "jane@example.com",
        },
        headers=admin_headers,
    )
    assert response.status_code == 404
    assert "Job not found" in response.json()["detail"]


async def test_candidate_lifecycle(client, admin_headers, standard_headers):
    job_id = await _create_job(client, admin_headers)

    create_resp = await client.post(
        "/api/v1/candidates",
        json={
            "job_id": job_id,
            "name": "Jane Doe",
            "email": "jane.doe@example.com",
        },
        headers=admin_headers,
    )
    assert create_resp.status_code == 200
    created = create_resp.json()
    assert "candidate_id" in created
    assert created["invite_type"] == "manual"
    assert "interview_url" in created

    candidate_id = created["candidate_id"]
    secure_token = created["secure_token"]

    list_resp = await client.get("/api/v1/candidates", headers=standard_headers)
    assert list_resp.status_code == 200
    list_data = list_resp.json()
    assert list_data["total"] >= 1
    assert any(c["candidate_id"] == candidate_id for c in list_data["candidates"])

    get_resp = await client.get(
        f"/api/v1/candidates/{candidate_id}",
        headers=standard_headers,
    )
    assert get_resp.status_code == 200
    assert get_resp.json()["email"] == "jane.doe@example.com"

    resend_resp = await client.post(
        f"/api/v1/candidates/{candidate_id}/resend-invite",
        headers=admin_headers,
    )
    assert resend_resp.status_code == 200
    assert resend_resp.json()["sent_to"] == "jane.doe@example.com"

    regen_resp = await client.post(
        f"/api/v1/candidates/{candidate_id}/regenerate-token",
        json={"resend": False},
        headers=admin_headers,
    )
    assert regen_resp.status_code == 200
    assert regen_resp.json()["secure_token"] != secure_token

    decision_resp = await client.post(
        f"/api/v1/candidates/{candidate_id}/decision",
        json={"decision": "hold", "notes": "Needs review"},
        headers=admin_headers,
    )
    assert decision_resp.status_code == 200
    assert decision_resp.json()["stage"] == "completed"


async def test_get_candidate_not_found(client, standard_headers):
    response = await client.get(
        "/api/v1/candidates/non-existent-candidate-id",
        headers=standard_headers,
    )
    assert response.status_code == 404
