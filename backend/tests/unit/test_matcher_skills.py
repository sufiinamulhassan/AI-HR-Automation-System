"""
Tests for skills-based filtering in the matcher and JD intel pipeline.

All tests marked EXPECTED TO FAIL until implementation.

Coverage:
  - jd_intel.parse_jd  → targeting includes required_skills
  - jd_intel.parse_jd  → JD Pinecone vector stores skills metadata
  - matcher.match_jd_to_resume_pool → Pinecone query filters by skills ($in)
  - matcher.match_resume_to_jds    → Pinecone query filters by skills ($in)
  - Edge cases: empty skills, no-filter fallback

Run: pytest tests/unit/test_matcher_skills.py -v
"""
import pytest
from unittest.mock import MagicMock, AsyncMock, patch, call

pytestmark = pytest.mark.anyio


def _pinecone_query_filter(mock_pinecone: MagicMock) -> dict:
    return mock_pinecone.query.call_args.kwargs["filter"]


def _pinecone_upsert_metadata(mock_pinecone: MagicMock) -> dict:
    return mock_pinecone.upsert.call_args.kwargs["vectors"][0]["metadata"]


def _mock_pinecone_empty() -> MagicMock:
    pc = MagicMock()
    pc.query.return_value = MagicMock(matches=[])
    return pc


def _mock_db() -> MagicMock:
    db = MagicMock()
    db.jobs.update_one = AsyncMock()
    db.jobs.find_one = AsyncMock(return_value=None)
    return db


class TestJdIntelTargeting:

    async def test_targeting_includes_required_skills(self):
        """NEW: parse_jd must put required_skills in targeting so matcher can use them."""
        from services.hr_module.jd_intel import parse_jd
        llm_response = (
            '{"skills": ["Python", "FastAPI", "Docker"], "experience_level": "senior",'
            ' "job_domain": "software_engineering", "key_requirements": [],'
            ' "nice_to_have": [], "company_name": null}'
        )
        with patch("services.hr_module.jd_intel.ask_llm", return_value=llm_response), \
             patch("services.hr_module.jd_intel.get_embedding", return_value=[0.1] * 1536), \
             patch("services.hr_module.jd_intel.get_pinecone", return_value=None), \
             patch("services.hr_module.jd_intel.get_db", return_value=None):
            result = await parse_jd("job-1", "Python Dev", "We need a Python developer.")

        targeting = result["targeting"]
        assert "required_skills" in targeting, "targeting must include required_skills"
        assert "Python" in targeting["required_skills"]
        assert "FastAPI" in targeting["required_skills"]

    async def test_targeting_required_skills_empty_when_jd_has_none(self):
        """required_skills should default to [] when LLM returns no skills."""
        from services.hr_module.jd_intel import parse_jd
        llm_response = (
            '{"skills": [], "experience_level": "mid",'
            ' "job_domain": "marketing", "key_requirements": [],'
            ' "nice_to_have": [], "company_name": null}'
        )
        with patch("services.hr_module.jd_intel.ask_llm", return_value=llm_response), \
             patch("services.hr_module.jd_intel.get_embedding", return_value=[0.1] * 1536), \
             patch("services.hr_module.jd_intel.get_pinecone", return_value=None), \
             patch("services.hr_module.jd_intel.get_db", return_value=None):
            result = await parse_jd("job-2", "Marketing Lead", "description")

        targeting = result["targeting"]
        assert "required_skills" in targeting
        assert targeting["required_skills"] == []

    async def test_existing_targeting_fields_still_present(self):
        """Regression: required_domain and required_seniority must still be in targeting."""
        from services.hr_module.jd_intel import parse_jd
        llm_response = (
            '{"skills": ["Python"], "experience_level": "senior",'
            ' "job_domain": "software_engineering", "key_requirements": [],'
            ' "nice_to_have": [], "company_name": null}'
        )
        with patch("services.hr_module.jd_intel.ask_llm", return_value=llm_response), \
             patch("services.hr_module.jd_intel.get_embedding", return_value=[0.1] * 1536), \
             patch("services.hr_module.jd_intel.get_pinecone", return_value=None), \
             patch("services.hr_module.jd_intel.get_db", return_value=None):
            result = await parse_jd("job-3", "Senior Dev", "description")

        targeting = result["targeting"]
        assert "required_domain" in targeting
        assert "required_seniority" in targeting


