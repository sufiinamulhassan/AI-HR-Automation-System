"""AI Prompt Configuration service — hr_module (MVP2 §2.20 slice).

Lets an admin override the two highest-value, most-cited LLM prompts in this
codebase — the JD-parsing prompt (`services/hr_module/jd_intel.py`) and the
interview question-generation + evaluation prompts
(`services/hr_module/interview_engine.py`) — without a code deploy.

Storage: a single `prompt_templates` collection, one document per known
prompt `key`, holding only the override. **Absence of a document is the
normal, expected state** — every one of the three owning call sites
(`jd_intel.parse_jd`, `interview_engine.generate_questions`,
`interview_engine.evaluate_interview`) calls `get_prompt_override(key)` first
and falls back to its own hardcoded `_SYSTEM`/`_PROMPT` constants unchanged
whenever this returns `None` (no DB, no override document, or a lookup
error) — so this module can never make JD parsing or interviewing behave
worse than before it existed.

Known prompt keys and the exact `.format()` placeholder names each prompt's
`user_prompt_template` MUST use (an override that renames or drops a
placeholder will fail to render — see `_get_hardcoded_default`'s callers,
which catch that and fall back to the hardcoded default for that single
call rather than failing the request):

  jd_parse            — {jd}, {industries}
  interview_questions  — {title}, {difficulty}, {jd}, {topics_line}, {resume}, {count}
  interview_eval       — {title}, {transcript}, {flags}

Deliberately NOT covered this pass (see docs/report.md §3 / task scope):
`services/hr_module/classifier.py` (owned by a different task this round)
and `services/hr_module/scenario_service.py` (out of scope for this pass) —
both are trivially reusable candidates for the same pattern later.
"""
import logging
from datetime import datetime, timezone

from config.database import get_db

logger = logging.getLogger(__name__)

KNOWN_PROMPT_KEYS: dict[str, dict] = {
    "jd_parse": {
        "label": "JD Parsing",
        "description": (
            "Extracts structured fields (skills, industry, experience level, "
            "requirements, certifications, interview topics, etc.) from a job "
            "description. Used by services/hr_module/jd_intel.py."
        ),
        "placeholders": ["jd", "industries"],
    },
    "interview_questions": {
        "label": "Interview Question Generation",
        "description": (
            "Generates the candidate's interview question set from the job "
            "description, resume excerpt, and JD-derived interview topics. "
            "Used by services/hr_module/interview_engine.py."
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
        "label": "Coding Assessment — Code Quality Review",
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


def _get_hardcoded_default(key: str) -> tuple[str, str]:
    """Lazily import the owning module's current hardcoded (system, user_template)
    pair. Local imports only — jd_intel.py / interview_engine.py import THIS
    module at their own top level (to call get_prompt_override), so importing
    them back here at module scope would be circular. By the time any caller
    of this function runs (always at request time, never at import time),
    both modules are already fully imported, so this is safe.
    """
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
    """Return the override document for `key`, or None if no override exists
    (no DB, no document, or a transient lookup error) — the universal signal
    for "caller should use its own hardcoded default instead." Never raises.
    """
    try:
        db = get_db()
        if db is None:
            return None
        return await db.prompt_templates.find_one({"key": key}, {"_id": 0})
    except Exception as exc:
        logger.warning("get_prompt_override failed (key=%s), falling back to default: %s", key, exc)
        return None


async def list_prompt_templates() -> list[dict]:
    """Every known prompt key with its currently-effective system/user prompt
    (override if one exists, otherwise the hardcoded default) plus enough
    metadata for an admin UI to show what's customized vs. default."""
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
    """Delete the override document so the hardcoded default takes over again.
    Returns True if a document was actually removed."""
    if key not in KNOWN_PROMPT_KEYS:
        raise KeyError(f"Unknown prompt key: {key}")
    db = get_db()
    if db is None:
        return False
    result = await db.prompt_templates.delete_one({"key": key})
    return result.deleted_count > 0
