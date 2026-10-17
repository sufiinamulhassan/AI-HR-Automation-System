from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timedelta, timezone

from pymongo import UpdateOne

from config.database import get_platform_db
from services.hr_module import alerts_service, plan_service, platform_service, workspace_service

logger = logging.getLogger(__name__)

STORAGE_ALERT_PERCENT = 90
TRIAL_WARNING_DAYS = 3
TRIAL_ENDED_WINDOW_DAYS = 7
EMAIL_FAILURE_THRESHOLD = 10
RECONCILE_BATCH = 200
MAX_ALERTS_PER_STEP = 25

STORAGE_ALERT_COOLDOWN_HOURS = 24 * 7
TRIAL_ALERT_COOLDOWN_HOURS = 24 * 14

CACHE_KEEP = timedelta(days=1)
STRIPE_EVENTS_KEEP = timedelta(days=35)
ALERTS_KEEP = timedelta(days=120)


class _Clock:
    def __init__(self, seconds: float):
        self.deadline = time.monotonic() + max(0.0, float(seconds))

    def expired(self) -> bool:
        return time.monotonic() >= self.deadline


def storage_pipelines() -> dict[str, list[dict]]:
    return {
        "resume_files": [{"$group": {"_id": "$company_id", "bytes": {"$sum": {"$bsonSize": "$$ROOT"}}}}],
        "branding_settings": [{"$group": {"_id": "$company_id", "bytes": {"$sum": {"$bsonSize": "$$ROOT"}}}}],
        "users": [
            {"$match": {"avatar_base64": {"$type": "string"}}},
            {"$group": {"_id": "$company_id", "bytes": {"$sum": {"$strLenBytes": "$avatar_base64"}}}},
        ],
    }


def fold_storage(*row_sets: list[dict]) -> dict[str, int]:
    totals: dict[str, int] = {}
    for rows in row_sets:
        for row in rows:
            company_id = row.get("_id")
            if isinstance(company_id, str) and company_id:
                totals[company_id] = totals.get(company_id, 0) + int(row.get("bytes") or 0)
    return totals


def _stored(company: dict) -> int:
    value = (company.get("usage") or {}).get("storage_bytes")
    return max(0, int(value)) if isinstance(value, (int, float)) and not isinstance(value, bool) else 0


def storage_notice(company: dict, client: dict | None) -> dict | None:
    limit = plan_service.resolve_plan((client or {}).get("plan"))["max_storage_mb"]
    if not limit or limit <= 0:
        return None
    used = _stored(company)
    if used < limit * plan_service.BYTES_PER_MB * STORAGE_ALERT_PERCENT / 100:
        return None
    percent = used / (limit * plan_service.BYTES_PER_MB) * 100
    name = company.get("name") or company.get("company_id")
    return {
        "key": f"storage_90:{company['company_id']}",
        "subject": f"{name} is at {min(percent, 999):.0f}% of its storage",
        "body": (
            f"{name} stores {used / plan_service.BYTES_PER_MB:.0f} MB of its {limit:g} MB plan limit "
            f"({percent:.0f}%). New resume uploads are refused once the limit is reached."
        ),
        "cooldown_hours": STORAGE_ALERT_COOLDOWN_HOURS,
    }


