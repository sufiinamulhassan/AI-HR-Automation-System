import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from config.database import get_db
from services.hr_module import email_service, lifecycle_events, offer_service, webhook_service

from test_interview_scorecard import _own_ip_bucket, hr_body, llm, mint, put_link, seed

pytestmark = pytest.mark.anyio

FORBIDDEN_KEYS = {
    "email", "phone", "score", "final_score", "eval_score", "report", "recommendation", "summary",
    "strengths", "concerns", "ratings", "salary", "benefits", "join_url", "secure_token", "token",
    "decline_reason", "notes", "transcript",
}


@pytest.fixture
def events(monkeypatch):
    seen: list[tuple[str, dict]] = []

    async def fake_emit(event, payload=None):
        seen.append((event, dict(payload or {})))

    monkeypatch.setattr(lifecycle_events, "emit_event", fake_emit)
    monkeypatch.setattr(webhook_service, "emit_event", fake_emit)
    return seen


@pytest.fixture
def mail(monkeypatch):
    sent: list[dict] = []

    async def fake_send_email(**kwargs):
        sent.append(kwargs)
        return True

    monkeypatch.setattr(email_service, "send_email", fake_send_email)

    async def fake_offer_email(**kwargs):
        sent.append(kwargs)
        return True

    monkeypatch.setattr(email_service, "send_offer_letter_email", fake_offer_email)
    return sent


def _clean(payload: dict) -> None:
    assert not (set(payload) & FORBIDDEN_KEYS), set(payload) & FORBIDDEN_KEYS
    assert "@" not in json.dumps(payload, default=str), "an email address leaked into a webhook payload"


def _of(events, name):
    return [p for e, p in events if e == name]


async def test_the_builders_carry_ids_names_and_the_stage_only(events):
    await lifecycle_events.announce_candidate_invited(candidate_id="c1", name="Asha Rao", job_id="j1", invite_type="manual")
    await lifecycle_events.announce_stage_change(candidate_id="c1", name="Asha Rao", job_id="j1", stage="hired", decision="hire")
    await lifecycle_events.announce_stage_change(candidate_id="c1", name="Asha Rao", job_id="j1", stage="rejected", decision="reject")
    await lifecycle_events.announce_stage_change(candidate_id="c1", name="Asha Rao", job_id="j1", stage="completed", decision="hold")
    await lifecycle_events.announce_interview_completed(candidate_id="c1", name="Asha Rao", job_id="j1")
    await lifecycle_events.announce_external_scheduled(
        candidate_id="c1", name="Asha Rao", job_id="j1", platform_label="Zoom", scheduled_start_at="2026-12-01T10:00:00+00:00",
    )
    await lifecycle_events.announce_scorecard_submitted(candidate_id="c1", name="Asha Rao", job_id="j1", scorecard_id="s1")

    assert [e for e, _ in events] == [
        "candidate.invited",
        "candidate.status_changed", "candidate.hired",
        "candidate.status_changed", "candidate.rejected",
        "candidate.status_changed",
        "interview.completed", "interview.external_scheduled", "scorecard.submitted",
    ]
    for _, payload in events:
        _clean(payload)
        assert payload["candidate_id"] == "c1" and payload["candidate_name"] == "Asha Rao" and payload["job_id"] == "j1"
    assert _of(events, "candidate.hired")[0]["stage"] == "hired"
    assert _of(events, "interview.external_scheduled")[0]["platform"] == "Zoom"


async def test_every_announced_event_is_in_the_catalog():
    import re
    from pathlib import Path

    backend = Path(__file__).resolve().parent.parent
    announced = set(re.findall(r'(?:_safe_emit|emit_event|_announce_offer)\(\s*"([a-z_]+\.[a-z_]+)"', (backend / "services/hr_module/lifecycle_events.py").read_text(encoding="utf-8")))
    for path in ("services/hr_module/offer_service.py", "routes/jobs.py"):
        announced |= set(re.findall(r'(?:emit_event|_announce_offer)\(\s*"([a-z_]+\.[a-z_]+)"', (backend / path).read_text(encoding="utf-8")))
    assert announced, "found no announcements to check"
    assert announced <= webhook_service.EVENT_TYPE_KEYS, announced - webhook_service.EVENT_TYPE_KEYS


