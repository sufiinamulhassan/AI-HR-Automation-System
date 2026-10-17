import asyncio

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

from shared.auth import get_current_user, require_admin, require_permission
from shared.quotas import ai_action
from shared.rate_limit import public_token_throttle
from shared.utils import require_selectable_model
from config.database import get_db
from config.settings import settings
from services.hr_module import department_access, offer_service
from services.hr_module.audit_service import log_audit_event
from services.hr_module.candidate_redaction import redact_offer, redact_offers
from services.hr_module.external_interview_service import InterviewReviewRequired
from services.hr_module.permissions import get_department_scope

router = APIRouter()

_public_throttle = public_token_throttle("offer", ip_limit=120, token_limit=20, tenant="offer")


async def _guard_offer_scope(user: dict, offer_id: str) -> None:
    if await get_department_scope(user) is None:
        return
    await department_access.require_offer_access(get_db(), user, await offer_service.get_offer(offer_id))


class CreateOfferRequest(BaseModel):
    candidate_id: str
    salary: str
    benefits: str | None = None
    joining_date: str | None = None


class DraftLetterRequest(BaseModel):
    model_override: str | None = None


_ALLOWED_SIGNATURE_CONTENT_TYPES = {"image/png", "image/jpeg", "image/jpg"}
_MAX_SIGNATURE_IMAGE_BYTES = 2 * 1024 * 1024


class AcceptOfferRequest(BaseModel):
    typed_name: str = ""
    consent: bool = False


class DeclineOfferRequest(BaseModel):
    reason: str | None = None


@router.post("")
async def create_offer(
    body: CreateOfferRequest,
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("offers:create")),
):
    await department_access.ensure_candidate_in_scope(get_db(), user, body.candidate_id)
    try:
        offer = await offer_service.create_offer(
            candidate_id=body.candidate_id,
            salary=body.salary,
            benefits=body.benefits,
            joining_date=body.joining_date,
            created_by=user["email"],
        )
    except ValueError as exc:
        raise HTTPException(404, str(exc))
    except InterviewReviewRequired as exc:
        raise HTTPException(409, str(exc))

    asyncio.create_task(log_audit_event(
        get_db(), actor_email=user["email"], actor_role=user.get("role"),
        action="offer_create", resource_type="offer", resource_id=offer["offer_id"],
        details={"candidate_id": body.candidate_id, "salary": body.salary},
    ))
    return offer


@router.get("")
async def list_offers(
    candidate_id: str | None = None,
    job_id: str | None = None,
    status: str | None = None,
    user: dict = Depends(get_current_user),
):
    offers = await offer_service.list_offers(candidate_id=candidate_id, job_id=job_id, status=status)
    scope = await get_department_scope(user)
    if scope is not None:
        allowed = set(await department_access.scoped_job_ids(get_db(), scope))
        offers = [o for o in offers if o.get("job_id") in allowed]
    return {"offers": redact_offers(user, offers)}


@router.post("/letterhead-template")
async def upload_letterhead_template(
    file: UploadFile = File(...),
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("offers:manage_letterhead")),
):
    if not (file.filename or "").lower().endswith(".docx"):
        raise HTTPException(400, "Only .docx files are supported for the letterhead template")

    raw = await file.read()
    from services.hr_module.branding_service import get_letterhead_template_preview, set_letterhead_docx_template
    try:
        branding = await set_letterhead_docx_template(raw, file.filename, updated_by=user["email"])
    except ValueError as exc:
        raise HTTPException(400, str(exc))

    asyncio.create_task(log_audit_event(
        get_db(), actor_email=user["email"], actor_role=user.get("role"),
        action="offer_letterhead_template_upload", resource_type="branding",
        resource_id="letterhead_template", details={"filename": file.filename},
    ))
    return get_letterhead_template_preview(branding)


@router.get("/letterhead-template")
async def get_letterhead_template(
    _admin: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("offers:manage_letterhead")),
):
    from services.hr_module.branding_service import get_branding_settings, get_letterhead_template_preview
    branding = await get_branding_settings()
    return get_letterhead_template_preview(branding)


