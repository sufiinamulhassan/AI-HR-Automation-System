import json
import re
import uuid

import pytest

from config.database import get_db
from services.hr_module.candidate_redaction import (
    ADMIN_ONLY_KEYS,
    CANDIDATE_FIELDS_FOR_NON_ADMIN,
    OFFER_FIELDS_FOR_NON_ADMIN,
    redact_candidate,
    redact_offer,
    scrub_admin_only,
)
from support_routes import all_routes

pytestmark = pytest.mark.anyio

MARKERS = (
    "MARK-REPORT-SUMMARY", "MARK-TRANSCRIPT-ANSWER", "MARK-INTEGRITY-FLAG", "MARK-REVIEW-NOTE",
    "MARK-SCORECARD-NOTE", "MARK-GUIDE-QUESTION", "MARK-DECISION-NOTE", "MARK-RECRUITER-NOTE",
    "MARK-PROFILE-NOTE", "MARK-DECISION-REASON", "MARK-NOSHOW-NOTE", "MARK-INTERNAL-QUESTION",
    "MARK-OFFER-SIGNATURE", "MARK-DECLINE-REASON",
)


def keys_found(value, wanted=ADMIN_ONLY_KEYS) -> set:
    found: set = set()
    if isinstance(value, dict):
        for k, v in value.items():
            if k in wanted:
                found.add(k)
            found |= keys_found(v, wanted)
    elif isinstance(value, list):
        for item in value:
            found |= keys_found(item, wanted)
    return found


def assert_clean(response, world, *, where: str):
    body = response.text
    for marker in MARKERS:
        assert marker not in body, f"{where}: {marker} leaked to a standard user"
    for secret in (world["cand_token"], world["offer_token"]):
        assert secret not in body, f"{where}: a credential leaked to a standard user"
    try:
        parsed = response.json()
    except ValueError:
        return
    assert keys_found(parsed) == set(), f"{where}: {sorted(keys_found(parsed))} present for a standard user"


@pytest.fixture
async def world():
    db = get_db()
    tag = uuid.uuid4().hex[:10]
    ids = {
        "job_id": f"job-{tag}", "resume_id": f"res-{tag}", "cand_id": f"cand-{tag}",
        "offer_id": f"off-{tag}", "cand_token": f"tok_secretlink{tag}", "offer_token": f"tok_secretoffer{tag}",
        "email": f"lockdown.{tag}@example.com", "tag": tag,
    }
    await db.jobs.insert_one({
        "doc_type": "job", "job_id": ids["job_id"], "title": f"Lockdown Engineer {tag}",
        "description": "Build things.", "department_id": None, "created_at": "2026-01-01T00:00:00+00:00",
        "candidate_pipeline": [{
            "resume_id": ids["resume_id"], "similarity_score": 0.91, "pipeline_stage": "completed",
            "added_at": "2026-01-01T00:00:00+00:00",
        }],
    })
    await db.resumes.insert_one({
        "doc_type": "resume", "resume_id": ids["resume_id"], "filename": "cv.pdf",
        "candidate_name": "Lock Down", "candidate_email": ids["email"], "processing_status": "processed",
        "classification": {"skills": ["python"]}, "matched_jds": [{"job_id": ids["job_id"], "score": 0.91}],
        "created_at": "2026-01-01T00:00:00+00:00",
    })
    cand = {
        "doc_type": "candidate", "candidate_id": ids["cand_id"], "job_id": ids["job_id"],
        "resume_id": ids["resume_id"], "name": "Lock Down", "email": ids["email"],
        "secure_token": ids["cand_token"], "token_status": "consumed", "status": "completed",
        "pipeline_stage": "completed", "invite_type": "manual", "match_score": 0.91,
        "created_at": "2026-01-02T00:00:00+00:00",
        "interview_mode": "external",
        "external_interview": {
            "platform": "zoom", "platform_label": "Zoom", "join_url": "https://zoom.us/j/1",
            "scheduled_start_at": "2026-02-01T10:00:00+00:00", "duration_minutes": 30, "status": "reviewed",
            "no_show": {"note": "MARK-NOSHOW-NOTE"}, "history": [{"by": "hr@example.com"}],
        },
        "report": {"summary": "MARK-REPORT-SUMMARY", "final_score": 77},
        "score_breakdown": {"final_score": 77}, "eval_score": 77, "final_score": 77,
        "transcript": [{"question": "q", "answer": "MARK-TRANSCRIPT-ANSWER"}],
        "integrity_flags": ["MARK-INTEGRITY-FLAG"],
        "external_review": {"summary": "MARK-REVIEW-NOTE", "reviewed_at": "2026-02-02T00:00:00+00:00"},
        "interview_scorecards": [{"scorecard_id": "s1", "summary": "MARK-SCORECARD-NOTE"}],
        "interview_guide": {"questions": [{"id": "q1", "text": "MARK-GUIDE-QUESTION"}]},
        "decision": "hold", "decision_notes": "MARK-DECISION-NOTE", "decision_reason": "MARK-DECISION-REASON",
        "recruiter_notes": "MARK-RECRUITER-NOTE", "_questions": ["MARK-INTERNAL-QUESTION"],
        "report_status": "ready", "report_error": None,
    }
    await db.candidates.insert_one(dict(cand))
    await db.offers.insert_one({
        "doc_type": "offer", "offer_id": ids["offer_id"], "candidate_id": ids["cand_id"], "job_id": ids["job_id"],
        "salary": "100000", "benefits": "health", "joining_date": "2026-03-01", "status": "sent",
        "secure_token": ids["offer_token"], "created_by": "hr@example.com", "approved_by": "hr@example.com",
        "signature": {"typed_name": "MARK-OFFER-SIGNATURE", "ip_address": "10.0.0.9"},
        "decline_reason": "MARK-DECLINE-REASON", "ai_letter_body": "MARK-REPORT-SUMMARY",
        "created_at": "2026-01-03T00:00:00+00:00", "updated_at": "2026-01-03T00:00:00+00:00",
    })
    from services.hr_module.candidate_profile_service import update_profile_notes, upsert_candidate_profile
    profile_id = await upsert_candidate_profile(cand)
    await update_profile_notes(profile_id, "MARK-PROFILE-NOTE")
    ids["profile_id"] = profile_id
    try:
        yield ids
    finally:
        await db.jobs.delete_one({"job_id": ids["job_id"]})
        await db.resumes.delete_one({"resume_id": ids["resume_id"]})
        await db.candidates.delete_one({"candidate_id": ids["cand_id"]})
        await db.offers.delete_one({"offer_id": ids["offer_id"]})
        await db.candidate_profiles.delete_one({"profile_id": profile_id})


