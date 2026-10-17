from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime, timezone
from typing import Any, Iterable

from fastapi import Depends, HTTPException, Request

from config.database import get_db, get_pinecone
from config.settings import settings
from services.hr_module import vector_scope
from services.hr_module.audit_service import log_audit_event
from shared.auth import get_current_user

logger = logging.getLogger(__name__)

VECTOR_BATCH = 1000
MAX_VERSION_ROUNDS = 25

ERASED_MESSAGE = "This candidate's personal data has been erased, so this action is not available."
EMPLOYMENT_REFUSAL = (
    "This person has an accepted offer or an employee record. "
    "Confirm that employment records may be erased as well to continue."
)

CANDIDATE_KEEP = frozenset({
    "_id", "company_id", "doc_type", "candidate_id", "job_id", "status", "pipeline_stage", "decision",
    "created_at", "erased", "erased_at", "erasure",
})
OFFER_KEEP = frozenset({
    "_id", "company_id", "doc_type", "offer_id", "candidate_id", "job_id", "status",
    "created_at", "updated_at", "sent_at", "responded_at", "erased", "erased_at",
})
EMPLOYEE_KEEP = frozenset({
    "_id", "company_id", "employee_id", "candidate_id", "job_id", "offer_id", "department", "job_grade",
    "hired_at", "status", "created_at", "updated_at", "erased", "erased_at",
})

AUDIT_PERSONAL_KEYS = ("email", "notes", "note", "reason", "name", "candidate_name", "to", "phone")
AUDIT_RESUME_KEYS = ("filename",)

COUNT_KEYS = (
    "candidates", "resumes", "resume_files", "job_pipelines", "enrichment_profiles",
    "candidate_profiles_deleted", "candidate_profiles_updated", "demographics",
    "coding_submissions", "coding_sessions", "interviewer_links", "report_shares",
    "email_log_rows", "audit_rows", "hrms_log_rows", "upload_batch_errors",
    "offers", "employees", "performance_reviews", "goals", "applications", "vectors_deleted", "resumes_kept",
)


class ErasureError(Exception):

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


class CandidateNotFound(ErasureError):
    def __init__(self):
        super().__init__(404, "Candidate not found")


class ErasureRefused(ErasureError):

    def __init__(self):
        super().__init__(409, EMPLOYMENT_REFUSAL)


def zero_counts() -> dict[str, int]:
    return {key: 0 for key in COUNT_KEYS}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _unique(values: Iterable[Any]) -> list:
    return list(dict.fromkeys(v for v in values if v))


def _chunks(items: list, size: int) -> Iterable[list]:
    for start in range(0, len(items), size):
        yield items[start:start + size]


def actor_email(actor: Any) -> str:
    if isinstance(actor, dict):
        return str(actor.get("email") or "unknown")
    return str(actor or "unknown")


def normalise_email(value: Any) -> str:
    return str(value or "").strip().lower()


def email_pattern(email: str) -> dict:
    return {"$regex": "^" + re.escape(email.strip()) + "$", "$options": "i"}


def unset_for(docs: Iterable[dict], keep: frozenset[str]) -> dict[str, str]:
    unset: dict[str, str] = {}
    for doc in docs:
        for key in doc:
            if key not in keep:
                unset[key] = ""
    return unset


def anonymise_update(docs: Iterable[dict], keep: frozenset[str], set_fields: dict) -> dict:
    update: dict = {"$set": dict(set_fields)}
    unset = unset_for(docs, keep)
    if unset:
        update["$unset"] = unset
    return update


def tombstone_update(docs: Iterable[dict], *, now: str, actor: Any, reason: str) -> dict:
    return anonymise_update(docs, CANDIDATE_KEEP, {
        "erased": True,
        "erased_at": now,
        "erasure": {"by": actor_email(actor), "reason": reason},
    })


def clean_reason(value: Any) -> str:
    reason = " ".join(str(value or "").split())
    if not 3 <= len(reason) <= 500:
        raise ErasureError(422, "Give a reason of 3 to 500 characters.")
    return reason


async def ensure_not_erased(db, candidate_id: str) -> None:
    row = await db.candidates.find_one({"candidate_id": candidate_id}, {"_id": 0, "erased": 1})
    if row and row.get("erased"):
        raise HTTPException(409, ERASED_MESSAGE)


_READ_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


async def block_erased_candidate(request: Request, _user: dict = Depends(get_current_user)) -> None:
    if request.method in _READ_METHODS:
        return
    candidate_id = request.path_params.get("candidate_id")
    if not candidate_id:
        return
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    await ensure_not_erased(db, candidate_id)


