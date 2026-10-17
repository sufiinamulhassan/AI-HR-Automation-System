import contextlib
import contextvars
import logging
import re

from openai import AsyncOpenAI

from config import tenancy
from config.settings import settings
from shared.utils import strip_em_dashes

logger = logging.getLogger(__name__)


def default_model() -> str:
    return tenancy.company_setting("default_llm_model", settings.DEFAULT_LLM_MODEL)

_LLM_PRICING = {
    "gpt-4o":          {"in": 2.50, "out": 10.00},
    "gpt-4o-mini":     {"in": 0.15, "out": 0.60},
    "gpt-4.1":         {"in": 2.00, "out": 8.00},
    "gpt-4.1-mini":    {"in": 0.40, "out": 1.60},
    "gpt-4.1-nano":    {"in": 0.10, "out": 0.40},
    "gpt-4-turbo":     {"in": 10.00, "out": 30.00},
    "gpt-4.5-preview": {"in": 75.00, "out": 150.00},
    "gpt-5":           {"in": 1.25, "out": 10.00},
    "gpt-5-mini":      {"in": 0.25, "out": 2.00},
    "gpt-5-nano":      {"in": 0.05, "out": 0.40},
    "gpt-5.1":         {"in": 1.25, "out": 10.00},
    "gpt-5.2":         {"in": 1.75, "out": 14.00},
    "gpt-5.4":         {"in": 2.50, "out": 15.00},
    "gpt-5.4-mini":    {"in": 0.75, "out": 4.50},
    "gpt-5.4-nano":    {"in": 0.20, "out": 1.25},
    "gpt-5.5":         {"in": 5.00, "out": 30.00},
    "gpt-5.6-luna":    {"in": 0.20, "out": 1.20},
    "gpt-5.6-terra":   {"in": 2.00, "out": 12.00},
    "gpt-5.6-sol":     {"in": 4.00, "out": 20.00},
    "gpt-6-luna":      {"in": 0.10, "out": 0.50},
    "gpt-6-sol":       {"in": 2.00, "out": 10.00},
    "gpt-6.1-sol":     {"in": 2.00, "out": 10.00},
    "gpt-6-astra":     {"in": 10.00, "out": 50.00},
    "o3":              {"in": 2.00, "out": 8.00},
    "o4-mini":         {"in": 1.10, "out": 4.40},
    "claude-fable-5-1":  {"in": 10.00, "out": 50.00},
    "claude-fable-5":    {"in": 10.00, "out": 50.00},
    "claude-opus-5-5":   {"in": 4.00,  "out": 20.00},
    "claude-opus-5":     {"in": 5.00,  "out": 25.00},
    "claude-opus-4-8":   {"in": 5.00,  "out": 25.00},
    "claude-sonnet-5-5": {"in": 2.00,  "out": 10.00},
    "claude-sonnet-5":   {"in": 2.00,  "out": 10.00},
    "claude-sonnet-4-6": {"in": 3.00,  "out": 15.00},
    "claude-haiku-5-5":  {"in": 0.10,  "out": 0.50},
    "claude-haiku-4-5":  {"in": 1.00,  "out": 5.00},
}
_LONG_PROMPT_PRICING = {
    "claude-haiku-5-5": (100_000, 0.50, 2.50),
}
_FALLBACK_PRICE = {"in": 2.5, "out": 10.0}


def price_for(model_id: str | None) -> dict:
    mid = model_id or ""
    if mid in _LLM_PRICING:
        return _LLM_PRICING[mid]
    base = _strip_snapshot(mid.split(":")[0])
    return _LLM_PRICING.get(base) or _FALLBACK_PRICE


def _strip_snapshot(model_id: str) -> str:
    return re.sub(r"-(\d{8}|\d{4}-\d{2}-\d{2})$", "", model_id or "")
_EMBED_PRICING = {
    "text-embedding-3-small": 0.02,
    "text-embedding-3-large": 0.13,
    "text-embedding-ada-002": 0.10,
}

_usage_ctx: contextvars.ContextVar[dict | None] = contextvars.ContextVar("_usage_ctx", default=None)


