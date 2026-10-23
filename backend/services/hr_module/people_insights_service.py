from __future__ import annotations

from datetime import date, timedelta
from statistics import mean
from typing import Any

from services.hr_module import workforce_service as ws

HIGH_RISK = 50
MEDIUM_RISK = 25
STRONG_INTERVIEW = 70
LOW_COVERAGE = 0.5
MAX_ROWS = 2000


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def _pct(value: float | None) -> float | None:
    return None if value is None else round(value, 1)


def pearson(xs: list[float], ys: list[float]) -> float | None:
    if len(xs) < 3 or len(xs) != len(ys):
        return None
    mx, my = mean(xs), mean(ys)
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    sxx = sum((x - mx) ** 2 for x in xs)
    syy = sum((y - my) ** 2 for y in ys)
    if not sxx or not syy:
        return None
    return round(sxy / (sxx * syy) ** 0.5, 2)


def correlation_label(r: float | None) -> str:
    if r is None:
        return "Not enough hires with both an interview score and a review yet."
    if r >= 0.5:
        return "Interview scores predict performance well."
    if r >= 0.2:
        return "Interview scores predict performance somewhat."
    if r > -0.2:
        return "Interview scores do not predict performance yet. Review what the interview measures."
    return "Higher interview scores are going with lower performance. The interview needs attention."


async def _scale(db) -> tuple[float, float]:
    doc = await db.system_config.find_one({"key": "performance_rating_scale"}, {"_id": 0}) or {}
    low = _number(doc.get("scale_min")) or 1.0
    high = _number(doc.get("scale_max")) or 5.0
    return (low, high) if high > low else (1.0, 5.0)


async def performance_scores(db) -> dict[str, dict]:
    low, high = await _scale(db)
    rows = await db.performance_reviews.find(
        {"status": "submitted"}, {"_id": 0, "employee_id": 1, "ratings": 1, "submitted_at": 1},
    ).to_list(length=MAX_ROWS * 5)
    out: dict[str, dict] = {}
    for r in rows:
        values = [v for v in ((r.get("ratings") or {}).values()) if _number(v) is not None]
        if not values:
            continue
        score = (mean(values) - low) / (high - low) * 100
        entry = out.setdefault(r["employee_id"], {"scores": [], "last": ""})
        entry["scores"].append(max(0.0, min(100.0, score)))
        entry["last"] = max(entry["last"], r.get("submitted_at") or "")
    return {k: {"score": round(mean(v["scores"]), 1), "reviews": len(v["scores"]), "last": v["last"] or None} for k, v in out.items()}


def attendance_rate(records: list[dict]) -> float | None:
    counted = [r for r in records if r.get("status") in ("present", "remote", "half_day", "absent")]
    if not counted:
        return None
    attended = sum(1.0 if r["status"] in ("present", "remote") else 0.5 if r["status"] == "half_day" else 0.0 for r in counted)
    return round(100 * attended / len(counted), 1)


def _hours(record: dict) -> float | None:
    if not record.get("check_in") or not record.get("check_out"):
        return None
    h1, m1 = map(int, record["check_in"].split(":"))
    h2, m2 = map(int, record["check_out"].split(":"))
    return max(0, (h2 * 60 + m2) - (h1 * 60 + m1)) / 60


async def _attendance_by_person(db, since: date) -> dict[str, list[dict]]:
    rows = await db.attendance.find({"date": {"$gte": since.isoformat()}}, {"_id": 0}).to_list(length=MAX_ROWS * 120)
    out: dict[str, list[dict]] = {}
    for r in rows:
        out.setdefault(r["employee_id"], []).append(r)
    return out


def _joined(e: dict) -> date | None:
    raw = e.get("joined_on") or (e.get("hired_at") or "")[:10]
    try:
        return date.fromisoformat(raw) if raw else None
    except ValueError:
        return None


def verdict(performance: float | None, tenure_days: int | None) -> str:
    if performance is None:
        return "Too early to tell" if (tenure_days or 0) < 180 else "No review yet"
    if performance >= 70:
        return "Strong hire"
    if performance >= 50:
        return "On track"
    return "Below expectations"