async def _delete_vectors(resume_ids: list[str], known_owned: set[str]) -> tuple[int, list[str]]:
    index = get_pinecone()
    if index is None or not resume_ids:
        return 0, []
    owned = [i for i in resume_ids if i in known_owned]
    stale = [i for i in resume_ids if i not in known_owned]
    for chunk in _chunks(stale, VECTOR_BATCH):
        try:
            owned.extend(await asyncio.to_thread(vector_scope.owned_ids, index, chunk))
        except Exception as exc:
            logger.warning("Erasure: vector ownership lookup failed | error=%s", type(exc).__name__)
    deleted = 0
    failed: list[str] = []
    for chunk in _chunks(owned, VECTOR_BATCH):
        try:
            await asyncio.to_thread(index.delete, ids=chunk)
            deleted += len(chunk)
        except Exception as exc:
            logger.warning("Erasure: vector delete failed | count=%d error=%s", len(chunk), type(exc).__name__)
            failed.extend(chunk)
    return deleted, failed


async def _retry_pending_vectors(db, tombstones: list[dict]) -> int:
    pending = {
        row["candidate_id"]: list((row.get("erasure") or {}).get("vectors_pending") or [])
        for row in tombstones if (row.get("erasure") or {}).get("vectors_pending")
    }
    if not pending:
        return 0
    wanted = sorted({i for ids in pending.values() for i in ids})
    _deleted, failed = await _delete_vectors(wanted, known_owned=set(wanted))
    still = set(failed)
    for candidate_id, ids in pending.items():
        left = [i for i in ids if i in still]
        update = {"$set": {"erasure.vectors_pending": left}} if left else {"$unset": {"erasure.vectors_pending": ""}}
        await db.candidates.update_one({"candidate_id": candidate_id}, update)
    return len(still)


async def _resume_closure(db, seeds: set[str], emails: set[str]) -> dict[str, dict]:
    fields = {"_id": 0, "resume_id": 1, "filename": 1, "previous_resume_id": 1, "superseded_by": 1}
    found: dict[str, dict] = {}
    frontier = set(seeds)
    by_email_done = not emails
    for _ in range(MAX_VERSION_ROUNDS):
        clauses: list[dict] = []
        if frontier:
            listed = list(frontier)
            clauses += [
                {"resume_id": {"$in": listed}},
                {"previous_resume_id": {"$in": listed}},
                {"superseded_by": {"$in": listed}},
            ]
        if not by_email_done:
            clauses += [{"candidate_email": email_pattern(e)} for e in sorted(emails)]
            by_email_done = True
        if not clauses:
            break
        fresh: set[str] = set()
        for row in await db.resumes.find({"$or": clauses}, fields).to_list(length=None):
            rid = row.get("resume_id")
            if rid and rid not in found:
                found[rid] = row
                fresh.add(rid)
        frontier = fresh
    return found


async def _remove_resumes(db, resume_ids: list[str], rows: dict[str, dict], emails: Iterable[str], counts: dict) -> None:
    ids = _unique(resume_ids)
    if ids:
        listed = list(ids)
        counts["resumes"] += (await db.resumes.delete_many({"resume_id": {"$in": listed}})).deleted_count
        counts["applications"] += (await db.applications.delete_many({"resume_id": {"$in": listed}})).deleted_count
        from services.hr_module import plan_service

        freed = await plan_service.stored_bytes(db.resume_files, {"resume_id": {"$in": listed}})
        counts["resume_files"] += (await db.resume_files.delete_many({"resume_id": {"$in": listed}})).deleted_count
        await plan_service.record_stored_bytes(-freed)
        counts["job_pipelines"] += (await db.jobs.update_many(
            {"candidate_pipeline.resume_id": {"$in": listed}},
            {"$pull": {"candidate_pipeline": {"resume_id": {"$in": listed}}}},
        )).modified_count
        await db.resumes.update_many({"superseded_by": {"$in": listed}}, {"$set": {"superseded_by": None}})
        await db.resumes.update_many({"previous_resume_id": {"$in": listed}}, {"$set": {"previous_resume_id": None}})
        await db.candidate_profiles.update_many(
            {"resume_ids": {"$in": listed}}, {"$pull": {"resume_ids": {"$in": listed}}},
        )
        filenames = sorted({r.get("filename") for r in rows.values() if r.get("filename")})
        if filenames:
            counts["upload_batch_errors"] += (await db.upload_batches.update_many(
                {"errors.filename": {"$in": filenames}},
                {"$pull": {"errors": {"filename": {"$in": filenames}}}},
            )).modified_count
        counts["audit_rows"] += (await db.audit_log.update_many(
            {"resource_type": "resume", "resource_id": {"$in": listed}},
            {"$unset": {f"details.{key}": "" for key in AUDIT_RESUME_KEYS}},
        )).modified_count
    clauses: list[dict] = []
    if ids:
        clauses.append({"resume_id": {"$in": list(ids)}})
    clauses += [{"email": email_pattern(e)} for e in sorted(set(emails))]
    if clauses:
        counts["enrichment_profiles"] += (await db[settings.MARKETPLACE_COLLECTION].delete_many({"$or": clauses})).deleted_count


