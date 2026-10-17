import uuid

import pytest

from config.database import get_db

pytestmark = pytest.mark.anyio


@pytest.fixture
async def job_id():
    db = get_db()
    jid = f"truth-job-{uuid.uuid4().hex[:10]}"
    await db.jobs.insert_one({"doc_type": "job", "job_id": jid, "title": "Ops Lead", "candidate_pipeline": []})
    yield jid
    await db.candidates.delete_many({"job_id": jid})
    await db.jobs.delete_one({"job_id": jid})


def _fake_send(result: bool):
    async def fake(*, candidate, admin_email):
        return result
    return fake


async def _create(client, admin_headers, job_id, name="Ivy Truth"):
    return await client.post(
        "/api/v1/candidates",
        headers=admin_headers,
        json={"job_id": job_id, "name": name, "email": f"{uuid.uuid4().hex[:8]}@truth.example.com"},
    )


async def test_create_invite_reports_a_delivered_email(client, admin_headers, job_id, monkeypatch):
    monkeypatch.setattr("services.hr_module.invite_service.send_manual_invite", _fake_send(True))
    r = await _create(client, admin_headers, job_id)
    assert r.status_code == 200, r.text
    assert r.json()["email_sent"] is True


async def test_create_invite_reports_an_email_that_did_not_go_out(client, admin_headers, job_id, monkeypatch):
    monkeypatch.setattr("services.hr_module.invite_service.send_manual_invite", _fake_send(False))
    r = await _create(client, admin_headers, job_id)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["email_sent"] is False
    assert body["secure_token"], "the link still works, so HR can share it by hand"
    stored = await get_db().candidates.find_one({"candidate_id": body["candidate_id"]})
    assert stored["invite_email_delivered"] is False


async def test_regenerate_token_does_not_claim_a_resend_that_failed(client, admin_headers, job_id, monkeypatch):
    monkeypatch.setattr("services.hr_module.invite_service.send_manual_invite", _fake_send(True))
    cid = (await _create(client, admin_headers, job_id, "Ray Regen")).json()["candidate_id"]

    monkeypatch.setattr("services.hr_module.invite_service.send_manual_invite", _fake_send(False))
    failed = await client.post(f"/api/v1/candidates/{cid}/regenerate-token", headers=admin_headers, json={"resend": True})
    assert failed.status_code == 200, failed.text
    assert failed.json()["email_resent"] is False

    monkeypatch.setattr("services.hr_module.invite_service.send_manual_invite", _fake_send(True))
    worked = await client.post(f"/api/v1/candidates/{cid}/regenerate-token", headers=admin_headers, json={"resend": True})
    assert worked.json()["email_resent"] is True

    skipped = await client.post(f"/api/v1/candidates/{cid}/regenerate-token", headers=admin_headers, json={"resend": False})
    assert skipped.json()["email_resent"] is False


async def test_an_offer_whose_email_could_not_be_sent_stays_approved(client, admin_headers, job_id, monkeypatch):
    from services.hr_module import email_service

    monkeypatch.setattr("services.hr_module.invite_service.send_manual_invite", _fake_send(True))
    cid = (await _create(client, admin_headers, job_id, "Olive Offer")).json()["candidate_id"]
    offer_id = (await client.post(
        "/api/v1/offers", json={"candidate_id": cid, "salary": "100000 USD/year"}, headers=admin_headers,
    )).json()["offer_id"]
    assert (await client.post(f"/api/v1/offers/{offer_id}/approve", headers=admin_headers)).status_code == 200

    async def failing(**kwargs):
        return False

    monkeypatch.setattr(email_service, "send_offer_letter_email", failing)
    refused = await client.post(f"/api/v1/offers/{offer_id}/send", headers=admin_headers)
    assert refused.status_code == 502, refused.text
    assert "could not be sent" in refused.json()["detail"]
    stored = await get_db().offers.find_one({"offer_id": offer_id})
    assert stored["status"] == "approved" and not stored.get("sent_at")

    async def working(**kwargs):
        return True

    monkeypatch.setattr(email_service, "send_offer_letter_email", working)
    sent = await client.post(f"/api/v1/offers/{offer_id}/send", headers=admin_headers)
    assert sent.status_code == 200, sent.text
    assert sent.json()["status"] == "sent"
    await get_db().offers.delete_one({"offer_id": offer_id})
