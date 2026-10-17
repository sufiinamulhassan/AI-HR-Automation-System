from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone

from config.llm import ask_llm, model_for, track_llm_cost
from config.settings import settings
from services.hr_module.external_interview_service import RATING_KEYS
from shared.utils import strip_em_dashes

logger = logging.getLogger(__name__)

DIMENSIONS = RATING_KEYS
REQUIRED_DIMENSIONS = ("technical", "communication", "problem_solving", "cultural_fit")

DIMENSION_LABELS = {
    "technical": "Technical",
    "communication": "Communication",
    "problem_solving": "Problem solving",
    "cultural_fit": "Cultural fit",
    "confidence": "Confidence",
}

MIN_COUNT, MAX_COUNT = 4, 25
SOURCE_AI, SOURCE_CUSTOM = "ai", "custom"
MIN_CUSTOM_QUESTION_CHARS = 3
RESUME_CHARS = 4000
JD_CHARS = 2500
MIN_QUESTION_CHARS = 12
MAX_QUESTION_CHARS = 500
MAX_HINT_CHARS = 300
MIN_USABLE_QUESTIONS = 1

_GUIDE_LLM_TIMEOUT_SECONDS = 40.0
_SUMMARY_LLM_TIMEOUT_SECONDS = 30.0

SUMMARY_MIN_WORDS, SUMMARY_MAX_WORDS = 60, 120


class DraftSummaryUnavailable(Exception):
    pass


_DEFAULT_HINTS = {
    "technical": "Specific tools, decisions and trade-offs in their own words, not a list of buzzwords.",
    "communication": "A clear, structured explanation that a listener outside the topic could follow.",
    "problem_solving": "A method for narrowing the problem down, and honest handling of what they did not know.",
    "cultural_fit": "Respect for colleagues, ownership of their part, and how they handle disagreement.",
    "confidence": "Calm, direct answers that they can back up with evidence when pushed.",
}

_FALLBACK_QUESTIONS = [
    {
        "text": "Walk me through the most technically demanding project on your CV. What exactly was your part, and what would you change now?",
        "dimension": "technical",
        "listen_for": "A clear personal contribution, the real constraints, and honest hindsight.",
    },
    {
        "text": "Tell me about a time you had to explain a complex technical decision to someone outside your field. How did you check they understood?",
        "dimension": "communication",
        "listen_for": "A structured explanation, plain language, and a way of confirming understanding.",
    },
    {
        "text": "Describe a production problem you had to debug with very little information. How did you narrow it down?",
        "dimension": "problem_solving",
        "listen_for": "A repeatable method, the hypotheses they ruled out, and what they did to stop it recurring.",
    },
    {
        "text": "Tell me about a disagreement with a teammate or manager over how something should be done. How did it end?",
        "dimension": "cultural_fit",
        "listen_for": "Respect for the other view, a concrete outcome, and what they would do differently.",
    },
    {
        "text": "Which skills in the job description are your strongest, and which are you still building? Give an example of each.",
        "dimension": "technical",
        "listen_for": "A candid self-assessment backed by real examples on both sides.",
    },
    {
        "text": "Suppose a feature you built had to handle ten times today's load. How would you approach it? Please think aloud.",
        "dimension": "problem_solving",
        "listen_for": "Clarifying questions first, then bottlenecks, trade-offs and a sensible order of work.",
    },
    {
        "text": "Tell me about a time you defended a position when most of the room disagreed. What did you do?",
        "dimension": "confidence",
        "listen_for": "Evidence-based conviction that stays open to being wrong.",
    },
    {
        "text": "How do you keep stakeholders informed when a project starts to slip?",
        "dimension": "communication",
        "listen_for": "Early, specific updates with options, rather than waiting until the deadline.",
    },
    {
        "text": "What kind of team and way of working brings out your best work?",
        "dimension": "cultural_fit",
        "listen_for": "Self-awareness and a fit with how this team actually works.",
    },
    {
        "text": "Tell me about a mistake in your code or design that reached users. What did you learn from it?",
        "dimension": "technical",
        "listen_for": "Ownership without excuses, the root cause, and a lasting fix.",
    },
    {
        "text": "When everything looks urgent, how do you decide what to do first?",
        "dimension": "problem_solving",
        "listen_for": "A clear prioritisation rule and willingness to push back or ask for help.",
    },
    {
        "text": "Pick the claim on your CV you are proudest of. How would you prove it to me in the next five minutes?",
        "dimension": "confidence",
        "listen_for": "Concrete evidence and numbers they can explain without hedging.",
    },
]


