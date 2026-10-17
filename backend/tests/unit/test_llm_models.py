import json

import pytest

import config.llm as llm
from config.settings import Settings, settings

pytestmark = pytest.mark.anyio


async def test_openai_models_are_the_defaults_for_everything_a_config_file_does_not_override():
    fields = Settings.model_fields
    expected = {
        "DEFAULT_LLM_MODEL": "gpt-4o",
        "RESUME_CLASSIFICATION_MODEL": "gpt-4o-mini",
        "CODE_EVAL_MODEL": "gpt-4o",
        "CODE_CORRECTNESS_MODEL": "gpt-4o",
    }
    for name, model in expected.items():
        assert fields[name].default == model, name
        assert llm.provider_for_model(model) == "openai"
    assert fields["LLM_EFFORT"].default == "low"


async def test_the_picker_offers_claude_then_openai_cheapest_first_within_each():
    models = llm.selectable_models()
    ids = [m["id"] for m in models]
    assert ids[:6] == [
        "claude-haiku-5-5", "claude-haiku-4-5", "claude-sonnet-5-5", "claude-sonnet-5", "claude-opus-5-5", "claude-fable-5-1",
    ]
    assert ids[6:] == [
        "gpt-5-nano", "gpt-6-luna", "gpt-4o-mini", "gpt-4.1-mini", "gpt-5-mini", "gpt-5.4-mini",
        "gpt-4.1", "gpt-4o", "gpt-6-sol", "gpt-5.4", "gpt-5.5", "gpt-6-astra",
    ]
    providers = [m["provider"] for m in models]
    assert providers == sorted(providers, key=["anthropic", "openai"].index)


async def test_every_selectable_model_is_routed_and_priced_and_the_picker_carries_the_price():
    for m in llm.selectable_models():
        assert llm.provider_for_model(m["id"]) == m["provider"]
        assert m["id"] in llm._LLM_PRICING
        assert m["price_in"] == llm._LLM_PRICING[m["id"]]["in"] > 0
        assert m["price_out"] == llm._LLM_PRICING[m["id"]]["out"] > m["price_in"]
    for provider in ("anthropic", "openai"):
        prices = [m["price_out"] for m in llm.selectable_models() if m["provider"] == provider]
        assert prices == sorted(prices), f"{provider}: cheapest first"


async def test_every_registered_model_is_priced_and_named_once():
    ids = [m["id"] for m in llm.MODEL_REGISTRY]
    assert len(ids) == len(set(ids))
    for m in llm.MODEL_REGISTRY:
        assert m["id"] in llm._LLM_PRICING, m["id"]
        assert m["name"] and chr(0x2014) not in m["name"]
        assert "context" not in m or m["context"] > 0
    assert set(llm.SELECTABLE_MODEL_IDS) <= set(ids)


async def test_the_default_is_a_selectable_model():
    assert Settings.model_fields["DEFAULT_LLM_MODEL"].default in llm.SELECTABLE_MODEL_IDS


@pytest.mark.parametrize("model_id,expected", [
    ("claude-haiku-4-5", {"in": 1.0, "out": 5.0}),
    ("claude-haiku-4-5-20251001", {"in": 1.0, "out": 5.0}),
    ("claude-sonnet-5-5", {"in": 2.0, "out": 10.0}),
    ("claude-sonnet-5", {"in": 2.0, "out": 10.0}),
    ("claude-opus-5-5", {"in": 4.0, "out": 20.0}),
    ("claude-fable-5-1", {"in": 10.0, "out": 50.0}),
    ("claude-haiku-5-5", {"in": 0.10, "out": 0.50}),
    ("claude-sonnet-4-6", {"in": 3.0, "out": 15.0}),
    ("gpt-4o-mini", {"in": 0.15, "out": 0.6}),
    ("gpt-5-nano", {"in": 0.05, "out": 0.40}),
    ("gpt-5.4-mini", {"in": 0.75, "out": 4.50}),
    ("gpt-5.5", {"in": 5.0, "out": 30.0}),
    ("gpt-6-luna", {"in": 0.10, "out": 0.50}),
    ("gpt-6-astra", {"in": 10.0, "out": 50.0}),
    ("gpt-5.4-2026-03-05", {"in": 2.5, "out": 15.0}),
    ("claude-haiku-4-5:variant", {"in": 1.0, "out": 5.0}),
])
async def test_price_for_known_models(model_id, expected):
    assert llm.price_for(model_id) == expected


