import json
import logging
import re

from config.settings import settings
from services.hr_module.matcher import _SENIORITY_FLEX, _seniority_ok, _skills_jaccard
from services.hr_module.prompt_guard import fence, with_guard
from shared.utils import strip_em_dashes

logger = logging.getLogger(__name__)

MAX_EXTRA_SKILLS = 12
_MAX_PROMPT_SKILLS = 25
_EXCERPT_CHARS = 800
_OPINION_LIST_ITEMS = 6
_OPINION_ITEM_CHARS = 300
_OPINION_TIMEOUT_SECONDS = 30.0


class SecondOpinionError(RuntimeError):
    pass


async def load_fit_context(
    db, job_id: str, resume_id: str, include_text: bool = False
) -> tuple[dict, dict, dict | None]:
    job = await db.jobs.find_one({"job_id": job_id}, {"_id": 0, "embedding": 0})
    if not job:
        raise LookupError("Job not found")
    entry = next(
        (p for p in job.get("candidate_pipeline") or [] if p.get("resume_id") == resume_id),
        None,
    )
    if entry is None:
        raise LookupError("Candidate not found in pipeline")

    projection = {
        "_id": 0, "resume_id": 1, "candidate_name": 1, "classification": 1,
        "job_domain": 1, "seniority_level": 1, "skills": 1,
    }
    if include_text:
        projection.update({"summary": 1, "text": 1})
    resume = await db.resumes.find_one({"resume_id": resume_id}, projection)
    return job, entry, resume


def _clean_skills(skills) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for s in skills or []:
        if not isinstance(s, str):
            continue
        name = s.strip()
        key = name.lower()
        if name and key not in seen:
            seen.add(key)
            out.append(name)
    return out


def _clean_label(value) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip().lower()
    return value or None


def _classification_value(resume: dict | None, key: str):
    resume = resume or {}
    cls = resume.get("classification")
    if isinstance(cls, dict) and cls.get(key):
        return cls[key]
    return resume.get(key)


def job_required_skills(job: dict) -> list[str]:
    targeting = job.get("targeting") or {}
    criteria = job.get("parsed_criteria") or {}
    return _clean_skills(targeting.get("required_skills") or criteria.get("skills"))


def job_required_seniority(job: dict) -> list[str]:
    targeting = job.get("targeting") or {}
    window = targeting.get("required_seniority")
    if isinstance(window, list) and window:
        return [s for s in (_clean_label(x) for x in window) if s]
    level = _clean_label((job.get("parsed_criteria") or {}).get("experience_level"))
    return list(_SENIORITY_FLEX.get(level, [level])) if level else []


def job_required_domain(job: dict) -> str | None:
    targeting = job.get("targeting") or {}
    criteria = job.get("parsed_criteria") or {}
    return _clean_label(targeting.get("required_domain") or criteria.get("job_domain"))


def _no_dashes(text: str) -> str:
    return strip_em_dashes(re.sub(r"\s+–\s+", ", ", text)).replace("–", "-")


