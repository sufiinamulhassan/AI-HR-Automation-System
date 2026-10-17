from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from services.hr_module import external_interview_service as ext
from services.hr_module.job_comparison_service import effective_stage

logger = logging.getLogger(__name__)

TERMINAL_STAGES = ["hired", "rejected"]
ACTIVE_STAGES = ["interviewing", "completed"]

STARTING_SOON_HOURS = 24
UNOPENED_INVITE_DAYS = 3
EXPIRING_INVITE_HOURS = 48
STUCK_DAYS = 7
OFFER_NO_RESPONSE_DAYS = 7
EMAIL_FAILURE_HOURS = 24

STUCK_SCAN_LIMIT = 5000
AWAITING_SCAN_LIMIT = 5000
LIST_SCAN_LIMIT = 2000
MAX_LIST_ITEMS = 50

CANDIDATES_PATH = "/dashboard/hrbot"
EMAIL_DELIVERY_PATH = "/dashboard/settings"

ITEM_DEFINITIONS: list[tuple[str, str, str, str, dict[str, str]]] = [
    ("email_failures_24h", "Emails that failed in the last 24 hours", "urgent", EMAIL_DELIVERY_PATH, {"tab": "delivery"}),
    ("invites_expiring_48h", "Interview invites expiring within 48 hours", "urgent", CANDIDATES_PATH, {"attention": "invites_expiring_48h"}),
    ("external_awaiting_scorecard", "Interviews held, waiting for a scorecard", "warn", CANDIDATES_PATH, {"attention": "external_awaiting_scorecard"}),
    ("external_no_show_open", "No-shows not yet rescheduled", "warn", CANDIDATES_PATH, {"attention": "external_no_show_open"}),
    ("link_scorecards_waiting_for_hr", "Interviewer scorecards waiting for an HR scorecard", "warn", CANDIDATES_PATH, {"attention": "link_scorecards_waiting_for_hr"}),
    ("offers_pending_approval", "Offers waiting for approval", "warn", CANDIDATES_PATH, {"attention": "offers_pending_approval"}),
    ("offers_no_response_7d", "Offers with no reply after 7 days", "warn", CANDIDATES_PATH, {"attention": "offers_no_response_7d"}),
    ("candidates_stuck_7d", "Candidates with no movement for 7 days", "warn", CANDIDATES_PATH, {"attention": "candidates_stuck_7d"}),
    ("external_starting_soon", "Interviews starting in the next 24 hours", "info", CANDIDATES_PATH, {"attention": "external_starting_soon"}),
    ("invites_unopened_3d", "Interview invites not opened after 3 days", "info", CANDIDATES_PATH, {"attention": "invites_unopened_3d"}),
]
SEVERITY_ORDER = {"urgent": 0, "warn": 1, "info": 2}
KEYS = [d[0] for d in ITEM_DEFINITIONS]
LABELS = {d[0]: d[1] for d in ITEM_DEFINITIONS}

_ACTIVITY_FIELDS = (
    "created_at", "invite_sent_at", "token_regenerated_at", "last_resent_at",
    "interview_started_at", "interview_ended_at", "decided_at", "scheduled_start_at",
    "recruiter_notes_updated_at", "external_interview.scheduled_at",
    "external_interview.scheduled_start_at", "external_interview.updated_at",
    "external_review.reviewed_at",
)


def _iso(moment: datetime) -> str:
    return moment.isoformat()


def _dig(doc: dict, path: str):
    value = doc
    for part in path.split("."):
        value = value.get(part) if isinstance(value, dict) else None
        if value is None:
            return None
    return value


def _parse(value) -> datetime | None:
    if not value or not isinstance(value, str):
        return None
    try:
        moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return moment.replace(tzinfo=timezone.utc) if moment.tzinfo is None else moment.astimezone(timezone.utc)


def last_activity(candidate: dict) -> datetime | None:
    newest: datetime | None = None
    for path in _ACTIVITY_FIELDS:
        moment = _parse(_dig(candidate, path))
        if moment is not None and (newest is None or moment > newest):
            newest = moment
    return newest


