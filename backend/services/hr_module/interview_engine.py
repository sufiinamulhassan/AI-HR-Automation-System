import json
import logging
import random

from config.llm import ask_llm, model_for
from config.settings import settings
from services.hr_module.prompt_config_service import get_prompt_override
from services.hr_module.prompt_guard import fence, with_guard

logger = logging.getLogger(__name__)

_DEFAULT_QUESTIONS = [
    "Tell me about yourself and your background.",
    "What interests you most about this role?",
    "Describe a challenging technical problem you solved recently.",
    "How do you approach learning new technologies?",
    "Describe a time you worked under tight deadlines.",
    "How do you handle disagreements within a team?",
    "What's your experience with system design and scalability?",
    "Describe your debugging process for a production issue.",
    "What projects are you most proud of?",
    "Where do you see yourself in 3-5 years?",
]

_GEN_SYSTEM = (
    "You are a senior technical interviewer. Generate targeted interview questions based "
    "on the job description and candidate's resume. Return ONLY a JSON object."
)

_GEN_PROMPT = """Job Title: {title}
Difficulty: {difficulty}
{seniority_line}Job Description:
{jd}
{skills_line}{topics_line}{stage_line}{angle_line}
Candidate Resume (excerpt):
{resume}

Generate {count} interview questions covering:
1. Personal intro & motivation (2 questions)
2. Technical skills specific to this role (5 questions)
3. Past projects & achievements (3 questions)
4. Problem-solving & system design (3 questions)
5. Team dynamics & soft skills (2 questions)

Return JSON: {{"questions": ["question1", "question2", ...]}}"""

_QUESTION_ANGLES = [
    "Frame at least one technical question around a concrete hypothetical scenario rather than an abstract definition.",
    "Ask one question as a compare-and-contrast between two plausible approaches to the same problem.",
    "Phrase at least one question around a tradeoff the candidate would have to weigh, not just a fact to recall.",
    "Ask one question that starts from a small code or design snippet and asks the candidate to critique or extend it.",
    "Frame one question around debugging or fixing something that is already subtly wrong, rather than building from scratch.",
    "Ask one question that asks the candidate to compare their preferred tool or approach against an alternative they have used.",
]

_STAGE_EMPHASIS = {
    "basic": "This is an early, basic-screening stage: keep questions broad and fundamentals-focused; avoid deep specialization.\n",
    "technical": "This is a technical-screening stage: weight questions toward depth: technical skills, problem-solving, and system design.\n",
    "level2": "This is a later-stage, in-depth interview: favor harder technical/system-design questions and probe past decisions more deeply.\n",
}

_EVAL_SYSTEM = (
    "You are an expert HR evaluator. Assess the interview transcript and return a structured "
    "JSON evaluation. Be fair, specific, and evidence-based."
)

_EVAL_LLM_TIMEOUT_SECONDS = 40.0

_EVAL_PROMPT = """Job: {title}
Transcript:
{transcript}

Integrity flags: {flags}

Return JSON:
{{
  "overall_score": <0-100>,
  "technical_score": <0-100>,
  "technical_rationale": "<2-3 sentences, evidence-based: cite specifics from the transcript that justify technical_score>",
  "communication_score": <0-100>,
  "communication_rationale": "<2-3 sentences, evidence-based: cite specifics from the transcript that justify communication_score>",
  "problem_solving_score": <0-100>,
  "problem_solving_rationale": "<2-3 sentences, evidence-based: cite specifics from the transcript that justify problem_solving_score>",
  "cultural_fit_score": <0-100>,
  "cultural_fit_rationale": "<2-3 sentences, evidence-based: cite specifics from the transcript that justify cultural_fit_score>",
  "confidence_score": <0-100, how confident and composed the candidate appeared>,
  "confidence_rationale": "<2-3 sentences, evidence-based: cite specifics from the transcript that justify confidence_score>",
  "strengths": ["strength1", ...],
  "areas_for_improvement": ["area1", ...],
  "recommendation": "<hire|maybe|reject>",
  "summary": "<2-3 sentence narrative>",
  "integrity_assessment": "<comment on any integrity flags>"
}}"""

