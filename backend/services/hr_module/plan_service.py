from __future__ import annotations

import copy
import logging
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException

from config.database import get_db
from config.tenancy import current_company, current_company_id

logger = logging.getLogger(__name__)

FEATURES: dict[str, str] = {
    "coding": "coding assessments",
    "performance": "performance reviews",
    "webhooks": "outbound webhooks",
    "workflows": "workflow automation",
    "custom_smtp": "your own mail server",
    "oidc_sso": "single sign-on with your identity provider",
    "custom_domain": "a custom domain",
    "integrations": "HRMS, Zoom and Teams integrations",
}

FEATURE_LABELS: dict[str, str] = {
    "coding": "Coding assessments",
    "performance": "Performance reviews",
    "webhooks": "Outbound webhooks",
    "workflows": "Workflow automation",
    "custom_smtp": "Own mail server",
    "oidc_sso": "Single sign-on (OIDC)",
    "custom_domain": "Custom domain",
    "integrations": "HRMS, Zoom and Teams",
}

BYTES_PER_MB = 1024 * 1024


PLAN_KEYS = (
    "name", "max_companies", "max_users_per_company", "monthly_ai_budget_usd", "max_storage_mb",
    "features", "price_monthly_usd", "trial_ends_at",
)
LIMIT_KEYS = ("max_companies", "max_users_per_company", "monthly_ai_budget_usd", "max_storage_mb")


class PlanError(ValueError):
    pass


def _flags(**off: bool) -> dict[str, bool]:
    return {flag: off.get(flag, True) for flag in FEATURES}


TIERS: dict[str, dict] = {
    "standard": {
        "label": "Standard", "name": "standard",
        "max_companies": None, "max_users_per_company": None, "monthly_ai_budget_usd": None,
        "max_storage_mb": None, "features": _flags(), "price_monthly_usd": None,
    },
    "starter": {
        "label": "Starter", "name": "starter",
        "max_companies": 1, "max_users_per_company": 5, "monthly_ai_budget_usd": 25.0,
        "max_storage_mb": 1024,
        "features": _flags(
            coding=False, performance=False, webhooks=False, workflows=False,
            custom_smtp=False, oidc_sso=False, custom_domain=False, integrations=False,
        ),
        "price_monthly_usd": 49.0,
    },
    "growth": {
        "label": "Growth", "name": "growth",
        "max_companies": 3, "max_users_per_company": 25, "monthly_ai_budget_usd": 150.0,
        "max_storage_mb": 10240,
        "features": _flags(oidc_sso=False, custom_domain=False),
        "price_monthly_usd": 199.0,
    },
    "enterprise": {
        "label": "Enterprise", "name": "enterprise",
        "max_companies": 25, "max_users_per_company": 500, "monthly_ai_budget_usd": 1000.0,
        "max_storage_mb": 102400,
        "features": _flags(),
        "price_monthly_usd": 799.0,
    },
}
DEFAULT_TIER = "standard"


def tier_plan(tier: str) -> dict:
    preset = TIERS.get(tier)
    if preset is None:
        raise PlanError(f"Unknown plan tier: {tier}.")
    plan = {key: copy.deepcopy(preset[key]) for key in PLAN_KEYS if key in preset}
    plan["trial_ends_at"] = None
    return plan


def tier_catalog() -> list[dict]:
    return [{"tier": name, "label": preset["label"], "plan": tier_plan(name)} for name, preset in TIERS.items()]


def feature_catalog() -> list[dict]:
    return [{"key": key, "label": FEATURE_LABELS[key]} for key in FEATURES]


def _number_or_none(value: Any) -> int | float | None:
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def clean_flags(raw: Any) -> dict[str, bool]:
    given = raw if isinstance(raw, dict) else {}
    return {flag: given.get(flag, True) is not False for flag in FEATURES}


def resolve_plan(raw: Any) -> dict:
    raw = raw if isinstance(raw, dict) else {}
    base = TIERS[DEFAULT_TIER]
    name = raw.get("name")
    plan: dict[str, Any] = {"name": name.strip() if isinstance(name, str) and name.strip() else base["name"]}
    for key in LIMIT_KEYS:
        plan[key] = _number_or_none(raw.get(key))
    plan["features"] = clean_flags(raw.get("features"))
    plan["price_monthly_usd"] = _number_or_none(raw.get("price_monthly_usd"))
    ends = parse_instant(raw.get("trial_ends_at"))
    plan["trial_ends_at"] = ends.isoformat() if ends else None
    return plan


