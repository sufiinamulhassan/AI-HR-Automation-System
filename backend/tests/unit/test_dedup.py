"""Tests for resume duplicate detection — hr_module.

Covers check_duplicate matching on file bytes (file_hash) and normalized content
(text_hash), exclusion of failed records, and exclusion of the record being
processed (its own pending stub).
"""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

pytestmark = pytest.mark.anyio


def _mock_db(found: dict | None):
    db = MagicMock()
    db.resumes.find_one = AsyncMock(return_value=found)
    return db


class TestCheckDuplicate:

    async def test_returns_existing_id_on_match(self):
        from services.hr_module.resume_intel import check_duplicate
        db = _mock_db({"resume_id": "existing-1"})
        with patch("services.hr_module.resume_intel.get_db", return_value=db):
            result = await check_duplicate(b"some pdf bytes")
        assert result == "existing-1"

    async def test_returns_none_when_no_match(self):
        from services.hr_module.resume_intel import check_duplicate
        db = _mock_db(None)
        with patch("services.hr_module.resume_intel.get_db", return_value=db):
            result = await check_duplicate(b"some pdf bytes")
        assert result is None

    async def test_query_excludes_failed(self):
        from services.hr_module.resume_intel import check_duplicate
        db = _mock_db(None)
        with patch("services.hr_module.resume_intel.get_db", return_value=db):
            await check_duplicate(b"bytes")
        query = db.resumes.find_one.call_args.args[0]
        assert query["processing_status"] == {"$ne": "failed"}

    async def test_text_hash_added_when_text_present(self):
        from services.hr_module.resume_intel import check_duplicate
        db = _mock_db(None)
        long_text = "Experienced cloud architect. " * 5
        with patch("services.hr_module.resume_intel.get_db", return_value=db):
            await check_duplicate(b"bytes", text=long_text)
        or_clauses = db.resumes.find_one.call_args.args[0]["$or"]
        keys = {k for clause in or_clauses for k in clause}
        assert "file_hash" in keys and "text_hash" in keys

    async def test_no_text_hash_when_text_absent(self):
        from services.hr_module.resume_intel import check_duplicate
        db = _mock_db(None)
        with patch("services.hr_module.resume_intel.get_db", return_value=db):
            await check_duplicate(b"bytes")
        or_clauses = db.resumes.find_one.call_args.args[0]["$or"]
        keys = {k for clause in or_clauses for k in clause}
        assert keys == {"file_hash"}

    async def test_exclude_resume_id_applied(self):
        from services.hr_module.resume_intel import check_duplicate
        db = _mock_db(None)
        with patch("services.hr_module.resume_intel.get_db", return_value=db):
            await check_duplicate(b"bytes", exclude_resume_id="self-123")
        query = db.resumes.find_one.call_args.args[0]
        assert query["resume_id"] == {"$ne": "self-123"}


class TestTextHash:

    async def test_same_content_different_whitespace_same_hash(self):
        from services.hr_module.resume_intel import _text_hash
        a = _text_hash("John Doe\nSenior Engineer\n\nPython, AWS, Docker")
        b = _text_hash("john doe   senior engineer   python, aws, docker")
        assert a and a == b

    async def test_short_text_not_fingerprinted(self):
        from services.hr_module.resume_intel import _text_hash
        assert _text_hash("hi") == ""
