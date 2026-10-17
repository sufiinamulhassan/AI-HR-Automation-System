from __future__ import annotations

import re
import time
from datetime import datetime, timezone

from config.database import get_platform_db
from config.settings import settings
from config.tenancy import namespaced_id
from services.hr_module.workspace_service import list_active_companies

SUMMARY_CHARS = 240
MAX_PAGE_SIZE = 50
DEFAULT_PAGE_SIZE = 12
FILTER_SCAN_LIMIT = 2000
MAX_SKILLS = 6
PLACEHOLDER_NAMES = {"", "default", "platform", "platform operations", "workspace"}

LIST_FIELDS = {
    "_id": 0, "job_id": 1, "title": 1, "description": 1, "location": 1, "employment_type": 1,
    "is_remote": 1, "company_name": 1, "company_id": 1, "created_at": 1, "deadline_at": 1,
    "targeting": 1, "parsed_criteria": 1, "job_grade": 1,
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


_CACHE: dict[tuple, tuple[float, object]] = {}
_CACHE_LIMIT = 256


def _clock() -> float:
    return time.monotonic()


def clear_cache() -> None:
    _CACHE.clear()


async def _cached(key: tuple, load):
    ttl = max(0, int(settings.CAREERS_CACHE_SECONDS or 0))
    if not ttl:
        return await load()
    scoped = (id(get_platform_db()), *key)
    now = _clock()
    hit = _CACHE.get(scoped)
    if hit and hit[0] > now:
        return hit[1]
    value = await load()
    if len(_CACHE) >= _CACHE_LIMIT:
        _CACHE.clear()
    _CACHE[scoped] = (now + ttl, value)
    return value


def visibility_clauses(now_iso: str) -> list[dict]:
    return [
        {"doc_type": "job"},
        {"$or": [{"is_public": True}, {"is_public": {"$exists": False}, "source": "manual"}]},
        {"$or": [{"deadline_at": None}, {"deadline_at": {"$gte": now_iso}}]},
    ]


def public_job_clauses(company_ids: list[str], now_iso: str) -> list[dict]:
    return [{"company_id": {"$in": company_ids}}, *visibility_clauses(now_iso)]


def _plain(text: str) -> str:
    return " ".join(str(text or "").split())


def summarise(description: str, limit: int = SUMMARY_CHARS) -> str:
    text = _plain(re.sub(r"[#*_`>]+", " ", description or ""))
    if len(text) <= limit:
        return text
    cut = text[:limit].rsplit(" ", 1)[0].rstrip(".,;:")
    return cut + "..."


def skills_of(job: dict) -> list[str]:
    raw = (job.get("targeting") or {}).get("required_skills") or (job.get("parsed_criteria") or {}).get("skills") or []
    seen: list[str] = []
    for item in raw:
        text = _plain(item)
        if text and text.lower() not in (s.lower() for s in seen):
            seen.append(text)
    return seen[:MAX_SKILLS]


def _company_name(company: dict, settings_row: dict | None, job: dict | None = None) -> str:
    org = _plain((settings_row or {}).get("company_name"))
    if org:
        return org
    record = _plain(company.get("name"))
    if record.lower() not in PLACEHOLDER_NAMES:
        return record
    return _plain((job or {}).get("company_name")) or "Company"


async def _load_company_index() -> dict[str, dict]:
    companies = await list_active_companies()
    raw = get_platform_db()
    if raw is None or not companies:
        return {}
    ids = [c["company_id"] for c in companies]
    keys = [namespaced_id(i, "singleton") for i in ids]
    settings_rows = {
        row["_id"]: row
        for row in await raw.company_settings.find({"_id": {"$in": keys}}).to_list(length=None)
    }
    branding_rows = {
        row["_id"]: row
        for row in await raw.branding_settings.find({"_id": {"$in": keys}}).to_list(length=None)
    }
    index: dict[str, dict] = {}
    for company in companies:
        key = namespaced_id(company["company_id"], "singleton")
        info = settings_rows.get(key) or {}
        brand = branding_rows.get(key) or {}
        index[company["company_id"]] = {
            "company_id": company["company_id"],
            "slug": company.get("slug") or "",
            "name": _company_name(company, info),
            "settings": info,
            "logo_url": (brand.get("company_logo_url") or "") or None,
            "website": (info.get("website") or "") or None,
            "industry": (info.get("industry") or "") or None,
            "privacy_url": (info.get("privacy_url") or "") or None,
            "terms_url": (info.get("terms_url") or "") or None,
        }
    return index


async def company_index() -> dict[str, dict]:
    return await _cached(("index",), _load_company_index)


def _company_view(info: dict, job: dict | None = None) -> dict:
    name = info["name"]
    if name == "Company" and job:
        name = _plain(job.get("company_name")) or name
    return {"slug": info["slug"], "name": name, "logo_url": info["logo_url"]}


async def public_company_name(company_id: str | None, job: dict | None = None) -> str:
    info = (await company_index()).get(company_id or "")
    return _company_view(info, job)["name"] if info else ""


def list_view(job: dict, info: dict) -> dict:
    return {
        "job_id": job["job_id"],
        "title": _plain(job.get("title")),
        "summary": summarise(job.get("description") or ""),
        "location": _plain(job.get("location")) or None,
        "employment_type": _plain(job.get("employment_type")) or "full-time",
        "is_remote": bool(job.get("is_remote")),
        "skills": skills_of(job),
        "posted_at": job.get("created_at"),
        "deadline_at": job.get("deadline_at"),
        "company": _company_view(info, job),
    }


def detail_view(job: dict, info: dict) -> dict:
    criteria = job.get("parsed_criteria") or {}
    view = list_view(job, info)
    view.update({
        "description": str(job.get("description") or ""),
        "job_grade": _plain(job.get("job_grade")) or None,
        "experience_level": _plain(criteria.get("experience_level")) or None,
        "industry": _plain(criteria.get("industry")) or None,
        "accepting": True,
        "company": {
            **view["company"],
            "website": info["website"],
            "industry": info["industry"],
            "privacy_url": info["privacy_url"],
            "terms_url": info["terms_url"],
        },
    })
    return view


def _bounded(value: str | None, limit: int = 120) -> str:
    return _plain(value)[:limit]


def _page_numbers(page: int | None, limit: int | None) -> tuple[int, int]:
    size = max(1, min(int(limit or DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE))
    return max(1, int(page or 1)), size


async def _list_public_jobs(
    *,
    q: str | None = None,
    company: str | None = None,
    location: str | None = None,
    employment_type: str | None = None,
    remote: bool = False,
    page: int | None = 1,
    limit: int | None = DEFAULT_PAGE_SIZE,
) -> dict:
    page, limit = _page_numbers(page, limit)
    empty = {"jobs": [], "total": 0, "page": page, "limit": limit, "pages": 0}
    raw = get_platform_db()
    index = await company_index()
    slug = _bounded(company, 80).lower()
    if slug:
        index = {cid: info for cid, info in index.items() if info["slug"].lower() == slug}
    if raw is None or not index:
        return empty

    clauses = public_job_clauses(list(index), _now_iso())
    term = _bounded(q)
    if term:
        pattern = re.escape(term)
        clauses.append({"$or": [
            {"title": {"$regex": pattern, "$options": "i"}},
            {"description": {"$regex": pattern, "$options": "i"}},
            {"company_name": {"$regex": pattern, "$options": "i"}},
            {"location": {"$regex": pattern, "$options": "i"}},
        ]})
    place = _bounded(location)
    if place:
        clauses.append({"location": {"$regex": re.escape(place), "$options": "i"}})
    kind = _bounded(employment_type, 40)
    if kind:
        clauses.append({"employment_type": {"$regex": "^" + re.escape(kind) + "$", "$options": "i"}})
    if remote:
        clauses.append({"is_remote": True})

    query = {"$and": clauses}
    total = await raw.jobs.count_documents(query)
    if not total:
        return empty
    rows = await (
        raw.jobs.find(query, LIST_FIELDS).sort("created_at", -1).skip((page - 1) * limit).limit(limit)
    ).to_list(length=limit)
    return {
        "jobs": [list_view(row, index[row["company_id"]]) for row in rows if row.get("company_id") in index],
        "total": total,
        "page": page,
        "limit": limit,
        "pages": -(-total // limit),
    }


async def list_public_jobs(
    *,
    q: str | None = None,
    company: str | None = None,
    location: str | None = None,
    employment_type: str | None = None,
    remote: bool = False,
    page: int | None = 1,
    limit: int | None = DEFAULT_PAGE_SIZE,
) -> dict:
    page, limit = _page_numbers(page, limit)
    key = (
        "jobs", _bounded(q), _bounded(company, 80).lower(), _bounded(location), _bounded(employment_type, 40),
        bool(remote), page, limit,
    )
    return await _cached(key, lambda: _list_public_jobs(
        q=q, company=company, location=location, employment_type=employment_type, remote=remote, page=page, limit=limit,
    ))


async def public_filters() -> dict:
    return await _cached(("filters",), _load_public_filters)


async def _load_public_filters() -> dict:
    raw = get_platform_db()
    index = await company_index()
    result = {"companies": [], "locations": [], "employment_types": [], "remote_jobs": 0, "total_open": 0}
    if raw is None or not index:
        return result
    rows = await raw.jobs.find(
        {"$and": public_job_clauses(list(index), _now_iso())},
        {"_id": 0, "company_id": 1, "location": 1, "employment_type": 1, "is_remote": 1},
    ).to_list(length=FILTER_SCAN_LIMIT)
    per_company: dict[str, int] = {}
    places: dict[str, int] = {}
    kinds: dict[str, int] = {}
    for row in rows:
        cid = row.get("company_id")
        if cid not in index:
            continue
        per_company[cid] = per_company.get(cid, 0) + 1
        place = _plain(row.get("location"))
        if place:
            places[place] = places.get(place, 0) + 1
        kind = _plain(row.get("employment_type")).lower()
        if kind:
            kinds[kind] = kinds.get(kind, 0) + 1
        result["remote_jobs"] += 1 if row.get("is_remote") else 0
        result["total_open"] += 1
    result["companies"] = sorted(
        (
            {"slug": index[cid]["slug"], "name": index[cid]["name"], "logo_url": index[cid]["logo_url"], "open_jobs": n}
            for cid, n in per_company.items()
        ),
        key=lambda c: (-c["open_jobs"], c["name"].lower()),
    )
    result["locations"] = [p for p, _ in sorted(places.items(), key=lambda kv: (-kv[1], kv[0].lower()))][:40]
    result["employment_types"] = [k for k, _ in sorted(kinds.items(), key=lambda kv: (-kv[1], kv[0]))]
    return result


async def find_public_job(job_id: str) -> tuple[dict, dict] | None:
    raw = get_platform_db()
    if raw is None or not job_id:
        return None
    index = await company_index()
    if not index:
        return None
    row = await raw.jobs.find_one(
        {"$and": [{"job_id": str(job_id)}, *public_job_clauses(list(index), _now_iso())]},
        {"_id": 0, "embedding": 0, "candidate_pipeline": 0},
    )
    if not row or row.get("company_id") not in index:
        return None
    return row, index[row["company_id"]]


async def get_public_job(job_id: str) -> dict | None:
    found = await find_public_job(job_id)
    return detail_view(*found) if found else None