_FOLLOWUP_SYSTEM = (
    "You are a senior technical interviewer deciding whether a candidate's answer "
    "needs a follow-up probe. Return ONLY a JSON object."
)

_FOLLOWUP_PROMPT = """Job Title: {title}
Job Description:
{jd}

Interview Question: {question}
Candidate Answer: {answer}

Decide whether this answer is vague, very short, or superficial for a technical or
behavioral interview question and would benefit from a natural, specific probing
follow-up question. If the answer is already sufficiently detailed and specific,
no follow-up is needed.

Return JSON:
{{
  "needs_followup": <true|false>,
  "followup_question": "<a natural, specific probing follow-up question, or null if not needed>"
}}"""

_PROBE_SYSTEM = (
    "You are a senior technical interviewer probing whether a candidate genuinely "
    "understands the answer they just gave, as a check against answers that were "
    "copied or generated by an external assistant rather than reasoned through live. "
    "Return ONLY a JSON object."
)

_PROBE_PROMPT = """Job Title: {title}
Job Description:
{jd}

Interview Question: {question}
Candidate Answer: {answer}
{prior_answer_line}
Pose ONE probing follow-up that tests genuine understanding rather than recall -
pick whichever of these fits best:
- Ask WHY they chose that particular approach over a plausible alternative.
- Change one condition or constraint in the original question and ask how their
  answer would change as a result.
- Ask them to explain an edge case or tradeoff their answer did not address.
{consistency_line}
Return JSON:
{{
  "probe_question": "<the follow-up question to ask the candidate>",
  "probe_type": "<one of: why | changed_condition | edge_case_tradeoff>",
  "consistency_assessment": "<null, unless a prior answer to the same question was supplied above: in that case, a short note on whether the two answers are consistent with each other>"
}}"""


async def generate_questions(
    job: dict,
    candidate: dict,
    model: str | None = None,
    interview_stage: str | None = None,
) -> list[str]:
    resume_text = ""
    seniority = ""
    if candidate.get("resume_id"):
        from config.database import get_db
        db = get_db()
        if db is not None:
            resume = await db.resumes.find_one({"resume_id": candidate["resume_id"]})
            if resume:
                resume_text = (resume.get("text") or "")[:2000]
                seniority = resume.get("seniority_level") or ""

    seniority_line = (
        f"Candidate experience level (classified from their resume): {seniority}. "
        "Pitch technical depth and scope of ownership to this level.\n"
        if seniority else ""
    )

    criteria = job.get("parsed_criteria") or {}

    skills = criteria.get("skills") or (job.get("targeting") or {}).get("required_skills") or []
    skills_line = f"Required skills for this role: {', '.join(str(s) for s in skills[:20])}\n" if skills else ""

    topics = criteria.get("interview_topics") or []
    topics_line = f"Focus areas called out in the job posting: {', '.join(topics)}\n" if topics else ""

    scenario_id = candidate.get("scenario_id")
    if scenario_id:
        from services.hr_module.scenario_service import get_scenario, build_scenario_prompt_addition
        scenario = await get_scenario(scenario_id)
        if scenario:
            topics_line += build_scenario_prompt_addition(scenario) + "\n"

    angle_line = f"{random.choice(_QUESTION_ANGLES)}\n"
    stage_line = _STAGE_EMPHASIS.get(interview_stage, "")

    format_kwargs = dict(
        title=job.get("title", ""),
        difficulty=job.get("difficulty", "medium"),
        seniority_line=seniority_line,
        jd=fence("JOB DESCRIPTION", (job.get("description") or "")[:2000]),
        skills_line=skills_line,
        topics_line=topics_line,
        stage_line=stage_line,
        angle_line=angle_line,
        resume=fence("RESUME", resume_text or "No resume available"),
        count=settings.INTERVIEW_QUESTION_COUNT,
    )

    gen_system = _GEN_SYSTEM
    prompt = _GEN_PROMPT.format(**format_kwargs)
    override = await get_prompt_override("interview_questions")
    if override and override.get("system_prompt") and override.get("user_prompt_template"):
        try:
            prompt = override["user_prompt_template"].format(**format_kwargs)
            gen_system = override["system_prompt"]
        except (KeyError, IndexError, ValueError) as exc:
            logger.warning(
                "interview_questions prompt override has a placeholder mismatch, "
                "falling back to default: %s", exc,
            )
            gen_system = _GEN_SYSTEM
            prompt = _GEN_PROMPT.format(**format_kwargs)

    raw = await ask_llm(
        prompt=prompt,
        system=with_guard(gen_system),
        model=model_for("interview", model),
        max_tokens=1500,
        temperature=0.4,
        json_mode=True,
    )

    try:
        parsed = json.loads(raw)
        questions = parsed.get("questions", parsed) if isinstance(parsed, dict) else parsed
        if isinstance(questions, list) and questions:
            return [str(q) for q in questions]
    except (json.JSONDecodeError, ValueError):
        pass

    logger.warning("Using default questions for job %s", job.get("job_id"))
    return _DEFAULT_QUESTIONS


