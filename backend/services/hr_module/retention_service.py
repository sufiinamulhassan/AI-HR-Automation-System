from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from config.database import get_db
from services.hr_module import erasure_service
from services.hr_module.audit_service import log_audit_event
from services.hr_module.coding_link_service import coding_link_expired, interview_link_expiry

logger = logging.getLogger(__name__)

MIN_DAYS = 30
MAX_DAYS = 36500
SINGLETON_ID = "singleton"

FINAL_STATES = frozenset({"rejected", "not_selected", "withdrawn"})

BATCH_SIZE = 25
RESUME_PAGE = 100
MIN_BATCH_SECONDS = 2.0
MAX_SCANNED = 5000

_ACTIVITY_FIELDS = (
    "created_at", "invite_sent_at", "token_regenerated_at", "last_resent_at", "last_reminder_sent_at",
    "interview_started_at", "interview_ended_at", "decided_at", "scheduled_start_at",
    "recruiter_notes_updated_at", "external_interview.scheduled_at", "external_interview.scheduled_start_at",
    "external_interview.updated_at", "external_review.reviewed_at",
)

_CANDIDATE_PROJECTION = {
    "_id": 0, "candidate_id": 1, "job_id": 1, "status": 1, "pipeline_stage": 1, "decision": 1,
    "token_status": 1, "session_active": 1, "interview_mode": 1, "coding_question_id": 1,
    "invite_expires_at": 1, "coding_invite_expires_at": 1, "erased": 1,
    **{field: 1 for field in _ACTIVITY_FIELDS if "." not in field},
    "external_interview.scheduled_at": 1, "external_interview.scheduled_start_at": 1,
    "external_interview.updated_at": 1, "external_review.reviewed_at": 1,
}


class RetentionError(ValueError):
    pass


def _parse(value: Any) -> datetime | None:
    if not value or not isinstance(value, str):
        return None
    try:
        moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return moment.replace(tzinfo=timezone.utc) if moment.tzinfo is None else moment.astimezone(timezone.utc)


def _dig(doc: dict, path: str) -> Any:
    value: Any = doc
    for part in path.split("."):
        value = value.get(part) if isinstance(value, dict) else None
        if value is None:
            return None
    return value


def last_activity(cand: dict) -> datetime | None:
    newest: datetime | None = None
    for path in _ACTIVITY_FIELDS:
        moment = _parse(_dig(cand, path))
        if moment is not None and (newest is None or moment > newest):
            newest = moment
    return newest


def validate_days(value: Any, label: str) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int):
        raise RetentionError(f"{label} must be a whole number of days, or empty to keep data for ever.")
    if value < MIN_DAYS:
        raise RetentionError(f"{label} must be at least {MIN_DAYS} days, or empty to keep data for ever.")
    if value > MAX_DAYS:
        raise RetentionError(f"{label} must be at most {MAX_DAYS} days.")
    return value


def _never_started_expired_invite(cand: dict, now: datetime) -> bool:
    if (cand.get("status") or "") != "invited":
        return False
    if (cand.get("pipeline_stage") or "invited") not in ("invited", "matched"):
        return False
    if cand.get("interview_mode") == "external":
        return False
    if cand.get("token_status") == "consumed" or cand.get("session_active"):
        return False
    if cand.get("interview_started_at") or cand.get("transcript"):
        return False
    expiry = interview_link_expiry(cand)
    if expiry is None or expiry >= now:
        return False
    if cand.get("coding_question_id") and not coding_link_expired(cand, now):
        return False
    return True


def candidate_eligibility(
    cand: dict, *, now: datetime, days: int, has_offer: bool = False, has_employee: bool = False,
) -> tuple[bool, str]:
    if cand.get("erased"):
        return False, "already_erased"
    status = (cand.get("status") or "").lower()
    stage = (cand.get("pipeline_stage") or "").lower()
    decision = (cand.get("decision") or "").lower()
    if "hired" in (status, stage) or decision == "hire":
        return False, "hired"
    if has_employee:
        return False, "employed"
    if has_offer:
        return False, "offered"
    if cand.get("session_active"):
        return False, "in_progress"

    final = status in FINAL_STATES or stage in FINAL_STATES or decision == "reject"
    expired_invite = False
    if not final:
        expired_invite = _never_started_expired_invite(cand, now)
        if not expired_invite:
            return False, "in_progress"

    last = last_activity(cand)
    if expired_invite:
        expiry = interview_link_expiry(cand)
        if expiry is not None and (last is None or expiry > last):
            last = expiry
    if last is None:
        return False, "no_activity_date"
    if last > now - timedelta(days=days):
        return False, "recent"
    return True, "expired_invite" if expired_invite else "rejected"


