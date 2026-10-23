import logging
import re
import sys
from contextlib import asynccontextmanager
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent / ".env")

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.docs import get_swagger_ui_html, get_redoc_html
from fastapi.responses import HTMLResponse, JSONResponse

from config.database import init_db, close_db
from routes import oidc, company_sso
from routes import billing
from routes import data_governance
from routes import company_mail, company_integrations, platform_domains
from routes import model_tasks
from routes import hrms
from config.tenancy import TenantScopeMiddleware
from config.settings import settings, validate_runtime_config, validate_security_config
from routes import auth, jobs, resumes, candidates, interview, intel, admin_config, scenarios, offers, analytics, workflows, webhooks, sso, coding, rbac, saved_filters, company_settings, email_templates_admin, prompt_config, branding, notification_settings, integrations, user_guide, performance, security_policies, email_delivery, interviewer_scorecard, attention, cron, system, platform, careers, site, platform_inbox, platform_mail

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

validate_security_config()


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting %s v%s", settings.APP_NAME, settings.APP_VERSION)

    for warning in validate_runtime_config():
        if settings.DEBUG:
            logger.warning("Config: %s", warning)
        else:
            logger.error("Config: %s", warning)

    await init_db()
    from services.hr_module.scheduler import start_scheduler
    start_scheduler()
    yield
    await close_db()
    logger.info("Shutdown complete")


_EXPOSE_API_DOCS = bool(settings.DEBUG or settings.EXPOSE_API_DOCS)

app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="AI-powered HR platform",
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
    openapi_url="/api/openapi.json" if _EXPOSE_API_DOCS else None,
    redirect_slashes=False,
)


_CDN = "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5"

if _EXPOSE_API_DOCS:
    @app.get("/api/docs", include_in_schema=False, response_class=HTMLResponse)
    async def swagger_ui():
        return get_swagger_ui_html(
            openapi_url="/api/openapi.json",
            title=f"{settings.APP_NAME} Swagger UI",
            swagger_js_url=f"{_CDN}/swagger-ui-bundle.js",
            swagger_css_url=f"{_CDN}/swagger-ui.css",
            oauth2_redirect_url="/api/docs/oauth2-redirect",
            swagger_ui_parameters={"persistAuthorization": True},
        )

    @app.get("/api/redoc", include_in_schema=False, response_class=HTMLResponse)
    async def redoc_ui():
        return get_redoc_html(
            openapi_url="/api/openapi.json",
            title=f"{settings.APP_NAME} ReDoc",
        )

cors_settings = {
    "allow_origins": settings.ALLOWED_ORIGINS,
    "allow_credentials": True,
    "allow_methods": ["*"],
    "allow_headers": ["*"],
}
if settings.ALLOWED_ORIGIN_REGEX:
    cors_settings["allow_origin_regex"] = settings.ALLOWED_ORIGIN_REGEX
elif settings.ALLOW_NGROK_ORIGINS or settings.DEBUG:
    cors_settings["allow_origin_regex"] = (
    r"https?://.*\.(ngrok\.io|ngrok-free\.app|ngrok-free\.dev)$"
)


_DEMO_BLOCKED_PATH_SUFFIXES = (
    "/purge",
    "/purge-expired",
    "/batches/clear",
    "/admin/reset-password",
    "/decision",
    "/send-email",
    "/resend-invite",
    "/regenerate-token",
    "/withdraw",
)

_DEMO_BLOCKED_PATH_PATTERNS = (
    re.compile(r"/jobs/[^/]+/pipeline/[^/]+/?$"),
    re.compile(r"/offers/[^/]+/send/?$"),
)


_DEMO_SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})

_DEMO_SIGN_IN_PATHS = (
    "/api/v1/auth/token",
    "/api/v1/auth/login",
    "/api/v1/auth/verify-otp",
    "/api/v1/auth/forgot-password",
    "/api/v1/auth/reset-password",
)


def _is_demo_blocked(method: str, path: str) -> bool:
    if method == "DELETE":
        return True
    if path.endswith(_DEMO_BLOCKED_PATH_SUFFIXES):
        return True
    return any(p.search(path) for p in _DEMO_BLOCKED_PATH_PATTERNS)


def _is_demo_read_only_blocked(method: str, path: str) -> bool:
    if method in _DEMO_SAFE_METHODS:
        return False
    return path.rstrip("/") not in _DEMO_SIGN_IN_PATHS


@app.middleware("http")
async def block_demo_account_deletes(request: Request, call_next):
    auth_header = request.headers.get("authorization", "")
    token = auth_header[7:] if auth_header.lower().startswith("bearer ") else ""
    is_demo_token = settings.ALLOW_DEMO_AUTH and token.startswith("demo-")
    path = request.url.path
    blocked = is_demo_token and (
        (settings.HACKATHON_DEMO_MODE and _is_demo_blocked(request.method, path))
        or (bool(settings.DEMO_COMPANY_ID.strip()) and _is_demo_read_only_blocked(request.method, path))
    )
    if blocked:
        return JSONResponse({
            "message": "Demo mode: this action was simulated and nothing was changed.",
            "demo": True,
            "deleted": 0,
            "deleted_count": 0,
            "modified_count": 0,
            "success": True,
        })
    return await call_next(request)


app.add_middleware(CORSMiddleware, **cors_settings)
app.add_middleware(TenantScopeMiddleware)