_GUIDE_SYSTEM = (
    "You are a senior interviewer preparing a guide for a colleague who will interview a "
    "candidate on a video call. You write questions that are specific to this candidate's "
    "resume and this job, never generic ones. Return ONLY a JSON object. Never use the em "
    "dash character: use commas, colons or full stops."
)

_GUIDE_PROMPT = """Job title: {title}
{seniority_line}Job description:
{jd}
{skills_line}{topics_line}
Candidate resume (excerpt):
{resume}

Write exactly {count} interview questions for the interviewer to ask. Rules:
- Every question must be specific to this resume and this job. Name a project, employer, skill, claim, gap or career move from the resume, or a requirement from the job description, and probe it. No generic questions.
- Give each question a "dimension", using exactly one of these keys: technical, communication, problem_solving, cultural_fit, confidence.
- Cover technical, communication, problem_solving and cultural_fit at least once each. Weight technical and problem_solving the most. Confidence is optional.
- Give each question a "listen_for": ONE sentence telling the interviewer what a strong answer contains.
- Plain text only. Do not use the em dash character.

Return JSON: {{"questions": [{{"text": "<the question>", "dimension": "<key>", "listen_for": "<one sentence>"}}]}}"""

_NO_RESUME_TEXT = (
    "No resume text is on file. Base the questions on the job description and word them so "
    "they work for any candidate applying for it."
)


def question_count() -> int:
    try:
        wanted = int(settings.INTERVIEW_GUIDE_QUESTION_COUNT)
    except (TypeError, ValueError):
        wanted = 10
    return max(MIN_COUNT, min(MAX_COUNT, wanted))


def _normalise_dimension(raw) -> str | None:
    if not isinstance(raw, str):
        return None
    key = re.sub(r"[\s\-]+", "_", raw.strip().lower())
    aliases = {
        "culture_fit": "cultural_fit",
        "culture": "cultural_fit",
        "problemsolving": "problem_solving",
        "tech": "technical",
        "technical_skills": "technical",
    }
    key = aliases.get(key, key)
    return key if key in DIMENSIONS else None


