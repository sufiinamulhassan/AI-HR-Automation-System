import uuid

import pytest

from config.database import get_db
from config.llm import _record_llm, track_llm_cost

pytestmark = pytest.mark.anyio


class _Usage:
    def __init__(self, prompt=0, completion=0):
        self.prompt_tokens = prompt
        self.completion_tokens = completion


async def test_track_llm_cost_persists_feature_model_tokens_and_cost(client):
    db = get_db()
    ref_id = f"test-ref-{uuid.uuid4().hex[:8]}"

    async with track_llm_cost("interview_evaluation", ref_id):
        _record_llm("gpt-4o-mini", _Usage(prompt=1000, completion=500))

    try:
        doc = await db.cost_ledger.find_one({"source": "interview_evaluation", "ref_id": ref_id})
        assert doc is not None
        assert doc["model"] == "gpt-4o-mini"
        assert doc["models"]["gpt-4o-mini"]["prompt_tokens"] == 1000
        assert doc["models"]["gpt-4o-mini"]["completion_tokens"] == 500
        assert doc["models"]["gpt-4o-mini"]["calls"] == 1
        assert doc["prompt_tokens"] == 1000
        assert doc["completion_tokens"] == 500
        assert doc["llm_calls"] == 1
        expected_cost = 1000 * 0.15 / 1e6 + 500 * 0.60 / 1e6
        assert abs(doc["cost_usd"] - expected_cost) < 1e-9
    finally:
        await db.cost_ledger.delete_many({"source": "interview_evaluation", "ref_id": ref_id})


async def test_track_llm_cost_mixed_models_reports_breakdown_and_no_single_model():
    db = get_db()
    ref_id = f"test-ref-{uuid.uuid4().hex[:8]}"

    async with track_llm_cost("resume_bulk", ref_id):
        _record_llm("gpt-4o-mini", _Usage(prompt=100, completion=50))
        _record_llm("claude-sonnet-5", _Usage(prompt=200, completion=100))

    try:
        doc = await db.cost_ledger.find_one({"source": "resume_bulk", "ref_id": ref_id})
        assert doc is not None
        assert doc["model"] is None
        assert set(doc["models"].keys()) == {"gpt-4o-mini", "claude-sonnet-5"}
        assert doc["models"]["gpt-4o-mini"]["prompt_tokens"] == 100
        assert doc["models"]["claude-sonnet-5"]["prompt_tokens"] == 200
        assert doc["prompt_tokens"] == 300
        assert doc["completion_tokens"] == 150
    finally:
        await db.cost_ledger.delete_many({"source": "resume_bulk", "ref_id": ref_id})


async def test_track_llm_cost_nested_call_joins_outer_batch_and_does_not_double_write():
    db = get_db()
    batch_ref = f"test-batch-{uuid.uuid4().hex[:8]}"
    nested_ref = f"test-nested-{uuid.uuid4().hex[:8]}"

    async with track_llm_cost("resume_bulk", batch_ref):
        _record_llm("gpt-4o-mini", _Usage(prompt=10, completion=5))
        async with track_llm_cost("resume_classification", nested_ref):
            _record_llm("gpt-4o-mini", _Usage(prompt=20, completion=10))
        _record_llm("gpt-4o-mini", _Usage(prompt=30, completion=15))

    try:
        nested_doc = await db.cost_ledger.find_one(
            {"source": "resume_classification", "ref_id": nested_ref}
        )
        assert nested_doc is None

        outer_doc = await db.cost_ledger.find_one({"source": "resume_bulk", "ref_id": batch_ref})
        assert outer_doc is not None
        assert outer_doc["prompt_tokens"] == 10 + 20 + 30
        assert outer_doc["completion_tokens"] == 5 + 10 + 15
        assert outer_doc["llm_calls"] == 3
    finally:
        await db.cost_ledger.delete_many({"source": "resume_bulk", "ref_id": batch_ref})
        await db.cost_ledger.delete_many({"source": "resume_classification", "ref_id": nested_ref})


async def test_track_llm_cost_skips_write_when_nothing_was_spent():
    db = get_db()
    ref_id = f"test-empty-{uuid.uuid4().hex[:8]}"

    async with track_llm_cost("interview_question_gen", ref_id):
        pass

    doc = await db.cost_ledger.find_one({"source": "interview_question_gen", "ref_id": ref_id})
    assert doc is None
