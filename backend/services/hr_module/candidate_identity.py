import re
from urllib.parse import parse_qsl, urlencode, urlparse

_LINKEDIN_TRACKING_PARAMS = {
    "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
    "trk", "trkinfo", "originalsubdomain", "lipi", "midtoken", "midsig",
    "trackingid", "refid", "ref_src", "lici",
}


def normalize_phone(phone: str | None) -> str | None:
    if not phone:
        return None
    digits = re.sub(r"\D", "", phone)
    return digits or None


def normalize_linkedin(url: str | None) -> str | None:
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
