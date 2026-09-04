"""Tests for domain-aware relevance gating in the matcher — hr_module."""
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

pytestmark = pytest.mark.anyio


def test_passes_relevance_rules():
    from services.hr_module.matcher import _passes_relevance
    assert _passes_relevance(0.40, "devops", "devops") is True
    assert _passes_relevance(0.30, "devops", "devops") is False
    assert _passes_relevance(0.47, "marketing", "machine_learning") is False
    assert _passes_relevance(0.58, "data_science", "machine_learning") is True
    assert _passes_relevance(0.40, None, "devops") is False


async def test_cross_domain_low_similarity_excluded():
    """A Marketing JD must not pull an ML resume that sits at ~0.47."""
    from services.hr_module import matcher
    db = MagicMock()
    db.jobs.find_one = AsyncMock(return_value={"deadline_at": None})
    db.jobs.update_one = AsyncMock()
    pc = MagicMock()
    pc.query.return_value = MagicMock(matches=[
        {"id": "res-ml", "score": 0.47, "metadata": {"job_domain": "machine_learning"}},
    ])
    with patch.object(matcher, "get_db", return_value=db), \
         patch.object(matcher, "get_pinecone", return_value=pc):
        res = await matcher.match_jd_to_resume_pool("job-mktg", {"required_domain": "marketing"}, [0.1] * 1536)
    assert res == []
    db.jobs.update_one.assert_not_called()


async def test_same_domain_match_included():
    from services.hr_module import matcher
    db = MagicMock()
    db.jobs.find_one = AsyncMock(return_value={"deadline_at": None})
    db.jobs.update_one = AsyncMock()
    pc = MagicMock()
    pc.query.return_value = MagicMock(matches=[
        {"id": "res-mktg", "score": 0.40, "metadata": {"job_domain": "marketing"}},
    ])
    with patch.object(matcher, "get_db", return_value=db), \
         patch.object(matcher, "get_pinecone", return_value=pc):
        res = await matcher.match_jd_to_resume_pool("job-mktg", {"required_domain": "marketing"}, [0.1] * 1536)
    assert len(res) == 1 and res[0]["resume_id"] == "res-mktg"
    db.jobs.update_one.assert_called_once()