def _standard_urls(w: dict) -> list[str]:
    base = "/api/v1"
    return [
        f"{base}/candidates?limit=100",
        f"{base}/candidates?job_id={w['job_id']}",
        f"{base}/candidates/{w['cand_id']}",
        f"{base}/candidates/{w['cand_id']}/timeline",
        f"{base}/candidates/{w['cand_id']}/emails",
        f"{base}/candidates/profile/{w['profile_id']}",
        f"{base}/candidates/profile/by-email/{w['email']}",
        f"{base}/jobs/{w['job_id']}/pipeline",
        f"{base}/jobs/{w['job_id']}",
        f"{base}/jobs?limit=100",
        f"{base}/jobs/{w['job_id']}/pipeline/{w['resume_id']}/fit",
        f"{base}/resumes?limit=100",
        f"{base}/resumes/{w['resume_id']}",
        f"{base}/offers",
        f"{base}/offers?candidate_id={w['cand_id']}",
        f"{base}/offers/{w['offer_id']}",
    ]


async def test_every_candidate_facing_read_is_clean_for_a_standard_user(client, standard_headers, world):
    for url in _standard_urls(world):
        resp = await client.get(url, headers=standard_headers)
        assert resp.status_code == 200, f"{url}: {resp.status_code} {resp.text[:200]}"
        assert_clean(resp, world, where=url)


async def test_the_candidate_a_standard_user_sees_keeps_the_fields_it_needs(client, standard_headers, world):
    body = (await client.get(f"/api/v1/candidates/{world['cand_id']}", headers=standard_headers)).json()
    assert body["candidate_id"] == world["cand_id"]
    assert body["name"] == "Lock Down" and body["email"] == world["email"]
    assert body["status"] == "completed" and body["pipeline_stage"] == "completed"
    assert body["job_id"] == world["job_id"] and body["resume_id"] == world["resume_id"]
    assert body["external_interview"]["platform"] == "zoom"
    assert "no_show" not in body["external_interview"] and "history" not in body["external_interview"]
    assert body["review_submitted"] is True
    assert body["decision"] == "hold"
    assert set(body) <= CANDIDATE_FIELDS_FOR_NON_ADMIN | {"external_interview", "review_submitted"}