def build_fit_breakdown(job: dict, entry: dict, resume: dict | None) -> dict:
    score = float(entry.get("similarity_score") or 0.0)

    required = job_required_skills(job)
    candidate = _clean_skills(_classification_value(resume, "skills"))
    candidate_keys = {s.lower() for s in candidate}
    required_keys = {s.lower() for s in required}

    matched = [s for s in required if s.lower() in candidate_keys]
    missing = [s for s in required if s.lower() not in candidate_keys]
    extra = [s for s in candidate if s.lower() not in required_keys][:MAX_EXTRA_SKILLS]
    coverage = len(matched) / len(required) if required else 0.0

    jaccard = _skills_jaccard(candidate, required)
    skills_boost = min(settings.SKILLS_WEIGHT * jaccard, score)
    semantic_part = max(0.0, score - skills_boost)

    threshold = float(settings.AUTO_INVITE_THRESHOLD)
    above_threshold = score >= threshold

    cand_seniority = _clean_label(_classification_value(resume, "seniority_level"))
    req_seniority = job_required_seniority(job)
    seniority_aligned = (
        _seniority_ok(cand_seniority, req_seniority) if cand_seniority and req_seniority else None
    )

    cand_domain = _clean_label(_classification_value(resume, "job_domain"))
    req_domain = job_required_domain(job)
    domain_aligned = (cand_domain == req_domain) if cand_domain and req_domain else None

    breakdown = {
        "resume_id": entry.get("resume_id"),
        "candidate_name": (resume or {}).get("candidate_name"),
        "score": round(score, 4),
        "semantic_part": round(semantic_part, 4),
        "skills_boost": round(skills_boost, 4),
        "threshold": round(threshold, 4),
        "above_threshold": above_threshold,
        "skills": {
            "matched": matched,
            "missing": missing,
            "extra": extra,
            "coverage": round(coverage, 4),
        },
        "seniority": {
            "candidate": cand_seniority,
            "required": req_seniority,
            "aligned": seniority_aligned,
        },
        "domain": {
            "candidate": cand_domain,
            "required": req_domain,
            "aligned": domain_aligned,
        },
    }
    breakdown["headline"] = _headline(breakdown, len(required))
    return breakdown


def _headline(b: dict, required_count: int) -> str:
    pct = round(b["score"] * 100)
    thr = round(b["threshold"] * 100)
    verdict = "meets" if b["above_threshold"] else "is below"
    parts = [f"{pct}% match, {verdict} the {thr}% match threshold"]

    skills = b["skills"]
    if required_count == 0:
        parts.append("no required skills listed on the job")
    else:
        text = f"covers {len(skills['matched'])} of {required_count} required skills"
        if skills["missing"]:
            shown = ", ".join(skills["missing"][:3])
            more = len(skills["missing"]) - 3
            suffix = f" and {more} more" if more > 0 else ""
            text += f" (missing {shown}{suffix})"
        parts.append(text)

    aligned = b["seniority"]["aligned"]
    parts.append(
        "seniority unknown" if aligned is None
        else "seniority fits" if aligned
        else "seniority is outside the target range"
    )
    aligned = b["domain"]["aligned"]
    parts.append(
        "domain unknown" if aligned is None
        else "domain fits" if aligned
        else "domain differs from the job"
    )
    return _no_dashes("; ".join(parts) + ".")


_OPINION_SYSTEM = (
    "You are a senior technical recruiter giving a hiring team a brief second opinion on how "
    "well one candidate fits one job. Use only the facts provided and never invent experience. "
    "If the facts are thin, say so. Write in plain, direct sentences. Do not use em dashes or "
    "en dashes anywhere in your answer. Return ONLY a JSON object."
)

_OPINION_PROMPT = """Job title: {title}
Required skills: {required}
Target seniority: {req_seniority}
Target domain: {req_domain}

Candidate seniority: {cand_seniority}
Candidate domain: {cand_domain}
Candidate skills: {cand_skills}
Candidate experience: {experience}
Candidate profile excerpt (contact details removed):
{excerpt}

Automated match facts: score {pct}% against a {thr}% match threshold; \
matched skills: {matched}; missing skills: {missing}.

Return JSON with exactly these keys:
{{
  "summary": "<two or three sentences on overall fit>",
  "strengths": ["<up to 4 short points>"],
  "concerns": ["<up to 4 short points>"],
  "follow_up_questions": ["<up to 4 questions to ask in a screening conversation>"]
}}"""

_EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_URL_RE = re.compile(r"(?:https?://|www\.)\S+|\b(?:linkedin|github)\.com/\S*", re.IGNORECASE)
_PHONE_RE = re.compile(r"(?<!\w)\+?\d[\d\s().-]{7,}\d(?!\w)")


def _redact_phone(match: re.Match) -> str:
    return "[phone]" if sum(c.isdigit() for c in match.group()) >= 9 else match.group()


