from typing import Literal

from email_validator import EmailNotValidError, validate_email
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, EmailStr, Field, field_validator

from services.hr_module import billing_service
from services.hr_module import platform_service as svc
from shared.auth import require_platform_admin

router = APIRouter()


class PlanBody(BaseModel):
    tier: str | None = Field(None, max_length=40)
    name: str | None = Field(None, max_length=60)
    max_companies: int | None = Field(None, ge=1, le=100000)
    max_users_per_company: int | None = Field(None, ge=1, le=1000000)
    monthly_ai_budget_usd: float | None = Field(None, ge=0)
    max_storage_mb: int | None = Field(None, ge=1, le=100000000)
    features: dict[str, bool] | None = None
    price_monthly_usd: float | None = Field(None, ge=0, le=100000000)
    trial_ends_at: str | None = Field(None, max_length=40)


class SubscriptionBody(BaseModel):
    status: Literal["none", "trialing", "active", "past_due", "canceled"]
    trial_ends_at: str | None = Field(None, max_length=40)
    provider: Literal["manual", "stripe"] | None = None


class CheckoutBody(BaseModel):
    tier: str | None = Field(None, max_length=60)


class OwnerBody(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    password: str = Field(min_length=svc.MIN_PASSWORD_LENGTH, max_length=svc.MAX_PASSWORD_BYTES)


class AdminBody(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    password: str | None = Field(None, min_length=svc.MIN_PASSWORD_LENGTH, max_length=svc.MAX_PASSWORD_BYTES)

    @field_validator("password", mode="before")
    @classmethod
    def _empty_means_invite(cls, value):
        return None if isinstance(value, str) and not value.strip() else value


def _contact_email(value: str | None) -> str | None:
    if value is None:
        return None
    text = value.strip().lower()
    if text:
        try:
            validate_email(text, check_deliverability=False)
        except EmailNotValidError:
            raise ValueError("Enter a valid contact email.")
    return text


class CompanyBody(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    slug: str | None = Field(None, max_length=60)
    admin: AdminBody


class ClientCreateBody(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    slug: str | None = Field(None, max_length=60)
    plan: PlanBody | None = None
    contact_name: str = Field("", max_length=120)
    contact_email: str = Field("", max_length=254)
    notes: str = Field("", max_length=2000)
    company: CompanyBody | None = None

    _check_email = field_validator("contact_email")(_contact_email)


class ClientPatchBody(BaseModel):
    name: str | None = Field(None, max_length=120)
    plan: PlanBody | None = None
    contact_name: str | None = Field(None, max_length=120)
    contact_email: str | None = Field(None, max_length=254)
    notes: str | None = Field(None, max_length=2000)

    _check_email = field_validator("contact_email")(_contact_email)


class CompanyPatchBody(BaseModel):
    name: str | None = Field(None, max_length=120)
    sso_domains: list[str] | None = Field(None, max_length=50)


class SuspendBody(BaseModel):
    reason: str | None = Field(None, max_length=500)


class PasswordResetBody(BaseModel):
    new_password: str = Field(min_length=svc.MIN_PASSWORD_LENGTH, max_length=svc.MAX_PASSWORD_BYTES)


class OwnerPatchBody(BaseModel):
    is_active: bool


class DeleteBody(BaseModel):
    confirm_slug: str = Field(min_length=1, max_length=120)


def usage_period(window: int | None = Query(None), month: str | None = Query(None)) -> svc.Period:
    try:
        return svc.resolve_period(window, month)
    except svc.PlatformError as exc:
        raise HTTPException(exc.status, exc.message)


async def _run(work):
    try:
        return await work
    except svc.PlatformError as exc:
        raise HTTPException(exc.status, exc.message)


def _admin_dict(admin: AdminBody) -> dict:
    return {"name": admin.name, "email": str(admin.email), "password": admin.password}


def _company_dict(company: CompanyBody) -> dict:
    return {"name": company.name, "slug": company.slug, "admin": _admin_dict(company.admin)}


@router.get("/overview")
async def get_overview(
    period: svc.Period = Depends(usage_period), refresh: bool = Query(False),
    _: dict = Depends(require_platform_admin),
):
    return await _run(svc.cached_view("overview", svc.period_params(period), refresh, lambda: svc.overview(period)))


@router.get("/usage")
async def get_usage(
    period: svc.Period = Depends(usage_period), refresh: bool = Query(False),
    _: dict = Depends(require_platform_admin),
):
    return await _run(svc.cached_view("usage", svc.period_params(period), refresh, lambda: svc.usage_matrix(period)))


@router.get("/ai")
async def get_ai(
    period: svc.Period = Depends(usage_period), refresh: bool = Query(False),
    _: dict = Depends(require_platform_admin),
):
    return await _run(svc.cached_view("ai", svc.period_params(period), refresh, lambda: svc.ai_models(period)))


@router.get("/plans")
async def get_plans(_: dict = Depends(require_platform_admin)):
    return svc.list_plans()


@router.get("/billing/statement")
async def get_statement(
    client_id: str | None = Query(None, max_length=64),
    month: str | None = Query(None, max_length=7),
    format: Literal["json", "csv"] = "json",
    _: dict = Depends(require_platform_admin),
):
    data = await _run(billing_service.statement(client_id, month))
    if format == "csv":
        return Response(
            content=billing_service.statement_csv(data), media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="statement-{data["month"]}.csv"'},
        )
    return data


@router.get("/health")
async def get_health(_: dict = Depends(require_platform_admin)):
    return await _run(svc.health())


@router.get("/audit")
async def get_audit(
    limit: int = Query(svc.AUDIT_PAGE_DEFAULT, ge=1, le=svc.AUDIT_PAGE_MAX),
    before: str | None = Query(None, max_length=64),
    _: dict = Depends(require_platform_admin),
):
    return await _run(svc.audit_page(limit, before))


@router.get("/clients")
async def list_clients(
    search: str | None = Query(None, max_length=100),
    status: Literal["active", "suspended"] | None = None,
    refresh: bool = Query(False),
    _: dict = Depends(require_platform_admin),
):
    return await _run(svc.cached_view(
        "clients", {"search": search, "status": status}, refresh,
        lambda: svc.list_clients(search=search, status=status),
    ))


@router.post("/clients", status_code=201)
async def create_client(body: ClientCreateBody, user: dict = Depends(require_platform_admin)):
    return await _run(svc.create_client(
        user, name=body.name, slug=body.slug,
        plan=body.plan.model_dump(exclude_unset=True) if body.plan else None,
        contact_name=body.contact_name, contact_email=body.contact_email, notes=body.notes,
        company=_company_dict(body.company) if body.company else None,
    ))


@router.get("/clients/{client_id}")
async def get_client(
    client_id: str, period: svc.Period = Depends(usage_period), refresh: bool = Query(False),
    _: dict = Depends(require_platform_admin),
):
    return await _run(svc.cached_view(
        "client", {"client_id": client_id, **svc.period_params(period)}, refresh,
        lambda: svc.client_detail(client_id, period),
    ))


@router.patch("/clients/{client_id}")
async def update_client(client_id: str, body: ClientPatchBody, user: dict = Depends(require_platform_admin)):
    changes = {key: getattr(body, key) for key in body.model_fields_set if key != "plan"}
    if "plan" in body.model_fields_set and body.plan is not None:
        changes["plan"] = body.plan.model_dump(exclude_unset=True)
    return await _run(svc.update_client(user, client_id, changes))


@router.patch("/clients/{client_id}/subscription")
async def set_client_subscription(
    client_id: str, body: SubscriptionBody, user: dict = Depends(require_platform_admin),
):
    return await _run(billing_service.set_subscription(user, client_id, body.model_dump(exclude_unset=True)))


@router.post("/clients/{client_id}/billing/checkout")
async def start_checkout(
    client_id: str, body: CheckoutBody | None = None, user: dict = Depends(require_platform_admin),
):
    return await _run(billing_service.create_checkout(user, client_id, body.tier if body else None))


@router.post("/clients/{client_id}/billing/portal")
async def open_portal(client_id: str, user: dict = Depends(require_platform_admin)):
    return await _run(billing_service.create_portal(user, client_id))


@router.delete("/clients/{client_id}")
async def delete_client(client_id: str, body: DeleteBody, user: dict = Depends(require_platform_admin)):
    return await _run(svc.delete_client(user, client_id, body.confirm_slug))


@router.post("/clients/{client_id}/suspend")
async def suspend_client(
    client_id: str, body: SuspendBody | None = None, user: dict = Depends(require_platform_admin),
):
    return await _run(svc.set_client_status(user, client_id, "suspended", body.reason if body else None))


@router.post("/clients/{client_id}/activate")
async def activate_client(client_id: str, user: dict = Depends(require_platform_admin)):
    return await _run(svc.set_client_status(user, client_id, "active"))


@router.post("/clients/{client_id}/companies", status_code=201)
async def add_company(client_id: str, body: CompanyBody, user: dict = Depends(require_platform_admin)):
    return await _run(svc.add_company(
        user, client_id, name=body.name, slug=body.slug, admin=_admin_dict(body.admin),
    ))


@router.get("/companies")
async def list_companies(
    client_id: str | None = Query(None, max_length=64),
    search: str | None = Query(None, max_length=100),
    status: Literal["active", "suspended"] | None = None,
    refresh: bool = Query(False),
    _: dict = Depends(require_platform_admin),
):
    return await _run(svc.cached_view(
        "companies", {"client_id": client_id, "search": search, "status": status}, refresh,
        lambda: svc.list_companies(client_id=client_id, search=search, status=status),
    ))


@router.get("/companies/{company_id}")
async def get_company(
    company_id: str, period: svc.Period = Depends(usage_period), refresh: bool = Query(False),
    _: dict = Depends(require_platform_admin),
):
    return await _run(svc.cached_view(
        "company", {"company_id": company_id, **svc.period_params(period)}, refresh,
        lambda: svc.company_detail(company_id, period),
    ))


@router.patch("/companies/{company_id}")
async def update_company(company_id: str, body: CompanyPatchBody, user: dict = Depends(require_platform_admin)):
    changes = {key: getattr(body, key) for key in body.model_fields_set}
    return await _run(svc.update_company(user, company_id, changes))


@router.delete("/companies/{company_id}")
async def delete_company(company_id: str, body: DeleteBody, user: dict = Depends(require_platform_admin)):
    return await _run(svc.delete_company(user, company_id, body.confirm_slug))


@router.post("/companies/{company_id}/suspend")
async def suspend_company(
    company_id: str, body: SuspendBody | None = None, user: dict = Depends(require_platform_admin),
):
    return await _run(svc.set_company_status(user, company_id, "suspended", body.reason if body else None))


@router.post("/companies/{company_id}/activate")
async def activate_company(company_id: str, user: dict = Depends(require_platform_admin)):
    return await _run(svc.set_company_status(user, company_id, "active"))


@router.post("/companies/{company_id}/admins", status_code=201)
async def add_company_admin(company_id: str, body: AdminBody, user: dict = Depends(require_platform_admin)):
    return await _run(svc.add_company_admin(
        user, company_id, name=body.name, email=str(body.email), password=body.password,
    ))


@router.post("/companies/{company_id}/admins/{email}/reset-password")
async def reset_company_admin_password(
    company_id: str, email: str, body: PasswordResetBody, user: dict = Depends(require_platform_admin),
):
    return await _run(svc.reset_admin_password(user, company_id, email, body.new_password))


@router.get("/owners")
async def list_owners(_: dict = Depends(require_platform_admin)):
    return await _run(svc.list_owners())


@router.post("/owners", status_code=201)
async def create_owner(body: OwnerBody, user: dict = Depends(require_platform_admin)):
    return await _run(svc.create_owner(user, name=body.name, email=str(body.email), password=body.password))


@router.patch("/owners/{email}")
async def update_owner(email: str, body: OwnerPatchBody, user: dict = Depends(require_platform_admin)):
    return await _run(svc.set_owner_active(user, email, body.is_active))