async def test_an_unlisted_model_gets_a_plausible_fallback_not_zero():
    assert llm.price_for("some-future-model") == llm._FALLBACK_PRICE
    assert llm.price_for(None) == llm._FALLBACK_PRICE


class _Usage:
    def __init__(self, i, o):
        self.input_tokens, self.output_tokens = i, o


async def test_a_cv_on_haiku_costs_a_fraction_of_a_cent_and_200_cost_well_under_three_dollars():
    acc = llm.start_usage_tracking()
    try:
        llm._record_llm("claude-haiku-4-5", _Usage(1367, 208))
        per_cv = acc["cost_usd"]
    finally:
        llm._usage_ctx.set(None)
    assert per_cv == pytest.approx(1367 / 1e6 * 1.0 + 208 / 1e6 * 5.0)
    assert per_cv < 0.003
    assert per_cv * 200 < 1.0


async def test_the_same_cv_is_dearer_on_stronger_models_in_price_order():
    costs = []
    for mid in ("claude-haiku-4-5", "claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-5-1"):
        acc = llm.start_usage_tracking()
        try:
            llm._record_llm(mid, _Usage(1367, 208))
            costs.append(acc["cost_usd"])
        finally:
            llm._usage_ctx.set(None)
    assert costs == sorted(costs) and len(set(costs)) == 4


@pytest.mark.parametrize("model_id,expected", [
    ("claude-haiku-4-5", None),
    ("claude-haiku-4-5-20251001", None),
    ("claude-haiku-5-5", "low"),
    ("claude-sonnet-5-5", "low"),
    ("claude-sonnet-5", "low"),
    ("claude-opus-5-5", "low"),
    ("claude-fable-5-1", "low"),
    ("some-unknown-claude", None),
])
async def test_effort_is_sent_only_to_models_that_accept_it(model_id, expected):
    assert llm._effort_for(model_id) == expected


async def test_effort_follows_the_setting_and_ignores_a_bad_value(monkeypatch):
    monkeypatch.setattr(settings, "LLM_EFFORT", "high")
    assert llm._effort_for("claude-sonnet-5-5") == "high"
    monkeypatch.setattr(settings, "LLM_EFFORT", "  MEDIUM ")
    assert llm._effort_for("claude-opus-5-5") == "medium"
    monkeypatch.setattr(settings, "LLM_EFFORT", "turbo")
    assert llm._effort_for("claude-sonnet-5-5") is None
    monkeypatch.setattr(settings, "LLM_EFFORT", "")
    assert llm._effort_for("claude-sonnet-5-5") is None
    monkeypatch.setattr(settings, "LLM_EFFORT", "high")
    assert llm._effort_for("claude-haiku-4-5") is None


class _Block:
    type = "text"

    def __init__(self, text):
        self.text = text


class _Message:
    stop_reason = "end_turn"
    usage = _Usage(10, 5)

    def __init__(self, text):
        self.content = [_Block(text)]


class _Messages:
    def __init__(self, reply):
        self.reply, self.captured = reply, {}

    async def create(self, **kwargs):
        self.captured = kwargs
        return _Message(self.reply)


class _Client:
    def __init__(self, reply="ok"):
        self.messages = _Messages(reply)


def _install(monkeypatch, reply="ok"):
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "sk-ant-test")
    client = _Client(reply)
    monkeypatch.setattr(llm, "get_anthropic_client", lambda: client)
    return client.messages


async def test_haiku_gets_no_effort_and_no_thinking_parameters(monkeypatch):
    sent = _install(monkeypatch)
    await llm.ask_llm(prompt="p", system="s", model="claude-haiku-4-5")
    assert "output_config" not in sent.captured and "thinking" not in sent.captured
    assert sent.captured["model"] == "claude-haiku-4-5"


async def test_a_thinking_model_is_sent_low_effort_by_default(monkeypatch):
    sent = _install(monkeypatch)
    await llm.ask_llm(prompt="p", system="s", model="claude-sonnet-5-5")
    assert sent.captured["output_config"] == {"effort": "low"}


async def test_json_mode_adds_the_instruction_without_touching_output_config_on_haiku(monkeypatch):
    sent = _install(monkeypatch)
    await llm.ask_llm(prompt="p", system="s", model="claude-haiku-4-5", json_mode=True)
    assert "valid JSON object" in sent.captured["system"]
    assert "output_config" not in sent.captured


