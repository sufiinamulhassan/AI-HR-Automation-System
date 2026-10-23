import asyncio
import contextlib
import json
import uuid
from types import SimpleNamespace

import pytest

from config.database import get_db
from config.settings import settings
from services.hr_module.permissions import DEFAULT_ROLE_PERMISSIONS

pytestmark = pytest.mark.anyio

EM_DASH = chr(0x2014)
EN_DASH = chr(0x2013)


@pytest.fixture
async def seed():
    db = get_db()
    created = {"jobs": [], "resumes": []}

    async def job(*, pipeline=None, **fields) -> str:
        job_id = f"fit-job-{uuid.uuid4().hex[:10]}"
        doc = {
            "doc_type": "job", "job_id": job_id, "title": "Backend Engineer",
            "company_name": "Fit Test Corp", "candidate_pipeline": pipeline or [],
        }
        doc.update(fields)
        await db.jobs.insert_one(doc)
        created["jobs"].append(job_id)
        return job_id

    async def resume(**fields) -> str:
        resume_id = f"fit-resume-{uuid.uuid4().hex[:10]}"
        doc = {"doc_type": "resume", "resume_id": resume_id, "candidate_name": "Alex Kim"}
        doc.update(fields)
        await db.resumes.insert_one(doc)
        created["resumes"].append(resume_id)
        return resume_id

    yield SimpleNamespace(db=db, job=job, resume=resume)

    for job_id in created["jobs"]:
        await db.jobs.delete_one({"job_id": job_id})
        async for entry in db.audit_log.find({"resource_id": job_id}, {"_id": 1}):
            await db.audit_log.delete_one({"_id": entry["_id"]})
    for resume_id in created["resumes"]:
        await db.resumes.delete_one({"resume_id": resume_id})


def _entry(resume_id: str, score: float = 0.82, stage: str = "matched") -> dict:
    return {"resume_id": resume_id, "similarity_score": score, "pipeline_stage": stage}


def _targeting(skills=None, seniority=None, domain="software_engineering") -> dict:
    return {
        "required_domain": domain,
        "required_seniority": seniority if seniority is not None else ["senior", "lead"],
        "required_skills": skills if skills is not None else [],
    }


def _classification(**fields) -> dict:
    base = {"job_domain": "software_engineering", "seniority_level": "senior", "skills": []}
    base.update(fields)
    return base


async def _fit(client, headers, job_id, resume_id):
    return await client.get(f"/api/v1/jobs/{job_id}/pipeline/{resume_id}/fit", headers=headers)


async def test_fit_breakdown_math(client, standard_headers, seed):
    resume_id = await seed.resume(classification=_classification(
        skills=["python", "SQL", "Docker", "Go", "Rust"],
    ))
    job_id = await seed.job(
        targeting=_targeting(skills=["Python", "AWS", "SQL", "Docker"]),
        pipeline=[_entry(resume_id, 0.82)],
    )

    resp = await _fit(client, standard_headers, job_id, resume_id)
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["skills"]["matched"] == ["Python", "SQL", "Docker"]
    assert body["skills"]["missing"] == ["AWS"]
    assert body["skills"]["extra"] == ["Go", "Rust"]
    assert body["skills"]["coverage"] == pytest.approx(0.75)

    expected_boost = settings.SKILLS_WEIGHT * 0.5
    assert body["resume_id"] == resume_id
    assert body["candidate_name"] == "Alex Kim"
    assert body["score"] == pytest.approx(0.82)
    assert body["skills_boost"] == pytest.approx(expected_boost)
    assert body["semantic_part"] == pytest.approx(0.82 - expected_boost)
    assert body["semantic_part"] + body["skills_boost"] == pytest.approx(body["score"])

    assert body["threshold"] == pytest.approx(settings.AUTO_INVITE_THRESHOLD)
    assert body["above_threshold"] is (0.82 >= settings.AUTO_INVITE_THRESHOLD)

    assert body["seniority"] == {"candidate": "senior", "required": ["senior", "lead"], "aligned": True}
    assert body["domain"] == {
        "candidate": "software_engineering", "required": "software_engineering", "aligned": True,
    }

    headline = body["headline"]
    assert "82%" in headline and "3 of 4" in headline and "AWS" in headline
    assert EM_DASH not in headline and EN_DASH not in headline
    thr = round(settings.AUTO_INVITE_THRESHOLD * 100)
    assert f"the {thr}% match threshold" in headline
    assert "auto-invite" not in headline.lower()