class TestJdPineconeMetadata:

    async def test_jd_pinecone_upsert_includes_skills(self):
        """NEW: JD vector metadata must include skills so resume→JD filtering works."""
        from services.hr_module.jd_intel import parse_jd
        llm_response = (
            '{"skills": ["Python", "FastAPI", "PostgreSQL"], "experience_level": "mid",'
            ' "job_domain": "software_engineering", "key_requirements": [],'
            ' "nice_to_have": [], "company_name": null}'
        )
        mock_pc = MagicMock()

        with patch("services.hr_module.jd_intel.ask_llm", return_value=llm_response), \
             patch("services.hr_module.jd_intel.get_embedding", return_value=[0.1] * 1536), \
             patch("services.hr_module.jd_intel.get_pinecone", return_value=mock_pc), \
             patch("services.hr_module.jd_intel.get_db", return_value=None):
            await parse_jd("job-4", "Backend Dev", "description")

        meta = _pinecone_upsert_metadata(mock_pc)
        assert "skills" in meta, "JD Pinecone metadata must include skills"
        assert "Python" in meta["skills"]
        assert "FastAPI" in meta["skills"]

    async def test_jd_pinecone_existing_fields_still_present(self):
        """Regression: doc_type, job_domain, experience_level still in JD metadata."""
        from services.hr_module.jd_intel import parse_jd
        llm_response = (
            '{"skills": ["Python"], "experience_level": "senior",'
            ' "job_domain": "software_engineering", "key_requirements": [],'
            ' "nice_to_have": [], "company_name": null}'
        )
        mock_pc = MagicMock()

        with patch("services.hr_module.jd_intel.ask_llm", return_value=llm_response), \
             patch("services.hr_module.jd_intel.get_embedding", return_value=[0.1] * 1536), \
             patch("services.hr_module.jd_intel.get_pinecone", return_value=mock_pc), \
             patch("services.hr_module.jd_intel.get_db", return_value=None):
            await parse_jd("job-5", "Senior Dev", "description")

        meta = _pinecone_upsert_metadata(mock_pc)
        assert meta["doc_type"] == "job"
        assert meta["job_domain"] == "software_engineering"
        assert meta["experience_level"] == "senior"


class TestMatchJdToResumePoolSkillsFilter:

    async def test_skills_not_hard_filtered_when_required_skills_present(self):
        """Skills must NOT be a hard Pinecone filter: the resume classifier and JD
        parser extract skills independently, so an exact $in overlap dropped
        genuinely-similar candidates and left pipelines empty. Vector similarity
        (RESUME_SIMILARITY_THRESHOLD) is the gate; domain is the only hard filter."""
        from services.hr_module.matcher import match_jd_to_resume_pool
        mock_pc = _mock_pinecone_empty()

        with patch("services.hr_module.matcher.get_pinecone", return_value=mock_pc), \
             patch("services.hr_module.matcher.get_db", return_value=_mock_db()):
            await match_jd_to_resume_pool(
                job_id="job-1",
                targeting={
                    "required_domain": "software_engineering",
                    "required_seniority": ["mid", "senior"],
                    "required_skills": ["Python", "FastAPI"],
                },
                jd_embedding=[0.1] * 1536,
            )

        f = _pinecone_query_filter(mock_pc)
        assert "skills" not in f, "skills must not be used as a hard Pinecone filter"

    async def test_no_skills_filter_when_required_skills_empty(self):
        """When required_skills is empty, skills filter must NOT be added (would return zero results)."""
        from services.hr_module.matcher import match_jd_to_resume_pool
        mock_pc = _mock_pinecone_empty()

        with patch("services.hr_module.matcher.get_pinecone", return_value=mock_pc), \
             patch("services.hr_module.matcher.get_db", return_value=_mock_db()):
            await match_jd_to_resume_pool(
                job_id="job-2",
                targeting={
                    "required_domain": "marketing",
                    "required_seniority": ["mid"],
                    "required_skills": [],
                },
                jd_embedding=[0.1] * 1536,
            )

        f = _pinecone_query_filter(mock_pc)
        assert "skills" not in f, "empty required_skills must not add a skills filter"

    async def test_no_skills_filter_when_required_skills_missing(self):
        """Backward compat: targeting without required_skills key must not break matching."""
        from services.hr_module.matcher import match_jd_to_resume_pool
        mock_pc = _mock_pinecone_empty()

        with patch("services.hr_module.matcher.get_pinecone", return_value=mock_pc), \
             patch("services.hr_module.matcher.get_db", return_value=_mock_db()):
            await match_jd_to_resume_pool(
                job_id="job-3",
                targeting={
                    "required_domain": "software_engineering",
                    "required_seniority": ["senior"],
                },
                jd_embedding=[0.1] * 1536,
            )

        f = _pinecone_query_filter(mock_pc)
        assert "skills" not in f

    async def test_only_doc_type_filter_applied(self):
        """doc_type is the only structural filter; matching gates on vector
        similarity. job_domain/skills/seniority are NOT hard filters (they were
        zeroing out genuinely-similar candidates)."""
        from services.hr_module.matcher import match_jd_to_resume_pool
        mock_pc = _mock_pinecone_empty()

        with patch("services.hr_module.matcher.get_pinecone", return_value=mock_pc), \
             patch("services.hr_module.matcher.get_db", return_value=_mock_db()):
            await match_jd_to_resume_pool(
                job_id="job-4",
                targeting={
                    "required_domain": "software_engineering",
                    "required_seniority": ["mid"],
                    "required_skills": ["Python"],
                },
                jd_embedding=[0.1] * 1536,
            )

        f = _pinecone_query_filter(mock_pc)
        assert f["doc_type"] == "resume"
        assert "job_domain" not in f
        assert "skills" not in f


