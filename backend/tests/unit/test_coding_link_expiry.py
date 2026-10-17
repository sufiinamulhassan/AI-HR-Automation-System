import ast
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi import HTTPException
from fastapi.routing import APIRoute

from config.settings import settings
from services.hr_module import coding_link_service as link

pytestmark = pytest.mark.anyio

NOW = datetime(2026, 10, 12, 12, 0, tzinfo=timezone.utc)
BACKEND = Path(__file__).resolve().parents[2]


@pytest.fixture(autouse=True)
def fixed_settings(monkeypatch):
    monkeypatch.setattr(settings, "INVITE_LINK_EXPIRY_DAYS", 7)
    monkeypatch.setattr(settings, "CODING_LINK_GRACE_DAYS", 30)


def at(days: float) -> str:
    return (NOW + timedelta(days=days)).isoformat()


def expired(cand: dict) -> bool:
    return link.coding_link_expired(cand, now=NOW)


@pytest.mark.parametrize("cand,want,why", [
    ({"coding_invite_expires_at": at(+3)}, False, "stamp in the future"),
    ({"coding_invite_expires_at": at(-1)}, True, "stamp in the past"),
    ({"coding_invite_expires_at": at(-0.001)}, True, "just past the stamp"),
    ({"coding_invite_expires_at": at(+0.001)}, False, "just before the stamp"),
    ({"coding_invite_expires_at": at(+3), "invite_expires_at": at(-100)}, False, "the stamp outlives an interview link long expired"),
    ({"coding_invite_expires_at": at(-1), "invite_expires_at": at(+5)}, True, "the stamp ends it though the interview link is live"),
    ({"invite_expires_at": at(+2)}, False, "interview link still live"),
    ({"invite_expires_at": at(-10)}, False, "10 days past, inside the grace"),
    ({"invite_expires_at": at(-29)}, False, "29 days past"),
    ({"invite_expires_at": at(-31)}, True, "31 days past"),
    ({"invite_expires_at": at(-300)}, True, "long past"),
    ({"invite_sent_at": at(-36)}, False, "sent 36 days ago: expires 29 days ago, grace to tomorrow"),
    ({"invite_sent_at": at(-38)}, True, "sent 38 days ago"),
    ({"created_at": at(-38)}, True, "falls back to created_at"),
    ({"invite_sent_at": at(-100), "token_regenerated_at": at(-3)}, False, "a regenerated token restarts the clock"),
    ({}, False, "no dates at all"),
    ({"invite_expires_at": "garbage"}, False, "unreadable expiry, nothing to fall back to"),
    ({"coding_invite_expires_at": "garbage", "invite_expires_at": at(-31)}, True, "an unreadable stamp falls back to the rule"),
    ({"coding_invite_expires_at": "", "invite_expires_at": at(-1)}, False, "an empty stamp is no stamp"),
    ({"coding_invite_expires_at": None, "invite_sent_at": at(-1)}, False, "a null stamp is no stamp"),
])
def test_the_expiry_rule(cand, want, why):
    assert expired(cand) is want, why


def test_a_stamp_without_a_zone_is_read_as_utc_and_a_z_suffix_is_understood():
    assert expired({"coding_invite_expires_at": "2026-10-12T11:59:00"}) is True
    assert expired({"coding_invite_expires_at": "2026-10-12T12:01:00"}) is False
    assert expired({"coding_invite_expires_at": "2026-10-12T11:59:00Z"}) is True
    assert expired({"coding_invite_expires_at": "2026-10-12T15:00:00+05:30"}) is True


def test_the_grace_period_is_a_setting(monkeypatch):
    monkeypatch.setattr(settings, "CODING_LINK_GRACE_DAYS", 0)
    assert expired({"invite_expires_at": at(-1)}) is True and expired({"invite_expires_at": at(+1)}) is False
    monkeypatch.setattr(settings, "CODING_LINK_GRACE_DAYS", 90)
    assert expired({"invite_expires_at": at(-89)}) is False and expired({"invite_expires_at": at(-91)}) is True


def test_a_stamp_is_the_send_time_plus_the_interview_link_lifetime(monkeypatch):
    assert link.coding_expiry_stamp(NOW) == at(+7)
    monkeypatch.setattr(settings, "INVITE_LINK_EXPIRY_DAYS", 14)
    assert link.coding_expiry_stamp(NOW) == at(+14)
    fresh = link.coding_expiry_stamp()
    assert datetime.fromisoformat(fresh) > datetime.now(timezone.utc) + timedelta(days=13)


