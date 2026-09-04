"""Candidate identity resolution — hr_module (MVP2 §2.5).

Pure normalization helpers plus a soft cross-job duplicate-signal lookup.

This is deliberately NOT a hard dedup rule: a real person legitimately can,
and often should, apply to more than one job. The existing exact
`(job_id, email)` 409 check in `routes/candidates.py::create_candidate`
remains the only hard block. Everything here is presented to the recruiter
as a non-blocking warning (`possible_duplicates`) plus a read-only cross-job
`timeline` view — never a rejection.

No new dependencies: normalization is intentionally naive regex/string work
(no `phonenumbers`/`libphonenumber`), matching the project's no-new-pip-deps
rule. This trades some recall (e.g. "07911 000111" won't match
"+44 7911 000111") for zero new dependencies.
"""
import re
from urllib.parse import parse_qsl, urlencode, urlparse

_LINKEDIN_TRACKING_PARAMS = {
    "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
    "trk", "trkinfo", "originalsubdomain", "lipi", "midtoken", "midsig",
    "trackingid", "refid", "ref_src", "lici",
}


def normalize_phone(phone: str | None) -> str | None:
    """Strip everything but digits. `None`/empty/whitespace-only -> `None`.

    Deliberately naive — this is a soft duplicate SIGNAL, not a validated
    phone-number parser. No country-code canonicalization.
    """
    if not phone:
        return None
    digits = re.sub(r"\D", "", phone)
    return digits or None


def normalize_linkedin(url: str | None) -> str | None:
    """Lowercase, drop the scheme/`www.`, strip tracking query params, and
    strip a trailing slash.

    ``"https://www.LinkedIn.com/in/jane-doe/?utm_source=share"`` and
    ``"linkedin.com/in/jane-doe"`` normalize to the same value
    (``"linkedin.com/in/jane-doe"``).
    """
    if not url:
        return None
    url = url.strip()
    if not url:
        return None

    candidate = url if "://" in url else f"//{url}"
    parsed = urlparse(candidate, scheme="https")

    netloc = parsed.netloc.lower()
    if netloc.startswith("www."):
        netloc = netloc[4:]
    path = parsed.path.lower().rstrip("/")

    kept_params = [
        (k, v) for k, v in parse_qsl(parsed.query, keep_blank_values=True)
        if k.lower() not in _LINKEDIN_TRACKING_PARAMS
    ]

    normalized = netloc + path
    if kept_params:
        normalized += "?" + urlencode(kept_params)
    return normalized or None


async def hydrate_job_titles(db, job_ids: list[str]) -> dict:
    """Resolve a list of job_ids to their titles in a single query.

    Shared by `routes/candidates.py`'s `get_candidate_timeline` and
    `services/hr_module/candidate_profile_service.py`'s profile hydration so
    both cross-job views build their `job_id -> job_title` lookup the same
    way instead of each re-implementing it. Never raises: an empty/None
    `job_ids` list short-circuits to `{}` without touching the DB.
    """
    jobs_by_id: dict = {}
    if not job_ids:
        return jobs_by_id
    cursor = db.jobs.find({"job_id": {"$in": job_ids}}, {"_id": 0, "job_id": 1, "title": 1})
    async for j in cursor:
        jobs_by_id[j["job_id"]] = j.get("title")
    return jobs_by_id


async def find_possible_duplicates(
    db,
    email: str | None = None,
    phone: str | None = None,
    linkedin_url: str | None = None,
    *,
    exclude_job_id: str | None = None,
) -> list[dict]:
    """Soft-duplicate lookup across *other* jobs.

    Exact same-job-plus-email duplicates are already a hard 409 in
    `create_candidate` — this looks for any OTHER candidate document (a
    different `job_id`) whose email matches, or whose normalized phone or
    normalized LinkedIn URL matches. Never raises, never blocks.

    Returns lightweight match summaries:
    ``{"candidate_id", "job_id", "name", "matched_on"}`` where `matched_on`
    is a list of one or more of ``"email"``, ``"phone"``, ``"linkedin"``.
    """
    if db is None:
        return []

    norm_phone = normalize_phone(phone)
    norm_linkedin = normalize_linkedin(linkedin_url)

    or_clauses: list[dict] = []
    if email:
        or_clauses.append({"email": email})
    if norm_phone:
        or_clauses.append({"phone_normalized": norm_phone})
    if norm_linkedin:
        or_clauses.append({"linkedin_normalized": norm_linkedin})

    if not or_clauses:
        return []

    query: dict = {"doc_type": "candidate", "$or": or_clauses}
    if exclude_job_id:
        query["job_id"] = {"$ne": exclude_job_id}

    projection = {
        "_id": 0, "candidate_id": 1, "job_id": 1, "name": 1,
        "email": 1, "phone_normalized": 1, "linkedin_normalized": 1,
    }

    matches: list[dict] = []
    cursor = db.candidates.find(query, projection)
    async for doc in cursor:
        matched_on = []
        if email and doc.get("email") == email:
            matched_on.append("email")
        if norm_phone and doc.get("phone_normalized") == norm_phone:
            matched_on.append("phone")
        if norm_linkedin and doc.get("linkedin_normalized") == norm_linkedin:
            matched_on.append("linkedin")
        if not matched_on:
            continue
        matches.append({
            "candidate_id": doc.get("candidate_id"),
            "job_id": doc.get("job_id"),
            "name": doc.get("name"),
            "matched_on": matched_on,
        })
    return matches
