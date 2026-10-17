from pathlib import Path

from pydantic_settings import BaseSettings
from pydantic import Field, AliasChoices
from typing import List

_ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


class Settings(BaseSettings):
    APP_NAME: str = "Hirely.ai"
    APP_VERSION: str = "3.0.0"
    DEBUG: bool = False
    ALLOWED_ORIGINS: List[str] = ["http://localhost:5173", "http://localhost:3000", "http://localhost:8000"]
    ALLOWED_ORIGIN_REGEX: str = ""
    ALLOW_NGROK_ORIGINS: bool = False

    SECRET_KEY: str = Field(default="change-me-in-production-32-chars-min")
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24
    ALLOW_DEMO_AUTH: bool = Field(default=False)
    HACKATHON_DEMO_MODE: bool = Field(default=False)
    DEMO_COMPANY_ID: str = Field(default="")
    STRICT_SECURITY_VALIDATION: bool = Field(default=False)
    LOGIN_RATE_LIMIT: int = 10
    LOGIN_RATE_LIMIT_WINDOW_SECONDS: int = 300
    OTP_VERIFY_RATE_LIMIT: int = 8
    OTP_VERIFY_RATE_LIMIT_WINDOW_SECONDS: int = 600
    OTP_MAX_ATTEMPTS: int = 5

    MONGODB_URI: str = Field(default="mongodb://localhost:27017")
    MONGODB_DB: str = "hr_bot"
    MONGODB_TEST_URI: str = Field(default="", validation_alias=AliasChoices("MONGODB_TEST_URI", "MONGODB_URI_TEST"))
    MONGODB_TEST: str = Field(default="hr_bot_test", validation_alias=AliasChoices("MONGODB_TEST", "MONGODB_DB_TEST"))

    PINECONE_API_KEY: str = Field(default="")
    PINECONE_INDEX_NAME: str = "hr-bot"
    PINECONE_ENV: str = "us-east-1"
    PINECONE_API_KEY_TEST: str = Field(default="")
    PINECONE_INDEX_NAME_TEST: str = Field(default="hr-bot-test")
    PINECONE_ENV_TEST: str = Field(default="us-east-1")

    DEFAULT_LLM_MODEL: str = Field(default="gpt-4o")
    RESUME_CLASSIFICATION_MODEL: str = Field(default="gpt-4o-mini")
    LLM_EFFORT: str = Field(default="low")
    RESUME_EMBEDDING_MODEL: str = Field(default="text-embedding-3-small")
    EMBEDDING_DIMENSIONS: int = 1536

    OPENAI_API_KEY: str = Field(default="")

    ANTHROPIC_API_KEY: str = Field(default="")

    LINKEDIN_API_KEY: str = Field(default="")
    INDEED_API_KEY: str = Field(default="")
    JOB_IMPORT_SYNC_INTERVAL_HOURS: int = 6

    CRON_SECRET: str = Field(default="")

    OTP_EXPIRE_MINUTES: int = 10

    EMAIL_HOST: str = Field(default="")
    EMAIL_PORT: int = 587
    EMAIL_USERNAME: str = Field(default="")
    EMAIL_PASSWORD: str = Field(default="")
    EMAIL_FROM: str = Field(default="hr@company.com")
    EMAIL_FROM_NAME: str = "HR Platform"
    EMAIL_USE_TLS: bool = True
    EMAIL_ESTIMATED_COST_PER_EMAIL: float = Field(default=0.0001)

    FRONTEND_URL: str = Field(default="http://localhost:5173")
    CLIENT_IP_HEADER: str = Field(default="")
    EXPOSE_API_DOCS: bool = Field(default=False)
    SECRETS_ENCRYPTION_KEY: str = Field(default="")
    SECRETS_ENCRYPTION_KEY_PREVIOUS: str = Field(default="")
    STRIPE_SECRET_KEY: str = Field(default="")
    STRIPE_WEBHOOK_SECRET: str = Field(default="")
    STRIPE_PRICE_IDS: str = Field(default="")
    PLATFORM_ALERT_EMAILS: str = Field(default="")
    TERMS_URL: str = Field(default="")
    PRIVACY_URL: str = Field(default="")
    CODING_LINK_GRACE_DAYS: int = Field(default=30)
    CAREERS_MAX_RESUME_MB: int = Field(default=4)
    CAREERS_APPLICATIONS_PER_HOUR: int = Field(default=120)
    CAREERS_CACHE_SECONDS: int = Field(default=30)

    MAX_BULK_UPLOAD_FILES: int = 500
    RESUME_SIMILARITY_THRESHOLD: float = 0.35
    SKILLS_WEIGHT: float = 0.5
    CROSS_DOMAIN_SIMILARITY_THRESHOLD: float = 0.55
    RESUME_TOP_N_MATCHES_PER_JD: int = 20
    RESUME_PROCESSING_VERSION: str = "v1.0"
    RESUME_ENRICH_MAX_CHARS: int = 16000

    AUTO_INVITE_THRESHOLD: float = 0.70
    AUTO_INVITE_ENABLED: bool = False
    INVITE_LINK_EXPIRY_DAYS: int = 7

    REPORT_SHARE_EXPIRY_DAYS: int = 7
    REPORT_SHARE_MIN_EXPIRY_DAYS: int = 1
    REPORT_SHARE_MAX_EXPIRY_DAYS: int = 30

    DEFAULT_JD_OPEN_DAYS: int = 30

    INTERVIEW_DURATION_MINUTES: int = 30
    INTERVIEW_QUESTION_COUNT: int = 15
    INTERVIEW_GUIDE_QUESTION_COUNT: int = 10

    SCORE_DIMENSION_WEIGHTS: dict[str, float] = Field(default_factory=lambda: {
        "technical": 0.30,
        "communication": 0.20,
        "problem_solving": 0.25,
        "cultural_fit": 0.15,
        "confidence": 0.10,
    })
    INTEGRITY_MULTIPLIER_FLOOR: float = 0.6

    TTS_MODEL: str = Field(default="gpt-4o-mini-tts")
    TTS_VOICE: str = Field(default="alloy")
    STT_MODEL: str = Field(default="whisper-1")
    MAX_TTS_INPUT_CHARS: int = 1500
    MAX_ANSWER_AUDIO_MB: int = 5
    MAX_ANSWER_SECONDS: int = 180

    MARKETPLACE_COLLECTION: str = "marketplace_module"

    AWS_SES_ENABLED: bool = False
    AWS_SES_REGION: str = Field(default="")

    DEFAULT_SUPERADMIN_EMAIL: str = "superadmin@hirely.ai"
    DEFAULT_SUPERADMIN_PASSWORD: str = Field(default="")

    CODE_SANDBOX_PROVIDER: str = Field(default="judge0")
    JUDGE0_API_URL: str = Field(default="")
    JUDGE0_API_KEY: str = Field(default="")
    JUDGE0_API_HOST: str = Field(default="")
    PISTON_API_URL: str = Field(default="")
    PISTON_API_KEY: str = Field(default="")
    CODE_EVAL_MODEL: str = Field(default="gpt-4o")
    CODE_CORRECTNESS_MODEL: str = Field(default="gpt-4o")
    CODE_MAX_STDERR_CHARS: int = Field(default=2000)
    CODE_TYPING_RATIO_FLAG_THRESHOLD: float = Field(default=0.5)
    PLAGIARISM_SIMILARITY_THRESHOLD: float = 0.80
    PLAGIARISM_KGRAM_SIZE: int = 5
    PLAGIARISM_MAX_COMPARISONS: int = 300
    PLAGIARISM_MIN_KGRAMS: int = 12

    GOOGLE_OAUTH_CLIENT_ID: str = Field(default="")
    GOOGLE_OAUTH_CLIENT_SECRET: str = Field(default="")
    GOOGLE_OAUTH_REDIRECT_URI: str = Field(default="")
    SSO_ALLOWED_EMAIL_DOMAINS: str = Field(default="")

    WEBHOOK_SIGNING_SECRET: str = Field(default="")

    ZOOM_ACCOUNT_ID: str = Field(default="")
    ZOOM_CLIENT_ID: str = Field(default="")
    ZOOM_CLIENT_SECRET: str = Field(default="")
    MS_TEAMS_TENANT_ID: str = Field(default="")
    MS_TEAMS_CLIENT_ID: str = Field(default="")
    MS_TEAMS_CLIENT_SECRET: str = Field(default="")
    MS_TEAMS_ORGANIZER_USER_ID: str = Field(default="")
    MEETING_PROVIDER: str = Field(default="")

    HRMS_WEBHOOK_URL: str = Field(default="")
    HRMS_AUTH_HEADER: str = Field(default="")
    HRMS_AUTH_TOKEN: str = Field(default="")
    HRMS_AUTO_PUSH_ON_HIRE: bool = False

    PERFORMANCE_REVIEW_EXPIRY_DAYS: int = 30

    class Config:
        env_file = str(_ENV_FILE)
        env_file_encoding = "utf-8"
        extra = "ignore"