def test_a_resend_or_a_new_token_stamps_a_fresh_expiry_that_revives_an_expired_link():
    cand = {"coding_invite_expires_at": at(-5), "invite_expires_at": at(-60)}
    assert expired(cand) is True
    cand["coding_invite_expires_at"] = link.coding_expiry_stamp(NOW)
    assert expired(cand) is False


def test_the_410_carries_the_contract_sentence():
    assert link.EXPIRED_MESSAGE == "This assessment link has expired. Ask your recruiter for a new one."
    assert "-" not in link.EXPIRED_MESSAGE
    with pytest.raises(HTTPException) as err:
        link.require_live_coding_link({"coding_invite_expires_at": "2000-01-01T00:00:00+00:00"})
    assert err.value.status_code == 410 and err.value.detail == link.EXPIRED_MESSAGE
    link.require_live_coding_link({"coding_invite_expires_at": "2999-01-01T00:00:00+00:00"})


def test_a_route_that_reads_the_candidate_with_a_projection_gets_every_field_the_rule_needs():
    assert set(link.EXPIRY_PROJECTION) == {
        "coding_invite_expires_at", "invite_expires_at", "invite_sent_at", "token_regenerated_at", "created_at",
    }
    assert all(value == 1 for value in link.EXPIRY_PROJECTION.values())


PUBLIC_HANDLERS = ("get_session", "submit_session", "run_session", "get_modify_probe", "record_coding_flag", "autosave_session")


def _functions():
    tree = ast.parse((BACKEND / "routes" / "coding.py").read_text(encoding="utf-8"))
    return {n.name: n for n in ast.walk(tree) if isinstance(n, ast.AsyncFunctionDef)}


def test_all_six_public_routes_check_the_expiry_after_the_token_lookup():
    functions = _functions()
    for name in PUBLIC_HANDLERS:
        calls = [
            n for n in ast.walk(functions[name])
            if isinstance(n, ast.Call) and getattr(n.func, "id", None) == "require_live_coding_link"
        ]
        assert len(calls) == 1, f"{name} must check the coding link expiry exactly once"
        lookups = [
            n.lineno for n in ast.walk(functions[name])
            if isinstance(n, ast.Call) and getattr(n.func, "attr", None) == "find_one"
        ]
        assert min(lookups) < calls[0].lineno, f"{name}: the expiry is checked on the candidate that was found"


def test_a_projected_read_of_the_candidate_asks_for_the_expiry_fields():
    source = (BACKEND / "routes" / "coding.py").read_text(encoding="utf-8")
    assert source.count("**EXPIRY_PROJECTION") == 2


def _routes():
    from routes import coding

    return [r for r in coding.router.routes if isinstance(r, APIRoute)]


def _feature_flags(route: APIRoute) -> list[str]:
    def walk(dependant):
        for sub in dependant.dependencies:
            yield sub.call
            yield from walk(sub)

    return [getattr(c, "plan_feature") for c in walk(route.dependant) if getattr(c, "plan_feature", None)]


def test_every_admin_coding_route_needs_the_coding_feature_and_no_public_route_does():
    routes = _routes()
    public = [r for r in routes if r.path.startswith("/session/")]
    admin = [r for r in routes if not r.path.startswith("/session/")]
    assert len(public) == 6 and len(admin) == 11
    for route in public:
        assert _feature_flags(route) == [], f"{route.path}: a candidate's link must not depend on the company's plan"
    for route in admin:
        assert _feature_flags(route) == ["coding"], f"{sorted(route.methods)} {route.path}"


def test_the_feature_check_comes_after_the_role_and_permission_checks_and_before_the_quota():
    for route in _routes():
        if route.path.startswith("/session/"):
            continue
        names = [getattr(sub.call, "__name__", "") for sub in route.dependant.dependencies]
        gate = names.index("_gate")
        assert "require_admin" in names[:gate], route.path
        assert "_check_permission" in names[:gate], route.path
        if "_guard" in names:
            assert gate < names.index("_guard"), f"{route.path}: a plan refusal must not spend the allowance"


def test_the_helper_is_importable_from_the_route_module():
    from routes import coding

    assert coding.coding_link_expired is link.coding_link_expired
