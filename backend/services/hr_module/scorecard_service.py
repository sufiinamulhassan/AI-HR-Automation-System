from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timezone

from services.hr_module.external_interview_service import (
    MIN_SUMMARY_CHARS,
    RATING_ALIASES,
    RATING_KEYS,
    RECOMMENDATIONS,
    ExternalInterviewError,
    is_external,
    normalise_iso,
)
from services.hr_module.interview_engine import compute_score_breakdown

logger = logging.getLogger(__name__)

ROLES = ("hr", "engineer", "hiring_manager", "other")
ROLE_LABELS = {
    "hr": "HR",
    "engineer": "Engineer",
    "hiring_manager": "Hiring manager",
    "other": "Interviewer",
}
DIMENSION_LABELS = {
    "technical": "Technical",
    "communication": "Communication",
    "problem_solving": "Problem solving",
    "cultural_fit": "Cultural fit",
    "confidence": "Confidence",
}
RECOMMENDATION_LABELS = {
    "strong_hire": "Strong hire",
    "hire": "Hire",
    "hold": "Hold",
    "no_hire": "No hire",
}
REPORT_RECOMMENDATION = {"strong_hire": "hire", "hire": "hire", "hold": "maybe", "no_hire": "reject"}

MAX_NOTES_CHARS = 2000
MAX_SUMMARY_CHARS = 4000
MAX_FREE_TEXT_CHARS = 2000
MAX_NAME_CHARS = 120
MAX_QUESTION_MARKS = 60
RATIONALE_NOTE_CHARS = 400

SOURCE_REPORT = "interviewer_scorecard"

MUTABLE_FIELDS = (
    "interviewer_name", "interviewer_role", "updated_at", "questions", "ratings",
    "recommendation", "summary", "strengths", "concerns",
)


def _text(value, *, limit: int, label: str) -> str:
    if value is None:
        return ""
    if not isinstance(value, str):
        raise ExternalInterviewError(f"{label} must be text.")
    text = value.strip()
    if len(text) > limit:
        raise ExternalInterviewError(f"{label} can be at most {limit} characters.")
    return text


clean_text = _text


def _as_rating(value) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    if isinstance(value, int) and 1 <= value <= 5:
        return value
    return None


def normalise_ratings(raw, *, partial: bool = False) -> dict[str, int]:
    data = dict(raw) if isinstance(raw, dict) else {}
    for old, new in RATING_ALIASES.items():
        if old in data and new not in data:
            data[new] = data[old]
    clean: dict[str, int] = {}
    for key in RATING_KEYS:
        value = data.get(key)
        if value is None and partial:
            continue
        rating = _as_rating(value)
        if rating is None:
            raise ExternalInterviewError("Rate every area from 1 to 5.")
        clean[key] = rating
    return clean


def resolve_question_marks(raw, guide: dict | None) -> list[dict]:
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise ExternalInterviewError("Question marks must be a list.")
    if len(raw) > MAX_QUESTION_MARKS:
        raise ExternalInterviewError(f"Mark at most {MAX_QUESTION_MARKS} questions.")
    by_id = {
        q["id"]: q for q in ((guide or {}).get("questions") or [])
        if isinstance(q, dict) and q.get("id")
    }
    seen: set[str] = set()
    entries: list[dict] = []
    for item in raw:
        if not isinstance(item, dict):
            raise ExternalInterviewError("Each question mark needs a question_id.")
        qid = item.get("question_id")
        if not isinstance(qid, str) or qid not in by_id:
            raise ExternalInterviewError(f"Unknown question: {str(qid)[:40]}.")
        if qid in seen:
            raise ExternalInterviewError(f"Question {qid} is marked twice.")
        seen.add(qid)
        rating = item.get("rating")
        if rating is not None:
            rating = _as_rating(rating)
            if rating is None:
                raise ExternalInterviewError(
                    "Rate each question from 1 to 5, or leave it empty if it was not asked."
                )
        entries.append({
            "question_id": qid,
            "text": by_id[qid]["text"],
            "dimension": by_id[qid]["dimension"],
            "rating": rating,
            "notes": _text(item.get("notes"), limit=MAX_NOTES_CHARS, label="Notes"),
        })
    return entries


