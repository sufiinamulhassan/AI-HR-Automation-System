import logging
import os
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ASCENDING, DESCENDING
from pymongo.errors import OperationFailure
from pinecone import Pinecone as PineconeClient
from config import tenancy
from config.settings import settings

logger = logging.getLogger(__name__)

_mongo_client: AsyncIOMotorClient | None = None
_db = None
_pinecone_index = None
_initialized = False

_IN_SERVERLESS = bool(
    os.environ.get("AWS_LAMBDA_FUNCTION_NAME")
    or os.environ.get("VERCEL")
)


async def init_db():
    global _mongo_client, _db, _pinecone_index, _initialized
    if _initialized:
        return
    try:
        _mongo_client = AsyncIOMotorClient(
            settings.MONGODB_URI,
            serverSelectionTimeoutMS=5000,
            connectTimeoutMS=5000,
            socketTimeoutMS=15000,
        )
        await _mongo_client.admin.command("ping")
        _db = _mongo_client[settings.MONGODB_DB]
        logger.info("MongoDB connected: %s", settings.MONGODB_DB)
    except Exception as e:
        logger.warning("MongoDB unavailable: offline mode: %s", e)
        _db = None
        return

    _initialized = True

    try:
        from config.tenancy_migration import migrate
        await migrate(_db, owner_email=settings.DEFAULT_SUPERADMIN_EMAIL)
    except Exception as e:
        logger.error("Tenancy migration failed: %s", e)

    try:
        await _create_indexes()
    except Exception as e:
        logger.warning("Index build warning (non-fatal): %s", e)

    try:
        if settings.PINECONE_API_KEY:
            pc = PineconeClient(api_key=settings.PINECONE_API_KEY)
            _pinecone_index = pc.Index(settings.PINECONE_INDEX_NAME)
            logger.info("Pinecone connected: %s", settings.PINECONE_INDEX_NAME)
    except Exception as e:
        logger.warning("Pinecone unavailable: %s", e)
        _pinecone_index = None

    await _load_runtime_settings()
    await _seed_superadmin()


async def close_db():
    global _initialized
    if _IN_SERVERLESS:
        return
    if _mongo_client is not None:
        _mongo_client.close()
    _initialized = False


def get_platform_db():
    return _db


def get_db():
    if _db is None:
        return None
    return tenancy.bind_db(_db)


def get_pinecone():
    return _pinecone_index


_LEGACY_GLOBAL_UNIQUE = {
    "candidate_profiles": "email_1", "offer_signatures": "email_1",
    "departments": "name_1", "designations": "name_1", "job_grades": "name_1",
    "roles": "role_name_1", "email_templates": "key_1", "prompt_templates": "key_1",
    "performance_rating_dimensions": "name_1",
}

_COMPANY_INDEXED = (
    "users", "jobs", "resumes", "candidates", "offers", "employees", "coding_submissions",
    "performance_reviews", "email_log", "cost_ledger", "audit_log", "webhook_subscriptions",
    "workflow_rules",
)


async def _unique(collection: str, field: str) -> None:
    legacy = _LEGACY_GLOBAL_UNIQUE.get(collection)
    if legacy:
        try:
            await _db[collection].drop_index(legacy)
        except OperationFailure:
            pass
    await _db[collection].create_index([("company_id", ASCENDING), (field, ASCENDING)], unique=True)