async def test_a_schema_and_effort_share_one_output_config(monkeypatch):
    schema = {"type": "object", "properties": {"a": {"type": "string"}}, "required": ["a"], "additionalProperties": False}
    sent = _install(monkeypatch)
    await llm.ask_llm(prompt="p", system="s", model="claude-sonnet-5-5", json_schema=schema)
    assert sent.captured["output_config"] == {"effort": "low", "format": {"type": "json_schema", "schema": schema}}
    await llm.ask_llm(prompt="p", system="s", model="claude-haiku-4-5", json_schema=schema)
    assert sent.captured["output_config"] == {"format": {"type": "json_schema", "schema": schema}}


async def test_haiku_5_5_is_sent_effort_like_the_other_thinking_models(monkeypatch):
    sent = _install(monkeypatch)
    await llm.ask_llm(prompt="p", system="s", model="claude-haiku-5-5")
    assert sent.captured["output_config"] == {"effort": "low"}
    assert sent.captured["model"] == "claude-haiku-5-5"
    assert "temperature" not in sent.captured and "thinking" not in sent.captured


async def test_a_prompt_over_100k_tokens_bills_haiku_5_5_at_the_long_rate():
    acc = llm.start_usage_tracking()
    try:
        llm._record_llm("claude-haiku-5-5", _Usage(1_000, 500))
        short = acc["cost_usd"]
        llm._record_llm("claude-haiku-5-5", _Usage(200_000, 1_000))
        long_call = acc["cost_usd"] - short
    finally:
        llm._usage_ctx.set(None)
    assert short == pytest.approx(1_000 / 1e6 * 0.10 + 500 / 1e6 * 0.50)
    assert long_call == pytest.approx(200_000 / 1e6 * 0.50 + 1_000 / 1e6 * 2.50)


async def test_the_token_ceiling_leaves_room_without_being_a_charge(monkeypatch):
    sent = _install(monkeypatch)
    await llm.ask_llm(prompt="p", system="s", model="claude-haiku-4-5", max_tokens=450)
    assert sent.captured["max_tokens"] == 4000


@pytest.mark.parametrize("raw,expected", [
    ('{"a": 1}', {"a": 1}),
    ('```json\n{"a": 1, "b": [1, 2]}\n```', {"a": 1, "b": [1, 2]}),
    ('```\n{"a": 1}\n```', {"a": 1}),
    ('Here is the result:\n{"a": 1}\nHope that helps.', {"a": 1}),
    ('```json\n[1, 2, 3]\n```', [1, 2, 3]),
    ('  \n```JSON\n{"nested": {"x": "```"}}\n```  ', {"nested": {"x": "```"}}),
])
async def test_clean_json_reply_unwraps_what_the_model_added(raw, expected):
    assert json.loads(llm.clean_json_reply(raw)) == expected


@pytest.mark.parametrize("raw", ["", "no json here", '{"broken": ', "```json\nnot json\n```", "[1, 2"])
async def test_clean_json_reply_never_makes_an_unparseable_reply_worse(raw):
    assert llm.clean_json_reply(raw) == raw


async def test_ask_llm_returns_parseable_json_when_haiku_fences_it(monkeypatch):
    _install(monkeypatch, reply='```json\n{"job_domain": "data_engineering", "years_experience": 9}\n```')
    out = await llm.ask_llm(prompt="p", system="s", model="claude-haiku-4-5", json_mode=True)
    assert json.loads(out) == {"job_domain": "data_engineering", "years_experience": 9}


async def test_plain_text_replies_are_not_touched(monkeypatch):
    reply = "Plain answer with {braces} inside."
    _install(monkeypatch, reply=reply)
    assert await llm.ask_llm(prompt="p", system="s", model="claude-haiku-4-5") == reply


async def test_the_classifier_reads_a_fenced_haiku_reply(monkeypatch):
    from services.hr_module.classifier import classify_resume

    fenced = (
        '```json\n{"job_domain": "data_engineering", "seniority_level": "senior", "skills": ["Kafka", "Spark"],'
        ' "confidence": 0.9, "years_experience": 9, "education_level": "bachelor", "industry": "technology"}\n```'
    )
    _install(monkeypatch, reply=fenced)
    monkeypatch.setattr(settings, "RESUME_CLASSIFICATION_MODEL", "claude-haiku-4-5")
    result = await classify_resume("Priya Nair, data engineer. " * 40)
    assert result["job_domain"] == "data_engineering"
    assert result["years_experience"] == 9 and result["skills"] == ["Kafka", "Spark"]


