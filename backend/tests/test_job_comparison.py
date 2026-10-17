import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from config.database import get_db
from services.hr_module import email_service

pytestmark = pytest.mark.anyio

DIMS = ("technical", "communication", "problem_solving", "cultural_fit", "confidence")
ROW_KEYS = {
    "rank", "candidate_id", "resume_id", "name", "stage", "source", "final_score", "dimensions",
    "recommendation", "interviewed_at", "match_score", "offer_status", "secure_token",
}
BASE = datetime(2026, 9, 1, 12, 0, 0, tzinfo=timezone.utc)


def at(hours: int) -> str:
    return (BASE + timedelta(hours=hours)).isoformat()


def report(final: int, *, source: str | None = None, recommendation: str | None = "hire", dims: dict | None = None) -> dict:
    out: dict = {"final_score": final, "overall_score": final, "summary": "A written summary."}
    if recommendation is not None:
        out["recommendation"] = recommendation
    if source:
        out["source"] = source
    for key, value in (dims if dims is not None else {k: final for k in DIMS}).items():
        out[f"{key}_score"] = value
    return out


@pytest.fixture
async def seed():
    db = get_db()
    created = {"jobs": [], "candidates": []}

    async def job(**fields) -> str:
        job_id = f"cmp-job-{uuid.uuid4().hex[:10]}"
        await db.jobs.insert_one({
            "doc_type": "job", "job_id": job_id, "title": "Data Analyst", "company_name": "Compare Corp",
            "candidate_pipeline": [], **fields,
        })
        created["jobs"].append(job_id)
        return job_id

    async def candidate(
        job_id: str, name: str, *, final=None, rep="__default__", entry_stage="completed", status="completed",
        pipeline_stage=None, ended=None, match=0.8, **extra,
    ) -> str:
        cid = str(uuid.uuid4())
        resume_id = f"cmp-resume-{uuid.uuid4().hex[:10]}"
        await db.jobs.update_one({"job_id": job_id}, {"$push": {"candidate_pipeline": {
            "resume_id": resume_id, "similarity_score": 0.55, "pipeline_stage": entry_stage,
        }}})
        doc = {
            "doc_type": "candidate", "candidate_id": cid, "job_id": job_id, "resume_id": resume_id,
            "name": name, "email": f"{uuid.uuid4().hex[:8]}@cmp.example.com", "secure_token": f"tok_{uuid.uuid4().hex[:12]}",
            "status": status, "pipeline_stage": pipeline_stage or status, "match_score": match,
            "transcript": [{"question": "q", "answer": "private transcript text"}],
        }
        if rep == "__default__":
            rep = report(final) if final is not None else None
        if rep is not None:
            doc["report"] = rep
            doc["final_score"] = final
            doc["report_status"] = "ready"
        if ended:
            doc["interview_ended_at"] = ended
        doc.update(extra)
        await db.candidates.insert_one(doc)
        created["candidates"].append(cid)
        return cid

    yield SimpleNamespace(db=db, job=job, candidate=candidate, created=created)

    for cid in created["candidates"]:
        doc = await db.candidates.find_one({"candidate_id": cid}, {"email": 1})
        await db.candidates.delete_one({"candidate_id": cid})
        await db.offers.delete_many({"candidate_id": cid})
        await db.email_log.delete_many({"candidate_id": cid})
        await db.audit_log.delete_many({"resource_id": cid})
        if doc and doc.get("email"):
            await db.candidate_profiles.delete_many({"email": doc["email"]})
    for job_id in created["jobs"]:
        await db.jobs.delete_one({"job_id": job_id})
        await db.audit_log.delete_many({"resource_id": job_id})
    await asyncio.sleep(0)


async def compare(client, headers, job_id, **params):
    return await client.get(f"/api/v1/jobs/{job_id}/comparison", params=params, headers=headers)


def names(resp) -> list[str]:
    return [r["name"] for r in resp.json()["rows"]]


