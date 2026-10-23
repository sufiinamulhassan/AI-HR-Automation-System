import uuid

import pytest

import config.llm as llm_module
from services.hr_module import offer_service
from shared.utils import EM_DASH

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
    "company_name": "AI Letter Test Corp",
}

OFFER_PAYLOAD = {
    "salary": "140000 USD/year",
    "benefits": "Health, dental",
    "joining_date": "2026-12-01",
}


async def _create_job(client, headers):
    response = await client.post("/api/v1/jobs", json=JOB_PAYLOAD, headers=headers)
    assert response.status_code == 200
    return response.json()["job_id"]


async def _create_candidate(client, headers, job_id, email):
    response = await client.post(
        "/api/v1/candidates",
        json={"job_id": job_id, "name": "AI Letter Candidate", "email": email},
        headers=headers,
    )
    assert response.status_code == 200
    return response.json()["candidate_id"]


async def _create_offer(client, admin_headers, email_suffix):
    job_id = await _create_job(client, admin_headers)
    candidate_id = await _create_candidate(client, admin_headers, job_id, f"ailetter.{email_suffix}@example.com")
    resp = await client.post(
        "/api/v1/offers",
        json={"candidate_id": candidate_id, **OFFER_PAYLOAD},
        headers=admin_headers,
    )
    assert resp.status_code == 200
    return resp.json()["offer_id"]


def _fake_ask_llm(responses: list[str]):
    calls = {"n": 0}

    async def _fake(prompt, system, model=None, max_tokens=300, temperature=0.6, **kwargs):
        i = min(calls["n"], len(responses) - 1)
        calls["n"] += 1
        return responses[i]

    _fake.calls = calls
    return _fake


async def test_em_dash_is_detected():
    assert offer_service._contains_ai_writing_tell(f"We are thrilled {EM_DASH} truly excited.") is True


async def test_double_hyphen_is_detected():
    assert offer_service._contains_ai_writing_tell("We are thrilled -- truly excited.") is True


async def test_blocklisted_phrase_is_detected():
    assert offer_service._contains_ai_writing_tell("Furthermore, we look forward to your start date.") is True


async def test_not_only_but_also_construction_is_detected():
    assert offer_service._contains_ai_writing_tell("You will not only grow here but also thrive.") is True


async def test_empty_text_is_treated_as_a_failure():
    assert offer_service._contains_ai_writing_tell("") is True
    assert offer_service._contains_ai_writing_tell("   ") is True


async def test_clean_text_passes():
    clean = "We are glad you are joining us. The team is looking forward to working with you."
    assert offer_service._contains_ai_writing_tell(clean) is False


@pytest.fixture
async def ai_letter_offer(client, admin_headers):
    offer_id = await _create_offer(client, admin_headers, uuid.uuid4().hex[:8])
    yield offer_id


async def test_em_dash_llm_response_never_reaches_the_final_letter(monkeypatch, ai_letter_offer):
    offending_text = f"We are so excited to have you {EM_DASH} you will do great things here."
    fake = _fake_ask_llm([offending_text, offending_text])
    monkeypatch.setattr(llm_module, "ask_llm", fake)

    updated = await offer_service.generate_offer_letter_body(ai_letter_offer)

    assert EM_DASH not in updated["ai_letter_body"]
    assert "--" not in updated["ai_letter_body"]
    assert updated["ai_letter_body"] == offer_service._FALLBACK_LETTER_BODY
    assert updated["ai_letter_source"] == "template_fallback"
    assert updated["ai_letter_approved"] is False
    assert fake.calls["n"] == 2


async def test_llm_response_with_blocklisted_phrase_also_falls_back(monkeypatch, ai_letter_offer):
    offending_text = "Moreover, we are confident you will excel in this role."
    fake = _fake_ask_llm([offending_text, offending_text])
    monkeypatch.setattr(llm_module, "ask_llm", fake)

    updated = await offer_service.generate_offer_letter_body(ai_letter_offer)
    assert updated["ai_letter_body"] == offer_service._FALLBACK_LETTER_BODY
    assert updated["ai_letter_source"] == "template_fallback"


async def test_bad_first_attempt_then_clean_regeneration_is_used(monkeypatch, ai_letter_offer):
    bad = f"We are thrilled {EM_DASH} welcome aboard."
    clean = "We are glad to welcome you. The team is excited to start working with you."
    fake = _fake_ask_llm([bad, clean])
    monkeypatch.setattr(llm_module, "ask_llm", fake)

    updated = await offer_service.generate_offer_letter_body(ai_letter_offer)
    assert updated["ai_letter_body"] == clean
    assert updated["ai_letter_source"] == "ai"
    assert fake.calls["n"] == 2