async def _delete_candidate_keyed(db, ids: list[str], counts: dict) -> None:
    scope = {"candidate_id": {"$in": ids}}
    counts["interviewer_links"] += (await db.interviewer_links.delete_many(scope)).deleted_count
    counts["report_shares"] += (await db.report_shares.delete_many(scope)).deleted_count
    counts["demographics"] += (await db.candidate_demographics.delete_many(scope)).deleted_count
    counts["coding_submissions"] += (await db.coding_submissions.delete_many(scope)).deleted_count
    counts["coding_sessions"] += (await db.coding_session_state.delete_many(scope)).deleted_count
    counts["hrms_log_rows"] += (await db.hrms_sync_log.delete_many(scope)).deleted_count


async def _clean_profiles(db, ids: list[str], emails: set[str], counts: dict) -> None:
    clauses: list[dict] = [{"candidate_ids": {"$in": ids}}] if ids else []
    if emails:
        clauses.append({"email": {"$in": sorted(emails)}})
    if not clauses:
        return
    gone = set(ids)
    for profile in await db.candidate_profiles.find({"$or": clauses}).to_list(length=None):
        remaining = [c for c in profile.get("candidate_ids") or [] if c not in gone]
        live = (
            await db.candidates.find(
                {"candidate_id": {"$in": remaining}, "erased": {"$ne": True}},
                {"_id": 0, "candidate_id": 1, "job_id": 1, "resume_id": 1},
            ).to_list(length=None)
            if remaining else []
        )
        if not live:
            await db.candidate_profiles.delete_one({"profile_id": profile["profile_id"]})
            counts["candidate_profiles_deleted"] += 1
            continue
        await db.candidate_profiles.update_one(
            {"profile_id": profile["profile_id"]},
            {"$set": {
                "candidate_ids": [c["candidate_id"] for c in live],
                "job_ids": _unique(c.get("job_id") for c in live),
                "resume_ids": _unique(c.get("resume_id") for c in live),
                "updated_at": _now_iso(),
            }},
        )
        counts["candidate_profiles_updated"] += 1


async def _strip_email_log(db, ids: list[str], emails: set[str], counts: dict) -> None:
    clauses: list[dict] = [{"candidate_id": {"$in": ids}}] if ids else []
    clauses += [{"to": email_pattern(e)} for e in sorted(emails)]
    if not clauses:
        return
    counts["email_log_rows"] += (await db.email_log.update_many(
        {"$or": clauses, "erased": {"$ne": True}},
        {"$unset": {"to": "", "subject": "", "error": ""}, "$set": {"erased": True}},
    )).modified_count


async def _scrub_audit(db, ids: list[str], emails: set[str], counts: dict) -> None:
    if ids:
        counts["audit_rows"] += (await db.audit_log.update_many(
            {"resource_type": "candidate", "resource_id": {"$in": ids}},
            {"$unset": {f"details.{key}": "" for key in AUDIT_PERSONAL_KEYS}},
        )).modified_count
    for email in sorted(emails):
        counts["audit_rows"] += (await db.audit_log.update_many(
            {"details.email": email_pattern(email)}, {"$unset": {"details.email": ""}},
        )).modified_count


async def _employment(db, ids: list[str]) -> tuple[list[dict], list[dict]]:
    if not ids:
        return [], []
    accepted = await db.offers.find(
        {"candidate_id": {"$in": ids}, "status": "accepted", "erased": {"$ne": True}},
        {"_id": 0, "offer_id": 1, "candidate_id": 1},
    ).to_list(length=None)
    employees = await db.employees.find(
        {"candidate_id": {"$in": ids}, "erased": {"$ne": True}},
        {"_id": 0, "employee_id": 1, "candidate_id": 1},
    ).to_list(length=None)
    return accepted, employees


