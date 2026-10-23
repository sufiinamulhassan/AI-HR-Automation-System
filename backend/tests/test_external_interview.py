import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from config.database import get_db
from config.settings import settings
from services.hr_module import external_interview_service as ext
from services.hr_module.permissions import DEFAULT_ROLE_PERMISSIONS, PERMISSION_CATALOG

pytestmark = pytest.mark.anyio

EM_DASH = chr(0x2014)
MEET_URL = "https://meet.google.com/abc-defg-hij"
ZOOM_URL = "https://us06web.zoom.us/j/123456789?pwd=abc"

GOOD_RATINGS = {"technical": 5, "communication": 4, "problem_solving": 4, "cultural_fit": 3, "confidence": 4}
GOOD_FINAL_SCORE = 83


def _future(days: int = 2) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()


@pytest.fixture
def sent_mail(monkeypatch):
    calls: list[dict] = []

    async def fake_send_email(**kwargs):
        calls.append(kwargs)
        return True

    import services.hr_module.email_service as email_service
    monkeypatch.setattr(email_service, "send_email", fake_send_email)
    return calls


@pytest.fixture
async def seed():
    db = get_db()
    created = {"jobs": [], "resumes": [], "candidates": [], "offers": []}

    async def job(**fields) -> str:
        job_id = f"ext-job-{uuid.uuid4().hex[:10]}"
        doc = {
            "doc_type": "job", "job_id": job_id, "title": "Marketing Lead",
            "company_name": "Ext Test Corp", "candidate_pipeline": [],
        }
        doc.update(fields)
        await db.jobs.insert_one(doc)
        created["jobs"].append(job_id)
        return job_id

    async def resume(job_id: str | None = None, stage: str = "matched") -> str:
        resume_id = f"ext-resume-{uuid.uuid4().hex[:10]}"
        await db.resumes.insert_one({
            "doc_type": "resume", "resume_id": resume_id, "candidate_name": "Sam Rivera",
            "candidate_email": f"{resume_id}@example.com",
        })
        created["resumes"].append(resume_id)
        if job_id:
            await db.jobs.update_one(
                {"job_id": job_id},
                {"$push": {"candidate_pipeline": {
                    "resume_id": resume_id, "similarity_score": 0.82, "pipeline_stage": stage,
                }}},
            )
        return resume_id

    def track(candidate_id: str) -> str:
        created["candidates"].append(candidate_id)
        return candidate_id

    yield SimpleNamespace(db=db, job=job, resume=resume, track=track, created=created)

    emails = []
    for candidate_id in created["candidates"]:
        doc = await db.candidates.find_one({"candidate_id": candidate_id}, {"email": 1})
        if doc and doc.get("email"):
            emails.append(doc["email"])
        async for offer in db.offers.find({"candidate_id": candidate_id}, {"_id": 1}):
            await db.offers.delete_one({"_id": offer["_id"]})
        async for row in db.email_log.find({"candidate_id": candidate_id}, {"_id": 1}):
            await db.email_log.delete_one({"_id": row["_id"]})
        async for row in db.audit_log.find({"resource_id": candidate_id}, {"_id": 1}):
            await db.audit_log.delete_one({"_id": row["_id"]})
        await db.candidates.delete_one({"candidate_id": candidate_id})
    for email in emails:
        async for row in db.candidate_profiles.find({"email": email}, {"_id": 1}):
            await db.candidate_profiles.delete_one({"_id": row["_id"]})
    for job_id in created["jobs"]:
        await db.jobs.delete_one({"job_id": job_id})
        async for row in db.audit_log.find({"resource_id": job_id}, {"_id": 1}):
            await db.audit_log.delete_one({"_id": row["_id"]})
    for resume_id in created["resumes"]:
        await db.resumes.delete_one({"resume_id": resume_id})
    await asyncio.sleep(0)


def _body(**overrides) -> dict:
    body = {
        "name": "Sam Rivera", "email": f"sam-{uuid.uuid4().hex[:8]}@example.com",
        "platform": "meet", "join_url": MEET_URL, "scheduled_start_at": _future(),
        "duration_minutes": 45,
    }
    body.update(overrides)
    return body


async def _schedule(client, headers, seed, *, with_resume=True, **overrides):
    job_id = overrides.pop("job_id", None) or await seed.job()
    resume_id = await seed.resume(job_id) if with_resume else None
    payload = _body(job_id=job_id, resume_id=resume_id, **overrides)
    resp = await client.post("/api/v1/candidates/external-interview", json=payload, headers=headers)
    if resp.status_code == 200:
        seed.track(resp.json()["candidate_id"])
    return resp, job_id, resume_id, payload


