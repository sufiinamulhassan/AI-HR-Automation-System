from __future__ import annotations

import asyncio
import calendar
import hashlib
import json
import logging
import re
import secrets
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable, NamedTuple

from passlib.context import CryptContext
from pymongo.errors import DuplicateKeyError

from config.database import get_pinecone, get_platform_db
from config.settings import settings
from config.tenancy import (
    DEFAULT_CLIENT_ID,
    DEFAULT_COMPANY_ID,
    PLATFORM_CLIENT_ID,
    PLATFORM_COMPANY_ID,
    PLATFORM_ONLY,
    SHARED_INFRA,
)
from config.tenancy_migration import client_doc, company_doc
from services.hr_module import email_delivery_service, plan_service, platform_ai, workspace_service
from services.hr_module.account_protection_service import email_taken, find_user, normalize_email
from shared.utils import slugify

logger = logging.getLogger(__name__)

_pwd = CryptContext(schemes=["bcrypt"])

WINDOWS = (7, 30, 90)
DEFAULT_WINDOW = 30
MIN_PASSWORD_LENGTH = 8
MAX_PASSWORD_BYTES = 72
RESERVED_SLUGS = frozenset({"platform", "default"})
GROWTH_MONTHS = 12
TOP_CLIENTS = 5
RECENT_ROWS = 10
EMAIL_TAKEN = "That email address is already registered."
SLUG_TAKEN = "That slug is already in use."
DOMAIN_TAKEN = "One of those domains is already claimed by another workspace."
DOMAIN_RESERVED = "That email domain is reserved by another company."
PLAN_KEYS = plan_service.PLAN_KEYS

CACHE_SECONDS = 300
CACHE_PREFIX = "usage_cache:"
PAYLOAD_VERSION = 2
CACHE_EPOCH_ID = workspace_service.CACHE_EPOCH_ID

OFFBOARD_BUDGET_SECONDS = 40.0
VECTOR_BATCH = 1000
OFFBOARD_SKIP = frozenset(PLATFORM_ONLY | SHARED_INFRA | {"password_tokens"})
HEALTH_PING_SECONDS = 5.0
FAILED_EMAIL_HOURS = 24
FAILED_EMAIL_GROUPS = 50
AUDIT_PAGE_DEFAULT = 50
AUDIT_PAGE_MAX = 200
MIN_YEAR, MAX_YEAR = 2000, 2100


class PlatformError(Exception):

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


class Feature(NamedTuple):
    key: str
    label: str
    collection: str
    date_field: str
    filter: dict
    sum_field: str | None = None
    cost_field: str | None = None
    primary: bool = True


FEATURES: list[Feature] = [
    Feature("jobs", "Jobs", "jobs", "created_at", {}),
    Feature("resumes", "Resumes", "resumes", "created_at", {"processing_status": "processed"}),
    Feature("candidates", "Candidates", "candidates", "created_at", {}),
    Feature(
        "interviews", "Interviews", "candidates", "interview_ended_at",
        {"interview_mode": {"$ne": "external"}, "interview_ended_at": {"$type": "string"}},
    ),
    Feature("coding", "Coding assessments", "coding_submissions", "submitted_at", {}),
    Feature("offers", "Offers", "offers", "created_at", {}),
    Feature("performance", "Performance reviews", "performance_reviews", "created_at", {}),
    Feature("emails", "Emails", "email_log", "created_at", {"status": "sent"}, primary=False),
    Feature(
        "ai", "AI calls", "cost_ledger", "created_at", {},
        sum_field="llm_calls", cost_field="cost_usd", primary=False,
    ),
]

FEATURE_KEYS = [f.key for f in FEATURES]


def flat_key(feature_key: str) -> str:
    return "ai_calls" if feature_key == "ai" else feature_key


def _raw():
    raw = get_platform_db()
    if raw is None:
        raise PlatformError(503, "The database is unavailable. Try again shortly.")
    return raw


raw_db = _raw


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


def window_start(days: int, now: datetime | None = None) -> datetime:
    now = now or _now()
    return (now - timedelta(days=days - 1)).replace(hour=0, minute=0, second=0, microsecond=0)


@dataclass(frozen=True)
class Period:
    kind: str
    start: datetime
    end: datetime | None
    days: int
    now: datetime

    def dates(self) -> list[str]:
        return [(self.start + timedelta(days=i)).date().isoformat() for i in range(self.days)]

    def payload(self) -> dict:
        return {"kind": self.kind, "from": self.start.isoformat(), "to": (self.end or self.now).isoformat()}

    @property
    def since(self) -> str:
        return self.start.isoformat()

    @property
    def until(self) -> str | None:
        return self.end.isoformat() if self.end else None


def window_period(days: int, now: datetime | None = None) -> Period:
    now = now or _now()
    return Period("window", window_start(days, now), None, days, now)


_MONTH = re.compile(r"^(\d{4})-(\d{2})$")


def month_period(month: str, now: datetime | None = None) -> Period:
    match = _MONTH.match((month or "").strip())
    year, number = (int(match.group(1)), int(match.group(2))) if match else (0, 0)
    if not match or not (MIN_YEAR <= year <= MAX_YEAR) or not (1 <= number <= 12):
        raise PlatformError(422, "The month must look like 2026-10.")
    start = datetime(year, number, 1, tzinfo=timezone.utc)
    following = datetime(year + (number == 12), number % 12 + 1, 1, tzinfo=timezone.utc)
    return Period("month", start, following, calendar.monthrange(year, number)[1], now or _now())


def resolve_period(window: int | None = None, month: str | None = None, now: datetime | None = None) -> Period:
    if window is not None and month is not None:
        raise PlatformError(422, "Send either a window or a month, not both.")
    if month is not None:
        return month_period(month, now)
    days = DEFAULT_WINDOW if window is None else window
    if days not in WINDOWS:
        raise PlatformError(422, "The window must be 7, 30 or 90 days.")
    return window_period(days, now)


def as_period(value: "Period | int") -> Period:
    return value if isinstance(value, Period) else window_period(int(value))


def parse_ts(value: Any) -> datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        try:
            dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _iso(value: Any) -> str | None:
    dt = parse_ts(value)
    return dt.isoformat() if dt else None


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def _clean_text(value: Any, label: str, *, required: bool = False, limit: int = 200) -> str:
    text = "" if value is None else str(value).strip()
    if required and not text:
        raise PlatformError(422, f"{label} cannot be empty.")
    if len(text) > limit:
        raise PlatformError(422, f"{label} must be at most {limit} characters.")
    return text


def _check_password(password: str) -> None:
    if not isinstance(password, str) or len(password) < MIN_PASSWORD_LENGTH:
        raise PlatformError(422, f"The password must be at least {MIN_PASSWORD_LENGTH} characters long.")
    if len(password.encode("utf-8")) > MAX_PASSWORD_BYTES:
        raise PlatformError(422, f"The password must be at most {MAX_PASSWORD_BYTES} bytes long.")


async def _hash_password(password: str) -> str:
    return await asyncio.get_running_loop().run_in_executor(None, _pwd.hash, password)


def _merge_plan(current: dict | None, patch: dict | None) -> dict:
    try:
        return plan_service.merge_plan(current, patch)
    except plan_service.PlanError as exc:
        raise PlatformError(422, str(exc))


def list_plans() -> dict:
    return {
        "default_tier": plan_service.DEFAULT_TIER,
        "tiers": plan_service.tier_catalog(),
        "features": plan_service.feature_catalog(),
    }


