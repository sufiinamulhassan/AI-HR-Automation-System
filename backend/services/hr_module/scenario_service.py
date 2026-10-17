import json
import logging
import random
import uuid
from datetime import datetime, timezone

from config.database import get_db
from config.llm import ask_llm, model_for
from services.hr_module.prompt_guard import fence, with_guard
from shared.utils import mongo_doc

logger = logging.getLogger(__name__)

DEFAULT_EVALUATION_DIMENSIONS = [
    "technical", "problem_solving", "communication", "decision_making", "confidence",
]

_SCORE_SYSTEM = (
    "You are a senior technical interviewer scoring a candidate's response to a "
    "scenario-based interview question. Score strictly on the requested dimensions."
)
_SCORE_PROMPT = """Scenario:
{scenario_prompt}

Candidate transcript:
{transcript_text}

Score the candidate 0-100 on EACH of the following dimensions: {dimensions}.
Return JSON with one integer field per dimension, e.g.:
{{{example}}}"""


async def create_scenario(data: dict, created_by: str) -> dict:
    db = get_db()
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "doc_type": "scenario",
        "scenario_id": str(uuid.uuid4()),
        "name": data["name"],
        "prompt": data["prompt"],
        "evaluation_dimensions": data.get("evaluation_dimensions") or list(DEFAULT_EVALUATION_DIMENSIONS),
        "job_domain": data.get("job_domain"),
        "is_active": data.get("is_active", True),
        "created_by": created_by,
        "created_at": now,
        "updated_at": now,
    }
    if db is not None:
        await db.scenarios.insert_one(doc)
    return mongo_doc(doc)


async def list_scenarios(is_active: bool | None = None, job_domain: str | None = None) -> list[dict]:
    db = get_db()
    if db is None:
        return []
    query: dict = {}
    if is_active is not None:
        query["is_active"] = is_active
    if job_domain is not None:
        query["job_domain"] = job_domain
    cursor = db.scenarios.find(query, {"_id": 0}).sort("created_at", -1)
    return [doc async for doc in cursor]


async def pick_scenario_for_job(job: dict) -> str | None:
    domain = (job.get("parsed_criteria") or {}).get("job_domain") \
        or (job.get("targeting") or {}).get("required_domain")

    if domain:
        matches = await list_scenarios(is_active=True, job_domain=domain)
        if matches:
            return random.choice(matches).get("scenario_id")

    generic = [s for s in await list_scenarios(is_active=True) if not s.get("job_domain")]
    if generic:
        return random.choice(generic).get("scenario_id")
    return None


async def get_scenario(scenario_id: str) -> dict | None:
    db = get_db()
    if db is None:
        return None
    return await db.scenarios.find_one({"scenario_id": scenario_id}, {"_id": 0})


async def update_scenario(scenario_id: str, updates: dict) -> bool:
    db = get_db()
    if db is None:
        return False
    clears_domain = "job_domain" in updates
    domain = updates.get("job_domain")
    updates = {k: v for k, v in updates.items() if v is not None}
    if clears_domain:
        updates["job_domain"] = (domain or "").strip() or None
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    result = await db.scenarios.update_one({"scenario_id": scenario_id}, {"$set": updates})
    return result.matched_count > 0


async def delete_scenario(scenario_id: str) -> None:
    db = get_db()
    if db is None:
        return
    await db.scenarios.delete_one({"scenario_id": scenario_id})


def build_scenario_prompt_addition(scenario: dict) -> str:
    dims = ", ".join(scenario.get("evaluation_dimensions") or DEFAULT_EVALUATION_DIMENSIONS)
    name = scenario.get("name", "Scenario")
    prompt = scenario.get("prompt", "")
    return (
        f"Scenario-based interview \"{name}\": {prompt}\n"
        f"Walk the candidate through this scenario with follow-up questions that probe "
        f"their thinking. Focus your questions on evaluating: {dims}."
    )


async def score_scenario_response(transcript: list[dict], scenario: dict, model: str | None = None) -> dict:
    dimensions = scenario.get("evaluation_dimensions") or list(DEFAULT_EVALUATION_DIMENSIONS)
    safe_default = {dim: 50 for dim in dimensions}

    if not transcript:
        return safe_default

    transcript_text = "\n".join(
        f"Q: {entry.get('question', '')}\nA: {entry.get('answer', '')}"
        for entry in transcript
    )
    if not transcript_text.strip():
        return safe_default

    example = ", ".join(f'"{dim}": <int>' for dim in dimensions)
    raw = await ask_llm(
        prompt=_SCORE_PROMPT.format(
            scenario_prompt=scenario.get("prompt", ""),
            transcript_text=fence("TRANSCRIPT", transcript_text[:6000]),
            dimensions=", ".join(dimensions),
            example=example,
        ),
        system=with_guard(_SCORE_SYSTEM),
        model=model_for("scenario", model),
        max_tokens=400,
        temperature=0.2,
        json_mode=True,
    )

    try:
        parsed = json.loads(raw)
        if not isinstance(parsed, dict):
            return safe_default
        scores = {}
        for dim in dimensions:
            value = parsed.get(dim)
            scores[dim] = int(value) if isinstance(value, (int, float)) else 50
        return scores
    except (json.JSONDecodeError, TypeError, ValueError) as e:
        logger.warning("score_scenario_response parse failure: %s", e)
        return safe_default
