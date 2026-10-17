import asyncio
import logging
from datetime import datetime, timezone
from urllib.parse import urlsplit

from config.database import get_db
from config.settings import settings
from services.hr_module import integrations_settings_service
from shared.safe_http import UnsafeTarget, resolve_public, safe_request

logger = logging.getLogger(__name__)

_TIMEOUT = 15.0
_MAX_RESPONSE_BYTES = 64_000

_TRANSPORT = None

EMPLOYEE_RECORD_VERSION = "1.0"


def is_configured() -> bool:
    return integrations_settings_service.environment_config("hrms") is not None


async def is_configured_for_company() -> bool:
    return await integrations_settings_service.runtime_config("hrms") is not None


async def auto_push_enabled() -> bool:
    return await integrations_settings_service.hrms_auto_push()


async def _unsafe_target(url: str) -> str | None:
    try:
        parts = urlsplit(url)
        port = parts.port or 443
    except ValueError:
        return "The HRMS address is not a valid web address."
    if parts.scheme != "https" or not parts.hostname:
        return "The HRMS address must start with https://."
    if parts.username or parts.password:
        return "The HRMS address cannot contain a user name or password."
    try:
        await resolve_public(parts.hostname, port)
    except UnsafeTarget:
        return "The HRMS address is not a public website that can be reached."
    return None


async def build_employee_record(candidate_id: str) -> dict | None:
    db = get_db()
    if db is None:
        return None

    cand = await db.candidates.find_one({"candidate_id": candidate_id}, {"_id": 0})
    if not cand or cand.get("erased"):
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
        "source": "hirely-platform",
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
    config = await integrations_settings_service.runtime_config("hrms")
    if not config:
        return {"status": "not_configured", "detail": "The HRMS integration is not set up", "http_status": None}

    url = config["url"]
    problem = await _unsafe_target(url)
    if problem:
        logger.warning("HRMS push blocked: unsafe URL")
        result = {"status": "blocked", "detail": problem, "http_status": None}
        await _log_sync(candidate_id, result)
        return result

    record = await build_employee_record(candidate_id)
    if not record:
        result = {"status": "not_found", "detail": f"No candidate {candidate_id}", "http_status": None}
        await _log_sync(candidate_id, result)
        return result

    headers = {"Content-Type": "application/json"}
    if config.get("auth_header") and config.get("auth_token"):
        headers[config["auth_header"]] = config["auth_token"]

    result: dict
    try:
        resp = await safe_request(
            "POST", url, json=record, headers=headers, timeout=_TIMEOUT,
            max_bytes=_MAX_RESPONSE_BYTES, transport=_TRANSPORT,
        )
        ok = 200 <= resp.status_code < 300
        result = {
            "status": "sent" if ok else "failed",
            "detail": "" if ok else (resp.text or "")[:300],
            "http_status": resp.status_code,
        }
    except UnsafeTarget as exc:
        if "larger than allowed" in str(exc):
            result = {"status": "failed", "detail": "The HRMS answered with more data than allowed.", "http_status": None}
        else:
            logger.warning("HRMS push blocked at connect time")
            result = {"status": "blocked", "detail": "The HRMS address is not a public website that can be reached.", "http_status": None}
    except Exception as exc:
        logger.warning("HRMS push failed for candidate=%s: %s", candidate_id, type(exc).__name__)
        timed_out = isinstance(exc, (TimeoutError, asyncio.TimeoutError)) or "Timeout" in type(exc).__name__
        result = {
            "status": "failed",
            "detail": "The HRMS did not answer in time." if timed_out else f"Could not reach the HRMS ({type(exc).__name__}).",
            "http_status": None,
        }

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
    "is_configured_for_company",
    "auto_push_enabled",
    "EMPLOYEE_RECORD_VERSION",
]