class TestMatchResumeToJdsSkillsFilter:

    async def test_skills_not_hard_filtered_when_resume_has_skills(self):
        """Skills must NOT be a hard Pinecone filter on the resume→JD path either —
        vector similarity is the gate. (See match_jd_to_resume_pool test above.)"""
        from services.hr_module.matcher import match_resume_to_jds
        mock_pc = _mock_pinecone_empty()

        with patch("services.hr_module.matcher.get_pinecone", return_value=mock_pc), \
             patch("services.hr_module.matcher.get_db", return_value=_mock_db()):
            await match_resume_to_jds(
                resume_id="res-1",
                embedding=[0.1] * 1536,
                classification={
                    "job_domain": "software_engineering",
                    "seniority_level": "senior",
                    "skills": ["Python", "FastAPI", "Docker"],
                },
            )

        f = _pinecone_query_filter(mock_pc)
        assert "skills" not in f, "skills must not be used as a hard Pinecone filter"

    async def test_no_skills_filter_when_resume_skills_empty(self):
        """When resume has no skills, skills filter must NOT be added."""
        from services.hr_module.matcher import match_resume_to_jds
        mock_pc = _mock_pinecone_empty()

        with patch("services.hr_module.matcher.get_pinecone", return_value=mock_pc), \
             patch("services.hr_module.matcher.get_db", return_value=_mock_db()):
            await match_resume_to_jds(
                resume_id="res-2",
                embedding=[0.1] * 1536,
                classification={
                    "job_domain": "software_engineering",
                    "seniority_level": "mid",
                    "skills": [],
                },
            )

        f = _pinecone_query_filter(mock_pc)
        assert "skills" not in f

    async def test_only_doc_type_filter_applied(self):
        """doc_type is the only structural filter on the resume→JD path too; the
        gate is vector similarity, not domain/skills/seniority metadata."""
        from services.hr_module.matcher import match_resume_to_jds
        mock_pc = _mock_pinecone_empty()

        with patch("services.hr_module.matcher.get_pinecone", return_value=mock_pc), \
             patch("services.hr_module.matcher.get_db", return_value=_mock_db()):
            await match_resume_to_jds(
                resume_id="res-3",
                embedding=[0.1] * 1536,
                classification={
                    "job_domain": "software_engineering",
                    "seniority_level": "mid",
                    "skills": ["Python"],
                },
            )

        f = _pinecone_query_filter(mock_pc)
        assert f["doc_type"] == "job"
        assert "job_domain" not in f
        assert "skills" not in f