async def test_ai_and_scorecard_rows_are_ranked_together(client, admin_headers, seed):
    job_id = await seed.job()
    await seed.candidate(job_id, "Ana", final=82, ended=at(5))
    scored = await seed.candidate(
        job_id, "Bea", final=91, ended=at(9),
        rep=report(91, source="interviewer_scorecard", recommendation="hire", dims={
            "technical": 100, "communication": 80, "problem_solving": 80, "cultural_fit": 60, "confidence": 80,
        }),
    )
    await seed.candidate(job_id, "Cy", final=82, ended=at(2))
    await seed.candidate(job_id, "Dee", final=82)
    await seed.candidate(job_id, "Eli", final=60, ended=at(1), rep=report(60, recommendation="maybe", dims={"technical": 55}))

    resp = await compare(client, admin_headers, job_id)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert set(body) == {"job_id", "title", "rows", "stats"}
    assert body["job_id"] == job_id and body["title"] == "Data Analyst"
    assert names(resp) == ["Bea", "Cy", "Ana", "Dee", "Eli"]
    assert [r["rank"] for r in body["rows"]] == [1, 2, 3, 4, 5]
    assert [r["final_score"] for r in body["rows"]] == [91, 82, 82, 82, 60]
    assert body["stats"] == {"count": 5, "average": 79.4, "highest": 91}

    bea, eli = body["rows"][0], body["rows"][4]
    assert set(bea) == ROW_KEYS
    assert bea["candidate_id"] == scored and bea["source"] == "interviewer_scorecard"
    assert bea["dimensions"] == {"technical": 100, "communication": 80, "problem_solving": 80, "cultural_fit": 60, "confidence": 80}
    assert bea["recommendation"] == "hire" and bea["interviewed_at"] == at(9)
    assert bea["stage"] == "completed" and bea["match_score"] == 0.8 and bea["offer_status"] is None
    assert bea["secure_token"].startswith("tok_") and bea["resume_id"].startswith("cmp-resume-")
    assert [r["source"] for r in body["rows"]] == ["interviewer_scorecard", "ai", "ai", "ai", "ai"]
    assert eli["dimensions"] == {"technical": 55, "communication": None, "problem_solving": None, "cultural_fit": None, "confidence": None}
    assert eli["recommendation"] == "maybe"
    assert body["rows"][3]["interviewed_at"] is None


async def test_the_table_holds_no_contact_details_or_transcripts(client, admin_headers, seed):
    job_id = await seed.job()
    await seed.candidate(job_id, "Ana", final=70)
    resp = await compare(client, admin_headers, job_id)
    assert "@cmp.example.com" not in resp.text and "private transcript text" not in resp.text


async def test_recommendation_and_numbers_are_cleaned(client, admin_headers, seed):
    job_id = await seed.job()
    await seed.candidate(job_id, "Odd", final=70, rep=report(70, recommendation="strong_hire", dims={
        "technical": "high", "communication": True, "problem_solving": 72.5, "cultural_fit": None, "confidence": 0,
    }))
    row = (await compare(client, admin_headers, job_id)).json()["rows"][0]
    assert row["recommendation"] is None
    assert row["dimensions"] == {"technical": None, "communication": None, "problem_solving": 72.5, "cultural_fit": None, "confidence": 0}


async def test_the_final_score_falls_back_to_the_one_inside_the_report(client, admin_headers, seed):
    job_id = await seed.job()
    cid = await seed.candidate(job_id, "Ana", final=77)
    await seed.db.candidates.update_one({"candidate_id": cid}, {"$unset": {"final_score": ""}})
    rows = (await compare(client, admin_headers, job_id)).json()["rows"]
    assert [r["final_score"] for r in rows] == [77]


