import pytest

from services.hr_module.offer_service import offer_terms_hash

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
    "company_name": "Signature Test Corp",
}

OFFER_PAYLOAD = {
    "salary": "125000 USD/year",
    "benefits": "Health, dental",
    "joining_date": "2026-11-01",
}


async def _create_job(client, headers):
    response = await client.post("/api/v1/jobs", json=JOB_PAYLOAD, headers=headers)
    assert response.status_code == 200
    return response.json()["job_id"]


async def _create_candidate(client, headers, job_id, email):
    response = await client.post(
        "/api/v1/candidates",
        json={"job_id": job_id, "name": "Signature Candidate", "email": email},
        headers=headers,
    )
    assert response.status_code == 200
    return response.json()["candidate_id"]


async def _create_sent_offer(client, admin_headers, email_suffix):
    job_id = await _create_job(client, admin_headers)
    candidate_id = await _create_candidate(client, admin_headers, job_id, f"sign.{email_suffix}@example.com")
    create_resp = await client.post(
        "/api/v1/offers",
        json={"candidate_id": candidate_id, **OFFER_PAYLOAD},
        headers=admin_headers,
    )
    assert create_resp.status_code == 200
    offer = create_resp.json()
    offer_id, secure_token = offer["offer_id"], offer["secure_token"]

    assert (await client.post(f"/api/v1/offers/{offer_id}/approve", headers=admin_headers)).status_code == 200
    assert (await client.post(f"/api/v1/offers/{offer_id}/send", headers=admin_headers)).status_code == 200
    return offer_id, secure_token


async def test_accept_without_consent_rejected(client, admin_headers):
    offer_id, token = await _create_sent_offer(client, admin_headers, "noconsent")
    resp = await client.post(
        f"/api/v1/offers/public/{token}/accept", json={"typed_name": "Jane Doe"},
    )
    assert resp.status_code == 400

    still_sent = await client.get(f"/api/v1/offers/{offer_id}", headers=admin_headers)
    assert still_sent.json()["status"] == "sent"


async def test_accept_with_consent_explicitly_false_rejected(client, admin_headers):
    offer_id, token = await _create_sent_offer(client, admin_headers, "consentfalse")
    resp = await client.post(
        f"/api/v1/offers/public/{token}/accept",
        json={"typed_name": "Jane Doe", "consent": False},
    )
    assert resp.status_code == 400


async def test_accept_without_typed_name_rejected(client, admin_headers):
    offer_id, token = await _create_sent_offer(client, admin_headers, "notypedname")
    resp = await client.post(
        f"/api/v1/offers/public/{token}/accept", json={"consent": True},
    )
    assert resp.status_code == 400


async def test_accept_with_blank_typed_name_rejected(client, admin_headers):
    offer_id, token = await _create_sent_offer(client, admin_headers, "blanktypedname")
    resp = await client.post(
        f"/api/v1/offers/public/{token}/accept",
        json={"typed_name": "   ", "consent": True},
    )
    assert resp.status_code == 400


async def test_accept_with_no_body_at_all_rejected(client, admin_headers):
    offer_id, token = await _create_sent_offer(client, admin_headers, "nobody")
    resp = await client.post(f"/api/v1/offers/public/{token}/accept")
    assert resp.status_code == 400


async def test_successful_accept_produces_complete_signature(client, admin_headers):
    offer_id, token = await _create_sent_offer(client, admin_headers, "success")

    resp = await client.post(
        f"/api/v1/offers/public/{token}/accept",
        json={"typed_name": "  Jane Q. Doe  ", "consent": True},
        headers={"User-Agent": "pytest-esign-agent/1.0"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "accepted"
    assert "signature" not in body

    admin_view = await client.get(f"/api/v1/offers/{offer_id}", headers=admin_headers)
    assert admin_view.status_code == 200
    offer = admin_view.json()
    signature = offer["signature"]

    assert signature["typed_name"] == "Jane Q. Doe"
    assert signature["consented"] is True
    assert signature["ip_address"]
    assert signature["user_agent"] == "pytest-esign-agent/1.0"
    assert signature["signed_at"]
    assert isinstance(signature["document_hash"], str) and len(signature["document_hash"]) == 64

    assert offer_terms_hash(offer) == signature["document_hash"]
    assert offer_terms_hash(offer) == offer_terms_hash(offer)


async def test_decline_works_with_no_signature_fields(client, admin_headers):
    offer_id, token = await _create_sent_offer(client, admin_headers, "decline")

    resp = await client.post(f"/api/v1/offers/public/{token}/decline")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "declined"
    assert "signature" not in body

    admin_view = await client.get(f"/api/v1/offers/{offer_id}", headers=admin_headers)
    assert "signature" not in admin_view.json()


async def test_decline_with_reason_still_no_signature_required(client, admin_headers):
    offer_id, token = await _create_sent_offer(client, admin_headers, "declinereason")

    resp = await client.post(
        f"/api/v1/offers/public/{token}/decline", json={"reason": "Accepted a different offer"},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "declined"

    admin_view = await client.get(f"/api/v1/offers/{offer_id}", headers=admin_headers)
    admin_offer = admin_view.json()
    assert admin_offer["decline_reason"] == "Accepted a different offer"
    assert "signature" not in admin_offer


async def test_public_offer_summary_never_includes_signature(client, admin_headers):
    _, token = await _create_sent_offer(client, admin_headers, "publicsummary")
    resp = await client.get(f"/api/v1/offers/public/{token}")
    assert resp.status_code == 200
    data = resp.json()
    assert "signature" not in data
    assert "ip_address" not in data


async def test_signature_never_leaks_on_public_accept_response(client, admin_headers):
    offer_id, token = await _create_sent_offer(client, admin_headers, "leakcheck")
    resp = await client.post(
        f"/api/v1/offers/public/{token}/accept",
        json={"typed_name": "No Leak Test", "consent": True},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert "signature" not in body
    assert "ip_address" not in body

    admin_view = await client.get(f"/api/v1/offers/{offer_id}", headers=admin_headers)
    assert admin_view.json()["signature"]["ip_address"]