async def test_clean_first_attempt_is_used_without_regenerating(monkeypatch, ai_letter_offer):
    clean = "We are delighted you are joining the team. We can't wait to get started together."
    fake = _fake_ask_llm([clean])
    monkeypatch.setattr(llm_module, "ask_llm", fake)

    updated = await offer_service.generate_offer_letter_body(ai_letter_offer)
    assert updated["ai_letter_body"] == clean
    assert updated["ai_letter_source"] == "ai"
    assert fake.calls["n"] == 1


async def test_regenerating_resets_previous_approval(monkeypatch, ai_letter_offer):
    clean = "We are glad to welcome you. The whole team is looking forward to it."
    fake = _fake_ask_llm([clean])
    monkeypatch.setattr(llm_module, "ask_llm", fake)

    await offer_service.generate_offer_letter_body(ai_letter_offer)
    await offer_service.approve_offer_letter(ai_letter_offer, approved_by="admin@test.com")
    approved = await offer_service.get_offer(ai_letter_offer)
    assert approved["ai_letter_approved"] is True

    await offer_service.generate_offer_letter_body(ai_letter_offer)
    regenerated = await offer_service.get_offer(ai_letter_offer)
    assert regenerated["ai_letter_approved"] is False
    assert regenerated["ai_letter_approved_by"] is None


async def test_generate_unknown_offer_raises_not_found():
    with pytest.raises(ValueError, match="not_found"):
        await offer_service.generate_offer_letter_body(f"no-such-offer-{uuid.uuid4().hex[:8]}")


async def test_approve_letter_without_a_draft_raises(ai_letter_offer):
    with pytest.raises(ValueError):
        await offer_service.approve_offer_letter(ai_letter_offer, approved_by="admin@test.com")


async def test_send_blocked_while_ai_letter_body_unapproved(client, admin_headers, monkeypatch):
    offer_id = await _create_offer(client, admin_headers, "gateblock")
    clean = "We are glad to welcome you. The team is looking forward to working with you."
    monkeypatch.setattr(llm_module, "ask_llm", _fake_ask_llm([clean]))

    approve_resp = await client.post(f"/api/v1/offers/{offer_id}/approve", headers=admin_headers)
    assert approve_resp.status_code == 200

    draft_resp = await client.post(f"/api/v1/offers/{offer_id}/draft-letter", headers=admin_headers)
    assert draft_resp.status_code == 200
    assert draft_resp.json()["ai_letter_approved"] is False

    send_resp = await client.post(f"/api/v1/offers/{offer_id}/send", headers=admin_headers)
    assert send_resp.status_code == 400
    assert "approved" in send_resp.json()["detail"].lower()

    offer = await client.get(f"/api/v1/offers/{offer_id}", headers=admin_headers)
    assert offer.json()["status"] == "approved"


async def test_send_succeeds_once_ai_letter_is_also_approved(client, admin_headers, monkeypatch):
    offer_id = await _create_offer(client, admin_headers, "gatepass")
    clean = "We are glad to welcome you. The team is looking forward to working with you."
    monkeypatch.setattr(llm_module, "ask_llm", _fake_ask_llm([clean]))

    await client.post(f"/api/v1/offers/{offer_id}/approve", headers=admin_headers)
    await client.post(f"/api/v1/offers/{offer_id}/draft-letter", headers=admin_headers)

    approve_letter_resp = await client.post(f"/api/v1/offers/{offer_id}/approve-letter", headers=admin_headers)
    assert approve_letter_resp.status_code == 200
    assert approve_letter_resp.json()["ai_letter_approved"] is True

    send_resp = await client.post(f"/api/v1/offers/{offer_id}/send", headers=admin_headers)
    assert send_resp.status_code == 200
    assert send_resp.json()["status"] == "sent"


async def test_send_unaffected_when_ai_letter_feature_never_used(client, admin_headers):
    offer_id = await _create_offer(client, admin_headers, "nofeature")
    await client.post(f"/api/v1/offers/{offer_id}/approve", headers=admin_headers)
    send_resp = await client.post(f"/api/v1/offers/{offer_id}/send", headers=admin_headers)
    assert send_resp.status_code == 200
    assert send_resp.json()["status"] == "sent"


async def test_draft_letter_requires_admin(client, standard_headers, ai_letter_offer):
    resp = await client.post(f"/api/v1/offers/{ai_letter_offer}/draft-letter", headers=standard_headers)
    assert resp.status_code == 403


async def test_draft_letter_unknown_offer_404(client, admin_headers):
    resp = await client.post(
        f"/api/v1/offers/no-such-offer-{uuid.uuid4().hex[:8]}/draft-letter", headers=admin_headers,
    )
    assert resp.status_code == 404


async def test_approve_letter_requires_admin(client, standard_headers, ai_letter_offer):
    resp = await client.post(f"/api/v1/offers/{ai_letter_offer}/approve-letter", headers=standard_headers)
    assert resp.status_code == 403