JOB_PAYLOAD = {
    "title": "Webhook Test Engineer", "description": "Build things.", "difficulty": "mid",
    "employment_type": "full-time", "location": "Remote", "is_remote": True, "company_name": "Hook Corp",
}


async def test_creating_a_job_announces_job_created(client, admin_headers, events):
    response = await client.post("/api/v1/jobs", json=JOB_PAYLOAD, headers=admin_headers)
    assert response.status_code == 200
    job_id = response.json()["job_id"]
    try:
        assert events[-1] == ("job.created", {"job_id": job_id, "title": "Webhook Test Engineer"})
    finally:
        await get_db().jobs.delete_one({"job_id": job_id})


async def test_inviting_a_candidate_announces_candidate_invited(client, admin_headers, events, mail):
    job = await client.post("/api/v1/jobs", json=JOB_PAYLOAD, headers=admin_headers)
    job_id = job.json()["job_id"]
    cid = None
    try:
        response = await client.post(
            "/api/v1/candidates", json={"job_id": job_id, "name": "Invited Person", "email": "invited.person@example.com"},
            headers=admin_headers,
        )
        assert response.status_code == 200
        cid = response.json()["candidate_id"]
        payload = _of(events, "candidate.invited")[0]
        assert payload == {
            "candidate_id": cid, "candidate_name": "Invited Person", "job_id": job_id,
            "stage": "invited", "invite_type": "manual",
        }
        _clean(payload)
    finally:
        await get_db().jobs.delete_one({"job_id": job_id})
        if cid:
            await get_db().candidates.delete_one({"candidate_id": cid})
            await get_db().email_log.delete_many({"candidate_id": cid})
            await get_db().candidate_profiles.delete_many({"email": "invited.person@example.com"})


@pytest.mark.parametrize("decision,stage,expected", [
    ("hire", "hired", ["candidate.status_changed", "candidate.hired"]),
    ("reject", "rejected", ["candidate.status_changed", "candidate.rejected"]),
    ("hold", "completed", ["candidate.status_changed"]),
])
async def test_a_decision_announces_the_new_stage(client, admin_headers, seed, events, mail, decision, stage, expected):
    cand = await seed.candidate(mode="platform", stage="completed")
    response = await client.post(
        f"/api/v1/candidates/{cand.id}/decision", json={"decision": decision}, headers=admin_headers,
    )
    assert response.status_code == 200, response.text
    assert [e for e, _ in events if e.startswith("candidate.")] == expected
    for _, payload in events:
        _clean(payload)
        assert payload["candidate_id"] == cand.id and payload["stage"] == stage and payload["decision"] == decision
        assert payload["job_id"] == cand.job_id


async def test_submitting_the_ai_interview_announces_interview_completed(client, seed, events):
    cand = await seed.candidate(mode="platform", stage="interviewing", token_status="active",
                                invite_sent_at=datetime.now(timezone.utc).isoformat())
    response = await client.post(
        f"/api/v1/interview/session/{cand.token}/submit", json={"transcript": [], "flags": []},
    )
    assert response.status_code == 200
    payload = _of(events, "interview.completed")[0]
    assert payload["candidate_id"] == cand.id and payload["stage"] == "completed"
    _clean(payload)
    assert [p["stage"] for p in _of(events, "candidate.status_changed")] == ["completed"]