@dataclass
class Usage:
    users: int = 0
    active_users: int = 0
    last_active: datetime | None = None
    total: dict[str, int] = field(default_factory=lambda: {k: 0 for k in FEATURE_KEYS})
    window: dict[str, int] = field(default_factory=lambda: {k: 0 for k in FEATURE_KEYS})
    cost: float = 0.0
    cost_window: float = 0.0

    def note_activity(self, value: Any) -> None:
        dt = parse_ts(value)
        if dt and (self.last_active is None or dt > self.last_active):
            self.last_active = dt

    def add(self, other: "Usage") -> None:
        self.users += other.users
        self.active_users += other.active_users
        self.note_activity(other.last_active)
        for key in FEATURE_KEYS:
            self.total[key] += other.total[key]
            self.window[key] += other.window[key]
        self.cost += other.cost
        self.cost_window += other.cost_window

    @property
    def activity(self) -> int:
        return sum(self.window.values())


def _feature_stages(feature: Feature, since: str | None, until: str | None = None) -> list[dict]:
    clauses = []
    if feature.filter:
        clauses.append(feature.filter)
    bounds: dict[str, str] = {}
    if since:
        bounds["$gte"] = since
    if until:
        bounds["$lt"] = until
    if bounds:
        clauses.append({feature.date_field: bounds})
    return [{"$match": {"$and": clauses}}] if clauses else []


def _measure(feature: Feature) -> Any:
    return {"$ifNull": [f"${feature.sum_field}", 0]} if feature.sum_field else 1


def _company_group(feature: Feature, cutoff: str, until: str | None = None) -> dict:
    date = f"${feature.date_field}"
    tests: list[dict] = [{"$eq": [{"$type": date}, "string"]}, {"$gte": [date, cutoff]}]
    if until:
        tests.append({"$lt": [date, until]})
    in_window = {"$and": tests}
    measure = _measure(feature)
    group: dict[str, Any] = {
        "_id": "$company_id",
        "total": {"$sum": measure},
        "window": {"$sum": {"$cond": [in_window, measure, 0]}},
        "last": {"$max": date},
    }
    if feature.cost_field:
        cost = {"$ifNull": [f"${feature.cost_field}", 0]}
        group["cost"] = {"$sum": cost}
        group["cost_window"] = {"$sum": {"$cond": [in_window, cost, 0]}}
    return {"$group": group}


def _daily_group(feature: Feature) -> dict:
    return {"$group": {"_id": {"$substrBytes": [f"${feature.date_field}", 0, 10]}, "n": {"$sum": _measure(feature)}}}


async def _feature_rows(
    raw, company_ids: list[str], make_group: Callable[[Feature], dict], since: str | None,
    until: str | None = None,
) -> dict[str, list[dict]]:
    by_collection: dict[str, list[Feature]] = {}
    for feature in FEATURES:
        by_collection.setdefault(feature.collection, []).append(feature)
    scope = {"$match": {"company_id": {"$in": company_ids}}}

    async def one(collection: str, feats: list[Feature]) -> dict[str, list[dict]]:
        if len(feats) == 1:
            feature = feats[0]
            pipeline = [scope, *_feature_stages(feature, since, until), make_group(feature)]
            return {feature.key: await raw[collection].aggregate(pipeline).to_list(None)}
        facets = {f.key: [*_feature_stages(f, since, until), make_group(f)] for f in feats}
        out = await raw[collection].aggregate([scope, {"$facet": facets}]).to_list(1)
        return out[0] if out else {f.key: [] for f in feats}

    parts = await asyncio.gather(*(one(c, fs) for c, fs in by_collection.items()))
    merged: dict[str, list[dict]] = {}
    for part in parts:
        merged.update(part)
    return merged


async def _user_rows(raw, company_ids: list[str], start: datetime, end: datetime | None = None) -> list[dict]:
    login = "$last_login_at"
    tests: list[dict] = [{"$eq": [{"$type": login}, "date"]}, {"$gte": [login, start]}]
    if end is not None:
        tests.append({"$lt": [login, end]})
    recent = {"$and": tests}
    pipeline = [
        {"$match": {"company_id": {"$in": company_ids}, "is_active": {"$ne": False}}},
        {"$group": {
            "_id": "$company_id",
            "users": {"$sum": 1},
            "active": {"$sum": {"$cond": [recent, 1, 0]}},
            "last": {"$max": login},
        }},
    ]
    return await raw.users.aggregate(pipeline).to_list(None)


async def collect_usage(raw, company_ids: list[str], period: "Period | int") -> dict[str, Usage]:
    usage = {cid: Usage() for cid in company_ids}
    if not company_ids:
        return usage
    period = as_period(period)
    cutoff, until = period.since, period.until
    users, rows = await asyncio.gather(
        _user_rows(raw, company_ids, period.start, period.end),
        _feature_rows(raw, company_ids, lambda f: _company_group(f, cutoff, until), None),
    )
    for row in users:
        entry = usage.get(row["_id"])
        if entry is None:
            continue
        entry.users = int(row.get("users") or 0)
        entry.active_users = int(row.get("active") or 0)
        entry.note_activity(row.get("last"))
    for feature in FEATURES:
        for row in rows.get(feature.key, []):
            entry = usage.get(row["_id"])
            if entry is None:
                continue
            entry.total[feature.key] = int(row.get("total") or 0)
            entry.window[feature.key] = int(row.get("window") or 0)
            entry.note_activity(row.get("last"))
            if feature.cost_field:
                entry.cost = float(row.get("cost") or 0)
                entry.cost_window = float(row.get("cost_window") or 0)
    return usage


async def _cost_by_source(raw, company_ids: list[str], period: Period | None = None) -> list[dict]:
    if not company_ids:
        return []
    match: dict[str, Any] = {"company_id": {"$in": company_ids}}
    if period is not None and period.kind == "month":
        match["created_at"] = {"$gte": period.since, "$lt": period.until}
    pipeline = [
        {"$match": match},
        {"$group": {
            "_id": "$source",
            "cost": {"$sum": {"$ifNull": ["$cost_usd", 0]}},
            "calls": {"$sum": {"$ifNull": ["$llm_calls", 0]}},
            "voice_calls": {"$sum": {"$cond": [{"$in": ["$cost_type", ["tts", "stt"]]}, 1, 0]}},
        }},
        {"$sort": {"cost": -1, "_id": 1}},
    ]
    rows = await raw.cost_ledger.aggregate(pipeline).to_list(None)
    return [
        {
            "source": row["_id"] or "unknown",
            "cost_usd": round(float(row["cost"] or 0), 6),
            "calls": int(row["calls"] or 0) + int(row.get("voice_calls") or 0),
        }
        for row in rows
    ]


EMAIL_SOURCE = "email_estimated"


def _with_email_estimate(rows: list[dict], usage: "Usage", period: Period) -> list[dict]:
    sent = usage.window["emails"] if period.kind == "month" else usage.total["emails"]
    cost = _email_estimate(sent)
    if sent <= 0 or cost <= 0:
        return rows
    out = [*rows, {"source": EMAIL_SOURCE, "cost_usd": cost, "calls": int(sent), "unit": "emails"}]
    out.sort(key=lambda r: (-r["cost_usd"], r["source"]))
    return out


async def _activity(raw, company_ids: list[str], period: "Period | int") -> list[dict]:
    period = as_period(period)
    counts: dict[str, int] = {}
    if company_ids:
        rows = await _feature_rows(raw, company_ids, _daily_group, period.since, period.until)
        for feature_rows in rows.values():
            for row in feature_rows:
                counts[row["_id"]] = counts.get(row["_id"], 0) + int(row.get("n") or 0)
    return [{"date": d, "count": counts.get(d, 0)} for d in period.dates()]


async def _load_clients(raw, only: str | None = None) -> list[dict]:
    if only == PLATFORM_CLIENT_ID:
        return []
    query: dict[str, Any] = {"kind": {"$ne": "platform"}}
    query["client_id"] = only if only else {"$ne": PLATFORM_CLIENT_ID}
    rows = await raw.clients.find(query, {"_id": 0}).to_list(None)
    return sorted(rows, key=lambda c: (c.get("name") or "").lower())


