import uuid
from datetime import datetime, timedelta, timezone

import pytest

from config.database import get_db
from services.hr_module.candidate_scope import ResumeScope
from services.hr_module.demographics_service import compute_diversity_breakdown

pytestmark = pytest.mark.anyio


def _id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4()}"


async def _funnel(client, headers) -> dict:
    res = await client.get("/api/v1/intel/resumes/stats", headers=headers)
    assert res.status_code == 200
    return res.json()["invite_funnel"]


async def _dashboard(client, headers) -> dict:
    res = await client.get("/api/v1/analytics/dashboard", headers=headers)
    assert res.status_code == 200
    return res.json()


async def _resume(db, resume_id: str) -> None:
    await db.resumes.insert_one({
        "resume_id": resume_id, "filename": f"{resume_id}.pdf", "processing_status": "processed",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })


def _candidate(resume_id: str | None, **extra) -> dict:
    now = datetime.now(timezone.utc)
    return {
        "doc_type": "candidate", "candidate_id": _id("cand"), "resume_id": resume_id,
        "invite_sent_at": (now - timedelta(days=2)).isoformat(), **extra,
    }


async def _cleanup(db, *, resumes=(), candidates=(), offers=(), submissions=(), demographics=()):
    await db.resumes.delete_many({"resume_id": {"$in": list(resumes)}})
    await db.candidates.delete_many({"candidate_id": {"$in": list(candidates)}})
    await db.offers.delete_many({"candidate_id": {"$in": list(offers)}})
    await db.coding_submissions.delete_many({"candidate_id": {"$in": list(submissions)}})
    await db.candidate_demographics.delete_many({"candidate_id": {"$in": list(demographics)}})


async def test_scope_hides_only_candidates_whose_resume_is_gone(client):
    db = get_db()
    live_rid, gone_rid = _id("live"), _id("gone")
    live = _candidate(live_rid)
    orphan = _candidate(gone_rid)
    by_hand = _candidate(None)
    blank = _candidate("")
    try:
        await _resume(db, live_rid)
        await db.candidates.insert_many([live, orphan, by_hand, blank])
        scope = await ResumeScope.load(db)
        assert gone_rid in scope.orphan_resume_ids
        assert live_rid not in scope.orphan_resume_ids
        assert orphan["candidate_id"] in scope.orphan_candidate_ids
        for kept in (live, by_hand, blank):
            assert kept["candidate_id"] not in scope.orphan_candidate_ids

        shown = {c["candidate_id"] async for c in db.candidates.find(scope.candidates({"candidate_id": {
            "$in": [live["candidate_id"], orphan["candidate_id"], by_hand["candidate_id"], blank["candidate_id"]]}}))}
        assert shown == {live["candidate_id"], by_hand["candidate_id"], blank["candidate_id"]}
    finally:
        await _cleanup(db, resumes=[live_rid],
                       candidates=[c["candidate_id"] for c in (live, orphan, by_hand, blank)])


async def test_scope_is_a_no_op_when_nothing_is_orphaned(client):
    assert ResumeScope().candidates({"status": "completed"}) == {"status": "completed"}
    assert ResumeScope().candidates() == {}
    assert ResumeScope().by_candidate_id() == {}


async def test_funnel_ignores_candidates_of_deleted_resumes(client, standard_headers):
    db = get_db()
    live_rid, gone_rid = _id("live"), _id("gone")
    orphans = [
        _candidate(gone_rid, invite_type="auto", status="completed", pipeline_stage="hired"),
        _candidate(gone_rid, invite_type="manual", status="completed", pipeline_stage="hired"),
    ]
    ids = [c["candidate_id"] for c in orphans]
    try:
        await _resume(db, live_rid)
        before = await _funnel(client, standard_headers)
        await db.candidates.insert_many(orphans)
        assert await _funnel(client, standard_headers) == before

        live = _candidate(live_rid, invite_type="auto", status="completed", pipeline_stage="hired")
        by_hand = _candidate(None, invite_type="manual")
        await db.candidates.insert_many([live, by_hand])
        ids += [live["candidate_id"], by_hand["candidate_id"]]

        after = await _funnel(client, standard_headers)
        assert after["auto_invited"] == before["auto_invited"] + 1
        assert after["manually_invited"] == before["manually_invited"] + 1
        assert after["interviewed"] == before["interviewed"] + 1
        assert after["hired"] == before["hired"] + 1
    finally:
        await _cleanup(db, resumes=[live_rid], candidates=ids)