async def test_cv_classification_uses_its_own_cheap_model_unless_one_is_passed_explicitly(monkeypatch):
    import services.hr_module.classifier as classifier

    seen = []

    async def fake_ask_llm(**kwargs):
        seen.append(kwargs["model"])
        return "{}"

    monkeypatch.setattr(classifier, "ask_llm", fake_ask_llm)
    monkeypatch.setattr(settings, "DEFAULT_LLM_MODEL", "claude-opus-5-5")
    monkeypatch.setattr(settings, "RESUME_CLASSIFICATION_MODEL", "claude-haiku-4-5")
    await classifier.classify_resume("A resume " * 50)
    await classifier.classify_resume("A resume " * 50, model="claude-sonnet-5-5")
    assert seen == ["claude-haiku-4-5", "claude-sonnet-5-5"]


class _OpenAIChoice:
    class message:
        content = "ok"


class _OpenAIResponse:
    choices = [_OpenAIChoice()]
    usage = None


class _Completions:
    def __init__(self):
        self.captured = {}

    async def create(self, **kwargs):
        self.captured = kwargs
        return _OpenAIResponse()


class _OpenAIClient:
    def __init__(self):
        self.completions = _Completions()
        self.chat = self


def _install_openai(monkeypatch):
    client = _OpenAIClient()
    monkeypatch.setattr(llm, "get_openai_client", lambda: client)
    return client.completions


@pytest.mark.parametrize("model_id", [
    "gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-5.1", "gpt-5.2", "gpt-5.4", "gpt-5.4-mini", "gpt-5.5",
    "gpt-5.6-luna", "gpt-6-luna", "gpt-6-sol", "gpt-6.1-sol", "gpt-6-astra", "o1", "o3", "o4-mini",
    "gpt-5.4-2026-03-05",
])
async def test_reasoning_families_get_max_completion_tokens_and_no_temperature(monkeypatch, model_id):
    sent = _install_openai(monkeypatch)
    out = await llm.ask_llm(prompt="p", system="s", model=model_id, max_tokens=450, temperature=0.2)
    assert out == "ok"
    assert sent.captured["max_completion_tokens"] == 4000
    assert sent.captured["reasoning_effort"] == "low"
    assert "max_tokens" not in sent.captured and "temperature" not in sent.captured


@pytest.mark.parametrize("model_id", [
    "gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano", "gpt-4-turbo",
    "gpt-5-chat-latest", "ft:gpt-4o:acme:xyz", "gpt-3.5-turbo",
])
async def test_gpt_4_families_keep_the_classic_parameters(monkeypatch, model_id):
    sent = _install_openai(monkeypatch)
    await llm.ask_llm(prompt="p", system="s", model=model_id, max_tokens=450, temperature=0.2)
    assert sent.captured["max_tokens"] == 450 and sent.captured["temperature"] == 0.2
    assert "max_completion_tokens" not in sent.captured and "reasoning_effort" not in sent.captured


async def test_reasoning_effort_follows_the_setting_and_json_mode_is_kept(monkeypatch):
    sent = _install_openai(monkeypatch)
    for configured, expected in (("high", "high"), (" Medium ", "medium"), ("xhigh", "high"), ("max", "high")):
        monkeypatch.setattr(settings, "LLM_EFFORT", configured)
        await llm.ask_llm(prompt="p", system="s", model="gpt-5.4", json_mode=True)
        assert sent.captured["reasoning_effort"] == expected
        assert sent.captured["response_format"] == {"type": "json_object"}
    monkeypatch.setattr(settings, "LLM_EFFORT", "turbo")
    await llm.ask_llm(prompt="p", system="s", model="gpt-5.4")
    assert "reasoning_effort" not in sent.captured


async def test_a_caller_timeout_is_forwarded_on_both_openai_shapes(monkeypatch):
    sent = _install_openai(monkeypatch)
    await llm.ask_llm(prompt="p", system="s", model="gpt-5.4", timeout=12)
    assert sent.captured["timeout"] == 12
    await llm.ask_llm(prompt="p", system="s", model="gpt-4o", timeout=7)
    assert sent.captured["timeout"] == 7


async def test_an_unlisted_claude_id_is_routed_to_anthropic_not_openai(monkeypatch):
    sent = _install(monkeypatch)
    await llm.ask_llm(prompt="p", system="s", model="claude-opus-4-7")
    assert sent.captured["model"] == "claude-opus-4-7"
    assert sent.captured["output_config"] == {"effort": "low"}
