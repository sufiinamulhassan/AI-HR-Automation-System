import uuid
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from config.database import get_db
from shared.rate_limit import client_ip, public_token_throttle
from support_routes import all_routes

pytestmark = pytest.mark.anyio

API = "/api/v1"

OWN_LIMITER = {
    "POST /api/v1/auth/login": "per-email and per-IP limiter in _authenticate_password",
    "POST /api/v1/auth/token": "shares the login limiter",
    "POST /api/v1/auth/verify-otp": "per-email and per-IP limiter plus a per-code attempt cap",
    "POST /api/v1/auth/forgot-password": "per-email and per-IP limiter in routes/auth.py",
    "POST /api/v1/auth/reset-password": "per-IP limiter in routes/auth.py, and the link token is single use",
    "GET /api/v1/interviewer-scorecard/{token}": "per-IP and per-token limiter in routes/interviewer_scorecard.py",
    "PUT /api/v1/interviewer-scorecard/{token}": "per-IP and per-token limiter in routes/interviewer_scorecard.py",
}
NO_CREDENTIAL = {
    "GET /api/docs": "API documentation page",
    "GET /api/redoc": "API documentation page",
    "GET /health": "liveness probe, no data",
    "GET /health/ready": "readiness probe: one database ping and the word ready or unavailable, no data",
    "GET /api/v1/branding/public": "logo and colours for the login page, by design public",
    "GET /api/v1/branding/logo/{company_id}": "the company logo image shown on the public careers pages, cached, no personal data",
    "GET /api/v1/performance/rating-config": "dimension names and the scale, no personal data",
}

EXPECTED_THROTTLED = {
    "GET /api/v1/interview/session/{secure_token}",
    "POST /api/v1/interview/session/{secure_token}/submit",
    "POST /api/v1/interview/session/{secure_token}/flag",
    "POST /api/v1/interview/{secure_token}/demographics",
    "POST /api/v1/interview/session/{secure_token}/followup",
    "POST /api/v1/interview/session/{secure_token}/reasoning-probe",
    "POST /api/v1/interview/session/{secure_token}/speak",
    "POST /api/v1/interview/session/{secure_token}/transcribe",
    "GET /api/v1/interview/shared-report/{token}",
    "POST /api/v1/interview/shared-report/{token}/feedback",
    "GET /api/v1/offers/public/{secure_token}",
    "POST /api/v1/offers/public/{secure_token}/accept",
    "POST /api/v1/offers/public/{secure_token}/decline",
    "GET /api/v1/coding/session/{secure_token}",
    "POST /api/v1/coding/session/{secure_token}/submit",
    "POST /api/v1/coding/session/{secure_token}/run",
    "POST /api/v1/coding/session/{secure_token}/modify-probe",
    "POST /api/v1/coding/session/{secure_token}/flag",
    "POST /api/v1/coding/session/{secure_token}/autosave",
    "GET /api/v1/performance/public/{secure_token}",
    "POST /api/v1/performance/public/{secure_token}/submit",
    "PATCH /api/v1/performance/public/{secure_token}/goals/{goal_id}",
    "GET /api/v1/sso/google/login",
    "GET /api/v1/sso/google/callback",
    "GET /api/v1/sso/oidc/config",
    "GET /api/v1/sso/oidc/login",
    "GET /api/v1/sso/oidc/callback",
    "GET /api/v1/cron/daily",
    "GET /api/v1/cron/reminders",
    "GET /api/v1/cron/external-reminders",
    "GET /api/v1/cron/job-sync",
    "GET /api/v1/cron/retention",
    "POST /api/v1/billing/webhook/stripe",
    "GET /api/v1/careers/jobs",
    "GET /api/v1/careers/filters",
    "GET /api/v1/careers/jobs/{job_id}",
    "POST /api/v1/careers/jobs/{job_id}/apply",
    "GET /api/v1/site/plans",
    "POST /api/v1/site/contact",
}


def _label(info) -> str:
    return f"{sorted(info.methods)[0]} {info.path}"


async def test_every_unauthenticated_route_is_throttled_or_listed_with_a_reason():
    public = {_label(r): r for r in all_routes() if not r.authenticated}
    unguarded = [
        label for label, r in public.items()
        if not r.throttled and label not in OWN_LIMITER and label not in NO_CREDENTIAL
    ]
    assert not unguarded, "unauthenticated routes with no rate limit:\n" + "\n".join(sorted(unguarded))