async def _load_companies(raw, client_ids: list[str], only: str | None = None) -> list[dict]:
    if not client_ids or only == PLATFORM_COMPANY_ID:
        return []
    query: dict[str, Any] = {"client_id": {"$in": client_ids}, "kind": {"$ne": "platform"}}
    query["company_id"] = only if only else {"$ne": PLATFORM_COMPANY_ID}
    rows = await raw.companies.find(query, {"_id": 0}).to_list(None)
    return sorted(rows, key=lambda c: (c.get("name") or "").lower())


async def _directory(raw, client_id: str | None = None) -> tuple[list[dict], list[dict]]:
    if client_id == PLATFORM_CLIENT_ID:
        return [], []
    client_query: dict[str, Any] = {"kind": {"$ne": "platform"}, "client_id": client_id or {"$ne": PLATFORM_CLIENT_ID}}
    company_query: dict[str, Any] = {"kind": {"$ne": "platform"}, "company_id": {"$ne": PLATFORM_COMPANY_ID}}
    if client_id:
        company_query["client_id"] = client_id
    clients, companies = await asyncio.gather(
        raw.clients.find(client_query, {"_id": 0}).to_list(None),
        raw.companies.find(company_query, {"_id": 0}).to_list(None),
    )
    known = {c["client_id"] for c in clients}
    by_name = lambda row: (row.get("name") or "").lower()
    return sorted(clients, key=by_name), sorted((c for c in companies if c.get("client_id") in known), key=by_name)


async def _require_client(raw, client_id: str) -> dict:
    clients = await _load_clients(raw, only=client_id)
    if not clients:
        raise PlatformError(404, "Client not found.")
    return clients[0]


async def _require_company(raw, company_id: str) -> tuple[dict, dict]:
    row = await raw.companies.find_one({"company_id": company_id}, {"_id": 0})
    if row is None or row.get("kind") == "platform" or company_id == PLATFORM_COMPANY_ID:
        raise PlatformError(404, "Company not found.")
    clients = await _load_clients(raw, only=row.get("client_id"))
    if not clients:
        raise PlatformError(404, "Company not found.")
    return row, clients[0]


async def _admins_by_company(raw, company_ids: list[str]) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {cid: [] for cid in company_ids}
    if not company_ids:
        return out
    rows = await raw.users.find(
        {
            "company_id": {"$in": company_ids}, "role": "superadmin",
            "is_active": {"$ne": False}, "is_platform_admin": {"$ne": True},
        },
        {"_id": 0, "email": 1, "name": 1, "company_id": 1},
    ).sort("email", 1).to_list(5000)
    for row in rows:
        out.setdefault(row["company_id"], []).append({"email": row.get("email"), "name": row.get("name") or ""})
    return out


def _email_estimate(sent: int) -> float:
    return round(int(sent) * settings.EMAIL_ESTIMATED_COST_PER_EMAIL, 6)


def _cost_fields(ai_cost: float, sent_emails: int) -> dict:
    email_cost = _email_estimate(sent_emails)
    return {"email_cost_usd": email_cost, "total_cost_usd": round(ai_cost + email_cost, 6)}


def _flat_counts(usage: Usage) -> dict:
    out: dict[str, Any] = {flat_key(f.key): usage.total[f.key] for f in FEATURES}
    out["ai_cost_usd"] = round(usage.cost, 6)
    out["ai_cost_window_usd"] = round(usage.cost_window, 6)
    out.update(_cost_fields(usage.cost, usage.total["emails"]))
    return out


def _top_feature(usage: Usage) -> dict | None:
    best: tuple[Feature, int] | None = None
    for feature in FEATURES:
        count = usage.window[feature.key]
        if feature.primary and count > 0 and (best is None or count > best[1]):
            best = (feature, count)
    return {"key": best[0].key, "label": best[0].label, "count": best[1]} if best else None


def _stored_bytes(company: dict) -> int:
    value = (company.get("usage") or {}).get("storage_bytes")
    return max(0, int(value)) if isinstance(value, (int, float)) and not isinstance(value, bool) else 0


def _storage_fields(plan: dict, stored_bytes: int) -> dict:
    limit = plan.get("max_storage_mb")
    return {
        "storage_mb": round(stored_bytes / plan_service.BYTES_PER_MB, 2),
        "storage_limit_mb": limit if isinstance(limit, (int, float)) and not isinstance(limit, bool) and limit > 0 else None,
    }


def _client_row(client: dict, companies: list[dict], usages: dict[str, Usage]) -> dict:
    total = Usage()
    for company in companies:
        total.add(usages.get(company["company_id"], Usage()))
    plan = plan_service.resolve_plan(client.get("plan"))
    return {
        "client_id": client["client_id"],
        "name": client.get("name") or "",
        "slug": client.get("slug") or "",
        "status": client.get("status") or "active",
        "plan": plan,
        "subscription": plan_service.resolve_subscription(client.get("subscription")),
        **_storage_fields(plan, sum(_stored_bytes(c) for c in companies)),
        "contact_name": client.get("contact_name") or "",
        "contact_email": client.get("contact_email") or "",
        "notes": client.get("notes") or "",
        "created_at": client.get("created_at"),
        "suspended_at": client.get("suspended_at"),
        "suspended_reason": client.get("suspended_reason"),
        "companies": len(companies),
        "users": total.users,
        "active_users": total.active_users,
        **_flat_counts(total),
        "last_active_at": _iso(total.last_active),
        "top_feature": _top_feature(total),
        "usage": dict(total.window),
    }


def _company_row(company: dict, client: dict, usage: Usage, admins: list[dict]) -> dict:
    plan = plan_service.resolve_plan(client.get("plan"))
    return {
        "company_id": company["company_id"],
        "client_id": company.get("client_id"),
        "client_name": client.get("name") or "",
        "client_status": client.get("status") or "active",
        "plan": plan,
        "subscription": plan_service.resolve_subscription(client.get("subscription")),
        **_storage_fields(plan, _stored_bytes(company)),
        "name": company.get("name") or "",
        "slug": company.get("slug") or "",
        "status": company.get("status") or "active",
        "created_at": company.get("created_at"),
        "suspended_at": company.get("suspended_at"),
        "suspended_reason": company.get("suspended_reason"),
        "sso_domains": list(company.get("sso_domains") or []),
        "users": usage.users,
        "active_users": usage.active_users,
        **_flat_counts(usage),
        "last_active_at": _iso(usage.last_active),
        "usage": dict(usage.window),
        "admins": admins,
    }


def _blocked(company: dict, client: dict) -> bool:
    return (company.get("status") or "active") != "active" or (client.get("status") or "active") != "active"


def _feature_summary(usage: Usage) -> list[dict]:
    return [
        {"key": f.key, "label": f.label, "total": usage.total[f.key], "window": usage.window[f.key]}
        for f in FEATURES
    ]


def _matches(search: str | None, *values: Any) -> bool:
    needle = (search or "").strip().lower()
    return not needle or any(needle in str(v or "").lower() for v in values)


def period_params(period: "Period | int") -> dict:
    p = as_period(period)
    return {"kind": p.kind, "days": p.days, "start": p.start.date().isoformat()}


def cache_key(view: str, params: dict | None, epoch: int) -> str:
    blob = json.dumps(
        {"view": view, "params": params or {}, "epoch": int(epoch), "shape": PAYLOAD_VERSION},
        sort_keys=True, default=str, separators=(",", ":"),
    )
    return CACHE_PREFIX + hashlib.sha256(blob.encode("utf-8")).hexdigest()[:32]


async def _cache_epoch(raw) -> int:
    doc = await raw.settings.find_one({"_id": CACHE_EPOCH_ID}, {"value": 1})
    value = (doc or {}).get("value")
    return value if isinstance(value, int) and not isinstance(value, bool) else 0


async def invalidate_console_cache(raw=None) -> None:
    await workspace_service.bump_console_cache(raw)


