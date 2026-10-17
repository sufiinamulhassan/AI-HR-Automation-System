from __future__ import annotations

import asyncio
from typing import Any

from config import llm, tenancy
from config.settings import settings
from shared import secrets

PROVIDERS = (
    {"id": "anthropic", "label": "Anthropic", "env_var": "ANTHROPIC_API_KEY"},
    {"id": "openai", "label": "OpenAI", "env_var": "OPENAI_API_KEY"},
)
_ENV_BY_PROVIDER = {p["id"]: p["env_var"] for p in PROVIDERS}

VOICE_KINDS = {"tts": "speech", "stt": "transcription"}

_OPENAI_ONLY = ("speech", "transcription", "embedding")


def _key_value(provider: str) -> str:
    return getattr(settings, _ENV_BY_PROVIDER.get(provider, ""), "") or ""


def key_status() -> list[dict]:
    return [
        {
            **p,
            "configured": bool(_key_value(p["id"])),
            "mask": secrets.mask(_key_value(p["id"])) or None,
            "scope": "platform",
        }
        for p in PROVIDERS
    ]


def _model_names() -> dict[str, str]:
    names = {m["id"]: m["name"] for m in llm.MODEL_REGISTRY}
    for group in (llm.EMBEDDING_MODELS, llm.SPEECH_MODELS, llm.TRANSCRIPTION_MODELS):
        names.update({m["id"]: m["name"] for m in group})
    return names


def _provider_of(kind: str, model: str | None) -> str:
    return "openai" if kind in _OPENAI_ONLY else llm.provider_for_model(model)


def describe(company: dict) -> tuple[list[dict], str]:
    names = _model_names()
    ready = {p["id"]: bool(_key_value(p["id"])) for p in PROVIDERS}
    jobs: list[dict] = []
    with tenancy.company_context(company["company_id"], company):
        default = llm.default_model()
        for task, spec in llm.TASKS.items():
            override = llm.task_override(task)
            fallback = llm.task_default(task)
            model = override or fallback
            provider = _provider_of(spec["kind"], model)
            jobs.append({
                "key": task,
                "label": spec["label"],
                "group": spec["group"],
                "kind": spec["kind"],
                "model": model,
                "model_name": names.get(model, model),
                "provider": provider,
                "key_env": _ENV_BY_PROVIDER.get(provider),
                "ready": ready.get(provider, False),
                "custom": bool(override),
                "default_model": fallback,
                "default_name": names.get(fallback, fallback),
            })
    return jobs, default


def _range(since: str, until: str | None) -> dict:
    return {"$gte": since, **({"$lt": until} if until else {})}


async def _chat_models(raw, ids: list[str], created: dict) -> list[dict]:
    return await raw.cost_ledger.aggregate([
        {"$match": {"company_id": {"$in": ids}, "created_at": created, "models": {"$type": "object"}}},
        {"$project": {"_id": 0, "company_id": 1, "m": {"$objectToArray": "$models"}}},
        {"$unwind": "$m"},
        {"$group": {
            "_id": {"company": "$company_id", "model": "$m.k"},
            "calls": {"$sum": {"$ifNull": ["$m.v.calls", 0]}},
            "tokens_in": {"$sum": {"$ifNull": ["$m.v.prompt_tokens", 0]}},
            "tokens_out": {"$sum": {"$ifNull": ["$m.v.completion_tokens", 0]}},
            "cost": {"$sum": {"$ifNull": ["$m.v.cost_usd", 0]}},
        }},
    ]).to_list(None)


async def _embedding_models(raw, ids: list[str], created: dict) -> list[dict]:
    return await raw.cost_ledger.aggregate([
        {"$match": {"company_id": {"$in": ids}, "created_at": created, "embedding_models": {"$type": "object"}}},
        {"$project": {"_id": 0, "company_id": 1, "m": {"$objectToArray": "$embedding_models"}}},
        {"$unwind": "$m"},
        {"$group": {
            "_id": {"company": "$company_id", "model": "$m.k"},
            "calls": {"$sum": {"$ifNull": ["$m.v.calls", 0]}},
            "tokens": {"$sum": {"$ifNull": ["$m.v.tokens", 0]}},
            "cost": {"$sum": {"$ifNull": ["$m.v.cost_usd", 0]}},
        }},
    ]).to_list(None)