def _span(delta: timedelta) -> str:
    seconds = max(int(delta.total_seconds()), 0)
    for size, unit in ((86400, "day"), (3600, "hour"), (60, "minute")):
        if seconds >= size:
            n = seconds // size
            return f"{n} {unit}{'' if n == 1 else 's'}"
    return "less than a minute"


class _Scope:

    def __init__(self, job_ids: list[str] | None):
        self.clause: dict = {} if job_ids is None else {"job_id": {"$in": list(job_ids)}}

    def candidates(self, extra: dict | None = None) -> dict:
        return {"doc_type": "candidate", "erased": {"$ne": True}, **self.clause, **(extra or {})}


def _external_open(scope: _Scope, extra: dict) -> dict:
    return scope.candidates({
        "interview_mode": "external",
        "external_review": None,
        "pipeline_stage": {"$nin": TERMINAL_STAGES},
        **extra,
    })


def _q_awaiting(scope: _Scope, now: datetime) -> dict:
    return _external_open(scope, {
        "external_interview.status": {"$ne": "no_show"},
        "external_interview.scheduled_start_at": {"$lte": _iso(now)},
    })


def _q_no_show(scope: _Scope, now: datetime) -> dict:
    return _external_open(scope, {"external_interview.status": "no_show"})


def _q_starting_soon(scope: _Scope, now: datetime) -> dict:
    return _external_open(scope, {
        "external_interview.status": {"$ne": "no_show"},
        "external_interview.scheduled_start_at": {
            "$gt": _iso(now), "$lte": _iso(now + timedelta(hours=STARTING_SOON_HOURS)),
        },
    })


def _q_link_waiting(scope: _Scope, now: datetime) -> dict:
    return scope.candidates({
        "pipeline_stage": {"$nin": TERMINAL_STAGES},
        "$and": [
            {"interview_scorecards": {"$elemMatch": {"source": "link"}}},
            {"interview_scorecards": {"$not": {"$elemMatch": {"source": "hr"}}}},
        ],
    })


def _q_offers_pending(scope: _Scope, now: datetime) -> dict:
    return {"doc_type": "offer", "status": "pending_approval", **scope.clause}


def _q_offers_no_response(scope: _Scope, now: datetime) -> dict:
    return {
        "doc_type": "offer", "status": "sent", **scope.clause,
        "sent_at": {"$lt": _iso(now - timedelta(days=OFFER_NO_RESPONSE_DAYS))},
    }


def _open_invites(scope: _Scope) -> dict:
    return scope.candidates({
        "interview_mode": {"$ne": "external"},
        "status": "invited",
        "token_status": "active",
        "session_active": {"$ne": True},
        "interview_started_at": None,
    })


def _q_invites_unopened(scope: _Scope, now: datetime) -> dict:
    cutoff = _iso(now - timedelta(days=UNOPENED_INVITE_DAYS))
    return {
        **_open_invites(scope),
        "invite_sent_at": {"$lt": cutoff},
        "token_regenerated_at": {"$not": {"$gte": cutoff}},
        "invite_expires_at": {"$gt": _iso(now)},
    }


def _q_invites_expiring(scope: _Scope, now: datetime) -> dict:
    return {
        **_open_invites(scope),
        "invite_expires_at": {"$gt": _iso(now), "$lte": _iso(now + timedelta(hours=EXPIRING_INVITE_HOURS))},
    }


def _q_stuck(scope: _Scope, now: datetime) -> dict:
    cutoff = now - timedelta(days=STUCK_DAYS)
    return scope.candidates({
        "$and": [
            {"$or": [{"status": {"$in": ACTIVE_STAGES}}, {"pipeline_stage": {"$in": ACTIVE_STAGES}}]},
            {"status": {"$nin": TERMINAL_STAGES}},
            {"pipeline_stage": {"$nin": TERMINAL_STAGES}},
        ],
        "created_at": {"$lt": _iso(cutoff)},
    })


def _q_email_failures(scope: _Scope, now: datetime) -> dict:
    return {
        "status": "failed", **scope.clause,
        "created_at": {"$gte": _iso(now - timedelta(hours=EMAIL_FAILURE_HOURS))},
    }