def _is_fresh(doc: dict, ttl_seconds: float, now: datetime | None = None) -> bool:
    created = parse_ts(doc.get("created_at"))
    if created is None:
        return False
    age = ((now or _now()) - created).total_seconds()
    return -5 <= age < ttl_seconds


async def cached_view(
    view: str, params: dict | None, refresh: bool, compute: Callable[[], Awaitable[dict]],
) -> dict:
    raw = _raw()
    key = None
    if CACHE_SECONDS > 0:
        try:
            key = cache_key(view, params, await _cache_epoch(raw))
            if not refresh:
                hit = await raw.settings.find_one({"_id": key})
                if hit and isinstance(hit.get("payload"), dict) and _is_fresh(hit, CACHE_SECONDS):
                    return hit["payload"]
        except Exception as exc:
            logger.warning("Console cache read failed | view=%s error=%s", view, type(exc).__name__)
            key = None
    payload = {**await compute(), "computed_at": _now_iso()}
    if key is not None:
        try:
            await raw.settings.replace_one(
                {"_id": key},
                {"_id": key, "key": key, "view": view, "created_at": _now(), "payload": payload},
                upsert=True,
            )
        except Exception as exc:
            logger.warning("Console cache write failed | view=%s error=%s", view, type(exc).__name__)
    return payload


def _month_keys(now: datetime) -> list[str]:
    keys = []
    for back in range(GROWTH_MONTHS - 1, -1, -1):
        index = now.year * 12 + (now.month - 1) - back
        keys.append(f"{index // 12:04d}-{index % 12 + 1:02d}")
    return keys


def _growth(clients: list[dict], companies: list[dict], now: datetime) -> list[dict]:
    def stamps(docs: list[dict]) -> list[str]:
        return [str(d.get("created_at") or "")[:7] for d in docs]

    client_months, company_months = stamps(clients), stamps(companies)
    return [
        {
            "month": month,
            "clients": sum(1 for s in client_months if s <= month),
            "companies": sum(1 for s in company_months if s <= month),
        }
        for month in _month_keys(now)
    ]


async def _recent_actions(raw) -> list[dict]:
    rows = await raw.audit_log.find(
        {"company_id": PLATFORM_COMPANY_ID},
        {"_id": 0, "created_at": 1, "action": 1, "actor_email": 1, "resource_type": 1, "resource_id": 1, "details": 1},
    ).sort("created_at", -1).limit(RECENT_ROWS).to_list(RECENT_ROWS)
    return [
        {
            "at": r.get("created_at"), "action": r.get("action"), "actor_email": r.get("actor_email"),
            "resource_type": r.get("resource_type"), "resource_id": r.get("resource_id"),
            "details": r.get("details") or {},
        }
        for r in rows
    ]


def _usage_by_client(companies: list[dict], usages: dict[str, Usage]) -> dict[str, Usage]:
    out: dict[str, Usage] = {}
    for company in companies:
        out.setdefault(company["client_id"], Usage()).add(usages.get(company["company_id"], Usage()))
    return out


async def overview(period: "Period | int") -> dict:
    raw = _raw()
    period = as_period(period)
    clients, companies = await _directory(raw)
    usage, recent = await asyncio.gather(
        collect_usage(raw, [c["company_id"] for c in companies], period), _recent_actions(raw),
    )
    by_client = _usage_by_client(companies, usage)
    client_by_id = {c["client_id"]: c for c in clients}

    platform = Usage()
    for entry in usage.values():
        platform.add(entry)
    blocked = sum(1 for c in companies if _blocked(c, client_by_id[c["client_id"]]))
    company_count = {cid: 0 for cid in client_by_id}
    for company in companies:
        company_count[company["client_id"]] += 1

    totals = {
        "clients": len(clients),
        "companies": len(companies),
        "active_companies": len(companies) - blocked,
        "suspended_companies": blocked,
        "users": platform.users,
        "active_users": platform.active_users,
        **{flat_key(f.key): platform.total[f.key] for f in FEATURES},
        "ai_cost_usd": round(platform.cost, 6),
        "ai_cost_window_usd": round(platform.cost_window, 6),
        **_cost_fields(platform.cost, platform.total["emails"]),
    }

    features = []
    for feature in FEATURES:
        best_id, best = None, 0
        for client_id, entry in by_client.items():
            if entry.window[feature.key] > best:
                best_id, best = client_id, entry.window[feature.key]
        features.append({
            "key": feature.key, "label": feature.label,
            "total": platform.total[feature.key], "window": platform.window[feature.key],
            "top_client": (
                {"client_id": best_id, "name": client_by_id[best_id].get("name") or "", "count": best}
                if best_id else None
            ),
        })

    ranked = sorted(
        clients,
        key=lambda c: (-by_client.get(c["client_id"], Usage()).activity, (c.get("name") or "").lower()),
    )[:TOP_CLIENTS]
    top_clients = []
    for client in ranked:
        entry = by_client.get(client["client_id"], Usage())
        top_clients.append({
            "client_id": client["client_id"], "name": client.get("name") or "",
            "companies": company_count[client["client_id"]],
            "users": entry.users, "active_users": entry.active_users,
            "activity": entry.activity, "ai_cost_usd": round(entry.cost, 6),
            **_cost_fields(entry.cost, entry.total["emails"]),
        })

    return {
        "window_days": period.days,
        "period": period.payload(),
        "totals": totals,
        "features": features,
        "top_clients": top_clients,
        "growth": _growth(clients, companies, _now()),
        "recent": recent,
    }


async def list_clients(search: str | None = None, status: str | None = None, days: int = DEFAULT_WINDOW) -> dict:
    raw = _raw()
    everyone, every_company = await _directory(raw)
    clients = [
        c for c in everyone
        if (not status or (c.get("status") or "active") == status)
        and _matches(search, c.get("name"), c.get("slug"), c.get("contact_name"), c.get("contact_email"))
    ]
    shown = {c["client_id"] for c in clients}
    companies = [c for c in every_company if c["client_id"] in shown]
    usage = await collect_usage(raw, [c["company_id"] for c in companies], days)
    grouped: dict[str, list[dict]] = {}
    for company in companies:
        grouped.setdefault(company["client_id"], []).append(company)
    return {"clients": [_client_row(c, grouped.get(c["client_id"], []), usage) for c in clients]}


async def _client_row_for(raw, client: dict, days: int = DEFAULT_WINDOW) -> dict:
    companies = await _load_companies(raw, [client["client_id"]])
    usage = await collect_usage(raw, [c["company_id"] for c in companies], days)
    return _client_row(client, companies, usage)


async def client_detail(client_id: str, period: "Period | int") -> dict:
    raw = _raw()
    period = as_period(period)
    found, companies = await _directory(raw, client_id)
    if not found:
        raise PlatformError(404, "Client not found.")
    client = found[0]
    ids = [c["company_id"] for c in companies]
    usage, admins, cost_by_source, activity = await asyncio.gather(
        collect_usage(raw, ids, period), _admins_by_company(raw, ids),
        _cost_by_source(raw, ids, period), _activity(raw, ids, period),
    )
    total = Usage()
    for entry in usage.values():
        total.add(entry)
    return {
        "client": _client_row(client, companies, usage),
        "companies": [_company_row(c, client, usage[c["company_id"]], admins.get(c["company_id"], [])) for c in companies],
        "features": _feature_summary(total),
        "cost_by_source": _with_email_estimate(cost_by_source, total, period),
        "activity": activity,
        "period": period.payload(),
    }


async def list_companies(
    client_id: str | None = None, search: str | None = None, status: str | None = None, days: int = DEFAULT_WINDOW,
) -> dict:
    raw = _raw()
    clients, every_company = await _directory(raw, client_id)
    client_by_id = {c["client_id"]: c for c in clients}
    companies = [
        c for c in every_company
        if (not status or (c.get("status") or "active") == status)
        and _matches(search, c.get("name"), c.get("slug"), client_by_id[c["client_id"]].get("name"))
    ]
    ids = [c["company_id"] for c in companies]
    usage, admins = await asyncio.gather(collect_usage(raw, ids, days), _admins_by_company(raw, ids))
    return {"companies": [
        _company_row(c, client_by_id[c["client_id"]], usage[c["company_id"]], admins.get(c["company_id"], []))
        for c in companies
    ]}