async def _voice(raw, ids: list[str], created: dict) -> list[dict]:
    return await raw.cost_ledger.aggregate([
        {"$match": {"company_id": {"$in": ids}, "created_at": created, "cost_type": {"$in": list(VOICE_KINDS)}}},
        {"$group": {
            "_id": {"company": "$company_id", "type": "$cost_type", "model": "$model"},
            "calls": {"$sum": 1},
            "cost": {"$sum": {"$ifNull": ["$cost_usd", 0]}},
        }},
    ]).to_list(None)


async def _token_rows(raw, ids: list[str], created: dict) -> list[dict]:
    return await raw.cost_ledger.aggregate([
        {"$match": {"company_id": {"$in": ids}, "created_at": created, "cost_type": {"$nin": list(VOICE_KINDS)}}},
        {"$group": {
            "_id": "$company_id",
            "cost": {"$sum": {"$ifNull": ["$cost_usd", 0]}},
            "embedding_calls": {"$sum": {"$ifNull": ["$embedding_calls", 0]}},
            "embedding_tokens": {"$sum": {"$ifNull": ["$embedding_tokens", 0]}},
        }},
    ]).to_list(None)


def _money(value: Any) -> float:
    return round(float(value or 0), 6)


def _used_rows(
    company_id: str, chat: list[dict], embedding: list[dict], voice: list[dict], totals: list[dict], names: dict[str, str],
) -> list[dict]:
    rows: list[dict] = []
    chat_cost = 0.0
    for g in chat:
        if g["_id"]["company"] != company_id:
            continue
        model = g["_id"]["model"]
        chat_cost += float(g.get("cost") or 0)
        rows.append({
            "kind": "chat", "model": model, "name": names.get(model, model),
            "provider": llm.provider_for_model(model), "calls": int(g.get("calls") or 0),
            "tokens_in": int(g.get("tokens_in") or 0), "tokens_out": int(g.get("tokens_out") or 0),
            "cost_usd": _money(g.get("cost")),
        })
    for g in voice:
        if g["_id"]["company"] != company_id:
            continue
        kind = VOICE_KINDS.get(g["_id"]["type"], "speech")
        model = g["_id"].get("model")
        rows.append({
            "kind": kind, "model": model, "name": names.get(model, model) if model else "Unknown model",
            "provider": "openai", "calls": int(g.get("calls") or 0), "tokens_in": None, "tokens_out": None,
            "cost_usd": _money(g.get("cost")),
        })
    rows += _embedding_rows(company_id, embedding, totals, chat_cost, names)
    rows.sort(key=lambda r: (-r["cost_usd"], r["name"]))
    return rows


def _embedding_rows(company_id: str, embedding: list[dict], totals: list[dict], chat_cost: float, names: dict[str, str]) -> list[dict]:
    by_model: dict[str, dict] = {}

    def slot(model: str) -> dict:
        return by_model.setdefault(model, {"calls": 0, "tokens": 0, "cost": 0.0})

    for g in embedding:
        if g["_id"]["company"] != company_id:
            continue
        s = slot(g["_id"]["model"])
        s["calls"] += int(g.get("calls") or 0)
        s["tokens"] += int(g.get("tokens") or 0)
        s["cost"] += float(g.get("cost") or 0)

    total = next((g for g in totals if g["_id"] == company_id), None)
    if total is not None:
        calls_left = int(total.get("embedding_calls") or 0) - sum(s["calls"] for s in by_model.values())
        if calls_left > 0:
            s = slot(settings.RESUME_EMBEDDING_MODEL)
            s["calls"] += calls_left
            s["tokens"] += max(0, int(total.get("embedding_tokens") or 0) - sum(v["tokens"] for v in by_model.values()))
            embedding_cost = max(0.0, float(total.get("cost") or 0) - chat_cost)
            s["cost"] += max(0.0, embedding_cost - sum(v["cost"] for v in by_model.values()))
    return [
        {
            "kind": "embedding", "model": model, "name": names.get(model, model), "provider": "openai",
            "calls": s["calls"], "tokens_in": s["tokens"], "tokens_out": None, "cost_usd": _money(s["cost"]),
        }
        for model, s in by_model.items()
    ]