async def hire_quality(db, today: date | None = None) -> dict:
    today = today or date.today()
    people = [p for p in await ws.list_employees(db) if p.get("candidate_id")]
    ids = [p["candidate_id"] for p in people]
    candidates = {
        c["candidate_id"]: c
        for c in await db.candidates.find(
            {"candidate_id": {"$in": ids}},
            {"_id": 0, "candidate_id": 1, "final_score": 1, "match_score": 1, "interview_mode": 1, "application_source": 1},
        ).to_list(length=len(ids) or 1)
    } if ids else {}
    perf = await performance_scores(db)
    attendance = await _attendance_by_person(db, today - timedelta(days=90))
    rows = []
    for p in people:
        cand = candidates.get(p["candidate_id"], {})
        interview = _number(cand.get("final_score")) if cand.get("interview_mode") != "external" else None
        match = _number(cand.get("match_score"))
        joined = _joined(p)
        tenure = (today - joined).days if joined else None
        performance = (perf.get(p["employee_id"]) or {}).get("score")
        rows.append({
            "employee_id": p["employee_id"],
            "full_name": p["full_name"],
            "designation": p["designation"],
            "department_name": p["department_name"],
            "status": p["status"],
            "match_score": _pct(match * 100) if match is not None else None,
            "interview_score": _pct(interview),
            "performance_score": performance,
            "attendance_rate": attendance_rate(attendance.get(p["employee_id"], [])),
            "tenure_days": tenure,
            "verdict": verdict(performance, tenure),
            "source": cand.get("application_source") or "",
        })
    paired = [r for r in rows if r["interview_score"] is not None and r["performance_score"] is not None]
    r_value = pearson([r["interview_score"] for r in paired], [r["performance_score"] for r in paired])
    strong = [r["performance_score"] for r in paired if r["interview_score"] >= STRONG_INTERVIEW]
    weaker = [r["performance_score"] for r in paired if r["interview_score"] < STRONG_INTERVIEW]
    exited_early = [r for r in rows if r["status"] == "exited" and (r["tenure_days"] or 0) < 180]
    rows.sort(key=lambda r: (r["performance_score"] is None, -(r["performance_score"] or 0), r["full_name"].lower()))
    return {
        "hired_through_hirely": len(rows),
        "with_review": sum(1 for r in rows if r["performance_score"] is not None),
        "paired": len(paired),
        "correlation": r_value,
        "correlation_label": correlation_label(r_value),
        "strong_interview_performance": _pct(mean(strong)) if strong else None,
        "other_interview_performance": _pct(mean(weaker)) if weaker else None,
        "early_exits": len(exited_early),
        "rows": rows,
    }


def _risk_signals(e: dict, *, today: date, leave: list[dict], records: list[dict], perf: dict | None, holidays: set[date], manages: bool = False) -> list[dict]:
    signals: list[dict] = []
    joined = _joined(e)
    tenure = (today - joined).days if joined else None

    def add(points: int, kind: str, text: str) -> None:
        signals.append({"points": points, "kind": kind, "text": text})

    recent_short = 0
    for r in leave:
        if r["status"] != "approved" or r.get("leave_type_name", "").lower().startswith("annual"):
            continue
        start = date.fromisoformat(r["start_date"])
        end = date.fromisoformat(r["end_date"])
        if (today - start).days > 90 or start > today:
            continue
        if start == end and start.weekday() in (0, 4):
            recent_short += 1
    if recent_short >= 2:
        add(20, "attrition", f"{recent_short} single day sick or casual leaves on a Monday or Friday in the last 90 days")

    last30 = [r for r in records if (today - date.fromisoformat(r["date"])).days < 30]
    prior30 = [r for r in records if 30 <= (today - date.fromisoformat(r["date"])).days < 60]
    absences = sum(1 for r in last30 if r.get("status") == "absent")
    if absences >= 2:
        add(15, "attrition", f"{absences} unplanned absences in the last 30 days")
    now_rate, before_rate = attendance_rate(last30), attendance_rate(prior30)
    if now_rate is not None and before_rate is not None and before_rate - now_rate >= 15:
        add(20, "attrition", f"Attendance fell from {before_rate:g}% to {now_rate:g}% compared with the month before")

    hours = [h for h in (_hours(r) for r in last30) if h is not None]
    if len(hours) >= 5 and mean(hours) >= 9.5:
        add(20, "burnout", f"Averaging {mean(hours):.1f} hour days over the last 30 days")
    took_leave = any(
        r["status"] == "approved" and (today - date.fromisoformat(r["end_date"])).days <= 120 for r in leave
    )
    if tenure is not None and tenure > 120 and not took_leave:
        add(15, "burnout", "No leave taken in the last 120 days")

    if not e.get("manager_id") and not manages:
        add(10, "attrition", "No manager assigned")
    if perf and perf["score"] < 50:
        add(20, "attrition", f"Latest performance score is {perf['score']:g} out of 100")
    if not perf and tenure is not None and tenure > 180:
        add(10, "attrition", "No performance review in more than 6 months")
    if tenure is not None and tenure <= 90:
        add(10, "attrition", "In the first 90 days, when people are most likely to leave")
    return signals


