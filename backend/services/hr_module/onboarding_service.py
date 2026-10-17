from __future__ import annotations

import asyncio

from config.database import get_db
from services.hr_module.branding_service import (
    _STALE_ACCENT_COLOR,
    _STALE_PRIMARY_COLOR,
    DEFAULT_ACCENT_COLOR,
    DEFAULT_PRIMARY_COLOR,
)

SINGLETON_ID = "singleton"

STEPS: tuple[tuple[str, str], ...] = (
    ("profile", "Complete the company profile"),
    ("branding", "Add a logo or brand colours"),
    ("users", "Add a teammate"),
    ("job", "Create a job"),
    ("resume", "Upload resumes"),
)

_UNCHOSEN_PRIMARY = {DEFAULT_PRIMARY_COLOR.lower(), _STALE_PRIMARY_COLOR.lower()}
_UNCHOSEN_ACCENT = {DEFAULT_ACCENT_COLOR.lower(), _STALE_ACCENT_COLOR.lower()}


def branding_customised(doc: dict | None) -> bool:
    doc = doc or {}
    if str(doc.get("company_logo_url") or "").strip():
        return True
    primary = str(doc.get("primary_color") or "").strip().lower()
    accent = str(doc.get("accent_color") or "").strip().lower()
    return bool((primary and primary not in _UNCHOSEN_PRIMARY) or (accent and accent not in _UNCHOSEN_ACCENT))


async def onboarding_status() -> dict:
    db = get_db()
    profile, branding, accounts, job, resume = await asyncio.gather(
        db.company_settings.find_one({"_id": SINGLETON_ID}),
        db.branding_settings.find_one({"_id": SINGLETON_ID}),
        db.users.count_documents({}, limit=2),
        db.jobs.find_one({}, {"_id": 1}),
        db.resumes.find_one({}, {"_id": 1}),
    )
    done = {
        "profile": bool(str((profile or {}).get("company_name") or "").strip()),
        "branding": branding_customised(branding),
        "users": accounts > 1,
        "job": job is not None,
        "resume": resume is not None,
    }
    return {
        "steps": [{"key": key, "label": label, "done": done[key]} for key, label in STEPS],
        "dismissed": bool((profile or {}).get("onboarding_dismissed")),
    }


async def dismiss_onboarding() -> dict:
    from services.hr_module.company_settings_service import get_company_settings

    db = get_db()
    await get_company_settings()
    await db.company_settings.update_one({"_id": SINGLETON_ID}, {"$set": {"onboarding_dismissed": True}})
    return {"dismissed": True}
