import logging
import re
import string
from datetime import datetime, timezone

from config.database import get_db

logger = logging.getLogger(__name__)

KNOWN_PROMPT_KEYS: dict[str, dict] = {
    "jd_parse": {
        "label": "JD Parsing",
        "description": (
            "Extracts structured fields (skills, industry, experience level, "
            "requirements, certifications, interview topics, etc.) from a job "
            "description."
        ),
        "placeholders": ["jd", "industries"],
    },
    "interview_questions": {
        "label": "Interview Question Generation",
        "description": (
            "Generates the candidate's interview question set from the job "
            "description, resume excerpt, and JD-derived interview topics."
        ),
        "placeholders": [
            "title", "difficulty", "seniority_line", "jd",
            "skills_line", "topics_line", "resume", "count",
        ],
    },
    "interview_eval": {
        "label": "Interview Evaluation",
        "description": (
            "Scores a completed interview transcript and produces the structured "
            "report (scores, strengths, recommendation, summary). Used by "
            "services/hr_module/interview_engine.py."
        ),
        "placeholders": ["title", "transcript", "flags"],
    },
    "code_evaluation": {
        "label": "Coding Assessment: Code Quality Review",
        "description": (
            "Reviews a candidate's submitted code for readability, structure, "
            "efficiency, idiom and problem-solving approach, and writes feedback "
            "for the recruiter and the candidate. Runs alongside Judge0 "
            "correctness, never instead of it. Used by "
            "services/hr_module/coding_service.py."
        ),
        "placeholders": [
            "question_title", "question_description", "language",
            "code", "passed", "total",
        ],
    },
}


_OPTIONAL_PLACEHOLDERS: dict[str, list[str]] = {
    "interview_questions": ["stage_line", "angle_line"],
}


class PromptTemplateError(ValueError):
    pass


def required_placeholders(key: str) -> list[str]:
    return list(KNOWN_PROMPT_KEYS[key]["placeholders"])


def _used_placeholders(template: str) -> list[str]:
    names: list[str] = []
    for _literal, field, _spec, _conv in string.Formatter().parse(template):
        if field is None:
            continue
        name = re.split(r"[.\[]", field, maxsplit=1)[0]
        if name not in names:
            names.append(name)
    return names


def validate_user_prompt_template(key: str, template: str) -> None:
    if key not in KNOWN_PROMPT_KEYS:
        raise KeyError(f"Unknown prompt key: {key}")
    try:
        used = _used_placeholders(template)
    except ValueError:
        raise PromptTemplateError(
            "Invalid template: a brace is unmatched. Write {{ and }} for a literal brace."
        )

    missing = [p for p in required_placeholders(key) if p not in used]
    if missing:
        raise PromptTemplateError("Missing placeholders: " + ", ".join("{" + p + "}" for p in missing))

    allowed = set(required_placeholders(key)) | set(_OPTIONAL_PLACEHOLDERS.get(key, []))
    unknown = [p for p in used if p not in allowed]
    if unknown:
        raise PromptTemplateError("Unknown placeholders: " + ", ".join("{" + p + "}" for p in unknown))


def _get_hardcoded_default(key: str) -> tuple[str, str]:
    if key == "jd_parse":
        from services.hr_module.jd_intel import _SYSTEM, _PROMPT
        return _SYSTEM, _PROMPT
    if key == "interview_questions":
        from services.hr_module.interview_engine import _GEN_SYSTEM, _GEN_PROMPT
        return _GEN_SYSTEM, _GEN_PROMPT
    if key == "interview_eval":
        from services.hr_module.interview_engine import _EVAL_SYSTEM, _EVAL_PROMPT
        return _EVAL_SYSTEM, _EVAL_PROMPT
    if key == "code_evaluation":
        from services.hr_module.coding_service import _QUALITY_SYSTEM, _QUALITY_PROMPT
        return _QUALITY_SYSTEM, _QUALITY_PROMPT
    raise KeyError(f"Unknown prompt key: {key}")


async def get_prompt_override(key: str) -> dict | None:
    try:
        db = get_db()
        if db is None:
            return None
        return await db.prompt_templates.find_one({"key": key}, {"_id": 0})
    except Exception as exc:
        logger.warning("get_prompt_override failed (key=%s), falling back to default: %s", key, exc)
        return None


async def list_prompt_templates() -> list[dict]:
    results = []
    for key, meta in KNOWN_PROMPT_KEYS.items():
        item = await get_prompt_template_detail(key)
        if item:
            results.append(item)
    return results


async def get_prompt_template_detail(key: str) -> dict | None:
    if key not in KNOWN_PROMPT_KEYS:
        return None
    meta = KNOWN_PROMPT_KEYS[key]
    default_system, default_user = _get_hardcoded_default(key)
    override = await get_prompt_override(key)
    return {
        "key": key,
        "label": meta["label"],
        "description": meta["description"],
        "placeholders": meta["placeholders"],
        "is_customized": override is not None,
        "system_prompt": (override or {}).get("system_prompt") or default_system,
        "user_prompt_template": (override or {}).get("user_prompt_template") or default_user,
        "default_system_prompt": default_system,
        "default_user_prompt_template": default_user,
        "updated_by": (override or {}).get("updated_by"),
        "updated_at": (override or {}).get("updated_at"),
    }


async def upsert_prompt_template(
    key: str,
    system_prompt: str,
    user_prompt_template: str,
    description: str | None,
    updated_by: str,
) -> dict:
    if key not in KNOWN_PROMPT_KEYS:
        raise KeyError(f"Unknown prompt key: {key}")
    db = get_db()
    if db is None:
        raise RuntimeError("Database unavailable")
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "key": key,
        "system_prompt": system_prompt,
        "user_prompt_template": user_prompt_template,
        "description": description,
        "updated_by": updated_by,
        "updated_at": now,
    }
    await db.prompt_templates.update_one({"key": key}, {"$set": doc}, upsert=True)
    doc.pop("_id", None)
    return doc


async def reset_prompt_template(key: str) -> bool:
    if key not in KNOWN_PROMPT_KEYS:
        raise KeyError(f"Unknown prompt key: {key}")
    db = get_db()
    if db is None:
        return False
    result = await db.prompt_templates.delete_one({"key": key})
    return result.deleted_count > 0