async def test_fit_below_threshold_and_boost_never_exceeds_score(client, admin_headers, seed):
    resume_id = await seed.resume(classification=_classification(skills=["Python", "SQL"]))
    job_id = await seed.job(
        targeting=_targeting(skills=["Python", "SQL"]),
        pipeline=[_entry(resume_id, 0.1)],
    )

    body = (await _fit(client, admin_headers, job_id, resume_id)).json()

    assert body["skills_boost"] == pytest.approx(min(settings.SKILLS_WEIGHT, 0.1))
    assert body["semantic_part"] >= 0.0
    assert body["semantic_part"] + body["skills_boost"] == pytest.approx(0.1)
    assert body["above_threshold"] is False
    assert body["skills"]["coverage"] == pytest.approx(1.0)
    assert body["skills"]["missing"] == []
    assert "below" in body["headline"]
    assert "match threshold" in body["headline"]
    assert "auto-invite" not in body["headline"].lower()


async def test_fit_score_equal_to_threshold_counts_as_above(client, admin_headers, seed):
    resume_id = await seed.resume(classification=_classification())
    job_id = await seed.job(
        targeting=_targeting(),
        pipeline=[_entry(resume_id, settings.AUTO_INVITE_THRESHOLD)],
    )
    body = (await _fit(client, admin_headers, job_id, resume_id)).json()
    assert body["above_threshold"] is True


async def test_fit_extra_skills_capped_at_twelve(client, admin_headers, seed):
    resume_id = await seed.resume(classification=_classification(
        skills=[f"Skill{i}" for i in range(20)],
    ))
    job_id = await seed.job(targeting=_targeting(skills=["Skill0"]), pipeline=[_entry(resume_id)])

    body = (await _fit(client, admin_headers, job_id, resume_id)).json()
    assert body["skills"]["matched"] == ["Skill0"]
    assert len(body["skills"]["extra"]) == 12
    assert "Skill0" not in body["skills"]["extra"]


async def test_fit_misaligned_seniority_and_domain(client, admin_headers, seed):
    resume_id = await seed.resume(classification=_classification(
        seniority_level="junior", job_domain="marketing",
    ))
    job_id = await seed.job(targeting=_targeting(), pipeline=[_entry(resume_id)])

    body = (await _fit(client, admin_headers, job_id, resume_id)).json()
    assert body["seniority"]["aligned"] is False
    assert body["seniority"]["candidate"] == "junior"
    assert body["domain"]["aligned"] is False
    assert body["domain"]["candidate"] == "marketing"
    assert "outside the target range" in body["headline"]


async def test_fit_falls_back_to_parsed_criteria_when_targeting_is_empty(client, admin_headers, seed):
    resume_id = await seed.resume(classification=_classification(
        seniority_level="mid", skills=["Python"],
    ))
    job_id = await seed.job(
        targeting={},
        parsed_criteria={
            "skills": ["Python", "Kafka"], "experience_level": "senior",
            "job_domain": "software_engineering",
        },
        pipeline=[_entry(resume_id)],
    )

    body = (await _fit(client, admin_headers, job_id, resume_id)).json()
    assert body["seniority"]["required"] == ["mid", "senior", "lead"]
    assert body["seniority"]["aligned"] is True
    assert body["skills"]["matched"] == ["Python"]
    assert body["skills"]["missing"] == ["Kafka"]
    assert body["domain"]["aligned"] is True