def trial_notice(client: dict, now: datetime) -> dict | None:
    status = plan_service.resolve_subscription(client.get("subscription"))["status"]
    if status in ("active", "canceled"):
        return None
    ends = plan_service.parse_instant(plan_service.resolve_plan(client.get("plan"))["trial_ends_at"])
    if ends is None:
        return None
    remaining = ends - now
    name = client.get("name") or client.get("client_id")
    day = ends.date().isoformat()
    if timedelta(0) < remaining <= timedelta(days=TRIAL_WARNING_DAYS):
        days = max(1, int(remaining.total_seconds() // 86400) + 1)
        return {
            "key": f"trial_ending:{client['client_id']}:{day}",
            "subject": f"The trial for {name} ends soon",
            "body": f"The trial for {name} ends on {day} ({days} day{'s' if days != 1 else ''} left) and the client has not subscribed. Its workspaces are blocked when it ends.",
            "cooldown_hours": TRIAL_ALERT_COOLDOWN_HOURS,
        }
    if remaining <= timedelta(0) and -remaining <= timedelta(days=TRIAL_ENDED_WINDOW_DAYS):
        return {
            "key": f"trial_ended:{client['client_id']}:{day}",
            "subject": f"The trial for {name} has ended",
            "body": f"The trial for {name} ended on {day} and the client has not subscribed. Its workspaces are blocked until you mark it subscribed.",
            "cooldown_hours": TRIAL_ALERT_COOLDOWN_HOURS,
        }
    return None


def email_failure_notice(rows: list[dict], threshold: int = EMAIL_FAILURE_THRESHOLD) -> dict | None:
    bad = [r for r in rows if int(r.get("failed") or 0) >= threshold]
    if not bad:
        return None
    lines = [f"{r.get('company_name') or r.get('company_id')}: {int(r['failed'])} failed" for r in bad[:10]]
    return {
        "key": "email_failures",
        "subject": f"Email is failing for {len(bad)} compan{'y' if len(bad) == 1 else 'ies'}",
        "body": "Messages that failed to send in the last 24 hours:\n" + "\n".join(lines)
        + "\nCheck the mail settings on the Health page.",
        "cooldown_hours": 24,
    }


class _Context:

    def __init__(self, raw, now: datetime, clock: _Clock):
        self.raw = raw
        self.now = now
        self.clock = clock
        self.companies: list[dict] = []
        self.clients: dict[str, dict] = {}

    async def load(self) -> None:
        companies, clients = await asyncio.gather(
            self.raw.companies.find(
                {"kind": {"$ne": "platform"}},
                {"_id": 0, "company_id": 1, "client_id": 1, "name": 1, "status": 1, "usage": 1},
            ).to_list(None),
            self.raw.clients.find(
                {"kind": {"$ne": "platform"}},
                {"_id": 0, "client_id": 1, "name": 1, "status": 1, "plan": 1, "subscription": 1},
            ).to_list(None),
        )
        self.clients = {c["client_id"]: c for c in clients}
        self.companies = [c for c in companies if c.get("client_id") in self.clients]


async def reconcile_storage(ctx: _Context) -> dict:
    pipelines = storage_pipelines()
    rows = await asyncio.gather(*(ctx.raw[name].aggregate(pipe).to_list(None) for name, pipe in pipelines.items()))
    totals = fold_storage(*rows)
    order = sorted(
        ctx.companies, key=lambda c: str((c.get("usage") or {}).get("storage_reconciled_at") or ""),
    )
    stamp = ctx.now.isoformat()
    updated = drifted = 0
    for start in range(0, len(order), RECONCILE_BATCH):
        if start and ctx.clock.expired():
            break
        chunk = order[start:start + RECONCILE_BATCH]
        operations = []
        for company in chunk:
            actual = totals.get(company["company_id"], 0)
            if actual != _stored(company):
                drifted += 1
            operations.append(UpdateOne(
                {"company_id": company["company_id"]},
                {"$set": {"usage.storage_bytes": actual, "usage.storage_reconciled_at": stamp}},
            ))
            usage = dict(company.get("usage") or {})
            usage["storage_bytes"] = actual
            company["usage"] = usage
        await ctx.raw.companies.bulk_write(operations, ordered=False)
        updated += len(chunk)
    if drifted:
        await platform_service.invalidate_console_cache(ctx.raw)
    return {"companies": len(order), "reconciled": updated, "drifted": drifted, "complete": updated == len(order)}


async def storage_alerts(ctx: _Context) -> dict:
    sent = found = 0
    for company in ctx.companies:
        notice = storage_notice(company, ctx.clients.get(company.get("client_id")))
        if notice is None:
            continue
        found += 1
        if sent >= MAX_ALERTS_PER_STEP or ctx.clock.expired():
            continue
        if await alerts_service.alert_owners(
            notice["key"], notice["subject"], notice["body"], company_id=company["company_id"],
            cooldown_hours=notice["cooldown_hours"],
        ):
            sent += 1
    return {"over_90_percent": found, "alerts_sent": sent}


async def trial_notices(ctx: _Context) -> dict:
    sent = found = 0
    for client in ctx.clients.values():
        notice = trial_notice(client, ctx.now)
        if notice is None:
            continue
        found += 1
        if sent >= MAX_ALERTS_PER_STEP or ctx.clock.expired():
            continue
        if await alerts_service.alert_owners(
            notice["key"], notice["subject"], notice["body"], cooldown_hours=notice["cooldown_hours"],
        ):
            sent += 1
    return {"clients_noticed": found, "alerts_sent": sent}


def budget_crossings(
    spend: dict[str, float], companies: list[dict], clients: dict[str, dict], month: str,
) -> list[dict]:
    out = []
    for company in companies:
        client = clients.get(company.get("client_id")) or {}
        budget = plan_service.limits({"client_plan": client.get("plan") or {}})["monthly_ai_budget_usd"]
        if not budget:
            continue
        used = float(spend.get(company["company_id"], 0.0))
        band = plan_service.budget_band(used, budget)
        if not band:
            continue
        told = (company.get("usage") or {}).get("ai_alert") or {}
        if told.get("month") == month and int(told.get("band") or 0) >= band:
            continue
        out.append({"company_id": company["company_id"], "band": band, "used": used, "budget": float(budget)})
    return out


async def budget_sweep(ctx: _Context) -> dict:
    month_start = plan_service.month_start(ctx.now)
    month = plan_service.month_label(ctx.now)
    rows = await ctx.raw.cost_ledger.aggregate([
        {"$match": {"created_at": {"$gte": month_start.isoformat()}}},
        {"$group": {"_id": "$company_id", "cost": {"$sum": {"$ifNull": ["$cost_usd", 0]}}}},
    ]).to_list(None)
    spend = {r["_id"]: float(r.get("cost") or 0) for r in rows if isinstance(r.get("_id"), str)}
    crossings = budget_crossings(spend, ctx.companies, ctx.clients, month)
    told = 0
    for crossing in crossings[:MAX_ALERTS_PER_STEP]:
        if ctx.clock.expired():
            break
        await alerts_service.budget_threshold(
            crossing["company_id"], crossing["band"], crossing["used"], crossing["budget"], month,
        )
        told += 1
    return {"crossed": len(crossings), "reported": told}


async def email_failures(ctx: _Context) -> dict:
    rows = await platform_service.failed_emails_last_day(ctx.raw)
    notice = email_failure_notice(rows)
    if notice is None:
        return {"companies_over_threshold": 0, "alert_sent": False}
    sent = await alerts_service.alert_owners(
        notice["key"], notice["subject"], notice["body"], cooldown_hours=notice["cooldown_hours"],
    )
    return {"companies_over_threshold": sum(1 for r in rows if int(r.get("failed") or 0) >= EMAIL_FAILURE_THRESHOLD), "alert_sent": sent}


async def housekeeping(ctx: _Context) -> dict:
    now = ctx.now
    cache = await ctx.raw.settings.delete_many(
        {"_id": {"$regex": f"^{platform_service.CACHE_PREFIX}"}, "created_at": {"$lt": now - CACHE_KEEP}},
    )
    events = await ctx.raw.settings.delete_many(
        {"_id": {"$regex": "^stripe_event:"}, "created_at": {"$lt": now - STRIPE_EVENTS_KEEP}},
    )
    throttles = await ctx.raw.settings.delete_many(
        {"_id": {"$regex": f"^{alerts_service.ALERT_PREFIX}"}, "last_sent_at": {"$lt": now - ALERTS_KEEP}},
    )
    return {
        "cache_entries": cache.deleted_count, "stripe_events": events.deleted_count, "alert_throttles": throttles.deleted_count,
    }


STEPS = (
    ("storage_reconcile", reconcile_storage),
    ("storage_alerts", storage_alerts),
    ("trial_notices", trial_notices),
    ("budget_sweep", budget_sweep),
    ("email_failures", email_failures),
    ("housekeeping", housekeeping),
)


async def run_platform_checks(budget_seconds: float) -> dict:
    started = time.monotonic()
    result: dict = {"ok": True, "complete": True, "steps": {}, "skipped": [], "elapsed_seconds": 0.0}
    raw = get_platform_db()
    if raw is None:
        return {**result, "ok": False, "complete": False, "skipped": [n for n, _ in STEPS], "error": "database unavailable"}
    clock = _Clock(budget_seconds)
    ctx = _Context(raw, datetime.now(timezone.utc), clock)
    try:
        if not clock.expired():
            await ctx.load()
    except Exception as exc:
        logger.error("Platform checks could not read the directory | error=%s", type(exc).__name__)
        return {**result, "ok": False, "complete": False, "skipped": [n for n, _ in STEPS], "error": type(exc).__name__}

    for name, step in STEPS:
        if clock.expired():
            result["skipped"].append(name)
            continue
        try:
            result["steps"][name] = await step(ctx)
        except Exception as exc:
            logger.error("Platform check failed | step=%s error=%s", name, type(exc).__name__)
            result["steps"][name] = {"error": type(exc).__name__}
            result["ok"] = False
    result["complete"] = not result["skipped"]
    result["elapsed_seconds"] = round(time.monotonic() - started, 2)
    if result["steps"]:
        await _record(raw, ctx, result)
    return result


async def _record(raw, ctx: _Context, result: dict) -> None:
    try:
        stamp = ctx.now.isoformat()
        status = "failed" if not result["ok"] else ("partial" if not result["complete"] else "ok")
        detail = f"{len(result['steps'])} of {len(STEPS)} checks ran"
        if result["skipped"]:
            detail += f"; not reached: {', '.join(result['skipped'])}"
        await workspace_service.record_platform_cron_run("platform_checks", {
            "started_at": stamp, "last_run_at": datetime.now(timezone.utc).isoformat(), "status": status, "detail": detail,
            "companies_total": len(ctx.companies), "companies_served": len(ctx.companies),
            "companies_failed": 0 if result["ok"] else 1,
        })
    except Exception as exc:
        logger.warning("Platform checks not recorded | error=%s", type(exc).__name__)
