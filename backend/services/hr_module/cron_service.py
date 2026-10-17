import asyncio
import inspect
import logging
import time
from datetime import datetime, timedelta, timezone

from config.database import get_db
from config.tenancy import company_context
from services.hr_module import workspace_service

logger = logging.getLogger(__name__)

JOBS: list[dict] = [
    {"key": "reminders", "label": "Pending invite reminders"},
    {"key": "external_reminders", "label": "Interview reminders for other platforms"},
    {"key": "job_sync", "label": "Job source sync"},
    {"key": "retention", "label": "Data retention"},
]
JOB_KEYS = tuple(j["key"] for j in JOBS)

DAILY_BUDGET_SECONDS = {"reminders": 15.0, "external_reminders": 10.0, "job_sync": 15.0, "retention": 10.0}
SINGLE_BUDGET_SECONDS = 50.0

DAILY_TOTAL_SECONDS = 55.0
PLATFORM_CHECKS_BUDGET_SECONDS = 8.0
MIN_PLATFORM_CHECK_SECONDS = 2.0

RUNNER_MARGIN_SECONDS = 1.5
ALERT_TIMEOUT_SECONDS = 3.0

EXTERNAL_REMINDER_WINDOW_HOURS = 24
_DETAIL_MAX = 300

MIN_COMPANY_SECONDS = 2.0


def _utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_iso(value) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)


def _log_only_note(count: int) -> str:
    from services.hr_module.email_delivery_service import current_provider

    if count and current_provider() is None:
        return " No email provider is configured, so they were only written to the server log."
    return ""


async def _run_reminders() -> tuple[str, str]:
    from services.hr_module.workflow_engine import send_pending_reminders

    sent = await send_pending_reminders()
    return "ok", f"Sent {sent} reminder(s)." + _log_only_note(sent)


async def send_external_interview_reminders(
    *, now: datetime | None = None, window_hours: int = EXTERNAL_REMINDER_WINDOW_HOURS,
) -> dict:
    from services.hr_module import external_interview_service as ext
    from services.hr_module.email_service import send_external_interview_reminder_email

    db = get_db()
    if db is None:
        return {"considered": 0, "sent": 0, "failed": 0, "skipped": 0}

    now = now or datetime.now(timezone.utc)
    horizon = now + timedelta(hours=window_hours)
    query = {
        "interview_mode": "external",
        "external_interview.status": "scheduled",
        "external_interview.scheduled_start_at": {
            "$gte": (now - timedelta(days=1)).isoformat(),
            "$lte": (horizon + timedelta(days=1)).isoformat(),
        },
        "pipeline_stage": {"$nin": ["hired", "rejected"]},
        "$or": [
            {"external_interview.reminder_sent_at": {"$exists": False}},
            {"external_interview.reminder_sent_at": None},
        ],
    }
    projection = {"_id": 0, "candidate_id": 1, "job_id": 1, "name": 1, "email": 1,
                  "external_interview": 1, "external_review": 1}

    considered = sent = failed = skipped = 0
    jobs: dict[str, dict] = {}
    async for cand in db.candidates.find(query, projection).limit(500):
        details = cand.get("external_interview") or {}
        start = _parse_iso(details.get("scheduled_start_at"))
        if start is None or not (now < start <= horizon) or ext.has_review(cand):
            continue
        considered += 1
        if not cand.get("email") or not (details.get("join_url") or details.get("location")):
            skipped += 1
            continue

        claim = await db.candidates.update_one(
            {
                "candidate_id": cand["candidate_id"],
                "external_interview.status": "scheduled",
                "$or": [
                    {"external_interview.reminder_sent_at": {"$exists": False}},
                    {"external_interview.reminder_sent_at": None},
                ],
            },
            {"$set": {"external_interview.reminder_sent_at": now.isoformat()}},
        )
        if claim.matched_count == 0:
            skipped += 1
            continue

        job_id = cand.get("job_id")
        if job_id not in jobs:
            jobs[job_id] = await db.jobs.find_one({"job_id": job_id}, {"_id": 0, "title": 1, "company_name": 1}) or {}
        job = jobs[job_id]
        try:
            delivered = await send_external_interview_reminder_email(
                to_email=cand["email"],
                candidate_name=cand.get("name") or "Candidate",
                job_title=job.get("title") or "the role",
                company_name=job.get("company_name"),
                platform_label=details.get("platform_label") or "the meeting platform",
                join_url=details.get("join_url"),
                location=details.get("location"),
                scheduled_start_at=details["scheduled_start_at"],
                duration_minutes=int(details.get("duration_minutes") or 30),
                notes=details.get("notes"),
                display_timezone=details.get("display_timezone"),
                db=db, candidate_id=cand["candidate_id"], job_id=job_id,
            )
        except Exception as exc:
            logger.warning("External interview reminder raised | candidate_id=%s error=%s",
                           cand["candidate_id"], type(exc).__name__)
            delivered = False
        if delivered:
            sent += 1
        else:
            failed += 1
            await db.candidates.update_one(
                {"candidate_id": cand["candidate_id"]},
                {"$set": {"external_interview.reminder_sent_at": None}},
            )
    return {"considered": considered, "sent": sent, "failed": failed, "skipped": skipped}