def parse_instant(value: Any) -> datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        moment = value
    elif isinstance(value, date):
        moment = datetime(value.year, value.month, value.day, 23, 59, 59)
    else:
        text = str(value).strip()
        if not text:
            return None
        try:
            if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
                day = date.fromisoformat(text)
                moment = datetime(day.year, day.month, day.day, 23, 59, 59)
            else:
                moment = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            return None
    return moment.replace(tzinfo=timezone.utc) if moment.tzinfo is None else moment.astimezone(timezone.utc)


def normalize_instant(value: Any, label: str = "The date") -> str | None:
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    moment = parse_instant(value)
    if moment is None:
        raise PlanError(f"{label} must look like 2026-11-30 or 2026-11-30T12:00:00Z.")
    return moment.isoformat()


_LIMIT_LABELS = {
    "max_companies": "The company limit",
    "max_users_per_company": "The user limit",
    "monthly_ai_budget_usd": "The monthly AI budget",
    "max_storage_mb": "The storage limit",
    "price_monthly_usd": "The monthly price",
}


def _limit(key: str, value: Any) -> int | float | None:
    if value is None:
        return None
    number = _number_or_none(value)
    if number is None or number < 0:
        raise PlanError(f"{_LIMIT_LABELS.get(key, key)} must be a positive number, or empty for none.")
    return number


def merge_plan(current: Any, patch: Any) -> dict:
    plan = resolve_plan(current)
    patch = dict(patch) if isinstance(patch, dict) else {}
    tier = patch.pop("tier", None)
    if tier is not None:
        trial = plan["trial_ends_at"]
        plan = tier_plan(str(tier))
        plan["trial_ends_at"] = trial
    for key, value in patch.items():
        if key not in PLAN_KEYS:
            continue
        if key == "name":
            name = value.strip() if isinstance(value, str) else ""
            if name:
                plan["name"] = name[:60]
        elif key == "features":
            if value is None:
                continue
            if not isinstance(value, dict):
                raise PlanError("Features must be a list of switches.")
            for flag, on in value.items():
                if flag not in FEATURES:
                    raise PlanError(f"Unknown feature: {flag}.")
                if not isinstance(on, bool):
                    raise PlanError(f"The switch for {flag} must be true or false.")
                plan["features"][flag] = on
        elif key == "trial_ends_at":
            plan["trial_ends_at"] = normalize_instant(value, "The trial end")
        else:
            plan[key] = _limit(key, value)
    return plan


def plan_of(company: dict | None = None) -> dict:
    return ((company if company is not None else current_company()) or {}).get("client_plan") or {}


def feature_enabled(flag: str, company: dict | None = None) -> bool:
    return (plan_of(company).get("features") or {}).get(flag, True) is not False


def feature_flags(company: dict | None = None) -> dict[str, bool]:
    return clean_flags(plan_of(company).get("features"))


def require_feature(flag: str):
    from fastapi import Depends

    from shared.auth import get_current_user

    async def _gate(_user: dict = Depends(get_current_user)) -> None:
        if not feature_enabled(flag):
            raise HTTPException(402, f"Your plan does not include {FEATURES.get(flag, flag)}.")

    _gate.plan_feature = flag
    return _gate


SUBSCRIPTION_STATUSES = ("none", "trialing", "active", "past_due", "canceled")
SUBSCRIPTION_PROVIDERS = ("manual", "stripe")

TRIAL_ENDED_MESSAGE = "This workspace's trial has ended. Ask your administrator to subscribe."
SUBSCRIPTION_ENDED_MESSAGE = "This workspace's subscription has ended. Ask your administrator to renew."


def default_subscription() -> dict:
    return {
        "status": "none", "provider": "manual", "customer_id": None, "subscription_id": None,
        "current_period_end": None, "cancel_at_period_end": False,
    }