async def _create_indexes():
    if _db is None:
        return
    await _db.users.create_index([("email", ASCENDING)], unique=True)
    await _db.jobs.create_index([("job_id", ASCENDING)], unique=True)
    await _db.jobs.create_index([("created_at", DESCENDING)])
    await _db.resumes.create_index([("resume_id", ASCENDING)], unique=True)
    await _db.resumes.create_index([("file_hash", ASCENDING)])
    await _db.resumes.create_index([("text_hash", ASCENDING)])
    await _db.resumes.create_index([("processing_status", ASCENDING)])
    await _db.resumes.create_index([("candidate_email", ASCENDING)])
    await _db.resume_files.create_index([("resume_id", ASCENDING)], unique=True)
    await _db.candidates.create_index([("candidate_id", ASCENDING)], unique=True)
    await _db.candidates.create_index([("secure_token", ASCENDING)], unique=True, sparse=True)
    await _db.candidates.create_index([("job_id", ASCENDING)])
    await _db.candidates.create_index([("status", ASCENDING), ("invite_expires_at", ASCENDING)])
    await _db.candidates.create_index(
        [("interview_mode", ASCENDING), ("external_interview.scheduled_start_at", ASCENDING)], sparse=True,
    )
    await _db.candidates.create_index([("phone_normalized", ASCENDING)], sparse=True)
    await _db.candidates.create_index([("linkedin_normalized", ASCENDING)], sparse=True)
    await _db.candidate_profiles.create_index([("profile_id", ASCENDING)], unique=True)
    await _unique("candidate_profiles", "email")
    await _db[settings.MARKETPLACE_COLLECTION].create_index([("profile_id", ASCENDING)], unique=True)
    await _db[settings.MARKETPLACE_COLLECTION].create_index([("job_id", ASCENDING)])
    await _db[settings.MARKETPLACE_COLLECTION].create_index([("is_hired", ASCENDING)])
    await _db.rate_limits.create_index([("expires_at", ASCENDING)], expireAfterSeconds=0)
    await _db.email_log.create_index([("created_at", DESCENDING)])
    await _db.email_log.create_index([("candidate_id", ASCENDING)])
    await _db.email_log.create_index([("status", ASCENDING), ("created_at", DESCENDING)])
    await _db.interviewer_links.create_index([("link_id", ASCENDING)], unique=True)
    await _db.interviewer_links.create_index([("token_hash", ASCENDING)], unique=True)
    await _db.interviewer_links.create_index([("candidate_id", ASCENDING)])
    await _unique("departments", "name")
    await _unique("designations", "name")
    await _unique("job_grades", "name")
    await _db.candidate_demographics.create_index([("candidate_id", ASCENDING)], unique=True)
    await _db.scenarios.create_index([("scenario_id", ASCENDING)], unique=True)
    await _db.offers.create_index([("offer_id", ASCENDING)], unique=True)
    await _db.offers.create_index([("secure_token", ASCENDING)], unique=True, sparse=True)
    await _db.offers.create_index([("candidate_id", ASCENDING)])
    await _db.offers.create_index([("status", ASCENDING), ("sent_at", ASCENDING)])
    await _unique("offer_signatures", "email")
    await _db.applications.create_index([("application_id", ASCENDING)], unique=True)
    await _db.applications.create_index(
        [("company_id", ASCENDING), ("job_id", ASCENDING), ("email_normalized", ASCENDING)], unique=True,
    )
    await _db.applications.create_index([("resume_id", ASCENDING)])
    await _db.jobs.create_index([("is_public", ASCENDING), ("deadline_at", ASCENDING)])
    await _db.contact_requests.create_index([("request_id", ASCENDING)], unique=True)
    await _db.contact_requests.create_index([("status", ASCENDING), ("created_at", ASCENDING)])
    await _db.workflow_rules.create_index([("rule_id", ASCENDING)], unique=True)
    await _db.webhook_subscriptions.create_index([("webhook_id", ASCENDING)], unique=True)
    await _db.sso_states.create_index([("state", ASCENDING)], unique=True)
    await _db.sso_states.create_index([("created_at", ASCENDING)], expireAfterSeconds=600)
    await _db.coding_questions.create_index([("question_id", ASCENDING)], unique=True)
    await _db.coding_submissions.create_index([("submission_id", ASCENDING)], unique=True)
    await _db.coding_submissions.create_index([("candidate_id", ASCENDING)])
    await _db.coding_submissions.create_index([("question_id", ASCENDING)])
    await _db.coding_session_state.create_index(
        [("candidate_id", ASCENDING), ("question_id", ASCENDING)], unique=True,
    )
    await _unique("roles", "role_name")
    await _db.audit_log.create_index([("created_at", DESCENDING)])
    await _db.audit_log.create_index([("actor_email", ASCENDING)])
    await _db.saved_filter_templates.create_index([("template_id", ASCENDING)], unique=True)
    await _db.saved_filter_templates.create_index([("created_by", ASCENDING)])
    await _unique("email_templates", "key")
    await _unique("prompt_templates", "key")

    await _db.employees.create_index([("employee_id", ASCENDING)], unique=True)
    await _db.employees.create_index([("offer_id", ASCENDING)], unique=True, sparse=True)
    await _db.employees.create_index([("candidate_id", ASCENDING)])
    await _db.employees.create_index([("manager_id", ASCENDING)])
    await _db.employees.create_index([("department", ASCENDING)])
    await _db.performance_cycles.create_index([("cycle_id", ASCENDING)], unique=True)
    await _db.performance_reviews.create_index([("review_id", ASCENDING)], unique=True)
    await _db.performance_reviews.create_index([("secure_token", ASCENDING)], unique=True, sparse=True)
    await _db.performance_reviews.create_index([("cycle_id", ASCENDING)])
    await _db.performance_reviews.create_index([("employee_id", ASCENDING)])
    await _db.goals.create_index([("goal_id", ASCENDING)], unique=True)
    await _db.goals.create_index([("owner_id", ASCENDING)])
    await _unique("performance_rating_dimensions", "name")

    await _db.notification_log.create_index([("expires_at", ASCENDING)], expireAfterSeconds=0)
    await _db.webhook_deliveries.create_index([("webhook_id", ASCENDING), ("created_at", DESCENDING)])
    await _db.webhook_deliveries.create_index([("expires_at", ASCENDING)], expireAfterSeconds=0)
    await _db.cron_runs.create_index([("key", ASCENDING), ("started_at", DESCENDING)])

    await _db.report_shares.create_index([("token_hash", ASCENDING)])
    await _db.otp_logs.create_index([("expires_at", ASCENDING)], expireAfterSeconds=86400)
    await _db.otp_logs.create_index([("email", ASCENDING)])
    await _db.password_tokens.create_index([("token_hash", ASCENDING)], unique=True)
    await _db.password_tokens.create_index([("expires_at", ASCENDING)], expireAfterSeconds=0)
    await _db.password_tokens.create_index([("email", ASCENDING)])
    await _db.cron_runs.create_index([("expires_at", ASCENDING)], expireAfterSeconds=0)

    await _db.clients.create_index([("client_id", ASCENDING)], unique=True)
    await _db.clients.create_index([("slug", ASCENDING)], unique=True)
    await _db.companies.create_index([("company_id", ASCENDING)], unique=True)
    await _db.companies.create_index([("slug", ASCENDING)], unique=True)
    await _db.companies.create_index([("client_id", ASCENDING)])
    await _db.companies.create_index(
        [("sso_domains", ASCENDING)], unique=True,
        partialFilterExpression={"sso_domains.0": {"$exists": True}}, name="sso_domains_unique",
    )
    await _db.companies.create_index(
        [("custom_domains", ASCENDING)], unique=True,
        partialFilterExpression={"custom_domains.0": {"$exists": True}}, name="custom_domains_unique",
    )
    for name in _COMPANY_INDEXED:
        await _db[name].create_index([("company_id", ASCENDING)])
    for name in ("jobs", "audit_log", "email_log", "candidates", "resumes"):
        await _db[name].create_index([("company_id", ASCENDING), ("created_at", DESCENDING)])


