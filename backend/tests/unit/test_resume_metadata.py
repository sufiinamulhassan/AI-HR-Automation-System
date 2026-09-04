"""
Tests for enhanced resume metadata in classifier + Pinecone.

All tests in TestPineconeMetadata and the new-field tests in TestClassifierFields
are EXPECTED TO FAIL until implementation is complete.

Run with: pytest tests/test_resume_metadata.py -v
"""
import pytest
from unittest.mock import MagicMock, AsyncMock, patch

pytestmark = pytest.mark.anyio


def _pinecone_metadata(mock_pinecone: MagicMock) -> dict:
    """Extract the metadata dict from the first Pinecone upsert call."""
    call_args = mock_pinecone.upsert.call_args
    return call_args.kwargs["vectors"][0]["metadata"]


def _make_state(text: str = "John Doe\nPython developer with 7 years experience.") -> dict:
    return {
        "resume_id": "test-resume-abc123",
        "filename": "john_doe.pdf",
        "text": text,
        "raw_bytes": b"raw pdf bytes",
        "classification": {
            "job_domain": "software_engineering",
            "seniority_level": "senior",
            "skills": ["Python", "FastAPI", "Docker"],
            "confidence": 0.92,
            "years_experience": 7,
            "education_level": "master",
        },
        "embedding": [0.1] * 1536,
        "matched_jds": [],
    }


def _mock_db() -> MagicMock:
    db = MagicMock()
    db.resumes.update_one = AsyncMock()
    db.resume_files.update_one = AsyncMock()
    return db


class TestClassifierFields:
    """Verify classify_resume returns all expected fields."""

    async def test_existing_fields_returned(self):
        """Baseline: job_domain, seniority_level, skills, confidence already work."""
        from services.hr_module.classifier import classify_resume
        llm_response = (
            '{"job_domain": "software_engineering", "seniority_level": "senior",'
            ' "skills": ["Python", "FastAPI"], "confidence": 0.9}'
        )
        with patch("services.hr_module.classifier.ask_llm", return_value=llm_response):
            result = await classify_resume("some resume text")

        assert result["job_domain"] == "software_engineering"
        assert result["seniority_level"] == "senior"
        assert "Python" in result["skills"]
        assert result["confidence"] == 0.9

    async def test_returns_years_experience(self):
        """NEW: classifier must return years_experience as int."""
        from services.hr_module.classifier import classify_resume
        llm_response = (
            '{"job_domain": "software_engineering", "seniority_level": "senior",'
            ' "skills": ["Python"], "confidence": 0.9, "years_experience": 7}'
        )
        with patch("services.hr_module.classifier.ask_llm", return_value=llm_response):
            result = await classify_resume("some resume text")

        assert "years_experience" in result, "classifier must return years_experience"
        assert isinstance(result["years_experience"], int)
        assert result["years_experience"] == 7

    async def test_returns_education_level(self):
        """NEW: classifier must return education_level from allowed vocabulary."""
        from services.hr_module.classifier import classify_resume
        allowed = {"high_school", "bachelor", "master", "phd", "bootcamp", "other"}
        llm_response = (
            '{"job_domain": "software_engineering", "seniority_level": "senior",'
            ' "skills": ["Python"], "confidence": 0.9, "education_level": "master"}'
        )
        with patch("services.hr_module.classifier.ask_llm", return_value=llm_response):
            result = await classify_resume("some resume text")

        assert "education_level" in result, "classifier must return education_level"
        assert result["education_level"] in allowed

    async def test_defaults_for_missing_new_fields(self):
        """NEW fields must have safe defaults when LLM omits them."""
        from services.hr_module.classifier import classify_resume
        llm_response = (
            '{"job_domain": "software_engineering", "seniority_level": "mid",'
            ' "skills": [], "confidence": 0.5}'
        )
        with patch("services.hr_module.classifier.ask_llm", return_value=llm_response):
            result = await classify_resume("some resume text")

        assert result.get("years_experience") is not None, "must default years_experience (e.g. 0)"
        assert result.get("education_level") is not None, "must default education_level (e.g. 'other')"

    async def test_skills_capped_at_reasonable_count(self):
        """Pinecone metadata has a size limit — skills list should not be unbounded."""
        from services.hr_module.classifier import classify_resume
        many_skills = [f"skill_{i}" for i in range(100)]
        llm_response = (
            f'{{"job_domain": "software_engineering", "seniority_level": "mid",'
            f' "skills": {many_skills}, "confidence": 0.7}}'
        )
        with patch("services.hr_module.classifier.ask_llm", return_value=llm_response):
            result = await classify_resume("some resume text")

        assert len(result["skills"]) <= 20, "skills must be capped at 20 for Pinecone metadata safety"


