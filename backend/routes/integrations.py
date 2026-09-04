"""
Integrations route — hr_module (MVP2 §2.19).

Admin-only surface over the two connectors added in this pass:
  GET  /integrations/status                  what is configured right now
  POST /integrations/hrms/push/{candidate_id} push one hire to the HRMS
  GET  /integrations/hrms/export             bulk employee records
  GET  /integrations/hrms/log                push history

Meeting creation is not here — it hangs off the interview schedule endpoint
(PATCH /interview/{candidate_id}/schedule), because a meeting only means
anything attached to a scheduled slot.
"""
import logging

from fastapi import APIRouter, Depends, HTTPException

from config.settings import sandbox_provider, sandbox_url, settings
from shared.auth import require_admin
from services.hr_module import hrms_service, meeting_service

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/status")
async def integrations_status(_: dict = Depends(require_admin)):
    """Which integrations are live. Every one of these degrades to "off"
    rather than erroring, so this endpoint is the only way to tell from the
    outside whether a feature is configured or quietly doing nothing."""
    return {
        "meetings": {
            "configured_providers": meeting_service.configured_providers(),
            "default_provider": settings.MEETING_PROVIDER or None,
        },
        "hrms": {
            "configured": hrms_service.is_configured(),
            "auto_push_on_hire": settings.HRMS_AUTO_PUSH_ON_HIRE,
            "record_version": hrms_service.EMPLOYEE_RECORD_VERSION,
        },
        "sso": {"google": bool(settings.GOOGLE_OAUTH_CLIENT_ID)},
        "email": {
            "transport": "ses" if settings.AWS_SES_ENABLED else ("smtp" if settings.EMAIL_HOST else None),
        },
        "coding_sandbox": {
            "provider": sandbox_provider(),
            "configured": bool(sandbox_url()),
            "judge0": bool(settings.JUDGE0_API_URL),
            "piston": bool(settings.PISTON_API_URL),
        },
    }


@router.post("/hrms/push/{candidate_id}")
async def hrms_push(candidate_id: str, _: dict = Depends(require_admin)):
    """Push one hired candidate to the configured HRMS endpoint.

    push_to_hrms never raises; the status it reports is mapped to a matching
    HTTP code here so the admin UI can distinguish "you haven't configured
    this" from "your HRMS rejected it".
    """
    result = await hrms_service.push_to_hrms(candidate_id)
    status = result.get("status")
    if status == "not_configured":
        raise HTTPException(503, "HRMS integration is not configured — set HRMS_WEBHOOK_URL")
    if status == "not_found":
        raise HTTPException(404, "Candidate not found")
    if status == "blocked":
        raise HTTPException(400, result.get("detail") or "HRMS URL rejected by the safety check")
    if status == "failed":
        raise HTTPException(502, f"HRMS rejected the record: {result.get('detail')}")
    return result


@router.get("/hrms/export")
async def hrms_export(
    job_id: str | None = None,
    since: str | None = None,
    limit: int = 500,
    _: dict = Depends(require_admin),
):
    """Bulk employee records for HRMS/payroll systems that import rather than
    receive a push. Needs no HRMS configuration at all."""
    records = await hrms_service.export_employee_records(job_id=job_id, since=since, limit=limit)
    return {"records": records, "total": len(records), "record_version": hrms_service.EMPLOYEE_RECORD_VERSION}


@router.get("/hrms/log")
async def hrms_log(candidate_id: str | None = None, limit: int = 100, _: dict = Depends(require_admin)):
    return {"entries": await hrms_service.sync_log(candidate_id=candidate_id, limit=limit)}
