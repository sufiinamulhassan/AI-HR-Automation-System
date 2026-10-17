import logging

from fastapi import APIRouter, Depends, HTTPException

from config.settings import sandbox_provider, sandbox_url, settings
from config.database import get_db
from shared.auth import require_admin
from services.hr_module import department_access, hrms_service, mail_settings_service, meeting_service

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/status")
async def integrations_status(_: dict = Depends(require_admin)):
    mail = await mail_settings_service.load_mail()
    own_mail = bool(mail) and mail.get("mode") == "smtp" and mail_settings_service.is_complete(mail)
    return {
        "meetings": {
            "configured_providers": await meeting_service.available_providers(),
            "default_provider": meeting_service.default_provider() or None,
        },
        "hrms": {
            "configured": await hrms_service.is_configured_for_company(),
            "auto_push_on_hire": await hrms_service.auto_push_enabled(),
            "record_version": hrms_service.EMPLOYEE_RECORD_VERSION,
        },
        "sso": {"google": bool(settings.GOOGLE_OAUTH_CLIENT_ID)},
        "email": {
            "mode": "smtp" if own_mail else "platform",
            "transport": "smtp" if own_mail else (
                "ses" if settings.AWS_SES_ENABLED else ("smtp" if settings.EMAIL_HOST else None)
            ),
        },
        "coding_sandbox": {
            "provider": sandbox_provider(),
            "configured": bool(sandbox_url()),
            "judge0": bool(settings.JUDGE0_API_URL),
            "piston": bool(settings.PISTON_API_URL),
        },
    }


@router.post("/hrms/push/{candidate_id}")
async def hrms_push(candidate_id: str, user: dict = Depends(require_admin)):
    await department_access.ensure_candidate_in_scope(get_db(), user, candidate_id)
    result = await hrms_service.push_to_hrms(candidate_id)
    status = result.get("status")
    if status == "not_configured":
        raise HTTPException(503, "The HRMS integration is not set up. Add it in Company Settings, Integrations.")
    if status == "not_found":
        raise HTTPException(404, "Candidate not found")
    if status == "blocked":
        raise HTTPException(400, result.get("detail") or "The HRMS address was rejected by the safety check.")
    if status == "failed":
        raise HTTPException(502, f"HRMS rejected the record: {result.get('detail')}")
    return result


@router.get("/hrms/export")
async def hrms_export(
    job_id: str | None = None,
    since: str | None = None,
    limit: int = 500,
    user: dict = Depends(require_admin),
):
    if job_id:
        await department_access.require_job_access(get_db(), user, job_id)
    records = await hrms_service.export_employee_records(job_id=job_id, since=since, limit=limit)
    return {"records": records, "total": len(records), "record_version": hrms_service.EMPLOYEE_RECORD_VERSION}


@router.get("/hrms/log")
async def hrms_log(candidate_id: str | None = None, limit: int = 100, _: dict = Depends(require_admin)):
    return {"entries": await hrms_service.sync_log(candidate_id=candidate_id, limit=limit)}