settings = Settings()


_SANDBOX_PROVIDERS = ("judge0", "piston")


def sandbox_provider() -> str:
    provider = (settings.CODE_SANDBOX_PROVIDER or "").strip().lower()
    return provider if provider in _SANDBOX_PROVIDERS else "judge0"


def sandbox_url() -> str:
    return settings.PISTON_API_URL if sandbox_provider() == "piston" else settings.JUDGE0_API_URL


def sandbox_not_configured_message() -> str:
    var = "PISTON_API_URL" if sandbox_provider() == "piston" else "JUDGE0_API_URL"
    return f"Code execution is not configured: set {var} in settings"


_INSECURE_DEFAULT_SECRET_KEY = "change-me-in-production-32-chars-min"
_LEAKED_SUPERADMIN_PASSWORDS = {"qwerty@54321"}

_PLACEHOLDER_MARKERS = ("change-me", "changeme", "change_me", "your-", "placeholder", "example", "todo", "xxx")
_MIN_SECRET_KEY_LENGTH = 32
_MIN_SUPERADMIN_PASSWORD_LENGTH = 12
_WEAK_PASSWORDS = {
    "password", "password123", "admin", "admin123", "qwerty", "qwerty123",
    "letmein", "changeme", "secret", "superadmin", "test", "12345678",
}


