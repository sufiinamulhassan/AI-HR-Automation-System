import httpx
import openai
import anthropic
import pytest

import config.llm as llm

pytestmark = pytest.mark.anyio


class _FakeResp:
    class _Choice:
        class _Message:
            content = "hello"
        message = _Message()
    choices = [_Choice()]
    usage = None


class _CapturingCompletions:
    def __init__(self):
        self.captured: dict = {}

    async def create(self, **kwargs):
        self.captured.update(kwargs)
        return _FakeResp()


class _CapturingChat:
    def __init__(self, completions: _CapturingCompletions):
        self.completions = completions


class _CapturingOpenAIClient:
    def __init__(self):
        self.completions = _CapturingCompletions()
        self.chat = _CapturingChat(self.completions)


class _RaisingCompletions:
    async def create(self, **kwargs):
        request = httpx.Request("POST", "https://api.openai.com/v1/chat/completions")
        raise openai.APITimeoutError(request=request)


class _RaisingChat:
    completions = _RaisingCompletions()


class _RaisingOpenAIClient:
    chat = _RaisingChat()


class _AnthResp:
    class _Block:
        type = "text"
        text = "hello"
    content = [_Block()]
    usage = None
    stop_reason = "end_turn"


class _CapturingMessages:
    def __init__(self):
        self.captured: dict = {}

    async def create(self, **kwargs):
        self.captured.update(kwargs)
        return _AnthResp()


class _CapturingAnthropicClient:
    def __init__(self):
        self.messages = _CapturingMessages()


async def test_ask_llm_omits_timeout_kwarg_by_default_openai(monkeypatch):
    fake_client = _CapturingOpenAIClient()
    monkeypatch.setattr(llm, "get_openai_client", lambda: fake_client)

    out = await llm.ask_llm(prompt="p", system="s", model="gpt-4o")

    assert out == "hello"
    assert "timeout" not in fake_client.chat.completions.captured


async def test_ask_llm_forwards_explicit_timeout_openai(monkeypatch):
    fake_client = _CapturingOpenAIClient()
    monkeypatch.setattr(llm, "get_openai_client", lambda: fake_client)

    await llm.ask_llm(prompt="p", system="s", model="gpt-4o", timeout=40.0)

    assert fake_client.chat.completions.captured["timeout"] == 40.0


async def test_ask_llm_degrades_gracefully_on_openai_timeout(monkeypatch):
    monkeypatch.setattr(llm, "get_openai_client", lambda: _RaisingOpenAIClient())

    out = await llm.ask_llm(prompt="p", system="s", model="gpt-4o", json_mode=True, timeout=5.0)

    assert out == "{}"


async def test_ask_llm_omits_timeout_kwarg_by_default_anthropic(monkeypatch):
    from config.settings import settings

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "sk-ant-test")
    fake_client = _CapturingAnthropicClient()
    monkeypatch.setattr(llm, "get_anthropic_client", lambda: fake_client)

    out = await llm.ask_llm(prompt="p", system="s", model="claude-opus-5")

    assert out == "hello"
    assert "timeout" not in fake_client.messages.captured


async def test_ask_llm_forwards_explicit_timeout_anthropic(monkeypatch):
    from config.settings import settings

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "sk-ant-test")
    fake_client = _CapturingAnthropicClient()
    monkeypatch.setattr(llm, "get_anthropic_client", lambda: fake_client)

    await llm.ask_llm(prompt="p", system="s", model="claude-opus-5", timeout=40.0)

    assert fake_client.messages.captured["timeout"] == 40.0


class _AnthResp_Classifier:
    class _Block:
        type = "text"
        text = (
            '{"job_domain": "machine_learning", "seniority_level": "senior", '
            '"skills": ["python", "pytorch"], "confidence": 0.92, '
            '"years_experience": 7, "education_level": "master", '
            '"industry": "technology"}'
        )
    content = [_Block()]
    usage = None
    stop_reason = "end_turn"


async def test_classify_resume_end_to_end_with_anthropic_model_override(monkeypatch):
    from config.settings import settings
    from services.hr_module.classifier import classify_resume

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "sk-ant-test")

    class _Messages:
        async def create(self, **kwargs):
            assert kwargs["model"] == "claude-sonnet-5"
            assert "system" in kwargs
            return _AnthResp_Classifier()

    class _FakeAnthropicClient:
        messages = _Messages()

    monkeypatch.setattr(llm, "get_anthropic_client", lambda: _FakeAnthropicClient())

    result = await classify_resume(
        "Senior ML engineer, 7 years, PyTorch, published research.",
        model="claude-sonnet-5",
    )

    assert result["job_domain"] == "machine_learning"
    assert result["seniority_level"] == "senior"
    assert result["skills"] == ["python", "pytorch"]
    assert result["confidence"] == 0.92
    assert result["years_experience"] == 7
    assert result["education_level"] == "master"
    assert result["industry"] == "technology"