_EXTERNAL_START_PROJECTION = {
    "_id": 0, "interview_mode": 1,
    "external_interview.status": 1, "external_interview.scheduled_start_at": 1,
    "external_interview.duration_minutes": 1,
}
_ROW_FIELDS = {"candidate_id": 1, "job_id": 1, "name": 1, "status": 1, "pipeline_stage": 1}


async def _awaiting_rows(db, scope: _Scope, now: datetime) -> list[tuple[dict, datetime | None]]:
    cursor = db.candidates.find(
        _q_awaiting(scope, now), {**_EXTERNAL_START_PROJECTION, **_ROW_FIELDS},
    ).limit(AWAITING_SCAN_LIMIT)
    rows = []
    for doc in await cursor.to_list(length=AWAITING_SCAN_LIMIT):
        if ext.external_status(doc, now) != "awaiting_review":
            continue
        interview = doc.get("external_interview") or {}
        start = _parse(interview.get("scheduled_start_at"))
        ended = start + timedelta(minutes=int(interview.get("duration_minutes") or 0)) if start else None
        rows.append((doc, ended))
    return rows


async def _stuck_rows(db, scope: _Scope, now: datetime) -> list[tuple[dict, datetime | None]]:
    cutoff = now - timedelta(days=STUCK_DAYS)
    projection = {"_id": 0, **_ROW_FIELDS, **{path: 1 for path in _ACTIVITY_FIELDS}}
    cursor = db.candidates.find(_q_stuck(scope, now), projection).limit(STUCK_SCAN_LIMIT)
    rows = []
    async for doc in cursor:
        moment = last_activity(doc)
        if moment is not None and moment < cutoff:
            rows.append((doc, moment))
    return rows


async def _count_awaiting_scorecard(db, scope: _Scope, now: datetime) -> int:
    return len(await _awaiting_rows(db, scope, now))


async def _count_no_show_open(db, scope: _Scope, now: datetime) -> int:
    return await db.candidates.count_documents(_q_no_show(scope, now))


async def _count_starting_soon(db, scope: _Scope, now: datetime) -> int:
    return await db.candidates.count_documents(_q_starting_soon(scope, now))


async def _count_link_scorecards_waiting(db, scope: _Scope, now: datetime) -> int:
    return await db.candidates.count_documents(_q_link_waiting(scope, now))


async def _count_offers_pending_approval(db, scope: _Scope, now: datetime) -> int:
    return await db.offers.count_documents(_q_offers_pending(scope, now))


async def _count_offers_no_response(db, scope: _Scope, now: datetime) -> int:
    return await db.offers.count_documents(_q_offers_no_response(scope, now))


async def _count_invites_unopened(db, scope: _Scope, now: datetime) -> int:
    return await db.candidates.count_documents(_q_invites_unopened(scope, now))


async def _count_invites_expiring(db, scope: _Scope, now: datetime) -> int:
    return await db.candidates.count_documents(_q_invites_expiring(scope, now))


async def _count_stuck(db, scope: _Scope, now: datetime) -> int:
    return len(await _stuck_rows(db, scope, now))


async def _count_email_failures(db, scope: _Scope, now: datetime) -> int:
    return await db.email_log.count_documents(_q_email_failures(scope, now))


_COUNTERS = {
    "external_awaiting_scorecard": _count_awaiting_scorecard,
    "external_no_show_open": _count_no_show_open,
    "external_starting_soon": _count_starting_soon,
    "link_scorecards_waiting_for_hr": _count_link_scorecards_waiting,
    "offers_pending_approval": _count_offers_pending_approval,
    "offers_no_response_7d": _count_offers_no_response,
    "invites_unopened_3d": _count_invites_unopened,
    "invites_expiring_48h": _count_invites_expiring,
    "candidates_stuck_7d": _count_stuck,
    "email_failures_24h": _count_email_failures,
}


