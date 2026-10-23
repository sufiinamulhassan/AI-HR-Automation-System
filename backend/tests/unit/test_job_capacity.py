from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

import config.database as database
from config import tenancy
from config.settings import settings
from fake_mongo import FakeRaw
from main import app
from services.hr_module import job_capacity, matcher
from shared import quotas

pytestmark = pytest.mark.anyio

ADMIN = {"Authorization": "Bearer demo-superadmin-token"}
STANDARD = {"Authorization": "Bearer demo-standard-token"}
COMPANY = tenancy.DEFAULT_COMPANY_ID
OTHER = "cmp_other"


def entry(resume_id, score, stage="matched", **extra):
    return {"resume_id": resume_id, "similarity_score": score, "pipeline_stage": stage, **extra}


def job(job_id="j1", title="Backend Engineer", pipeline=(), **extra):
    return {
        "doc_type": "job", "job_id": job_id, "title": title, "description": "d", "deadline_at": None,
        "candidate_pipeline": list(pipeline), "created_at": "2026-01-01T00:00:00+00:00", **extra,
    }


def resume(resume_id, name):
    return {
        "resume_id": resume_id, "candidate_name": name, "filename": f"{resume_id}.pdf",
        "processing_status": "processed", "created_at": "2026-01-01T00:00:00+00:00",
    }


def test_no_limit_means_always_accepting():
    assert job_capacity.max_resumes({}) is None
    assert job_capacity.max_resumes({"max_resumes": 0}) is None
    assert job_capacity.max_resumes({"max_resumes": True}) is None
    assert job_capacity.is_full({"candidate_pipeline": [entry("a", 0.1)] * 500}) is False
    assert job_capacity.capacity_view({"candidate_pipeline": []})["accepting"] is True


def test_a_job_is_full_once_its_pipeline_reaches_the_limit():
    half = {"max_resumes": 2, "candidate_pipeline": [entry("a", 0.5)]}
    full = {"max_resumes": 2, "candidate_pipeline": [entry("a", 0.5), entry("b", 0.6)]}
    assert job_capacity.remaining_slots(half) == 1 and not job_capacity.is_full(half)
    assert job_capacity.remaining_slots(full) == 0 and job_capacity.is_full(full)
    assert job_capacity.capacity_view(full) == {"max_resumes": 2, "resume_count": 2, "remaining": 0, "accepting": False}


def test_minimum_score_is_a_percentage_of_the_match():
    assert job_capacity.below_minimum({"min_match_score": 50}, 0.49) is True
    assert job_capacity.below_minimum({"min_match_score": 50}, 0.5) is False
    assert job_capacity.below_minimum({}, 0.01) is False
    assert job_capacity.below_minimum({"min_match_score": 50}, None) is False


def test_prune_targets_take_scores_below_the_minimum_and_spare_hired_and_unscored():
    pipeline = [
        entry("low", 0.30), entry("mid", 0.55), entry("high", 0.80),
        entry("hired", 0.20, "hired"), entry("upload", 0.0, targeted_upload=True), entry("lower", 0.10),
    ]
    targets, protected = job_capacity.prune_targets({"candidate_pipeline": pipeline}, 56)
    assert [t["resume_id"] for t in targets] == ["lower", "low", "mid"]
    assert [p["resume_id"] for p in protected] == ["hired"]


def _pool_db(job_doc, present):
    db = MagicMock()
    db.jobs.find_one = AsyncMock(return_value=job_doc)
    db.jobs.update_one = AsyncMock()
    db.resumes.find.return_value.to_list = AsyncMock(return_value=[{"resume_id": r} for r in present])
    return db


def _pinecone(matches):
    pc = MagicMock()
    pc.query.return_value = MagicMock(matches=[
        {"id": rid, "score": score, "metadata": {"job_domain": "marketing"}} for rid, score in matches
    ])
    return pc


async def _match(db, pc):
    with patch.object(matcher, "get_db", return_value=db), patch.object(matcher, "get_pinecone", return_value=pc):
        return await matcher.match_jd_to_resume_pool("j1", {"required_domain": "marketing"}, [0.1] * 8)


async def test_the_matcher_fills_only_the_free_slots_with_the_best_scores():
    db = _pool_db({"deadline_at": None, "max_resumes": 3, "candidate_pipeline": [entry("old", 0.7)]}, ["a", "b", "c"])
    res = await _match(db, _pinecone([("a", 0.50), ("b", 0.90), ("c", 0.70)]))
    assert [m["resume_id"] for m in res] == ["b", "c"]
    assert db.jobs.update_one.await_count == 2


async def test_the_matcher_skips_removed_resumes_and_scores_below_the_job_minimum():
    db = _pool_db(
        {"deadline_at": None, "min_match_score": 60, "removed_candidates": [{"resume_id": "gone"}]},
        ["gone", "weak", "good"],
    )
    res = await _match(db, _pinecone([("gone", 0.95), ("weak", 0.45), ("good", 0.75)]))
    assert [m["resume_id"] for m in res] == ["good"]
    pushed_filter = db.jobs.update_one.await_args.args[0]
    assert pushed_filter["removed_candidates.resume_id"] == {"$ne": "good"}