async def test_the_candidate_list_is_filtered_per_row(client, standard_headers, world):
    rows = (await client.get(f"/api/v1/candidates?job_id={world['job_id']}", headers=standard_headers)).json()["candidates"]
    assert [r["candidate_id"] for r in rows] == [world["cand_id"]]
    assert set(rows[0]) <= CANDIDATE_FIELDS_FOR_NON_ADMIN | {"external_interview", "review_submitted"}


async def test_the_pipeline_row_loses_the_interview_link_but_keeps_the_candidate_id(client, standard_headers, admin_headers, world):
    std = (await client.get(f"/api/v1/jobs/{world['job_id']}/pipeline", headers=standard_headers)).json()
    row = std["pipeline"][0]
    assert row["candidate_id"] == world["cand_id"]
    assert "secure_token" not in row
    assert row["review_submitted"] is True and row["external_status"] == "reviewed"
    assert row["similarity_score"] == 0.91

    adm = (await client.get(f"/api/v1/jobs/{world['job_id']}/pipeline", headers=admin_headers)).json()
    assert adm["pipeline"][0]["secure_token"] == world["cand_token"]


async def test_the_offer_loses_the_accept_link_and_the_signature_record(client, standard_headers, world):
    one = (await client.get(f"/api/v1/offers/{world['offer_id']}", headers=standard_headers)).json()
    assert set(one) <= OFFER_FIELDS_FOR_NON_ADMIN
    assert one["salary"] == "100000" and one["status"] == "sent"
    listed = (await client.get("/api/v1/offers", headers=standard_headers)).json()["offers"]
    mine = next(o for o in listed if o["offer_id"] == world["offer_id"])
    assert set(mine) <= OFFER_FIELDS_FOR_NON_ADMIN


async def test_the_profile_loses_the_cross_job_notes(client, standard_headers, admin_headers, world):
    std = (await client.get(f"/api/v1/candidates/profile/{world['profile_id']}", headers=standard_headers)).json()
    assert "profile_notes" not in std and std["linked_candidates"][0]["candidate_id"] == world["cand_id"]
    adm = (await client.get(f"/api/v1/candidates/profile/{world['profile_id']}", headers=admin_headers)).json()
    assert adm["profile_notes"] == "MARK-PROFILE-NOTE"


async def test_the_timeline_hides_the_reason_a_candidate_was_turned_down(client, standard_headers, world):
    db = get_db()
    other = f"cand-other-{world['tag']}"
    await db.candidates.insert_one({
        "doc_type": "candidate", "candidate_id": other, "job_id": world["job_id"], "email": world["email"],
        "name": "Lock Down", "status": "rejected", "decision": "reject", "decision_reason": "MARK-DECISION-REASON",
        "created_at": "2026-01-05T00:00:00+00:00",
    })
    try:
        resp = await client.get(f"/api/v1/candidates/{world['cand_id']}/timeline", headers=standard_headers)
        assert resp.status_code == 200
        assert resp.json()["timeline"][0]["decision"] == "reject"
        assert_clean(resp, world, where="timeline")
    finally:
        await db.candidates.delete_one({"candidate_id": other})


async def test_an_admin_still_receives_the_full_candidate_document(client, admin_headers, world):
    body = (await client.get(f"/api/v1/candidates/{world['cand_id']}", headers=admin_headers)).json()
    for key in ("report", "score_breakdown", "eval_score", "final_score", "transcript", "integrity_flags",
                "external_review", "interview_scorecards", "interview_guide", "decision_notes",
                "recruiter_notes", "secure_token"):
        assert key in body, f"an admin lost {key}"
    listed = (await client.get(f"/api/v1/candidates?job_id={world['job_id']}", headers=admin_headers)).json()["candidates"]
    assert listed[0]["report"]["summary"] == "MARK-REPORT-SUMMARY"
    offer = (await client.get(f"/api/v1/offers/{world['offer_id']}", headers=admin_headers)).json()
    assert offer["secure_token"] == world["offer_token"] and offer["signature"]["typed_name"] == "MARK-OFFER-SIGNATURE"
    sup = (await client.get(f"/api/v1/candidates/{world['cand_id']}", headers={"Authorization": "Bearer demo-superadmin-token"})).json()
    assert sup["report"]["final_score"] == 77