def _parse_json(raw):
    if not isinstance(raw, str):
        return None
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\s*|\s*```$", "", text).strip()
    try:
        return json.loads(text)
    except (ValueError, TypeError):
        return None


def _one_line(value, limit: int) -> str:
    return strip_em_dashes(" ".join(str(value).split()))[:limit].rstrip()


def _clean_item(item) -> dict | None:
    if not isinstance(item, dict):
        return None
    text = item.get("text") if item.get("text") is not None else item.get("question")
    dimension = _normalise_dimension(item.get("dimension"))
    if not isinstance(text, str) or dimension is None:
        return None
    text = _one_line(text, MAX_QUESTION_CHARS)
    if len(text) < MIN_QUESTION_CHARS:
        return None
    hint = item.get("listen_for")
    hint = _one_line(hint, MAX_HINT_CHARS) if isinstance(hint, str) and hint.strip() else ""
    return {"text": text, "dimension": dimension, "listen_for": hint or _DEFAULT_HINTS[dimension]}


def normalise_questions(raw_reply, count: int) -> list[dict]:
    parsed = _parse_json(raw_reply)
    items = parsed.get("questions") if isinstance(parsed, dict) else parsed
    if not isinstance(items, list):
        return []

    unique: list[dict] = []
    seen: set[str] = set()
    for item in items:
        clean = _clean_item(item)
        if clean is None or clean["text"].lower() in seen:
            continue
        seen.add(clean["text"].lower())
        unique.append(clean)
    if len(unique) < MIN_USABLE_QUESTIONS:
        return []

    chosen: set[int] = set()
    for dimension in REQUIRED_DIMENSIONS:
        for index, question in enumerate(unique):
            if question["dimension"] == dimension:
                chosen.add(index)
                break
    for index in range(len(unique)):
        if len(chosen) >= count:
            break
        chosen.add(index)
    selected = [unique[i] for i in sorted(chosen)]

    for dimension in REQUIRED_DIMENSIONS:
        if any(q["dimension"] == dimension for q in selected):
            continue
        filler = next(b for b in _FALLBACK_QUESTIONS if b["dimension"] == dimension)
        if len(selected) >= count:
            counts = {d: sum(1 for q in selected if q["dimension"] == d) for d in DIMENSIONS}
            for index in range(len(selected) - 1, -1, -1):
                d = selected[index]["dimension"]
                if counts[d] > 1 or d not in REQUIRED_DIMENSIONS:
                    del selected[index]
                    break
        selected.append(dict(filler))
    return selected[:count]


def fallback_questions(count: int) -> list[dict]:
    return [dict(q) for q in _FALLBACK_QUESTIONS[:count]]


def _with_ids(questions: list[dict]) -> list[dict]:
    return [
        {
            "id": f"q{i}", "text": q["text"], "dimension": q["dimension"],
            "listen_for": q["listen_for"], "source": SOURCE_AI,
        }
        for i, q in enumerate(questions, start=1)
    ]


def with_sources(guide: dict | None) -> dict | None:
    if not isinstance(guide, dict):
        return guide
    return {
        **guide,
        "questions": [
            {**q, "source": q.get("source") or SOURCE_AI} if isinstance(q, dict) else q
            for q in guide.get("questions") or []
        ],
    }


def keep_custom_questions(new_guide: dict, old_guide: dict | None) -> dict:
    custom = [
        q for q in (old_guide or {}).get("questions") or []
        if isinstance(q, dict) and q.get("source") == SOURCE_CUSTOM
    ]
    if not custom:
        return new_guide
    room = max(MAX_COUNT - len(custom), 0)
    return {**new_guide, "questions": list(new_guide["questions"])[:room] + custom}


async def load_resume_profile(db, candidate: dict) -> dict:
    resume: dict = {}
    if db is not None and candidate.get("resume_id"):
        resume = await db.resumes.find_one(
            {"resume_id": candidate["resume_id"]},
            {"_id": 0, "text": 1, "classification": 1, "seniority_level": 1},
        ) or {}
    classification = resume.get("classification") or {}
    skills = classification.get("skills") or []
    return {
        "text": resume.get("text") or "",
        "seniority": classification.get("seniority_level") or resume.get("seniority_level") or None,
        "domain": classification.get("job_domain") or None,
        "skills": [str(s) for s in skills if isinstance(s, (str, int, float)) and str(s).strip()],
    }


async def generate_guide(db, candidate: dict, job: dict | None, *, generated_by: str | None) -> dict:
    job = job or {}
    count = question_count()
    profile = await load_resume_profile(db, candidate)

    criteria = job.get("parsed_criteria") or {}
    skills = criteria.get("skills") or (job.get("targeting") or {}).get("required_skills") or []
    topics = criteria.get("interview_topics") or []
    seniority = profile["seniority"] or ""
    prompt = _GUIDE_PROMPT.format(
        title=job.get("title") or "Unknown role",
        seniority_line=(
            f"Candidate experience level (classified from their resume): {seniority}. "
            "Pitch the depth of the questions to this level.\n" if seniority else ""
        ),
        jd=(job.get("description") or "")[:JD_CHARS] or "No job description on file.",
        skills_line=(
            f"Required skills for this role: {', '.join(str(s) for s in skills[:20])}\n" if skills else ""
        ),
        topics_line=(
            f"Focus areas called out in the job posting: {', '.join(str(t) for t in topics[:15])}\n"
            if topics else ""
        ),
        resume=profile["text"][:RESUME_CHARS].strip() or _NO_RESUME_TEXT,
        count=count,
    )

    raw = ""
    try:
        async with track_llm_cost("interview_guide", ref_id=candidate.get("candidate_id")):
            raw = await ask_llm(
                prompt=prompt,
                system=_GUIDE_SYSTEM,
                model=model_for("interview_guide"),
                max_tokens=2500,
                temperature=0.4,
                json_mode=True,
                timeout=_GUIDE_LLM_TIMEOUT_SECONDS,
            )
    except Exception as exc:
        logger.warning("interview guide generation failed | candidate=%s error=%s", candidate.get("candidate_id"), exc)
        raw = ""

    questions = normalise_questions(raw, count)
    fallback = not questions
    if fallback:
        logger.warning("interview guide: using generic questions | candidate=%s", candidate.get("candidate_id"))
        questions = fallback_questions(count)

    return {
        "questions": _with_ids(questions),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "generated_by": generated_by,
        "model": None if fallback else model_for("interview_guide"),
        "fallback": fallback,
    }


async def store_guide(db, candidate_id: str, guide: dict, *, replace: bool) -> bool:
    query: dict = {"candidate_id": candidate_id}
    if replace:
        query["interview_scorecards.0"] = {"$exists": False}
    else:
        query["interview_guide"] = None
    result = await db.candidates.update_one(query, {"$set": {"interview_guide": guide}})
    return bool(result.matched_count)


async def ensure_guide(db, candidate: dict, job: dict | None, *, generated_by: str | None) -> dict:
    existing = candidate.get("interview_guide")
    if existing and existing.get("questions"):
        return existing
    guide = await generate_guide(db, candidate, job, generated_by=generated_by)
    if await store_guide(db, candidate["candidate_id"], guide, replace=False):
        return guide
    fresh = await db.candidates.find_one({"candidate_id": candidate["candidate_id"]}, {"_id": 0, "interview_guide": 1})
    return (fresh or {}).get("interview_guide") or guide


_CUSTOM_ID = re.compile(r"^c(\d+)$")
IN_USE_MESSAGE = "A scorecard already has a rating or note for this question, so it cannot be deleted."
CHANGED_MESSAGE = "The guide changed while you were editing it. Reload and try again."


class GuideEditError(Exception):

    def __init__(self, message: str, status_code: int = 409):
        super().__init__(message)
        self.status_code = status_code


def clean_custom_question(text, dimension, listen_for) -> dict:
    if not isinstance(text, str):
        raise GuideEditError("Write the question.", 422)
    flat = strip_em_dashes(" ".join(text.split()))
    if len(flat) < MIN_CUSTOM_QUESTION_CHARS:
        raise GuideEditError(f"The question must be at least {MIN_CUSTOM_QUESTION_CHARS} characters.", 422)
    if len(flat) > MAX_QUESTION_CHARS:
        raise GuideEditError(f"The question can be at most {MAX_QUESTION_CHARS} characters.", 422)
    if dimension not in DIMENSIONS:
        raise GuideEditError("Choose the area this question covers.", 422)
    hint = ""
    if listen_for is not None:
        if not isinstance(listen_for, str):
            raise GuideEditError("The hint must be text.", 422)
        hint = strip_em_dashes(" ".join(listen_for.split()))
        if len(hint) > MAX_HINT_CHARS:
            raise GuideEditError(f"The hint can be at most {MAX_HINT_CHARS} characters.", 422)
    return {
        "text": flat,
        "dimension": dimension,
        "listen_for": hint or _DEFAULT_HINTS[dimension],
        "source": SOURCE_CUSTOM,
    }


def _next_custom_id(questions: list[dict]) -> str:
    taken = [
        int(m.group(1)) for q in questions
        if isinstance(q, dict) and (m := _CUSTOM_ID.match(str(q.get("id") or "")))
    ]
    return f"c{max(taken, default=0) + 1}"


def question_in_use(scorecards: list[dict] | None, question_id: str) -> bool:
    for card in scorecards or []:
        for entry in (card or {}).get("questions") or []:
            if entry.get("question_id") != question_id:
                continue
            if entry.get("rating") is not None or str(entry.get("notes") or "").strip():
                return True
    return False


async def _stored_guide(db, candidate_id: str) -> dict | None:
    doc = await db.candidates.find_one({"candidate_id": candidate_id}, {"_id": 0, "interview_guide": 1})
    return (doc or {}).get("interview_guide")


async def add_custom_question(
    db, candidate_id: str, *, text, dimension, listen_for, actor: str | None,
) -> dict:
    question = clean_custom_question(text, dimension, listen_for)
    for _attempt in range(3):
        guide = await _stored_guide(db, candidate_id)
        questions = (guide or {}).get("questions") or []
        if len(questions) >= MAX_COUNT:
            raise GuideEditError(f"A guide can hold at most {MAX_COUNT} questions.", 409)
        doc = {"id": _next_custom_id(questions), **question}
        if guide is None:
            created = {
                "questions": [doc],
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "generated_by": actor,
                "model": None,
                "fallback": False,
            }
            result = await db.candidates.update_one(
                {"candidate_id": candidate_id, "interview_guide": None},
                {"$set": {"interview_guide": created}},
            )
        else:
            result = await db.candidates.update_one(
                {
                    "candidate_id": candidate_id,
                    "interview_guide.questions.id": {"$ne": doc["id"]},
                    f"interview_guide.questions.{MAX_COUNT - 1}": {"$exists": False},
                },
                {"$push": {"interview_guide.questions": doc}},
            )
        if result.matched_count:
            return with_sources(await _stored_guide(db, candidate_id))
    raise GuideEditError(CHANGED_MESSAGE, 409)


async def delete_question(db, candidate: dict, question_id: str) -> dict:
    candidate_id = candidate["candidate_id"]
    guide = candidate.get("interview_guide") or {}
    if not any(isinstance(q, dict) and q.get("id") == question_id for q in guide.get("questions") or []):
        raise GuideEditError("Question not found.", 404)
    if question_in_use(candidate.get("interview_scorecards"), question_id):
        raise GuideEditError(IN_USE_MESSAGE, 409)

    unmarked = {"$not": {"$elemMatch": {"questions": {"$elemMatch": {
        "question_id": question_id,
        "$or": [{"rating": {"$ne": None}}, {"notes": {"$nin": [None, ""]}}],
    }}}}}
    result = await db.candidates.update_one(
        {"candidate_id": candidate_id, "interview_guide.questions.id": question_id, "interview_scorecards": unmarked},
        {"$pull": {"interview_guide.questions": {"id": question_id}}},
    )
    if not result.matched_count:
        fresh = await db.candidates.find_one({"candidate_id": candidate_id}, {"_id": 0, "interview_guide": 1, "interview_scorecards": 1}) or {}
        if question_in_use(fresh.get("interview_scorecards"), question_id):
            raise GuideEditError(IN_USE_MESSAGE, 409)
        if not any(q.get("id") == question_id for q in (fresh.get("interview_guide") or {}).get("questions") or []):
            raise GuideEditError("Question not found.", 404)
        raise GuideEditError(CHANGED_MESSAGE, 409)

    try:
        await db.candidates.update_one(
            {"candidate_id": candidate_id, "interview_scorecards.0": {"$exists": True}},
            {"$pull": {"interview_scorecards.$[].questions": {"question_id": question_id}}},
        )
    except Exception as exc:
        logger.warning("interview guide: blank marks not removed | candidate=%s error=%s", candidate_id, exc)

    remaining = await _stored_guide(db, candidate_id) or {}
    if not remaining.get("questions"):
        await db.candidates.update_one(
            {"candidate_id": candidate_id, "interview_guide.questions": {"$size": 0}},
            {"$set": {"interview_guide": None}},
        )
        remaining = {**(remaining or guide), "questions": []}
    return with_sources(remaining)


async def reorder_questions(db, candidate: dict, ids: list[str]) -> dict:
    guide = candidate.get("interview_guide") or {}
    questions = guide.get("questions") or []
    if not questions:
        raise GuideEditError("This candidate has no interview guide yet.", 404)
    current = [q.get("id") for q in questions]
    if len(ids) != len(current) or set(ids) != set(current):
        raise GuideEditError("The order must list every question exactly once.", 422)
    by_id = {q["id"]: q for q in questions}
    result = await db.candidates.update_one(
        {"candidate_id": candidate["candidate_id"], "interview_guide.questions": questions},
        {"$set": {"interview_guide.questions": [by_id[i] for i in ids]}},
    )
    if not result.matched_count:
        raise GuideEditError(CHANGED_MESSAGE, 409)
    return with_sources(await _stored_guide(db, candidate["candidate_id"]))


_SUMMARY_SYSTEM = (
    "You write the summary of an interview scorecard for a hiring team. You use ONLY the "
    "marks and notes you are given. You never add a fact, name, employer, skill, project, "
    "number or score that is not written in them. Never use the em dash character."
)

_SUMMARY_PROMPT = """{marks}

Write a neutral summary of {low} to {high} words in plain prose, in the third person ("The candidate ..."). No bullet points, no headings.
Rules:
- Use only the marks and notes above.
- Do not add any fact, name, employer, skill, project or score that is not written above.
- If the notes are thin, write less rather than guess.
- Do not use the em dash character.
Return the summary text only."""


def build_summary_marks(
    *, ratings: dict, questions: list[dict], strengths: str, concerns: str, recommendation: str | None,
) -> str:
    lines: list[str] = []
    if ratings:
        lines.append("Area ratings from the interviewer (scale 1 to 5):")
        lines += [f"- {DIMENSION_LABELS[k]}: {ratings[k]}" for k in RATING_KEYS if k in ratings]
    marked = [q for q in questions if q.get("rating") is not None or q.get("notes")]
    if marked:
        lines.append("Question marks from the interviewer:")
        for q in marked:
            rating = f"{q['rating']}/5" if q.get("rating") is not None else "not rated"
            note = f" Notes: {' '.join(q['notes'].split())}" if q.get("notes") else ""
            lines.append(f"- [{DIMENSION_LABELS.get(q['dimension'], q['dimension'])}] \"{q['text']}\": {rating}.{note}")
    if strengths:
        lines.append(f"Strengths noted by the interviewer:\n{strengths}")
    if concerns:
        lines.append(f"Concerns noted by the interviewer:\n{concerns}")
    if recommendation:
        lines.append(f"Interviewer's recommendation: {recommendation.replace('_', ' ')}")
    return "\n".join(lines)


def _trim_words(text: str, limit: int) -> str:
    words = text.split()
    if len(words) <= limit:
        return text
    cut = " ".join(words[:limit])
    sentence_end = max(cut.rfind("."), cut.rfind("!"), cut.rfind("?"))
    if sentence_end > len(cut) // 2:
        return cut[: sentence_end + 1]
    return cut.rstrip(",;:") + "."


async def draft_summary(
    *,
    candidate_id: str | None,
    ratings: dict,
    questions: list[dict],
    strengths: str,
    concerns: str,
    recommendation: str | None,
) -> str:
    marks = build_summary_marks(
        ratings=ratings, questions=questions, strengths=strengths,
        concerns=concerns, recommendation=recommendation,
    )
    prompt = _SUMMARY_PROMPT.format(marks=marks, low=SUMMARY_MIN_WORDS, high=SUMMARY_MAX_WORDS)
    try:
        async with track_llm_cost("interview_summary_draft", ref_id=candidate_id):
            raw = await ask_llm(
                prompt=prompt,
                system=_SUMMARY_SYSTEM,
                model=model_for("interview_guide"),
                max_tokens=400,
                temperature=0.2,
                timeout=_SUMMARY_LLM_TIMEOUT_SECONDS,
            )
    except Exception as exc:
        logger.warning("interview summary draft failed | candidate=%s error=%s", candidate_id, exc)
        raw = ""

    text = raw if isinstance(raw, str) else ""
    text = re.sub(r"^```[a-zA-Z]*\s*|\s*```$", "", text.strip()).strip().strip('"').strip()
    text = strip_em_dashes(" ".join(text.split()))
    if not text or text in ("{}", "[]"):
        raise DraftSummaryUnavailable("The summary could not be drafted right now. Write it yourself or try again.")
    return _trim_words(text, SUMMARY_MAX_WORDS)