def build_scorecard(
    *,
    source: str,
    submitted_by: str | None,
    interviewer_name,
    interviewer_role,
    questions,
    ratings,
    recommendation,
    summary,
    strengths,
    concerns,
    guide: dict | None,
    existing: dict | None = None,
    now: datetime | None = None,
) -> dict:
    name = _text(interviewer_name, limit=MAX_NAME_CHARS, label="The name")
    if not name:
        raise ExternalInterviewError("Enter the interviewer's name.")
    role = interviewer_role
    if role not in ROLES:
        raise ExternalInterviewError("Choose a valid interviewer role.")

    clean_ratings = normalise_ratings(ratings)
    entries = resolve_question_marks(questions, guide)
    if recommendation not in RECOMMENDATIONS:
        raise ExternalInterviewError("Choose a recommendation.")
    summary_text = _text(summary, limit=MAX_SUMMARY_CHARS, label="The summary")
    if len(summary_text) < MIN_SUMMARY_CHARS:
        raise ExternalInterviewError(f"Write a summary of at least {MIN_SUMMARY_CHARS} characters.")

    stamp = (now or datetime.now(timezone.utc)).isoformat()
    return {
        "scorecard_id": (existing or {}).get("scorecard_id") or uuid.uuid4().hex,
        "source": source,
        "submitted_by": submitted_by,
        "interviewer_name": name,
        "interviewer_role": role,
        "submitted_at": (existing or {}).get("submitted_at") or stamp,
        "updated_at": stamp,
        "questions": entries,
        "ratings": clean_ratings,
        "recommendation": recommendation,
        "summary": summary_text,
        "strengths": _text(strengths, limit=MAX_FREE_TEXT_CHARS, label="Strengths") or None,
        "concerns": _text(concerns, limit=MAX_FREE_TEXT_CHARS, label="Concerns") or None,
    }


def lock_reason(candidate: dict | None) -> str | None:
    if not is_external(candidate):
        return "This interview was not held on another platform."
    stage = (candidate or {}).get("pipeline_stage")
    if stage in ("hired", "rejected"):
        return f"This candidate is already {stage}, so the scorecards are closed."
    return None


def ordered_scorecards(cards: list[dict] | None) -> list[dict]:
    return sorted(
        (c for c in (cards or []) if isinstance(c, dict)),
        key=lambda c: (0 if c.get("source") == "hr" else 1, c.get("submitted_at") or ""),
    )


def primary_hr_scorecard(cards: list[dict] | None) -> dict | None:
    for card in ordered_scorecards(cards):
        if card.get("source") == "hr":
            return card
    return None


def scorecard_overall(card: dict) -> float:
    values = [card["ratings"][k] for k in RATING_KEYS if k in (card.get("ratings") or {})]
    return round(sum(values) / len(values), 1) if values else 0.0


def _ratings_for(cards: list[dict], key: str) -> list[int]:
    return [c["ratings"][key] for c in cards if key in (c.get("ratings") or {})]


def dimension_score(cards: list[dict], key: str) -> int:
    values = _ratings_for(cards, key)
    if not values:
        return 0
    return (sum(values) * 40 + len(values)) // (2 * len(values))


def build_combined_review(
    cards: list[dict] | None, *, interviewed_at: str | None, existing_review: dict | None = None,
) -> dict | None:
    ordered = ordered_scorecards(cards)
    hr = primary_hr_scorecard(ordered)
    if hr is None:
        return None
    ratings = {
        key: round(sum(values) / len(values), 1)
        for key in RATING_KEYS if (values := _ratings_for(ordered, key))
    }
    all_marks = [v for key in RATING_KEYS for v in _ratings_for(ordered, key)]
    edited = hr.get("updated_at") != hr.get("submitted_at") or bool((existing_review or {}).get("edited"))
    return {
        "ratings": ratings,
        "overall": round(sum(all_marks) / len(all_marks), 1) if all_marks else 0.0,
        "recommendation": hr["recommendation"],
        "summary": hr["summary"],
        "strengths": hr.get("strengths"),
        "concerns": hr.get("concerns"),
        "interviewed_at": interviewed_at,
        "reviewed_by": hr.get("submitted_by"),
        "reviewed_at": hr.get("updated_at"),
        "first_reviewed_at": hr.get("submitted_at"),
        "panel_size": len(ordered),
        "edited": edited,
    }


