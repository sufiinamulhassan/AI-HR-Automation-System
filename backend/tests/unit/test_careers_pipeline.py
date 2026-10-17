from pathlib import Path
from types import SimpleNamespace

import pytest

from config.tenancy import current_company_id
from services.hr_module import application_service, classifier, matcher, resume_intel
from services.hr_module.resume_intake_service import run_resume_agent
from services.hr_module.resume_intel import extract_text as real_extract_text
from test_careers import A, API, B, files, form, world

pytestmark = pytest.mark.anyio

CV = (
    "Sara Khan\nsara.cv@example.com\n+92 300 1234567\n"
    "Senior Python engineer with ten years of experience building APIs with FastAPI and MongoDB."
)
DOC = (Path(__file__).parent / "fixtures" / "resume_rich.doc").read_bytes()
ADMIN_B = {"Authorization": f"Bearer demo-admin-token@@{B}"}
ADMIN_A = {"Authorization": f"Bearer demo-admin-token@@{A}"}


class Index:
    def __init__(self):
        self.upserts: list[dict] = []

    def upsert(self, vectors):
        self.upserts.extend(vectors)


@pytest.fixture
async def pipeline(world, monkeypatch):
    seen = SimpleNamespace(companies=[], index=Index())

    async def read(raw, filename):
        return CV

    async def classify(text, model=None):
        seen.companies.append(("classify", current_company_id()))
        return {
            "job_domain": "software_engineering", "seniority_level": "senior", "skills": ["Python", "FastAPI", "MongoDB"],
            "confidence": 0.91, "years_experience": 10, "education_level": "bachelor",
        }

    async def embed(text):
        seen.companies.append(("embed", current_company_id()))
        return [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]

    async def match(resume_id, embedding, classification):
        seen.companies.append(("match", current_company_id()))
        return [{"job_id": "b-1", "score": 0.83}]

    import config.llm as llm

    monkeypatch.setattr(resume_intel, "extract_text", read)
    monkeypatch.setattr(classifier, "classify_resume", classify)
    monkeypatch.setattr(llm, "get_embedding", embed)
    monkeypatch.setattr(matcher, "match_resume_to_jds", match)
    monkeypatch.setattr(resume_intel, "get_pinecone", lambda: seen.index)
    monkeypatch.setattr(application_service, "run_resume_agent", run_resume_agent)
    world.seen = seen
    return world


async def apply_to_b(world, **over):
    response = await world.client.post(
        f"{API}/jobs/b-1/apply", data=form(**over), files=files("sara_cv.txt", CV.encode("utf-8")),
    )
    assert response.status_code == 200, response.text
    return response.json()


async def test_a_career_application_is_parsed_scored_and_stored_for_the_company_of_the_job(pipeline):
    body = await apply_to_b(pipeline)

    (resume,) = pipeline.raw.rows("resumes", company_id=B)
    assert resume["processing_status"] == "processed" and resume["source"] == "career_page"
    assert resume["text"].startswith("Sara Khan") and resume["classification"]["job_domain"] == "software_engineering"
    assert resume["embedding"] and resume["embedding_model"]
    assert resume["candidate_name"] == "Sara Khan" and resume["candidate_email"] == "sara@example.com"
    assert resume["applicant"]["phone"] == "+92 300 1234567"

    (stored_file,) = pipeline.raw.rows("resume_files", company_id=B)
    assert stored_file["resume_id"] == resume["resume_id"] and stored_file["data"] == CV.encode("utf-8")

    (vector,) = pipeline.seen.index.upserts
    assert vector["id"] == resume["resume_id"] and vector["metadata"]["company_id"] == B
    assert vector["metadata"]["doc_type"] == "resume" and vector["metadata"]["skills"] == ["Python", "FastAPI", "MongoDB"]

    job = next(j for j in pipeline.raw.rows("jobs", company_id=B) if j["job_id"] == "b-1")
    (entry,) = job["candidate_pipeline"]
    assert entry["resume_id"] == resume["resume_id"] and entry["similarity_score"] == 0.83
    assert entry["pipeline_stage"] == "matched" and entry["source"] == "career_page"
    assert entry["application_id"] == body["application_id"] and entry["targeted_upload"] is False

    assert {step for step, _ in pipeline.seen.companies} == {"classify", "embed", "match"}
    assert {company for _, company in pipeline.seen.companies} == {B}


async def test_nothing_of_it_reaches_any_other_company(pipeline):
    await apply_to_b(pipeline)
    for other in (A, "cmp_c", "cmp_platform", "cmp_s"):
        for collection in ("resumes", "resume_files", "applications", "cost_ledger"):
            assert pipeline.raw.rows(collection, company_id=other) == [], (other, collection)
        for job in pipeline.raw.rows("jobs", company_id=other):
            assert job["candidate_pipeline"] == [], (other, job["job_id"])


