"""Base primitives shared by all LangGraph agents."""
from __future__ import annotations

import logging
from functools import wraps
from typing import TypedDict

logger = logging.getLogger(__name__)


class BaseState(TypedDict, total=False):
    error: str | None
    model_override: str | None
    trace: list[str]


def log_node(name: str):
    """Log every graph node entry/exit without mutating the graph state."""
    def decorator(fn):
        @wraps(fn)
        async def wrapper(state: dict, *args, **kwargs) -> dict:
            logger.debug("node:%s:start", name)
            result = await fn(state, *args, **kwargs)
            logger.debug("node:%s:end", name)
            return result
        return wrapper
    return decorator


def append_trace(state: dict, msg: str) -> dict:
    trace = list(state.get("trace") or [])
    trace.append(msg)
    return {"trace": trace}


def route_on_error(state: dict) -> str:
    return "error_node" if state.get("error") else "continue"


async def error_node(state: dict) -> dict:
    logger.error("Agent error | msg=%s | trace=%s", state.get("error"), state.get("trace"))
    return state