def safe_excerpt(resume: dict | None, limit: int = _EXCERPT_CHARS) -> str:
    resume = resume or {}
    cls = resume.get("classification") if isinstance(resume.get("classification"), dict) else {}
    raw = resume.get("summary") or cls.get("summary") or resume.get("text") or ""
    if not isinstance(raw, str):
        return ""
    text = " ".join(raw[: limit * 3].split())
    text = _EMAIL_RE.sub("[email]", text)
    text = _URL_RE.sub("[link]", text)
    text = _PHONE_RE.sub(_redact_phone, text)
    for token in str(resume.get("candidate_name") or "").split():
        if len(token) >= 3:
            text = re.sub(rf"\b{re.escape(token)}\b", "[name]", text, flags=re.IGNORECASE)
    return text[:limit]


def _clean_items(value) -> list[str]:
    if not isinstance(value, list):
        return []
    out = []
    for item in value:
        if isinstance(item, str) and item.strip():
            out.append(_no_dashes(item.strip())[:_OPINION_ITEM_CHARS])
        if len(out) >= _OPINION_LIST_ITEMS:
            break
    return out


async def generate_second_opinion(
    job: dict, resume: dict | None, fit: dict, resume_id: str
) -> dict:
    from config.llm import ask_llm, model_for, track_llm_cost

    cls = (resume or {}).get("classification")
    cls = cls if isinstance(cls, dict) else {}
    years = cls.get("years_experience")
    education = cls.get("education_level")
    experience = ", ".join(
        x for x in (
            f"{years} years" if years else "",
            f"education: {education}" if education else "",
        ) if x
    ) or "not available"

    skills = fit["skills"]
    prompt = _OPINION_PROMPT.format(
        title=job.get("title") or "not available",
        required=", ".join(job_required_skills(job)[:_MAX_PROMPT_SKILLS]) or "none listed",
        req_seniority=", ".join(fit["seniority"]["required"]) or "not specified",
        req_domain=fit["domain"]["required"] or "not specified",
        cand_seniority=fit["seniority"]["candidate"] or "unknown",
        cand_domain=fit["domain"]["candidate"] or "unknown",
        cand_skills=", ".join(
            _clean_skills(_classification_value(resume, "skills"))[:_MAX_PROMPT_SKILLS]
        ) or "none on file",
        experience=experience,
        excerpt=fence("CANDIDATE PROFILE", safe_excerpt(resume) or "not available"),
        pct=round(fit["score"] * 100),
        thr=round(fit["threshold"] * 100),
        matched=", ".join(skills["matched"]) or "none",
        missing=", ".join(skills["missing"]) or "none",
    )

    model_id = model_for("match_opinion")
    raw = ""
    try:
        async with track_llm_cost("match_second_opinion", resume_id):
            raw = await ask_llm(
                prompt,
                system=with_guard(_OPINION_SYSTEM),
                model=model_id,
                max_tokens=700,
                temperature=0.2,
                json_mode=True,
                timeout=_OPINION_TIMEOUT_SECONDS,
            )
    except Exception as exc:
        logger.warning("match second opinion LLM call failed | resume_id=%s error=%s", resume_id, exc)
        raise SecondOpinionError("the model request failed or timed out") from exc

    try:
        data = json.loads(raw or "")
    except (TypeError, ValueError):
        data = None
    summary = data.get("summary") if isinstance(data, dict) else None
    if not isinstance(summary, str) or not summary.strip():
        logger.warning("match second opinion returned no usable JSON | resume_id=%s", resume_id)
        raise SecondOpinionError("the model returned no usable answer")

    return {
        "summary": _no_dashes(summary.strip())[:1000],
        "strengths": _clean_items(data.get("strengths")),
        "concerns": _clean_items(data.get("concerns")),
        "follow_up_questions": _clean_items(data.get("follow_up_questions")),
        "model": model_id,
    }