async def _anonymise_employment(db, ids: list[str], emails: set[str], now: str, counts: dict) -> None:
    offers = await db.offers.find({"candidate_id": {"$in": ids}, "erased": {"$ne": True}}).to_list(length=None)
    if offers:
        counts["offers"] += (await db.offers.update_many(
            {"candidate_id": {"$in": ids}, "erased": {"$ne": True}},
            anonymise_update(offers, OFFER_KEEP, {"erased": True, "erased_at": now}),
        )).modified_count

    employees = await db.employees.find({"candidate_id": {"$in": ids}}).to_list(length=None)
    if not employees:
        return
    fresh = [e for e in employees if not e.get("erased")]
    if fresh:
        counts["employees"] += (await db.employees.update_many(
            {"candidate_id": {"$in": ids}, "erased": {"$ne": True}},
            anonymise_update(fresh, EMPLOYEE_KEEP, {"erased": True, "erased_at": now}),
        )).modified_count
    employee_ids = _unique(e.get("employee_id") for e in employees)
    if employee_ids:
        counts["performance_reviews"] += (await db.performance_reviews.delete_many(
            {"employee_id": {"$in": employee_ids}},
        )).deleted_count
        await db.performance_reviews.update_many(
            {"reviewer_id": {"$in": employee_ids}},
            {"$set": {"reviewer_id": None}, "$unset": {"secure_token": ""}},
        )
        goal_ids = _unique(
            g.get("goal_id") for g in await db.goals.find(
                {"owner_id": {"$in": employee_ids}}, {"_id": 0, "goal_id": 1},
            ).to_list(length=None)
        )
        if goal_ids:
            counts["goals"] += (await db.goals.delete_many({"goal_id": {"$in": goal_ids}})).deleted_count
            await db.goals.update_many({"parent_goal_id": {"$in": goal_ids}}, {"$set": {"parent_goal_id": None}})
    if emails:
        await db.employees.update_many({"manager_id": {"$in": sorted(emails)}}, {"$set": {"manager_id": None}})


async def _delete_applications(db, emails: set[str], resume_ids: set[str], counts: dict) -> None:
    clauses = []
    if emails:
        clauses.append({"email_normalized": {"$in": sorted(emails)}})
    if resume_ids:
        clauses.append({"resume_id": {"$in": sorted(resume_ids)}})
    if clauses:
        counts["applications"] += (await db.applications.delete_many({"$or": clauses})).deleted_count


async def erase_candidates(
    db,
    candidate_ids: Iterable[str],
    *,
    actor: Any,
    reason: str,
    include_employment: bool = False,
    via: str = "id",
    audit: bool = True,
    extra_emails: Iterable[str] = (),
) -> dict:
    ids = _unique(candidate_ids)
    counts = zero_counts()
    rows = await db.candidates.find({"candidate_id": {"$in": ids}}).to_list(length=None) if ids else []
    live = [r for r in rows if not r.get("erased")]
    finished = [r for r in rows if r.get("erased")]
    live_ids = [r["candidate_id"] for r in live]
    emails = {normalise_email(r.get("email")) for r in live} | {normalise_email(e) for e in extra_emails}
    emails.discard("")
    result = {
        "erased_ids": live_ids,
        "already_erased_ids": [r["candidate_id"] for r in finished],
        "erased_at": None,
        "counts": counts,
        "vectors_failed": await _retry_pending_vectors(db, finished),
        "other_applications": 0,
    }
    if finished and not live:
        result["erased_at"] = max((r.get("erased_at") or "" for r in finished), default=None) or None
    if not live_ids and not emails:
        return result

    accepted, employees = await _employment(db, live_ids)
    if (accepted or employees) and not include_employment:
        raise ErasureRefused()

    now = _now_iso()
    result["erased_at"] = now

    if live_ids:
        await db.candidates.update_many({"candidate_id": {"$in": live_ids}}, {"$unset": {"secure_token": ""}})
        await db.offers.update_many({"candidate_id": {"$in": live_ids}}, {"$unset": {"secure_token": ""}})
        await _delete_candidate_keyed(db, live_ids, counts)

    seeds = {r["resume_id"] for r in live if r.get("resume_id")}
    closure = await _resume_closure(db, seeds, emails)
    every_resume = set(closure) | seeds
    in_use: set[str] = set()
    if every_resume:
        in_use = {
            r for r in await db.candidates.distinct(
                "resume_id", {"resume_id": {"$in": sorted(every_resume)}, "candidate_id": {"$nin": live_ids}},
            ) if r
        }
    doomed = sorted(every_resume - in_use)
    counts["resumes_kept"] = len(in_use)
    await _remove_resumes(db, doomed, closure, emails, counts)
    await _delete_applications(db, emails, set(), counts)
    for row in live:
        if row.get("resume_id") in in_use and row.get("job_id"):
            await db.jobs.update_one(
                {"job_id": row["job_id"]}, {"$pull": {"candidate_pipeline": {"resume_id": row["resume_id"]}}},
            )

    await _clean_profiles(db, live_ids, emails, counts)
    await _strip_email_log(db, live_ids, emails, counts)
    await _scrub_audit(db, live_ids, emails, counts)
    if live_ids:
        await _anonymise_employment(db, live_ids, emails if (accepted or employees) else set(), now, counts)

    if live:
        counts["candidates"] += (await db.candidates.update_many(
            {"candidate_id": {"$in": live_ids}, "erased": {"$ne": True}},
            tombstone_update(live, now=now, actor=actor, reason=reason),
        )).modified_count

    deleted, failed = await _delete_vectors(doomed, known_owned=set(closure))
    counts["vectors_deleted"] = deleted
    result["vectors_failed"] += len(failed)
    if failed and live_ids:
        await db.candidates.update_many(
            {"candidate_id": {"$in": live_ids}}, {"$set": {"erasure.vectors_pending": failed}},
        )

    if emails:
        result["other_applications"] = await db.candidates.count_documents(
            {"$or": [{"email": email_pattern(e)} for e in sorted(emails)], "erased": {"$ne": True}},
        )

    if audit and live_ids:
        summary = {key: value for key, value in counts.items() if value}
        role = actor.get("role") if isinstance(actor, dict) else None
        for row in live:
            await log_audit_event(
                db, actor_email=actor_email(actor), actor_role=role,
                action="candidate_erase", resource_type="candidate", resource_id=row["candidate_id"],
                details={
                    "via": via, "include_employment": bool(include_employment), "job_id": row.get("job_id"),
                    "candidates_in_request": len(live_ids), "counts": summary,
                },
            )
    return result


