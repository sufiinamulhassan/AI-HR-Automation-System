import logging
import re
import time
from datetime import datetime
from html import unescape
from html.parser import HTMLParser

import httpx

from config.settings import settings

logger = logging.getLogger(__name__)

_TIMEOUT = 20.0
_HEADERS = {"User-Agent": "Hirely-JobImporter/1.0", "Accept": "application/json"}

SOURCES = [
    {"id": "linkedin",     "label": "LinkedIn",     "requires_key": True,  "key": "LINKEDIN_API_KEY"},
    {"id": "indeed",       "label": "Indeed",       "requires_key": True,  "key": "INDEED_API_KEY"},
    {"id": "remotive",     "label": "Remotive",     "requires_key": False, "key": None},
    {"id": "arbeitnow",    "label": "Arbeitnow",    "requires_key": False, "key": None},
    {"id": "remoteok",     "label": "RemoteOK",     "requires_key": False, "key": None},
    {"id": "themuse",      "label": "The Muse",     "requires_key": False, "key": None},
    {"id": "jobicy",       "label": "Jobicy",       "requires_key": False, "key": None},
]

_KEYED_SOURCE_IDS = {"linkedin", "indeed"}


class JobSourceError(Exception):
    pass


class JobSourceNotConfigured(JobSourceError):
    pass


def _key_for(source_id: str) -> str:
    src = next((s for s in SOURCES if s["id"] == source_id), None)
    if not src or not src["key"]:
        return ""
    return (getattr(settings, src["key"], "") or "").strip()


def list_sources() -> list[dict]:
    out = []
    for s in SOURCES:
        out.append({
            "id": s["id"],
            "label": s["label"],
            "requires_key": s["requires_key"],
            "configured": (not s["requires_key"]) or bool(_key_for(s["id"])),
        })
    return out