async def _load_runtime_settings():
    if _db is None:
        return
    model_doc = await _db.settings.find_one({"key": "default_llm_model"})
    if model_doc and model_doc.get("value"):
        settings.DEFAULT_LLM_MODEL = model_doc["value"]
        logger.info("Default LLM model loaded from database: %s", settings.DEFAULT_LLM_MODEL)


async def _seed_superadmin():
    if _db is None:
        return

    if not settings.DEFAULT_SUPERADMIN_PASSWORD:
        logger.warning(
            "DEFAULT_SUPERADMIN_PASSWORD is not set, so no superadmin was "
            "created. Set it and restart to seed the account."
        )
        return

    from passlib.context import CryptContext

    pwd_ctx = CryptContext(schemes=["bcrypt"])
    existing = await _db.users.find_one({"email": settings.DEFAULT_SUPERADMIN_EMAIL})
    if existing and existing.get("company_id") not in (None, tenancy.PLATFORM_COMPANY_ID, tenancy.DEFAULT_COMPANY_ID):
        logger.error(
            "DEFAULT_SUPERADMIN_EMAIL is an account in company %s: not promoted to platform owner",
            existing.get("company_id"),
        )
        return
    if existing:
        update = {
            "name": existing.get("name") or "Super Admin",
            "role": "superadmin",
            "otp_required": existing.get("otp_required", False),
            "is_platform_admin": True,
        }
        if existing.get("is_active") is False:
            others = await _db.users.count_documents({
                "is_platform_admin": True, "is_active": {"$ne": False},
                "email": {"$ne": settings.DEFAULT_SUPERADMIN_EMAIL},
            })
            if others == 0:
                update["is_active"] = True
        if not existing.get("company_id"):
            update["company_id"] = tenancy.PLATFORM_COMPANY_ID
        await _db.users.update_one({"email": settings.DEFAULT_SUPERADMIN_EMAIL}, {"$set": update})
        logger.info("Superadmin verified")
        return

    await _db.users.insert_one({
        "name": "Super Admin",
        "email": settings.DEFAULT_SUPERADMIN_EMAIL,
        "password_hash": pwd_ctx.hash(settings.DEFAULT_SUPERADMIN_PASSWORD),
        "role": "superadmin",
        "otp_required": False,
        "is_active": True,
        "is_platform_admin": True,
        "company_id": tenancy.PLATFORM_COMPANY_ID,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    logger.info("Superadmin created")
