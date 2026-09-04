"""
HRMS / Payroll outbound connector — hr_module Integrations (MVP2 §2.19).

There is no universal HRMS or payroll API, so building "a BambooHR connector"
or "a Workday connector" would be one vendor's integration wearing a generic
name. This does the thing that actually generalises:

  build_employee_record()  normalises everything the platform knows about a
                           hired candidate into one flat, stable, documented
                           record — the same shape regardless of which HRMS
                           consumes it.
  push_to_hrms()           POSTs that record to the customer's configured
                           endpoint with their auth header, guarded by the
                           same SSRF check the outbound webhook system uses.
  export_employee_records() returns the same records in bulk for HRMS/payroll
                           systems that can only import a file.

Blank HRMS_WEBHOOK_URL = "not configured": push_to_hrms() reports that plainly
instead of failing a hire. Export works with no configuration at all.
"""
import logging
from datetime import datetime, timezone

import httpx

from config.database import get_db
from config.settings import settings
from services.hr_module.webhook_service import is_url_ssrf_safe

logger = logging.getLogger(__name__)

_TIMEOUT = 15.0

EMPLOYEE_RECORD_VERSION = "1.0"


def is_configured() -> bool:
    return bool(settings.HRMS_WEBHOOK_URL)


async def build_employee_record(candidate_id: str) -> dict | None:
    """Assemble one normalised employee record. Returns None if unknown.

    Pulls from candidates + jobs + the accepted offer + the marketplace profile
    (which is where the enriched contact/education fields live). Every field is
    present in the output even when empty, so a consumer never has to
    distinguish "absent" from "not known" — an HRMS import that silently skips
    missing keys is a support ticket nobody enjoys.
    """
    db = get_db()
    if db is None:
        return None

    cand = await db.candidates.find_one({"candidate_id": candidate_id}, {"_id": 0})
    if not cand:
        return None

    job = await db.jobs.find_one({"job_id": cand.get("job_id")}, {"_id": 0}) or {}
    offer = await db.offers.find_one(
        {"candidate_id": candidate_id, "status": "accepted"}, {"_id": 0},
        sort=[("responded_at", -1)],
    ) or {}
    profile = {}
    if cand.get("resume_id"):
        profile = await db[settings.MARKETPLACE_COLLECTION].find_one(
            {"resume_id": cand["resume_id"]}, {"_id": 0},
        ) or {}

    return {
        "record_version": EMPLOYEE_RECORD_VERSION,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "source": "hr-bot-platform",
        "candidate_id": candidate_id,
        "full_name": cand.get("name") or profile.get("name") or "",
        "email": cand.get("email") or profile.get("email") or "",
        "phone": profile.get("phone") or "",
        "location": profile.get("location") or profile.get("address") or "",
        "linkedin_url": profile.get("linkedin_url") or "",
        "job_id": cand.get("job_id") or "",
        "job_title": job.get("title") or "",
        "department_id": job.get("department_id") or "",
        "employment_type": job.get("employment_type") or "",
        "work_location": job.get("location") or "",
        "offer_id": offer.get("offer_id") or "",
        "salary": offer.get("salary") or "",
        "benefits": offer.get("benefits") or "",
        "start_date": offer.get("joining_date") or "",
        "offer_accepted_at": offer.get("responded_at") or "",
        "hiring_status": cand.get("status") or "",
        "match_score": cand.get("match_score"),
        "interview_score": cand.get("eval_score"),
        "seniority_level": profile.get("seniority_level") or "",
        "skills": profile.get("skills") or [],
    }