def start_usage_tracking() -> dict:
    acc = {
        "prompt_tokens": 0, "completion_tokens": 0, "embedding_tokens": 0,
        "llm_calls": 0, "embedding_calls": 0, "cost_usd": 0.0,
        "models": {},
        "company_id": tenancy.current_company_id(),
    }
    _usage_ctx.set(acc)
    return acc


def reset_usage_tracking() -> None:
    _usage_ctx.set(None)


def _ledger_db(acc_company_id: str | None):
    from config.database import get_db

    if not acc_company_id or acc_company_id == tenancy.current_company_id():
        return get_db()
    with tenancy.company_context(acc_company_id):
        return get_db()


def _record_llm(model_id: str, usage) -> None:
    acc = _usage_ctx.get()
    if acc is None or usage is None:
        return
    pt = getattr(usage, "prompt_tokens", None) or getattr(usage, "input_tokens", 0) or 0
    ct = getattr(usage, "completion_tokens", None) or getattr(usage, "output_tokens", 0) or 0
    price = price_for(model_id)
    rate_in, rate_out = price["in"], price["out"]
    long_tier = _LONG_PROMPT_PRICING.get(_strip_snapshot(model_id))
    if long_tier and pt > long_tier[0]:
        rate_in, rate_out = long_tier[1], long_tier[2]
    cost = pt / 1e6 * rate_in + ct / 1e6 * rate_out
    acc["prompt_tokens"] += pt
    acc["completion_tokens"] += ct
    acc["llm_calls"] += 1
    acc["cost_usd"] += cost

    models = acc.setdefault("models", {})
    stats = models.setdefault(model_id or "unknown", {
        "prompt_tokens": 0, "completion_tokens": 0, "calls": 0, "cost_usd": 0.0,
    })
    stats["prompt_tokens"] += pt
    stats["completion_tokens"] += ct
    stats["calls"] += 1
    stats["cost_usd"] += cost


def _record_embed(model_id: str, usage) -> None:
    acc = _usage_ctx.get()
    if acc is None or usage is None:
        return
    tt = getattr(usage, "total_tokens", 0) or getattr(usage, "prompt_tokens", 0) or 0
    cost = tt / 1e6 * _EMBED_PRICING.get(model_id, 0.02)
    acc["embedding_tokens"] += tt
    acc["embedding_calls"] += 1
    acc["cost_usd"] += cost

    stats = acc.setdefault("embedding_models", {}).setdefault(model_id or "unknown", {
        "tokens": 0, "calls": 0, "cost_usd": 0.0,
    })
    stats["tokens"] += tt
    stats["calls"] += 1
    stats["cost_usd"] += cost