def _looks_like_placeholder(value: str) -> bool:
    lowered = value.lower()
    return any(marker in lowered for marker in _PLACEHOLDER_MARKERS)


def audit_security_config() -> tuple[list[str], list[str]]:
    fatal: list[str] = []
    weak: list[str] = []

    secret_key = settings.SECRET_KEY or ""
    if secret_key == _INSECURE_DEFAULT_SECRET_KEY:
        fatal.append("SECRET_KEY is still the shipped default")
    elif _looks_like_placeholder(secret_key):
        weak.append("SECRET_KEY looks like an unreplaced placeholder (e.g. copied from .env.example)")
    elif len(secret_key) < _MIN_SECRET_KEY_LENGTH:
        weak.append(
            f"SECRET_KEY is only {len(secret_key)} characters: use at least "
            f"{_MIN_SECRET_KEY_LENGTH} random characters for HS256 signing"
        )

    password = settings.DEFAULT_SUPERADMIN_PASSWORD or ""
    if not password:
        fatal.append(
            "DEFAULT_SUPERADMIN_PASSWORD is not set. There is no default, and "
            "the superadmin account is not created without one"
        )
    elif password in _LEAKED_SUPERADMIN_PASSWORDS:
        fatal.append(
            "DEFAULT_SUPERADMIN_PASSWORD is a credential published in this "
            "repository's git history. Choose a new one"
        )
    elif _looks_like_placeholder(password):
        weak.append("DEFAULT_SUPERADMIN_PASSWORD looks like an unreplaced placeholder")
    elif password.lower() in _WEAK_PASSWORDS:
        weak.append("DEFAULT_SUPERADMIN_PASSWORD is a commonly-guessed password")
    elif len(password) < _MIN_SUPERADMIN_PASSWORD_LENGTH:
        weak.append(
            f"DEFAULT_SUPERADMIN_PASSWORD is only {len(password)} characters: "
            f"use at least {_MIN_SUPERADMIN_PASSWORD_LENGTH}"
        )

    if settings.ALLOW_DEMO_AUTH and not settings.DEBUG:
        fatal.append(
            "ALLOW_DEMO_AUTH is on while DEBUG is off: 'Bearer demo-<role>-token' "
            "grants a role with NO credentials. Set ALLOW_DEMO_AUTH=false."
        )

    return fatal, weak