class _HTMLToText(HTMLParser):
    _BLOCK = {"p", "div", "section", "article", "ul", "ol", "table",
              "thead", "tbody", "tr", "header", "footer", "nav"}
    _HEAD = {"h1", "h2", "h3", "h4", "h5", "h6"}

    def __init__(self):
        super().__init__()
        self.out: list[str] = []
        self._li = 0
        self._skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self._skip += 1
        elif tag == "li":
            self._li += 1
            self.out.append("\n- ")
        elif tag in self._HEAD:
            self.out.append("\n\n## ")
        elif tag == "br":
            self.out.append(" " if self._li else "\n")
        elif tag in self._BLOCK:
            self.out.append(" " if self._li else "\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self._skip = max(0, self._skip - 1)
        elif tag == "li":
            self._li = max(0, self._li - 1)
            self.out.append("\n")
        elif tag in self._HEAD:
            self.out.append("\n")
        elif tag in self._BLOCK and not self._li:
            self.out.append("\n")

    def handle_data(self, data):
        if not self._skip:
            self.out.append(re.sub(r"\s+", " ", data))


def _strip_html(text: str) -> str:
    if not text:
        return ""
    parser = _HTMLToText()
    try:
        parser.feed(unescape(text))
        parser.close()
        raw = "".join(parser.out)
    except Exception:
        raw = re.sub(r"<[^>]+>", " ", unescape(text))

    cleaned: list[str] = []
    blanks = 0
    for line in raw.split("\n"):
        line = re.sub(r"[ \t]{2,}", " ", line).strip()
        line = re.sub(r"^(?:[-•*·]\s*)+", "- ", line)
        if line in ("-", "•", "*", "##", "## "):
            continue
        if not line:
            blanks += 1
            if blanks > 1:
                continue
        else:
            blanks = 0
        cleaned.append(line)
    return "\n".join(cleaned).strip()[:8000]


def _norm_type(value) -> str | None:
    if not value:
        return None
    return str(value).strip().lower().replace("_", "-").replace(" ", "-")


_STOPWORDS = {"a", "an", "the", "of", "and", "or", "in", "at", "to", "for", "with", "jobs", "job"}


def _tokens(text: str) -> list[str]:
    raw = re.split(r"[^a-z0-9+#.]+", (text or "").lower())
    return [t for t in raw if len(t) >= 2 and t not in _STOPWORDS]


def _match_score(haystack: str, query_tokens: list[str]) -> int:
    if not query_tokens:
        return 1
    hl = haystack.lower()
    return sum(1 for t in query_tokens if t in hl)


async def _get_json(url: str, params: dict | None = None):
    async with httpx.AsyncClient(timeout=_TIMEOUT, headers=_HEADERS, follow_redirects=True) as client:
        r = await client.get(url, params=params)
        r.raise_for_status()
        return r.json()


def _rank(candidates: list[dict], query: str | None, location: str | None, limit: int) -> list[dict]:
    qtokens = _tokens(query or "")
    wants_remote = "remote" in (location or "").lower()
    loc_tokens = [t for t in _tokens(location or "") if t != "remote"]

    scored: list[tuple[int, dict]] = []
    for c in candidates:
        if not c.get("title") or not c.get("description"):
            continue
        head = f"{c['title']} {c.get('company_name') or ''}"
        score = _match_score(head, qtokens) * 3 + (1 if _match_score(c["description"], qtokens) else 0)
        if qtokens and score == 0:
            continue
        job_loc = (c.get("location") or "").lower()
        if (wants_remote and c.get("is_remote")) or any(t in job_loc for t in loc_tokens):
            score += 1
        scored.append((score, c))

    scored.sort(key=lambda x: x[0], reverse=True)
    return [c for _, c in scored[:limit]]


def _parse_epoch(value) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        v = float(value)
        return v / 1000 if v > 1e12 else v
    s = str(value).strip()
    if re.fullmatch(r"\d+", s):
        v = float(s)
        return v / 1000 if v > 1e12 else v
    s = s.replace("Z", "+00:00")
    if " " in s and "T" not in s:
        s = s.replace(" ", "T", 1)
    try:
        return datetime.fromisoformat(s).timestamp()
    except Exception:
        return None


_DATE_WINDOWS = {"day": 1, "today": 1, "week": 7, "month": 30}


def _apply_filters(cands: list[dict], date_posted: str | None,
                   job_type: str | None, remote_only: bool) -> list[dict]:
    out = cands
    if remote_only:
        out = [c for c in out if c.get("is_remote")]
    if job_type:
        jt = _norm_type(job_type)
        out = [c for c in out if c.get("employment_type") == jt]
    if date_posted and date_posted not in ("any", ""):
        days = _DATE_WINDOWS.get(date_posted)
        if days:
            cutoff = time.time() - days * 86400
            out = [c for c in out if (c.get("posted_at") or 0) >= cutoff]
    return out


async def fetch_jobs(source: str, query: str | None = None, location: str | None = None,
                     limit: int = 10, *, date_posted: str | None = None,
                     job_type: str | None = None, remote_only: bool = False) -> list[dict]:
    limit = max(1, min(int(limit or 10), 50))
    connectors = {
        "remotive": _fetch_remotive,
        "arbeitnow": _fetch_arbeitnow,
        "remoteok": _fetch_remoteok,
        "themuse": _fetch_themuse,
        "jobicy": _fetch_jobicy,
    }
    if source in connectors:
        cands = await connectors[source](query)
    elif source in _KEYED_SOURCE_IDS:
        if not _key_for(source):
            raise JobSourceNotConfigured(
                f"{source.title()} import is not configured. "
                f"Set {next(s['key'] for s in SOURCES if s['id'] == source)} in settings to enable it."
            )
        cands = await _fetch_keyed(source, query)
    else:
        raise JobSourceError(f"Unknown source: {source}")

    cands = _apply_filters(cands, date_posted, job_type, remote_only)
    return _rank(cands, query, location, limit)


async def _fetch_remotive(query) -> list[dict]:
    params: dict = {"limit": 100}
    if query:
        params["search"] = query
    try:
        data = await _get_json("https://remotive.com/api/remote-jobs", params)
    except Exception as exc:
        raise JobSourceError(f"Remotive request failed: {exc}") from exc
    return [{
        "title": (j.get("title") or "").strip(),
        "description": _strip_html(j.get("description", "")),
        "company_name": (j.get("company_name") or "").strip() or None,
        "location": (j.get("candidate_required_location") or "").strip() or None,
        "employment_type": _norm_type(j.get("job_type")),
        "is_remote": True,
        "source_url": j.get("url"),
        "posted_at": _parse_epoch(j.get("publication_date")),
    } for j in (data.get("jobs") or [])]


async def _fetch_arbeitnow(query) -> list[dict]:
    try:
        data = await _get_json("https://www.arbeitnow.com/api/job-board-api")
    except Exception as exc:
        raise JobSourceError(f"Arbeitnow request failed: {exc}") from exc
    cands = []
    for j in (data.get("data") or []):
        types = j.get("job_types") or []
        cands.append({
            "title": (j.get("title") or "").strip(),
            "description": _strip_html(j.get("description", "")),
            "company_name": (j.get("company_name") or "").strip() or None,
            "location": (j.get("location") or "").strip() or None,
            "employment_type": _norm_type(types[0] if types else None),
            "is_remote": bool(j.get("remote")),
            "source_url": j.get("url"),
            "posted_at": _parse_epoch(j.get("created_at")),
        })
    return cands


async def _fetch_remoteok(query) -> list[dict]:
    try:
        data = await _get_json("https://remoteok.com/api")
    except Exception as exc:
        raise JobSourceError(f"RemoteOK request failed: {exc}") from exc
    cands = []
    for j in (data if isinstance(data, list) else []):
        if not isinstance(j, dict) or not j.get("position"):
            continue
        cands.append({
            "title": (j.get("position") or "").strip(),
            "description": _strip_html(j.get("description", "")),
            "company_name": (j.get("company") or "").strip() or None,
            "location": (j.get("location") or "").strip() or None,
            "employment_type": None,
            "is_remote": True,
            "source_url": j.get("url"),
            "posted_at": _parse_epoch(j.get("epoch") or j.get("date")),
        })
    return cands


async def _fetch_themuse(query) -> list[dict]:
    cands = []
    try:
        for page in (0, 1):
            data = await _get_json("https://www.themuse.com/api/public/jobs", {"page": page})
            for j in (data.get("results") or []):
                locs = [loc.get("name", "") for loc in (j.get("locations") or []) if loc.get("name")]
                cands.append({
                    "title": (j.get("name") or "").strip(),
                    "description": _strip_html(j.get("contents", "")),
                    "company_name": ((j.get("company") or {}).get("name") or "").strip() or None,
                    "location": ", ".join(locs) or None,
                    "employment_type": _norm_type(j.get("type")),
                    "is_remote": any("remote" in loc_name.lower() for loc_name in locs),
                    "source_url": (j.get("refs") or {}).get("landing_page"),
                    "posted_at": _parse_epoch(j.get("publication_date")),
                })
    except Exception as exc:
        raise JobSourceError(f"The Muse request failed: {exc}") from exc
    return cands


async def _fetch_jobicy(query) -> list[dict]:
    try:
        data = await _get_json("https://jobicy.com/api/v2/remote-jobs", {"count": 50})
    except Exception as exc:
        raise JobSourceError(f"Jobicy request failed: {exc}") from exc
    cands = []
    for j in (data.get("jobs") or []):
        jt = j.get("jobType")
        if isinstance(jt, list):
            jt = jt[0] if jt else None
        cands.append({
            "title": (j.get("jobTitle") or "").strip(),
            "description": _strip_html(j.get("jobDescription") or j.get("jobExcerpt") or ""),
            "company_name": (j.get("companyName") or "").strip() or None,
            "location": (j.get("jobGeo") or "").strip() or None,
            "employment_type": _norm_type(jt),
            "is_remote": True,
            "source_url": j.get("url"),
            "posted_at": _parse_epoch(j.get("pubDate") or j.get("lastUpdate")),
        })
    return cands


async def _fetch_keyed(source: str, query) -> list[dict]:
    logger.info("Keyed job source '%s' invoked with a key but no provider wired yet.", source)
    return []


_NUM = r"\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?"


def _to_int(num: str, has_k: bool) -> int:
    value = float(num.replace(",", ""))
    if has_k:
        value *= 1000
    return int(round(value))


_CUR = r"(?:USD|US\$|GBP|EUR|£|\$|€)"

_RANGE_SEP = "(?:-|–|" + chr(0x2014) + "|to)"

_SALARY_PATTERNS = [
    re.compile(
        rf"{_CUR}\s?({_NUM})\s*(k)?\s*{_RANGE_SEP}\s*{_CUR}?\s?({_NUM})\s*(k)?",
        re.IGNORECASE,
    ),
    re.compile(
        rf"\b({_NUM})\s*(k)\b\s*{_RANGE_SEP}\s*({_NUM})\s*(k)\b",
        re.IGNORECASE,
    ),
]


def extract_salary_range(text: str) -> tuple[int | None, int | None]:
    if not text:
        return (None, None)

    for pattern in _SALARY_PATTERNS:
        m = pattern.search(text)
        if not m:
            continue
        groups = m.groups()
        if len(groups) == 4:
            n1, k1, n2, k2 = groups
        else:
            continue
        try:
            lo = _to_int(n1, bool(k1))
            hi = _to_int(n2, bool(k2))
        except ValueError:
            continue
        if lo == 0 and hi == 0:
            continue
        if lo > hi:
            lo, hi = hi, lo
        return (lo, hi)

    return (None, None)