async def test_fit_is_null_safe_without_classification(client, admin_headers, seed):
    resume_id = await seed.resume()
    job_id = await seed.job(pipeline=[_entry(resume_id, 0.55)])

    resp = await _fit(client, admin_headers, job_id, resume_id)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["seniority"] == {"candidate": None, "required": [], "aligned": None}
    assert body["domain"] == {"candidate": None, "required": None, "aligned": None}
    assert body["skills"] == {"matched": [], "missing": [], "extra": [], "coverage": 0.0}
    assert body["skills_boost"] == 0.0
    assert body["semantic_part"] == pytest.approx(0.55)
    assert isinstance(body["headline"], str) and body["headline"]
    assert EM_DASH not in body["headline"]


async def test_fit_missing_seniority_on_one_side_is_null_not_aligned(client, admin_headers, seed):
    resume_id = await seed.resume(classification={"skills": ["Python"]})
    job_id = await seed.job(targeting=_targeting(skills=["Python"]), pipeline=[_entry(resume_id)])

    body = (await _fit(client, admin_headers, job_id, resume_id)).json()
    assert body["seniority"] == {"candidate": None, "required": ["senior", "lead"], "aligned": None}
    assert body["domain"] == {
        "candidate": None, "required": "software_engineering", "aligned": None,
    }


async def test_fit_survives_a_deleted_resume_document(client, admin_headers, seed):
    job_id = await seed.job(
        targeting=_targeting(skills=["Python"]),
        pipeline=[_entry("fit-resume-gone", 0.6)],
    )
    resp = await _fit(client, admin_headers, job_id, "fit-resume-gone")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["candidate_name"] is None
    assert body["skills"]["missing"] == ["Python"]


async def test_fit_headline_has_no_dashes_even_when_skill_names_do(client, admin_headers, seed):
    resume_id = await seed.resume(classification=_classification(skills=[]))
    job_id = await seed.job(
        targeting=_targeting(skills=[f"Python {EM_DASH} advanced", f"Go {EN_DASH} basic"]),
        pipeline=[_entry(resume_id)],
    )
    body = (await _fit(client, admin_headers, job_id, resume_id)).json()
    assert EM_DASH not in body["headline"] and EN_DASH not in body["headline"]


async def test_fit_404s(client, admin_headers, seed):
    resume_id = await seed.resume(classification=_classification())
    job_id = await seed.job(pipeline=[_entry(resume_id)])

    unknown_job = await _fit(client, admin_headers, "fit-job-nope", resume_id)
    assert unknown_job.status_code == 404
    assert unknown_job.json()["detail"] == "Job not found"

    not_in_pipeline = await _fit(client, admin_headers, job_id, "fit-resume-not-in-pipeline")
    assert not_in_pipeline.status_code == 404
    assert not_in_pipeline.json()["detail"] == "Candidate not found in pipeline"


async def test_fit_requires_authentication(client, seed):
    resume_id = await seed.resume()
    job_id = await seed.job(pipeline=[_entry(resume_id)])
    resp = await client.get(f"/api/v1/jobs/{job_id}/pipeline/{resume_id}/fit")
    assert resp.status_code == 401


class _FakeLLM:

    def __init__(self, response: str = "", exc: Exception | None = None):
        self.response = response
        self.exc = exc
        self.calls: list[dict] = []

    async def __call__(self, prompt, **kwargs):
        self.calls.append({"prompt": prompt, **kwargs})
        if self.exc is not None:
            raise self.exc
        return self.response


class _CostRecorder:

    def __init__(self):
        self.calls: list[tuple] = []
        self.exited = 0

    def __call__(self, source, ref_id=None, items=None):
        recorder = self

        @contextlib.asynccontextmanager
        async def _scope():
            recorder.calls.append((source, ref_id))
            try:
                yield
            finally:
                recorder.exited += 1

        return _scope()


