import logging
import os
import uuid
from datetime import datetime, timedelta, timezone

from config.database import get_db
from config.settings import settings
from services.hr_module.job_sources import (
    list_sources,
    fetch_jobs,
    extract_salary_range,
    JobSourceError,
    JobSourceNotConfigured,
)

logger = logging.getLogger(__name__)

_IN_SERVERLESS = bool(
    os.environ.get("AWS_LAMBDA_FUNCTION_NAME")
    or os.environ.get("VERCEL")
)

_DEFAULT_QUERIES: dict[str, str] = {
    "remotive": "software engineer",
    "arbeitnow": "developer",
    "remoteok": "engineer",
    "themuse": "software",
    "jobicy": "remote",
    "linkedin": "software engineer",
    "indeed": "software engineer",
}

_SYNC_LIMIT_PER_SOURCE = 10

REMINDER_SCHEDULER_INTERVAL_HOURS = 24

SCHEDULER_BUDGET_SECONDS = 1800.0


async def _parse_and_match_bg(job_id: str, title: str, description: str) -> None:
    try:
        from services.hr_module.jd_intel import parse_jd
        from services.hr_module.matcher import match_jd_to_resume_pool
        from services.hr_module.invite_service import auto_invite_from_jd_match
        from config.llm import start_usage_tracking, record_cost

        start_usage_tracking()
        try:
            result = await parse_jd(job_id, title, description, None)
            matched = await match_jd_to_resume_pool(job_id, result["targeting"], result["embedding"])
            invited = await auto_invite_from_jd_match(job_id=job_id, matched_resumes=matched)
            logger.info("Scheduled-sync JD parsed | job_id=%s matched=%d auto_invited=%d",
                        job_id, len(matched), len(invited))
        finally:
            await record_cost("jd_parse", job_id)
    except Exception as exc:
        logger.error("Scheduled-sync JD parse failed | job_id=%s error=%s", job_id, exc)


async def sync_all_sources() -> dict:
    db = get_db()
    if db is None:
        logger.warning("Scheduled job-source sync skipped: database unavailable")
        return {"ran": False, "reason": "database unavailable", "sources": []}

    now = datetime.now(timezone.utc).isoformat()
    open_days = settings.DEFAULT_JD_OPEN_DAYS
    deadline_at = (datetime.now(timezone.utc) + timedelta(days=open_days)).isoformat() if open_days else None

    results = []
    for src in list_sources():
        if not src["configured"]:
            continue
        source_id = src["id"]
        query = _DEFAULT_QUERIES.get(source_id, "software engineer")
        fetched_count = 0
        imported = 0
        skipped = 0
        error = None
        try:
            fetched = await fetch_jobs(source_id, query, None, _SYNC_LIMIT_PER_SOURCE)
            fetched_count = len(fetched)
            for jd in fetched:
                dup_query = (
                    {"source_url": jd["source_url"]} if jd.get("source_url")
                    else {"title": jd["title"], "company_name": jd.get("company_name"), "source": source_id}
                )
                if await db.jobs.find_one(dup_query, {"_id": 1}):
                    skipped += 1
                    continue

                job_id = str(uuid.uuid4())
                salary_min, salary_max = extract_salary_range(jd["description"])
                await db.jobs.insert_one({
                    "doc_type": "job",
                    "job_id": job_id,
                    "title": jd["title"],
                    "description": jd["description"],
                    "difficulty": "medium",
                    "employment_type": jd.get("employment_type") or "full-time",
                    "location": jd.get("location"),
                    "salary_min": salary_min,
                    "salary_max": salary_max,
                    "is_remote": bool(jd.get("is_remote")),
                    "company_name": jd.get("company_name"),
                    "source": source_id,
                    "source_url": jd.get("source_url"),
                    "is_public": False,
                    "deadline_days": open_days,
                    "deadline_at": deadline_at,
                    "parsed_criteria": {},
                    "targeting": {},
                    "embedding": [],
                    "candidate_pipeline": [],
                    "created_by": "scheduler",
                    "created_at": now,
                    "updated_at": now,
                })
                imported += 1
                try:
                    import asyncio
                    asyncio.create_task(_parse_and_match_bg(job_id, jd["title"], jd["description"]))
                except Exception as exc:
                    logger.warning("Could not schedule JD parse | job_id=%s error=%s", job_id, exc)
        except (JobSourceError, JobSourceNotConfigured) as exc:
            error = str(exc)
        except Exception as exc:
            error = f"unexpected error: {exc}"
            logger.error("Scheduled sync failed | source=%s error=%s", source_id, exc)

        results.append({
            "source": source_id,
            "query": query,
            "fetched": fetched_count,
            "imported": imported,
            "skipped": skipped,
            "error": error,
        })
        if error:
            from services.hr_module.notification_settings_service import notify
            await notify("job_import_failed", {"source": source_id, "detail": error})

    return {"ran": True, "sources": results}


def start_scheduler() -> None:
    if _IN_SERVERLESS:
        logger.info(
            "Serverless host detected: in-process schedulers skipped "
            "(job_source_sync, pending_reminders). Scheduled work runs from Vercel "
            "Cron at GET /api/v1/cron/daily, which needs CRON_SECRET to be set."
        )
        return

    try:
        from apscheduler.schedulers.asyncio import AsyncIOScheduler
    except ImportError:
        logger.warning(
            "apscheduler not installed: in-process schedulers (job_source_sync, "
            "pending_reminders) disabled (it is listed in requirements.txt; install "
            "dependencies to enable them)."
        )
        return

    hours = max(1, int(settings.JOB_IMPORT_SYNC_INTERVAL_HOURS or 6))
    reminder_hours = max(1, int(REMINDER_SCHEDULER_INTERVAL_HOURS or 24))

    async def _job():
        try:
            from services.hr_module import cron_service
            result = await cron_service.run_job("job_sync", budget_seconds=SCHEDULER_BUDGET_SECONDS)
            logger.info("Scheduled job-source sync complete: %s %s", result["status"], result["detail"])
        except Exception as exc:
            logger.error("Scheduled job-source sync run failed: %s", exc)

    async def _reminder_job():
        try:
            from services.hr_module import cron_service
            result = await cron_service.run_job("reminders", budget_seconds=SCHEDULER_BUDGET_SECONDS)
            logger.info("Scheduled stale-invite reminder run complete: %s %s", result["status"], result["detail"])
        except Exception as exc:
            logger.error("Scheduled stale-invite reminder run failed: %s", exc)

    scheduler = AsyncIOScheduler()
    scheduler.add_job(_job, "interval", hours=hours, id="job_source_sync", replace_existing=True)
    scheduler.add_job(_reminder_job, "interval", hours=reminder_hours, id="pending_reminders", replace_existing=True)
    scheduler.start()
    logger.info(
        "In-process schedulers started: job_source_sync every %d hour(s), "
        "pending_reminders every %d hour(s)",
        hours, reminder_hours,
    )