async def _company_row_for(raw, company: dict, client: dict, days: int = DEFAULT_WINDOW) -> dict:
    ids = [company["company_id"]]
    usage, admins = await asyncio.gather(collect_usage(raw, ids, days), _admins_by_company(raw, ids))
    return _company_row(company, client, usage[company["company_id"]], admins.get(company["company_id"], []))


async def company_detail(company_id: str, period: "Period | int") -> dict:
    raw = _raw()
    period = as_period(period)
    company, client = await _require_company(raw, company_id)
    ids = [company_id]
    usage, admins, cost_by_source, activity, ai = await asyncio.gather(
        collect_usage(raw, ids, period), _admins_by_company(raw, ids),
        _cost_by_source(raw, ids, period), _activity(raw, ids, period),
        platform_ai.company_ai(raw, company, period.since, period.until),
    )
    return {
        "company": _company_row(company, client, usage[company_id], admins.get(company_id, [])),
        "features": _feature_summary(usage[company_id]),
        "cost_by_source": _with_email_estimate(cost_by_source, usage[company_id], period),
        "activity": activity,
        "ai": ai,
        "period": period.payload(),
    }


async def usage_matrix(period: "Period | int") -> dict:
    raw = _raw()
    period = as_period(period)
    clients, companies = await _directory(raw)
    usage = await collect_usage(raw, [c["company_id"] for c in companies], period)
    by_client = _usage_by_client(companies, usage)
    rows = []
    for client in clients:
        entry = by_client.get(client["client_id"], Usage())
        top = _top_feature(entry)
        rows.append({
            "client_id": client["client_id"], "name": client.get("name") or "",
            "status": client.get("status") or "active",
            "counts": dict(entry.window), "top_feature": top["key"] if top else None,
        })
    rows.sort(key=lambda r: (-sum(r["counts"].values()), r["name"].lower()))
    return {
        "window_days": period.days,
        "period": period.payload(),
        "features": [{"key": f.key, "label": f.label} for f in FEATURES],
        "rows": rows,
    }


async def ai_models(period: "Period | int") -> dict:
    raw = _raw()
    period = as_period(period)
    clients, companies = await _directory(raw)
    data = await platform_ai.overview(raw, clients, companies, period.since, period.until)
    return {**data, "period": period.payload()}


def _explicit_slug(value: str | None) -> str | None:
    if value is None or not str(value).strip():
        return None
    slug = slugify(str(value))[:48].strip("-")
    if not slug:
        raise PlatformError(422, "The slug can only use letters, numbers and hyphens.")
    return slug


def _derived_slug(name: str, fallback: str) -> str:
    return slugify(name)[:48].strip("-") or fallback


async def _insert_with_slug(raw, collection: str, doc: dict, *, base: str, explicit: bool) -> None:
    if explicit:
        if base in RESERVED_SLUGS:
            raise PlatformError(409, SLUG_TAKEN)
        doc["slug"] = base
        try:
            await raw[collection].insert_one(doc)
        except DuplicateKeyError:
            raise PlatformError(409, SLUG_TAKEN)
        return

    pattern = f"^{re.escape(base)}(-[0-9]+)?$"
    taken = {r["slug"] async for r in raw[collection].find({"slug": {"$regex": pattern}}, {"slug": 1, "_id": 0})}
    taken |= RESERVED_SLUGS
    number = 1
    for _ in range(8):
        slug = base if number == 1 else f"{base}-{number}"
        while slug in taken:
            number += 1
            slug = f"{base}-{number}"
        doc["slug"] = slug
        try:
            await raw[collection].insert_one(doc)
            return
        except DuplicateKeyError:
            taken.add(slug)
    raise PlatformError(409, "A free slug could not be chosen. Try again.")


def _blank_to_none(value: Any) -> str | None:
    return value if isinstance(value, str) and value.strip() else None


async def _check_new_address(raw, email: str, company_id: str | None) -> str:
    address = normalize_email(email)
    if not address or "@" not in address:
        raise PlatformError(422, "Enter a valid email address.")
    if await email_taken(raw, address):
        raise PlatformError(409, EMAIL_TAKEN)
    if await workspace_service.domain_claimed_by_other(address, company_id):
        raise PlatformError(409, DOMAIN_RESERVED)
    return address


async def _ensure_seat(raw, company_id: str, plan: dict | None) -> None:
    limit = plan_service.limits({"client_plan": plan or {}})["max_users_per_company"]
    if limit is None:
        return
    if await raw.users.count_documents({"company_id": company_id, "is_active": {"$ne": False}}) + 1 > limit:
        raise PlatformError(409, plan_service.SEAT_LIMIT_MESSAGE.format(limit=int(limit)))


async def _create_account(
    raw, *, company_id: str, name: str, email: str, password: str | None = None, owner: bool = False,
    email_checked: bool = False, plan: dict | None = None,
) -> dict:
    clean_name = _clean_text(name, "The name", required=True, limit=120)
    password = _blank_to_none(password)
    if password is None and owner:
        raise PlatformError(422, "A platform owner needs a password.")
    if password is not None:
        _check_password(password)
    address = normalize_email(email) if email_checked else await _check_new_address(raw, email, company_id)
    if not address or "@" not in address:
        raise PlatformError(422, "Enter a valid email address.")
    if plan is not None:
        await _ensure_seat(raw, company_id, plan)
    invite = password is None
    secret = secrets.token_urlsafe(32) if invite else password
    doc = {
        "name": clean_name, "email": address, "password_hash": await _hash_password(secret),
        "role": "superadmin", "otp_required": owner, "otp_enforced": owner, "department_id": None,
        "is_active": True, "created_at": _now_iso(), "company_id": company_id,
    }
    if owner:
        doc["is_platform_admin"] = True
    try:
        await raw.users.insert_one(doc)
    except DuplicateKeyError:
        raise PlatformError(409, EMAIL_TAKEN)
    return {"email": address, "name": clean_name, "invite": invite}


async def _invite_admin(actor: dict, account: dict, company_id: str) -> bool:
    try:
        from services.hr_module import credentials_service

        sent = await credentials_service.send_invite(
            email=account["email"], name=account["name"], company_id=company_id,
            invited_by=actor.get("email"),
        )
    except Exception as exc:
        logger.warning("Invitation to a new administrator failed | company=%s error=%s", company_id, type(exc).__name__)
        return False
    return bool(sent)


async def _invite_if_needed(actor: dict, account: dict, company_id: str) -> bool | None:
    return await _invite_admin(actor, account, company_id) if account.get("invite") else None


def _email_sent(invited: bool | None) -> dict:
    return {} if invited is None else {"email_sent": invited}


def _admin_audit(account: dict, invited: bool | None) -> dict:
    details: dict[str, Any] = {"email": account["email"]}
    if invited is not None:
        details.update({"invited": True, "email_sent": invited})
    return details


def _public_admin(account: dict) -> dict:
    return {"email": account["email"], "name": account["name"]}


async def _create_company(
    raw, client: dict, *, name: str, slug: str | None, admin: dict, email_checked: bool = False,
) -> dict:
    clean_name = _clean_text(name, "The company name", required=True, limit=120)
    explicit = _explicit_slug(slug)
    if not email_checked:
        await _check_new_address(raw, admin.get("email"), None)
    company_id = _new_id("cmp")
    doc = company_doc(company_id, client["client_id"], clean_name, "")
    await _insert_with_slug(
        raw, "companies", doc, base=explicit or _derived_slug(clean_name, "company"), explicit=explicit is not None,
    )
    try:
        created = await _create_account(
            raw, company_id=company_id, name=admin.get("name"), email=admin.get("email"),
            password=admin.get("password"), email_checked=True, plan=client.get("plan"),
        )
    except Exception:
        await raw.companies.delete_one({"company_id": company_id})
        raise
    doc.pop("_id", None)
    return {"company": doc, "admin": created}