@pytest.fixture
def llm(monkeypatch):
    import config.llm as llm_module

    def install(response: str = "", exc: Exception | None = None):
        fake = _FakeLLM(response, exc)
        cost = _CostRecorder()
        monkeypatch.setattr(llm_module, "ask_llm", fake)
        monkeypatch.setattr(llm_module, "track_llm_cost", cost)
        return fake, cost

    return install


GOOD_OPINION = {
    "summary": f"Solid backend fit {EM_DASH} strong on Python, light on cloud.",
    "strengths": ["Covers most required skills", "Seniority matches the role"],
    "concerns": [f"No AWS experience listed {EN_DASH} ask about cloud exposure"],
    "follow_up_questions": ["Which cloud platforms have you deployed to?"],
}


async def _seed_opinion_target(seed):
    long_text = (
        "Alex Kim alex.kim.secret@example.com +1 (415) 555-0199 https://www.linkedin.com/in/alexkim "
        "Backend engineer who built payment APIs in Python. "
        + ("Filler experience sentence. " * 60)
        + "TAIL_MARKER_BEYOND_EXCERPT"
    )
    resume_id = await seed.resume(
        text=long_text,
        classification=_classification(
            skills=["Python", "SQL"], years_experience=7, education_level="bachelor",
        ),
    )
    job_id = await seed.job(
        targeting=_targeting(skills=["Python", "AWS"]),
        pipeline=[_entry(resume_id, 0.77)],
    )
    return job_id, resume_id


async def _opinion(client, headers, job_id, resume_id):
    return await client.post(
        f"/api/v1/jobs/{job_id}/pipeline/{resume_id}/fit/ai-opinion", headers=headers
    )


async def test_ai_opinion_success_shape_and_cost_tracking(client, admin_headers, seed, llm):
    job_id, resume_id = await _seed_opinion_target(seed)
    fake, cost = llm(json.dumps(GOOD_OPINION))

    resp = await _opinion(client, admin_headers, job_id, resume_id)
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert set(body) == {"summary", "strengths", "concerns", "follow_up_questions", "model"}
    assert body["strengths"] == GOOD_OPINION["strengths"]
    assert body["follow_up_questions"] == GOOD_OPINION["follow_up_questions"]
    assert body["model"] == settings.DEFAULT_LLM_MODEL
    assert "Solid backend fit" in body["summary"]
    for text in [body["summary"], *body["concerns"]]:
        assert EM_DASH not in text and EN_DASH not in text

    assert cost.calls == [("match_second_opinion", resume_id)]
    assert cost.exited == 1
    assert len(fake.calls) == 1
    call = fake.calls[0]
    assert call["json_mode"] is True
    assert call["model"] == settings.DEFAULT_LLM_MODEL
    assert call["timeout"] is not None and 0 < call["timeout"] <= 60
    assert "em dashes" in call["system"]


async def test_ai_opinion_prompt_carries_facts_but_no_contact_details(client, admin_headers, seed, llm):
    job_id, resume_id = await _seed_opinion_target(seed)
    fake, _ = llm(json.dumps(GOOD_OPINION))

    resp = await _opinion(client, admin_headers, job_id, resume_id)
    assert resp.status_code == 200, resp.text

    prompt = fake.calls[0]["prompt"]
    assert "Backend Engineer" in prompt
    assert "Python" in prompt and "AWS" in prompt
    assert "senior" in prompt
    assert "7 years" in prompt
    for forbidden in ("alex.kim.secret@example.com", "555-0199", "linkedin.com", "Alex", "Kim",
                      "TAIL_MARKER_BEYOND_EXCERPT"):
        assert forbidden not in prompt, forbidden
    assert len(prompt) < 3000
    assert "% match threshold" in prompt
    assert "auto-invite" not in prompt.lower()