class TestPineconeMetadata:
    """Verify store_resume passes correct metadata to Pinecone upsert."""

    async def test_existing_fields_still_present(self):
        """Regression: doc_type, job_domain, seniority_level must still be in metadata."""
        from services.hr_module.resume_intel import store_resume
        mock_pc = MagicMock()

        with patch("services.hr_module.resume_intel.get_pinecone", return_value=mock_pc), \
             patch("services.hr_module.resume_intel.get_db", return_value=_mock_db()):
            await store_resume(_make_state())

        meta = _pinecone_metadata(mock_pc)
        assert meta["doc_type"] == "resume"
        assert meta["job_domain"] == "software_engineering"
        assert meta["seniority_level"] == "senior"

    async def test_skills_stored_in_pinecone(self):
        """skills must be in Pinecone metadata to enable $in filtering (e.g. filter by 'Python')."""
        from services.hr_module.resume_intel import store_resume
        mock_pc = MagicMock()

        with patch("services.hr_module.resume_intel.get_pinecone", return_value=mock_pc), \
             patch("services.hr_module.resume_intel.get_db", return_value=_mock_db()):
            await store_resume(_make_state())

        meta = _pinecone_metadata(mock_pc)
        assert "skills" in meta, "skills missing from Pinecone metadata"
        assert "Python" in meta["skills"]
        assert "FastAPI" in meta["skills"]

    async def test_confidence_stored_in_pinecone(self):
        """confidence must be in Pinecone metadata to filter out low-quality classifications."""
        from services.hr_module.resume_intel import store_resume
        mock_pc = MagicMock()

        with patch("services.hr_module.resume_intel.get_pinecone", return_value=mock_pc), \
             patch("services.hr_module.resume_intel.get_db", return_value=_mock_db()):
            await store_resume(_make_state())

        meta = _pinecone_metadata(mock_pc)
        assert "confidence" in meta, "confidence missing from Pinecone metadata"
        assert meta["confidence"] == 0.92

    async def test_years_experience_stored_in_pinecone(self):
        """years_experience must be in Pinecone metadata to enable range filtering ($gte, $lte)."""
        from services.hr_module.resume_intel import store_resume
        mock_pc = MagicMock()

        with patch("services.hr_module.resume_intel.get_pinecone", return_value=mock_pc), \
             patch("services.hr_module.resume_intel.get_db", return_value=_mock_db()):
            await store_resume(_make_state())

        meta = _pinecone_metadata(mock_pc)
        assert "years_experience" in meta, "years_experience missing from Pinecone metadata"
        assert meta["years_experience"] == 7

    async def test_education_level_stored_in_pinecone(self):
        """education_level must be in Pinecone metadata to filter by degree."""
        from services.hr_module.resume_intel import store_resume
        mock_pc = MagicMock()

        with patch("services.hr_module.resume_intel.get_pinecone", return_value=mock_pc), \
             patch("services.hr_module.resume_intel.get_db", return_value=_mock_db()):
            await store_resume(_make_state())

        meta = _pinecone_metadata(mock_pc)
        assert "education_level" in meta, "education_level missing from Pinecone metadata"
        assert meta["education_level"] == "master"

    async def test_text_snippet_stored_in_pinecone(self):
        """text_snippet must be in Pinecone metadata to enable reranking without a MongoDB round-trip."""
        from services.hr_module.resume_intel import store_resume
        mock_pc = MagicMock()

        with patch("services.hr_module.resume_intel.get_pinecone", return_value=mock_pc), \
             patch("services.hr_module.resume_intel.get_db", return_value=_mock_db()):
            await store_resume(_make_state())

        meta = _pinecone_metadata(mock_pc)
        assert "text_snippet" in meta, "text_snippet missing from Pinecone metadata"
        assert len(meta["text_snippet"]) > 0

    async def test_text_snippet_capped_at_500_chars(self):
        """text_snippet must be <= 500 chars to stay within Pinecone's 40 KB metadata limit."""
        from services.hr_module.resume_intel import store_resume
        mock_pc = MagicMock()
        long_text = "Resume content. " * 200

        with patch("services.hr_module.resume_intel.get_pinecone", return_value=mock_pc), \
             patch("services.hr_module.resume_intel.get_db", return_value=_mock_db()):
            await store_resume(_make_state(text=long_text))

        meta = _pinecone_metadata(mock_pc)
        assert len(meta["text_snippet"]) <= 500

    async def test_text_snippet_matches_resume_start(self):
        """text_snippet should be the beginning of the resume text (most relevant part)."""
        from services.hr_module.resume_intel import store_resume
        mock_pc = MagicMock()
        text = "Jane Smith\nSenior Python Engineer\n" + "X" * 1000

        with patch("services.hr_module.resume_intel.get_pinecone", return_value=mock_pc), \
             patch("services.hr_module.resume_intel.get_db", return_value=_mock_db()):
            await store_resume(_make_state(text=text))

        meta = _pinecone_metadata(mock_pc)
        assert meta["text_snippet"].startswith("Jane Smith")

    async def test_no_upsert_when_embedding_empty(self):
        """Pinecone upsert must be skipped when embedding is empty (same as existing behaviour)."""
        from services.hr_module.resume_intel import store_resume
        mock_pc = MagicMock()
        state = _make_state()
        state["embedding"] = []

        with patch("services.hr_module.resume_intel.get_pinecone", return_value=mock_pc), \
             patch("services.hr_module.resume_intel.get_db", return_value=_mock_db()):
            await store_resume(state)

        mock_pc.upsert.assert_not_called()