app.include_router(auth.router,       prefix="/api/v1/auth",       tags=["hr_module · Auth"])
app.include_router(jobs.router,       prefix="/api/v1/jobs",       tags=["hr_module · Jobs"])
app.include_router(resumes.router,    prefix="/api/v1/resumes",    tags=["hr_module · Resumes"])
app.include_router(data_governance.router, prefix="/api/v1", tags=["hr_module · Data Governance"])
app.include_router(candidates.router, prefix="/api/v1/candidates", tags=["hr_module · Candidates"])
app.include_router(interview.router,  prefix="/api/v1/interview",  tags=["hr_module · Interview"])
app.include_router(intel.router,      prefix="/api/v1/intel",      tags=["hr_module · Intel"])
app.include_router(admin_config.router, prefix="/api/v1/admin",    tags=["hr_module · Admin Config"])
app.include_router(scenarios.router,  prefix="/api/v1/scenarios",  tags=["hr_module · Scenarios"])
app.include_router(offers.router,     prefix="/api/v1/offers",     tags=["hr_module · Offers"])
app.include_router(analytics.router,  prefix="/api/v1/analytics",  tags=["hr_module · Analytics"])
app.include_router(workflows.router,  prefix="/api/v1/workflows",  tags=["hr_module · Workflows"])
app.include_router(webhooks.router,   prefix="/api/v1/webhooks",   tags=["hr_module · Webhooks"])
app.include_router(sso.router,        prefix="/api/v1/sso",        tags=["hr_module · SSO"])
app.include_router(oidc.router,       prefix="/api/v1/sso/oidc",   tags=["hr_module · SSO"])
app.include_router(company_sso.router, prefix="/api/v1/company-settings/sso", tags=["hr_module · Company Settings"])
app.include_router(integrations.router, prefix="/api/v1/integrations", tags=["hr_module · Integrations"])
app.include_router(coding.router,     prefix="/api/v1/coding",     tags=["hr_module · Coding Assessment"])
app.include_router(rbac.router,       prefix="/api/v1/rbac",       tags=["hr_module · RBAC"])
app.include_router(saved_filters.router, prefix="/api/v1/saved-filters", tags=["hr_module · Saved Filters"])
app.include_router(company_settings.router, prefix="/api/v1/company-settings", tags=["hr_module · Company Settings"])
app.include_router(email_templates_admin.router, prefix="/api/v1/email-templates", tags=["hr_module · Email Templates"])
app.include_router(prompt_config.router, prefix="/api/v1/prompt-config", tags=["hr_module · Prompt Config"])
app.include_router(branding.router,   prefix="/api/v1/branding",   tags=["hr_module · Branding"])
app.include_router(notification_settings.router, prefix="/api/v1/notification-settings", tags=["hr_module · Notification Settings"])
app.include_router(user_guide.router, prefix="/api/v1/user-guide", tags=["hr_module · User Guide"])
app.include_router(performance.router, prefix="/api/v1/performance", tags=["hr_module · Performance"])
app.include_router(hrms.router, prefix="/api/v1/hrms", tags=["hr_module · HRMS"])
app.include_router(security_policies.router, prefix="/api/v1/security-policies", tags=["hr_module · Security Policies"])
app.include_router(email_delivery.router, prefix="/api/v1/email-delivery", tags=["hr_module · Email Delivery"])
app.include_router(interviewer_scorecard.router, prefix="/api/v1/interviewer-scorecard", tags=["hr_module · Interviewer Scorecard"])
app.include_router(cron.router, prefix="/api/v1/cron", tags=["hr_module · Scheduled Jobs"])
app.include_router(system.router, prefix="/api/v1/system", tags=["hr_module · System"])
app.include_router(attention.router, prefix="/api/v1/attention", tags=["hr_module · Attention"])
app.include_router(platform.router, prefix="/api/v1/platform", tags=["hr_module · Platform"])
app.include_router(platform_domains.router, prefix="/api/v1/platform", tags=["hr_module · Platform"])
app.include_router(company_mail.router, prefix="/api/v1/company-settings/mail", tags=["hr_module · Company Mail"])
app.include_router(company_integrations.router, prefix="/api/v1/company-settings/integrations", tags=["hr_module · Company Integrations"])
app.include_router(billing.router, prefix="/api/v1/billing", tags=["hr_module · Billing"])
app.include_router(model_tasks.router, prefix="/api/v1/model-tasks", tags=["hr_module · Model Tasks"])
app.include_router(careers.router, prefix="/api/v1/careers", tags=["hr_module · Careers"])
app.include_router(site.router, prefix="/api/v1/site", tags=["hr_module · Site"])
app.include_router(platform_inbox.router, prefix="/api/v1/platform", tags=["hr_module · Platform"])
app.include_router(platform_mail.router, prefix="/api/v1/platform", tags=["hr_module · Platform"])

@app.get("/health", tags=["system"])
async def health():
    return {
        "status": "ok",
        "version": settings.APP_VERSION,
        "modules": ["hr_module"],
    }


@app.get("/health/ready", tags=["system"])
async def health_ready():
    from services.hr_module.platform_service import database_ping

    if not (await database_ping())["ok"]:
        return JSONResponse(status_code=503, content={"status": "unavailable"})
    return {"status": "ready"}