async def test_ai_opinion_uses_stored_summary_over_resume_text(client, admin_headers, seed, llm):
    resume_id = await seed.resume(
        summary="Payments engineer focused on reliability.",
        text="FULL RESUME TEXT SHOULD NOT BE USED",
        classification=_classification(skills=["Python"]),
    )
    job_id = await seed.job(targeting=_targeting(skills=["Python"]), pipeline=[_entry(resume_id)])
    fake, _ = llm(json.dumps(GOOD_OPINION))

    assert (await _opinion(client, admin_headers, job_id, resume_id)).status_code == 200
    prompt = fake.calls[0]["prompt"]
    assert "Payments engineer focused on reliability." in prompt
    assert "FULL RESUME TEXT" not in prompt


@pytest.mark.parametrize("response", ["{}", "", "not json at all", "[1, 2]", '{"summary": "   "}'])
async def test_ai_opinion_unusable_llm_output_is_502(client, admin_headers, seed, llm, response):
    job_id, resume_id = await _seed_opinion_target(seed)
    _, cost = llm(response)

    resp = await _opinion(client, admin_headers, job_id, resume_id)
    assert resp.status_code == 502
    assert "AI second opinion unavailable" in resp.json()["detail"]
    assert cost.calls == [("match_second_opinion", resume_id)]
    assert cost.exited == 1


async def test_ai_opinion_llm_exception_is_502(client, admin_headers, seed, llm):
    job_id, resume_id = await _seed_opinion_target(seed)
    _, cost = llm(exc=asyncio.TimeoutError("slow"))

    resp = await _opinion(client, admin_headers, job_id, resume_id)
    assert resp.status_code == 502
    assert "AI second opinion unavailable" in resp.json()["detail"]
    assert cost.exited == 1


async def test_ai_opinion_404s_do_not_call_the_llm(client, admin_headers, seed, llm):
    resume_id = await seed.resume()
    job_id = await seed.job(pipeline=[_entry(resume_id)])
    fake, cost = llm(json.dumps(GOOD_OPINION))

    unknown_job = await _opinion(client, admin_headers, "fit-job-nope", resume_id)
    assert unknown_job.status_code == 404
    not_in_pipeline = await _opinion(client, admin_headers, job_id, "fit-resume-not-in-pipeline")
    assert not_in_pipeline.status_code == 404
    assert fake.calls == [] and cost.calls == []


async def test_ai_opinion_requires_admin(client, standard_headers, seed, llm):
    job_id, resume_id = await _seed_opinion_target(seed)
    fake, _ = llm(json.dumps(GOOD_OPINION))

    resp = await _opinion(client, standard_headers, job_id, resume_id)
    assert resp.status_code == 403
    assert fake.calls == []


async def test_ai_opinion_permission_is_a_real_gate(client, admin_headers, seed, llm):
    job_id, resume_id = await _seed_opinion_target(seed)
    fake, _ = llm(json.dumps(GOOD_OPINION))

    await seed.db.roles.insert_one({
        "role_name": "admin",
        "permissions": [p for p in DEFAULT_ROLE_PERMISSIONS["admin"] if p != "jobs:ai_fit_opinion"],
    })
    try:
        resp = await _opinion(client, admin_headers, job_id, resume_id)
        assert resp.status_code == 403
        assert "jobs:ai_fit_opinion" in resp.json()["detail"]
        assert fake.calls == []
    finally:
        await seed.db.roles.delete_one({"role_name": "admin"})


async def _bulk(client, headers, job_id, resume_ids, stage):
    return await client.post(
        f"/api/v1/jobs/{job_id}/pipeline/bulk-stage",
        json={"resume_ids": resume_ids, "stage": stage},
        headers=headers,
    )


async def _stage_of(db, job_id, resume_id):
    job = await db.jobs.find_one({"job_id": job_id})
    return next(p for p in job["candidate_pipeline"] if p["resume_id"] == resume_id)