async def test_platform_owner_routes_count_as_authenticated_not_public():
    platform = [r for r in all_routes() if r.path.startswith("/api/v1/platform")]
    assert platform, "no platform routes are mounted"
    for route in platform:
        assert route.platform_gated and route.authenticated, _label(route)
    assert not {_label(r) for r in platform} & {_label(r) for r in all_routes() if not r.authenticated}


async def test_the_inventory_matches_the_routes_that_exist():
    public = {_label(r) for r in all_routes() if not r.authenticated}
    declared = EXPECTED_THROTTLED | set(OWN_LIMITER) | set(NO_CREDENTIAL)
    assert public == declared, (
        f"in the app but not in this inventory: {sorted(public - declared)}; "
        f"in the inventory but not in the app: {sorted(declared - public)}"
    )
    throttled = {_label(r) for r in all_routes() if r.throttled}
    assert EXPECTED_THROTTLED <= throttled, sorted(EXPECTED_THROTTLED - throttled)


def _request(ip: str, **path_params):
    return SimpleNamespace(client=SimpleNamespace(host=ip), path_params=path_params)


@pytest.fixture
async def clean_limits():
    db = get_db()
    await db.rate_limits.delete_many({"_id": {"$regex": "^public:"}})
    yield db
    await db.rate_limits.delete_many({"_id": {"$regex": "^public:"}})


async def test_the_token_limit_trips_per_token_and_leaves_other_tokens_alone(clean_limits):
    scope = f"unit-{uuid.uuid4().hex[:6]}"
    throttle = public_token_throttle(scope, ip_limit=50, token_limit=3, window_seconds=3600)
    ip = f"10.9.{uuid.uuid4().int % 250}.{uuid.uuid4().int % 250}"
    for _ in range(3):
        await throttle(_request(ip, secure_token="tok_one"))
    with pytest.raises(HTTPException) as exc:
        await throttle(_request(ip, secure_token="tok_one"))
    assert exc.value.status_code == 429
    await throttle(_request(ip, secure_token="tok_two"))


async def test_the_ip_limit_trips_across_tokens(clean_limits):
    scope = f"unit-{uuid.uuid4().hex[:6]}"
    throttle = public_token_throttle(scope, ip_limit=4, token_limit=100, window_seconds=3600)
    ip = f"10.8.{uuid.uuid4().int % 250}.{uuid.uuid4().int % 250}"
    for n in range(4):
        await throttle(_request(ip, secure_token=f"tok_{n}"))
    with pytest.raises(HTTPException) as exc:
        await throttle(_request(ip, secure_token="tok_fresh"))
    assert exc.value.status_code == 429
    await throttle(_request("10.8.0.1", secure_token="tok_fresh"))


async def test_a_route_with_no_token_gets_the_ip_limit_only(clean_limits):
    scope = f"unit-{uuid.uuid4().hex[:6]}"
    throttle = public_token_throttle(scope, ip_limit=2, param=None)
    ip = f"10.7.{uuid.uuid4().int % 250}.{uuid.uuid4().int % 250}"
    await throttle(_request(ip))
    await throttle(_request(ip))
    with pytest.raises(HTTPException):
        await throttle(_request(ip))


async def test_the_raw_token_never_reaches_the_rate_limit_collection(clean_limits):
    scope = f"unit-{uuid.uuid4().hex[:6]}"
    throttle = public_token_throttle(scope, ip_limit=10, token_limit=10)
    secret = f"tok_{uuid.uuid4().hex}"
    await throttle(_request("10.6.0.1", secure_token=secret))
    ids = [d["_id"] async for d in get_db().rate_limits.find({"_id": {"$regex": f"^public:{scope}:"}}, {"_id": 1})]
    assert ids and all(secret not in i and secret[4:20] not in i for i in ids)


async def test_client_ip_falls_back_when_there_is_no_client():
    assert client_ip(SimpleNamespace(client=None)) == "unknown"
    assert client_ip(SimpleNamespace(client=SimpleNamespace(host="1.2.3.4"))) == "1.2.3.4"


async def test_hammering_one_offer_link_ends_in_a_429_without_blocking_other_links(client, clean_limits):
    token = f"tok_{uuid.uuid4().hex}"
    statuses = []
    for _ in range(45):
        statuses.append((await client.get(f"{API}/offers/public/{token}")).status_code)
    assert statuses[0] == 404
    assert 429 in statuses, statuses
    assert statuses.count(404) <= 40
    other = await client.get(f"{API}/offers/public/tok_{uuid.uuid4().hex}")
    assert other.status_code == 404, "a different link must not share the first link's budget"
    ids = [d["_id"] async for d in get_db().rate_limits.find({"_id": {"$regex": "^public:offer:"}}, {"_id": 1})]
    assert ids and all(token not in i for i in ids)
