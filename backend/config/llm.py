"""LLM and embedding helpers shared by all backend agents."""
import contextvars
import logging

from openai import AsyncOpenAI

from config.settings import settings

logger = logging.getLogger(__name__)

_LLM_PRICING = {
    "gpt-4o":          {"in": 2.50, "out": 10.00},
    "gpt-4o-mini":     {"in": 0.15, "out": 0.60},
    "gpt-4.1":         {"in": 2.00, "out": 8.00},
    "gpt-4.1-mini":    {"in": 0.40, "out": 1.60},
    "gpt-4-turbo":     {"in": 10.00, "out": 30.00},
    "gpt-4.5-preview": {"in": 75.00, "out": 150.00},
    "claude-opus-5":   {"in": 5.00, "out": 25.00},
    "claude-sonnet-5": {"in": 3.00, "out": 15.00},
    "claude-haiku-4-5": {"in": 1.00, "out": 5.00},
}
_EMBED_PRICING = {
    "text-embedding-3-small": 0.02,
    "text-embedding-3-large": 0.13,
}

_usage_ctx: contextvars.ContextVar[dict | None] = contextvars.ContextVar("_usage_ctx", default=None)


def start_usage_tracking() -> dict:
    """Begin accumulating token usage/cost in the current task context. Returns the
    accumulator dict (read it after the work completes)."""
    acc = {
        "prompt_tokens": 0, "completion_tokens": 0, "embedding_tokens": 0,
        "llm_calls": 0, "embedding_calls": 0, "cost_usd": 0.0,
    }
    _usage_ctx.set(acc)
    return acc


def _record_llm(model_id: str, usage) -> None:
    acc = _usage_ctx.get()
    if acc is None or usage is None:
        return
    pt = getattr(usage, "prompt_tokens", None) or getattr(usage, "input_tokens", 0) or 0
    ct = getattr(usage, "completion_tokens", None) or getattr(usage, "output_tokens", 0) or 0
    price = _LLM_PRICING.get(model_id) or _LLM_PRICING.get((model_id or "").split(":")[0]) or {"in": 2.5, "out": 10.0}
    acc["prompt_tokens"] += pt
    acc["completion_tokens"] += ct
    acc["llm_calls"] += 1
    acc["cost_usd"] += pt / 1e6 * price["in"] + ct / 1e6 * price["out"]


def _record_embed(model_id: str, usage) -> None:
    acc = _usage_ctx.get()
    if acc is None or usage is None:
        return
    tt = getattr(usage, "total_tokens", 0) or getattr(usage, "prompt_tokens", 0) or 0
    acc["embedding_tokens"] += tt
    acc["embedding_calls"] += 1
    acc["cost_usd"] += tt / 1e6 * _EMBED_PRICING.get(model_id, 0.02)