def resolve_subscription(raw: Any) -> dict:
    raw = raw if isinstance(raw, dict) else {}
    out = default_subscription()
    status = raw.get("status")
    if status in SUBSCRIPTION_STATUSES:
        out["status"] = status
    if raw.get("provider") in SUBSCRIPTION_PROVIDERS:
        out["provider"] = raw["provider"]
    for key in ("customer_id", "subscription_id"):
        value = raw.get(key)
        out[key] = value if isinstance(value, str) and value else None
    end = parse_instant(raw.get("current_period_end"))
    out["current_period_end"] = end.isoformat() if end else None
    out["cancel_at_period_end"] = bool(raw.get("cancel_at_period_end"))
    return out


def subscription_block_reason(plan: Any, subscription: Any, now: datetime | None = None) -> str | None:
    status = str((subscription or {}).get("status") or "none") if isinstance(subscription, dict) else "none"
    if status == "canceled":
        return SUBSCRIPTION_ENDED_MESSAGE
    ends = parse_instant((plan or {}).get("trial_ends_at")) if isinstance(plan, dict) else None
    if ends is not None and ends <= (now or datetime.now(timezone.utc)) and status != "active":
        return TRIAL_ENDED_MESSAGE
    return None


def subscription_summary(company: dict | None = None) -> dict:
    company = (company if company is not None else current_company()) or {}
    subscription = resolve_subscription(company.get("client_subscription"))
    plan = resolve_plan(company.get("client_plan"))
    return {
        "status": subscription["status"],
        "trial_ends_at": plan["trial_ends_at"],
        "current_period_end": subscription["current_period_end"],
        "cancel_at_period_end": subscription["cancel_at_period_end"],
    }


SEAT_LIMIT_MESSAGE = "Your plan allows at most {limit} users. Ask your administrator to raise the limit."
BUDGET_MESSAGE = (
    "This company has used its monthly AI budget (${used:.2f} of ${budget:.2f}). "
    "Ask your administrator to raise it."
)
STORAGE_FULL_MESSAGE = (
    "Your plan's storage is full ({used_mb:.1f} MB of {limit_mb:g} MB). "
    "Delete files or ask your administrator to raise the limit."
)


def limits(company: dict | None = None) -> dict:
    plan = plan_of(company)
    return {
        "name": plan.get("name") or "",
        "max_users_per_company": _positive(plan.get("max_users_per_company")),
        "monthly_ai_budget_usd": _positive(plan.get("monthly_ai_budget_usd")),
    }


def _positive(value) -> float | int | None:
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) and value > 0 else None


def month_start(now: datetime | None = None) -> datetime:
    now = now or datetime.now(timezone.utc)
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def month_label(now: datetime | None = None) -> str:
    start = month_start(now)
    return f"{start.year:04d}-{start.month:02d}"


async def active_users() -> int:
    db = get_db()
    return await db.users.count_documents({"is_active": {"$ne": False}}) if db is not None else 0


async def ensure_seat_available(extra: int = 1) -> None:
    limit = limits()["max_users_per_company"]
    if limit is None:
        return
    if await active_users() + extra > limit:
        raise HTTPException(409, SEAT_LIMIT_MESSAGE.format(limit=int(limit)))


async def month_ai_spend(now: datetime | None = None) -> float:
    db = get_db()
    if db is None:
        return 0.0
    start = month_start(now).isoformat()
    rows = await db.cost_ledger.aggregate([
        {"$match": {"created_at": {"$gte": start}}},
        {"$group": {"_id": None, "cost": {"$sum": "$cost_usd"}}},
    ]).to_list(length=1)
    return float(rows[0]["cost"]) if rows else 0.0


BUDGET_WARN_PERCENT = 80
BUDGET_ALERT_BANDS = (BUDGET_WARN_PERCENT, 100)


def budget_band(used: float, budget: float) -> int:
    if not budget or budget <= 0:
        return 0
    if used >= budget:
        return 100
    if used >= budget * BUDGET_WARN_PERCENT / 100:
        return BUDGET_WARN_PERCENT
    return 0