async def test_deleting_a_resume_through_the_api_drops_the_candidate_from_the_funnel(
    client, admin_headers, standard_headers
):
    db = get_db()
    rid = _id("rid")
    cand = _candidate(rid, invite_type="auto", status="completed")
    try:
        await _resume(db, rid)
        await db.candidates.insert_one(cand)
        counted = await _funnel(client, standard_headers)

        res = await client.delete(f"/api/v1/resumes/{rid}", headers=admin_headers)
        assert res.status_code == 200

        gone = await _funnel(client, standard_headers)
        assert gone["auto_invited"] == counted["auto_invited"] - 1
        assert gone["interviewed"] == counted["interviewed"] - 1
        assert await db.candidates.find_one({"candidate_id": cand["candidate_id"]}) is not None
    finally:
        await _cleanup(db, resumes=[rid], candidates=[cand["candidate_id"]])


async def test_dashboard_sections_ignore_candidates_of_deleted_resumes(client, admin_headers):
    db = get_db()
    live_rid, gone_rid = _id("live"), _id("gone")
    source, recruiter = _id("src"), f"{_id('rec')}@example.com"

    def hired(rid):
        return _candidate(rid, application_source=source, invited_by=recruiter, status="completed",
                          decision="hire", decided_at=datetime.now(timezone.utc).isoformat(),
                          coding_question_id="q1")

    orphan, live = hired(gone_rid), hired(live_rid)
    ids = [orphan["candidate_id"], live["candidate_id"]]
    try:
        await _resume(db, live_rid)
        before = await _dashboard(client, admin_headers)
        await db.candidates.insert_many([orphan, live])
        for c in (orphan, live):
            await db.offers.insert_one(
                {"offer_id": _id("offer"), "candidate_id": c["candidate_id"], "status": "accepted"})
            await db.coding_submissions.insert_one(
                {"submission_id": _id("sub"), "candidate_id": c["candidate_id"], "score": 80})
        after = await _dashboard(client, admin_headers)

        assert after["source_wise_applications"][source] == 1
        perf = {r["recruiter_email"]: r for r in after["recruiter_performance"]}
        assert perf[recruiter]["invited"] == 1 and perf[recruiter]["hired"] == 1

        assert after["time_to_hire"]["sample_size"] == before["time_to_hire"]["sample_size"] + 1
        assert after["offer_acceptance_rate"]["accepted"] == before["offer_acceptance_rate"]["accepted"] + 1
        stages = {s["stage"]: s["count"] for s in after["candidate_drop_off"]}
        stages_before = {s["stage"]: s["count"] for s in before["candidate_drop_off"]}
        assert stages["completed"] == stages_before["completed"] + 1
        coding, coding_before = after["coding_assessment"], before["coding_assessment"]
        assert coding["candidates_assigned"] == coding_before["candidates_assigned"] + 1
        assert coding["total_submissions"] == coding_before["total_submissions"] + 1
        assert coding["graded_submissions"] == coding_before["graded_submissions"] + 1
    finally:
        await _cleanup(db, resumes=[live_rid], candidates=ids, offers=ids, submissions=ids)


async def test_diversity_breakdown_ignores_candidates_of_deleted_resumes(client):
    db = get_db()
    live_rid, gone_rid = _id("live"), _id("gone")
    place = _id("place")
    live, orphan = _candidate(live_rid), _candidate(gone_rid)
    ids = [live["candidate_id"], orphan["candidate_id"]]
    try:
        await _resume(db, live_rid)
        await db.candidates.insert_many([live, orphan])
        for c in (live, orphan):
            await db.candidate_demographics.insert_one(
                {"candidate_id": c["candidate_id"], "gender": "female", "location": place})
        scope = await ResumeScope.load(db)
        scoped = await compute_diversity_breakdown(db, scope)
        unscoped = await compute_diversity_breakdown(db)
        assert scoped["breakdown"]["by_location"][place] == 1
        assert unscoped["breakdown"]["by_location"][place] == 2
    finally:
        await _cleanup(db, resumes=[live_rid], candidates=ids, demographics=ids)