async def record_cost(source: str, ref_id: str | None = None, items: int | None = None) -> dict | None:
    """Persist the current task's accumulated token usage/cost to the append-only
    `cost_ledger` collection. This ledger is the source of truth for the platform's
    lifetime AI spend and is NEVER touched by batch-clear/purge operations, so the
    dashboard total survives even when Activity history is deleted.

    Call once after a tracked operation finishes (i.e. after start_usage_tracking()
    and the awaited work). Safe no-op when there's no accumulator, no spend, or no DB.
    When ref_id is given the entry is upserted (idempotent re-runs); otherwise each
    call is a distinct spend event. `items` is the number of units this spend covers
    (e.g. resumes processed) so the dashboard can show an accurate average cost/unit.
    """
    acc = _usage_ctx.get()
    if not acc:
        return None
    if acc["cost_usd"] <= 0 and not acc["llm_calls"] and not acc["embedding_calls"]:
        return acc

    from datetime import datetime, timezone
    from config.database import get_db
    db = get_db()
    if db is None:
        return acc

    entry = {
        "source": source,
        "ref_id": ref_id,
        "cost_usd": round(acc["cost_usd"], 6),
        "prompt_tokens": acc["prompt_tokens"],
        "completion_tokens": acc["completion_tokens"],
        "embedding_tokens": acc["embedding_tokens"],
        "llm_calls": acc["llm_calls"],
        "embedding_calls": acc["embedding_calls"],
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


MODEL_REGISTRY = [
    {"id": "gpt-4o", "name": "GPT-4o", "provider": "openai", "context": 128_000},
    {"id": "gpt-4o-mini", "name": "GPT-4o Mini", "provider": "openai", "context": 128_000},
    {"id": "gpt-4.1", "name": "GPT-4.1", "provider": "openai", "context": 1_047_576},
    {"id": "gpt-4.1-mini", "name": "GPT-4.1 Mini", "provider": "openai", "context": 1_047_576},
    {"id": "gpt-4-turbo", "name": "GPT-4 Turbo", "provider": "openai", "context": 128_000},
    {"id": "gpt-4.5-preview", "name": "GPT-4.5 Preview", "provider": "openai", "context": 128_000},
    {"id": "claude-opus-5", "name": "Claude Opus 5", "provider": "anthropic", "context": 1_000_000},
    {"id": "claude-sonnet-5", "name": "Claude Sonnet 5", "provider": "anthropic", "context": 1_000_000},
    {"id": "claude-haiku-4-5", "name": "Claude Haiku 4.5", "provider": "anthropic", "context": 200_000},
]

_PROVIDER_BY_MODEL = {m["id"]: m["provider"] for m in MODEL_REGISTRY}

_openai_client: AsyncOpenAI | None = None
_anthropic_client = None


def provider_for_model(model_id: str | None) -> str:
    """Resolve a model id to its provider, defaulting to OpenAI.

    Unknown ids fall back to "openai" so a custom/fine-tuned OpenAI model id
    that isn't in the registry keeps working exactly as before.
    """
    return _PROVIDER_BY_MODEL.get(model_id or "", "openai")


def get_openai_client() -> AsyncOpenAI:
    global _openai_client
    if not settings.OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY is not configured")
    if _openai_client is None:
        _openai_client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
    return _openai_client


def get_anthropic_client():
    """Lazily construct the shared AsyncAnthropic client.

    Mirrors get_openai_client(). The `anthropic` SDK is already a dependency
    (requirements.txt) but was never imported — importing lazily keeps the
    module importable when the package or key is absent.
    """
    global _anthropic_client
    if not settings.ANTHROPIC_API_KEY:
        raise RuntimeError("ANTHROPIC_API_KEY is not configured")
    if _anthropic_client is None:
        from anthropic import AsyncAnthropic
        _anthropic_client = AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
    return _anthropic_client


def get_llm(model: str | None = None) -> tuple[AsyncOpenAI, str]:
    chosen = model or settings.DEFAULT_LLM_MODEL
    return get_openai_client(), chosen


def get_embedding_model() -> str:
    return settings.RESUME_EMBEDDING_MODEL


async def ask_llm(
    prompt: str,
    system: str = "You are a helpful HR AI assistant.",
    model: str | None = None,
    max_tokens: int = 2000,
    temperature: float = 0.3,
    json_mode: bool = False,
    json_schema: dict | None = None,
) -> str:
    """Single entry point for every LLM call in the codebase.

    Dispatches on the model's registered provider. `json_schema` is honoured
    only on the Anthropic path, where it becomes a schema-enforced structured
    output — strictly stronger than OpenAI's `json_object` mode, which only
    guarantees syntactically valid JSON.
    """
    model_id = model or settings.DEFAULT_LLM_MODEL
    try:
        if provider_for_model(model_id) == "anthropic":
            return await _ask_anthropic(
                prompt=prompt, system=system, model_id=model_id,
                max_tokens=max_tokens, json_mode=json_mode, json_schema=json_schema,
            )

        client, model_id = get_llm(model)
        kwargs: dict = {
            "model": model_id,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
            "max_tokens": max_tokens,
            "temperature": temperature,
        }
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}
        resp = await client.chat.completions.create(**kwargs)
        _record_llm(model_id, getattr(resp, "usage", None))
        return resp.choices[0].message.content or ""
    except Exception as e:
        logger.warning("LLM call failed for model=%s: %s", model_id, e)
        return "{}" if json_mode else ""


async def _ask_anthropic(
    *,
    prompt: str,
    system: str,
    model_id: str,
    max_tokens: int,
    json_mode: bool,
    json_schema: dict | None,
) -> str:
    """Anthropic Messages API call shaped like the OpenAI path above.

    Differences that matter and are deliberate, not oversights:
      * `system` is a top-level parameter, not a message role.
      * No `temperature` — current Claude models reject sampling parameters
        outright with a 400, so it is not forwarded.
      * Thinking is on by default and `max_tokens` caps thinking + visible text
        together, so the budget is raised to leave the answer room.
    """
    client = get_anthropic_client()

    kwargs: dict = {
        "model": model_id,
        "max_tokens": max(max_tokens, 4000),
        "system": system,
        "messages": [{"role": "user", "content": prompt}],
    }
    if json_schema:
        kwargs["output_config"] = {"format": {"type": "json_schema", "schema": json_schema}}
    elif json_mode:
        kwargs["system"] = f"{system}\n\nRespond with a single valid JSON object and nothing else."

    resp = await client.messages.create(**kwargs)
    _record_llm(model_id, getattr(resp, "usage", None))

    if getattr(resp, "stop_reason", None) == "refusal":
        logger.warning("Anthropic declined the request | model=%s", model_id)
        return "{}" if (json_mode or json_schema) else ""

    return "".join(
        block.text for block in (resp.content or [])
        if getattr(block, "type", None) == "text"
    )


async def get_embedding(text: str) -> list[float]:
    try:
        client = get_openai_client()
        resp = await client.embeddings.create(
            model=settings.RESUME_EMBEDDING_MODEL,
            input=text[:8000],
        )
        _record_embed(settings.RESUME_EMBEDDING_MODEL, getattr(resp, "usage", None))
        return resp.data[0].embedding
    except Exception as e:
        logger.warning("Embedding call failed, using zero-vector fallback: %s", e)
        return [0.0] * settings.EMBEDDING_DIMENSIONS