async def _review(client, headers, candidate_id, **overrides):
    body = {
        "attended": True, "ratings": GOOD_RATINGS, "recommendation": "hire",
        "summary": "Strong on campaign strategy and clear when explaining trade-offs.",
    }
    body.update(overrides)
    return await client.post(f"/api/v1/candidates/{candidate_id}/external-review", json=body, headers=headers)


@pytest.mark.parametrize("platform,url", [
    ("meet", MEET_URL), ("zoom", ZOOM_URL), ("zoom", "https://zoom.us/j/1"),
    ("teams", "https://teams.microsoft.com/l/meetup-join/abc"), ("other", "https://webex.example.com/meet/sam"),
])
async def test_validate_join_url_accepts_matching_links(platform, url):
    assert ext.validate_join_url(platform, url) == url


@pytest.mark.parametrize("platform,url", [
    ("zoom", MEET_URL),
    ("meet", "https://evilmeet.google.com.attacker.io/x"),
    ("other", "http://example.com/room"),
    ("other", "javascript:alert(1)"),
    ("other", "https://example.com/a b"),
    ("other", ""),
    ("other", None),
])
async def test_validate_join_url_rejects_bad_links(platform, url):
    with pytest.raises(ext.ExternalInterviewError):
        ext.validate_join_url(platform, url)


async def test_other_platform_needs_a_name():
    with pytest.raises(ext.ExternalInterviewError):
        ext.platform_label("other", "  ")
    assert ext.platform_label("other", "Webex") == "Webex"
    assert ext.platform_label("meet", None) == "Google Meet"


async def test_validate_start_rejects_past_and_garbage():
    with pytest.raises(ext.ExternalInterviewError):
        ext.validate_start((datetime.now(timezone.utc) - timedelta(hours=1)).isoformat())
    with pytest.raises(ext.ExternalInterviewError):
        ext.validate_start("next tuesday")
    assert ext.validate_start(_future()).endswith("+00:00")


async def test_scorecard_requires_everything_and_the_review_averages():
    from services.hr_module import scorecard_service as sc

    kwargs = dict(
        source="hr", submitted_by="a@b.c", interviewer_name="Sam", interviewer_role="hr", questions=None,
        ratings=GOOD_RATINGS, recommendation="hire", summary="x" * 25,
        strengths=None, concerns="  ", guide=None,
    )
    card = sc.build_scorecard(**kwargs)
    review = sc.build_combined_review([card], interviewed_at=None)
    assert review["overall"] == 4.0
    assert card["concerns"] is None and card["strengths"] is None
    assert review["concerns"] is None and review["strengths"] is None

    for bad in (
        {"ratings": {**GOOD_RATINGS, "technical": 6}},
        {"ratings": {"communication": 4}},
        {"ratings": {k: v for k, v in GOOD_RATINGS.items() if k != "confidence"}},
        {"ratings": {**GOOD_RATINGS, "cultural_fit": True}},
        {"recommendation": "maybe"},
        {"summary": "too short"},
    ):
        with pytest.raises(ext.ExternalInterviewError):
            sc.build_scorecard(**{**kwargs, **bad})


async def test_external_status_follows_time_and_review():
    now = datetime.now(timezone.utc)
    base = {"interview_mode": "external", "external_interview": {
        "scheduled_start_at": (now + timedelta(hours=3)).isoformat(), "duration_minutes": 45, "status": "scheduled",
    }}
    assert ext.external_status({"interview_mode": "platform"}) is None
    assert ext.external_status(base) == "scheduled"
    past = {**base, "external_interview": {**base["external_interview"],
            "scheduled_start_at": (now - timedelta(hours=3)).isoformat()}}
    assert ext.external_status(past) == "awaiting_review"
    running = {**base, "external_interview": {**base["external_interview"],
               "scheduled_start_at": (now - timedelta(minutes=10)).isoformat()}}
    assert ext.external_status(running) == "scheduled"
    assert ext.external_status({**past, "external_review": {"overall": 4}}) == "reviewed"
    assert ext.external_status({**past, "external_interview": {**past["external_interview"], "status": "no_show"}}) == "no_show"


async def test_permissions_registered_for_admins_only():
    for perm in ("interview:external_schedule", "interview:external_review"):
        assert perm in PERMISSION_CATALOG
        assert perm in DEFAULT_ROLE_PERMISSIONS["admin"]
        assert perm in DEFAULT_ROLE_PERMISSIONS["superadmin"]
        assert perm not in DEFAULT_ROLE_PERMISSIONS["standard"]


