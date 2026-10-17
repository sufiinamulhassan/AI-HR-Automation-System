from __future__ import annotations

import logging
import math
import re
import time
from collections import Counter
from dataclasses import dataclass
from typing import Any, Callable, Iterable, Mapping

from config import tenancy
from services.hr_module import resume_taxonomy as taxonomy

logger = logging.getLogger(__name__)

POOL_TTL_SECONDS = 300
POOL_CACHE_LIMIT = 256
POOL_SCAN_LIMIT = 20000
MAX_TERMS = 12
MAX_PHRASE_WORDS = 4
MAX_PAGE_SIZE = 500
SKILL_OPTION_LIMIT = 400
ROLE_OPTION_LIMIT = 100
FOLDER_ROLE_LIMIT = 5
SEMANTIC_MAX_CANDIDATES = 200
RELEVANCE_FIELD = "_relevance"

SYMBOLIC_SKILLS = frozenset({
    "c++", "c#", "f#", ".net", "asp.net", "node.js", "next.js", "vue.js", "react.js",
    "express.js", "objective-c", "ci/cd",
})

WORD_FIELDS = (
    "candidate_name", "candidate_email", "filename", "headline", "location",
    "department", "experience.title", "experience.company",
)

FOLDER_IGNORED_FILTERS = frozenset({"business_domain", "domain", "department"})

FILTER_KEYS = (
    "search", "skill", "business_domain", "domain", "seniority", "status",
    "experience_min", "experience_max", "department", "education_level",
    "certification", "industry",
    "salary_expectation_min", "salary_expectation_max", "worked_at_company",
    "location", "notice_period", "min_match_score", "job_id",
)

NEWEST_FIRST = [("created_at", -1), ("resume_id", 1)]

RANKED_SORT = {
    RELEVANCE_FIELD: -1,
    "classification.years_experience": -1,
    "created_at": -1,
    "resume_id": 1,
}

LIST_PROJECTION = {"_id": 0, "embedding": 0, "text": 0}

LABEL_OVERRIDES = {
    "phd": "PhD",
    "high_school": "High school",
    "banking_finance": "Banking & Finance",
    "retail_ecommerce": "Retail & E-commerce",
    "government_public_sector": "Government & Public Sector",
    "media_entertainment": "Media & Entertainment",
    "energy_utilities": "Energy & Utilities",
    "logistics_supply_chain": "Logistics & Supply Chain",
    "hospitality_travel": "Hospitality & Travel",
}

_BEFORE = r"(?<![A-Za-z0-9])"
_AFTER = r"(?![A-Za-z0-9])"
_EDGE_CHARS = "\"'()[]{}<>;:!?*|`~\\,"

_ALL_FAMILIES = tuple(family for _, _, families in taxonomy.BUSINESS_DOMAINS for family in families)

_EQUALS = (
    ("status", "processing_status"),
    ("domain", "classification.job_domain"),
    ("seniority", "classification.seniority_level"),
    ("education_level", "classification.education_level"),
    ("industry", "classification.industry"),
)

_CONTAINS = (
    ("location", "location"),
    ("notice_period", "notice_period"),
    ("certification", "certifications"),
    ("worked_at_company", "experience.company"),
)

_pool_cache: dict[str, tuple[float, frozenset[str]]] = {}


@dataclass(frozen=True)
class ParsedSearch:
    skills: tuple[str, ...] = ()
    words: tuple[str, ...] = ()

    def is_empty(self) -> bool:
        return not self.skills and not self.words


def _now() -> float:
    return time.monotonic()


def _normalised(value: str) -> str:
    return " ".join(value.split()).lower()


def _lowered(values: Iterable[Any]) -> set[str]:
    return {_normalised(v) for v in values if isinstance(v, str) and v.strip()}


def _clean_token(raw: str) -> str:
    token = raw
    while True:
        cleaned = token.strip(_EDGE_CHARS).rstrip(".")
        if cleaned == token:
            break
        token = cleaned
    return token if any(ch.isalnum() for ch in token) else ""


def _append_unique(items: list[str], value: str) -> None:
    if value not in items:
        items.append(value)