async def _wait_for_audit(db, query, attempts=20, delay=0.15):
    for _ in range(attempts):
        found = [e async for e in db.audit_log.find(query)]
        if found:
            return found
        await asyncio.sleep(delay)
    return []


async def test_bulk_stage_updates_many_and_reports_skipped(client, admin_headers, seed):
    r1, r2, r3 = [await seed.resume() for _ in range(3)]
    job_id = await seed.job(pipeline=[_entry(r1), _entry(r2), _entry(r3)])

    resp = await _bulk(client, admin_headers, job_id, [r1, r2, "fit-resume-not-here", r1], "shortlisted")
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"updated": 2, "skipped": ["fit-resume-not-here"], "blocked": []}

    e1 = await _stage_of(seed.db, job_id, r1)
    e2 = await _stage_of(seed.db, job_id, r2)
    e3 = await _stage_of(seed.db, job_id, r3)
    assert e1["pipeline_stage"] == e2["pipeline_stage"] == "shortlisted"
    assert e1["updated_by"] == "demo-admin@hirely.ai" and e1["updated_at"]
    assert e3["pipeline_stage"] == "matched" and "updated_by" not in e3


async def test_bulk_stage_ignores_ids_that_belong_to_another_job(client, admin_headers, seed):
    mine, theirs = await seed.resume(), await seed.resume()
    job_id = await seed.job(pipeline=[_entry(mine)])
    other_job_id = await seed.job(pipeline=[_entry(theirs)])

    resp = await _bulk(client, admin_headers, job_id, [mine, theirs], "invited")
    assert resp.json() == {"updated": 1, "skipped": [theirs], "blocked": []}
    assert (await _stage_of(seed.db, other_job_id, theirs))["pipeline_stage"] == "matched"


async def test_bulk_stage_hired_and_rejected_apply_resume_outcome(client, admin_headers, seed):
    hired_id, rejected_id = await seed.resume(), await seed.resume()
    job_id = await seed.job(
        title="Platform Engineer", company_name="Outcome Corp",
        pipeline=[_entry(hired_id), _entry(rejected_id)],
    )

    assert (await _bulk(client, admin_headers, job_id, [hired_id], "hired")).json()["updated"] == 1
    assert (await _bulk(client, admin_headers, job_id, [rejected_id], "rejected")).json()["updated"] == 1

    hired = await seed.db.resumes.find_one({"resume_id": hired_id})
    assert hired["is_hired"] is True
    assert hired["hired_company"] == "Outcome Corp"
    assert hired["hired_job_title"] == "Platform Engineer"
    rejected = await seed.db.resumes.find_one({"resume_id": rejected_id})
    assert rejected["is_hired"] is False
    assert rejected["hired_company"] is None


async def test_bulk_stage_non_terminal_stage_leaves_resume_outcome_alone(client, admin_headers, seed):
    resume_id = await seed.resume()
    job_id = await seed.job(pipeline=[_entry(resume_id)])
    await _bulk(client, admin_headers, job_id, [resume_id], "interviewing")
    assert "is_hired" not in await seed.db.resumes.find_one({"resume_id": resume_id})


async def test_bulk_stage_is_audit_logged_once_per_call(client, admin_headers, seed):
    r1, r2 = await seed.resume(), await seed.resume()
    job_id = await seed.job(pipeline=[_entry(r1), _entry(r2)])

    resp = await _bulk(client, admin_headers, job_id, [r1, r2, "fit-resume-not-here"], "rejected")
    assert resp.status_code == 200

    entries = await _wait_for_audit(
        seed.db, {"action": "pipeline_bulk_stage", "resource_id": job_id}
    )
    assert len(entries) == 1
    entry = entries[0]
    assert entry["resource_type"] == "job"
    assert entry["actor_email"] == "demo-admin@hirely.ai"
    assert entry["details"]["stage"] == "rejected"
    assert entry["details"]["updated"] == 2
    assert entry["details"]["skipped"] == ["fit-resume-not-here"]
    assert sorted(entry["details"]["resume_ids"]) == sorted([r1, r2])