def _by_provider(used: list[dict]) -> dict[str, dict]:
    out = {p["id"]: {"calls": 0, "cost_usd": 0.0} for p in PROVIDERS}
    for row in used:
        slot = out.setdefault(row["provider"], {"calls": 0, "cost_usd": 0.0})
        slot["calls"] += row["calls"]
        slot["cost_usd"] = _money(slot["cost_usd"] + row["cost_usd"])
    return out


async def usage_by_company(raw, company_ids: list[str], since: str, until: str | None) -> dict[str, list[dict]]:
    if not company_ids:
        return {}
    created = _range(since, until)
    chat, embedding, voice, totals = await asyncio.gather(
        _chat_models(raw, company_ids, created), _embedding_models(raw, company_ids, created),
        _voice(raw, company_ids, created), _token_rows(raw, company_ids, created),
    )
    names = _model_names()
    return {cid: _used_rows(cid, chat, embedding, voice, totals, names) for cid in company_ids}


def _spend_by_key(keys: list[dict], used_lists: list[list[dict]]) -> list[dict]:
    out = []
    for key in keys:
        models: dict[tuple, dict] = {}
        companies = calls = 0
        cost = 0.0
        for used in used_lists:
            mine = [r for r in used if r["provider"] == key["id"]]
            if any(r["calls"] or r["cost_usd"] for r in mine):
                companies += 1
            for r in mine:
                calls += r["calls"]
                cost += r["cost_usd"]
                m = models.setdefault((r["kind"], r["model"] or r["name"]), {
                    "kind": r["kind"], "model": r["model"], "name": r["name"], "calls": 0, "cost_usd": 0.0,
                })
                m["calls"] += r["calls"]
                m["cost_usd"] += r["cost_usd"]
        ranked = sorted(models.values(), key=lambda m: (-m["cost_usd"], m["name"]))
        out.append({
            **key,
            "companies": companies,
            "calls": calls,
            "cost_usd": _money(cost),
            "models": [{**m, "cost_usd": _money(m["cost_usd"])} for m in ranked],
        })
    return out


async def overview(raw, clients: list[dict], companies: list[dict], since: str, until: str | None) -> dict:
    ids = [c["company_id"] for c in companies]
    used_by = await usage_by_company(raw, ids, since, until)
    client_names = {c["client_id"]: c.get("name") or "" for c in clients}
    names = _model_names()
    rows = []
    for company in companies:
        cid = company["company_id"]
        jobs, default = describe(company)
        used = used_by.get(cid, [])
        rows.append({
            "company_id": cid,
            "name": company.get("name") or "",
            "slug": company.get("slug") or "",
            "status": company.get("status") or "active",
            "client_id": company.get("client_id"),
            "client_name": client_names.get(company.get("client_id"), ""),
            "default_model": default,
            "default_name": names.get(default, default),
            "custom_jobs": sum(1 for j in jobs if j["custom"]),
            "jobs": jobs,
            "used": used,
            "providers": _by_provider(used),
            "cost_usd": _money(sum(r["cost_usd"] for r in used)),
        })
    rows.sort(key=lambda r: (-r["cost_usd"], r["name"].lower()))
    return {"keys": _spend_by_key(key_status(), [r["used"] for r in rows]), "companies": rows}


async def company_ai(raw, company: dict, since: str, until: str | None) -> dict:
    cid = company["company_id"]
    used = (await usage_by_company(raw, [cid], since, until)).get(cid, [])
    jobs, default = describe(company)
    names = _model_names()
    return {
        "keys": _spend_by_key(key_status(), [used]),
        "default_model": default,
        "default_name": names.get(default, default),
        "jobs": jobs,
        "used": used,
    }