async def test_the_latest_offer_status_is_shown(client, admin_headers, seed):
    job_id = await seed.job()
    ana = await seed.candidate(job_id, "Ana", final=80)
    await seed.candidate(job_id, "Bo", final=70)
    for status, created in (("draft", "2026-09-01T10:00:00+00:00"), ("sent", "2026-09-03T10:00:00+00:00"), ("withdrawn", "2026-09-02T10:00:00+00:00")):
        await seed.db.offers.insert_one({"doc_type": "offer", "offer_id": uuid.uuid4().hex, "candidate_id": ana,
                                         "job_id": job_id, "status": status, "created_at": created})
    rows = {r["name"]: r for r in (await compare(client, admin_headers, job_id)).json()["rows"]}
    assert rows["Ana"]["offer_status"] == "sent" and rows["Bo"]["offer_status"] is None


async def test_only_candidates_with_a_scored_report_for_this_job_appear(client, admin_headers, seed):
    job_id, other_job = await seed.job(), await seed.job()
    await seed.candidate(job_id, "Ana", final=80)
    await seed.candidate(job_id, "No report", rep=None)
    await seed.candidate(job_id, "Not scored", final=None, rep={
        "evaluation_status": "insufficient_transcript", "recommendation": "maybe", "summary": "No answers were captured.",
    })
    await seed.candidate(other_job, "Elsewhere", final=99)
    resp = await compare(client, admin_headers, job_id)
    assert names(resp) == ["Ana"] and resp.json()["stats"]["count"] == 1


async def test_a_job_with_no_scored_candidates_reads_empty(client, admin_headers, seed):
    job_id = await seed.job()
    resp = await compare(client, admin_headers, job_id)
    assert resp.status_code == 200
    assert resp.json()["rows"] == [] and resp.json()["stats"] == {"count": 0, "average": None, "highest": None}


async def test_the_stage_is_the_furthest_the_two_records_reach(client, admin_headers, seed):
    job_id = await seed.job()
    await seed.candidate(job_id, "Ai done", final=90, entry_stage="invited", status="completed", pipeline_stage="invited")
    await seed.candidate(job_id, "Moved", final=80, entry_stage="interviewing", status="invited", pipeline_stage="invited")
    await seed.candidate(job_id, "Hired", final=70, entry_stage="completed", status="hired", pipeline_stage="hired")
    rows = {r["name"]: r["stage"] for r in (await compare(client, admin_headers, job_id)).json()["rows"]}
    assert rows == {"Ai done": "completed", "Moved": "interviewing", "Hired": "hired"}


async def test_stage_filter(client, admin_headers, seed):
    job_id = await seed.job()
    await seed.candidate(job_id, "Done", final=90, entry_stage="completed", status="completed")
    await seed.candidate(job_id, "Hired", final=85, entry_stage="hired", status="hired")
    await seed.candidate(job_id, "Talking", final=60, entry_stage="interviewing", status="interviewing")

    hired = await compare(client, admin_headers, job_id, stage="hired")
    assert names(hired) == ["Hired"] and hired.json()["rows"][0]["rank"] == 1
    assert hired.json()["stats"] == {"count": 1, "average": 85, "highest": 85}
    assert names(await compare(client, admin_headers, job_id, stage="interviewing")) == ["Talking"]
    assert names(await compare(client, admin_headers, job_id)) == ["Done", "Hired", "Talking"]


async def test_an_unknown_stage_is_a_validation_error(client, admin_headers, seed):
    job_id = await seed.job()
    resp = await compare(client, admin_headers, job_id, stage="almost")
    assert resp.status_code == 422 and "stage" in resp.json()["detail"]


async def test_rejected_candidates_need_include_rejected(client, admin_headers, seed):
    job_id = await seed.job()
    await seed.candidate(job_id, "Keep", final=70)
    await seed.candidate(job_id, "Turned down", final=95, entry_stage="rejected", status="rejected")
    await seed.candidate(job_id, "Also out", final=75, entry_stage="completed", status="rejected", pipeline_stage="rejected")

    assert names(await compare(client, admin_headers, job_id)) == ["Keep"]
    assert names(await compare(client, admin_headers, job_id, include_rejected="false")) == ["Keep"]
    with_rejected = await compare(client, admin_headers, job_id, include_rejected="true")
    assert names(with_rejected) == ["Turned down", "Also out", "Keep"]
    assert with_rejected.json()["stats"]["count"] == 3
    assert names(await compare(client, admin_headers, job_id, stage="rejected")) == ["Turned down", "Also out"]
    assert [r["rank"] for r in (await compare(client, admin_headers, job_id)).json()["rows"]] == [1]


