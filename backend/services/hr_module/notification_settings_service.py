"""Notification settings service — hr_module Admin Configuration (MVP2
§2.20 slice: Notification Settings).

Kept as its own file, separate from `branding_service.py`, even though both
are tiny singleton-settings surfaces sharing one admin page
(`src/pages/admin/BrandingPage.tsx`): branding is look-and-feel (logo/
colors), notification settings is an events/alerting catalog (which
internal events should email admins, and where) — different domains. This
mirrors the rest of the codebase's one-file-per-concern convention
(`scenario_service.py` / `offer_service.py` / `company_settings_service.py`
are each similarly single-purpose) even where two concerns share one route
file or one admin page purely for UI convenience.

NOTIFICATION_EVENTS is the fixed catalog of internal events an admin can
opt in/out of. Each one is tied to a real, already-shipped subsystem
(Offers, Interview Integrity Monitoring, Multi-Source Job Import, AI Coding
Assessment, Webhooks) rather than a speculative event no feature actually
produces yet.

SCOPE NOTE (see docs/report.md §3 / docs/MVP2.md §2.20): this module only
builds the settings CRUD. Nothing in the codebase calls
`get_notification_settings()` to decide whether to actually send a
notification when one of these events happens — that wiring is explicitly
out of scope for this pass. Wiring one in later is, at each relevant call
site (e.g. `services/hr_module/offer_service.py`'s `respond_to_offer` for
`offer_declined`, `services/hr_module/job_sources.py` for
`job_import_failed`, the integrity-scoring path in
`agents/interview_agent.py` for `candidate_flagged_for_integrity`, Judge0
error handling in `services/hr_module/coding_service.py` for
`coding_submission_execution_failed`, and
`services/hr_module/webhook_service.py`'s delivery-failure branch for
`webhook_delivery_failed`):

    from services.hr_module.notification_settings_service import get_notification_settings
    settings_doc = await get_notification_settings()
    events_by_key = {e["event"]: e["enabled"] for e in settings_doc["events"]}
    if events_by_key.get("offer_declined") and settings_doc["notify_email"]:
        # send an admin-facing email via services.hr_module.email_service,
        # or fire a webhook via fire_webhook_event(...) — either is a small,
        # additive, one-call-site change, not a redesign of this module.
        ...

No index is added for `notification_settings` in `config/database.py` for
the same reason as `branding_settings`/`company_settings`: the only lookup
is by the fixed `_id` "singleton", already covered by MongoDB's default
unique `_id` index.
"""
import logging
import re
from datetime import datetime, timezone

from config.database import get_db
from shared.utils import mongo_doc

logger = logging.getLogger(__name__)

SINGLETON_ID = "singleton"

NOTIFICATION_EVENTS: list[dict] = [
    {
        "event": "offer_declined",
        "label": "Offer Declined",
        "description": "A candidate declines a sent offer letter.",
    },
    {
        "event": "candidate_flagged_for_integrity",
        "label": "Candidate Flagged for Integrity",
        "description": "An interview's integrity score falls low enough to warrant review.",
    },
    {
        "event": "job_import_failed",
        "label": "Job Import Failed",
        "description": "A multi-source job import (scheduled or manual) fails.",
    },
    {
        "event": "coding_submission_execution_failed",
        "label": "Coding Submission Execution Failed",
        "description": "Judge0 execution errors out for a candidate's code submission.",
    },
    {
        "event": "webhook_delivery_failed",
        "label": "Webhook Delivery Failed",
        "description": "An outbound webhook delivery fails.",
    },
]
_VALID_EVENTS = {e["event"] for e in NOTIFICATION_EVENTS}
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _default_doc() -> dict:
    now = datetime.now(timezone.utc).isoformat()
    return {
        "_id": SINGLETON_ID,
        "notify_email": "",
        "events": {event: False for event in _VALID_EVENTS},
        "created_at": now,
        "updated_at": now,
    }


def _with_catalog(doc: dict) -> dict:
    """Projects the stored doc's event booleans onto the full
    NOTIFICATION_EVENTS catalog (with label/description metadata), so the
    response always reflects every currently-known event — even ones added
    to the catalog after this singleton document was first created — and
    the frontend can render toggle rows without a second lookup call."""
    stored_events = doc.get("events") or {}
    events = [
        {**meta, "enabled": bool(stored_events.get(meta["event"], False))}
        for meta in NOTIFICATION_EVENTS
    ]
    return {
        "notify_email": doc.get("notify_email") or "",
        "events": events,
        "updated_at": doc.get("updated_at"),
    }


async def get_notification_settings() -> dict:
    """Fetch the singleton notification-settings document, upserting
    defaults into existence on first call so a fresh install never 404s."""
    db = get_db()
    if db is None:
        logger.warning("get_notification_settings: database unavailable, returning in-memory defaults")
        return _with_catalog(_default_doc())

    doc = await db.notification_settings.find_one({"_id": SINGLETON_ID})
    if doc is not None:
        return _with_catalog(mongo_doc(doc))

    fresh = _default_doc()
    try:
        await db.notification_settings.insert_one(dict(fresh))
    except Exception as exc:
        logger.info("notification_settings singleton insert race, re-reading: %s", exc)
        existing = await db.notification_settings.find_one({"_id": SINGLETON_ID})
        if existing is not None:
            return _with_catalog(mongo_doc(existing))
    return _with_catalog(fresh)


async def update_notification_settings(
    notify_email: str | None,
    events: dict[str, bool] | None,
    updated_by: str | None = None,
) -> dict:
    """Partial update: `events` is merged key-by-key onto the existing map —
    only recognised NOTIFICATION_EVENTS keys are accepted, anything else is
    silently dropped (same "ignore unknown fields" convention as
    `company_settings_service.update_company_settings`). `notify_email` is
    loosely format-validated (not full RFC 5322 — just "looks like an
    email") so a typo doesn't get silently persisted; raises ValueError so
    the route can 400.
    """
    if notify_email is not None and notify_email != "" and not _EMAIL_RE.match(notify_email):
        raise ValueError("notify_email must be a valid email address")

    clean_events: dict[str, bool] = {}
    if events:
        clean_events = {k: bool(v) for k, v in events.items() if k in _VALID_EVENTS}

    db = get_db()
    if db is None:
        logger.warning("update_notification_settings: database unavailable, update not persisted")
        merged = _default_doc()
        if notify_email is not None:
            merged["notify_email"] = notify_email
        merged["events"].update(clean_events)
        return _with_catalog(merged)

    await get_notification_settings()
    current_doc = await db.notification_settings.find_one({"_id": SINGLETON_ID}) or _default_doc()
    current_events = dict(current_doc.get("events") or {})
    current_events.update(clean_events)

    update: dict = {"events": current_events, "updated_at": datetime.now(timezone.utc).isoformat()}
    if notify_email is not None:
        update["notify_email"] = notify_email
    if updated_by:
        update["updated_by"] = updated_by

    await db.notification_settings.update_one({"_id": SINGLETON_ID}, {"$set": update}, upsert=True)
    doc = await db.notification_settings.find_one({"_id": SINGLETON_ID})
    return _with_catalog(mongo_doc(doc)) if doc is not None else _with_catalog(_default_doc())
