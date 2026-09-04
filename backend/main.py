"""
Hirely.ai v3.0 — FastAPI entry point

Module:
  hr_module          /api/v1/{auth, jobs, resumes, candidates, interview, intel, …}

Scope note: a talent marketplace, an alumni network and a backup/restore admin
UI are deliberately not part of this product — see README.md.

Agents (LangGraph):
  ResumeAgent        extract → check_duplicate → classify → embed → match_jds → store → auto_invite
  InterviewAgent     prepare: load_context → generate_questions
                     eval:    evaluate → persist_report → send_status_email

Auto-invite:
  Resumes with match score >= AUTO_INVITE_THRESHOLD trigger automatic email invites.
  Admins can also manually invite, resend, or regenerate interview links at any time.
"""
import logging
import sys
from contextlib import asynccontextmanager
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.docs import get_swagger_ui_html, get_redoc_html
from fastapi.responses import HTMLResponse

from config.database import init_db, close_db
from config.settings import settings, validate_runtime_config, validate_security_config
from routes import auth, jobs, resumes, candidates, interview, intel, admin_config, scenarios, offers, analytics, workflows, webhooks, sso, coding, rbac, saved_filters, company_settings, email_templates_admin, prompt_config, branding, notification_settings, integrations, user_guide

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
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


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="AI-powered HR platform — hr_module",
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
    openapi_url="/api/openapi.json",
    redirect_slashes=False,
)


_CDN = "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5"


@app.get("/api/docs", include_in_schema=False, response_class=HTMLResponse)
async def swagger_ui():
    return get_swagger_ui_html(
        openapi_url="/api/openapi.json",
        title=f"{settings.APP_NAME} — Swagger UI",
        swagger_js_url=f"{_CDN}/swagger-ui-bundle.js",
        swagger_css_url=f"{_CDN}/swagger-ui.css",
        oauth2_redirect_url="/api/docs/oauth2-redirect",
        swagger_ui_parameters={"persistAuthorization": True},
    )


@app.get("/api/redoc", include_in_schema=False, response_class=HTMLResponse)
async def redoc_ui():
    return get_redoc_html(
        openapi_url="/api/openapi.json",
        title=f"{settings.APP_NAME} — ReDoc",
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
 

app.add_middleware(CORSMiddleware, **cors_settings)

app.include_router(auth.router,       prefix="/api/v1/auth",       tags=["hr_module · Auth"])
app.include_router(jobs.router,       prefix="/api/v1/jobs",       tags=["hr_module · Jobs"])
app.include_router(resumes.router,    prefix="/api/v1/resumes",    tags=["hr_module · Resumes"])
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

@app.get("/health", tags=["system"])
async def health():
    return {
        "status": "ok",
        "version": settings.APP_VERSION,
        "modules": ["hr_module"],
    }
