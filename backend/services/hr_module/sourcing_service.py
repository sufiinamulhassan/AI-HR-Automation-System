import math
import re
from typing import Iterable

TIERS = ("strict", "balanced", "broad")

_MAX_SKILLS = 10
_MAX_NICE_TO_HAVE = 8
_MAX_KEYWORDS = 6


def _clean(term: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r'["()]', "", str(term or ""))).strip()


def _quote(term: str) -> str:
    cleaned = _clean(term)
    if not cleaned:
        return ""
    return f'"{cleaned}"' if " " in cleaned else cleaned


def _dedupe(terms: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for term in terms:
        cleaned = _clean(term)
        if not cleaned:
            continue
        key = cleaned.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(cleaned)
    return out


def _or_group(terms: Iterable[str]) -> str:
    quoted = [q for q in (_quote(t) for t in _dedupe(terms)) if q]
    if not quoted:
        return ""
    if len(quoted) == 1:
        return quoted[0]
    return "(" + " OR ".join(quoted) + ")"


def _and_join(parts: Iterable[str]) -> str:
    return " AND ".join(p for p in parts if p)


def build_search_spec(job: dict) -> dict:
    parsed = job.get("parsed_criteria") or {}
    targeting = job.get("targeting") or {}

    title = _clean(job.get("title") or "")
    skills = _dedupe(parsed.get("skills") or [])[:_MAX_SKILLS]
    skill_keys = {s.lower() for s in skills}

    nice_to_have = [
        s for s in _dedupe(parsed.get("nice_to_have") or [])[:_MAX_NICE_TO_HAVE]
        if s.lower() not in skill_keys
    ]

    seniority = parsed.get("experience_level") or next(
        iter(targeting.get("required_seniority") or []), None
    )

    keywords = [
        k for k in _dedupe(parsed.get("keywords") or [])[:_MAX_KEYWORDS]
        if k.lower() not in skill_keys and k.lower() != title.lower()
    ]

    return {
        "title": title or None,
        "seniority": seniority,
        "domain": targeting.get("required_domain") or parsed.get("job_domain"),
        "industry": parsed.get("industry"),
        "location": _clean(job.get("location") or "") or None,
        "is_remote": bool(job.get("is_remote")),
        "skills": skills,
        "nice_to_have": nice_to_have,
        "keywords": keywords,
    }


def _location_clause(spec: dict) -> str:
    if spec.get("is_remote") or not spec.get("location"):
        return ""
    return _quote(spec["location"])


def render_query(spec: dict, tier: str) -> str:
    if tier not in TIERS:
        raise ValueError(f"Unknown tier '{tier}': expected one of {list(TIERS)}")

    title = spec.get("title") or ""
    skills = spec.get("skills") or []
    nice_to_have = spec.get("nice_to_have") or []

    parts: list[str] = []
    if tier == "broad":
        parts.append(_or_group([title] + list(spec.get("keywords") or [])))
        parts.append(_or_group(skills + nice_to_have))
    else:
        parts.append(_quote(title))
        kept = skills if tier == "strict" else skills[: max(1, math.ceil(len(skills) / 2))]
        parts.extend(_quote(s) for s in kept)

    parts.append(_location_clause(spec))
    return _and_join(parts)


def render_all(spec: dict) -> dict:
    return {tier: render_query(spec, tier) for tier in TIERS}


def build_sourcing_plan(job: dict) -> dict:
    spec = build_search_spec(job)
    return {"spec": spec, "queries": render_all(spec)}