def parse_search(text: Any, known_skills: Iterable[Any] = ()) -> ParsedSearch:
    if not isinstance(text, str):
        return ParsedSearch()
    known = _lowered(known_skills) | SYMBOLIC_SKILLS
    skills: list[str] = []
    words: list[str] = []
    for term in text.split(","):
        tokens = [t for t in (_clean_token(raw) for raw in term.split()) if t]
        index = 0
        while index < len(tokens):
            span = min(MAX_PHRASE_WORDS, len(tokens) - index)
            for size in range(span, 0, -1):
                phrase = " ".join(tokens[index:index + size]).lower()
                if phrase in known:
                    _append_unique(skills, phrase)
                    index += size
                    break
            else:
                _append_unique(words, tokens[index].lower())
                index += 1
    return ParsedSearch(tuple(skills[:MAX_TERMS]), tuple(words[:MAX_TERMS]))


def parse_skill_filter(value: Any) -> tuple[str, ...]:
    if not isinstance(value, str):
        return ()
    skills: list[str] = []
    for part in value.split(","):
        skill = _normalised(part)
        if skill:
            _append_unique(skills, skill)
    return tuple(skills[:MAX_TERMS])


def parse_filters(filters: Mapping[str, Any] | None, known_skills: Iterable[Any] = ()) -> ParsedSearch:
    source = filters if isinstance(filters, Mapping) else {}
    parsed = parse_search(source.get("search"), known_skills)
    skills = list(parsed.skills)
    for skill in parse_skill_filter(source.get("skill")):
        _append_unique(skills, skill)
    return ParsedSearch(tuple(skills[:MAX_TERMS]), parsed.words)


def _regex(pattern: str) -> dict:
    return {"$regex": pattern, "$options": "i"}


def exact_pattern(text: str) -> str:
    return r"^\s*" + re.escape(text.strip()) + r"\s*$"


def prefix_pattern(text: str) -> str:
    return _BEFORE + re.escape(text.strip())


def whole_word_pattern(text: str) -> str:
    return prefix_pattern(text) + _AFTER


def contains_regex(text: str) -> dict:
    return _regex(re.escape(text.strip()))


def skill_clause(skill: str) -> dict:
    return {"classification.skills": _regex(exact_pattern(skill))}


def word_clause(word: str) -> dict:
    options = [{field: _regex(prefix_pattern(word))} for field in WORD_FIELDS]
    options.append({"classification.skills": _regex(whole_word_pattern(word))})
    return {"$or": options}


def department_clause(value: str) -> dict:
    wanted = value.strip()
    key = wanted.lower()
    exact = {"department": _regex(exact_pattern(wanted))}
    known = list(taxonomy.known_families())
    fallback: list[dict] = []
    labelled = [family for family in known if taxonomy.family_label(family).lower() == key]
    if labelled:
        fallback.append({"classification.job_domain": {"$in": labelled}})
    if "_" not in wanted:
        spelling = r"^\s*" + "[ _]".join(re.escape(part) for part in wanted.split(" ")) + r"\s*$"
        fallback.append({"$and": [
            {"classification.job_domain": {"$nin": known}},
            {"classification.job_domain": _regex(spelling)},
        ]})
    if key == taxonomy.family_label(None).lower():
        fallback.append({"classification.job_domain": {"$in": [None, ""]}})
        fallback.append({"classification.job_domain": _regex(r"^\s*$")})
    if not fallback:
        return exact
    unlabelled = {"$or": [{"department": {"$in": [None, ""]}}, {"department": _regex(r"^\s*$")}]}
    return {"$or": [exact, {"$and": [unlabelled, {"$or": fallback}]}]}


def business_domain_condition(slug: str) -> dict:
    if slug == taxonomy.OTHER_DOMAIN[0]:
        return {"$nin": list(_ALL_FAMILIES)}
    return {"$in": list(taxonomy.families_for_domain(slug))}


def _text(source: Mapping[str, Any], key: str) -> str:
    value = source.get(key)
    return value.strip() if isinstance(value, str) else ""


def _number(value: Any) -> int | float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, str):
        try:
            value = float(value.strip())
        except ValueError:
            return None
    if not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


def _range(low: Any, high: Any) -> dict:
    bounds: dict = {}
    if low is not None:
        bounds["$gte"] = low
    if high is not None:
        bounds["$lte"] = high
    return bounds


