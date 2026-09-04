"""Tests for JD application-deadline handling — hr_module."""
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

pytestmark = pytest.mark.anyio


def _iso(days_from_now: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=days_from_now)).isoformat()


def test_job_is_open():
    from services.hr_module.matcher import _job_is_open
    assert _job_is_open({}) is True
    assert _job_is_open({"deadline_at": None}) is True
    assert _job_is_open({"deadline_at": _iso(5)}) is True
    assert _job_is_open({"deadline_at": _iso(-1)}) is False


def test_deadline_at_helper():
    from routes.jobs import _deadline_at
    created = datetime(2024, 1, 1, tzinfo=timezone.utc).isoformat()
    assert _deadline_at(created, None) is None
    assert _deadline_at(created, 0) is None
    out = _deadline_at(created, 30)
    assert out and out.startswith("2024-01-31")


async def test_match_jd_skips_expired_jd():
    """An expired JD must not pull in new resumes (short-circuits before Pinecone)."""
    from services.hr_module import matcher
    db = MagicMock()
    db.jobs.find_one = AsyncMock(return_value={"deadline_at": _iso(-2)})
    pc = MagicMock()
    with patch.object(matcher, "get_db", return_value=db), \
         patch.object(matcher, "get_pinecone", return_value=pc):
        res = await matcher.match_jd_to_resume_pool("job-1", {}, [0.1] * 1536)
    assert res == []
    pc.query.assert_not_called()


async def test_match_jd_runs_for_open_jd():
    """An open JD proceeds to query Pinecone."""
    from services.hr_module import matcher
    db = MagicMock()
    db.jobs.find_one = AsyncMock(return_value={"deadline_at": _iso(10)})
    db.jobs.update_one = AsyncMock()
    pc = MagicMock()
    pc.query.return_value = MagicMock(matches=[])
    with patch.object(matcher, "get_db", return_value=db), \
         patch.object(matcher, "get_pinecone", return_value=pc):
        res = await matcher.match_jd_to_resume_pool("job-1", {}, [0.1] * 1536)
    assert res == []
    pc.query.assert_called_once()