async def _tell_about_budget(band: int, used: float, budget: float) -> None:
    try:
        company = current_company() or {}
        month = month_label()
        marker = (company.get("usage") or {}).get("ai_alert") or {}
        if marker.get("month") == month and int(marker.get("band") or 0) >= band:
            return
        company_id = current_company_id()
        if not company_id:
            return
        from services.hr_module import alerts_service

        await alerts_service.budget_threshold(company_id, band, used, float(budget), month)
    except Exception as exc:
        logger.warning("Budget notice failed | error=%s", type(exc).__name__)


async def ensure_ai_budget() -> None:
    budget = limits()["monthly_ai_budget_usd"]
    if budget is None:
        return
    used = await month_ai_spend()
    band = budget_band(used, budget)
    if band:
        await _tell_about_budget(band, used, budget)
    if used >= budget:
        raise HTTPException(402, BUDGET_MESSAGE.format(used=used, budget=float(budget)))


def storage_limit_mb(company: dict | None = None) -> int | float | None:
    return _positive(plan_of(company).get("max_storage_mb"))


def storage_used_bytes(company: dict | None = None) -> int:
    usage = ((company if company is not None else current_company()) or {}).get("usage") or {}
    value = _number_or_none(usage.get("storage_bytes"))
    return max(0, int(value)) if value else 0


def storage_summary(company: dict | None = None) -> dict:
    return {"used_mb": round(storage_used_bytes(company) / BYTES_PER_MB, 2), "limit_mb": storage_limit_mb(company)}


def storage_would_overflow(incoming_bytes: int, company: dict | None = None) -> bool:
    limit = storage_limit_mb(company)
    if limit is None:
        return False
    return storage_used_bytes(company) + max(0, int(incoming_bytes)) > limit * BYTES_PER_MB


async def ensure_storage_available(incoming_bytes: int) -> None:
    if storage_would_overflow(incoming_bytes):
        limit = storage_limit_mb()
        raise HTTPException(
            413, STORAGE_FULL_MESSAGE.format(used_mb=storage_used_bytes() / BYTES_PER_MB, limit_mb=float(limit)),
        )


async def record_stored_bytes(delta: int) -> None:
    try:
        if not delta:
            return
        company_id = current_company_id()
        if not company_id:
            return
        from services.hr_module import workspace_service

        await workspace_service.adjust_storage_bytes(company_id, int(delta))
    except Exception as exc:
        logger.warning("Storage counter update failed | error=%s", type(exc).__name__)


async def stored_bytes(collection, flt: dict) -> int:
    try:
        rows = await collection.aggregate([
            {"$match": flt},
            {"$group": {"_id": None, "bytes": {"$sum": {"$bsonSize": "$$ROOT"}}}},
        ]).to_list(length=1)
        return int(rows[0]["bytes"]) if rows else 0
    except Exception as exc:
        logger.warning("Storage measure failed | error=%s", type(exc).__name__)
        return 0


async def usage_summary(now: datetime | None = None) -> dict:
    plan = limits()
    used_ai = await month_ai_spend(now)
    budget = plan["monthly_ai_budget_usd"]
    month = month_start(now)
    return {
        "plan": {
            "name": plan["name"],
            "max_users_per_company": plan["max_users_per_company"],
            "monthly_ai_budget_usd": budget,
        },
        "users": {"used": await active_users(), "limit": plan["max_users_per_company"]},
        "ai": {
            "month": f"{month.year:04d}-{month.month:02d}",
            "used_usd": round(used_ai, 4),
            "budget_usd": budget,
            "percent": round(used_ai / budget * 100, 1) if budget else None,
        },
    }


EMAIL_WINDOW_DAYS = 30


async def emails_sent_recently(now: datetime | None = None) -> int:
    db = get_db()
    if db is None:
        return 0
    since = ((now or datetime.now(timezone.utc)) - timedelta(days=EMAIL_WINDOW_DAYS)).isoformat()
    return await db.email_log.count_documents({"status": "sent", "created_at": {"$gte": since}})


async def company_usage(now: datetime | None = None) -> dict:
    return {
        **await usage_summary(now),
        "emails_30d": await emails_sent_recently(now),
        "storage": storage_summary(),
        "features": feature_flags(),
        "subscription": subscription_summary(),
    }
