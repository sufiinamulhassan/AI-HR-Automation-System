"""Tests for resume version history — hr_module (MVP2 §2.5).

When a candidate re-uploads a resume whose extracted email matches an
existing resume already in the system, the two are linked as versions of
the same person's resume: the new document gets `previous_resume_id`
pointing at the prior one and an incremented `version`; the prior document
gets `superseded_by` pointing forward at the new one. A resume whose email
matches nothing already in the system stays at version=1 /
previous_resume_id=None — identical to pre-feature behaviour.

Mirrors the mocked-db style already used by tests/unit/test_resume_metadata.py
and tests/unit/test_dedup.py (patching services.hr_module.resume_intel.get_db /
get_pinecone directly) rather than exercising the real HTTP upload pipeline —
store_resume's LLM-backed neighbours (classify/embed) aren't relevant to this
feature and this keeps the tests fast and fully deterministic.
"""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

pytestmark = pytest.mark.anyio


def _cursor(docs: list[dict]):
    """Mimic db.resumes.find(...).sort(...).limit(...).to_list(...)."""
    cursor = MagicMock()
    cursor.sort.return_value = cursor
    cursor.limit.return_value = cursor
    cursor.to_list = AsyncMock(return_value=docs)
    return cursor


def _mock_db(prior_doc: dict | None = None):
    db = MagicMock()
    db.resumes.update_one = AsyncMock()
    db.resume_files.update_one = AsyncMock()
    db.resumes.find = MagicMock(return_value=_cursor([prior_doc] if prior_doc else []))
    return db


def _make_state(resume_id: str, text: str, raw_bytes: bytes = b"raw-bytes") -> dict:
    return {
        "resume_id": resume_id,
        "filename": f"{resume_id}.pdf",
        "text": text,
        "raw_bytes": raw_bytes,
        "classification": {},
        "embedding": [],
        "matched_jds": [],
    }


class TestStoreResumeVersionLinking:

    async def test_first_upload_defaults_to_version_1(self):
        """No prior resume anywhere with this email -> version=1, previous_resume_id=None,
        superseded_by=None (identical to pre-feature behaviour)."""
        from services.hr_module.resume_intel import store_resume

        db = _mock_db(prior_doc=None)
        with patch("services.hr_module.resume_intel.get_db", return_value=db), \
             patch("services.hr_module.resume_intel.get_pinecone", return_value=None):
            result = await store_resume(_make_state("r1", "Jane Doe\njane@example.com\nEngineer"))

        assert result["candidate_email"] == "jane@example.com"
        doc = db.resumes.update_one.call_args.args[1]["$set"]
        assert doc["version"] == 1
        assert doc["previous_resume_id"] is None
        assert doc["superseded_by"] is None
        assert db.resumes.update_one.call_count == 1

    async def test_second_upload_same_email_links_as_new_version(self):
        """A second resume whose extracted email matches an existing resume links the two:
        new doc gets previous_resume_id + version=prior.version+1; prior doc gets
        superseded_by set to the new resume_id."""
        from services.hr_module.resume_intel import store_resume

        prior_doc = {"resume_id": "r1", "version": 1}
        db = _mock_db(prior_doc=prior_doc)
        with patch("services.hr_module.resume_intel.get_db", return_value=db), \
             patch("services.hr_module.resume_intel.get_pinecone", return_value=None):
            result = await store_resume(_make_state("r2", "Jane Doe\njane@example.com\nSenior Engineer now"))

        assert result["candidate_email"] == "jane@example.com"
        calls = db.resumes.update_one.call_args_list
        assert len(calls) == 2, "expected the new-doc upsert plus the prior-doc supersede update"

        new_filter, new_update = calls[0].args
        assert new_filter == {"resume_id": "r2"}
        new_doc = new_update["$set"]
        assert new_doc["previous_resume_id"] == "r1"
        assert new_doc["version"] == 2

        supersede_filter, supersede_update = calls[1].args
        assert supersede_filter == {"resume_id": "r1"}
        assert supersede_update == {"$set": {"superseded_by": "r2"}}

    async def test_lookup_query_scoped_to_email_excluding_self(self):
        from services.hr_module.resume_intel import store_resume

        db = _mock_db(prior_doc=None)
        with patch("services.hr_module.resume_intel.get_db", return_value=db), \
             patch("services.hr_module.resume_intel.get_pinecone", return_value=None):
            await store_resume(_make_state("r9", "Bob\nbob@example.com"))

        query = db.resumes.find.call_args.args[0]
        assert query["candidate_email"] == "bob@example.com"
        assert query["resume_id"] == {"$ne": "r9"}

    async def test_no_email_skips_version_lookup(self):
        """No extractable email -> no lookup attempted at all, version stays 1."""
        from services.hr_module.resume_intel import store_resume

        db = _mock_db(prior_doc=None)
        with patch("services.hr_module.resume_intel.get_db", return_value=db), \
             patch("services.hr_module.resume_intel.get_pinecone", return_value=None):
            result = await store_resume(_make_state("r10", "No contact info in this resume body at all"))

        assert result["candidate_email"] is None
        db.resumes.find.assert_not_called()
        doc = db.resumes.update_one.call_args.args[1]["$set"]
        assert doc["version"] == 1
        assert doc["previous_resume_id"] is None

    async def test_three_versions_chain_increments_correctly(self):
        """Uploading a THIRD resume for the same email (prior already at version 2)
        produces version=3 and links previous_resume_id to that v2 document."""
        from services.hr_module.resume_intel import store_resume

        prior_doc = {"resume_id": "r2", "version": 2}
        db = _mock_db(prior_doc=prior_doc)
        with patch("services.hr_module.resume_intel.get_db", return_value=db), \
             patch("services.hr_module.resume_intel.get_pinecone", return_value=None):
            await store_resume(_make_state("r3", "Jane Doe\njane@example.com\nStaff Engineer"))

        new_update = db.resumes.update_one.call_args_list[0].args[1]
        new_doc = new_update["$set"]
        assert new_doc["version"] == 3
        assert new_doc["previous_resume_id"] == "r2"

    async def test_supersede_failure_is_non_fatal(self):
        """A failure updating the prior doc's superseded_by must not raise —
        the new resume's own upload has already succeeded by that point."""
        from services.hr_module.resume_intel import store_resume

        prior_doc = {"resume_id": "r1", "version": 1}
        db = _mock_db(prior_doc=prior_doc)

        async def _update_one(filter_, update, **kw):
            if filter_ == {"resume_id": "r1"}:
                raise RuntimeError("simulated transient write failure")
            return MagicMock()

        db.resumes.update_one = AsyncMock(side_effect=_update_one)

        with patch("services.hr_module.resume_intel.get_db", return_value=db), \
             patch("services.hr_module.resume_intel.get_pinecone", return_value=None):
            result = await store_resume(_make_state("r2", "Jane Doe\njane@example.com\nUpdated"))

        assert result["candidate_email"] == "jane@example.com"