def format_transcript(transcript: list[dict]) -> str:
    lines: list[str] = []
    for msg in transcript:
        if not isinstance(msg, dict):
            continue
        question = msg.get("question")
        answer = msg.get("answer")
        if question or answer:
            lines.append(f"[INTERVIEWER]: {question or ''}")
            lines.append(f"[CANDIDATE]: {answer or ''}")
            continue
        content = msg.get("content")
        if content:
            lines.append(f"[{str(msg.get('role', 'unknown')).upper()}]: {content}")
    return "\n".join(lines)


async def _attach_coding_scores(report: dict, candidate: dict) -> None:
    candidate_id = candidate.get("candidate_id")
    if not candidate_id:
        return
    try:
        from config.database import get_db
        db = get_db()
        if db is None:
            return
        submission = await db.coding_submissions.find_one(
            {"candidate_id": candidate_id, "status": "completed"},
            sort=[("submitted_at", -1)],
        )
        if not submission:
            return
        if submission.get("score") is not None:
            report["coding_score"] = submission["score"]
        if submission.get("quality_score") is not None:
            report["coding_quality_score"] = submission["quality_score"]
        if submission.get("coding_integrity_score") is not None:
            report["coding_integrity_score"] = submission["coding_integrity_score"]
        report["coding_submission_id"] = submission.get("submission_id")
    except Exception as exc:
        logger.warning("Could not attach coding scores for candidate=%s: %s", candidate_id, exc)