async def test_a_standard_user_gets_403(client, standard_headers, seed):
    job_id = await seed.job()
    await seed.candidate(job_id, "Ana", final=80)
    resp = await compare(client, standard_headers, job_id)
    assert resp.status_code == 403
    assert "Ana" not in resp.text


async def test_it_needs_a_sign_in(client, seed):
    job_id = await seed.job()
    assert (await client.get(f"/api/v1/jobs/{job_id}/comparison")).status_code == 401


async def test_an_unknown_job_is_a_404(client, admin_headers):
    resp = await compare(client, admin_headers, "no-such-job")
    assert resp.status_code == 404 and resp.json()["detail"] == "Job not found"


async def test_a_job_outside_the_callers_department_is_a_404(client, admin_headers, seed, monkeypatch):
    import routes.jobs as jobs_routes

    other = await seed.job(department_id="dept-b")
    own = await seed.job(department_id="dept-a")
    open_job = await seed.job()
    for job_id in (other, own, open_job):
        await seed.candidate(job_id, "Ana", final=80)

    async def scope_a(user):
        return "dept-a"

    monkeypatch.setattr(jobs_routes, "get_department_scope", scope_a)
    hidden = await compare(client, admin_headers, other)
    assert hidden.status_code == 404 and hidden.json()["detail"] == "Job not found"
    assert "Ana" not in hidden.text
    assert (await compare(client, admin_headers, own)).status_code == 200
    assert (await compare(client, admin_headers, open_job)).status_code == 200

    async def unscoped(user):
        return None

    monkeypatch.setattr(jobs_routes, "get_department_scope", unscoped)
    assert (await compare(client, admin_headers, other)).status_code == 200


async def test_a_scorecard_review_filed_through_the_api_appears_ranked(client, admin_headers, seed, monkeypatch):
    sent: list = []

    async def fake_send_email(**kwargs):
        sent.append(kwargs)
        return True

    monkeypatch.setattr(email_service, "send_email", fake_send_email)
    job_id = await seed.job()
    await seed.candidate(job_id, "Ai Candidate", final=60, ended=at(3), rep=report(60, recommendation="maybe"))

    start = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
    scheduled = await client.post("/api/v1/candidates/external-interview", headers=admin_headers, json={
        "job_id": job_id, "name": "Sam Rivera", "email": f"sam-{uuid.uuid4().hex[:8]}@example.com",
        "platform": "meet", "join_url": "https://meet.google.com/abc-defg-hij", "scheduled_start_at": start,
    })
    assert scheduled.status_code == 200, scheduled.text
    cid = scheduled.json()["candidate_id"]
    seed.created["candidates"].append(cid)

    review = await client.post(f"/api/v1/candidates/{cid}/external-review", headers=admin_headers, json={
        "attended": True, "recommendation": "hire",
        "ratings": {"technical": 5, "communication": 4, "problem_solving": 4, "cultural_fit": 3, "confidence": 4},
        "summary": "Strong on campaign strategy and clear when explaining trade-offs.",
    })
    assert review.status_code == 200, review.text

    resp = await compare(client, admin_headers, job_id)
    assert resp.status_code == 200, resp.text
    assert names(resp) == ["Sam Rivera", "Ai Candidate"]
    sam = resp.json()["rows"][0]
    assert sam["source"] == "interviewer_scorecard" and sam["final_score"] == 83 and sam["rank"] == 1
    assert sam["dimensions"] == {"technical": 100, "communication": 80, "problem_solving": 80, "cultural_fit": 60, "confidence": 80}
    assert sam["recommendation"] == "hire" and sam["stage"] == "completed" and sam["candidate_id"] == cid
    assert sam["interviewed_at"] is not None and sam["secure_token"]
    assert resp.json()["stats"] == {"count": 2, "average": 71.5, "highest": 83}