async def create_client(
    actor: dict, *, name: str, slug: str | None = None, plan: dict | None = None,
    contact_name: str = "", contact_email: str = "", notes: str = "", company: dict | None = None,
) -> dict:
    raw = _raw()
    clean_name = _clean_text(name, "The client name", required=True, limit=120)
    explicit = _explicit_slug(slug)
    if company:
        first_admin = company.get("admin") or {}
        if _blank_to_none(first_admin.get("password")) is not None:
            _check_password(first_admin["password"])
        await _check_new_address(raw, first_admin.get("email"), None)

    doc = client_doc(_new_id("cli"), clean_name, "")
    doc["plan"] = _merge_plan(None, plan)
    doc["subscription"] = plan_service.default_subscription()
    doc["contact_name"] = _clean_text(contact_name, "The contact name", limit=120)
    doc["contact_email"] = _clean_text(contact_email, "The contact email", limit=254).lower()
    doc["notes"] = _clean_text(notes, "The notes", limit=2000)
    await _insert_with_slug(
        raw, "clients", doc, base=explicit or _derived_slug(clean_name, "client"), explicit=explicit is not None,
    )
    client_id = doc["client_id"]

    created_company = None
    made = None
    if company:
        try:
            made = await _create_company(
                raw, doc, name=company.get("name"), slug=company.get("slug"),
                admin=company.get("admin") or {}, email_checked=True,
            )
        except Exception:
            await raw.clients.delete_one({"client_id": client_id})
            raise
        created_company = made["company"]

    await workspace_service.platform_audit(
        actor, "client_create", "client", client_id,
        {"name": clean_name, "slug": doc["slug"], "plan": doc["plan"], "with_company": bool(company)},
    )
    invited: bool | None = None
    if created_company and made:
        await workspace_service.platform_audit(
            actor, "company_create", "company", created_company["company_id"],
            {"client_id": client_id, "name": created_company["name"], "slug": created_company["slug"]},
        )
        invited = await _invite_if_needed(actor, made["admin"], created_company["company_id"])
        await workspace_service.platform_audit(
            actor, "company_admin_create", "company", created_company["company_id"],
            _admin_audit(made["admin"], invited),
        )

    doc.pop("_id", None)
    row = await _client_row_for(raw, doc)
    company_row = await _company_row_for(raw, created_company, doc) if created_company else None
    return {"client": row, "company": company_row, **_email_sent(invited)}


async def update_client(actor: dict, client_id: str, changes: dict) -> dict:
    raw = _raw()
    client = await _require_client(raw, client_id)
    update: dict[str, Any] = {}
    if "name" in changes:
        update["name"] = _clean_text(changes["name"], "The client name", required=True, limit=120)
    if "plan" in changes:
        update["plan"] = _merge_plan(client.get("plan"), changes["plan"])
    if "contact_name" in changes:
        update["contact_name"] = _clean_text(changes["contact_name"], "The contact name", limit=120)
    if "contact_email" in changes:
        update["contact_email"] = _clean_text(changes["contact_email"], "The contact email", limit=254).lower()
    if "notes" in changes:
        update["notes"] = _clean_text(changes["notes"], "The notes", limit=2000)
    if not update:
        raise PlatformError(422, "Send at least one field to change.")
    await raw.clients.update_one({"client_id": client_id}, {"$set": update})
    await workspace_service.platform_audit(
        actor, "client_update", "client", client_id, {"fields": sorted(update), **({"plan": update["plan"]} if "plan" in update else {})},
    )
    return {"client": await _client_row_for(raw, {**client, **update})}


async def set_client_status(actor: dict, client_id: str, status: str, reason: str | None = None) -> dict:
    raw = _raw()
    client = await _require_client(raw, client_id)
    if (client.get("status") or "active") != status:
        if status == "suspended":
            clean = _clean_text(reason, "The reason", limit=500)
            patch: dict[str, Any] = {"$set": {"status": "suspended", "suspended_at": _now_iso(), "suspended_reason": clean}}
            client = {**client, **patch["$set"]}
        else:
            patch = {"$set": {"status": "active"}, "$unset": {"suspended_at": "", "suspended_reason": ""}}
            client = {k: v for k, v in client.items() if k not in ("suspended_at", "suspended_reason")}
            client["status"] = "active"
        await raw.clients.update_one({"client_id": client_id}, patch)
        await workspace_service.platform_audit(
            actor, "client_suspend" if status == "suspended" else "client_activate", "client", client_id,
            {"reason": client.get("suspended_reason")} if status == "suspended" else {},
        )
    return {"client": await _client_row_for(raw, client)}


async def add_company(actor: dict, client_id: str, *, name: str, slug: str | None, admin: dict) -> dict:
    raw = _raw()
    client = await _require_client(raw, client_id)
    limit = _merge_plan(client.get("plan"), None).get("max_companies")
    if limit is not None and await raw.companies.count_documents({"client_id": client_id}) >= limit:
        noun = "company" if limit == 1 else "companies"
        raise PlatformError(409, f"This client's plan allows up to {limit} {noun}. Change the plan to add another.")
    made = await _create_company(raw, client, name=name, slug=slug, admin=admin)
    company = made["company"]
    await workspace_service.platform_audit(
        actor, "company_create", "company", company["company_id"],
        {"client_id": client_id, "name": company["name"], "slug": company["slug"]},
    )
    invited = await _invite_if_needed(actor, made["admin"], company["company_id"])
    await workspace_service.platform_audit(
        actor, "company_admin_create", "company", company["company_id"], _admin_audit(made["admin"], invited),
    )
    return {"company": await _company_row_for(raw, company, client), **_email_sent(invited)}


_DOMAIN = re.compile(r"^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$")


def normalize_domains(values: list[str] | None) -> list[str]:
    out: list[str] = []
    for value in values or []:
        domain = str(value or "").strip().lower().lstrip("@")
        if not domain:
            continue
        if not _DOMAIN.match(domain):
            raise PlatformError(422, f"{domain} is not a valid email domain.")
        if domain not in out:
            out.append(domain)
    return out


async def update_company(actor: dict, company_id: str, changes: dict) -> dict:
    raw = _raw()
    company, client = await _require_company(raw, company_id)
    update: dict[str, Any] = {}
    if "name" in changes:
        update["name"] = _clean_text(changes["name"], "The company name", required=True, limit=120)
    if "sso_domains" in changes:
        domains = normalize_domains(changes["sso_domains"])
        if domains and await raw.companies.find_one(
            {"sso_domains": {"$in": domains}, "company_id": {"$ne": company_id}}, {"_id": 1},
        ):
            raise PlatformError(409, DOMAIN_TAKEN)
        update["sso_domains"] = domains
    if not update:
        raise PlatformError(422, "Send at least one field to change.")
    try:
        await raw.companies.update_one({"company_id": company_id}, {"$set": update})
    except DuplicateKeyError:
        raise PlatformError(409, DOMAIN_TAKEN)
    await workspace_service.platform_audit(
        actor, "company_update", "company", company_id,
        {"fields": sorted(update), **({"sso_domains": update["sso_domains"]} if "sso_domains" in update else {})},
    )
    return {"company": await _company_row_for(raw, {**company, **update}, client)}


