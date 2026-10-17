import pytest
from httpx import ASGITransport, AsyncClient

import config.database as database
from config import tenancy
from config.tenancy import DEFAULT_COMPANY_ID
from fake_mongo import FakeRaw
from main import app

pytestmark = pytest.mark.anyio

COMPANY = "cmp_a"
URL = "/api/v1/jobs/job_1/pipeline"
ADMIN = {"Authorization": f"Bearer demo-admin-token@@{COMPANY}"}
STANDARD = {"Authorization": f"Bearer demo-standard-token@@{COMPANY}"}


def entry(resume_id: str, stage: str, similarity: float) -> dict:
    return {"resume_id": resume_id, "pipeline_stage": stage, "similarity_score": similarity}


@pytest.fixture
async def world(monkeypatch):
    raw = FakeRaw()
    raw.add("companies", {"company_id": COMPANY, "name": "Acme", "status": "active", "settings": {}}, COMPANY)
    raw.add("jobs", {
        "job_id": "job_1", "title": "Software Engineer",
        "candidate_pipeline": [
            entry("r_done", "completed", 0.9),
            entry("r_zero", "completed", 0.8),
            entry("r_external", "completed", 0.7),
            entry("r_invited", "invited", 0.6),
            entry("r_matched", "matched", 0.5),
        ],
    }, COMPANY)
    for resume_id in ("r_done", "r_zero", "r_external", "r_invited", "r_matched"):
        raw.add("resumes", {"resume_id": resume_id, "candidate_name": resume_id}, COMPANY)
    raw.add("candidates", {"candidate_id": "c_done", "job_id": "job_1", "resume_id": "r_done", "secure_token": "tok_done", "final_score": 62}, COMPANY)
    raw.add("candidates", {"candidate_id": "c_zero", "job_id": "job_1", "resume_id": "r_zero", "secure_token": "tok_zero", "final_score": 0}, COMPANY)
    raw.add("candidates", {
        "candidate_id": "c_ext", "job_id": "job_1", "resume_id": "r_external", "secure_token": "tok_ext",
        "interview_mode": "external", "final_score": 80,
    }, COMPANY)
    raw.add("candidates", {"candidate_id": "c_inv", "job_id": "job_1", "resume_id": "r_invited", "secure_token": "tok_inv"}, COMPANY)
    monkeypatch.setattr(database, "_db", raw)
    tenancy.use_fallback_company(None)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as client:
        yield client
    tenancy.use_fallback_company(DEFAULT_COMPANY_ID)


def by_resume(response) -> dict:
    return {row["resume_id"]: row for row in response.json()["pipeline"]}


async def test_an_admin_sees_the_ai_interview_score_of_each_interview_held_here(world):
    response = await world.get(URL, headers=ADMIN)
    assert response.status_code == 200, response.text
    rows = by_resume(response)
    assert rows["r_done"]["final_score"] == 62
    assert rows["r_zero"]["final_score"] == 0


async def test_an_interview_held_on_another_platform_has_no_ai_score(world):
    rows = by_resume(await world.get(URL, headers=ADMIN))
    assert "final_score" not in rows["r_external"]


async def test_a_candidate_not_yet_interviewed_has_no_score(world):
    rows = by_resume(await world.get(URL, headers=ADMIN))
    assert "final_score" not in rows["r_invited"]
    assert "final_score" not in rows["r_matched"]


async def test_a_recruiter_keeps_the_match_score_and_gets_nothing_from_the_interview(world):
    response = await world.get(URL, headers=STANDARD)
    assert response.status_code == 200, response.text
    rows = by_resume(response)
    assert rows["r_done"]["similarity_score"] == 0.9
    assert all("final_score" not in row for row in rows.values())
    assert "final_score" not in response.text and "tok_done" not in response.text


async def test_the_pipeline_order_and_match_scores_are_unchanged_for_an_admin(world):
    response = await world.get(URL, headers=ADMIN)
    assert [row["resume_id"] for row in response.json()["pipeline"]] == ["r_done", "r_zero", "r_external", "r_invited", "r_matched"]
    assert response.json()["total"] == 5
