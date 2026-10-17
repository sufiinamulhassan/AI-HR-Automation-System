from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile
from pydantic import BaseModel

from config.database import get_db
from config.tenancy import current_company_id
from shared.auth import get_optional_user, require_admin
from shared.rate_limit import public_token_throttle
from shared.tenant_deps import (
    TOKEN_KINDS, bind_company_for_host, bind_company_for_id, bind_company_for_slug, bind_company_for_token,
    custom_host_candidate,
)
from services.hr_module.audit_service import log_audit_event
from services.hr_module.branding_service import (
    MAX_LOGO_BYTES,
    clear_logo,
    get_branding_settings,
    get_public_branding,
    is_uploaded_logo_url,
    load_logo,
    sniff_logo_type,
    store_logo,
    update_branding_settings,
)
from services.hr_module.url_safety import UnsafeUrlError, assert_public_https_url

router = APIRouter()


class BrandingUpdate(BaseModel):
    company_logo_url: str | None = None
    primary_color: str | None = None
    accent_color: str | None = None
    letterhead_header_text: str | None = None
    letterhead_footer_text: str | None = None


_lookup_throttle = public_token_throttle("branding", ip_limit=60, param=None)


async def _resolve_public_company(
    request: Request, user: dict | None, company: str | None, kind: str | None, token: str | None,
) -> bool:
    if user is not None:
        return True
    counted = False
    if company or (kind and token):
        await _lookup_throttle(request)
        counted = True
        if company and await bind_company_for_slug(company):
            return True
        if kind in TOKEN_KINDS and token and await bind_company_for_token(kind, token):
            return True
    if custom_host_candidate(request):
        if not counted:
            await _lookup_throttle(request)
        return await bind_company_for_host(request)
    return False


@router.get("/public")
async def get_public_branding_route(
    request: Request,
    company: str | None = None,
    kind: str | None = None,
    token: str | None = None,
    user: dict | None = Depends(get_optional_user),
):
    resolved = await _resolve_public_company(request, user, company, kind, token)
    return await get_public_branding(resolved)


@router.get("")
async def get_branding_route(_: dict = Depends(require_admin)):
    return await get_branding_settings()


@router.patch("")
async def update_branding_route(body: BrandingUpdate, user: dict = Depends(require_admin)):
    changes = body.model_dump(exclude_unset=True)
    logo = changes.get("company_logo_url")
    if logo and logo.strip():
        if is_uploaded_logo_url(logo):
            if logo != (await get_branding_settings()).get("company_logo_url"):
                raise HTTPException(400, "Use Upload logo for a logo file, or give a public https address.")
        else:
            try:
                changes["company_logo_url"] = await assert_public_https_url(logo)
            except UnsafeUrlError as exc:
                raise HTTPException(400, str(exc))
    try:
        saved = await update_branding_settings(changes, updated_by=user.get("email"))
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    await log_audit_event(
        get_db(), actor_email=user["email"], actor_role=user.get("role"),
        action="branding_update", resource_type="branding", resource_id="singleton",
        details={k: (v[:200] if isinstance(v, str) else v) for k, v in changes.items()},
    )
    return saved


@router.post("/logo")
async def upload_logo_route(file: UploadFile = File(...), user: dict = Depends(require_admin)):
    data = await file.read(MAX_LOGO_BYTES + 1)
    if not data:
        raise HTTPException(400, "The file is empty.")
    if len(data) > MAX_LOGO_BYTES:
        raise HTTPException(413, "The logo is larger than 1 MB. Use a smaller image.")
    content_type = sniff_logo_type(data)
    if content_type is None:
        raise HTTPException(400, "The logo must be a PNG or JPEG image.")
    try:
        saved = await store_logo(data, content_type, company_id=current_company_id(), updated_by=user.get("email"))
    except RuntimeError:
        raise HTTPException(503, "Database unavailable")
    await log_audit_event(
        get_db(), actor_email=user["email"], actor_role=user.get("role"),
        action="branding_logo_upload", resource_type="branding", resource_id="singleton",
        details={"bytes": len(data), "type": content_type},
    )
    return saved


@router.delete("/logo")
async def delete_logo_route(user: dict = Depends(require_admin)):
    try:
        saved = await clear_logo(updated_by=user.get("email"))
    except RuntimeError:
        raise HTTPException(503, "Database unavailable")
    await log_audit_event(
        get_db(), actor_email=user["email"], actor_role=user.get("role"),
        action="branding_logo_remove", resource_type="branding", resource_id="singleton", details={},
    )
    return saved


_logo_throttle = public_token_throttle("branding_logo", ip_limit=600, param=None)


@router.get("/logo/{company_id}")
async def get_logo_route(company_id: str, request: Request):
    await _logo_throttle(request)
    if not await bind_company_for_id(company_id):
        raise HTTPException(404, "Not found")
    stored = await load_logo()
    if stored is None:
        raise HTTPException(404, "Not found")
    data, content_type, sha = stored
    etag = f'"{sha}"'
    headers = {
        "ETag": etag,
        "Cache-Control": "public, max-age=3600",
        "X-Content-Type-Options": "nosniff",
    }
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    return Response(content=data, media_type=content_type, headers=headers)