class _Query:

    def __init__(self) -> None:
        self.fields: dict = {}
        self.all_of: list[dict] = []

    def field(self, key: str, condition: Any) -> None:
        if key in self.fields:
            self.require({key: condition})
        else:
            self.fields[key] = condition

    def require(self, clause: dict) -> None:
        if clause not in self.all_of:
            self.all_of.append(clause)

    def build(self) -> dict:
        query = dict(self.fields)
        if self.all_of:
            query["$and"] = self.all_of
        return query


def build_resume_query(
    filters: Mapping[str, Any] | None,
    known_skills: Iterable[Any] = (),
    parsed: ParsedSearch | None = None,
) -> dict:
    source = filters if isinstance(filters, Mapping) else {}
    query = _Query()

    parsed = parsed if parsed is not None else parse_filters(source, known_skills)
    for skill in parsed.skills:
        query.require(skill_clause(skill))
    for word in parsed.words:
        query.require(word_clause(word))

    for name, path in _EQUALS:
        value = _text(source, name)
        if value:
            query.field(path, value)

    slug = _text(source, "business_domain").lower()
    if slug:
        query.field("classification.job_domain", business_domain_condition(slug))

    department = _text(source, "department")
    if department:
        query.require(department_clause(department))

    for name, path in _CONTAINS:
        value = _text(source, name)
        if value:
            query.field(path, contains_regex(value))

    years = _range(_number(source.get("experience_min")), _number(source.get("experience_max")))
    if years:
        query.field("classification.years_experience", years)

    salary = _range(_number(source.get("salary_expectation_min")), _number(source.get("salary_expectation_max")))
    if salary:
        query.field("salary_expectation", salary)

    score = _number(source.get("min_match_score"))
    if score is not None:
        element: dict = {"score": {"$gte": score}}
        job_id = _text(source, "job_id")
        if job_id:
            element["job_id"] = job_id
        query.field("matched_jds", {"$elemMatch": element})

    return query.build()


def page_bounds(page: Any, limit: Any, default_limit: int = 20) -> tuple[int, int]:
    return max(1, int(page or 1)), max(1, min(int(limit or default_limit), MAX_PAGE_SIZE))


def relevance_expression(parsed: ParsedSearch) -> dict:
    headline = {"$convert": {"input": "$headline", "to": "string", "onError": "", "onNull": ""}}

    def named_in_headline(term: str, weight: int) -> dict:
        test = {"$regexMatch": {"input": headline, "regex": whole_word_pattern(term), "options": "i"}}
        return {"$cond": [test, weight, 0]}

    parts: list[Any] = []
    for skill in parsed.skills:
        parts.append(3)
        parts.append(named_in_headline(skill, 3))
    for word in parsed.words:
        parts.append(named_in_headline(word, 1))
    return {"$add": parts}


def ranked_pipeline(query: Mapping[str, Any], parsed: ParsedSearch, skip: int, limit: int) -> list[dict]:
    return [
        {"$match": dict(query)},
        {"$addFields": {RELEVANCE_FIELD: relevance_expression(parsed)}},
        {"$sort": dict(RANKED_SORT)},
        {"$skip": max(0, int(skip))},
        {"$limit": max(1, int(limit))},
        {"$project": {**LIST_PROJECTION, RELEVANCE_FIELD: 0}},
    ]


def skill_pool_pipeline() -> list[dict]:
    return [
        {"$unwind": "$classification.skills"},
        {"$group": {"_id": "$classification.skills", "count": {"$sum": 1}}},
        {"$sort": {"count": -1, "_id": 1}},
        {"$limit": POOL_SCAN_LIMIT},
    ]


def reset_skill_pool_cache() -> None:
    _pool_cache.clear()


def _remember_pool(key: str, stamp: float, pool: frozenset[str]) -> None:
    if len(_pool_cache) >= POOL_CACHE_LIMIT and key not in _pool_cache:
        for stale in [k for k, (at, _) in _pool_cache.items() if stamp - at >= POOL_TTL_SECONDS]:
            del _pool_cache[stale]
        if len(_pool_cache) >= POOL_CACHE_LIMIT:
            del _pool_cache[min(_pool_cache, key=lambda k: _pool_cache[k][0])]
    _pool_cache[key] = (stamp, pool)


