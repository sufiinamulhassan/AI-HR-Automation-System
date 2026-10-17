from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from agents.resume_agent import embed_node
from config import llm
from config.settings import settings
from services.hr_module import jd_intel

pytestmark = pytest.mark.anyio

OUT_OF_CREDIT = (
    "Error code: 429 - {'error': {'message': 'You have no credits remaining. Add credits to continue using the API "
    "at https://platform.openai.com/settings/organization/billing/.', 'type': 'insufficient_quota', "
    "'param': None, 'code': 'credit_balance_exhausted'}}"
)


class _Embeddings:
    def __init__(self, outcome):
        self.outcome = outcome

    async def create(self, **kwargs):
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return SimpleNamespace(data=[SimpleNamespace(embedding=self.outcome)], usage=SimpleNamespace(total_tokens=3))


def _provider(monkeypatch, outcome):
    monkeypatch.setattr(llm, "get_openai_client", lambda: SimpleNamespace(embeddings=_Embeddings(outcome)))


async def _reason_for(monkeypatch, exc) -> str:
    _provider(monkeypatch, exc)
    zeros = await llm.get_embedding("a resume")
    assert zeros == [0.0] * settings.EMBEDDING_DIMENSIONS
    with pytest.raises(llm.EmbeddingUnavailable) as raised:
        llm.require_vector(zeros)
    return str(raised.value)


async def test_an_account_out_of_credit_is_named_as_that(monkeypatch):
    reason = await _reason_for(monkeypatch, Exception(OUT_OF_CREDIT))
    assert "no credit left" in reason and "platform operator" in reason
    assert "zero" not in reason.lower() and "429" not in reason


async def test_a_rejected_key_is_named_as_that_and_the_key_is_never_shown(monkeypatch):
    secret = "sk-proj-ABCDEF0123456789"
    reason = await _reason_for(monkeypatch, Exception(f"Error code: 401 - Incorrect API key provided: {secret}. invalid_api_key"))
    assert "rejected the API key" in reason
    assert secret not in reason and "sk-" not in reason


async def test_a_missing_key_is_named_as_that(monkeypatch):
    def no_client():
        raise RuntimeError("OPENAI_API_KEY is not configured")

    monkeypatch.setattr(llm, "get_openai_client", no_client)
    zeros = await llm.get_embedding("a resume")
    with pytest.raises(llm.EmbeddingUnavailable, match="no OpenAI API key is set"):
        llm.require_vector(zeros)


async def test_any_other_failure_says_the_request_failed_and_names_its_kind(monkeypatch):
    reason = await _reason_for(monkeypatch, ConnectionError("boom"))
    assert reason.startswith("Embeddings are unavailable") and "ConnectionError" in reason and "boom" not in reason


async def test_a_later_success_does_not_inherit_an_earlier_failures_reason(monkeypatch):
    await _reason_for(monkeypatch, Exception(OUT_OF_CREDIT))
    _provider(monkeypatch, [0.25, 0.5])
    assert await llm.get_embedding("another resume") == [0.25, 0.5]
    with pytest.raises(llm.EmbeddingUnavailable) as raised:
        llm.require_vector([0.0, 0.0])
    assert "no credit left" not in str(raised.value)


def test_require_vector_passes_a_real_vector_and_stops_an_empty_or_zero_one():
    assert llm.require_vector([0.0, 0.1]) == [0.0, 0.1]
    for blank in ([], [0.0] * 8):
        with pytest.raises(llm.EmbeddingUnavailable):
            llm.require_vector(blank)


async def test_a_resume_whose_embedding_failed_stops_with_the_reason_and_carries_no_vector(monkeypatch):
    _provider(monkeypatch, Exception(OUT_OF_CREDIT))
    result = await embed_node({"text": "Ada Lovelace, engineer", "resume_id": "r1"})
    assert "no credit left" in result["error"]
    assert "embedding" not in result


async def test_a_resume_that_embeds_carries_its_vector(monkeypatch):
    _provider(monkeypatch, [0.3, 0.4])
    result = await embed_node({"text": "Ada Lovelace, engineer", "resume_id": "r1"})
    assert result["embedding"] == [0.3, 0.4] and "error" not in result


async def test_a_job_is_not_parsed_into_a_zero_vector(monkeypatch):
    _provider(monkeypatch, Exception(OUT_OF_CREDIT))
    reply = '{"skills": ["Python"], "experience_level": "senior", "job_domain": "software_engineering"}'
    upsert = AsyncMock()
    pinecone = SimpleNamespace(upsert=upsert)
    with patch("services.hr_module.jd_intel.ask_llm", return_value=reply), \
         patch("services.hr_module.jd_intel.get_pinecone", return_value=pinecone), \
         patch("services.hr_module.jd_intel.get_db", return_value=None):
        with pytest.raises(llm.EmbeddingUnavailable, match="no credit left"):
            await jd_intel.parse_jd("job-1", "Python Dev", "We need a Python developer.")
    upsert.assert_not_called()
