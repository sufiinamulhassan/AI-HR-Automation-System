"""Recurring re-sync of external JD sources — hr_module (Phase 2C / MVP2 §2.2).
Also owns the recurring stale-invite reminder job (MVP2 §2.18 — see
`start_scheduler()` part 2 below).

Two ways the JD-source resync fires, both driving the same
`sync_all_sources()` logic:

1. In-process (`start_scheduler()`): an APScheduler `AsyncIOScheduler` running an
   interval job every `settings.JOB_IMPORT_SYNC_INTERVAL_HOURS` hours. Only viable
   on a normal long-lived server process — skipped entirely on serverless hosts,
   using the same serverless-host detection already used in
   config/database.py, since such a process does not persist between
   invocations and an in-process timer would simply never fire.
2. On Lambda: `POST /jobs/scheduled-sync` (routes/jobs.py, admin-only) runs the
   exact same `sync_all_sources()` synchronously and returns a summary. An
   external scheduler (cron expression matching the same
   `JOB_IMPORT_SYNC_INTERVAL_HOURS` cadence) is expected to call this endpoint —
   no AWS infrastructure is provisioned by this code, only the HTTP surface for
   it to call.

Per-source query: there is currently no persisted "last used query" per source
anywhere in the schema (imports are ad-hoc via POST /jobs/import), so the
recurring unattended sync uses one reasonable, broad default query per source
below. These defaults are intentionally generic (roles that exist across most
industries) so the shared `_rank()` relevance filter in job_sources.py still
returns a sensible top-N regardless of what a given board mostly lists.

`start_scheduler()` also registers a SECOND, independent interval job that
calls `services.hr_module.workflow_engine.send_pending_reminders()` (MVP2
§2.18 — that function already existed and worked, it just had no automatic
caller; see the module docstring there). It follows the exact same
serverless-skip guard as the job-source resync job, for the exact same reason:
an in-process APScheduler timer cannot fire inside a frozen serverless
process. There is currently no externally-callable HTTP
endpoint equivalent to `POST /jobs/scheduled-sync` for reminders (that would
be a `POST /workflows/scheduled-reminders`-shaped admin endpoint) — building
that is explicitly out of scope for this change. On a serverless host, stale-invite
reminders simply will not fire automatically until such an endpoint exists
and an external rule is configured to call it; the manual admin-triggered
path continues to work everywhere in the meantime.
"""
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
    "naukri": "software engineer",
    "dice": "software engineer",
    "careerbuilder": "software engineer",
    "indeed": "software engineer",
}

_SYNC_LIMIT_PER_SOURCE = 10

REMINDER_SCHEDULER_INTERVAL_HOURS = 24


async def _parse_and_match_bg(job_id: str, title: str, description: str) -> None:
    """Mirrors routes.jobs._parse_and_match (parse → embed → match → auto-invite).
    Duplicated (rather than imported) so this module has no dependency on the
    routes package and stays importable standalone."""
    try:
        from services.hr_module.jd_intel import parse_jd
        from services.hr_module.matcher import match_jd_to_resume_pool
        from services.hr_module.invite_service import auto_invite_from_jd_match
        from config.llm import start_usage_tracking, record_cost

        start_usage_tracking()
        result = await parse_jd(job_id, title, description, None)
        matched = await match_jd_to_resume_pool(job_id, result["targeting"], result["embedding"])
        invited = await auto_invite_from_jd_match(job_id=job_id, matched_resumes=matched)
        await record_cost("jd_parse", job_id)
        logger.info("Scheduled-sync JD parsed | job_id=%s matched=%d auto_invited=%d",
                    job_id, len(matched), len(invited))
    except Exception as exc:
        logger.error("Scheduled-sync JD parse failed | job_id=%s error=%s", job_id, exc)


async def sync_all_sources() -> dict:
    """Re-fetch + import from every configured source (free sources, plus keyed
    sources that currently have their key set), each against its default query.
    Shared by the in-process scheduler job and POST /jobs/scheduled-sync so both
    entry points behave identically. Runs to completion and returns a summary —
    callers decide whether to await it inline (the HTTP endpoint) or fire it from
    a timer (the in-process scheduler)."""
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

    return {"ran": True, "sources": results}


def start_scheduler() -> None:
    """Start the in-process recurring jobs (APScheduler), unless running on a
    serverless host (same detection used in config/database.py) — such a
    process is frozen between invocations, so an in-process interval timer
    would never actually fire there.

    Registers TWO independent interval jobs on one shared scheduler instance:

    1. `job_source_sync` — re-syncs external JD sources every
       `settings.JOB_IMPORT_SYNC_INTERVAL_HOURS` hours. On a serverless host,
       an external scheduler calling POST /api/v1/jobs/scheduled-sync with an
       admin token on the same cadence is the substitute (see routes/jobs.py).
       Vercel Cron cannot do this on its own — it issues an unauthenticated
       GET, and that endpoint is POST + require_admin.
    2. `pending_reminders` — calls
       `services.hr_module.workflow_engine.send_pending_reminders()` every
       `REMINDER_SCHEDULER_INTERVAL_HOURS` hours (fixed at 24h — see the
       constant's docstring above for why this isn't a settings field). There
       is currently no HTTP endpoint equivalent for this job (unlike
       job_source_sync) — building one is out of scope here, so on a serverless
       host stale-invite reminders only fire via the existing manual
       admin-triggered path, not automatically. This mirrors the same caveat
       the job-source sync feature documents for itself, just without an HTTP
       substitute yet.

    apscheduler is imported lazily inside this function (not at module import
    time) so this module — and anything that imports it — stays importable even
    before `apscheduler` is installed (it is listed in requirements_txt_additions
    for the orchestrator to install)."""
    if _IN_SERVERLESS:
        logger.info(
            "Serverless host detected — in-process schedulers skipped "
            "(job_source_sync, pending_reminders). Point an external scheduler at "
            "POST /api/v1/jobs/scheduled-sync with an admin token for job-source "
            "resync; stale-invite reminders have no equivalent callable endpoint "
            "and only fire via the manual admin button here."
        )
        return

    try:
        from apscheduler.schedulers.asyncio import AsyncIOScheduler
    except ImportError:
        logger.warning(
            "apscheduler not installed — in-process schedulers (job_source_sync, "
            "pending_reminders) disabled (it is listed in requirements.txt; install "
            "dependencies to enable them)."
        )
        return

    hours = max(1, int(settings.JOB_IMPORT_SYNC_INTERVAL_HOURS or 6))
    reminder_hours = max(1, int(REMINDER_SCHEDULER_INTERVAL_HOURS or 24))

    async def _job():
        try:
            summary = await sync_all_sources()
            logger.info("Scheduled job-source sync complete: %s", summary)
        except Exception as exc:
            logger.error("Scheduled job-source sync run failed: %s", exc)

    async def _reminder_job():
        try:
            from services.hr_module.workflow_engine import send_pending_reminders
            sent_count = await send_pending_reminders()
            logger.info("Scheduled stale-invite reminder run complete: sent=%d", sent_count)
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
