"""
Resume processing agent — hr_module.

Pipeline:
  extract_text → check_duplicate → classify → embed → match_jds → store → auto_invite

New in v3:
  - store_node extracts candidate email + name and returns them to state
  - auto_invite_node fires invite_service for any JD match >= AUTO_INVITE_THRESHOLD
  - matched_jds stored as [{job_id, score}] dicts (richer than plain id list)
"""
from __future__ import annotations

from typing import TypedDict

from langgraph.graph import END, StateGraph

from .base_agent import append_trace, error_node, log_node


class ResumeState(TypedDict, total=False):
    resume_id: str
    filename: str
    batch_id: str | None
    raw_bytes: bytes
    text: str
    classification: dict
    embedding: list
    matched_jds: list
    candidate_name: str | None
    candidate_email: str | None
    stored: bool
    duplicate: str | None
    auto_invited: bool
    invited_candidate_ids: list
    model_override: str | None
    error: str | None
    trace: list


@log_node("extract_text")
async def extract_text_node(state: ResumeState) -> dict:
    from services.hr_module.resume_intel import extract_text
    try:
        text = await extract_text(state["raw_bytes"], state["filename"])
        return {"text": text, **append_trace(state, "text_extracted")}
    except Exception as exc:
        return {"error": str(exc)}


@log_node("check_duplicate")
async def check_duplicate_node(state: ResumeState) -> dict:
    """Stop processing if this resume already exists (exact file or same content).
    Runs right after extraction so duplicates never reach the costly LLM steps."""
    from services.hr_module.resume_intel import check_duplicate
    try:
        existing = await check_duplicate(
            state.get("raw_bytes", b""),
            state.get("text"),
            exclude_resume_id=state.get("resume_id"),
        )
        if existing:
            return {"duplicate": existing, **append_trace(state, f"duplicate:{existing}")}
        return append_trace(state, "not_duplicate")
    except Exception:
        return append_trace(state, "dedup_check_skipped")


@log_node("classify")
async def classify_node(state: ResumeState) -> dict:
    from services.hr_module.classifier import classify_resume
    try:
        cls = await classify_resume(state["text"], state.get("model_override"))
        return {"classification": cls, **append_trace(state, "classified")}
    except Exception as exc:
        return {"error": str(exc)}


@log_node("embed")
async def embed_node(state: ResumeState) -> dict:
    from config.llm import get_embedding
    try:
        vec = await get_embedding(state["text"])
        return {"embedding": vec, **append_trace(state, "embedded")}
    except Exception as exc:
        return {"error": str(exc)}


@log_node("match_jds")
async def match_jds_node(state: ResumeState) -> dict:
    from services.hr_module.matcher import match_resume_to_jds
    try:
        jds = await match_resume_to_jds(
            resume_id=state["resume_id"],
            embedding=state["embedding"],
            classification=state["classification"],
        )
        return {"matched_jds": jds, **append_trace(state, f"matched_{len(jds)}_jds")}
    except Exception as exc:
        return {"error": str(exc)}


@log_node("store")
async def store_node(state: ResumeState) -> dict:
    from services.hr_module.resume_intel import store_resume
    try:
        extras = await store_resume(state)
        return {
            "stored": True,
            "candidate_name": extras.get("candidate_name"),
            "candidate_email": extras.get("candidate_email"),
            **append_trace(state, "stored"),
        }
    except Exception as exc:
        return {"error": str(exc)}


@log_node("auto_invite")
async def auto_invite_node(state: ResumeState) -> dict:
    """
    Non-fatal node: fires auto-invite if match score >= AUTO_INVITE_THRESHOLD.
    Never sets error — the resume is already stored and matched by this point,
    so a failed invite must not turn the whole ingest into a failure.
    """
    from services.hr_module.invite_service import auto_invite_if_qualified
    try:
        invited = await auto_invite_if_qualified(
            resume_id=state["resume_id"],
            matched_jds=state.get("matched_jds", []),
            candidate_email=state.get("candidate_email"),
            candidate_name=state.get("candidate_name"),
        )
        return {
            "auto_invited": len(invited) > 0,
            "invited_candidate_ids": invited,
            **append_trace(state, f"auto_invited:{len(invited)}"),
        }
    except Exception as exc:
        return {
            "auto_invited": False,
            "invited_candidate_ids": [],
            **append_trace(state, f"invite_error:{exc}"),
        }


def _route(state: ResumeState) -> str:
    return "error_node" if state.get("error") else "continue"


def _dup_route(state: ResumeState) -> str:
    if state.get("error"):
        return "error_node"
    return "duplicate" if state.get("duplicate") else "continue"


def build_resume_agent():
    graph = StateGraph(ResumeState)
    graph.add_node("extract_text", extract_text_node)
    graph.add_node("check_duplicate", check_duplicate_node)
    graph.add_node("classify", classify_node)
    graph.add_node("embed", embed_node)
    graph.add_node("match_jds", match_jds_node)
    graph.add_node("store", store_node)
    graph.add_node("auto_invite", auto_invite_node)
    graph.add_node("error_node", error_node)

    graph.set_entry_point("extract_text")
    graph.add_conditional_edges("extract_text", _route, {"continue": "check_duplicate", "error_node": "error_node"})
    graph.add_conditional_edges("check_duplicate", _dup_route, {"continue": "classify", "duplicate": END, "error_node": "error_node"})
    graph.add_conditional_edges("classify",      _route, {"continue": "embed",      "error_node": "error_node"})
    graph.add_conditional_edges("embed",         _route, {"continue": "match_jds", "error_node": "error_node"})
    graph.add_conditional_edges("match_jds",     _route, {"continue": "store",     "error_node": "error_node"})
    graph.add_conditional_edges("store",         _route, {"continue": "auto_invite","error_node": "error_node"})
    graph.add_edge("auto_invite", END)
    graph.add_edge("error_node", END)
    return graph.compile()