async def record_cost(source: str, ref_id: str | None = None, items: int | None = None) -> dict | None:
    acc = _usage_ctx.get()
    if not acc:
        return None
    try:
        if acc["cost_usd"] <= 0 and not acc["llm_calls"] and not acc["embedding_calls"]:
            return acc

        from datetime import datetime, timezone
        try:
            db = _ledger_db(acc.get("company_id"))
        except tenancy.TenantContextMissing:
            logger.warning("cost_ledger write skipped (source=%s): no company bound", source)
            return acc
        if db is None:
            return acc

        models = {
            model_id: {**stats, "cost_usd": round(stats["cost_usd"], 6)}
            for model_id, stats in (acc.get("models") or {}).items()
        }
        embedding_models = {
            model_id: {**stats, "cost_usd": round(stats["cost_usd"], 6)}
            for model_id, stats in (acc.get("embedding_models") or {}).items()
        }
        entry = {
            "source": source,
            "ref_id": ref_id,
            "cost_usd": round(acc["cost_usd"], 6),
            "prompt_tokens": acc["prompt_tokens"],
            "completion_tokens": acc["completion_tokens"],
            "embedding_tokens": acc["embedding_tokens"],
            "llm_calls": acc["llm_calls"],
            "embedding_calls": acc["embedding_calls"],
            "model": next(iter(models)) if len(models) == 1 else None,
            "models": models,
            "embedding_models": embedding_models,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        if items is not None:
            entry["items"] = int(items)
        try:
            if ref_id:
                await db.cost_ledger.update_one(
                    {"source": source, "ref_id": ref_id}, {"$set": entry}, upsert=True
                )
            else:
                await db.cost_ledger.insert_one(entry)
        except Exception as exc:
            logger.warning("cost_ledger write failed (source=%s): %s", source, exc)
        return acc
    finally:
        _usage_ctx.set(None)


@contextlib.asynccontextmanager
async def track_llm_cost(source: str, ref_id: str | None = None, items: int | None = None):
    if _usage_ctx.get() is not None:
        yield
        return
    start_usage_tracking()
    try:
        yield
    finally:
        await record_cost(source, ref_id, items)


_TTS_PRICING_PER_1K_CHARS = {
    "tts-1": 0.015,
    "tts-1-hd": 0.030,
}
_DEFAULT_TTS_PRICE_PER_1K_CHARS = 0.015

_STT_PRICING_PER_MINUTE = {
    "whisper-1": 0.006,
    "gpt-4o-transcribe": 0.006,
    "gpt-4o-mini-transcribe": 0.003,
}
_DEFAULT_STT_PRICE_PER_MINUTE = 0.006

_ASSUMED_VOICE_BITRATE_BYTES_PER_SEC = 3_000


async def record_voice_cost(
    kind: str,
    source: str,
    model: str,
    *,
    characters: int | None = None,
    duration_seconds: float | None = None,
    audio_bytes: int | None = None,
    ref_id: str | None = None,
) -> None:
    try:
        if kind == "tts":
            chars = max(int(characters or 0), 0)
            price = _TTS_PRICING_PER_1K_CHARS.get(model, _DEFAULT_TTS_PRICE_PER_1K_CHARS)
            cost = chars / 1000.0 * price
        elif kind == "stt":
            if duration_seconds is not None:
                resolved_duration = max(float(duration_seconds), 0.0)
                duration_source = "api"
            else:
                resolved_duration = max(int(audio_bytes or 0), 0) / _ASSUMED_VOICE_BITRATE_BYTES_PER_SEC
                duration_source = "estimated_from_file_size"
            price = _STT_PRICING_PER_MINUTE.get(model, _DEFAULT_STT_PRICE_PER_MINUTE)
            cost = (resolved_duration / 60.0) * price
        else:
            logger.warning("record_voice_cost: unknown kind=%s", kind)
            return

        from datetime import datetime, timezone
        from config.database import get_db
        db = get_db()
        if db is None:
            return

        entry = {
            "source": source,
            "cost_type": kind,
            "ref_id": ref_id,
            "model": model,
            "cost_usd": round(cost, 6),
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        if kind == "tts":
            entry["characters"] = chars
        else:
            entry["duration_seconds"] = round(resolved_duration, 3)
            entry["duration_source"] = duration_source
            if audio_bytes is not None:
                entry["audio_bytes"] = int(audio_bytes)

        try:
            await db.cost_ledger.insert_one(entry)
        except Exception as exc:
            logger.warning("cost_ledger voice write failed (kind=%s, source=%s): %s", kind, source, exc)
    except Exception as exc:
        logger.warning("record_voice_cost failed (kind=%s, source=%s): %s", kind, source, exc)


MODEL_REGISTRY = [
    {"id": "gpt-4o", "name": "GPT-4o", "provider": "openai", "context": 128_000},
    {"id": "gpt-4o-mini", "name": "GPT-4o Mini", "provider": "openai", "context": 128_000},
    {"id": "gpt-4.1", "name": "GPT-4.1", "provider": "openai", "context": 1_047_576},
    {"id": "gpt-4.1-mini", "name": "GPT-4.1 Mini", "provider": "openai", "context": 1_047_576},
    {"id": "gpt-4.1-nano", "name": "GPT-4.1 Nano", "provider": "openai", "context": 1_047_576},
    {"id": "gpt-4-turbo", "name": "GPT-4 Turbo", "provider": "openai", "context": 128_000},
    {"id": "gpt-4.5-preview", "name": "GPT-4.5 Preview", "provider": "openai", "context": 128_000},
    {"id": "gpt-5", "name": "GPT-5", "provider": "openai", "context": 400_000},
    {"id": "gpt-5-mini", "name": "GPT-5 Mini", "provider": "openai", "context": 400_000},
    {"id": "gpt-5-nano", "name": "GPT-5 Nano", "provider": "openai", "context": 400_000},
    {"id": "gpt-5.1", "name": "GPT-5.1", "provider": "openai", "context": 400_000},
    {"id": "gpt-5.2", "name": "GPT-5.2", "provider": "openai", "context": 400_000},
    {"id": "gpt-5.4", "name": "GPT-5.4", "provider": "openai", "context": 1_100_000},
    {"id": "gpt-5.4-mini", "name": "GPT-5.4 Mini", "provider": "openai", "context": 400_000},
    {"id": "gpt-5.4-nano", "name": "GPT-5.4 Nano", "provider": "openai", "context": 400_000},
    {"id": "gpt-5.5", "name": "GPT-5.5", "provider": "openai", "context": 1_100_000},
    {"id": "gpt-5.6-luna", "name": "GPT-5.6 Luna", "provider": "openai"},
    {"id": "gpt-5.6-terra", "name": "GPT-5.6 Terra", "provider": "openai"},
    {"id": "gpt-5.6-sol", "name": "GPT-5.6 Sol", "provider": "openai"},
    {"id": "gpt-6-luna", "name": "GPT-6 Luna", "provider": "openai"},
    {"id": "gpt-6-sol", "name": "GPT-6 Sol", "provider": "openai"},
    {"id": "gpt-6.1-sol", "name": "GPT-6.1 Sol", "provider": "openai"},
    {"id": "gpt-6-astra", "name": "GPT-6 Astra", "provider": "openai"},
    {"id": "o3", "name": "o3", "provider": "openai", "context": 200_000},
    {"id": "o4-mini", "name": "o4-mini", "provider": "openai", "context": 200_000},
    {"id": "claude-fable-5-1", "name": "Claude Fable 5.1", "provider": "anthropic", "context": 1_000_000},
    {"id": "claude-fable-5", "name": "Claude Fable 5", "provider": "anthropic", "context": 1_000_000},
    {"id": "claude-opus-5-5", "name": "Claude Opus 5.5", "provider": "anthropic", "context": 1_000_000},
    {"id": "claude-opus-5", "name": "Claude Opus 5", "provider": "anthropic", "context": 1_000_000},
    {"id": "claude-opus-4-8", "name": "Claude Opus 4.8", "provider": "anthropic", "context": 1_000_000},
    {"id": "claude-sonnet-5-5", "name": "Claude Sonnet 5.5", "provider": "anthropic", "context": 1_000_000},
    {"id": "claude-sonnet-5", "name": "Claude Sonnet 5", "provider": "anthropic", "context": 1_000_000},
    {"id": "claude-sonnet-4-6", "name": "Claude Sonnet 4.6", "provider": "anthropic", "context": 1_000_000},
    {"id": "claude-haiku-5-5", "name": "Claude Haiku 5.5", "provider": "anthropic", "context": 1_000_000},
    {"id": "claude-haiku-4-5", "name": "Claude Haiku 4.5", "provider": "anthropic", "context": 200_000},
]

for _m in MODEL_REGISTRY:
    _p = _LLM_PRICING.get(_m["id"])
    if _p:
        _m["price_in"], _m["price_out"] = _p["in"], _p["out"]

_PROVIDER_BY_MODEL = {m["id"]: m["provider"] for m in MODEL_REGISTRY}

SELECTABLE_MODEL_IDS: tuple[str, ...] = (
    "claude-haiku-5-5",
    "claude-haiku-4-5",
    "claude-sonnet-5-5",
    "claude-sonnet-5",
    "claude-opus-5-5",
    "claude-fable-5-1",
    "gpt-5-nano",
    "gpt-6-luna",
    "gpt-4o-mini",
    "gpt-4.1-mini",
    "gpt-5-mini",
    "gpt-5.4-mini",
    "gpt-4.1",
    "gpt-4o",
    "gpt-6-sol",
    "gpt-5.4",
    "gpt-5.5",
    "gpt-6-astra",
)


def selectable_models() -> list[dict]:
    by_id = {m["id"]: m for m in MODEL_REGISTRY}
    return [by_id[i] for i in SELECTABLE_MODEL_IDS if i in by_id]


def _price_label_per_million(price_in: float, price_out: float | None = None) -> str:
    def money(n: float) -> str:
        return f"${int(n)}" if n == int(n) else f"${n:.2f}"
    return f"{money(price_in)} / {money(price_out)} per 1M tokens" if price_out is not None else f"{money(price_in)} per 1M tokens"


EMBEDDING_MODELS: tuple[dict, ...] = (
    {"id": "text-embedding-3-small", "name": "Text Embedding 3 Small", "provider": "openai",
     "price_label": _price_label_per_million(_EMBED_PRICING["text-embedding-3-small"])},
    {"id": "text-embedding-ada-002", "name": "Text Embedding Ada 002", "provider": "openai",
     "price_label": _price_label_per_million(_EMBED_PRICING["text-embedding-ada-002"])},
    {"id": "text-embedding-3-large", "name": "Text Embedding 3 Large", "provider": "openai",
     "price_label": _price_label_per_million(_EMBED_PRICING["text-embedding-3-large"])},
)
SPEECH_MODELS: tuple[dict, ...] = (
    {"id": "tts-1", "name": "TTS-1", "provider": "openai", "price_label": "$15 per 1M characters"},
    {"id": "gpt-4o-mini-tts", "name": "GPT-4o Mini TTS", "provider": "openai", "price_label": "$0.60 in / $12 out per 1M tokens"},
    {"id": "tts-1-hd", "name": "TTS-1 HD", "provider": "openai", "price_label": "$30 per 1M characters"},
)
TRANSCRIPTION_MODELS: tuple[dict, ...] = (
    {"id": "gpt-4o-mini-transcribe", "name": "GPT-4o Mini Transcribe", "provider": "openai", "price_label": "$0.003 per minute"},
    {"id": "whisper-1", "name": "Whisper", "provider": "openai", "price_label": "$0.006 per minute"},
    {"id": "gpt-4o-transcribe", "name": "GPT-4o Transcribe", "provider": "openai", "price_label": "$0.006 per minute"},
)

def task_options(kind: str) -> list[dict]:
    if kind == "embedding":
        return [dict(m) for m in EMBEDDING_MODELS]
    if kind == "speech":
        return [dict(m) for m in SPEECH_MODELS]
    if kind == "transcription":
        return [dict(m) for m in TRANSCRIPTION_MODELS]
    out = []
    for m in selectable_models():
        row = dict(m)
        row["price_label"] = _price_label_per_million(m["price_in"], m["price_out"])
        out.append(row)
    return out


TASKS: dict[str, dict] = {
    "interview": {"label": "Interview questions, follow-ups and scoring", "group": "Interview", "kind": "chat"},
    "interview_guide": {"label": "Interview guides and summary drafts", "group": "Interview", "kind": "chat"},
    "scenario": {"label": "Scenario answer scoring", "group": "Interview", "kind": "chat"},
    "speech": {"label": "Interviewer voice (text to speech)", "group": "Interview", "kind": "speech", "setting": "TTS_MODEL"},
    "transcription": {"label": "Candidate answers (speech to text)", "group": "Interview", "kind": "transcription", "setting": "STT_MODEL"},
    "resume": {"label": "CV classification", "group": "Hiring", "kind": "chat", "setting": "RESUME_CLASSIFICATION_MODEL"},
    "job_description": {"label": "Job description parsing", "group": "Hiring", "kind": "chat"},
    "match_opinion": {"label": "Match second opinion", "group": "Hiring", "kind": "chat"},
    "offer_letter": {"label": "Offer letter drafting", "group": "Hiring", "kind": "chat"},
    "embedding": {"label": "Embeddings for CV and job matching", "group": "Hiring", "kind": "embedding", "setting": "RESUME_EMBEDDING_MODEL"},
    "coding_generation": {"label": "Coding question generation", "group": "Coding", "kind": "chat"},
    "code_quality": {"label": "Code quality review", "group": "Coding", "kind": "chat", "setting": "CODE_EVAL_MODEL"},
    "code_correctness": {"label": "Code correctness review", "group": "Coding", "kind": "chat", "setting": "CODE_CORRECTNESS_MODEL"},
}


def task_default(task: str) -> str:
    setting = TASKS[task].get("setting")
    return getattr(settings, setting) if setting else default_model()


def task_override(task: str) -> str | None:
    overrides = tenancy.company_setting("task_models", None)
    chosen = overrides.get(task) if isinstance(overrides, dict) else None
    return chosen if isinstance(chosen, str) and chosen else None


def model_for(task: str, explicit: str | None = None) -> str:
    if explicit:
        return explicit
    return task_override(task) or task_default(task)


def embedding_model() -> str:
    return model_for("embedding")


def embedding_is_current(stored_model: str | None) -> bool:
    return (stored_model or settings.RESUME_EMBEDDING_MODEL) == embedding_model()


_openai_client: AsyncOpenAI | None = None
_anthropic_client = None


def provider_for_model(model_id: str | None) -> str:
    mid = model_id or ""
    if mid in _PROVIDER_BY_MODEL:
        return _PROVIDER_BY_MODEL[mid]
    return "anthropic" if mid.startswith("claude-") else "openai"


_OPENAI_REASONING_RE = re.compile(r"^(gpt-([5-9]|\d{2,})(\.\d+)?(-|$)|o\d)")


def _is_openai_reasoning(model_id: str | None) -> bool:
    mid = (model_id or "").lower()
    return bool(_OPENAI_REASONING_RE.match(mid)) and "chat" not in mid


def _openai_reasoning_effort() -> str | None:
    level = (settings.LLM_EFFORT or "").strip().lower()
    if level in ("low", "medium", "high"):
        return level
    return "high" if level in ("xhigh", "max") else None


def get_openai_client() -> AsyncOpenAI:
    global _openai_client
    if not settings.OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY is not configured")
    if _openai_client is None:
        _openai_client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
    return _openai_client


def get_anthropic_client():
    global _anthropic_client
    if not settings.ANTHROPIC_API_KEY:
        raise RuntimeError("ANTHROPIC_API_KEY is not configured")
    if _anthropic_client is None:
        from anthropic import AsyncAnthropic
        _anthropic_client = AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
    return _anthropic_client


def get_llm(model: str | None = None) -> tuple[AsyncOpenAI, str]:
    chosen = model or default_model()
    return get_openai_client(), chosen


def get_embedding_model() -> str:
    return embedding_model()


async def ask_llm(
    prompt: str,
    system: str = "You are a helpful HR AI assistant.",
    model: str | None = None,
    max_tokens: int = 2000,
    temperature: float = 0.3,
    json_mode: bool = False,
    json_schema: dict | None = None,
    timeout: float | None = None,
) -> str:
    model_id = model or default_model()
    try:
        if provider_for_model(model_id) == "anthropic":
            return strip_em_dashes(await _ask_anthropic(
                prompt=prompt, system=system, model_id=model_id,
                max_tokens=max_tokens, json_mode=json_mode, json_schema=json_schema,
                timeout=timeout,
            ))

        client, model_id = get_llm(model)
        kwargs: dict = {
            "model": model_id,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
        }
        if _is_openai_reasoning(model_id):
            kwargs["max_completion_tokens"] = max(max_tokens, 4000)
            effort = _openai_reasoning_effort()
            if effort:
                kwargs["reasoning_effort"] = effort
        else:
            kwargs["max_tokens"] = max_tokens
            kwargs["temperature"] = temperature
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}
        if timeout is not None:
            kwargs["timeout"] = timeout
        resp = await client.chat.completions.create(**kwargs)
        _record_llm(model_id, getattr(resp, "usage", None))
        return strip_em_dashes(resp.choices[0].message.content or "")
    except Exception as e:
        logger.warning("LLM call failed for model=%s: %s", model_id, e)
        return "{}" if json_mode else ""


_EFFORT_MODELS = frozenset({
    "claude-fable-5-1", "claude-fable-5", "claude-opus-5-5", "claude-opus-5",
    "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6",
    "claude-sonnet-5-5", "claude-sonnet-5", "claude-sonnet-4-6",
    "claude-haiku-5-5",
})
_EFFORT_LEVELS = frozenset({"low", "medium", "high", "xhigh", "max"})


def _effort_for(model_id: str) -> str | None:
    base = _strip_snapshot(model_id)
    level = (settings.LLM_EFFORT or "").strip().lower()
    if base in _EFFORT_MODELS and level in _EFFORT_LEVELS:
        return level
    return None


async def _ask_anthropic(
    *,
    prompt: str,
    system: str,
    model_id: str,
    max_tokens: int,
    json_mode: bool,
    json_schema: dict | None,
    timeout: float | None = None,
) -> str:
    client = get_anthropic_client()

    kwargs: dict = {
        "model": model_id,
        "max_tokens": max(max_tokens, 4000),
        "system": system,
        "messages": [{"role": "user", "content": prompt}],
    }
    output_config: dict = {}
    effort = _effort_for(model_id)
    if effort:
        output_config["effort"] = effort
    if json_schema:
        output_config["format"] = {"type": "json_schema", "schema": json_schema}
    elif json_mode:
        kwargs["system"] = f"{system}\n\nRespond with a single valid JSON object and nothing else."
    if output_config:
        kwargs["output_config"] = output_config
    if timeout is not None:
        kwargs["timeout"] = timeout

    resp = await client.messages.create(**kwargs)
    _record_llm(model_id, getattr(resp, "usage", None))

    if getattr(resp, "stop_reason", None) == "refusal":
        logger.warning("Anthropic declined the request | model=%s", model_id)
        return "{}" if (json_mode or json_schema) else ""

    text = "".join(
        block.text for block in (resp.content or [])
        if getattr(block, "type", None) == "text"
    )
    return clean_json_reply(text) if (json_mode or json_schema) else text


def clean_json_reply(text: str) -> str:
    import json

    raw = (text or "").strip()
    if not raw:
        return text
    candidates = []
    fenced = re.match(r"^```[a-zA-Z0-9]*\s*(.*?)\s*```$", raw, re.S)
    if fenced:
        candidates.append(fenced.group(1).strip())
    starts = [i for i in (raw.find("{"), raw.find("[")) if i >= 0]
    end = max(raw.rfind("}"), raw.rfind("]"))
    if starts and end > min(starts):
        candidates.append(raw[min(starts):end + 1])
    for candidate in candidates:
        try:
            json.loads(candidate)
            return candidate
        except ValueError:
            continue
    return text


class EmbeddingUnavailable(RuntimeError):
    pass


_embedding_failure: contextvars.ContextVar[str | None] = contextvars.ContextVar("_embedding_failure", default=None)


def _embedding_failure_message(exc: Exception) -> str:
    text = f"{type(exc).__name__} {exc}".lower()
    if "insufficient_quota" in text or "credit_balance" in text or "no credits" in text:
        return ("Embeddings are unavailable: the OpenAI account has no credit left. "
                "Ask the platform operator to add credit, then try again.")
    if "invalid_api_key" in text or "incorrect api key" in text or "authenticationerror" in text or "permissiondenied" in text:
        return "Embeddings are unavailable: OpenAI rejected the API key. Ask the platform operator to check it, then try again."
    if "not configured" in text:
        return "Embeddings are unavailable: no OpenAI API key is set. Ask the platform operator to add it, then try again."
    return f"Embeddings are unavailable: the OpenAI request failed ({type(exc).__name__}). Please try again."


def require_vector(vector: list[float]) -> list[float]:
    if vector and any(vector):
        return vector
    raise EmbeddingUnavailable(
        _embedding_failure.get() or "Embeddings are unavailable: the provider returned no vector. Please try again."
    )


async def get_embedding(text: str) -> list[float]:
    _embedding_failure.set(None)
    try:
        client = get_openai_client()
        model = embedding_model()
        kwargs: dict = {"model": model, "input": text[:8000]}
        if model == "text-embedding-3-large":
            kwargs["dimensions"] = settings.EMBEDDING_DIMENSIONS
        resp = await client.embeddings.create(**kwargs)
        _record_embed(model, getattr(resp, "usage", None))
        return resp.data[0].embedding
    except Exception as e:
        logger.warning("Embedding call failed, using zero-vector fallback: %s", e)
        _embedding_failure.set(_embedding_failure_message(e))
        return [0.0] * settings.EMBEDDING_DIMENSIONS
