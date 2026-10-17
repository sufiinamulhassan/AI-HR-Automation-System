import json
import logging

from config.llm import ask_llm, model_for
from config.settings import settings
from services.hr_module.jd_intel import INDUSTRIES
from services.hr_module.prompt_guard import fence, with_guard
from services.hr_module.resume_profile import clean_profile

logger = logging.getLogger(__name__)

DOMAINS = [
    "software_engineering", "machine_learning", "data_science", "data_engineering",
    "devops", "cybersecurity", "qa_testing", "product_management", "design",
    "marketing", "sales", "finance", "hr", "operations", "legal", "customer_success",
]
SENIORITY = ["intern", "junior", "mid", "senior", "lead", "manager", "director", "executive"]

READ_CHARS = 4500
MAX_TOKENS = 900

_SYSTEM = (
    "You are an expert HR classifier. Analyze the resume and return ONLY JSON.\n"
    "Rules:\n"
    "- 'AI/ML Engineer' → machine_learning (never software_engineering)\n"
    "- 'Data Engineer' + Spark/pipelines → data_engineering (not data_science)\n"
    "- Years: 0-1=intern, 1-3=junior, 3-6=mid, 6-10=senior, 10+=lead/manager\n"
    "- education_level: one of high_school, bachelor, master, phd, bootcamp, other\n"
    "- industry: the general business sector the candidate's experience sits in "
    "(technology, healthcare, fintech, etc.): distinct from job_domain, which is "
    "their functional tech role\n"
    "- skills: top 20 most relevant technical skills only\n"
    "- headline: the candidate's current or most recent job title, copied as written\n"
    "- location: the candidate's city and country, copied as written\n"
    "- experience: at most 8 roles, most recent first, each with the job title and the "
    "company exactly as written\n"
    "- headline, location and experience come only from the resume text: "
    "use null (or [] for the experience list) when the resume does not state them, "
    "and never invent or guess a value"
)
_PROMPT = """Resume (first 4500 chars):
{text}

Return JSON:
{{
  "job_domain": "<one of: {domains}>",
  "seniority_level": "<one of: {seniority}>",
  "skills": ["skill1", ...],
  "confidence": <0.0-1.0>,
  "years_experience": <integer, estimated total years of professional experience>,
  "education_level": "<one of: high_school, bachelor, master, phd, bootcamp, other>",
  "industry": "<one of: {industries}>",
  "headline": "<current or most recent job title as written, or null>",
  "location": "<city and country as written, or null>",
  "experience": [{{"title": "<job title as written>", "company": "<company as written>"}}, ...]
}}"""


def _parse(raw) -> dict:
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError):
        logger.warning("Classifier JSON parse failed")
        return {}
    if not isinstance(parsed, dict):
        logger.warning("Classifier JSON was not an object")
        return {}
    return parsed


def _or_default(result: dict, key: str, default):
    value = result.get(key)
    return default if value is None else value


def _classification(result: dict) -> dict:
    skills = result.get("skills")
    industry = _or_default(result, "industry", "other")
    return {
        "job_domain": _or_default(result, "job_domain", "software_engineering"),
        "seniority_level": _or_default(result, "seniority_level", "mid"),
        "skills": skills[:20] if isinstance(skills, list) else [],
        "confidence": _or_default(result, "confidence", 0.5),
        "years_experience": _or_default(result, "years_experience", 0),
        "education_level": _or_default(result, "education_level", "other"),
        "industry": industry if industry in INDUSTRIES else "other",
    }


async def classify_resume(text: str, model: str | None = None) -> dict:
    raw = await ask_llm(
        prompt=_PROMPT.format(
            text=fence("RESUME", (text or "")[:READ_CHARS]),
            domains=", ".join(DOMAINS),
            seniority=", ".join(SENIORITY),
            industries=", ".join(INDUSTRIES),
        ),
        system=with_guard(_SYSTEM),
        model=model_for("resume", model),
        max_tokens=MAX_TOKENS,
        temperature=0.0,
        json_mode=True,
    )
    result = _parse(raw)
    return {**_classification(result), **clean_profile(result)}
