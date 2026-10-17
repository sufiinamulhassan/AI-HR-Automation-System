import pytest

from config.database import get_db
from services.hr_module import email_service

pytestmark = pytest.mark.anyio


@pytest.fixture
def mail(monkeypatch):
    state = {"sent": [], "result": True}

    async def fake_send_email(**kwargs):
        state["sent"].append(kwargs)
        return state["result"]

    monkeypatch.setattr(email_service, "send_email", fake_send_email)
    return state


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


async def test_candidate_lifecycle(client, admin_headers, standard_headers, mail):
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
    assert resend_resp.json()["resent_count"] == 1
    assert [c["to"] for c in mail["sent"]].count("jane.doe@example.com") >= 2

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


@pytest.fixture
async def created_candidates():
    ids: list[str] = []
    yield ids
    db = get_db()
    for candidate_id in ids:
        await db.candidates.delete_one({"candidate_id": candidate_id})


async def _create_candidate(client, headers, job_id, email, created):
    resp = await client.post(
        "/api/v1/candidates",
        json={"job_id": job_id, "name": "Resend Probe", "email": email},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    created.append(resp.json()["candidate_id"])
    return resp.json()["candidate_id"]


async def test_create_candidate_records_whether_the_invite_was_delivered(client, admin_headers, mail, created_candidates):
    db = get_db()
    job_id = await _create_job(client, admin_headers)

    delivered_id = await _create_candidate(
        client, admin_headers, job_id, "delivered.probe@example.com", created_candidates,
    )
    mail["result"] = False
    failed_id = await _create_candidate(
        client, admin_headers, job_id, "undelivered.probe@example.com", created_candidates,
    )

    assert (await db.candidates.find_one({"candidate_id": delivered_id}))["invite_email_delivered"] is True
    assert (await db.candidates.find_one({"candidate_id": failed_id}))["invite_email_delivered"] is False


async def test_resend_invite_reports_a_failed_send_and_changes_nothing(client, admin_headers, mail, created_candidates):
    db = get_db()
    job_id = await _create_job(client, admin_headers)
    candidate_id = await _create_candidate(
        client, admin_headers, job_id, "resend.fail@example.com", created_candidates,
    )
    before = await db.candidates.find_one({"candidate_id": candidate_id})

    mail["result"] = False
    mail["sent"].clear()
    resp = await client.post(f"/api/v1/candidates/{candidate_id}/resend-invite", headers=admin_headers)

    assert resp.status_code == 502
    assert resp.json()["detail"] == "The invite email could not be sent. Check Email Delivery in Platform Settings."
    assert len(mail["sent"]) == 1, "the send was attempted exactly once"

    after = await db.candidates.find_one({"candidate_id": candidate_id})
    assert after["invite_resent_count"] == before["invite_resent_count"] == 0
    assert after.get("last_resent_at") is None
    assert after.get("last_resent_by") is None
    assert after["invite_email_delivered"] is True


async def test_resend_invite_success_counts_and_marks_the_invite_delivered(client, admin_headers, mail, created_candidates):
    db = get_db()
    job_id = await _create_job(client, admin_headers)
    mail["result"] = False
    candidate_id = await _create_candidate(
        client, admin_headers, job_id, "resend.ok@example.com", created_candidates,
    )
    assert (await db.candidates.find_one({"candidate_id": candidate_id}))["invite_email_delivered"] is False

    mail["result"] = True
    resp = await client.post(f"/api/v1/candidates/{candidate_id}/resend-invite", headers=admin_headers)

    assert resp.status_code == 200
    assert resp.json()["resent_count"] == 1
    stored = await db.candidates.find_one({"candidate_id": candidate_id})
    assert stored["invite_resent_count"] == 1
    assert stored["last_resent_by"] == "demo-admin@hirely.ai"
    assert stored["invite_email_delivered"] is True


async def test_get_candidate_not_found(client, standard_headers):
    response = await client.get(
        "/api/v1/candidates/non-existent-candidate-id",
        headers=standard_headers,
    )
    assert response.status_code == 404