async def test_report_and_review_routes_refuse_a_standard_user(client, standard_headers, world):
    base = "/api/v1"
    token, cid = world["cand_token"], world["cand_id"]
    for method, url in (
        ("GET", f"{base}/interview/report/{token}"),
        ("GET", f"{base}/interview/report/{token}/pdf"),
        ("GET", f"{base}/interview/report/{token}/shares"),
        ("POST", f"{base}/interview/report/{token}/share"),
        ("GET", f"{base}/candidates/{cid}/external-review"),
        ("GET", f"{base}/candidates/{cid}/interview-guide"),
        ("GET", f"{base}/candidates/{cid}/interviewer-links"),
        ("GET", f"{base}/coding/submissions"),
        ("GET", f"{base}/coding/submissions/{cid}"),
        ("GET", f"{base}/coding/live/{cid}"),
        ("GET", f"{base}/offers/{world['offer_id']}/pdf"),
        ("GET", f"{base}/interview/{cid}/schedule.ics"),
    ):
        resp = await client.request(method, url, headers=standard_headers, json={} if method == "POST" else None)
        assert resp.status_code == 403, f"{method} {url} -> {resp.status_code}"


async def test_report_routes_work_for_an_admin(client, admin_headers, world):
    resp = await client.get(f"/api/v1/interview/report/{world['cand_token']}", headers=admin_headers)
    assert resp.status_code == 200 and resp.json()["report"]["summary"] == "MARK-REPORT-SUMMARY"


async def test_redaction_is_an_allow_list_and_never_adds_null_placeholders():
    doc = {
        "candidate_id": "c1", "name": "A", "status": "completed", "report": {"x": 1}, "eval_score": 5,
        "brand_new_field": "not yet reviewed",
    }
    out = redact_candidate({"role": "standard"}, doc)
    assert out == {"candidate_id": "c1", "name": "A", "status": "completed"}
    assert "report" not in out and "eval_score" not in out and "brand_new_field" not in out
    assert redact_candidate({"role": "admin"}, doc) is doc
    assert redact_candidate({"role": "superadmin"}, doc) is doc
    assert redact_candidate({"role": "some-custom-role"}, doc) == out
    assert redact_candidate({}, doc) == out
    assert redact_candidate({"role": "standard"}, None) is None


async def test_every_key_in_the_access_rule_is_denied_by_the_scrub_and_missing_from_the_allow_lists():
    rule = {"report", "score_breakdown", "eval_score", "final_score", "transcript", "integrity_flags",
            "external_review", "interview_scorecards", "decision_notes"}
    assert rule <= ADMIN_ONLY_KEYS
    assert rule.isdisjoint(CANDIDATE_FIELDS_FOR_NON_ADMIN)
    assert {"secure_token", "signature"}.isdisjoint(OFFER_FIELDS_FOR_NON_ADMIN)
    assert "secure_token" not in CANDIDATE_FIELDS_FOR_NON_ADMIN
    nested = {"a": [{"report": 1, "keep": 2}], "secure_token": "t", "ok": {"transcript": [], "n": 1}}
    assert scrub_admin_only({"role": "standard"}, nested) == {"a": [{"keep": 2}], "ok": {"n": 1}}
    assert scrub_admin_only({"role": "admin"}, nested) is nested


async def test_redact_offer_keeps_the_commercial_fields_only():
    offer = {"offer_id": "o", "salary": "1", "status": "sent", "secure_token": "t", "signature": {}, "decline_reason": "x"}
    assert redact_offer({"role": "standard"}, offer) == {"offer_id": "o", "salary": "1", "status": "sent"}


async def test_no_get_route_open_to_a_standard_user_leaks_a_report_or_a_credential(client, standard_headers, world):
    values = {
        "candidate_id": world["cand_id"], "job_id": world["job_id"], "resume_id": world["resume_id"],
        "offer_id": world["offer_id"], "profile_id": world["profile_id"], "email": world["email"],
    }
    swept = []
    for info in all_routes():
        if (
            info.methods != {"GET"} or info.admin_gated or info.platform_gated
            or not info.authenticated or info.permissions
        ):
            continue
        needed = re.findall(r"{(\w+)}", info.path)
        if any(name not in values for name in needed):
            continue
        if info.path.startswith(("/api/v1/analytics", "/api/v1/intel", "/api/v1/auth", "/api/v1/user-guide")):
            continue
        url = info.path
        for name in needed:
            url = url.replace("{" + name + "}", values[name])
        resp = await client.get(url, headers=standard_headers)
        assert resp.status_code < 500, f"{url}: {resp.status_code}"
        if resp.status_code == 200:
            assert_clean(resp, world, where=url)
            swept.append(url)
    joined = " ".join(swept)
    for needle in ("/candidates/" + world["cand_id"], "/pipeline", "/offers/" + world["offer_id"], "/resumes/"):
        assert needle in joined, f"the sweep never reached {needle}"
