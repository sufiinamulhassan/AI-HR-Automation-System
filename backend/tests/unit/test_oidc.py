import base64
import json
import time
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from jose import jwt

from config.settings import settings
from services.hr_module import oidc_service as oidc
from services.hr_module.oidc_service import SsoError
from shared import safe_http, secrets as secret_store
from shared.safe_http import UnsafeTarget

pytestmark = pytest.mark.anyio

ISSUER = "https://idp.example.test/tenant1"
CLIENT_ID = "hrbot-client"
NONCE = "nonce-for-this-sign-in"


def _b64u(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _uint(n: int, length: int | None = None) -> str:
    return _b64u(n.to_bytes(length or (n.bit_length() + 7) // 8, "big"))


class KeyPair:
    def __init__(self, private, jwk: dict):
        self.private, self.jwk = private, jwk
        self.pem = private.private_bytes(
            serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption(),
        ).decode()


def make_rsa(kid: str) -> KeyPair:
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    numbers = private.public_key().public_numbers()
    return KeyPair(private, {"kty": "RSA", "kid": kid, "use": "sig", "alg": "RS256", "n": _uint(numbers.n), "e": _uint(numbers.e)})


def make_ec(kid: str) -> KeyPair:
    private = ec.generate_private_key(ec.SECP256R1())
    numbers = private.public_key().public_numbers()
    return KeyPair(private, {"kty": "EC", "crv": "P-256", "kid": kid, "use": "sig", "alg": "ES256", "x": _uint(numbers.x, 32), "y": _uint(numbers.y, 32)})


@pytest.fixture(scope="module")
def rsa_key():
    return make_rsa("rsa-1")


@pytest.fixture(scope="module")
def other_rsa_key():
    return make_rsa("rsa-1")


@pytest.fixture(scope="module")
def ec_key():
    return make_ec("ec-1")


def claims(**overrides) -> dict:
    now = int(time.time())
    base = {
        "iss": ISSUER, "aud": CLIENT_ID, "sub": "user-1", "email": "Ann@Example.com", "email_verified": True,
        "nonce": NONCE, "iat": now, "exp": now + 300, "name": "Ann Example",
    }
    base.update(overrides)
    return {k: v for k, v in base.items() if v is not None}


def sign(payload: dict, key: KeyPair, alg: str = "RS256", **headers) -> str:
    return jwt.encode(payload, key.pem, algorithm=alg, headers={"kid": key.jwk["kid"], **headers})


def check(token: str, *keys: KeyPair, **kwargs) -> dict:
    params = {"issuer": ISSUER, "client_id": CLIENT_ID, "nonce": NONCE}
    params.update(kwargs)
    return oidc.validate_id_token(token, {"keys": [k.jwk for k in keys]}, **params)


def refused(token: str, *keys: KeyPair, **kwargs) -> str:
    with pytest.raises(SsoError) as exc:
        check(token, *keys, **kwargs)
    return str(exc.value)


def test_a_good_rs256_token_is_accepted_and_the_email_is_lower_cased(rsa_key):
    verified = check(sign(claims(), rsa_key), rsa_key)
    assert verified["email"] == "ann@example.com" and verified["sub"] == "user-1"


def test_a_good_es256_token_is_accepted(ec_key):
    assert check(sign(claims(), ec_key, "ES256"), ec_key)["email"] == "ann@example.com"


def test_a_token_signed_by_a_different_key_is_refused(rsa_key, other_rsa_key):
    refused(sign(claims(), other_rsa_key), rsa_key)


def test_a_token_whose_payload_was_changed_is_refused(rsa_key):
    token = sign(claims(), rsa_key)
    header, _, signature = token.split(".")
    forged = _b64u(json.dumps(claims(email="boss@example.com")).encode())
    refused(f"{header}.{forged}.{signature}", rsa_key)


def test_alg_none_is_refused(rsa_key):
    header = _b64u(json.dumps({"alg": "none", "typ": "JWT", "kid": "rsa-1"}).encode())
    payload = _b64u(json.dumps(claims()).encode())
    assert "algorithm" in refused(f"{header}.{payload}.", rsa_key)


@pytest.mark.parametrize("alg", ["HS256", "HS384", "HS512"])
def test_an_hmac_token_signed_with_the_public_key_material_is_refused(rsa_key, alg):
    forged = jwt.encode(claims(), rsa_key.jwk["n"], algorithm=alg, headers={"kid": "rsa-1"})
    assert "algorithm" in refused(forged, rsa_key)


def test_an_algorithm_outside_rs256_and_es256_is_refused_even_when_validly_signed(rsa_key):
    assert "algorithm" in refused(sign(claims(), rsa_key, "RS512"), rsa_key)


def test_the_key_must_match_the_algorithm_the_token_names(rsa_key, ec_key):
    refused(sign(claims(), rsa_key), ec_key)
    refused(sign(claims(), ec_key, "ES256"), rsa_key)


def test_an_unknown_kid_is_refused(rsa_key):
    refused(jwt.encode(claims(), rsa_key.pem, algorithm="RS256", headers={"kid": "someone-elses"}), rsa_key)


def test_a_token_with_no_kid_needs_exactly_one_candidate_key(rsa_key, other_rsa_key):
    bare = jwt.encode(claims(), rsa_key.pem, algorithm="RS256")
    assert check(bare, rsa_key)["sub"] == "user-1"
    refused(bare, rsa_key, make_rsa("rsa-2"))


@pytest.mark.parametrize("override", [
    {"iss": "https://evil.example.test/tenant1"},
    {"iss": None},
    {"aud": "someone-elses-client"},
    {"aud": None},
    {"aud": ["a", "b"]},
    {"aud": [CLIENT_ID, "b"]},
    {"azp": "someone-elses-client"},
    {"exp": int(time.time()) - 600},
    {"exp": None},
    {"iat": int(time.time()) + 3600},
    {"iat": int(time.time()) - 86400},
    {"iat": None},
    {"iat": "now"},
    {"nonce": "a-different-sign-in"},
    {"nonce": None},
    {"email_verified": False},
    {"email_verified": "true"},
    {"email_verified": None},
    {"email": None},
    {"email": "not-an-address"},
    {"sub": None},
])
def test_each_claim_that_is_wrong_refuses_the_token(rsa_key, override):
    refused(sign(claims(**override), rsa_key), rsa_key)


def test_several_audiences_are_fine_when_the_authorized_party_is_this_client(rsa_key):
    assert check(sign(claims(aud=[CLIENT_ID, "other"], azp=CLIENT_ID), rsa_key), rsa_key)["sub"] == "user-1"


def test_a_little_clock_skew_is_tolerated(rsa_key):
    now = int(time.time())
    assert check(sign(claims(iat=now + 60, exp=now + 360), rsa_key), rsa_key)
    assert check(sign(claims(exp=now - 30), rsa_key), rsa_key)


def test_a_malformed_token_is_refused(rsa_key):
    for junk in ("", "abc", "a.b.c", "a.b"):
        refused(junk, rsa_key)


def test_the_message_for_an_administrator_names_no_secret(rsa_key):
    message = refused(sign(claims(nonce="other"), rsa_key), rsa_key)
    assert NONCE not in message and "other" not in message


def test_the_rfc_7636_example_challenge():
    assert oidc.pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk") == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"


def test_a_pkce_pair_is_fresh_and_in_range():
    verifier, challenge = oidc.new_pkce()
    assert 43 <= len(verifier) <= 128 and set(verifier) <= set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
    assert challenge == oidc.pkce_challenge(verifier) and "=" not in challenge
    assert oidc.new_pkce()[0] != verifier


META = {
    "issuer": ISSUER, "authorization_endpoint": "https://idp.example.test/tenant1/authorize",
    "token_endpoint": "https://idp.example.test/tenant1/token", "jwks_uri": "https://idp.example.test/tenant1/keys",
    "auth_method": "basic",
}


def config(**overrides) -> dict:
    cfg = {**oidc.default_config(), "enabled": True, "issuer": ISSUER, "client_id": CLIENT_ID,
           "client_secret": secret_store.encrypt("the-client-secret")}
    cfg.update(overrides)
    return cfg


def test_the_authorization_request_carries_pkce_state_and_nonce():
    start = oidc.begin_login("cmp_acme", config(), META)
    url = urlsplit(start.url)
    query = {k: v[0] for k, v in parse_qs(url.query).items()}
    assert f"{url.scheme}://{url.netloc}{url.path}" == META["authorization_endpoint"]
    assert query["response_type"] == "code" and query["client_id"] == CLIENT_ID
    assert query["redirect_uri"] == f"{settings.FRONTEND_URL.rstrip('/')}/api/v1/sso/oidc/callback"
    assert query["scope"] == "openid email profile" and query["code_challenge_method"] == "S256"
    doc = start.state_doc
    assert query["state"] == doc["state"] and query["nonce"] == doc["nonce"]
    assert query["code_challenge"] == oidc.pkce_challenge(doc["code_verifier"])
    assert query["state"] != query["nonce"] and len(query["state"]) >= 32 and len(query["nonce"]) >= 32


def test_the_state_document_has_a_real_date_the_company_and_only_a_hash_of_the_binding():
    from datetime import datetime

    start = oidc.begin_login("cmp_acme", config(), META)
    doc = start.state_doc
    assert isinstance(doc["created_at"], datetime)
    assert doc["company_id"] == "cmp_acme" and doc["kind"] == "oidc"
    assert doc["token_endpoint"] == META["token_endpoint"] and doc["jwks_uri"] == META["jwks_uri"]
    assert start.binding not in json.dumps(doc, default=str) and doc["binding_hash"] != start.binding


def test_every_sign_in_gets_its_own_state_nonce_verifier_and_binding():
    a, b = oidc.begin_login("cmp_acme", config(), META), oidc.begin_login("cmp_acme", config(), META)
    for key in ("state", "nonce", "code_verifier", "binding_hash"):
        assert a.state_doc[key] != b.state_doc[key], key


def test_a_state_older_than_ten_minutes_is_not_fresh():
    from datetime import datetime, timedelta, timezone

    doc = oidc.begin_login("cmp_acme", config(), META).state_doc
    now = datetime.now(timezone.utc)
    assert oidc.state_is_fresh(doc, now)
    assert oidc.state_is_fresh({**doc, "created_at": now - timedelta(minutes=9)}, now)
    assert not oidc.state_is_fresh({**doc, "created_at": now - timedelta(minutes=11)}, now)
    assert not oidc.state_is_fresh({**doc, "created_at": now + timedelta(minutes=5)}, now)
    assert not oidc.state_is_fresh({**doc, "created_at": "2026-01-01T00:00:00+00:00"}, now)
    assert not oidc.state_is_fresh(None, now)
    naive = (now - timedelta(minutes=1)).replace(tzinfo=None)
    assert oidc.state_is_fresh({**doc, "created_at": naive}, now)


def test_the_callback_must_come_from_the_browser_that_started_the_sign_in():
    start = oidc.begin_login("cmp_acme", config(), META)
    assert oidc.binding_matches(start.state_doc, start.binding)
    assert not oidc.binding_matches(start.state_doc, "another-browsers-cookie")
    assert not oidc.binding_matches(start.state_doc, None) and not oidc.binding_matches(start.state_doc, "")
    assert not oidc.binding_matches({k: v for k, v in start.state_doc.items() if k != "binding_hash"}, start.binding)


def test_a_saved_secret_is_encrypted_and_never_part_of_the_public_view():
    cfg = oidc.apply_changes(oidc.default_config(), {
        "enabled": True, "issuer": ISSUER, "client_id": CLIENT_ID, "client_secret": "s3cr3t-value",
    })
    assert cfg["client_secret"].startswith(secret_store.PREFIX) and "s3cr3t-value" not in cfg["client_secret"]
    assert secret_store.decrypt(cfg["client_secret"]) == "s3cr3t-value"
    view = oidc.public_view(cfg, {"sso_domains": ["b.com", "a.com"]})
    assert view["has_client_secret"] is True and "client_secret" not in view
    assert "s3cr3t-value" not in json.dumps(view) and cfg["client_secret"] not in json.dumps(view)
    assert view["sso_domains"] == ["a.com", "b.com"]
    assert view["redirect_uri"].endswith("/api/v1/sso/oidc/callback")
    assert oidc.public_view(oidc.default_config())["has_client_secret"] is False


def test_leaving_the_secret_out_keeps_the_stored_one():
    stored = config()
    for changes in ({"scopes": "openid email"}, {"client_secret": ""}, {"client_secret": None}, {"enforce": True}):
        updated = oidc.apply_changes(stored, changes)
        assert updated["client_secret"] == stored["client_secret"], changes


def test_changing_the_issuer_or_client_id_needs_the_secret_again():
    stored = config()
    for changes in ({"issuer": "https://other.example.test"}, {"client_id": "another-client"}):
        with pytest.raises(ValueError, match="client secret again"):
            oidc.apply_changes(stored, changes)
    moved = oidc.apply_changes(stored, {"issuer": "https://other.example.test", "client_secret": "new-secret"})
    assert secret_store.decrypt(moved["client_secret"]) == "new-secret"
    assert oidc.apply_changes(stored, {"issuer": ISSUER})["client_secret"] == stored["client_secret"]


@pytest.mark.parametrize("issuer", [
    "http://idp.example.test", "ftp://idp.example.test", "idp.example.test", "https://", "https://u:p@idp.example.test",
    "https://idp.example.test/?x=1", "https://idp.example.test/#frag", "https://" + "a" * 400 + ".test",
])
def test_the_issuer_must_be_a_plain_https_address(issuer):
    with pytest.raises(ValueError):
        oidc.apply_changes(oidc.default_config(), {"issuer": issuer})


def test_switching_on_needs_issuer_client_id_and_secret():
    with pytest.raises(ValueError, match="before turning single sign-on on"):
        oidc.apply_changes(oidc.default_config(), {"enabled": True, "issuer": ISSUER, "client_id": CLIENT_ID})
    with pytest.raises(ValueError, match="before turning single sign-on on"):
        oidc.apply_changes(config(client_id=""), {"enabled": True})


def test_requiring_single_sign_on_needs_it_switched_on():
    with pytest.raises(ValueError, match="Turn single sign-on on"):
        oidc.apply_changes(config(enabled=False), {"enforce": True})
    with pytest.raises(ValueError, match="Turn single sign-on on"):
        oidc.apply_changes(config(enabled=True, enforce=True), {"enabled": False})
    assert oidc.apply_changes(config(enabled=True), {"enforce": True})["enforce"] is True


def test_scopes_are_checked_and_may_be_text_or_a_list():
    assert oidc.apply_changes(config(), {"scopes": "openid, email groups"})["scopes"] == "openid email groups"
    assert oidc.apply_changes(config(), {"scopes": ["openid", "email", "profile", "email"]})["scopes"] == "openid email profile"
    for bad in ("email profile", "openid profile", "openid email bad;scope", [], ""):
        with pytest.raises(ValueError):
            oidc.apply_changes(config(), {"scopes": bad})


COMPANY = {"company_id": "cmp_acme", "sso_domains": ["acme.test"], "client_plan": {}}


def test_enforcement_applies_to_ordinary_users_only():
    enforced = config(enforce=True)
    assert oidc.enforcement_applies(enforced, {"role": "standard"}, COMPANY)
    assert oidc.enforcement_applies(enforced, {"role": "admin"}, COMPANY)
    assert oidc.enforcement_applies(enforced, {"role": "a-custom-role"}, COMPANY)
    assert not oidc.enforcement_applies(enforced, {"role": "superadmin"}, COMPANY)
    assert not oidc.enforcement_applies(enforced, {"role": "admin", "is_platform_admin": True}, COMPANY)


def test_enforcement_needs_a_switched_on_complete_configuration_on_the_plan():
    user = {"role": "standard"}
    assert not oidc.enforcement_applies(config(enforce=False), user, COMPANY)
    assert not oidc.enforcement_applies(config(enforce=True, enabled=False), user, COMPANY)
    assert not oidc.enforcement_applies(config(enforce=True, client_secret=""), user, COMPANY)
    assert not oidc.enforcement_applies(None, user, COMPANY)
    off_plan = {**COMPANY, "client_plan": {"features": {"oidc_sso": False}}}
    assert not oidc.enforcement_applies(config(enforce=True), user, off_plan)
    assert not oidc.is_available(config(), off_plan) and oidc.is_available(config(), COMPANY)


def test_first_time_people_are_only_created_for_a_domain_the_platform_assigned():
    assert oidc.domain_allowed(COMPANY, "new.person@acme.test")
    assert oidc.domain_allowed(COMPANY, "New.Person@ACME.TEST")
    assert not oidc.domain_allowed(COMPANY, "new.person@evil.test")
    assert not oidc.domain_allowed(COMPANY, "new.person@sub.acme.test")
    assert not oidc.domain_allowed({"sso_domains": []}, "a@acme.test") and not oidc.domain_allowed(None, "a@acme.test")
    assert not oidc.domain_allowed(COMPANY, "no-at-sign")


@pytest.fixture
def idp(monkeypatch, rsa_key):
    state = {
        "discovery": {**META, "id_token_signing_alg_values_supported": ["RS256"], "code_challenge_methods_supported": ["S256"],
                      "token_endpoint_auth_methods_supported": ["client_secret_basic"]},
        "keys": {"keys": [rsa_key.jwk]}, "token_status": 200, "token_body": None, "requests": [],
    }

    async def resolve(host, port):
        if host.startswith("internal"):
            raise UnsafeTarget("The address points to a private or reserved network.")
        return ["93.184.216.34"]

    def handler(request: httpx.Request) -> httpx.Response:
        state["requests"].append(request)
        path = request.url.path
        if path == "/tenant1/.well-known/openid-configuration":
            return httpx.Response(200, json=state["discovery"])
        if path == "/tenant1/keys":
            return httpx.Response(200, json=state["keys"])
        if path == "/tenant1/token":
            return httpx.Response(state["token_status"], json=state["token_body"] or {})
        return httpx.Response(404)

    monkeypatch.setattr(safe_http, "resolve_public", resolve)
    monkeypatch.setattr(oidc, "_transport", httpx.MockTransport(handler))
    return state


async def test_discovery_returns_the_endpoints_it_needs(idp):
    meta = await oidc.discover(ISSUER)
    assert meta == META
    assert [str(r.url) for r in idp["requests"]] == ["https://93.184.216.34/tenant1/.well-known/openid-configuration"]
    assert idp["requests"][0].headers["host"] == "idp.example.test"


async def test_a_trailing_slash_on_either_side_of_the_issuer_is_fine(idp):
    idp["discovery"] = {**idp["discovery"], "issuer": ISSUER + "/"}
    assert (await oidc.discover(ISSUER))["issuer"] == ISSUER + "/"


@pytest.mark.parametrize("change,fragment", [
    ({"issuer": "https://someone-else.example.test/tenant1"}, "does not match"),
    ({"token_endpoint": "http://idp.example.test/tenant1/token"}, "https://"),
    ({"jwks_uri": None}, "https://"),
    ({"authorization_endpoint": "https://u:p@idp.example.test/a"}, "https://"),
    ({"id_token_signing_alg_values_supported": ["HS256", "none"]}, "RS256 or ES256"),
    ({"code_challenge_methods_supported": ["plain"]}, "PKCE"),
])
async def test_a_discovery_document_that_is_wrong_or_unsafe_is_refused(idp, change, fragment):
    idp["discovery"] = {**idp["discovery"], **change}
    with pytest.raises(SsoError, match=fragment):
        await oidc.discover(ISSUER)


async def test_discovery_needs_an_https_issuer_and_a_json_answer(idp):
    with pytest.raises(SsoError, match="https"):
        await oidc.discover("http://idp.example.test/tenant1")
    idp["discovery"] = ["not", "an", "object"]
    with pytest.raises(SsoError, match="JSON object"):
        await oidc.discover(ISSUER)


async def test_discovery_never_reaches_a_private_address_and_does_not_name_it(idp):
    with pytest.raises(SsoError) as exc:
        await oidc.discover("https://internal.example.test/tenant1")
    assert "private or reserved" in str(exc.value) and "internal.example.test" not in str(exc.value)
    assert idp["requests"] == []


async def test_a_provider_that_times_out_or_errors_is_a_plain_failure(idp, monkeypatch):
    def slow(request):
        raise httpx.ConnectTimeout("too slow")

    monkeypatch.setattr(oidc, "_transport", httpx.MockTransport(slow))
    with pytest.raises(SsoError, match="could not be reached"):
        await oidc.discover(ISSUER)
    monkeypatch.setattr(oidc, "_transport", httpx.MockTransport(lambda request: httpx.Response(503)))
    with pytest.raises(SsoError, match="status 503"):
        await oidc.discover(ISSUER)
    with pytest.raises(SsoError, match="status 503"):
        await oidc.fetch_jwks(f"{ISSUER}/keys")


async def test_the_auth_method_follows_what_the_provider_supports(idp):
    idp["discovery"] = {**idp["discovery"], "token_endpoint_auth_methods_supported": ["client_secret_post"]}
    assert (await oidc.discover(ISSUER))["auth_method"] == "post"
    idp["discovery"] = {**idp["discovery"], "token_endpoint_auth_methods_supported": ["client_secret_basic", "client_secret_post"]}
    assert (await oidc.discover(ISSUER))["auth_method"] == "basic"


async def test_the_connection_test_says_ok_without_naming_hosts(idp):
    ok, detail = await oidc.check_provider(ISSUER)
    assert ok and "idp.example.test" not in detail


async def test_the_connection_test_reports_a_private_token_endpoint_without_naming_it(idp):
    idp["discovery"] = {**idp["discovery"], "token_endpoint": "https://internal.example.test/token"}
    ok, detail = await oidc.check_provider(ISSUER)
    assert not ok and "public address" in detail and "internal.example.test" not in detail


async def test_the_connection_test_reports_a_provider_with_no_usable_keys(idp):
    idp["keys"] = {"keys": [{"kty": "oct", "k": "abc"}]}
    ok, detail = await oidc.check_provider(ISSUER)
    assert not ok and "signing keys" in detail
    idp["keys"] = {"keys": "nope"}
    ok, detail = await oidc.check_provider(ISSUER)
    assert not ok


async def test_the_connection_test_reports_an_unreachable_provider(idp):
    ok, detail = await oidc.check_provider("https://internal.example.test/tenant1")
    assert not ok and "internal.example.test" not in detail


async def test_the_code_is_exchanged_with_pkce_and_basic_client_authentication(idp, rsa_key):
    start = oidc.begin_login("cmp_acme", config(), META)
    idp["token_body"] = {"id_token": "the.id.token", "access_token": "at", "token_type": "Bearer"}
    tokens = await oidc.exchange_code(start.state_doc, client_id="client id", client_secret="se/cret+", code="the-code")
    assert tokens["id_token"] == "the.id.token"
    request = idp["requests"][-1]
    form = {k: v[0] for k, v in parse_qs(request.content.decode()).items()}
    assert form == {
        "grant_type": "authorization_code", "code": "the-code", "redirect_uri": oidc.redirect_uri(),
        "code_verifier": start.state_doc["code_verifier"],
    }
    scheme, _, encoded = request.headers["authorization"].partition(" ")
    assert scheme == "Basic" and base64.b64decode(encoded).decode() == "client%20id:se%2Fcret%2B"
    assert request.headers["host"] == "idp.example.test"


async def test_a_provider_that_wants_the_secret_in_the_form_gets_it_there(idp):
    start = oidc.begin_login("cmp_acme", config(), {**META, "auth_method": "post"})
    idp["token_body"] = {"id_token": "the.id.token"}
    await oidc.exchange_code(start.state_doc, client_id=CLIENT_ID, client_secret="the-secret", code="c")
    request = idp["requests"][-1]
    form = {k: v[0] for k, v in parse_qs(request.content.decode()).items()}
    assert form["client_id"] == CLIENT_ID and form["client_secret"] == "the-secret" and "authorization" not in request.headers


async def test_a_refused_code_or_a_missing_id_token_fails(idp):
    start = oidc.begin_login("cmp_acme", config(), META)
    idp["token_status"], idp["token_body"] = 400, {"error": "invalid_grant"}
    with pytest.raises(SsoError, match="invalid_grant"):
        await oidc.exchange_code(start.state_doc, client_id=CLIENT_ID, client_secret="s", code="c")
    idp["token_status"], idp["token_body"] = 200, {"access_token": "only-this"}
    with pytest.raises(SsoError, match="ID token"):
        await oidc.exchange_code(start.state_doc, client_id=CLIENT_ID, client_secret="s", code="c")


async def test_a_whole_sign_in_end_to_end(idp, rsa_key):
    start = oidc.begin_login("cmp_acme", config(), META)
    doc = start.state_doc
    idp["token_body"] = {"id_token": sign(claims(nonce=doc["nonce"]), rsa_key), "access_token": "at"}
    verified = await oidc.complete_login(doc, config(), "the-code")
    assert verified["email"] == "ann@example.com"
    other = oidc.begin_login("cmp_acme", config(), META).state_doc
    with pytest.raises(SsoError, match="does not belong"):
        await oidc.complete_login(other, config(), "the-code")


async def test_a_secret_that_can_no_longer_be_read_fails_cleanly(idp):
    start = oidc.begin_login("cmp_acme", config(), META)
    with pytest.raises(SsoError, match="client secret"):
        await oidc.complete_login(start.state_doc, config(client_secret="enc:v1:garbage"), "c")
    assert idp["requests"] == []