async def build_attention(db, *, job_ids: list[str] | None = None, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    scope = _Scope(job_ids)
    results = await asyncio.gather(
        *(_COUNTERS[key](db, scope, now) for key in KEYS), return_exceptions=True,
    )

    items: list[dict] = []
    for (key, label, severity, path, query), result in zip(ITEM_DEFINITIONS, results):
        if isinstance(result, BaseException):
            logger.warning("attention count failed | key=%s error=%s", key, result)
            continue
        if result > 0:
            items.append({
                "key": key, "label": label, "count": int(result),
                "severity": severity, "path": path, "query": dict(query),
            })
    order = {key: i for i, key in enumerate(KEYS)}
    items.sort(key=lambda item: (SEVERITY_ORDER[item["severity"]], -item["count"], order[item["key"]]))
    return {"generated_at": now.isoformat(), "items": items}


async def _list_awaiting(db, scope, now):
    rows = await _awaiting_rows(db, scope, now)
    return len(rows), [
        (doc, ended, f"Interview ended {_span(now - ended)} ago" if ended else "Interview ended")
        for doc, ended in rows
    ]


async def _list_no_show(db, scope, now):
    cursor = (
        db.candidates.find(_q_no_show(scope, now), {**_ROW_FIELDS, "_id": 0, "external_interview.scheduled_start_at": 1})
        .sort("external_interview.scheduled_start_at", 1).limit(MAX_LIST_ITEMS)
    )
    rows = []
    for doc in await cursor.to_list(length=MAX_LIST_ITEMS):
        start = _parse(_dig(doc, "external_interview.scheduled_start_at"))
        rows.append((doc, start, f"No-show {_span(now - start)} ago" if start else "No-show"))
    return await db.candidates.count_documents(_q_no_show(scope, now)), rows


async def _list_starting_soon(db, scope, now):
    cursor = (
        db.candidates.find(_q_starting_soon(scope, now), {**_ROW_FIELDS, "_id": 0, "external_interview.scheduled_start_at": 1})
        .sort("external_interview.scheduled_start_at", 1).limit(MAX_LIST_ITEMS)
    )
    rows = []
    for doc in await cursor.to_list(length=MAX_LIST_ITEMS):
        start = _parse(_dig(doc, "external_interview.scheduled_start_at"))
        rows.append((doc, start, f"Interview starts in {_span(start - now)}" if start else "Interview starts soon"))
    return await db.candidates.count_documents(_q_starting_soon(scope, now)), rows


async def _list_link_waiting(db, scope, now):
    cursor = db.candidates.find(
        _q_link_waiting(scope, now),
        {**_ROW_FIELDS, "_id": 0, "interview_scorecards.source": 1, "interview_scorecards.submitted_at": 1},
    ).limit(LIST_SCAN_LIMIT)
    rows = []
    for doc in await cursor.to_list(length=LIST_SCAN_LIMIT):
        filed = [
            m for m in (_parse(c.get("submitted_at")) for c in doc.get("interview_scorecards") or [] if c.get("source") == "link")
            if m is not None
        ]
        since = min(filed) if filed else None
        rows.append((doc, since, f"Interviewer scorecard waiting {_span(now - since)}" if since else "Interviewer scorecard waiting"))
    return await db.candidates.count_documents(_q_link_waiting(scope, now)), rows


async def _list_invites(db, query, now, detail):
    cursor = (
        db.candidates.find(query, {**_ROW_FIELDS, "_id": 0, "invite_sent_at": 1, "invite_expires_at": 1})
        .sort("invite_expires_at", 1).limit(MAX_LIST_ITEMS)
    )
    rows = []
    for doc in await cursor.to_list(length=MAX_LIST_ITEMS):
        rows.append((doc, _parse(doc.get("invite_expires_at")), detail(doc)))
    return await db.candidates.count_documents(query), rows


async def _list_invites_unopened(db, scope, now):
    def detail(doc):
        sent = _parse(doc.get("invite_sent_at"))
        return f"Invite sent {_span(now - sent)} ago" if sent else "Invite not opened"
    return await _list_invites(db, _q_invites_unopened(scope, now), now, detail)


async def _list_invites_expiring(db, scope, now):
    def detail(doc):
        expires = _parse(doc.get("invite_expires_at"))
        return f"Invite expires in {_span(expires - now)}" if expires else "Invite expires soon"
    return await _list_invites(db, _q_invites_expiring(scope, now), now, detail)


async def _list_stuck(db, scope, now):
    rows = await _stuck_rows(db, scope, now)
    return len(rows), [(doc, moment, f"No movement for {_span(now - moment)}") for doc, moment in rows]


async def _list_offers(db, query, sort_field, detail, due_of):
    cursor = (
        db.offers.find(query, {"_id": 0, "candidate_id": 1, "job_id": 1, "created_at": 1, "sent_at": 1})
        .sort(sort_field, 1).limit(MAX_LIST_ITEMS)
    )
    rows = []
    for offer in await cursor.to_list(length=MAX_LIST_ITEMS):
        rows.append((offer, due_of(offer), detail(offer)))
    return await db.offers.count_documents(query), rows


async def _list_offers_pending(db, scope, now):
    def detail(offer):
        created = _parse(offer.get("created_at"))
        return f"Offer waiting for approval for {_span(now - created)}" if created else "Offer waiting for approval"
    return await _list_offers(
        db, _q_offers_pending(scope, now), "created_at", detail, lambda o: _parse(o.get("created_at")),
    )


async def _list_offers_no_response(db, scope, now):
    def detail(offer):
        sent = _parse(offer.get("sent_at"))
        return f"Offer sent {_span(now - sent)} ago" if sent else "Offer sent"
    def due(offer):
        sent = _parse(offer.get("sent_at"))
        return sent + timedelta(days=OFFER_NO_RESPONSE_DAYS) if sent else None
    return await _list_offers(db, _q_offers_no_response(scope, now), "sent_at", detail, due)


async def _list_email_failures(db, scope, now):
    return await _count_email_failures(db, scope, now), []


_LISTERS = {
    "external_awaiting_scorecard": _list_awaiting,
    "external_no_show_open": _list_no_show,
    "external_starting_soon": _list_starting_soon,
    "link_scorecards_waiting_for_hr": _list_link_waiting,
    "offers_pending_approval": _list_offers_pending,
    "offers_no_response_7d": _list_offers_no_response,
    "invites_unopened_3d": _list_invites_unopened,
    "invites_expiring_48h": _list_invites_expiring,
    "candidates_stuck_7d": _list_stuck,
    "email_failures_24h": _list_email_failures,
}


async def list_attention(
    db, key: str, *, job_ids: list[str] | None = None, now: datetime | None = None,
) -> dict:
    lister = _LISTERS[key]
    now = now or datetime.now(timezone.utc)
    total, rows = await lister(db, _Scope(job_ids), now)

    far_future = datetime.max.replace(tzinfo=timezone.utc)
    rows.sort(key=lambda r: (r[1] or far_future, str(r[0].get("candidate_id") or "")))
    rows = rows[:MAX_LIST_ITEMS]

    candidates: dict[str, dict] = {}
    needed = [r[0]["candidate_id"] for r in rows if r[0].get("candidate_id") and "name" not in r[0]]
    if needed:
        async for cand in db.candidates.find(
            {"candidate_id": {"$in": needed}}, {**_ROW_FIELDS, "_id": 0},
        ):
            candidates[cand["candidate_id"]] = cand

    resolved = []
    for doc, due, detail in rows:
        cand = doc if "name" in doc or not doc.get("candidate_id") else candidates.get(doc["candidate_id"], {})
        resolved.append((doc, cand, due, detail))

    job_ids_needed = list({(doc.get("job_id") or cand.get("job_id")) for doc, cand, _, _ in resolved} - {None})
    titles: dict[str, str | None] = {}
    if job_ids_needed:
        async for job in db.jobs.find({"job_id": {"$in": job_ids_needed}}, {"_id": 0, "job_id": 1, "title": 1}):
            titles[job["job_id"]] = job.get("title")

    items = []
    for doc, cand, due, detail in resolved:
        job_id = doc.get("job_id") or cand.get("job_id")
        items.append({
            "candidate_id": doc.get("candidate_id"),
            "job_id": job_id,
            "job_title": titles.get(job_id),
            "name": cand.get("name"),
            "stage": effective_stage(cand, None),
            "detail": detail,
            "due_at": due.isoformat() if due else None,
        })
    return {"key": key, "label": LABELS[key], "total": int(total), "items": items}