async def set_company_status(actor: dict, company_id: str, status: str, reason: str | None = None) -> dict:
    raw = _raw()
    company, client = await _require_company(raw, company_id)
    if (company.get("status") or "active") != status:
        if status == "suspended":
            clean = _clean_text(reason, "The reason", limit=500)
            patch: dict[str, Any] = {"$set": {"status": "suspended", "suspended_at": _now_iso(), "suspended_reason": clean}}
            company = {**company, **patch["$set"]}
        else:
            patch = {"$set": {"status": "active"}, "$unset": {"suspended_at": "", "suspended_reason": ""}}
            company = {k: v for k, v in company.items() if k not in ("suspended_at", "suspended_reason")}
            company["status"] = "active"
        await raw.companies.update_one({"company_id": company_id}, patch)
        await workspace_service.platform_audit(
            actor, "company_suspend" if status == "suspended" else "company_activate", "company", company_id,
            {"client_id": company.get("client_id"), **({"reason": company.get("suspended_reason")} if status == "suspended" else {})},
            also_company=company_id,
        )
    return {"company": await _company_row_for(raw, company, client)}


async def add_company_admin(
    actor: dict, company_id: str, *, name: str, email: str, password: str | None = None,
) -> dict:
    raw = _raw()
    _, client = await _require_company(raw, company_id)
    account = await _create_account(
        raw, company_id=company_id, name=name, email=email, password=password, plan=client.get("plan"),
    )
    invited = await _invite_if_needed(actor, account, company_id)
    await workspace_service.platform_audit(
        actor, "company_admin_create", "company", company_id, _admin_audit(account, invited),
        also_company=company_id,
    )
    return {"admin": _public_admin(account), **_email_sent(invited)}


async def reset_admin_password(actor: dict, company_id: str, email: str, new_password: str) -> dict:
    raw = _raw()
    await _require_company(raw, company_id)
    _check_password(new_password)
    target = await find_user(raw, email)
    if target is None or target.get("company_id") != company_id or target.get("role") != "superadmin":
        raise PlatformError(404, "Administrator not found.")
    if target.get("is_platform_admin"):
        raise PlatformError(403, "Platform owner accounts are managed under Owners.")
    await raw.users.update_one(
        {"email": target["email"], "company_id": company_id},
        {
            "$set": {
                "password_hash": await _hash_password(new_password), "failed_login_attempts": 0,
                "pwd_changed_at": int(_now().timestamp()),
            },
            "$unset": {"locked_until": ""},
        },
    )
    await workspace_service.platform_audit(
        actor, "company_admin_password_reset", "company", company_id, {"email": target["email"]},
        also_company=company_id,
    )
    return {"message": "Password reset"}


def _owner_row(user: dict, company_names: dict[str, str]) -> dict:
    return {
        "email": user.get("email"), "name": user.get("name") or "",
        "is_active": user.get("is_active", True) is not False,
        "last_login_at": _iso(user.get("last_login_at")),
        "company_name": company_names.get(user.get("company_id"), ""),
        "otp_required": bool(user.get("otp_required")),
    }


async def _company_names(raw, company_ids: list[Any]) -> dict[str, str]:
    ids = sorted({c for c in company_ids if c})
    if not ids:
        return {}
    return {
        c["company_id"]: c.get("name") or ""
        async for c in raw.companies.find({"company_id": {"$in": ids}}, {"_id": 0, "company_id": 1, "name": 1})
    }


async def list_owners() -> dict:
    raw = _raw()
    rows = await raw.users.find(
        {"is_platform_admin": True},
        {"_id": 0, "email": 1, "name": 1, "is_active": 1, "last_login_at": 1, "company_id": 1},
    ).sort("email", 1).to_list(500)
    names = await _company_names(raw, [r.get("company_id") for r in rows])
    return {"owners": [_owner_row(r, names) for r in rows]}


async def create_owner(actor: dict, *, name: str, email: str, password: str) -> dict:
    raw = _raw()
    created = await _create_account(
        raw, company_id=PLATFORM_COMPANY_ID, name=name, email=email, password=password, owner=True,
    )
    await workspace_service.platform_audit(actor, "platform_owner_create", "user", created["email"], {})
    row = await raw.users.find_one({"email": created["email"]}, {"_id": 0, "password_hash": 0, "avatar_base64": 0})
    return {"owner": _owner_row(row or _public_admin(created), await _company_names(raw, [PLATFORM_COMPANY_ID]))}


async def set_owner_active(actor: dict, email: str, is_active: bool) -> dict:
    raw = _raw()
    target = await find_user(raw, email)
    if target is None or not target.get("is_platform_admin"):
        raise PlatformError(404, "Owner not found.")
    currently_active = target.get("is_active", True) is not False
    if not is_active and currently_active:
        if normalize_email(target.get("email")) == normalize_email(actor.get("email")):
            raise PlatformError(409, "You cannot deactivate your own account.")
        active_owners = await raw.users.count_documents({"is_platform_admin": True, "is_active": {"$ne": False}})
        if active_owners <= 1:
            raise PlatformError(409, "The last active platform owner cannot be deactivated.")
    if currently_active != is_active:
        await raw.users.update_one({"email": target["email"]}, {"$set": {"is_active": is_active}})
        await workspace_service.platform_audit(
            actor, "platform_owner_update", "user", target["email"], {"is_active": is_active},
        )
    row = {**target, "is_active": is_active}
    return {"owner": _owner_row(row, await _company_names(raw, [row.get("company_id")]))}


async def database_ping() -> dict:
    raw = get_platform_db()
    if raw is None:
        return {"ok": False, "latency_ms": None}
    started = time.perf_counter()
    try:
        await asyncio.wait_for(raw.command("ping"), timeout=HEALTH_PING_SECONDS)
    except Exception as exc:
        logger.warning("Database ping failed | error=%s", type(exc).__name__)
        return {"ok": False, "latency_ms": None}
    return {"ok": True, "latency_ms": round((time.perf_counter() - started) * 1000, 1)}


async def _failed_emails(raw) -> list[dict]:
    since = (_now() - timedelta(hours=FAILED_EMAIL_HOURS)).isoformat()
    groups = await raw.email_log.aggregate([
        {"$match": {"status": "failed", "created_at": {"$gte": since}, "company_id": {"$type": "string"}}},
        {"$group": {"_id": "$company_id", "failed": {"$sum": 1}}},
        {"$sort": {"failed": -1, "_id": 1}},
        {"$limit": FAILED_EMAIL_GROUPS},
    ]).to_list(FAILED_EMAIL_GROUPS)
    if not groups:
        return []
    companies = {
        c["company_id"]: c
        async for c in raw.companies.find(
            {"company_id": {"$in": [g["_id"] for g in groups]}}, {"_id": 0, "company_id": 1, "name": 1, "client_id": 1},
        )
    }
    client_ids = sorted({c.get("client_id") for c in companies.values() if c.get("client_id")})
    clients = {
        c["client_id"]: c.get("name") or ""
        async for c in raw.clients.find({"client_id": {"$in": client_ids}}, {"_id": 0, "client_id": 1, "name": 1})
    }
    return [
        {
            "company_id": g["_id"],
            "company_name": (companies.get(g["_id"]) or {}).get("name") or "",
            "client_name": clients.get((companies.get(g["_id"]) or {}).get("client_id"), ""),
            "failed": int(g["failed"]),
        }
        for g in groups
    ]


def _cron_row(doc: dict) -> dict:
    key = str(doc.get("key") or "")
    prefix = workspace_service.CRON_RUN_KEY_PREFIX
    return {
        "key": key[len(prefix):] if key.startswith(prefix) else key,
        "last_run_at": doc.get("last_run_at"),
        "status": doc.get("status"),
        "detail": doc.get("detail"),
        "companies_total": doc.get("companies_total"),
        "companies_served": doc.get("companies_served"),
        "companies_failed": doc.get("companies_failed"),
    }