class TestResumeVersionsEndpoint:
    """GET /resumes/{resume_id}/versions — routes/resumes.py."""

    @staticmethod
    def _docs_db(docs: dict[str, dict]):
        async def fake_find_one(filt, proj=None):
            return docs.get(filt.get("resume_id"))

        db = MagicMock()
        db.resumes.find_one = AsyncMock(side_effect=fake_find_one)
        return db

    async def test_returns_full_chain_oldest_to_newest_from_any_node(self):
        import routes.resumes as resumes_route

        docs = {
            "r1": {"resume_id": "r1", "version": 1, "filename": "a.pdf", "created_at": "2026-01-01",
                   "processing_status": "processed", "previous_resume_id": None, "superseded_by": "r2"},
            "r2": {"resume_id": "r2", "version": 2, "filename": "b.pdf", "created_at": "2026-01-02",
                   "processing_status": "processed", "previous_resume_id": "r1", "superseded_by": "r3"},
            "r3": {"resume_id": "r3", "version": 3, "filename": "c.pdf", "created_at": "2026-01-03",
                   "processing_status": "processed", "previous_resume_id": "r2", "superseded_by": None},
        }
        db = self._docs_db(docs)

        with patch("routes.resumes.get_db", return_value=db):
            result = await resumes_route.get_resume_versions("r2", {"email": "u", "role": "admin"})

        versions = result["versions"]
        assert [v["resume_id"] for v in versions] == ["r1", "r2", "r3"]
        assert [v["version"] for v in versions] == [1, 2, 3]
        for v in versions:
            assert set(v.keys()) == {"resume_id", "version", "filename", "created_at", "processing_status"}

    async def test_single_version_resume_returns_chain_of_one(self):
        import routes.resumes as resumes_route

        docs = {
            "solo": {"resume_id": "solo", "version": 1, "filename": "solo.pdf",
                     "created_at": "2026-01-01", "processing_status": "processed",
                     "previous_resume_id": None, "superseded_by": None},
        }
        db = self._docs_db(docs)

        with patch("routes.resumes.get_db", return_value=db):
            result = await resumes_route.get_resume_versions("solo", {"email": "u", "role": "admin"})

        assert len(result["versions"]) == 1
        assert result["versions"][0]["resume_id"] == "solo"
        assert result["versions"][0]["version"] == 1

    async def test_missing_resume_raises_404(self):
        import routes.resumes as resumes_route
        from fastapi import HTTPException

        db = self._docs_db({})
        with patch("routes.resumes.get_db", return_value=db):
            with pytest.raises(HTTPException) as exc_info:
                await resumes_route.get_resume_versions("nope", {"email": "u", "role": "admin"})
        assert exc_info.value.status_code == 404