async def evaluate_interview(
    transcript: list[dict],
    job: dict,
    candidate: dict,
    integrity_flags: list[str],
    model: str | None = None,
) -> tuple[float, dict]:
    transcript_text = format_transcript(transcript)
    flags_text = ", ".join(integrity_flags) if integrity_flags else "None"

    if not transcript_text.strip():
        logger.warning(
            "Interview evaluation skipped: transcript has no usable question/answer "
            "content | candidate=%s entries=%d",
            candidate.get("candidate_id"), len(transcript or []),
        )
        return 0.0, {
            "evaluation_status": "insufficient_transcript",
            "recommendation": "maybe",
            "summary": (
                "No answer content was captured for this interview, so no scores "
                "could be derived. Review the session recording or re-invite the "
                "candidate before making a decision."
            ),
            "strengths": [],
            "areas_for_improvement": [],
            "integrity_assessment": (
                f"Integrity flags recorded: {flags_text}."
                if integrity_flags else "No integrity flags to report."
            ),
            "integrity_score": compute_integrity_score(integrity_flags),
        }

    format_kwargs = dict(
        title=job.get("title", "Unknown Role"),
        transcript=fence("TRANSCRIPT", transcript_text[:6000]),
        flags=flags_text,
    )

    eval_system = _EVAL_SYSTEM
    eval_prompt = _EVAL_PROMPT.format(**format_kwargs)
    override = await get_prompt_override("interview_eval")
    if override and override.get("system_prompt") and override.get("user_prompt_template"):
        try:
            eval_prompt = override["user_prompt_template"].format(**format_kwargs)
            eval_system = override["system_prompt"]
        except (KeyError, IndexError, ValueError) as exc:
            logger.warning(
                "interview_eval prompt override has a placeholder mismatch, "
                "falling back to default: %s", exc,
            )
            eval_system = _EVAL_SYSTEM
            eval_prompt = _EVAL_PROMPT.format(**format_kwargs)

    raw = await ask_llm(
        prompt=eval_prompt,
        system=with_guard(eval_system),
        model=model_for("interview", model),
        max_tokens=1200,
        temperature=0.2,
        json_mode=True,
        timeout=_EVAL_LLM_TIMEOUT_SECONDS,
    )

    try:
        report = json.loads(raw)
    except json.JSONDecodeError:
        report = {
            "overall_score": 50,
            "recommendation": "maybe",
            "summary": "Evaluation could not be parsed.",
        }
    report.setdefault("overall_score", 50)
    report.setdefault("technical_score", 50)
    report.setdefault("technical_rationale", "")
    report.setdefault("communication_score", 50)
    report.setdefault("communication_rationale", "")
    report.setdefault("problem_solving_score", 50)
    report.setdefault("problem_solving_rationale", "")
    report.setdefault("cultural_fit_score", 50)
    report.setdefault("cultural_fit_rationale", "")
    report.setdefault("confidence_score", 50)
    report.setdefault("confidence_rationale", "")
    report.setdefault("strengths", [])
    report.setdefault("areas_for_improvement", [])
    report.setdefault("recommendation", "maybe")
    report.setdefault("summary", "Evaluation was generated with limited available signal.")
    report.setdefault("integrity_assessment", "No integrity flags to report.")
    report["integrity_score"] = compute_integrity_score(integrity_flags)
    await _attach_coding_scores(report, candidate)

    scenario_id = candidate.get("scenario_id")
    if scenario_id:
        from services.hr_module.scenario_service import get_scenario, score_scenario_response
        scenario = await get_scenario(scenario_id)
        if scenario:
            report["scenario_scores"] = await score_scenario_response(transcript, scenario, model=model)

    breakdown = compute_score_breakdown(
        dimension_scores={
            "technical": {"score": report["technical_score"], "rationale": report["technical_rationale"]},
            "communication": {"score": report["communication_score"], "rationale": report["communication_rationale"]},
            "problem_solving": {"score": report["problem_solving_score"], "rationale": report["problem_solving_rationale"]},
            "cultural_fit": {"score": report["cultural_fit_score"], "rationale": report["cultural_fit_rationale"]},
            "confidence": {"score": report["confidence_score"], "rationale": report["confidence_rationale"]},
        },
        integrity_score=report["integrity_score"],
        integrity_flags=integrity_flags,
    )
    report["score_breakdown"] = breakdown
    report["final_score"] = breakdown["final_score"]

    score = float(report.get("overall_score", 50))
    return score, report