def validate_security_config() -> None:
    import logging

    logger = logging.getLogger(__name__)
    fatal, weak = audit_security_config()

    if weak:
        message = "Weak security configuration:\n  - " + "\n  - ".join(weak)
        if settings.STRICT_SECURITY_VALIDATION and not settings.DEBUG:
            fatal.extend(weak)
        else:
            logger.error(
                "%s\nStartup was NOT blocked (set STRICT_SECURITY_VALIDATION=true to make "
                "these fatal), but treat this as a live security finding.", message,
            )

    if not fatal:
        return

    message = (
        "Insecure configuration detected:\n  - "
        + "\n  - ".join(fatal)
        + "\nSet real values in .env before deploying."
    )
    if settings.DEBUG:
        logger.warning(message)
    else:
        raise RuntimeError(message)


def validate_runtime_config() -> list[str]:
    warnings: list[str] = []

    if not settings.OPENAI_API_KEY and not settings.ANTHROPIC_API_KEY:
        warnings.append(
            "No LLM provider key set (OPENAI_API_KEY / ANTHROPIC_API_KEY): JD parsing, "
            "resume classification, interview question generation and evaluation will all fail."
        )
    elif not settings.OPENAI_API_KEY:
        warnings.append(
            "OPENAI_API_KEY is not set: embeddings, resume matching, TTS and transcription "
            "have no other provider and will fail even though ANTHROPIC_API_KEY is present."
        )
    elif not settings.ANTHROPIC_API_KEY:
        if (settings.DEFAULT_LLM_MODEL or "").startswith("claude-"):
            warnings.append(
                f"ANTHROPIC_API_KEY is not set but the default model is {settings.DEFAULT_LLM_MODEL}: "
                "JD parsing, resume classification, interview question generation, "
                "evaluation and every other AI feature will fail until it is set."
            )
        else:
            warnings.append(
                "ANTHROPIC_API_KEY is not set: Claude models are listed in the model "
                "picker but any request or admin override that selects one will fail "
                "silently; OpenAI-backed features are unaffected."
            )

    if not settings.PINECONE_API_KEY:
        warnings.append("PINECONE_API_KEY is not set: resume↔JD vector matching is disabled.")
    if not settings.EMAIL_HOST and not settings.AWS_SES_ENABLED:
        warnings.append(
            "Neither EMAIL_HOST nor AWS_SES_ENABLED is set: no invite, OTP, status or offer "
            "email will be delivered."
        )
    if not sandbox_url():
        var = "PISTON_API_URL" if sandbox_provider() == "piston" else "JUDGE0_API_URL"
        warnings.append(
            f"{var} is not set (CODE_SANDBOX_PROVIDER={sandbox_provider()}): "
            "the AI coding assessment cannot execute code."
        )

    import os

    if (os.environ.get("VERCEL") or os.environ.get("AWS_LAMBDA_FUNCTION_NAME")) and not settings.CRON_SECRET:
        warnings.append(
            "CRON_SECRET is not set: the scheduled jobs (invite reminders, interview reminders for "
            "other platforms, job-source sync) are disabled on this host."
        )

    weight_sum = sum((settings.SCORE_DIMENSION_WEIGHTS or {}).values())
    if abs(weight_sum - 1.0) > 1e-6:
        warnings.append(
            f"SCORE_DIMENSION_WEIGHTS sums to {weight_sum:.4f}, not 1.0: "
            "final_score will not be on a true 0-100 scale until this is corrected."
        )

    return warnings