@router.post("/signature")
async def upload_my_signature(
    file: UploadFile = File(...),
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("offers:manage_signature")),
):
    content_type = (file.content_type or "").lower()
    if content_type not in _ALLOWED_SIGNATURE_CONTENT_TYPES:
        raise HTTPException(400, "Signature image must be a PNG or JPEG file")

    raw = await file.read()
    if len(raw) > _MAX_SIGNATURE_IMAGE_BYTES:
        raise HTTPException(400, "Signature image is too large (max 2MB)")

    saved = await offer_service.save_signature_image(
        email=user["email"], raw_bytes=raw, content_type=content_type, filename=file.filename,
    )

    asyncio.create_task(log_audit_event(
        get_db(), actor_email=user["email"], actor_role=user.get("role"),
        action="offer_signature_upload", resource_type="user_signature",
        resource_id=user["email"], details={},
    ))
    return {"email": saved["email"], "content_type": saved["content_type"], "uploaded_at": saved["uploaded_at"]}


@router.get("/signature/me")
async def get_my_signature(
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("offers:manage_signature")),
):
    sig = await offer_service.get_signature_image(user["email"])
    if not sig:
        return {"configured": False}
    return {
        "configured": True,
        "content_type": sig.get("content_type"),
        "uploaded_at": sig.get("uploaded_at"),
        "image_base64": sig.get("image_base64"),
    }


@router.get("/{offer_id}")
async def get_offer(offer_id: str, user: dict = Depends(get_current_user)):
    offer = await offer_service.get_offer(offer_id)
    if not offer:
        raise HTTPException(404, "Offer not found")
    await department_access.require_offer_access(get_db(), user, offer)
    return redact_offer(user, offer)


@router.get("/{offer_id}/pdf")
async def offer_pdf(
    offer_id: str,
    _admin: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("offers:read")),
):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")

    offer = await offer_service.get_offer(offer_id)
    if not offer:
        raise HTTPException(404, "Offer not found")
    await department_access.require_offer_access(db, _admin, offer)

    candidate = await db.candidates.find_one({"candidate_id": offer.get("candidate_id")}) or {}
    job = await db.jobs.find_one({"job_id": offer.get("job_id")}) or {}

    from services.hr_module.branding_service import get_branding_settings
    branding = await get_branding_settings()
    signature_image = await offer_service.resolve_signature_for_offer(db, offer)

    pdf_bytes = await offer_service.render_offer_pdf(
        offer, job, candidate, branding,
        ai_body=offer.get("ai_letter_body"), signature_image=signature_image,
    )
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=offer_{offer_id[:8]}.pdf"},
    )


@router.post("/{offer_id}/draft-letter")
async def draft_offer_letter(
    offer_id: str,
    body: DraftLetterRequest = DraftLetterRequest(),
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("offers:draft_letter")),
    _quota: None = Depends(ai_action("offer_draft", per_hour=300)),
):
    model_override = require_selectable_model(body.model_override)
    await _guard_offer_scope(user, offer_id)
    try:
        updated = await offer_service.generate_offer_letter_body(
            offer_id, model_override=model_override,
        )
    except ValueError as exc:
        if str(exc) == "not_found":
            raise HTTPException(404, "Offer not found")
        raise HTTPException(400, str(exc))
    except RuntimeError as exc:
        raise HTTPException(503, str(exc))

    asyncio.create_task(log_audit_event(
        get_db(), actor_email=user["email"], actor_role=user.get("role"),
        action="offer_draft_letter", resource_type="offer", resource_id=offer_id,
        details={"source": updated.get("ai_letter_source")},
    ))
    return updated


@router.post("/{offer_id}/approve-letter")
async def approve_offer_letter(
    offer_id: str,
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("offers:approve_letter")),
):
    await _guard_offer_scope(user, offer_id)
    try:
        updated = await offer_service.approve_offer_letter(offer_id, approved_by=user["email"])
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except RuntimeError as exc:
        raise HTTPException(503, str(exc))

    asyncio.create_task(log_audit_event(
        get_db(), actor_email=user["email"], actor_role=user.get("role"),
        action="offer_approve_letter", resource_type="offer", resource_id=offer_id,
        details={},
    ))
    return updated