async def test_the_matcher_adds_nothing_to_a_full_job():
    db = _pool_db({"deadline_at": None, "max_resumes": 1, "candidate_pipeline": [entry("old", 0.7)]}, ["a"])
    assert await _match(db, _pinecone([("a", 0.99)])) == []
    db.jobs.update_one.assert_not_called()


async def test_a_resume_is_not_matched_into_a_full_job_or_one_it_was_removed_from():
    db = MagicMock()
    db.jobs.find.return_value.to_list = AsyncMock(return_value=[
        {"job_id": "full", "deadline_at": None, "max_resumes": 1, "candidate_pipeline": [entry("x", 0.5)]},
        {"job_id": "removed", "deadline_at": None, "removed_candidates": [{"resume_id": "me"}]},
        {"job_id": "open", "deadline_at": None, "max_resumes": 5, "candidate_pipeline": []},
    ])
    db.jobs.update_one = AsyncMock()
    pc = MagicMock()
    pc.query.return_value = MagicMock(matches=[
        {"id": jid, "score": 0.9, "metadata": {"job_domain": "marketing"}} for jid in ("full", "removed", "open")
    ])
    with patch.object(matcher, "get_db", return_value=db), patch.object(matcher, "get_pinecone", return_value=pc):
        res = await matcher.match_resume_to_jds("me", [0.1] * 8, {"job_domain": "marketing"})
    assert [m["job_id"] for m in res] == ["open"]


@pytest.fixture
async def world(monkeypatch):
    raw = FakeRaw()
    monkeypatch.setattr(database, "_db", raw)
    monkeypatch.setattr(tenancy, "_fallback_company_id", None)
    monkeypatch.setattr(settings, "ALLOW_DEMO_AUTH", True)
    monkeypatch.setattr(settings, "HACKATHON_DEMO_MODE", False)
    monkeypatch.setattr(settings, "DEMO_COMPANY_ID", "")
    monkeypatch.setattr(database, "get_pinecone", lambda: None)
    monkeypatch.setattr(quotas, "check_ai_action", AsyncMock())
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as client:
        yield SimpleNamespace(raw=raw, client=client)


@pytest.fixture
def stocked(world):
    for rid, name in (("ana", "Ana Ruiz"), ("ben", "Ben Cole"), ("cat", "Cat Lee"), ("dan", "Dan Wu")):
        world.raw.add("resumes", resume(rid, name), COMPANY)
    world.raw.add("jobs", job("j1", "Backend Engineer", [
        entry("ana", 0.81), entry("ben", 0.42), entry("cat", 0.30), entry("dan", 0.20, "hired"),
    ]), COMPANY)
    world.raw.add("jobs", job("j2", "Data Analyst", [entry("ben", 0.59), entry("ana", 0.50)]), COMPANY)
    world.raw.add("jobs", job("j9", "Foreign Role", [entry("ana", 0.99)]), OTHER)
    return world


def stored_job(world, job_id):
    return next(j for j in world.raw["jobs"].docs if j["job_id"] == job_id)


async def test_the_popup_lists_every_job_a_resume_is_in_from_highest_score_to_lowest(stocked):
    response = await stocked.client.get("/api/v1/resumes/ana/jobs", headers=ADMIN)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["candidate_name"] == "Ana Ruiz"
    assert [(j["job_id"], j["score"], j["status"]) for j in body["jobs"]] == [
        ("j1", 0.81, "active"), ("j2", 0.5, "active"),
    ]
    assert body["total"] == 2


async def test_the_popup_answers_404_for_an_unknown_resume(stocked):
    assert (await stocked.client.get("/api/v1/resumes/nobody/jobs", headers=ADMIN)).status_code == 404