async def _run_external_reminders() -> tuple[str, str]:
    result = await send_external_interview_reminders()
    detail = f"Sent {result['sent']} reminder(s)"
    if result["failed"]:
        detail += f", {result['failed']} could not be sent"
    if result["skipped"]:
        detail += f", {result['skipped']} skipped"
    status = "error" if result["failed"] else "ok"
    return status, detail + "." + _log_only_note(result["sent"])


def summarise_sync(summary: dict) -> tuple[str, str]:
    if not summary.get("ran"):
        return "error", f"The sync did not run: {summary.get('reason') or 'unknown reason'}."
    sources = summary.get("sources") or []
    if not sources:
        return "ok", "No job source is configured to sync."
    imported = sum(s.get("imported", 0) for s in sources)
    skipped = sum(s.get("skipped", 0) for s in sources)
    failed = [s["source"] for s in sources if s.get("error")]
    detail = f"Imported {imported} job(s), skipped {skipped} duplicate(s) from {len(sources)} source(s)"
    if failed:
        return "error", detail + f"; failed: {', '.join(failed)}."
    return "ok", detail + "."


async def _run_job_sync() -> tuple[str, str]:
    from services.hr_module.scheduler import sync_all_sources

    return summarise_sync(await sync_all_sources())


async def _run_retention(budget_seconds: float = 8.0) -> tuple[str, str]:
    from services.hr_module import retention_service

    return retention_service.summarise(await retention_service.purge_company(budget_seconds))


_RUNNERS = {
    "reminders": _run_reminders,
    "external_reminders": _run_external_reminders,
    "job_sync": _run_job_sync,
    "retention": _run_retention,
}


def _accepts_budget(runner) -> bool:
    try:
        return "budget_seconds" in inspect.signature(runner).parameters
    except (TypeError, ValueError):
        return False


_RUN_LOG_DAYS = 30


async def _record_company_run(key: str, run: dict) -> None:
    from services.hr_module.audit_service import log_audit_event

    try:
        db = get_db()
        if db is not None:
            await db.cron_runs.insert_one({**run, "expires_at": datetime.now(timezone.utc) + timedelta(days=_RUN_LOG_DAYS)})
            if run.get("status") != "ok":
                await log_audit_event(
                    db, actor_email=None, actor_role="cron",
                    action="cron_run", resource_type="cron", resource_id=key,
                    details={"jobs": [{"key": key, "status": run["status"]}]},
                )
    except Exception as exc:
        logger.warning("cron_runs write failed | key=%s error=%s", key, type(exc).__name__)


async def _run_for_company(key: str, company: dict, *, budget_seconds: float, timeout: float) -> dict:
    from config.llm import reset_usage_tracking
    from shared.scrub import scrub_secrets

    company_id = company["company_id"]
    started_at = _utc_iso()
    error_type: str | None = None
    with company_context(company_id, company):
        reset_usage_tracking()
        try:
            runner = _RUNNERS[key]
            kwargs = {"budget_seconds": max(timeout - RUNNER_MARGIN_SECONDS, 0.5)} if _accepts_budget(runner) else {}
            status, detail = await asyncio.wait_for(runner(**kwargs), timeout=max(timeout, 0.01))
        except asyncio.TimeoutError:
            error_type = "TimeoutError"
            status, detail = "error", f"Stopped after {int(budget_seconds)} seconds. It will pick up again on the next run."
        except Exception as exc:
            error_type = type(exc).__name__
            logger.error("Cron job failed | key=%s company_id=%s error=%s", key, company_id, error_type)
            status, detail = "error", scrub_secrets(f"{type(exc).__name__}: {exc}", limit=_DETAIL_MAX) or "Failed."
        finally:
            reset_usage_tracking()
        run = {
            "key": key, "started_at": started_at, "finished_at": _utc_iso(),
            "status": status, "detail": detail[:_DETAIL_MAX],
        }
        await _record_company_run(key, run)

    try:
        await workspace_service.mark_company_served(company_id, key, run["finished_at"])
    except Exception as exc:
        logger.warning("Could not record the cron turn | key=%s company_id=%s error=%s", key, company_id, type(exc).__name__)
    if status != "ok":
        await _alert_job_failure(key, company_id, error_type)
    return {"company_id": company_id, "status": status, "detail": detail}