async def push_to_hrms(candidate_id: str) -> dict:
    """POST one employee record to the configured HRMS endpoint.

    Always returns a result dict rather than raising — this runs off the back
    of a hire, and an HRMS outage must never roll back or fail the hire itself.

      {"status": "not_configured" | "not_found" | "blocked" | "sent" | "failed",
       "detail": str, "http_status": int | None}

    Every attempt is recorded in `hrms_sync_log` so a failure is visible after
    the fact instead of living only in the application log. The one status not
    logged is `not_configured`, which is a configuration state rather than an
    attempt — logging it would fill the collection on every hire at a site that
    never enabled the integration.
    """
    if not is_configured():
        return {"status": "not_configured", "detail": "HRMS_WEBHOOK_URL is not set", "http_status": None}

    url = settings.HRMS_WEBHOOK_URL
    if not is_url_ssrf_safe(url):
        logger.warning("HRMS push blocked — unsafe URL")
        result = {"status": "blocked", "detail": "HRMS_WEBHOOK_URL failed the SSRF safety check", "http_status": None}
        await _log_sync(candidate_id, result)
        return result

    record = await build_employee_record(candidate_id)
    if not record:
        result = {"status": "not_found", "detail": f"No candidate {candidate_id}", "http_status": None}
        await _log_sync(candidate_id, result)
        return result

    headers = {"Content-Type": "application/json"}
    if settings.HRMS_AUTH_HEADER and settings.HRMS_AUTH_TOKEN:
        headers[settings.HRMS_AUTH_HEADER] = settings.HRMS_AUTH_TOKEN

    result: dict
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(url, json=record, headers=headers)
        ok = 200 <= resp.status_code < 300
        result = {
            "status": "sent" if ok else "failed",
            "detail": "" if ok else (resp.text or "")[:300],
            "http_status": resp.status_code,
        }
    except Exception as exc:
        logger.warning("HRMS push failed for candidate=%s: %s", candidate_id, exc)
        result = {"status": "failed", "detail": str(exc)[:300], "http_status": None}

    await _log_sync(candidate_id, result)
    return result


async def _log_sync(candidate_id: str, result: dict) -> None:
    db = get_db()
    if db is None:
        return
    try:
        await db.hrms_sync_log.insert_one({
            "candidate_id": candidate_id,
            "status": result.get("status"),
            "http_status": result.get("http_status"),
            "detail": result.get("detail"),
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    except Exception as exc:
        logger.warning("HRMS sync log write failed: %s", exc)


async def export_employee_records(
    job_id: str | None = None,
    since: str | None = None,
    limit: int = 500,
) -> list[dict]:
    """Bulk export for HRMS/payroll systems that import rather than receive.

    Covers candidates who are hired, PLUS anyone holding an accepted offer —
    the two are recorded independently (a hire sets candidates.status='hired'
    via POST /candidates/{id}/decision; an acceptance sets offers.status=
    'accepted' via the candidate-facing token flow) and either alone is a real
    handover event. An earlier version matched a candidate status of
    "offer_accepted", which nothing in this codebase ever writes.

    `since` compares ISO-8601 UTC strings — safe because every timestamp here
    is written with isoformat(). It matches against whichever of `decided_at`,
    `updated_at` or `created_at` the record actually carries: the hire path
    writes `decided_at`, and filtering on `updated_at` alone (which most
    candidate writes never set) silently returned an empty list forever.
    """
    db = get_db()
    if db is None:
        return []

    clauses: list[dict] = [{"status": "hired"}]

    accepted = await db.offers.find(
        {"doc_type": "offer", "status": "accepted"}, {"_id": 0, "candidate_id": 1},
    ).to_list(length=None)
    accepted_ids = [o["candidate_id"] for o in accepted if o.get("candidate_id")]
    if accepted_ids:
        clauses.append({"candidate_id": {"$in": accepted_ids}})

    query: dict = {"$or": clauses}
    if job_id:
        query["job_id"] = job_id
    if since:
        query["$and"] = [{"$or": [
            {"decided_at": {"$gte": since}},
            {"updated_at": {"$gte": since}},
            {"created_at": {"$gte": since}},
        ]}]

    cursor = db.candidates.find(query, {"_id": 0, "candidate_id": 1}).limit(limit)
    ids = [c["candidate_id"] for c in await cursor.to_list(length=limit)]

    records = []
    for candidate_id in ids:
        record = await build_employee_record(candidate_id)
        if record:
            records.append(record)
    return records


async def sync_log(candidate_id: str | None = None, limit: int = 100) -> list[dict]:
    db = get_db()
    if db is None:
        return []
    query = {"candidate_id": candidate_id} if candidate_id else {}
    cursor = db.hrms_sync_log.find(query, {"_id": 0}).sort("created_at", -1).limit(limit)
    return await cursor.to_list(length=limit)


__all__ = [
    "build_employee_record",
    "push_to_hrms",
    "export_employee_records",
    "sync_log",
    "is_configured",
    "EMPLOYEE_RECORD_VERSION",
]