def _who(card: dict) -> str:
    return f"{card.get('interviewer_name') or 'Interviewer'} ({ROLE_LABELS.get(card.get('interviewer_role'), 'Interviewer')})"


def _short(note: str) -> str:
    flat = " ".join(note.split())
    return flat if len(flat) <= RATIONALE_NOTE_CHARS else flat[:RATIONALE_NOTE_CHARS].rstrip() + "..."


def dimension_rationale(cards: list[dict], key: str) -> str:
    label = DIMENSION_LABELS[key]
    marks = [(c, c["ratings"][key]) for c in cards if key in (c.get("ratings") or {})]
    if not marks:
        return ""
    if len(marks) == 1:
        card, value = marks[0]
        parts = [f"{label} was rated {value} out of 5 by {_who(card)}."]
    else:
        mean = sum(v for _, v in marks) / len(marks)
        who = "; ".join(f"{_who(c)}: {v}" for c, v in marks)
        parts = [f"{label} averaged {mean:.1f} out of 5 across {len(marks)} interviewers ({who})."]
    for card in cards:
        for entry in card.get("questions") or []:
            if entry.get("dimension") != key:
                continue
            rating, note = entry.get("rating"), entry.get("notes") or ""
            if rating is None and not note:
                continue
            mark = f"{rating} out of 5" if rating is not None else "not rated"
            line = f'{_who(card)} on "{entry.get("text")}": {mark}.'
            if note:
                line += f" {_short(note)}"
            parts.append(line)
    return " ".join(parts)


_BULLET = re.compile(r"^\s*(?:[-*•]\s+|•)")


def _lines(cards: list[dict], field: str) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for card in cards:
        for raw in str(card.get(field) or "").splitlines():
            line = _BULLET.sub("", raw).strip()
            if line and line.lower() not in seen:
                seen.add(line.lower())
                out.append(line)
    return out


def integrity_sentence(platform_label: str | None) -> str:
    from services.hr_module.external_interview_service import PHYSICAL, PLATFORM_LABELS

    if platform_label == PLATFORM_LABELS[PHYSICAL]:
        return "No proctoring data exists because this interview was held in person, not in the AI interview room."
    where = f" ({platform_label})" if platform_label else ""
    return (
        "No proctoring data exists because this interview was held on another "
        f"platform{where}, not in the AI interview room."
    )


def build_report(cards: list[dict] | None, *, platform_label: str | None, guide: dict | None = None) -> dict:
    ordered = ordered_scorecards(cards)
    hr = primary_hr_scorecard(ordered)
    if hr is None:
        raise ValueError("A report needs an HR scorecard.")

    scores = {key: dimension_score(ordered, key) for key in RATING_KEYS}
    rationales = {key: dimension_rationale(ordered, key) for key in RATING_KEYS}
    breakdown = compute_score_breakdown(
        dimension_scores={k: {"score": scores[k], "rationale": rationales[k]} for k in RATING_KEYS},
        integrity_score=100,
        integrity_flags=[],
    )

    by_question: dict[str, dict] = {}
    for card in ordered:
        for entry in card.get("questions") or []:
            slot = by_question.setdefault(entry["question_id"], {
                "question_id": entry["question_id"],
                "text": entry.get("text"),
                "dimension": entry.get("dimension"),
                "entries": [],
            })
            slot["entries"].append({
                "by": card.get("interviewer_name"),
                "role": card.get("interviewer_role"),
                "rating": entry.get("rating"),
                "notes": entry.get("notes") or "",
            })
    guide_order = {q.get("id"): i for i, q in enumerate((guide or {}).get("questions") or [])}
    questions = sorted(by_question.values(), key=lambda q: guide_order.get(q["question_id"], len(guide_order)))

    report = {
        "overall_score": breakdown["final_score"],
        "strengths": _lines(ordered, "strengths"),
        "areas_for_improvement": _lines(ordered, "concerns"),
        "recommendation": REPORT_RECOMMENDATION[hr["recommendation"]],
        "interviewer_recommendation": hr["recommendation"],
        "summary": hr["summary"],
        "integrity_assessment": integrity_sentence(platform_label),
        "score_breakdown": breakdown,
        "final_score": breakdown["final_score"],
        "source": SOURCE_REPORT,
        "evaluation_status": SOURCE_REPORT,
        "interview_platform": platform_label,
        "interviewers": [
            {
                "name": c.get("interviewer_name"),
                "role": c.get("interviewer_role"),
                "source": c.get("source"),
                "recommendation": c.get("recommendation"),
                "overall": scorecard_overall(c),
            }
            for c in ordered
        ],
        "questions": questions,
    }
    for key in RATING_KEYS:
        report[f"{key}_score"] = scores[key]
        report[f"{key}_rationale"] = rationales[key]
    return report