async def generate_followup(
    question: str,
    answer: str,
    job: dict,
    model: str | None = None,
) -> str | None:
    raw = await ask_llm(
        prompt=_FOLLOWUP_PROMPT.format(
            title=job.get("title", "Unknown Role"),
            jd=fence("JOB DESCRIPTION", (job.get("description") or "")[:1500]),
            question=question,
            answer=fence("CANDIDATE ANSWER", answer),
        ),
        system=with_guard(_FOLLOWUP_SYSTEM),
        model=model_for("interview", model),
        max_tokens=300,
        temperature=0.3,
        json_mode=True,
    )

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return None

    if not isinstance(parsed, dict):
        return None
    if not parsed.get("needs_followup"):
        return None
    followup = parsed.get("followup_question")
    if not followup or not isinstance(followup, str):
        return None
    return followup


async def generate_reasoning_probe(
    question: str,
    answer: str,
    job: dict,
    prior_answer: str | None = None,
    model: str | None = None,
) -> dict | None:
    prior_answer_line = (
        f"\nThe candidate gave this answer to the SAME question earlier in the interview: "
        f"{fence('EARLIER ANSWER', prior_answer)}\n"
        if prior_answer else ""
    )
    consistency_line = (
        "Also assess whether this answer is consistent with their earlier one on this "
        "same question." if prior_answer else ""
    )
    raw = await ask_llm(
        prompt=_PROBE_PROMPT.format(
            title=job.get("title", "Unknown Role"),
            jd=fence("JOB DESCRIPTION", (job.get("description") or "")[:1500]),
            question=question,
            answer=fence("CANDIDATE ANSWER", answer),
            prior_answer_line=prior_answer_line,
            consistency_line=consistency_line,
        ),
        system=with_guard(_PROBE_SYSTEM),
        model=model_for("interview", model),
        max_tokens=300,
        temperature=0.3,
        json_mode=True,
    )

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(parsed, dict):
        return None

    probe_question = parsed.get("probe_question")
    if not probe_question or not isinstance(probe_question, str):
        return None

    probe_type = parsed.get("probe_type")
    consistency_assessment = parsed.get("consistency_assessment")
    return {
        "probe_question": probe_question,
        "probe_type": probe_type if isinstance(probe_type, str) else None,
        "consistency_assessment": consistency_assessment if isinstance(consistency_assessment, str) else None,
    }


from services.hr_module.integrity import (
    _INTEGRITY_UNKNOWN_WEIGHT,
    _INTEGRITY_WEIGHTS,
    compute_integrity_score,
)


def compute_score_breakdown(
    dimension_scores: dict,
    integrity_score: int,
    integrity_flags: list[str],
) -> dict:
    weights = settings.SCORE_DIMENSION_WEIGHTS
    floor = settings.INTEGRITY_MULTIPLIER_FLOOR

    dimensions = []
    weighted_sum = 0.0
    for name, weight in weights.items():
        entry = dimension_scores.get(name) or {}
        dim_score = entry.get("score") or 0
        dimensions.append({
            "name": name,
            "score": dim_score,
            "weight": weight,
            "rationale": entry.get("rationale") or "",
        })
        weighted_sum += dim_score * weight

    integrity_deductions = []
    for flag in integrity_flags or []:
        if not flag:
            continue
        event, _, timestamp = str(flag).partition("@")
        points = _INTEGRITY_WEIGHTS.get(event, _INTEGRITY_UNKNOWN_WEIGHT)
        if points:
            integrity_deductions.append({
                "event": event,
                "timestamp": timestamp or None,
                "points": points,
            })

    integrity_multiplier = floor + (1 - floor) * integrity_score / 100
    final_score = round(weighted_sum * integrity_multiplier)

    return {
        "dimensions": dimensions,
        "integrity_deductions": integrity_deductions,
        "integrity_multiplier": round(integrity_multiplier, 4),
        "final_score": final_score,
    }


def resolve_report_status(candidate: dict) -> str | None:
    status = candidate.get("report_status")
    if status is None and candidate.get("report") is not None:
        return "ready"
    return status


__all__ = [
    "generate_questions",
    "evaluate_interview",
    "format_transcript",
    "generate_followup",
    "compute_integrity_score",
    "compute_score_breakdown",
    "resolve_report_status",
]