async def test_a_dry_run_previews_who_would_be_removed_without_changing_anything(stocked):
    response = await stocked.client.post(
        "/api/v1/jobs/j1/pipeline/prune", json={"min_score": 50, "mode": "job", "dry_run": True}, headers=ADMIN,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["matched"] == 2 and body["protected"] == 1 and body["removed"] == 0
    assert [(c["resume_id"], c["name"]) for c in body["candidates"]] == [("cat", "Cat Lee"), ("ben", "Ben Cole")]
    assert len(stored_job(stocked, "j1")["candidate_pipeline"]) == 4


async def test_removing_from_the_job_keeps_the_resume_and_marks_it_low_score_in_the_popup(stocked):
    response = await stocked.client.post(
        "/api/v1/jobs/j1/pipeline/prune", json={"min_score": 50, "mode": "job"}, headers=ADMIN,
    )
    assert response.status_code == 200, response.text
    assert response.json()["removed"] == 2
    j1 = stored_job(stocked, "j1")
    assert [p["resume_id"] for p in j1["candidate_pipeline"]] == ["ana", "dan"]
    assert {r["resume_id"] for r in j1["removed_candidates"]} == {"ben", "cat"}
    assert j1["min_match_score"] == 50
    assert {r["resume_id"] for r in stocked.raw["resumes"].docs} == {"ana", "ben", "cat", "dan"}

    popup = (await stocked.client.get("/api/v1/resumes/ben/jobs", headers=ADMIN)).json()
    assert [(j["job_id"], j["score"], j["status"]) for j in popup["jobs"]] == [
        ("j2", 0.59, "active"), ("j1", None, "removed"),
    ]


async def test_removing_twice_does_not_duplicate_the_removal_record(stocked):
    for _ in range(2):
        await stocked.client.post("/api/v1/jobs/j1/pipeline/prune", json={"min_score": 50, "mode": "job"}, headers=ADMIN)
    assert len(stored_job(stocked, "j1")["removed_candidates"]) == 2


async def test_deleting_from_the_system_removes_the_resumes_everywhere(stocked):
    response = await stocked.client.post(
        "/api/v1/jobs/j1/pipeline/prune", json={"min_score": 50, "mode": "system"}, headers=ADMIN,
    )
    assert response.status_code == 200, response.text
    assert response.json()["removed"] == 2
    assert {r["resume_id"] for r in stocked.raw["resumes"].docs} == {"ana", "dan"}
    assert [p["resume_id"] for p in stored_job(stocked, "j2")["candidate_pipeline"]] == ["ana"]
    assert stored_job(stocked, "j1").get("removed_candidates") in (None, [])


async def test_a_user_without_job_rights_cannot_prune(stocked):
    response = await stocked.client.post(
        "/api/v1/jobs/j1/pipeline/prune", json={"min_score": 50, "mode": "job"}, headers=STANDARD,
    )
    assert response.status_code == 403
    assert len(stored_job(stocked, "j1")["candidate_pipeline"]) == 4


@pytest.mark.parametrize("body", [
    {"min_score": 50, "mode": "everything"},
    {"min_score": 0, "mode": "job"},
    {"min_score": 101, "mode": "job"},
])
async def test_invalid_prune_requests_are_rejected(stocked, body):
    response = await stocked.client.post("/api/v1/jobs/j1/pipeline/prune", json=body, headers=ADMIN)
    assert response.status_code == 422


async def test_another_companys_job_cannot_be_pruned(stocked):
    response = await stocked.client.post(
        "/api/v1/jobs/j9/pipeline/prune", json={"min_score": 50, "mode": "job"}, headers=ADMIN,
    )
    assert response.status_code == 404


async def test_a_job_reports_its_resume_limit_and_zero_clears_it(stocked):
    stored_job(stocked, "j2")["max_resumes"] = 2
    detail = (await stocked.client.get("/api/v1/jobs/j2", headers=ADMIN)).json()
    assert (detail["max_resumes"], detail["resume_count"], detail["remaining"], detail["accepting"]) == (2, 2, 0, False)

    response = await stocked.client.patch("/api/v1/jobs/j2", json={"max_resumes": 0}, headers=ADMIN)
    assert response.status_code == 200, response.text
    assert stored_job(stocked, "j2")["max_resumes"] is None
    assert (await stocked.client.get("/api/v1/jobs/j2", headers=ADMIN)).json()["accepting"] is True


async def test_a_negative_resume_limit_is_rejected(stocked):
    response = await stocked.client.patch("/api/v1/jobs/j2", json={"max_resumes": -1}, headers=ADMIN)
    assert response.status_code == 422


async def test_an_explicit_attach_to_a_full_job_is_skipped_but_one_already_there_is_updated():
    from services.hr_module.resume_intake_service import attach_to_pipeline

    db = MagicMock()
    db.jobs.find_one = AsyncMock(return_value={"max_resumes": 1, "candidate_pipeline": [entry("old", 0.5)]})
    db.jobs.update_one = AsyncMock(return_value=SimpleNamespace(matched_count=1))
    await attach_to_pipeline(db, "j1", "new", 0.9)
    db.jobs.update_one.assert_not_called()

    await attach_to_pipeline(db, "j1", "old", 0.9, {"source": "career_page"})
    assert db.jobs.update_one.await_count == 1


async def test_an_explicit_attach_clears_an_earlier_low_score_removal():
    from services.hr_module.resume_intake_service import attach_to_pipeline

    db = MagicMock()
    db.jobs.find_one = AsyncMock(return_value={"candidate_pipeline": [], "removed_candidates": [{"resume_id": "me"}]})
    db.jobs.update_one = AsyncMock(return_value=SimpleNamespace(matched_count=1))
    await attach_to_pipeline(db, "j1", "me", 0.4)
    first = db.jobs.update_one.await_args_list[0].args
    assert first[1] == {"$pull": {"removed_candidates": {"resume_id": "me"}}}
    assert db.jobs.update_one.await_count == 2