async def erase_candidate(db, candidate_id: str, *, actor: Any, reason: str, include_employment: bool = False) -> dict:
    row = await db.candidates.find_one({"candidate_id": candidate_id}, {"_id": 0, "candidate_id": 1})
    if row is None:
        raise CandidateNotFound()
    batch = await erase_candidates(
        db, [candidate_id], actor=actor, reason=reason, include_employment=include_employment, via="id",
    )
    tombstone = await db.candidates.find_one({"candidate_id": candidate_id}, {"_id": 0, "erased_at": 1}) or {}
    return {
        "candidate_id": candidate_id,
        "erased": True,
        "already_erased": candidate_id in batch["already_erased_ids"],
        "erased_at": tombstone.get("erased_at") or batch["erased_at"],
        "counts": batch["counts"],
        "vectors_failed": batch["vectors_failed"],
        "other_applications": batch["other_applications"],
    }


async def erase_by_email(db, email: str, *, actor: Any, reason: str, include_employment: bool = False) -> dict:
    address = normalise_email(email)
    if not address or "@" not in address:
        raise ErasureError(422, "Enter a valid email address.")
    rows = await db.candidates.find({"email": email_pattern(address)}, {"_id": 0, "candidate_id": 1}).to_list(length=None)
    ids = _unique(r["candidate_id"] for r in rows)
    batch = await erase_candidates(
        db, ids, actor=actor, reason=reason, include_employment=include_employment,
        via="email", extra_emails=[address],
    )
    something = bool(ids) or any(batch["counts"].values())
    return {
        "matched": len(ids),
        "candidate_ids": ids,
        "erased_at": batch["erased_at"] if something else None,
        "counts": batch["counts"],
        "vectors_failed": batch["vectors_failed"],
    }


async def erase_resumes(db, resume_ids: Iterable[str]) -> dict:
    ids = _unique(resume_ids)
    counts = zero_counts()
    if not ids:
        return {"resume_ids": [], "counts": counts, "vectors_failed": 0}
    rows = {
        r["resume_id"]: r for r in await db.resumes.find(
            {"resume_id": {"$in": ids}}, {"_id": 0, "resume_id": 1, "filename": 1},
        ).to_list(length=None)
    }
    await _remove_resumes(db, ids, rows, (), counts)
    deleted, failed = await _delete_vectors(ids, known_owned=set(rows))
    counts["vectors_deleted"] = deleted
    return {"resume_ids": ids, "counts": counts, "vectors_failed": len(failed)}