async def test_schedule_creates_candidate_moves_stage_and_emails_details_only(client, admin_headers, seed, sent_mail):
    resp, job_id, resume_id, payload = await _schedule(
        client, admin_headers, seed, notes="Please use the <b>front</b> entrance link.", display_timezone="Asia/Karachi",
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["interview_mode"] == "external" and body["email_sent"] is True
    assert body["external_interview"]["platform_label"] == "Google Meet"

    cand = await seed.db.candidates.find_one({"candidate_id": body["candidate_id"]})
    assert cand["interview_mode"] == "external"
    assert cand["pipeline_stage"] == "interviewing" and cand["status"] == "interviewing"
    assert cand["token_status"] == "unused"
    assert cand["external_interview"]["email_delivered"] is True
    assert cand["external_interview"]["status"] == "scheduled"
    assert cand["scheduled_start_at"] == cand["external_interview"]["scheduled_start_at"]

    job = await seed.db.jobs.find_one({"job_id": job_id})
    assert job["candidate_pipeline"][0]["pipeline_stage"] == "interviewing"

    assert len(sent_mail) == 1
    mail = sent_mail[0]
    assert mail["to"] == payload["email"]
    assert mail["subject"] == "Your interview for Marketing Lead"
    for text in (mail["subject"], mail["text_body"], mail["html_body"]):
        assert EM_DASH not in text
    assert MEET_URL in mail["text_body"] and "Google Meet" in mail["text_body"]
    assert "UTC" in mail["text_body"]
    assert "/interview/" not in mail["text_body"] + mail["html_body"]
    assert "<b>front</b>" not in mail["html_body"] and "&lt;b&gt;front&lt;/b&gt;" in mail["html_body"]
    assert "score" not in mail["text_body"].lower() and "recommend" not in mail["text_body"].lower()


async def test_schedule_requires_admin_and_permission(client, standard_headers, seed, sent_mail):
    resp, *_ = await _schedule(client, standard_headers, seed)
    assert resp.status_code == 403
    assert sent_mail == []


@pytest.mark.parametrize("overrides,fragment", [
    ({"scheduled_start_at": (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()}, "future"),
    ({"platform": "zoom", "join_url": MEET_URL}, "Zoom"),
    ({"platform": "other", "join_url": "https://example.com/room"}, "name of the platform"),
    ({"join_url": "http://meet.google.com/abc"}, "https"),
    ({"join_url": None}, "meeting link"),
    ({"platform": "meet", "create_meeting": True, "join_url": None}, "Zoom and Microsoft Teams"),
])
async def test_schedule_rejects_bad_input_without_creating_anything(client, admin_headers, seed, sent_mail, overrides, fragment):
    resp, job_id, *_ = await _schedule(client, admin_headers, seed, **overrides)
    assert resp.status_code == 422, resp.text
    assert fragment in resp.json()["detail"]
    assert await seed.db.candidates.count_documents({"job_id": job_id}) == 0
    assert sent_mail == []


async def test_schedule_unknown_platform_is_a_validation_error(client, admin_headers, seed):
    resp, *_ = await _schedule(client, admin_headers, seed, platform="skype")
    assert resp.status_code == 422


async def test_schedule_creates_a_zoom_meeting_and_never_stores_the_host_link(client, admin_headers, seed, sent_mail, monkeypatch):
    import services.hr_module.meeting_service as meetings

    async def fake_create(**kwargs):
        assert kwargs["provider"] == "zoom"
        return {"provider": "zoom", "meeting_id": "99", "join_url": ZOOM_URL,
                "host_url": "https://zoom.us/s/99?zak=SECRET", "password": "pw123"}

    monkeypatch.setattr(meetings, "create_meeting", fake_create)
    resp, *_ = await _schedule(client, admin_headers, seed, platform="zoom", join_url=None, create_meeting=True)
    assert resp.status_code == 200, resp.text
    stored = await seed.db.candidates.find_one({"candidate_id": resp.json()["candidate_id"]})
    assert stored["external_interview"]["join_url"] == ZOOM_URL
    assert stored["external_interview"]["meeting_created"] is True
    dumped = str(stored)
    assert "SECRET" not in dumped and "pw123" not in dumped
    assert ZOOM_URL in sent_mail[0]["text_body"]


async def test_schedule_provider_failure_is_a_502_and_saves_nothing(client, admin_headers, seed, sent_mail, monkeypatch):
    import services.hr_module.meeting_service as meetings

    async def failing_create(**kwargs):
        raise meetings.MeetingServiceError("zoom rejected the request (401)")

    monkeypatch.setattr(meetings, "create_meeting", failing_create)
    resp, job_id, *_ = await _schedule(client, admin_headers, seed, platform="zoom", join_url=None, create_meeting=True)
    assert resp.status_code == 502
    assert "Could not create the meeting" in resp.json()["detail"]
    assert await seed.db.candidates.count_documents({"job_id": job_id}) == 0
    assert sent_mail == []


async def test_duplicate_email_for_the_same_job_is_a_conflict(client, admin_headers, seed, sent_mail):
    first, job_id, _, payload = await _schedule(client, admin_headers, seed)
    assert first.status_code == 200
    again, *_ = await _schedule(client, admin_headers, seed, job_id=job_id, email=payload["email"])
    assert again.status_code == 409


async def test_existing_ai_invite_can_be_switched_to_an_external_interview(client, admin_headers, seed, sent_mail):
    job_id = await seed.job()
    candidate_id = seed.track(str(uuid.uuid4()))
    await seed.db.candidates.insert_one({
        "doc_type": "candidate", "candidate_id": candidate_id, "job_id": job_id, "name": "Pat Lee",
        "email": f"pat-{uuid.uuid4().hex[:6]}@example.com", "secure_token": f"tok_{uuid.uuid4().hex[:12]}",
        "token_status": "active", "pipeline_stage": "invited", "status": "invited", "transcript": [],
    })
    resp = await client.post(
        "/api/v1/candidates/external-interview", headers=admin_headers,
        json={"candidate_id": candidate_id, "platform": "teams",
              "join_url": "https://teams.microsoft.com/l/meetup-join/xyz", "scheduled_start_at": _future()},
    )
    assert resp.status_code == 200, resp.text
    cand = await seed.db.candidates.find_one({"candidate_id": candidate_id})
    assert cand["interview_mode"] == "external" and cand["pipeline_stage"] == "interviewing"


async def test_candidate_who_started_the_ai_interview_cannot_be_switched(client, admin_headers, seed, sent_mail):
    job_id = await seed.job()
    candidate_id = seed.track(str(uuid.uuid4()))
    await seed.db.candidates.insert_one({
        "doc_type": "candidate", "candidate_id": candidate_id, "job_id": job_id, "name": "Pat Lee",
        "email": "pat2@example.com", "secure_token": f"tok_{uuid.uuid4().hex[:12]}",
        "pipeline_stage": "interviewing", "transcript": [{"question": "q", "answer": "a"}],
    })
    resp = await client.post(
        "/api/v1/candidates/external-interview", headers=admin_headers,
        json={"candidate_id": candidate_id, "platform": "meet", "join_url": MEET_URL, "scheduled_start_at": _future()},
    )
    assert resp.status_code == 409 and "AI interview" in resp.json()["detail"]
    assert sent_mail == []


async def test_scheduling_an_already_external_candidate_points_to_change(client, admin_headers, seed, sent_mail):
    resp, *_ = await _schedule(client, admin_headers, seed)
    again = await client.post(
        "/api/v1/candidates/external-interview", headers=admin_headers,
        json={"candidate_id": resp.json()["candidate_id"], "platform": "meet", "join_url": MEET_URL,
              "scheduled_start_at": _future(3)},
    )
    assert again.status_code == 409 and "Change its time or link" in again.json()["detail"]


async def test_the_external_token_cannot_open_an_ai_session(client, admin_headers, seed, sent_mail):
    resp, *_ = await _schedule(client, admin_headers, seed)
    cand = await seed.db.candidates.find_one({"candidate_id": resp.json()["candidate_id"]})
    session = await client.get(f"/api/v1/interview/session/{cand['secure_token']}")
    assert session.status_code == 403
    assert "another platform" in session.json()["detail"]


async def _offer(client, headers, candidate_id):
    return await client.post(
        "/api/v1/offers", headers=headers,
        json={"candidate_id": candidate_id, "salary": "90000", "benefits": None, "joining_date": None},
    )


async def test_hire_hold_offer_and_stage_moves_are_blocked_until_reviewed(client, admin_headers, seed, sent_mail):
    resp, job_id, resume_id, _ = await _schedule(client, admin_headers, seed)
    cid = resp.json()["candidate_id"]
    needed = ext.REVIEW_REQUIRED_MESSAGE

    for decision in ("hire", "hold"):
        r = await client.post(f"/api/v1/candidates/{cid}/decision", json={"decision": decision}, headers=admin_headers)
        assert r.status_code == 409 and r.json()["detail"] == needed, decision

    r = await _offer(client, admin_headers, cid)
    assert r.status_code == 409 and r.json()["detail"] == needed

    r = await client.post(f"/api/v1/candidates/{cid}/send-email", json={"template": "offer_letter"}, headers=admin_headers)
    assert r.status_code == 409 and r.json()["detail"] == needed

    for stage in ("completed", "hired"):
        r = await client.patch(f"/api/v1/jobs/{job_id}/pipeline/{resume_id}?stage={stage}", headers=admin_headers)
        assert r.status_code == 409, stage

    bulk = await client.post(
        f"/api/v1/jobs/{job_id}/pipeline/bulk-stage", headers=admin_headers,
        json={"resume_ids": [resume_id], "stage": "completed"},
    )
    assert bulk.status_code == 200 and bulk.json()["blocked"] == [resume_id] and bulk.json()["updated"] == 0

    assert (await seed.db.candidates.find_one({"candidate_id": cid}))["pipeline_stage"] == "interviewing"
    rejected = await client.post(f"/api/v1/candidates/{cid}/decision", json={"decision": "reject"}, headers=admin_headers)
    assert rejected.status_code == 200


async def test_review_validation_errors_are_422_and_change_nothing(client, admin_headers, seed, sent_mail):
    resp, *_ = await _schedule(client, admin_headers, seed)
    cid = resp.json()["candidate_id"]
    for overrides in (
        {"ratings": {**GOOD_RATINGS, "technical": 0}},
        {"ratings": None},
        {"recommendation": None},
        {"summary": "short"},
    ):
        r = await _review(client, admin_headers, cid, **overrides)
        assert r.status_code == 422, overrides
    cand = await seed.db.candidates.find_one({"candidate_id": cid})
    assert cand["pipeline_stage"] == "interviewing" and not cand.get("external_review")


async def test_review_unlocks_hire_and_offer(client, admin_headers, seed, sent_mail):
    resp, job_id, resume_id, _ = await _schedule(client, admin_headers, seed)
    cid = resp.json()["candidate_id"]

    r = await _review(client, admin_headers, cid, strengths="Clear thinker", concerns="Light on analytics")
    assert r.status_code == 200, r.text
    assert r.json() == {
        "stage": "completed", "external_status": "reviewed", "overall": 4.0,
        "final_score": GOOD_FINAL_SCORE, "report_ready": True,
    }

    cand = await seed.db.candidates.find_one({"candidate_id": cid})
    assert cand["pipeline_stage"] == "completed" and cand["final_score"] == GOOD_FINAL_SCORE
    assert cand["report_status"] == "ready" and cand["report"]["source"] == "interviewer_scorecard"
    assert cand["external_review"]["reviewed_by"] == "demo-admin@hirely.ai"
    assert cand["external_interview"]["status"] == "reviewed"
    job = await seed.db.jobs.find_one({"job_id": job_id})
    assert job["candidate_pipeline"][0]["pipeline_stage"] == "completed"

    offer = await _offer(client, admin_headers, cid)
    assert offer.status_code == 200, offer.text
    hired = await client.post(f"/api/v1/candidates/{cid}/decision", json={"decision": "hire"}, headers=admin_headers)
    assert hired.status_code == 200 and hired.json()["stage"] == "hired"


async def test_review_can_be_corrected_until_the_candidate_is_hired_or_rejected(client, admin_headers, seed, sent_mail):
    resp, *_ = await _schedule(client, admin_headers, seed)
    cid = resp.json()["candidate_id"]
    first = await _review(client, admin_headers, cid)
    assert first.status_code == 200
    second = await _review(client, admin_headers, cid, recommendation="strong_hire",
                           ratings={k: 5 for k in GOOD_RATINGS})
    assert second.status_code == 200 and second.json()["overall"] == 5.0
    review = (await seed.db.candidates.find_one({"candidate_id": cid}))["external_review"]
    assert review["edited"] is True and review["first_reviewed_at"]

    await client.post(f"/api/v1/candidates/{cid}/decision", json={"decision": "reject"}, headers=admin_headers)
    closed = await _review(client, admin_headers, cid)
    assert closed.status_code == 409


async def test_review_is_for_external_interviews_only(client, admin_headers, seed):
    job_id = await seed.job()
    cid = seed.track(str(uuid.uuid4()))
    await seed.db.candidates.insert_one({
        "doc_type": "candidate", "candidate_id": cid, "job_id": job_id, "name": "Ai Only",
        "email": "aionly@example.com", "secure_token": f"tok_{uuid.uuid4().hex[:12]}", "pipeline_stage": "completed",
    })
    r = await _review(client, admin_headers, cid)
    assert r.status_code == 409
    hired = await client.post(f"/api/v1/candidates/{cid}/decision", json={"decision": "hire"}, headers=admin_headers)
    assert hired.status_code == 200


async def test_no_show_is_recorded_but_unlocks_nothing(client, admin_headers, seed, sent_mail):
    resp, job_id, resume_id, _ = await _schedule(client, admin_headers, seed)
    cid = resp.json()["candidate_id"]

    r = await client.post(
        f"/api/v1/candidates/{cid}/external-review", headers=admin_headers,
        json={"attended": False, "note": "No answer after 15 minutes"},
    )
    assert r.status_code == 200 and r.json() == {"stage": "interviewing", "external_status": "no_show"}
    cand = await seed.db.candidates.find_one({"candidate_id": cid})
    assert cand["external_interview"]["status"] == "no_show"
    assert cand["external_interview"]["no_show"]["note"] == "No answer after 15 minutes"
    assert cand["pipeline_stage"] == "interviewing" and not cand.get("external_review")

    hire = await client.post(f"/api/v1/candidates/{cid}/decision", json={"decision": "hire"}, headers=admin_headers)
    assert hire.status_code == 409

    no_time = await client.patch(f"/api/v1/candidates/{cid}/external-interview", json={}, headers=admin_headers)
    assert no_time.status_code == 422 and "new time" in no_time.json()["detail"]
    sent_mail.clear()
    again = await client.patch(
        f"/api/v1/candidates/{cid}/external-interview", json={"scheduled_start_at": _future(5)}, headers=admin_headers,
    )
    assert again.status_code == 200, again.text
    assert (await seed.db.candidates.find_one({"candidate_id": cid}))["external_interview"]["status"] == "scheduled"
    assert sent_mail[0]["subject"] == "Updated interview details for Marketing Lead"


async def test_a_reviewed_interview_cannot_be_marked_no_show_or_changed(client, admin_headers, seed, sent_mail):
    resp, *_ = await _schedule(client, admin_headers, seed)
    cid = resp.json()["candidate_id"]
    await _review(client, admin_headers, cid)

    ns = await client.post(f"/api/v1/candidates/{cid}/external-review", json={"attended": False}, headers=admin_headers)
    assert ns.status_code == 409
    upd = await client.patch(
        f"/api/v1/candidates/{cid}/external-interview", json={"scheduled_start_at": _future(4)}, headers=admin_headers,
    )
    assert upd.status_code == 409
    res = await client.post(f"/api/v1/candidates/{cid}/external-interview/resend", headers=admin_headers)
    assert res.status_code == 409


async def test_update_changes_link_and_sends_an_update_email_without_em_dashes(client, admin_headers, seed, sent_mail):
    resp, *_ = await _schedule(client, admin_headers, seed)
    cid = resp.json()["candidate_id"]
    sent_mail.clear()

    new_url = "https://meet.google.com/new-room-xyz"
    r = await client.patch(
        f"/api/v1/candidates/{cid}/external-interview", headers=admin_headers,
        json={"join_url": new_url, "notes": "Room changed"},
    )
    assert r.status_code == 200 and r.json()["email_sent"] is True
    cand = await seed.db.candidates.find_one({"candidate_id": cid})
    assert cand["external_interview"]["join_url"] == new_url and cand["meeting_join_url"] == new_url
    assert len(sent_mail) == 1
    mail = sent_mail[0]
    assert mail["subject"].startswith("Updated interview details")
    assert new_url in mail["text_body"] and "have changed" in mail["text_body"]
    assert EM_DASH not in mail["subject"] + mail["text_body"] + mail["html_body"]


async def test_switching_platform_requires_a_matching_link(client, admin_headers, seed, sent_mail):
    resp, *_ = await _schedule(client, admin_headers, seed)
    cid = resp.json()["candidate_id"]

    no_link = await client.patch(f"/api/v1/candidates/{cid}/external-interview", json={"platform": "zoom"}, headers=admin_headers)
    assert no_link.status_code == 422

    ok = await client.patch(
        f"/api/v1/candidates/{cid}/external-interview", headers=admin_headers,
        json={"platform": "zoom", "join_url": ZOOM_URL},
    )
    assert ok.status_code == 200
    assert ok.json()["external_interview"]["platform_label"] == "Zoom"


async def test_resend_sends_the_same_details_again_and_counts_it(client, admin_headers, seed, sent_mail):
    resp, _, _, payload = await _schedule(client, admin_headers, seed)
    cid = resp.json()["candidate_id"]
    sent_mail.clear()

    r = await client.post(f"/api/v1/candidates/{cid}/external-interview/resend", headers=admin_headers)
    assert r.status_code == 200 and r.json() == {"email_sent": True, "sent_to": payload["email"]}
    assert sent_mail[0]["subject"] == "Your interview for Marketing Lead"
    assert (await seed.db.candidates.find_one({"candidate_id": cid}))["external_interview"]["resent_count"] == 1


async def test_update_and_resend_only_apply_to_external_candidates(client, admin_headers, seed):
    job_id = await seed.job()
    cid = seed.track(str(uuid.uuid4()))
    await seed.db.candidates.insert_one({
        "doc_type": "candidate", "candidate_id": cid, "job_id": job_id, "name": "Plain", "email": "plain@example.com",
        "secure_token": f"tok_{uuid.uuid4().hex[:12]}", "pipeline_stage": "invited",
    })
    assert (await client.patch(f"/api/v1/candidates/{cid}/external-interview", json={}, headers=admin_headers)).status_code == 409
    assert (await client.post(f"/api/v1/candidates/{cid}/external-interview/resend", headers=admin_headers)).status_code == 409
    missing = await client.post("/api/v1/candidates/nope/external-interview/resend", headers=admin_headers)
    assert missing.status_code == 404


async def test_review_text_is_admin_only(client, admin_headers, standard_headers, seed, sent_mail):
    resp, *_ = await _schedule(client, admin_headers, seed)
    cid = resp.json()["candidate_id"]
    await _review(client, admin_headers, cid, concerns="Confidential concern text")

    admin_view = await client.get(f"/api/v1/candidates/{cid}/external-review", headers=admin_headers)
    assert admin_view.status_code == 200
    body = admin_view.json()
    assert body["external_review"]["concerns"] == "Confidential concern text"
    assert body["external_interview"]["platform"] == "meet"

    assert (await client.get(f"/api/v1/candidates/{cid}/external-review", headers=standard_headers)).status_code == 403
    std = await client.get(f"/api/v1/candidates/{cid}", headers=standard_headers)
    assert std.status_code == 200 and "external_review" not in std.json()
    assert "interview_scorecards" not in std.json()
    assert admin_view.json()["scorecards"][0]["concerns"] == "Confidential concern text"
    adm = await client.get(f"/api/v1/candidates/{cid}", headers=admin_headers)
    assert adm.json()["external_review"]["recommendation"] == "hire"


async def test_review_before_it_exists_reads_as_null(client, admin_headers, seed, sent_mail):
    resp, *_ = await _schedule(client, admin_headers, seed)
    r = await client.get(f"/api/v1/candidates/{resp.json()['candidate_id']}/external-review", headers=admin_headers)
    assert r.status_code == 200 and r.json()["external_review"] is None


async def test_pipeline_rows_carry_external_state_but_never_review_content(client, admin_headers, standard_headers, seed, sent_mail):
    resp, job_id, resume_id, _ = await _schedule(client, admin_headers, seed)
    cid = resp.json()["candidate_id"]
    plain_resume = await seed.resume(job_id)

    def rows(r):
        return {row["resume_id"]: row for row in r.json()["pipeline"]}

    before = rows(await client.get(f"/api/v1/jobs/{job_id}/pipeline", headers=standard_headers))
    row = before[resume_id]
    assert row["interview_mode"] == "external" and row["external_status"] == "scheduled"
    assert row["external_platform"] == "meet" and row["external_platform_label"] == "Google Meet"
    assert row["external_join_url"] == MEET_URL and row["review_submitted"] is False
    assert row["candidate_id"] == cid
    plain = before[plain_resume]
    assert plain["interview_mode"] == "platform" and plain["external_status"] is None
    assert plain["external_join_url"] is None and plain["review_submitted"] is False

    await _review(client, admin_headers, cid, summary="Highly confidential written assessment here.")
    after = await client.get(f"/api/v1/jobs/{job_id}/pipeline", headers=standard_headers)
    row = rows(after)[resume_id]
    assert row["external_status"] == "reviewed" and row["review_submitted"] is True
    assert row["pipeline_stage"] == "completed"
    assert "confidential written assessment" not in after.text
    assert "ratings" not in row and "external_review" not in row


async def test_auto_invite_is_off_by_default_and_creates_nothing(monkeypatch):
    import services.hr_module.invite_service as invites

    assert settings.AUTO_INVITE_ENABLED is False
    called = []

    async def fake_create(**kwargs):
        called.append(kwargs)
        return "cid"

    monkeypatch.setattr(invites, "_create_and_invite", fake_create)
    out = await invites.auto_invite_if_qualified(
        resume_id="r1", matched_jds=[{"job_id": "j1", "score": 0.99}],
        candidate_email="x@example.com", candidate_name="X",
    )
    assert out == [] and called == []

    out = await invites.auto_invite_from_jd_match(job_id="j1", matched_resumes=[{"resume_id": "r1", "score": 0.99}])
    assert out == [] and called == []


async def test_auto_invite_still_works_when_switched_on_and_for_an_explicit_rematch(monkeypatch):
    import services.hr_module.invite_service as invites

    created = []

    async def fake_create(**kwargs):
        created.append(kwargs["job_id"])
        return f"cid-{len(created)}"

    monkeypatch.setattr(invites, "_create_and_invite", fake_create)

    monkeypatch.setattr(settings, "AUTO_INVITE_ENABLED", True)
    out = await invites.auto_invite_if_qualified(
        resume_id="r1", matched_jds=[{"job_id": "j1", "score": 0.99}, {"job_id": "j2", "score": 0.1}],
        candidate_email="x@example.com", candidate_name="X",
    )
    assert out == ["cid-1"] and created == ["j1"]

    monkeypatch.setattr(settings, "AUTO_INVITE_ENABLED", False)
    created.clear()
    db = get_db()
    resume_id = f"ext-force-{uuid.uuid4().hex[:8]}"
    await db.resumes.insert_one({"doc_type": "resume", "resume_id": resume_id, "candidate_email": "force@example.com"})
    try:
        forced = await invites.auto_invite_from_jd_match(
            job_id="j9", matched_resumes=[{"resume_id": resume_id, "score": 0.99}], force=True,
        )
    finally:
        await db.resumes.delete_one({"resume_id": resume_id})
    assert forced == ["cid-1"] and created == ["j9"]


async def test_no_route_sends_the_ai_link_to_an_external_candidate(client, admin_headers, seed, sent_mail):
    resp, *_ = await _schedule(client, admin_headers, seed)
    cid = resp.json()["candidate_id"]
    token = (await seed.db.candidates.find_one({"candidate_id": cid}))["secure_token"]
    sent_mail.clear()

    assert (await client.post(f"/api/v1/candidates/{cid}/resend-invite", headers=admin_headers)).status_code == 409
    assert (await client.post(f"/api/v1/candidates/{cid}/regenerate-token", json={"resend": True}, headers=admin_headers)).status_code == 409
    assess = await client.post(f"/api/v1/candidates/{cid}/send-email", json={"template": "assessment_invitation"}, headers=admin_headers)
    assert assess.status_code == 409

    rem = await client.post(f"/api/v1/candidates/{cid}/send-email", json={"template": "reminder"}, headers=admin_headers)
    assert rem.status_code == 200
    assert len(sent_mail) == 1
    assert "/interview/" not in sent_mail[0]["text_body"] + sent_mail[0]["html_body"]
    assert token not in sent_mail[0]["text_body"] + sent_mail[0]["html_body"]
    assert (await seed.db.candidates.find_one({"candidate_id": cid}))["secure_token"] == token


async def test_send_manual_invite_backstop_refuses_external_candidates(sent_mail):
    from services.hr_module.invite_service import send_manual_invite

    ok = await send_manual_invite(
        candidate={"candidate_id": "c1", "email": "a@example.com", "secure_token": "tok_x", "interview_mode": "external"},
        admin_email="admin@example.com",
    )
    assert ok is False and sent_mail == []


async def test_bulk_resend_skips_a_stale_failed_invite_for_an_external_candidate(client, admin_headers, seed, sent_mail):
    from services.hr_module.email_delivery_service import _check_resendable

    resp, *_ = await _schedule(client, admin_headers, seed)
    cid = resp.json()["candidate_id"]
    row = await seed.db.email_log.insert_one({
        "to": "x@example.com", "subject": "Interview Invitation", "template": "interview_invitation",
        "candidate_id": cid, "status": "failed", "created_at": datetime.now(timezone.utc).isoformat(),
    })
    try:
        candidate, reason = await _check_resendable(seed.db, str(row.inserted_id), set())
    finally:
        await seed.db.email_log.delete_one({"_id": row.inserted_id})
    assert candidate is None and reason == "interviewed_on_another_platform"


async def test_platform_schedule_endpoint_will_not_overwrite_an_external_interview(client, admin_headers, seed, sent_mail):
    resp, *_ = await _schedule(client, admin_headers, seed)
    cid = resp.json()["candidate_id"]
    before = (await seed.db.candidates.find_one({"candidate_id": cid}))["external_interview"]["scheduled_start_at"]

    r = await client.patch(
        f"/api/v1/interview/{cid}/schedule", headers=admin_headers, json={"scheduled_start_at": _future(9)},
    )
    assert r.status_code == 409 and "another platform" in r.json()["detail"]
    after = await seed.db.candidates.find_one({"candidate_id": cid})
    assert after["external_interview"]["scheduled_start_at"] == before and after["scheduled_start_at"] == before
