import hmac

from fastapi import APIRouter, Depends, Header, HTTPException

from config.database import get_db
from config.settings import settings
from services.hr_module import cron_service
from shared.auth import require_admin
from shared.rate_limit import public_token_throttle

router = APIRouter(dependencies=[Depends(public_token_throttle("cron", ip_limit=60, param=None))])


async def require_cron_secret(authorization: str | None = Header(default=None)) -> None:
    secret = settings.CRON_SECRET
    if not secret:
        raise HTTPException(503, "Scheduled jobs are disabled: CRON_SECRET is not set")
    scheme, _, presented = (authorization or "").partition(" ")
    ok = scheme.lower() == "bearer" and hmac.compare_digest(presented.strip().encode("utf-8"), secret.encode("utf-8"))
    if not ok:
        raise HTTPException(401, "Invalid cron credentials", headers={"WWW-Authenticate": "Bearer"})


@router.get("/daily", dependencies=[Depends(require_cron_secret)])
async def run_daily():
    return {"results": await cron_service.run_daily()}


@router.get("/reminders", dependencies=[Depends(require_cron_secret)])
async def run_reminders():
    return {"results": [await cron_service.run_job("reminders")]}


@router.get("/external-reminders", dependencies=[Depends(require_cron_secret)])
async def run_external_reminders():
    return {"results": [await cron_service.run_job("external_reminders")]}


@router.get("/job-sync", dependencies=[Depends(require_cron_secret)])
async def run_job_sync():
    return {"results": [await cron_service.run_job("job_sync")]}


@router.get("/retention", dependencies=[Depends(require_cron_secret)])
async def run_retention():
    return {"results": [await cron_service.run_job("retention")]}


@router.get("/status")
async def cron_status(_: dict = Depends(require_admin)):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    return {"enabled": bool(settings.CRON_SECRET), "jobs": await cron_service.get_status(db)}
