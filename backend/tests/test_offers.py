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


async def _create_candidate(client, headers, job_id, email="offer.candidate@example.com"):
    response = await client.post(
        "/api/v1/candidates",
        json={"job_id": job_id, "name": "Offer Candidate", "email": email},
        headers=headers,
    )
    assert response.status_code == 200
    return response.json()["candidate_id"]


OFFER_PAYLOAD = {
    "salary": "120000 USD/year",
    "benefits": "Health, dental, 401k",
    "joining_date": "2026-09-01",
}


async def test_create_offer_requires_admin(client, standard_headers, admin_headers):
    job_id = await _create_job(client, admin_headers)
    candidate_id = await _create_candidate(client, admin_headers, job_id, email="perm.check@example.com")

    response = await client.post(
        "/api/v1/offers",
        json={"candidate_id": candidate_id, **OFFER_PAYLOAD},
        headers=standard_headers,
    )
    assert response.status_code == 403


async def test_create_offer_unknown_candidate(client, admin_headers):
    response = await client.post(
        "/api/v1/offers",
        json={"candidate_id": "non-existent-candidate-id", **OFFER_PAYLOAD},
        headers=admin_headers,
    )
    assert response.status_code == 404


async def test_get_offer_not_found(client, standard_headers):
    response = await client.get("/api/v1/offers/non-existent-offer-id", headers=standard_headers)
    assert response.status_code == 404


async def test_public_offer_unknown_token(client):
    response = await client.get("/api/v1/offers/public/tok_doesnotexist")
    assert response.status_code == 404


async def test_approve_offer_twice_fails(client, admin_headers):
    job_id = await _create_job(client, admin_headers)
    candidate_id = await _create_candidate(client, admin_headers, job_id, email="approve.twice@example.com")

    create_resp = await client.post(
        "/api/v1/offers",
        json={"candidate_id": candidate_id, **OFFER_PAYLOAD},
        headers=admin_headers,
    )
    assert create_resp.status_code == 200
    offer_id = create_resp.json()["offer_id"]

    first_approve = await client.post(f"/api/v1/offers/{offer_id}/approve", headers=admin_headers)
    assert first_approve.status_code == 200
    assert first_approve.json()["status"] == "approved"

    second_approve = await client.post(f"/api/v1/offers/{offer_id}/approve", headers=admin_headers)
    assert second_approve.status_code == 400


async def test_offer_full_lifecycle(client, admin_headers, standard_headers):
    job_id = await _create_job(client, admin_headers)
    candidate_id = await _create_candidate(client, admin_headers, job_id, email="lifecycle@example.com")

    create_resp = await client.post(
        "/api/v1/offers",
        json={"candidate_id": candidate_id, **OFFER_PAYLOAD},
        headers=admin_headers,
    )
    assert create_resp.status_code == 200
    offer = create_resp.json()
    offer_id = offer["offer_id"]
    secure_token = offer["secure_token"]
    assert offer["status"] == "draft"

    list_resp = await client.get(
        "/api/v1/offers", params={"candidate_id": candidate_id}, headers=standard_headers
    )
    assert list_resp.status_code == 200
    assert any(o["offer_id"] == offer_id for o in list_resp.json()["offers"])

    get_resp = await client.get(f"/api/v1/offers/{offer_id}", headers=standard_headers)
    assert get_resp.status_code == 200
    assert get_resp.json()["candidate_id"] == candidate_id

    approve_resp = await client.post(f"/api/v1/offers/{offer_id}/approve", headers=admin_headers)
    assert approve_resp.status_code == 200
    assert approve_resp.json()["status"] == "approved"

    send_resp = await client.post(f"/api/v1/offers/{offer_id}/send", headers=admin_headers)
    assert send_resp.status_code == 200
    assert send_resp.json()["status"] == "sent"
    assert send_resp.json()["sent_at"] is not None

    public_resp = await client.get(f"/api/v1/offers/public/{secure_token}")
    assert public_resp.status_code == 200
    public_data = public_resp.json()
    assert public_data["status"] == "sent"
    assert public_data["job_title"] == JOB_PAYLOAD["title"]
    assert public_data["salary"] == OFFER_PAYLOAD["salary"]

    accept_resp = await client.post(f"/api/v1/offers/public/{secure_token}/accept")
    assert accept_resp.status_code == 200
    assert accept_resp.json()["status"] == "accepted"

    public_after_resp = await client.get(f"/api/v1/offers/public/{secure_token}")
    assert public_after_resp.status_code == 410