async def known_skill_pool(db: Any) -> frozenset[str]:
    if db is None:
        return frozenset()
    key = tenancy.current_company_id() or ""
    stamp = _now()
    cached = _pool_cache.get(key)
    if cached is not None and stamp - cached[0] < POOL_TTL_SECONDS:
        return cached[1]
    try:
        rows = await db.resumes.aggregate(skill_pool_pipeline()).to_list(length=None)
    except Exception as exc:
        logger.warning("Skill pool lookup failed: %s", exc)
        return cached[1] if cached is not None else frozenset()
    pool = frozenset(_lowered(row.get("_id") for row in rows))
    _remember_pool(key, stamp, pool)
    return pool


def humanize(value: str) -> str:
    if value in LABEL_OVERRIDES:
        return LABEL_OVERRIDES[value]
    text = value.replace("_", " ").strip()
    return text.title() if text == text.lower() else text


def _count(value: Any) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return 0
    return max(0, int(value))


def _string_counts(rows: Iterable[Mapping[str, Any]]) -> Counter:
    counts: Counter = Counter()
    for row in rows or ():
        value = row.get("_id")
        count = _count(row.get("count"))
        if isinstance(value, str) and value.strip() and count > 0:
            counts[value.strip()] += count
    return counts


def _spelling(spellings: Counter) -> str:
    return max(spellings, key=lambda text: (spellings[text], sum(ch.isupper() for ch in text), text))


def merge_case_insensitive(rows: Iterable[Mapping[str, Any]]) -> list[dict]:
    totals: dict[str, int] = {}
    variants: dict[str, Counter] = {}
    for value, count in _string_counts(rows).items():
        key = value.lower()
        totals[key] = totals.get(key, 0) + count
        variants.setdefault(key, Counter())[value] += count
    return [{"value": _spelling(variants[key]), "count": total} for key, total in totals.items()]


def by_count(items: Iterable[dict], limit: int | None = None) -> list[dict]:
    ordered = sorted(items, key=lambda item: (-item["count"], item["value"].lower(), item["value"]))
    return ordered if limit is None else ordered[:limit]


def alphabetical(items: Iterable[dict]) -> list[dict]:
    return sorted(items, key=lambda item: (item["value"].lower(), item["value"]))


def _labelled(counts: Mapping[str, int], label: Callable[[str], str]) -> list[dict]:
    return alphabetical({"value": v, "label": label(v), "count": c} for v, c in counts.items() if c > 0)


def _ranked(rows: Iterable[Mapping[str, Any]], order: Iterable[str], label: Callable[[str], str]) -> list[dict]:
    counts = _string_counts(rows)
    order = tuple(order)
    known = [{"value": v, "label": label(v), "count": counts[v]} for v in order if counts.get(v)]
    extra = _labelled({v: c for v, c in counts.items() if v not in order}, label)
    return known + extra


def _scalar_pipeline(path: str) -> list[dict]:
    return [{"$group": {"_id": "$" + path, "count": {"$sum": 1}}}]


def _array_pipeline(path: str) -> list[dict]:
    return [{"$unwind": "$" + path}, *_scalar_pipeline(path)]


def option_pipelines() -> dict[str, list[dict]]:
    return {
        "families": _scalar_pipeline("classification.job_domain"),
        "seniorities": _scalar_pipeline("classification.seniority_level"),
        "statuses": _scalar_pipeline("processing_status"),
        "education_levels": _scalar_pipeline("classification.education_level"),
        "industries": _scalar_pipeline("classification.industry"),
        "roles": _role_pipeline(),
        "skills": _array_pipeline("classification.skills"),
    }


def _domain_counts(rows: Iterable[Mapping[str, Any]], family_of: Callable[[Mapping[str, Any]], Any]) -> Counter:
    counts: Counter = Counter()
    for row in rows or ():
        family = family_of(row)
        counts[taxonomy.domain_slug_for_family(family if isinstance(family, str) else None)] += _count(row.get("count"))
    return counts


def _domain_order(slug: str, count: int) -> tuple:
    return (slug == taxonomy.OTHER_DOMAIN[0], -count, taxonomy.domain_label(slug).lower())