def risk_level(score: int) -> str:
    if score >= HIGH_RISK:
        return "high"
    if score >= MEDIUM_RISK:
        return "medium"
    return "low"


async def risk_radar(db, today: date | None = None) -> dict:
    today = today or date.today()
    people = [p for p in await ws.list_employees(db) if p["status"] != "exited"]
    leave_rows = await db.leave_requests.find(
        {"start_date": {"$gte": (today - timedelta(days=200)).isoformat()}}, {"_id": 0},
    ).to_list(length=MAX_ROWS * 10)
    leave_by: dict[str, list[dict]] = {}
    for r in leave_rows:
        leave_by.setdefault(r["employee_id"], []).append(r)
    attendance = await _attendance_by_person(db, today - timedelta(days=60))
    perf = await performance_scores(db)
    holidays = await ws.holiday_dates(db, today - timedelta(days=120), today)
    managers = {p.get("manager_id") for p in people if p.get("manager_id")}
    rows = []
    for p in people:
        signals = _risk_signals(
            p, today=today, leave=leave_by.get(p["employee_id"], []), records=attendance.get(p["employee_id"], []),
            perf=perf.get(p["employee_id"]), holidays=holidays, manages=p["employee_id"] in managers,
        )
        score = min(100, sum(s["points"] for s in signals))
        rows.append({
            "employee_id": p["employee_id"],
            "full_name": p["full_name"],
            "designation": p["designation"],
            "department_name": p["department_name"],
            "score": score,
            "level": risk_level(score),
            "burnout": any(s["kind"] == "burnout" for s in signals),
            "signals": sorted(signals, key=lambda s: -s["points"]),
        })
    rows.sort(key=lambda r: (-r["score"], r["full_name"].lower()))
    return {
        "date": today.isoformat(),
        "counts": {level: sum(1 for r in rows if r["level"] == level) for level in ("high", "medium", "low")},
        "burnout": sum(1 for r in rows if r["burnout"]),
        "rows": rows,
    }


async def leave_coverage(db, *, employee_id: str, start: Any, end: Any, exclude_request: str | None = None) -> dict:
    employee = await ws.get_employee(db, employee_id)
    first, last = ws.parse_day(start, "start_date"), ws.parse_day(end or start, "end_date")
    if last < first:
        raise ws.WorkforceError("The end date cannot be before the start date.")
    if (last - first).days > ws.MAX_LEAVE_DAYS:
        raise ws.WorkforceError(f"Check at most {ws.MAX_LEAVE_DAYS} days at a time.")
    everyone = [p for p in await ws.list_employees(db) if p["status"] != "exited"]
    department = employee.get("department")
    team = [p for p in everyone if p.get("department") == department] if department else everyone
    team_ids = {p["employee_id"] for p in team}
    names = {p["employee_id"]: p["full_name"] for p in team}
    leave = await db.leave_requests.find(
        {"status": {"$in": ["pending", "approved"]}, "start_date": {"$lte": last.isoformat()}, "end_date": {"$gte": first.isoformat()}},
        {"_id": 0},
    ).to_list(length=MAX_ROWS)
    leave = [
        r for r in leave
        if r["employee_id"] in team_ids and r["employee_id"] != employee_id and r.get("request_id") != exclude_request
    ]
    days = []
    for day in ws.working_days(first, last, await ws.holiday_dates(db, first, last)):
        off = [
            {"employee_id": r["employee_id"], "full_name": names.get(r["employee_id"], ""), "status": r["status"], "leave_type_name": r.get("leave_type_name")}
            for r in leave
            if r["start_date"] <= day.isoformat() <= r["end_date"]
        ]
        size = len(team)
        available = max(0, size - len({o["employee_id"] for o in off}) - 1)
        coverage = round(available / size, 2) if size else 0.0
        days.append({"date": day.isoformat(), "off": off, "available": available, "coverage": coverage, "low": coverage < LOW_COVERAGE})
    worst = min(days, key=lambda d: d["coverage"]) if days else None
    return {
        "employee_id": employee_id,
        "employee_name": employee["full_name"],
        "team": employee.get("department_name") or "Whole company",
        "team_size": len(team),
        "days": days,
        "low_days": sum(1 for d in days if d["low"]),
        "worst": worst,
        "warning": bool(days) and len(team) > 1 and any(d["low"] for d in days),
    }


async def request_coverage(db, request_id: str) -> dict:
    request = await db.leave_requests.find_one({"request_id": request_id}, {"_id": 0})
    if not request:
        raise ws.WorkforceError("Leave request not found", 404)
    return await leave_coverage(
        db, employee_id=request["employee_id"], start=request["start_date"], end=request["end_date"], exclude_request=request_id,
    )
