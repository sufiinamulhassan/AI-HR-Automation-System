"""
Interview preparation and evaluation agents — hr_module.

Two compiled graphs returned by build_interview_agent():
  prepare_graph  → load_context → generate_questions → END
  eval_graph     → evaluate → persist_report → send_status_email → END

IMPORTANT — email policy:
  send_status_email_node sends a short status-only notification to the candidate.
  It NEVER includes scores, recommendations, or report content.
  Those are admin-only and stored confidentially in MongoDB.
"""
from __future__ import annotations

import logging
from typing import TypedDict

from langgraph.graph import END, StateGraph

from .base_agent import append_trace, error_node, log_node

logger = logging.getLogger(__name__)


class InterviewState(TypedDict, total=False):
    secure_token: str
    candidate: dict
    job: dict
    questions: list
    transcript: list
    integrity_flags: list
    eval_score: float
    report: dict
    model_override: str | None
    error: str | None
    trace: list


@log_node("load_context")
async def load_context_node(state: InterviewState) -> dict:
    from config.database import get_db
    db = get_db()
    if db is None:
        return {"error": "db_unavailable"}
    cand = await db.candidates.find_one({"secure_token": state["secure_token"]})
    if not cand:
        return {"error": "candidate_not_found"}
    job = await db.jobs.find_one({"job_id": cand.get("job_id")}) or {}
    return {"candidate": cand, "job": job, **append_trace(state, "context_loaded")}


@log_node("generate_questions")
async def generate_questions_node(state: InterviewState) -> dict:
    from services.hr_module.interview_engine import generate_questions
    try:
        questions = await generate_questions(
            job=state.get("job", {}),
            candidate=state.get("candidate", {}),
            model=state.get("model_override"),
        )
        return {"questions": questions, **append_trace(state, f"questions:{len(questions)}")}
    except Exception as exc:
        return {"error": str(exc)}


@log_node("evaluate")
async def evaluate_node(state: InterviewState) -> dict:
    from services.hr_module.interview_engine import evaluate_interview
    try:
        score, report = await evaluate_interview(
            transcript=state.get("transcript", []),
            job=state.get("job", {}),
            candidate=state.get("candidate", {}),
            integrity_flags=state.get("integrity_flags", []),
            model=state.get("model_override"),
        )
        return {"eval_score": score, "report": report, **append_trace(state, f"score:{score}")}
    except Exception as exc:
        return {"error": str(exc)}


@log_node("persist_report")
async def persist_report_node(state: InterviewState) -> dict:
    """Store full evaluation report in MongoDB. Admin-only — never sent to candidate."""
    import asyncio

    from config.database import get_db
    db = get_db()
    if db is None:
        return {"error": "db_unavailable"}
    cand = await db.candidates.find_one({"secure_token": state["secure_token"]})
    await db.candidates.update_one(
        {"secure_token": state["secure_token"]},
        {"$set": {
            "report": state["report"],
            "eval_score": state["eval_score"],
            "status": "completed",
        }},
    )
    if cand:
        from services.hr_module.workflow_engine import evaluate_and_apply_rules
        asyncio.create_task(evaluate_and_apply_rules(
            trigger_type="interview_completed",
            context={
                "candidate_id": cand.get("candidate_id"), "job_id": cand.get("job_id"),
                "email": cand.get("email"), "candidate_name": cand.get("name"),
                "status": "completed", "pipeline_stage": "completed",
                "score": state.get("eval_score"),
                "secure_token": state.get("secure_token"),
            },
        ))
    return append_trace(state, "report_persisted")


@log_node("send_status_email")
async def send_status_email_node(state: InterviewState) -> dict:
    """
    Send a brief status notification to the candidate.
    Contains ONLY: completion confirmation + 'we'll be in touch' message.
    NO scores, NO recommendation, NO report content.
    """
    from config.database import get_db
    from services.hr_module.email_service import send_interview_status_email
    cand = state.get("candidate", {})
    job = state.get("job", {})
    email = cand.get("email")
    if email:
        try:
            await send_interview_status_email(
                to_email=email,
                candidate_name=cand.get("name", "Candidate"),
                job_title=job.get("title", "the position"),
                db=get_db(),
                candidate_id=cand.get("candidate_id"),
                job_id=cand.get("job_id") or job.get("job_id"),
            )
        except Exception as exc:
            logger.warning("Status email failed | token=%s error=%s", state.get("secure_token"), exc)
    return append_trace(state, "status_email_sent")


def _route(state: InterviewState) -> str:
    return "error_node" if state.get("error") else "continue"


def build_interview_agent():
    """Return (prepare_graph, eval_graph) as compiled LangGraph executables."""
    prepare = StateGraph(InterviewState)
    prepare.add_node("load_context", load_context_node)
    prepare.add_node("generate_questions", generate_questions_node)
    prepare.add_node("error_node", error_node)
    prepare.set_entry_point("load_context")
    prepare.add_conditional_edges("load_context", _route, {"continue": "generate_questions", "error_node": "error_node"})
    prepare.add_conditional_edges("generate_questions", _route, {"continue": END, "error_node": "error_node"})
    prepare.add_edge("error_node", END)

    eval_g = StateGraph(InterviewState)
    eval_g.add_node("evaluate", evaluate_node)
    eval_g.add_node("persist_report", persist_report_node)
    eval_g.add_node("send_status_email", send_status_email_node)
    eval_g.add_node("error_node", error_node)
    eval_g.set_entry_point("evaluate")
    eval_g.add_conditional_edges("evaluate", _route, {"continue": "persist_report", "error_node": "error_node"})
    eval_g.add_conditional_edges("persist_report", _route, {"continue": "send_status_email", "error_node": "error_node"})
    eval_g.add_edge("send_status_email", END)
    eval_g.add_edge("error_node", END)

    return prepare.compile(), eval_g.compile()