async def test_scheduling_on_another_platform_announces_it_without_the_link(client, admin_headers, seed, events, mail):
    cand = await seed.candidate(mode="platform", stage="matched", token_status="active")
    start = (datetime.now(timezone.utc) + timedelta(days=3)).isoformat()
    response = await client.post(
        "/api/v1/candidates/external-interview",
        json={
            "candidate_id": cand.id, "platform": "zoom", "join_url": "https://us06web.zoom.us/j/123456789?pwd=abc",
            "scheduled_start_at": start, "send_email": False,
        },
        headers=admin_headers,
    )
    assert response.status_code == 200, response.text
    payload = _of(events, "interview.external_scheduled")[0]
    assert payload["candidate_id"] == cand.id and payload["platform"] == "Zoom"
    assert payload["stage"] == "interviewing" and payload["scheduled_start_at"]
    _clean(payload)
    assert "zoom.us" not in json.dumps(payload)
    assert [p["stage"] for p in _of(events, "candidate.status_changed")] == ["interviewing"]


async def test_an_hr_review_announces_the_scorecard_and_the_new_stage(client, admin_headers, seed, events):
    cand = await seed.candidate(mode="external", stage="interviewing")
    response = await client.post(
        f"/api/v1/candidates/{cand.id}/external-review", json=hr_body(), headers=admin_headers,
    )
    assert response.status_code == 200, response.text
    scorecard = _of(events, "scorecard.submitted")[0]
    stage = _of(events, "candidate.status_changed")[0]
    assert scorecard["candidate_id"] == cand.id and scorecard["scorecard_id"] and scorecard["stage"] == "completed"
    assert stage["stage"] == "completed"
    _clean(scorecard)
    _clean(stage)


async def test_an_interviewer_link_scorecard_announces_the_scorecard(client, admin_headers, seed, events):
    cand = await seed.candidate(mode="external", stage="interviewing")
    minted = await mint(client, admin_headers, cand.id, interviewer_name="Dev Patel")
    assert minted.status_code == 200, minted.text
    response = await put_link(client, minted.json()["token"])
    assert response.status_code == 200, response.text
    payload = _of(events, "scorecard.submitted")[0]
    assert payload["candidate_id"] == cand.id and payload["scorecard_id"] == response.json()["scorecard"]["scorecard_id"]
    _clean(payload)


async def _offer_for(seed):
    cand = await seed.candidate(mode="platform", stage="completed")
    offer = await offer_service.create_offer(cand.id, "120000", "Health", "2026-12-01", "hr@example.com")
    return cand, offer


async def test_the_offer_lifecycle_announces_each_step_without_the_terms(seed, events, mail):
    db = get_db()
    cand, offer = await _offer_for(seed)
    try:
        assert [e for e, _ in events] == ["offer.created"]
        await offer_service.approve_offer(offer["offer_id"], "hr@example.com")
        await offer_service.send_offer(offer["offer_id"])
        assert [e for e, _ in events] == ["offer.created", "offer.sent"]

        fresh = await db.offers.find_one({"offer_id": offer["offer_id"]})
        await offer_service.respond_to_offer(fresh["secure_token"], False, "better offer elsewhere")
        assert [e for e, _ in events] == ["offer.created", "offer.sent", "offer.declined"]
        for _, payload in events:
            _clean(payload)
            assert payload["offer_id"] == offer["offer_id"] and payload["candidate_id"] == cand.id
            assert payload["candidate_name"] and payload["job_id"] == cand.job_id
        assert events[-1][1]["status"] == "declined"
        assert "120000" not in json.dumps(events) and "better offer" not in json.dumps(events)
    finally:
        await db.offers.delete_many({"offer_id": offer["offer_id"]})


async def test_accepting_an_offer_announces_offer_accepted(seed, events, mail):
    db = get_db()
    cand, offer = await _offer_for(seed)
    try:
        await offer_service.approve_offer(offer["offer_id"], "hr@example.com")
        await offer_service.send_offer(offer["offer_id"])
        fresh = await db.offers.find_one({"offer_id": offer["offer_id"]})
        await offer_service.respond_to_offer(fresh["secure_token"], True, None, typed_name="A Person", consent=True)
        assert events[-1][0] == "offer.accepted" and events[-1][1]["status"] == "accepted"
        _clean(events[-1][1])
    finally:
        await db.offers.delete_many({"offer_id": offer["offer_id"]})
        await db.employees.delete_many({"offer_id": offer["offer_id"]})