def resume_eligibility(
    resume: dict, *, now: datetime, days: int, referenced_ids: set[str], live_emails: set[str],
) -> tuple[bool, str]:
    created = _parse(resume.get("created_at"))
    if created is None:
        return False, "no_date"
    if created > now - timedelta(days=days):
        return False, "recent"
    if resume.get("resume_id") in referenced_ids:
        return False, "attached"
    email = erasure_service.normalise_email(resume.get("candidate_email"))
    if email and email in live_emails:
        return False, "applicant_still_live"
    return True, "old_resume"


def policy_from(doc: dict | None) -> dict:
    stored = (doc or {}).get("retention") or {}
    out = {}
    for key in ("candidate_days", "resume_days"):
        value = stored.get(key)
        ok = isinstance(value, int) and not isinstance(value, bool) and MIN_DAYS <= value <= MAX_DAYS
        out[key] = value if ok else None
    return out


async def get_policy(db) -> dict:
    doc = await db.company_settings.find_one({"_id": SINGLETON_ID}, {"retention": 1})
    stored = (doc or {}).get("retention") or {}
    return {**policy_from(doc), "updated_at": stored.get("updated_at"), "updated_by": stored.get("updated_by")}


async def set_policy(db, changes: dict, *, updated_by: str | None) -> tuple[dict, dict]:
    clean = {}
    for key, label in (("candidate_days", "Candidate retention"), ("resume_days", "Resume retention")):
        if key in changes:
            clean[key] = validate_days(changes[key], label)
    before = await get_policy(db)
    if clean:
        from services.hr_module.company_settings_service import get_company_settings

        await get_company_settings()
        now = datetime.now(timezone.utc).isoformat()
        await db.company_settings.update_one(
            {"_id": SINGLETON_ID},
            {"$set": {
                **{f"retention.{key}": value for key, value in clean.items()},
                "retention.updated_at": now, "retention.updated_by": updated_by,
            }},
        )
    return before, await get_policy(db)


async def last_purge(db) -> dict | None:
    row = await db.audit_log.find_one(
        {"action": "retention_purge"}, {"_id": 0, "created_at": 1, "details": 1}, sort=[("created_at", -1)],
    )
    if not row:
        return None
    details = row.get("details") or {}
    return {
        "at": row.get("created_at"),
        "candidates_erased": int(details.get("candidates_erased") or 0),
        "resumes_erased": int(details.get("resumes_erased") or 0),
    }


async def _holders(db, ids: list[str]) -> tuple[set[str], set[str]]:
    offers = await db.offers.distinct("candidate_id", {"candidate_id": {"$in": ids}})
    employed = await db.employees.distinct("candidate_id", {"candidate_id": {"$in": ids}})
    return set(offers), set(employed)


def _candidate_query(cutoff: str) -> dict:
    return {
        "erased": {"$ne": True},
        "created_at": {"$lt": cutoff},
        "$or": [
            {"status": {"$in": sorted(FINAL_STATES)}},
            {"pipeline_stage": {"$in": sorted(FINAL_STATES)}},
            {"decision": "reject"},
            {"status": "invited", "token_status": {"$ne": "consumed"}, "interview_started_at": None,
             "transcript.0": {"$exists": False}},
        ],
    }


def _add(total: dict, counts: dict) -> None:
    for key, value in counts.items():
        total[key] = total.get(key, 0) + value


async def _purge_candidates(db, days: int, now: datetime, deadline: float, totals: dict, outcome: dict) -> None:
    cutoff = (now - timedelta(days=days)).isoformat()
    cursor = (
        db.candidates.find(_candidate_query(cutoff), _CANDIDATE_PROJECTION)
        .sort([("created_at", 1), ("candidate_id", 1)])
        .limit(MAX_SCANNED)
    )
    reason = f"Retention policy: no activity for {days} days."
    scanned = 0
    batch: list[dict] = []

    async def flush() -> bool:
        if not batch:
            return True
        if deadline - time.monotonic() < MIN_BATCH_SECONDS:
            return False
        ids = [c["candidate_id"] for c in batch]
        offers, employed = await _holders(db, ids)
        eligible = [
            c["candidate_id"] for c in batch
            if candidate_eligibility(
                c, now=now, days=days, has_offer=c["candidate_id"] in offers, has_employee=c["candidate_id"] in employed,
            )[0]
        ]
        batch.clear()
        if not eligible:
            return True
        try:
            result = await erasure_service.erase_candidates(
                db, eligible, actor="retention", reason=reason, include_employment=False, via="retention", audit=False,
            )
        except erasure_service.ErasureRefused:
            return True
        _add(totals, result["counts"])
        outcome["candidates_erased"] += len(result["erased_ids"])
        outcome["vectors_failed"] += result["vectors_failed"]
        return True

    async for cand in cursor:
        scanned += 1
        batch.append(cand)
        if len(batch) >= BATCH_SIZE and not await flush():
            outcome["complete"] = False
            return
    if not await flush():
        outcome["complete"] = False
        return
    if scanned >= MAX_SCANNED:
        outcome["complete"] = False