async def test_bulk_stage_rejects_invalid_stage(client, admin_headers, seed):
    resume_id = await seed.resume()
    job_id = await seed.job(pipeline=[_entry(resume_id)])

    resp = await _bulk(client, admin_headers, job_id, [resume_id], "promoted")
    assert resp.status_code == 400
    assert "Valid stages" in resp.json()["detail"]
    assert (await _stage_of(seed.db, job_id, resume_id))["pipeline_stage"] == "matched"


async def test_bulk_stage_caps_ids_at_one_hundred(client, admin_headers, seed):
    job_id = await seed.job()

    too_many = await _bulk(client, admin_headers, job_id, [f"r{i}" for i in range(101)], "invited")
    assert too_many.status_code == 400
    assert "100" in too_many.json()["detail"]

    at_limit = await _bulk(client, admin_headers, job_id, [f"r{i}" for i in range(100)], "invited")
    assert at_limit.status_code == 200
    assert at_limit.json()["updated"] == 0 and len(at_limit.json()["skipped"]) == 100


async def test_bulk_stage_rejects_empty_id_list(client, admin_headers, seed):
    job_id = await seed.job()
    assert (await _bulk(client, admin_headers, job_id, [], "invited")).status_code == 400


async def test_bulk_stage_unknown_job_is_404(client, admin_headers):
    resp = await _bulk(client, admin_headers, "fit-job-nope", ["r1"], "invited")
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Job not found"


async def test_bulk_stage_requires_admin(client, standard_headers, seed):
    resume_id = await seed.resume()
    job_id = await seed.job(pipeline=[_entry(resume_id)])

    resp = await _bulk(client, standard_headers, job_id, [resume_id], "shortlisted")
    assert resp.status_code == 403
    assert (await _stage_of(seed.db, job_id, resume_id))["pipeline_stage"] == "matched"


async def test_bulk_stage_permission_is_a_real_gate(client, admin_headers, seed):
    resume_id = await seed.resume()
    job_id = await seed.job(pipeline=[_entry(resume_id)])

    await seed.db.roles.insert_one({
        "role_name": "admin",
        "permissions": [p for p in DEFAULT_ROLE_PERMISSIONS["admin"] if p != "jobs:bulk_stage"],
    })
    try:
        resp = await _bulk(client, admin_headers, job_id, [resume_id], "shortlisted")
        assert resp.status_code == 403
        assert "jobs:bulk_stage" in resp.json()["detail"]
        assert (await _stage_of(seed.db, job_id, resume_id))["pipeline_stage"] == "matched"
    finally:
        await seed.db.roles.delete_one({"role_name": "admin"})


async def test_single_stage_patch_still_works(client, admin_headers, seed):
    resume_id = await seed.resume()
    job_id = await seed.job(company_name="Patch Corp", pipeline=[_entry(resume_id)])

    ok = await client.patch(
        f"/api/v1/jobs/{job_id}/pipeline/{resume_id}", params={"stage": "hired"}, headers=admin_headers
    )
    assert ok.status_code == 200
    assert ok.json() == {"message": "Stage updated to hired"}
    assert (await _stage_of(seed.db, job_id, resume_id))["pipeline_stage"] == "hired"
    assert (await seed.db.resumes.find_one({"resume_id": resume_id}))["hired_company"] == "Patch Corp"

    bad_stage = await client.patch(
        f"/api/v1/jobs/{job_id}/pipeline/{resume_id}", params={"stage": "nope"}, headers=admin_headers
    )
    assert bad_stage.status_code == 400

    missing = await client.patch(
        f"/api/v1/jobs/{job_id}/pipeline/fit-resume-not-here",
        params={"stage": "invited"}, headers=admin_headers,
    )
    assert missing.status_code == 404
    assert missing.json()["detail"] == "Candidate not found in pipeline"
