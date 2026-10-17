import json
import logging
from datetime import datetime, timezone

from config.llm import ask_llm, embedding_model, get_embedding, model_for, require_vector
from config.database import get_db, get_pinecone
from services.hr_module.prompt_config_service import get_prompt_override
from services.hr_module.prompt_guard import fence, with_guard
from services.hr_module.vector_scope import vector_metadata

logger = logging.getLogger(__name__)

SENIORITY_FLEX = {
    "intern":    ["intern", "junior"],
    "junior":    ["intern", "junior", "mid"],
    "mid":       ["junior", "mid", "senior"],
    "senior":    ["mid", "senior", "lead"],
    "lead":      ["senior", "lead", "manager"],
    "manager":   ["lead", "manager", "director"],
    "director":  ["manager", "director", "executive"],
    "executive": ["director", "executive"],
}


def job_embedding_text(title: str, description: str) -> str:
    return f"{title}\n{(description or '')[:2000]}"


def job_vector_metadata(parsed: dict, level: str | None) -> dict:
    return vector_metadata({
        "doc_type": "job",
        "job_domain": parsed.get("job_domain"),
        "experience_level": level,
        "skills": (parsed.get("skills") or [])[:20],
    })


INDUSTRIES = [
    "technology", "healthcare", "fintech", "banking_finance", "retail_ecommerce",
    "manufacturing", "education", "government_public_sector", "telecom",
    "media_entertainment", "energy_utilities", "real_estate", "logistics_supply_chain",
    "hospitality_travel", "nonprofit", "other",
]

_SYSTEM = "You are a senior technical recruiter. Parse job descriptions and return structured JSON."
_PROMPT = """Job Description:
{jd}

Return JSON:
{{
  "skills": ["skill1", ...],
  "experience_level": "<intern|junior|mid|senior|lead|manager|director|executive>",
  "job_domain": "<software_engineering|machine_learning|data_science|data_engineering|devops|cybersecurity|qa_testing|product_management|design|marketing|sales|finance|hr|operations|legal|customer_success>",
  "industry": "<{industries}>",
  "key_requirements": ["req1", "req2", "req3"],
  "responsibilities": ["responsibility1", "responsibility2", ...],
  "qualifications": ["qualification1", "qualification2", ...],
  "nice_to_have": ["skill1", ...],
  "certifications": ["cert1", ...],
  "keywords": ["keyword1", ...],
  "interview_topics": ["topic1", ...],
  "coding_assessment_topics": ["topic1", ...],
  "company_name": "<company name if mentioned, else null>"
}}"""


async def parse_jd(job_id: str, title: str, description: str, model: str | None = None) -> dict:
    jd_text = fence("JOB DESCRIPTION", description[:4000])
    system = _SYSTEM
    prompt = _PROMPT.format(jd=jd_text, industries="|".join(INDUSTRIES))
    override = await get_prompt_override("jd_parse")
    if override and override.get("system_prompt") and override.get("user_prompt_template"):
        try:
            prompt = override["user_prompt_template"].format(
                jd=jd_text, industries="|".join(INDUSTRIES)
            )
            system = override["system_prompt"]
        except (KeyError, IndexError, ValueError) as exc:
            logger.warning(
                "jd_parse prompt override has a placeholder mismatch, falling back "
                "to default: %s", exc,
            )
            system = _SYSTEM
            prompt = _PROMPT.format(jd=jd_text, industries="|".join(INDUSTRIES))

    raw = await ask_llm(
        prompt=prompt,
        system=with_guard(system),
        model=model_for("job_description", model),
        max_tokens=800,
        temperature=0.0,
        json_mode=True,
    )
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        parsed = {}

    parsed.setdefault("skills", [])
    parsed.setdefault("experience_level", "mid")
    parsed.setdefault("job_domain", "software_engineering")
    parsed.setdefault("industry", "other")
    parsed.setdefault("key_requirements", [])
    parsed.setdefault("responsibilities", [])
    parsed.setdefault("qualifications", [])
    parsed.setdefault("nice_to_have", [])
    parsed.setdefault("certifications", [])
    parsed.setdefault("keywords", [])
    parsed.setdefault("interview_topics", [])
    parsed.setdefault("coding_assessment_topics", [])
    parsed.setdefault("company_name", None)

    level = parsed["experience_level"]
    targeting = {
        "required_domain": parsed["job_domain"],
        "required_seniority": SENIORITY_FLEX.get(level, [level]),
        "required_skills": parsed["skills"][:20],
    }

    embedding = require_vector(await get_embedding(job_embedding_text(title, description)))

    pinecone = get_pinecone()
    if pinecone is not None:
        pinecone.upsert(
            vectors=[{
                "id": job_id,
                "values": embedding,
                "metadata": job_vector_metadata(parsed, level),
            }],
            namespace="jobs",
        )

    db = get_db()
    if db is not None:
        await db.jobs.update_one(
            {"job_id": job_id},
            {"$set": {
                "parsed_criteria": parsed,
                "targeting": targeting,
                "embedding": embedding,
                "embedding_model": embedding_model(),
                "updated_at": datetime.now(timezone.utc),
            }},
        )

    return {"parsed_criteria": parsed, "targeting": targeting, "embedding": embedding}
