import logging
import os
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ASCENDING, DESCENDING
from pinecone import Pinecone as PineconeClient
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
        logger.warning("MongoDB unavailable — offline mode: %s", e)
        _db = None
        return

    _initialized = True

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


def get_db():
    return _db


def get_pinecone():
    return _pinecone_index


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
    await _db.candidates.create_index([("phone_normalized", ASCENDING)], sparse=True)
    await _db.candidates.create_index([("linkedin_normalized", ASCENDING)], sparse=True)
    await _db.candidate_profiles.create_index([("profile_id", ASCENDING)], unique=True)
    await _db.candidate_profiles.create_index([("email", ASCENDING)], unique=True)
    await _db[settings.MARKETPLACE_COLLECTION].create_index([("profile_id", ASCENDING)], unique=True)
    await _db[settings.MARKETPLACE_COLLECTION].create_index([("job_id", ASCENDING)])
    await _db[settings.MARKETPLACE_COLLECTION].create_index([("is_hired", ASCENDING)])
    await _db.rate_limits.create_index([("expires_at", ASCENDING)], expireAfterSeconds=0)
    await _db.email_log.create_index([("created_at", DESCENDING)])
    await _db.email_log.create_index([("candidate_id", ASCENDING)])
    await _db.departments.create_index([("name", ASCENDING)], unique=True)
    await _db.designations.create_index([("name", ASCENDING)], unique=True)
    await _db.scenarios.create_index([("scenario_id", ASCENDING)], unique=True)
    await _db.offers.create_index([("offer_id", ASCENDING)], unique=True)
    await _db.offers.create_index([("secure_token", ASCENDING)], unique=True, sparse=True)
    await _db.offers.create_index([("candidate_id", ASCENDING)])
    await _db.workflow_rules.create_index([("rule_id", ASCENDING)], unique=True)
    await _db.webhook_subscriptions.create_index([("webhook_id", ASCENDING)], unique=True)
    await _db.sso_states.create_index([("state", ASCENDING)], unique=True)
    await _db.sso_states.create_index([("created_at", ASCENDING)], expireAfterSeconds=600)
    await _db.coding_questions.create_index([("question_id", ASCENDING)], unique=True)
    await _db.coding_submissions.create_index([("submission_id", ASCENDING)], unique=True)
    await _db.coding_submissions.create_index([("candidate_id", ASCENDING)])
    await _db.coding_submissions.create_index([("question_id", ASCENDING)])
    await _db.roles.create_index([("role_name", ASCENDING)], unique=True)
    await _db.audit_log.create_index([("created_at", DESCENDING)])
    await _db.audit_log.create_index([("actor_email", ASCENDING)])
    await _db.saved_filter_templates.create_index([("template_id", ASCENDING)], unique=True)
    await _db.saved_filter_templates.create_index([("created_by", ASCENDING)])
    await _db.email_templates.create_index([("key", ASCENDING)], unique=True)
    await _db.prompt_templates.create_index([("key", ASCENDING)], unique=True)


async def _load_runtime_settings():
    if _db is None:
        return
    model_doc = await _db.settings.find_one({"key": "default_llm_model"})
    if model_doc and model_doc.get("value"):
        settings.DEFAULT_LLM_MODEL = model_doc["value"]
        logger.info("Default LLM model loaded from database: %s", settings.DEFAULT_LLM_MODEL)


async def _seed_superadmin():
    """Create the default superadmin once without resetting edited passwords."""
    if _db is None:
        return
    from passlib.context import CryptContext

    pwd_ctx = CryptContext(schemes=["bcrypt"])
    existing = await _db.users.find_one({"email": settings.DEFAULT_SUPERADMIN_EMAIL})
    if existing:
        await _db.users.update_one(
            {"email": settings.DEFAULT_SUPERADMIN_EMAIL},
            {"$set": {
                "name": existing.get("name") or "Super Admin",
                "role": "superadmin",
                "otp_required": existing.get("otp_required", False),
                "is_active": True,
            }},
        )
        logger.info("Superadmin verified")
        return

    await _db.users.insert_one({
        "name": "Super Admin",
        "email": settings.DEFAULT_SUPERADMIN_EMAIL,
        "password_hash": pwd_ctx.hash(settings.DEFAULT_SUPERADMIN_PASSWORD),
        "role": "superadmin",
        "otp_required": False,
        "is_active": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    logger.info("Superadmin created")