async def upsert_hr_scorecard(db, candidate_id: str, card: dict) -> None:
    author = {"source": "hr", "submitted_by": card["submitted_by"]}
    pushed = await db.candidates.update_one(
        {"candidate_id": candidate_id, "interview_scorecards": {"$not": {"$elemMatch": author}}},
        {"$push": {"interview_scorecards": card}},
    )
    if pushed.matched_count:
        return
    await db.candidates.update_one(
        {"candidate_id": candidate_id, "interview_scorecards": {"$elemMatch": author}},
        {"$set": {f"interview_scorecards.$.{k}": card[k] for k in MUTABLE_FIELDS}},
    )


async def rebuild_review_and_report(
    db, candidate_id: str, *, interviewed_at: str | None = None, extra_set: dict | None = None,
) -> dict | None:
    candidate = await db.candidates.find_one({"candidate_id": candidate_id})
    if not candidate:
        return None
    cards = candidate.get("interview_scorecards") or []
    if primary_hr_scorecard(cards) is None:
        return None

    interview = candidate.get("external_interview") or {}
    existing = candidate.get("external_review") or {}
    when = interviewed_at or existing.get("interviewed_at") or interview.get("scheduled_start_at")
    review = build_combined_review(cards, interviewed_at=when, existing_review=existing)
    report = build_report(
        cards, platform_label=interview.get("platform_label"), guide=candidate.get("interview_guide"),
    )

    fields: dict = {
        "external_review": review,
        "external_interview.status": "reviewed",
        "external_interview.no_show": None,
        "report": report,
        "report_status": "ready",
        "report_error": None,
        "eval_score": report["overall_score"],
        "score_breakdown": report["score_breakdown"],
        "final_score": report["final_score"],
    }
    if when:
        fields["interview_ended_at"] = when
    fields.update(extra_set or {})
    await db.candidates.update_one({"candidate_id": candidate_id}, {"$set": fields})
    return {"review": review, "report": report}


async def file_hr_scorecard(
    db, candidate: dict, *, author_email: str, fields: dict, extra_set: dict | None = None,
) -> dict:
    cards = candidate.get("interview_scorecards") or []
    existing = next(
        (c for c in cards if c.get("source") == "hr" and c.get("submitted_by") == author_email), None,
    )
    card = build_scorecard(
        source="hr",
        submitted_by=author_email,
        interviewer_name=fields.get("interviewer_name"),
        interviewer_role=fields.get("interviewer_role"),
        questions=fields.get("questions"),
        ratings=fields.get("ratings"),
        recommendation=fields.get("recommendation"),
        summary=fields.get("summary"),
        strengths=fields.get("strengths"),
        concerns=fields.get("concerns"),
        guide=candidate.get("interview_guide"),
        existing=existing,
    )
    await upsert_hr_scorecard(db, candidate["candidate_id"], card)
    built = await rebuild_review_and_report(
        db, candidate["candidate_id"],
        interviewed_at=normalise_iso(fields.get("interviewed_at")),
        extra_set=extra_set,
    )
    return {"scorecard": card, **(built or {})}