@router.post("/{offer_id}/approve")
async def approve_offer(
    offer_id: str,
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("offers:approve")),
):
    await _guard_offer_scope(user, offer_id)
    try:
        updated = await offer_service.approve_offer(offer_id, approved_by=user["email"])
    except ValueError as exc:
        raise HTTPException(400, str(exc))

    asyncio.create_task(log_audit_event(
        get_db(), actor_email=user["email"], actor_role=user.get("role"),
        action="offer_approve", resource_type="offer", resource_id=offer_id,
        details={},
    ))
    return updated


@router.post("/{offer_id}/send")
async def send_offer(
    offer_id: str,
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("offers:send")),
):
    await _guard_offer_scope(user, offer_id)
    try:
        updated = await offer_service.send_offer(offer_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except RuntimeError as exc:
        raise HTTPException(502, str(exc))

    asyncio.create_task(log_audit_event(
        get_db(), actor_email=user["email"], actor_role=user.get("role"),
        action="offer_send", resource_type="offer", resource_id=offer_id,
        details={},
    ))
    return updated


@router.post("/{offer_id}/withdraw")
async def withdraw_offer(
    offer_id: str,
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("offers:withdraw")),
):
    await _guard_offer_scope(user, offer_id)
    try:
        updated = await offer_service.withdraw_offer(offer_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc))

    asyncio.create_task(log_audit_event(
        get_db(), actor_email=user["email"], actor_role=user.get("role"),
        action="offer_withdraw", resource_type="offer", resource_id=offer_id,
        details={},
    ))
    return updated


@router.get("/public/{secure_token}", dependencies=[Depends(_public_throttle)])
async def get_public_offer(secure_token: str):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    offer = await db.offers.find_one({"secure_token": secure_token}, {"_id": 0})
    if not offer:
        raise HTTPException(404, "Offer not found")
    if offer.get("status") != "sent":
        raise HTTPException(410, "This offer is no longer available to respond to")

    job = await db.jobs.find_one({"job_id": offer.get("job_id")}) or {}
    return {
        "job_title": job.get("title"),
        "company_name": job.get("company_name"),
        "salary": offer.get("salary"),
        "benefits": offer.get("benefits"),
        "joining_date": offer.get("joining_date"),
        "status": offer.get("status"),
    }


def _respond_error(exc: ValueError) -> HTTPException:
    reason = str(exc)
    if reason == "not_found":
        return HTTPException(404, "Offer not found")
    if reason == "typed_name_required":
        return HTTPException(400, "typed_name is required")
    if reason == "consent_required":
        return HTTPException(400, "Consent is required to accept this offer")
    return HTTPException(410, "This offer is no longer available to respond to")


def _client_ip(request: Request) -> str:
    from shared.rate_limit import client_ip

    return client_ip(request)


_PUBLIC_HIDDEN_FIELDS = ("signature", "created_by", "company_id")


def _public_offer_response(offer: dict) -> dict:
    return {k: v for k, v in offer.items() if k not in _PUBLIC_HIDDEN_FIELDS}


@router.post("/public/{secure_token}/accept", dependencies=[Depends(_public_throttle)])
async def accept_offer(secure_token: str, request: Request, body: AcceptOfferRequest = AcceptOfferRequest()):
    typed_name = (body.typed_name or "").strip()
    if not typed_name:
        raise HTTPException(400, "typed_name is required")
    if not body.consent:
        raise HTTPException(400, "Consent is required to accept this offer")

    try:
        updated = await offer_service.respond_to_offer(
            secure_token, accept=True, reason=None,
            typed_name=typed_name, consent=body.consent,
            ip_address=_client_ip(request), user_agent=request.headers.get("user-agent"),
        )
    except ValueError as exc:
        raise _respond_error(exc)
    return _public_offer_response(updated)


@router.post("/public/{secure_token}/decline", dependencies=[Depends(_public_throttle)])
async def decline_offer(secure_token: str, body: DeclineOfferRequest = DeclineOfferRequest()):
    try:
        updated = await offer_service.respond_to_offer(secure_token, accept=False, reason=body.reason)
    except ValueError as exc:
        raise _respond_error(exc)
    return _public_offer_response(updated)