async def _alert_job_failure(key: str, company_id: str, error_type: str | None) -> None:
    try:
        from services.hr_module.alerts_service import alert_owners

        label = next((j["label"] for j in JOBS if j["key"] == key), key)
        what = f"It stopped with {error_type}." if error_type else "It reported an error."
        body = (
            f'The scheduled job "{label}" failed for the company {company_id}. {what} '
            "The company's administrators can read the detail under Scheduled Jobs."
        )
        await asyncio.wait_for(
            alert_owners(f"cron-failed:{key}:{company_id}", f"Scheduled job failed: {label}", body, company_id=company_id),
            timeout=ALERT_TIMEOUT_SECONDS,
        )
    except Exception as exc:
        logger.warning(
            "Owner alert for a failed job was not sent | key=%s company_id=%s error=%s", key, company_id, type(exc).__name__,
        )


def _summarise_companies(outcomes: list[dict], total: int) -> tuple[str, str]:
    if total == 0:
        return "ok", "No active company to run for."
    if total == 1 and len(outcomes) == 1:
        return outcomes[0]["status"], outcomes[0]["detail"]
    failed = sum(1 for o in outcomes if o["status"] != "ok")
    detail = f"Ran for {len(outcomes)} of {total} companies"
    if failed:
        detail += f", {failed} with an error"
    detail += "."
    if len(outcomes) < total:
        detail += " The rest are served first on the next run."
    return ("error" if failed else "ok"), detail


async def run_job(key: str, *, budget_seconds: float = SINGLE_BUDGET_SECONDS) -> dict:
    if key not in _RUNNERS:
        raise KeyError(f"Unknown cron job: {key}")
    label = next(j["label"] for j in JOBS if j["key"] == key)
    started_at = _utc_iso()
    began = time.monotonic()

    try:
        companies = await workspace_service.companies_due(key)
        lookup_error = None
    except Exception as exc:
        logger.error("Cron could not list companies | key=%s error=%s", key, type(exc).__name__)
        companies, lookup_error = [], f"Could not list the companies: {type(exc).__name__}."

    outcomes: list[dict] = []
    for company in companies:
        remaining = budget_seconds - (time.monotonic() - began)
        if outcomes and remaining < MIN_COMPANY_SECONDS:
            break
        outcomes.append(await _run_for_company(key, company, budget_seconds=budget_seconds, timeout=remaining))

    if lookup_error:
        status, detail = "error", lookup_error
    else:
        status, detail = _summarise_companies(outcomes, len(companies))
    failed = sum(1 for o in outcomes if o["status"] != "ok")
    finished_at = _utc_iso()
    counts = {"total": len(companies), "served": len(outcomes), "failed": failed}
    try:
        await workspace_service.record_platform_cron_run(key, {
            "started_at": started_at, "last_run_at": finished_at, "status": status, "detail": detail[:_DETAIL_MAX],
            "companies_total": counts["total"], "companies_served": counts["served"], "companies_failed": failed,
        })
    except Exception as exc:
        logger.warning("Platform cron record failed | key=%s error=%s", key, type(exc).__name__)
    return {
        "key": key, "started_at": started_at, "finished_at": finished_at,
        "status": status, "detail": detail[:_DETAIL_MAX], "label": label, "companies": counts,
    }


async def _run_platform_checks(began: float) -> dict | None:
    remaining = DAILY_TOTAL_SECONDS - (time.monotonic() - began)
    if remaining < MIN_PLATFORM_CHECK_SECONDS:
        logger.info("Platform checks skipped: the daily run has no time left | remaining=%.1f", remaining)
        return None
    try:
        from services.hr_module import platform_jobs

        run_checks = platform_jobs.run_platform_checks
    except Exception as exc:
        logger.info("Platform checks not available | error=%s", type(exc).__name__)
        return None
    try:
        result = await asyncio.wait_for(
            run_checks(min(remaining, PLATFORM_CHECKS_BUDGET_SECONDS)), timeout=max(remaining, 0.5),
        )
    except Exception as exc:
        logger.error("Platform checks failed | error=%s", type(exc).__name__)
        return None
    return result if isinstance(result, dict) else None


async def run_daily() -> list[dict]:
    began = time.monotonic()
    results = []
    for job in JOBS:
        results.append(await run_job(job["key"], budget_seconds=DAILY_BUDGET_SECONDS[job["key"]]))
    await _run_platform_checks(began)
    return results


async def get_status(db) -> list[dict]:
    jobs = []
    for job in JOBS:
        last = await db.cron_runs.find_one({"key": job["key"]}, {"_id": 0}, sort=[("started_at", -1)])
        jobs.append({
            "key": job["key"],
            "label": job["label"],
            "last_run_at": (last or {}).get("finished_at") or (last or {}).get("started_at"),
            "last_status": (last or {}).get("status"),
            "last_detail": (last or {}).get("detail"),
        })
    return jobs