async def health() -> dict:
    raw = get_platform_db()
    mongo = await database_ping()
    provider = await email_delivery_service.active_provider()
    cron: list[dict] = []
    failed: list[dict] = []
    if raw is not None and mongo["ok"]:
        cron, failed = await asyncio.gather(workspace_service.platform_cron_status(), _failed_emails(raw))
    return {
        "mongo": mongo,
        "email": {"configured": provider is not None, "provider": provider},
        "pinecone": {"configured": bool(settings.PINECONE_API_KEY)},
        "cron": [_cron_row(doc) for doc in cron],
        "failed_emails_24h": failed,
    }


def _audit_cursor(before: str | None) -> str | None:
    if before is None:
        return None
    text = before.strip()
    if re.search(r" \d{2}:\d{2}$", text):
        text = f"{text[:-6]}+{text[-5:]}"
    moment = parse_ts(text)
    if moment is None:
        raise PlatformError(422, "The before value must be a timestamp.")
    return moment.isoformat()


async def audit_page(limit: int = AUDIT_PAGE_DEFAULT, before: str | None = None) -> dict:
    cursor = _audit_cursor(before)
    raw = _raw()
    limit = max(1, min(int(limit), AUDIT_PAGE_MAX))
    query: dict[str, Any] = {"company_id": PLATFORM_COMPANY_ID}
    if cursor:
        query["created_at"] = {"$lt": cursor}
    rows = await raw.audit_log.find(
        query,
        {"_id": 0, "created_at": 1, "action": 1, "actor_email": 1, "resource_type": 1, "resource_id": 1, "details": 1},
    ).sort("created_at", -1).limit(limit + 1).to_list(limit + 1)
    page = rows[:limit]
    return {
        "entries": [
            {
                "at": r.get("created_at"), "action": r.get("action"), "actor_email": r.get("actor_email"),
                "resource_type": r.get("resource_type"), "resource_id": r.get("resource_id"),
                "details": r.get("details") or {},
            }
            for r in page
        ],
        "next_before": page[-1].get("created_at") if len(rows) > limit and page else None,
    }


class _Clock:

    def __init__(self, seconds: float):
        self.deadline = time.monotonic() + seconds

    def expired(self) -> bool:
        return time.monotonic() >= self.deadline


def _confirm(given: str | None, slug: str) -> None:
    if not slug or (given or "").strip().lower() != slug.lower():
        raise PlatformError(422, "The slug you typed does not match.")


def _stored_key(collection: str) -> str:
    return collection.replace(".", "__dot__")


def _stored_deleted(company: dict) -> dict[str, int]:
    saved = (company.get("offboarding") or {}).get("deleted") or {}
    return {key.replace("__dot__", "."): int(n) for key, n in saved.items() if isinstance(n, int)}


async def _delete_vectors(raw, company: dict, clock: _Clock) -> bool:
    company_id = company["company_id"]
    index = get_pinecone()
    cursors = dict((company.get("offboarding") or {}).get("cursors") or {})
    worked = False
    for kind, collection, id_field, namespace in (
        ("resumes", "resumes", "resume_id", None), ("jobs", "jobs", "job_id", "jobs"),
    ):
        after = cursors.get(kind)
        while True:
            if worked and clock.expired():
                return False
            query: dict[str, Any] = {"company_id": company_id}
            if after is not None:
                query["_id"] = {"$gt": after}
            rows = await raw[collection].find(query, {id_field: 1}).sort("_id", 1).limit(VECTOR_BATCH).to_list(VECTOR_BATCH)
            if not rows:
                break
            ids = [r[id_field] for r in rows if r.get(id_field)]
            if index is not None and ids:
                kwargs: dict[str, Any] = {"ids": ids}
                if namespace:
                    kwargs["namespace"] = namespace
                try:
                    await asyncio.to_thread(index.delete, **kwargs)
                except Exception as exc:
                    logger.error(
                        "Offboarding: vector delete failed | company=%s kind=%s error=%s", company_id, kind, type(exc).__name__,
                    )
                    raise PlatformError(
                        502, "The vector store did not accept the delete. Nothing else was removed. Try again shortly.",
                    )
            after = rows[-1]["_id"]
            await raw.companies.update_one({"company_id": company_id}, {"$set": {f"offboarding.cursors.{kind}": after}})
            worked = True
            if len(rows) < VECTOR_BATCH:
                break
    return True


async def _rows_left(raw, company_id: str, collections: list[str]) -> int:
    counts = await asyncio.gather(*(raw[name].count_documents({"company_id": company_id}) for name in collections))
    return int(sum(counts))


async def delete_company(actor: dict, company_id: str, confirm_slug: str | None) -> dict:
    result = await _delete_company(actor, company_id, confirm_slug)
    await invalidate_console_cache()
    return result


async def _delete_company(actor: dict, company_id: str, confirm_slug: str | None) -> dict:
    if company_id in (PLATFORM_COMPANY_ID, DEFAULT_COMPANY_ID):
        raise PlatformError(409, "This workspace is built in and cannot be deleted.")
    raw = _raw()
    company, _client = await _require_company(raw, company_id)
    if company.get("kind") == "platform":
        raise PlatformError(409, "This workspace is built in and cannot be deleted.")
    if (company.get("status") or "active") != "suspended":
        raise PlatformError(409, "Suspend the company before deleting it.")
    _confirm(confirm_slug, company.get("slug") or "")
    if await raw.users.find_one({"company_id": company_id, "is_platform_admin": True}, {"_id": 1}):
        raise PlatformError(409, "A platform owner account lives in this company. Deactivate or move it first.")

    clock = _Clock(OFFBOARD_BUDGET_SECONDS)
    if not company.get("offboarding"):
        await workspace_service.platform_audit(
            actor, "company_delete", "company", company_id,
            {"name": company.get("name"), "slug": company.get("slug"), "client_id": company.get("client_id")},
        )
        started = {"started_at": _now_iso(), "started_by": actor.get("email")}
        await raw.companies.update_one({"company_id": company_id}, {"$set": {"offboarding": started}})
        company = {**company, "offboarding": started}

    deleted = _stored_deleted(company)
    names = sorted(
        n for n in await raw.list_collection_names() if n not in OFFBOARD_SKIP and not n.startswith("system.")
    )

    if not await _delete_vectors(raw, company, clock):
        return {"complete": False, "deleted": deleted, "remaining": await _rows_left(raw, company_id, names)}

    worked = False
    for position, name in enumerate(names):
        if worked and clock.expired():
            left = await _rows_left(raw, company_id, names[position:])
            if left:
                return {"complete": False, "deleted": deleted, "remaining": left}
            break
        result = await raw[name].delete_many({"company_id": company_id})
        if result.deleted_count:
            worked = True
            deleted[name] = deleted.get(name, 0) + result.deleted_count
            await raw.companies.update_one(
                {"company_id": company_id},
                {"$inc": {f"offboarding.deleted.{_stored_key(name)}": result.deleted_count}},
            )

    await raw.companies.delete_one({"company_id": company_id})
    await workspace_service.platform_audit(
        actor, "company_delete_complete", "company", company_id,
        {"name": company.get("name"), "client_id": company.get("client_id"), "deleted": deleted},
    )
    return {"complete": True, "deleted": deleted}


async def delete_client(actor: dict, client_id: str, confirm_slug: str | None) -> dict:
    if client_id in (PLATFORM_CLIENT_ID, DEFAULT_CLIENT_ID):
        raise PlatformError(409, "This client is built in and cannot be deleted.")
    raw = _raw()
    client = await _require_client(raw, client_id)
    if await raw.companies.count_documents({"client_id": client_id}):
        raise PlatformError(409, "Delete this client's companies first.")
    _confirm(confirm_slug, client.get("slug") or "")
    await workspace_service.platform_audit(
        actor, "client_delete", "client", client_id, {"name": client.get("name"), "slug": client.get("slug")},
    )
    await raw.clients.delete_one({"client_id": client_id})
    return {"complete": True, "deleted": {"clients": 1}}


require_client = _require_client
directory = _directory
client_row_for = _client_row_for


async def failed_emails_last_day(raw) -> list[dict]:
    return await _failed_emails(raw)