async def _purge_resumes(db, days: int, now: datetime, deadline: float, totals: dict, outcome: dict) -> None:
    cutoff = (now - timedelta(days=days)).isoformat()
    cursor = (
        db.resumes.find({"created_at": {"$lt": cutoff}}, {"_id": 0, "resume_id": 1, "created_at": 1, "candidate_email": 1})
        .sort([("created_at", 1), ("resume_id", 1)])
        .limit(MAX_SCANNED)
    )
    scanned = 0
    page: list[dict] = []

    async def flush() -> bool:
        if not page:
            return True
        if deadline - time.monotonic() < MIN_BATCH_SECONDS:
            return False
        ids = [r["resume_id"] for r in page if r.get("resume_id")]
        referenced = set(await db.candidates.distinct("resume_id", {"resume_id": {"$in": ids}}))
        emails = {erasure_service.normalise_email(r.get("candidate_email")) for r in page} - {""}
        live_emails = {
            erasure_service.normalise_email(e)
            for e in await db.candidates.distinct("email", {
                "$or": [{"email": erasure_service.email_pattern(e)} for e in sorted(emails)],
                "erased": {"$ne": True},
            })
        } if emails else set()
        eligible = [
            r["resume_id"] for r in page
            if resume_eligibility(r, now=now, days=days, referenced_ids=referenced, live_emails=live_emails)[0]
        ]
        page.clear()
        if not eligible:
            return True
        result = await erasure_service.erase_resumes(db, eligible)
        _add(totals, result["counts"])
        outcome["resumes_erased"] += result["counts"]["resumes"]
        outcome["vectors_failed"] += result["vectors_failed"]
        return True

    async for resume in cursor:
        scanned += 1
        page.append(resume)
        if len(page) >= RESUME_PAGE and not await flush():
            outcome["complete"] = False
            return
    if not await flush():
        outcome["complete"] = False
        return
    if scanned >= MAX_SCANNED:
        outcome["complete"] = False


async def _retry_pending_vectors(db, deadline: float, outcome: dict) -> None:
    if deadline - time.monotonic() < MIN_BATCH_SECONDS:
        return
    rows = await db.candidates.find(
        {"erased": True, "erasure.vectors_pending.0": {"$exists": True}}, {"_id": 0, "candidate_id": 1},
    ).limit(BATCH_SIZE).to_list(length=BATCH_SIZE)
    if rows:
        result = await erasure_service.erase_candidates(
            db, [r["candidate_id"] for r in rows], actor="retention", reason="Retention policy.", via="retention", audit=False,
        )
        outcome["vectors_failed"] += result["vectors_failed"]


async def purge_company(budget_seconds: float = 20.0) -> dict:
    began = time.monotonic()
    deadline = began + max(budget_seconds, 0.0)
    outcome = {
        "enabled": False, "complete": True, "candidates_erased": 0, "resumes_erased": 0,
        "vectors_failed": 0, "counts": {},
    }
    db = get_db()
    if db is None:
        return outcome
    policy = policy_from(await db.company_settings.find_one({"_id": SINGLETON_ID}, {"retention": 1}))
    if policy["candidate_days"] is None and policy["resume_days"] is None:
        return outcome
    outcome["enabled"] = True

    now = datetime.now(timezone.utc)
    totals: dict[str, int] = {}
    await _retry_pending_vectors(db, deadline, outcome)
    if policy["candidate_days"] is not None:
        await _purge_candidates(db, policy["candidate_days"], now, deadline, totals, outcome)
    if policy["resume_days"] is not None and outcome["complete"]:
        await _purge_resumes(db, policy["resume_days"], now, deadline, totals, outcome)
    outcome["counts"] = {key: value for key, value in totals.items() if value}

    if outcome["candidates_erased"] or outcome["resumes_erased"]:
        await log_audit_event(
            db, actor_email=None, actor_role="cron",
            action="retention_purge", resource_type="retention", resource_id=SINGLETON_ID,
            details={
                "candidate_days": policy["candidate_days"], "resume_days": policy["resume_days"],
                "candidates_erased": outcome["candidates_erased"], "resumes_erased": outcome["resumes_erased"],
                "vectors_failed": outcome["vectors_failed"], "complete": outcome["complete"],
                "counts": outcome["counts"],
            },
        )
    return outcome


def summarise(outcome: dict) -> tuple[str, str]:
    if not outcome.get("enabled"):
        return "ok", "Retention is off for this company."
    detail = f"Erased {outcome['candidates_erased']} candidate(s) and {outcome['resumes_erased']} resume(s)."
    if not outcome.get("complete"):
        detail += " More are due; the next run continues."
    if outcome.get("vectors_failed"):
        detail += f" {outcome['vectors_failed']} search index record(s) could not be removed."
        return "error", detail
    return "ok", detail
