"""Tests for MVP2 §2.7 remaining gap: industry classification on resumes,
and industry / salary_expectation filters on the resumes list endpoint."""
from unittest.mock import patch

import pytest

from config.database import get_db

pytestmark = pytest.mark.anyio

_TAG = "advfilt"


class TestClassifierIndustry:
    async def test_returns_industry_from_shared_taxonomy(self):
        from services.hr_module.classifier import classify_resume
        from services.hr_module.jd_intel import INDUSTRIES

        llm_response = (
            '{"job_domain": "software_engineering", "seniority_level": "senior",'
            ' "skills": ["Python"], "confidence": 0.9, "industry": "fintech"}'
        )
        with patch("services.hr_module.classifier.ask_llm", return_value=llm_response):
            result = await classify_resume("some resume text")

        assert "industry" in result
        assert result["industry"] == "fintech"
        assert result["industry"] in INDUSTRIES

    async def test_defaults_to_other_when_missing(self):
        from services.hr_module.classifier import classify_resume

        llm_response = (
            '{"job_domain": "software_engineering", "seniority_level": "mid",'
            ' "skills": [], "confidence": 0.5}'
        )
        with patch("services.hr_module.classifier.ask_llm", return_value=llm_response):
            result = await classify_resume("some resume text")

        assert result["industry"] == "other"

    async def test_invalid_industry_falls_back_to_other(self):
        """A hallucinated value outside the shared taxonomy must not leak
        into classification.industry unchecked — it would silently break
        exact-match filtering downstream."""
        from services.hr_module.classifier import classify_resume

        llm_response = (
            '{"job_domain": "software_engineering", "seniority_level": "mid",'
            ' "skills": [], "confidence": 0.5, "industry": "not_a_real_industry"}'
        )
        with patch("services.hr_module.classifier.ask_llm", return_value=llm_response):
            result = await classify_resume("some resume text")

        assert result["industry"] == "other"

    async def test_shared_with_jd_intel_single_source_of_truth(self):
        """classifier.py must import, not redefine, jd_intel.py's INDUSTRIES."""
        from services.hr_module import classifier, jd_intel

        assert classifier.INDUSTRIES is jd_intel.INDUSTRIES


@pytest.fixture(autouse=True)
async def _clean_test_docs():
    db = get_db()
    if db is not None:
        await db.resumes.delete_many({"resume_id": {"$regex": f"^{_TAG}-"}})
    yield
    if db is not None:
        await db.resumes.delete_many({"resume_id": {"$regex": f"^{_TAG}-"}})


async def _seed_resume(db, resume_id, **overrides):
    doc = {
        "resume_id": resume_id,
        "filename": f"{resume_id}.pdf",
        "candidate_name": "Advanced Filters Candidate",
        "processing_status": "processed",
        "classification": {
            "job_domain": "software_engineering", "seniority_level": "senior", "industry": "fintech",
        },
        "created_at": "2026-06-08T10:00:00Z",
    }
    doc.update(overrides)
    await db.resumes.delete_one({"resume_id": resume_id})
    await db.resumes.insert_one(doc)
    return doc


async def test_resumes_industry_filter(client, admin_headers, setup_test_db):
    db = setup_test_db
    await _seed_resume(db, f"{_TAG}-r-industry-fintech", classification={
        "job_domain": "software_engineering", "seniority_level": "senior", "industry": "fintech",
    })
    await _seed_resume(db, f"{_TAG}-r-industry-edu", classification={
        "job_domain": "software_engineering", "seniority_level": "senior", "industry": "education",
    })

    response = await client.get("/api/v1/resumes", params={"industry": "fintech"}, headers=admin_headers)
    assert response.status_code == 200
    ids = [r["resume_id"] for r in response.json()["resumes"]]
    assert f"{_TAG}-r-industry-fintech" in ids
    assert f"{_TAG}-r-industry-edu" not in ids


async def test_resumes_salary_expectation_range_filter(client, admin_headers, setup_test_db):
    db = setup_test_db
    await _seed_resume(db, f"{_TAG}-r-salary-low", salary_expectation=30000)
    await _seed_resume(db, f"{_TAG}-r-salary-mid", salary_expectation=95000)

    response = await client.get(
        "/api/v1/resumes",
        params={"salary_expectation_min": 50000},
        headers=admin_headers,
    )
    assert response.status_code == 200
    ids = [r["resume_id"] for r in response.json()["resumes"]]
    assert f"{_TAG}-r-salary-mid" in ids
    assert f"{_TAG}-r-salary-low" not in ids


async def test_resumes_patch_salary_expectation_admin_only(client, standard_headers, admin_headers, setup_test_db):
    db = setup_test_db
    await _seed_resume(db, f"{_TAG}-r-patch-salary")

    forbidden = await client.patch(
        f"/api/v1/resumes/{_TAG}-r-patch-salary/salary-expectation",
        json={"salary_expectation": 88000},
        headers=standard_headers,
    )
    assert forbidden.status_code == 403

    ok = await client.patch(
        f"/api/v1/resumes/{_TAG}-r-patch-salary/salary-expectation",
        json={"salary_expectation": 88000},
        headers=admin_headers,
    )
    assert ok.status_code == 200
    assert ok.json()["salary_expectation"] == 88000

    doc = await db.resumes.find_one({"resume_id": f"{_TAG}-r-patch-salary"})
    assert doc["salary_expectation"] == 88000


async def test_resumes_patch_salary_expectation_unknown_404(client, admin_headers):
    response = await client.patch(
        "/api/v1/resumes/does-not-exist/salary-expectation",
        json={"salary_expectation": 1},
        headers=admin_headers,
    )
    assert response.status_code == 404