def _business_domain_options(rows: Iterable[Mapping[str, Any]]) -> list[dict]:
    counts = _domain_counts(rows, lambda row: row.get("_id"))
    options = [
        {"value": slug, "label": taxonomy.domain_label(slug), "count": count}
        for slug, count in counts.items() if count > 0
    ]
    options.sort(key=lambda option: _domain_order(option["value"], option["count"]))
    return options


def build_options(results: Mapping[str, Iterable[Mapping[str, Any]]], total: int) -> dict:
    def rows(name: str) -> list:
        return list(results.get(name) or [])

    statuses = _string_counts(rows("statuses"))
    return {
        "business_domains": _business_domain_options(rows("families")),
        "skills": by_count(merge_case_insensitive(rows("skills")), SKILL_OPTION_LIMIT),
        "seniorities": _ranked(rows("seniorities"), taxonomy.SENIORITY_ORDER, humanize),
        "statuses": alphabetical({"value": v, "count": c} for v, c in statuses.items()),
        "education_levels": _ranked(rows("education_levels"), taxonomy.EDUCATION_ORDER, humanize),
        "industries": _labelled(_string_counts(rows("industries")), humanize),
        "roles": alphabetical(by_count(merge_case_insensitive(_role_counts(rows("roles"))), ROLE_OPTION_LIMIT)),
        "total": max(0, int(total or 0)),
    }


def _role_pipeline() -> list[dict]:
    return [{"$group": {
        "_id": {"family": "$classification.job_domain", "department": "$department"},
        "count": {"$sum": 1},
    }}]


def folder_pipeline(query: Mapping[str, Any]) -> list[dict]:
    return [{"$match": dict(query)}, *_role_pipeline()]


def _role_entries(rows: Iterable[Mapping[str, Any]]) -> Iterable[tuple[str, str, int]]:
    for row in rows or ():
        key = row.get("_id")
        key = key if isinstance(key, Mapping) else {}
        count = _count(row.get("count"))
        if count <= 0:
            continue
        family = key.get("family") if isinstance(key.get("family"), str) else None
        department = key.get("department")
        if isinstance(department, str) and department.strip():
            role = department.strip()
        else:
            role = taxonomy.family_label(family if family and family.strip() else None)
        yield taxonomy.domain_slug_for_family(family), role, count


def _role_counts(rows: Iterable[Mapping[str, Any]]) -> list[dict]:
    return [{"_id": role, "count": count} for _slug, role, count in _role_entries(rows)]


def build_folders(rows: Iterable[Mapping[str, Any]]) -> list[dict]:
    counts: Counter = Counter()
    roles: dict[str, list[dict]] = {}
    for slug, role, count in _role_entries(rows):
        counts[slug] += count
        roles.setdefault(slug, []).append({"_id": role, "count": count})
    folders = [
        {
            "value": slug,
            "label": taxonomy.domain_label(slug),
            "count": total,
            "roles": by_count(merge_case_insensitive(roles[slug]), FOLDER_ROLE_LIMIT),
        }
        for slug, total in counts.items()
    ]
    folders.sort(key=lambda folder: _domain_order(folder["value"], folder["count"]))
    return folders


def pinecone_hits(result: Any) -> list[tuple[str, float]]:
    raw = result.get("matches") if isinstance(result, Mapping) else getattr(result, "matches", None)
    hits: list[tuple[str, float]] = []
    for match in raw or []:
        if isinstance(match, Mapping):
            ident, score = match.get("id"), match.get("score")
        else:
            ident, score = getattr(match, "id", None), getattr(match, "score", None)
        if isinstance(ident, str) and ident:
            numeric = isinstance(score, (int, float)) and not isinstance(score, bool)
            hits.append((ident, float(score) if numeric else 0.0))
    return hits


def semantic_top_k(limit: int) -> int:
    return max(1, min(SEMANTIC_MAX_CANDIDATES, limit * 5))


def rank_documents(hits: Iterable[tuple[str, float]], docs: Iterable[Mapping[str, Any]], limit: int) -> list[dict]:
    by_id = {doc.get("resume_id"): doc for doc in docs}
    ranked: list[dict] = []
    seen: set[str] = set()
    for ident, score in hits:
        doc = by_id.get(ident)
        if doc is None or ident in seen:
            continue
        seen.add(ident)
        ranked.append({**doc, "match_score": round(min(1.0, max(0.0, score)), 4)})
        if len(ranked) >= limit:
            break
    return ranked