async def test_the_company_sees_the_candidate_in_that_jobs_pipeline_and_no_other_company_does(pipeline):
    body = await apply_to_b(pipeline)

    mine = await pipeline.client.get("/api/v1/jobs/b-1/pipeline", headers=ADMIN_B)
    assert mine.status_code == 200, mine.text
    rows = mine.json()["pipeline"]
    assert len(rows) == 1
    assert rows[0]["source"] == "career_page" and rows[0]["application_id"] == body["application_id"]
    assert rows[0]["resume"]["candidate_name"] == "Sara Khan" and rows[0]["resume"]["filename"] == "sara_cv.txt"
    assert "text" not in rows[0]["resume"] and "embedding" not in rows[0]["resume"]

    other = await pipeline.client.get("/api/v1/jobs/b-1/pipeline", headers=ADMIN_A)
    assert other.status_code == 404


async def test_a_resume_that_cannot_be_processed_is_marked_failed_for_that_company_only(pipeline, monkeypatch):
    async def boom(text, model=None):
        raise RuntimeError("the model is down")

    monkeypatch.setattr(classifier, "classify_resume", boom)
    await apply_to_b(pipeline)

    (resume,) = pipeline.raw.rows("resumes", company_id=B)
    assert resume["processing_status"] == "failed" and "model is down" in resume["error"]
    job = next(j for j in pipeline.raw.rows("jobs", company_id=B) if j["job_id"] == "b-1")
    assert job["candidate_pipeline"] == []
    assert pipeline.seen.index.upserts == []


def b_job(world):
    return next(j for j in world.raw["jobs"].docs if j["job_id"] == "b-1")


async def test_an_entry_the_matcher_already_made_for_the_job_is_tagged_as_a_career_application(pipeline, monkeypatch):
    async def matcher_like(resume_id, embedding, classification):
        b_job(pipeline)["candidate_pipeline"].append(
            {"resume_id": resume_id, "similarity_score": 0.83, "pipeline_stage": "matched", "added_at": "2026-01-01T00:00:00+00:00"},
        )
        return [{"job_id": "b-1", "score": 0.83}]

    monkeypatch.setattr(matcher, "match_resume_to_jds", matcher_like)
    body = await apply_to_b(pipeline)

    (entry,) = b_job(pipeline)["candidate_pipeline"]
    assert entry["similarity_score"] == 0.83 and entry["pipeline_stage"] == "matched"
    assert entry["source"] == "career_page" and entry["application_id"] == body["application_id"]


async def test_an_applicant_the_matcher_did_not_return_is_scored_against_the_job_they_applied_to(pipeline, monkeypatch):
    async def nothing(resume_id, embedding, classification):
        return []

    monkeypatch.setattr(matcher, "match_resume_to_jds", nothing)
    b_job(pipeline)["embedding"] = [0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1]
    await apply_to_b(pipeline)

    (entry,) = b_job(pipeline)["candidate_pipeline"]
    assert entry["similarity_score"] == pytest.approx(0.5882, abs=1e-4)
    assert entry["targeted_upload"] is False and entry["source"] == "career_page"


async def test_an_applicant_stays_in_the_pipeline_with_a_zero_score_when_no_score_can_be_computed(pipeline, monkeypatch):
    async def nothing(resume_id, embedding, classification):
        return []

    monkeypatch.setattr(matcher, "match_resume_to_jds", nothing)
    await apply_to_b(pipeline)

    (entry,) = b_job(pipeline)["candidate_pipeline"]
    assert entry["similarity_score"] == 0.0 and entry["targeted_upload"] is True and entry["source"] == "career_page"


async def test_a_word_97_document_is_parsed_scored_and_stored_like_any_other(pipeline, monkeypatch):
    monkeypatch.setattr(resume_intel, "extract_text", real_extract_text)
    response = await pipeline.client.post(
        f"{API}/jobs/b-1/apply", data=form(), files=files("sara_cv.doc", DOC),
    )
    assert response.status_code == 200, response.text

    (resume,) = pipeline.raw.rows("resumes", company_id=B)
    assert resume["processing_status"] == "processed" and resume["source"] == "career_page"
    assert resume["text"].startswith("Sara Khan\nSenior Platform Engineer\n")
    assert "sara.khan@example.com" in resume["text"] and "HYPERLINK" not in resume["text"]
    (stored,) = pipeline.raw.rows("resume_files", company_id=B)
    assert stored["data"] == DOC and stored["resume_id"] == resume["resume_id"]
    (entry,) = b_job(pipeline)["candidate_pipeline"]
    assert entry["source"] == "career_page" and entry["resume_id"] == resume["resume_id"]
