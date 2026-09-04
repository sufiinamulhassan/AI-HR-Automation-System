"""Resume domain + seniority classifier — hr_module."""
import json
import logging

from config.llm import ask_llm
from config.settings import settings
from services.hr_module.jd_intel import INDUSTRIES

logger = logging.getLogger(__name__)

DOMAINS = [
    "software_engineering", "machine_learning", "data_science", "data_engineering",
    "devops", "cybersecurity", "qa_testing", "product_management", "design",
    "marketing", "sales", "finance", "hr", "operations", "legal", "customer_success",
]
SENIORITY = ["intern", "junior", "mid", "senior", "lead", "manager", "director", "executive"]

_SYSTEM = (
    "You are an expert HR classifier. Analyze the resume and return ONLY JSON.\n"
    "Rules:\n"
    "- 'AI/ML Engineer' → machine_learning (never software_engineering)\n"
    "- 'Data Engineer' + Spark/pipelines → data_engineering (not data_science)\n"
    "- Years: 0-1=intern, 1-3=junior, 3-6=mid, 6-10=senior, 10+=lead/manager\n"
    "- education_level: one of high_school, bachelor, master, phd, bootcamp, other\n"
    "- industry: the general business sector the candidate's experience sits in "
    "(technology, healthcare, fintech, etc.) — distinct from job_domain, which is "
    "their functional tech role\n"
    "- skills: top 20 most relevant technical skills only"
)
_PROMPT = """Resume (first 3000 chars):
{text}

Return JSON:
{{
  "job_domain": "<one of: {domains}>",
  "seniority_level": "<one of: {seniority}>",
  "skills": ["skill1", ...],
  "confidence": <0.0-1.0>,
  "years_experience": <integer, estimated total years of professional experience>,
  "education_level": "<one of: high_school, bachelor, master, phd, bootcamp, other>",
  "industry": "<one of: {industries}>"
}}"""


async def classify_resume(text: str, model: str | None = None) -> dict:
    raw = await ask_llm(
        prompt=_PROMPT.format(
            text=text[:3000],
            domains=", ".join(DOMAINS),
            seniority=", ".join(SENIORITY),
            industries=", ".join(INDUSTRIES),
        ),
        system=_SYSTEM,
        model=model or settings.RESUME_CLASSIFICATION_MODEL,
        max_tokens=450,
        temperature=0.0,
        json_mode=True,
    )
    try:
        result = json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("Classifier JSON parse failed")
        result = {}
    result.setdefault("job_domain", "software_engineering")
    result.setdefault("seniority_level", "mid")
    result.setdefault("skills", [])
    result.setdefault("confidence", 0.5)
    result.setdefault("years_experience", 0)
    result.setdefault("education_level", "other")
    result.setdefault("industry", "other")
    if result["industry"] not in INDUSTRIES:
        result["industry"] = "other"
    result["skills"] = result["skills"][:20]
    return result
