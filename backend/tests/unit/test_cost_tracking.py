"""Tests for OpenAI usage/cost accumulation — config.llm."""


class _Usage:
    def __init__(self, prompt=0, completion=0, total=0):
        self.prompt_tokens = prompt
        self.completion_tokens = completion
        self.total_tokens = total


def test_usage_accumulates_tokens_and_cost():
    from config import llm
    acc = llm.start_usage_tracking()

    llm._record_llm("gpt-4o-mini", _Usage(prompt=1000, completion=500))
    llm._record_embed("text-embedding-3-small", _Usage(total=2000))

    assert acc["llm_calls"] == 1
    assert acc["embedding_calls"] == 1
    assert acc["prompt_tokens"] == 1000
    assert acc["completion_tokens"] == 500
    assert acc["embedding_tokens"] == 2000

    expected = 1000 * 0.15 / 1e6 + 500 * 0.60 / 1e6 + 2000 * 0.02 / 1e6
    assert abs(acc["cost_usd"] - expected) < 1e-12


def test_record_is_noop_without_tracking():
    from config import llm
    llm._usage_ctx.set(None)
    llm._record_llm("gpt-4o", _Usage(prompt=10, completion=10))
    llm._record_embed("text-embedding-3-small", _Usage(total=10))


def test_unknown_model_uses_fallback_pricing():
    from config import llm
    acc = llm.start_usage_tracking()
    llm._record_llm("some-unknown-model", _Usage(prompt=1_000_000, completion=0))
    assert abs(acc["cost_usd"] - 2.5) < 1e-6
