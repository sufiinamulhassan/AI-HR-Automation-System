from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import logging
import secrets
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from urllib.parse import quote, urlencode, urlsplit

import httpx
from jose import jwt

from config.settings import settings
from services.hr_module import plan_service
from shared import safe_http
from shared import secrets as secret_store
from shared.safe_http import UnsafeTarget, safe_request

logger = logging.getLogger(__name__)

_transport: httpx.AsyncBaseTransport | None = None

ALLOWED_ALGS = ("RS256", "ES256")
DEFAULT_SCOPES = "openid email profile"
CONFIG_DOC_ID = "sso"

STATE_MAX_AGE_SECONDS = 600
CLOCK_SKEW_SECONDS = 120
TOKEN_MAX_AGE_SECONDS = 900
REQUEST_TIMEOUT = 8.0

FAILED_MESSAGE = "We could not complete single sign-on. Try again or contact your administrator."
UNAVAILABLE_MESSAGE = "Single sign-on is not available for this company."
ACCOUNT_REFUSED_MESSAGE = (
    "This email address cannot sign in with single sign-on. Ask your administrator to create your account."
)
DEACTIVATED_MESSAGE = "This account is deactivated. Ask your administrator."
ENFORCED_MESSAGE = "Your company requires single sign-on."


class SsoError(Exception):
    pass


def default_config() -> dict:
    return {
        "enabled": False, "issuer": "", "client_id": "", "client_secret": "",
        "scopes": DEFAULT_SCOPES, "enforce": False,
    }


async def get_config(db) -> dict:
    doc = await db.company_settings.find_one({"_id": CONFIG_DOC_ID}) or {}
    cfg = default_config()
    for key in cfg:
        if key in doc and doc[key] is not None:
            cfg[key] = doc[key]
    return cfg


async def save_config(db, cfg: dict, *, updated_by: str | None) -> None:
    fields = {k: cfg[k] for k in default_config()}
    fields["updated_at"] = datetime.now(timezone.utc).isoformat()
    fields["updated_by"] = updated_by
    await db.company_settings.update_one({"_id": CONFIG_DOC_ID}, {"$set": fields}, upsert=True)


def redirect_uri() -> str:
    return f"{settings.FRONTEND_URL.rstrip('/')}/api/v1/sso/oidc/callback"


def is_complete(cfg: dict | None) -> bool:
    cfg = cfg or {}
    return bool(cfg.get("issuer") and cfg.get("client_id") and cfg.get("client_secret"))


def is_available(cfg: dict | None, company: dict | None) -> bool:
    return bool(
        cfg and cfg.get("enabled") and is_complete(cfg)
        and plan_service.feature_enabled("oidc_sso", company)
    )


def public_view(cfg: dict, company: dict | None = None) -> dict:
    return {
        "enabled": bool(cfg.get("enabled")),
        "issuer": cfg.get("issuer") or "",
        "client_id": cfg.get("client_id") or "",
        "has_client_secret": bool(cfg.get("client_secret")),
        "scopes": cfg.get("scopes") or DEFAULT_SCOPES,
        "enforce": bool(cfg.get("enforce")),
        "redirect_uri": redirect_uri(),
        "sso_domains": sorted(str(d) for d in ((company or {}).get("sso_domains") or [])),
    }


def clean_issuer(value) -> str:
    text = str(value or "").strip()
    parts = urlsplit(text)
    if (
        parts.scheme != "https" or not parts.hostname or parts.username or parts.password
        or parts.query or parts.fragment or len(text) > 300
    ):
        raise ValueError("The issuer must be an https:// address with no query or fragment.")
    return text


def clean_scopes(value) -> str:
    items = value if isinstance(value, (list, tuple)) else str(value or "").replace(",", " ").split()
    scopes: list[str] = []
    for item in items:
        scope = str(item).strip()
        if not scope:
            continue
        if len(scope) > 100 or not all(c.isalnum() or c in "._:/-" for c in scope):
            raise ValueError("A scope contains characters that are not allowed.")
        if scope not in scopes:
            scopes.append(scope)
    if len(scopes) > 20 or "openid" not in scopes or "email" not in scopes:
        raise ValueError("Scopes must include openid and email.")
    return " ".join(scopes)


def apply_changes(current: dict, changes: dict) -> dict:
    cfg = {**default_config(), **current}
    stored_secret = cfg.get("client_secret") or ""
    issuer_before, client_before = cfg["issuer"], cfg["client_id"]

    if "issuer" in changes and changes["issuer"] is not None:
        cfg["issuer"] = clean_issuer(changes["issuer"]) if str(changes["issuer"]).strip() else ""
    if "client_id" in changes and changes["client_id"] is not None:
        client_id = str(changes["client_id"]).strip()
        if len(client_id) > 256 or any(c.isspace() for c in client_id):
            raise ValueError("The client ID is not valid.")
        cfg["client_id"] = client_id
    if "scopes" in changes and changes["scopes"] is not None:
        cfg["scopes"] = clean_scopes(changes["scopes"])
    for flag in ("enabled", "enforce"):
        if flag in changes and changes[flag] is not None:
            cfg[flag] = bool(changes[flag])

    new_secret = str(changes.get("client_secret") or "")
    if new_secret:
        if len(new_secret) > 1024:
            raise ValueError("The client secret is too long.")
        cfg["client_secret"] = secret_store.encrypt(new_secret)
    elif stored_secret and (cfg["issuer"] != issuer_before or cfg["client_id"] != client_before):
        raise ValueError("Enter the client secret again when you change the issuer or the client ID.")

    if cfg["enabled"] and not is_complete(cfg):
        raise ValueError("Enter the issuer, client ID and client secret before turning single sign-on on.")
    if cfg["enforce"] and not cfg["enabled"]:
        raise ValueError("Turn single sign-on on before requiring it.")
    return cfg


def enforcement_applies(cfg: dict | None, user: dict, company: dict | None) -> bool:
    if not is_available(cfg, company) or not (cfg or {}).get("enforce"):
        return False
    return not (user.get("role") == "superadmin" or user.get("is_platform_admin"))


def domain_allowed(company: dict | None, email: str) -> bool:
    domain = (email or "").rpartition("@")[2].strip().lower()
    claimed = {str(d).strip().lower() for d in ((company or {}).get("sso_domains") or [])}
    return bool(domain) and domain in claimed


def _https_url(value) -> str:
    text = value if isinstance(value, str) else ""
    parts = urlsplit(text)
    if parts.scheme != "https" or not parts.hostname or parts.username or parts.password or len(text) > 2000:
        raise SsoError("The provider's discovery document lists an address that is not a plain https:// address.")
    return text


async def _request(method: str, url: str, what: str, **kwargs):
    try:
        response = await safe_request(
            method, url, transport=_transport, timeout=REQUEST_TIMEOUT, max_bytes=512_000, **kwargs,
        )
    except UnsafeTarget as exc:
        raise SsoError(f"{what} could not be used. {exc}")
    except (httpx.HTTPError, asyncio.TimeoutError, TimeoutError, OSError):
        raise SsoError(f"{what} could not be reached.")
    return response


def _json_object(response, what: str) -> dict:
    try:
        data = response.json()
    except ValueError:
        raise SsoError(f"{what} did not return JSON.")
    if not isinstance(data, dict):
        raise SsoError(f"{what} did not return a JSON object.")
    return data


async def discover(issuer: str) -> dict:
    try:
        issuer = clean_issuer(issuer)
    except ValueError as exc:
        raise SsoError(str(exc))
    what = "The provider's discovery document"
    url = issuer.rstrip("/") + "/.well-known/openid-configuration"
    response = await _request("GET", url, what, headers={"Accept": "application/json"})
    if response.status_code != 200:
        raise SsoError(f"{what} answered with status {response.status_code}.")
    doc = _json_object(response, what)

    advertised = doc.get("issuer")
    if not isinstance(advertised, str) or advertised.rstrip("/") != issuer.rstrip("/"):
        raise SsoError("The issuer in the provider's discovery document does not match the one entered.")
    meta = {"issuer": advertised}
    for key in ("authorization_endpoint", "token_endpoint", "jwks_uri"):
        meta[key] = _https_url(doc.get(key))
    algs = doc.get("id_token_signing_alg_values_supported")
    if isinstance(algs, list) and not set(algs) & set(ALLOWED_ALGS):
        raise SsoError("The provider does not sign ID tokens with RS256 or ES256.")
    challenges = doc.get("code_challenge_methods_supported")
    if isinstance(challenges, list) and "S256" not in challenges:
        raise SsoError("The provider does not support PKCE with S256.")
    methods = doc.get("token_endpoint_auth_methods_supported")
    meta["auth_method"] = "post" if isinstance(methods, list) and "client_secret_basic" not in methods and "client_secret_post" in methods else "basic"
    return meta


async def fetch_jwks(jwks_uri: str) -> dict:
    what = "The provider's signing keys"
    response = await _request("GET", _https_url(jwks_uri), what, headers={"Accept": "application/json"})
    if response.status_code != 200:
        raise SsoError(f"{what} answered with status {response.status_code}.")
    jwks = _json_object(response, what)
    if not isinstance(jwks.get("keys"), list):
        raise SsoError(f"{what} are not a key set.")
    return jwks


async def check_provider(issuer: str) -> tuple[bool, str]:
    try:
        meta = await discover(issuer)
        token_url = urlsplit(meta["token_endpoint"])
        try:
            await safe_http.resolve_public(token_url.hostname or "", token_url.port or 443)
        except UnsafeTarget:
            raise SsoError("The provider's token endpoint is not on a public address.")
        jwks = await fetch_jwks(meta["jwks_uri"])
        usable = [
            k for k in jwks["keys"]
            if isinstance(k, dict) and k.get("kty") in ("RSA", "EC") and k.get("use", "sig") == "sig"
        ]
        if not usable:
            raise SsoError("The provider published no signing keys that can be used.")
    except SsoError as exc:
        return False, str(exc)
    except Exception as exc:
        logger.warning("SSO connection test failed unexpectedly: %s", type(exc).__name__)
        return False, "The provider could not be checked."
    return True, "The provider answered and its sign-in endpoints and signing keys look right."


def pkce_challenge(verifier: str) -> str:
    return base64.urlsafe_b64encode(hashlib.sha256(verifier.encode("ascii")).digest()).rstrip(b"=").decode("ascii")


def new_pkce() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(48)
    return verifier, pkce_challenge(verifier)


def _hash_binding(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


@dataclass
class LoginStart:
    url: str
    state_doc: dict
    binding: str


def begin_login(company_id: str, cfg: dict, meta: dict) -> LoginStart:
    state, nonce, binding = secrets.token_urlsafe(32), secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    verifier, challenge = new_pkce()
    params = {
        "response_type": "code", "client_id": cfg["client_id"], "redirect_uri": redirect_uri(),
        "scope": cfg.get("scopes") or DEFAULT_SCOPES, "state": state, "nonce": nonce,
        "code_challenge": challenge, "code_challenge_method": "S256",
    }
    endpoint = meta["authorization_endpoint"]
    url = f"{endpoint}{'&' if '?' in endpoint else '?'}{urlencode(params)}"
    doc = {
        "state": state, "kind": "oidc", "nonce": nonce, "code_verifier": verifier,
        "company_id": company_id, "client_id": cfg["client_id"], "config_issuer": cfg["issuer"],
        "issuer": meta["issuer"], "token_endpoint": meta["token_endpoint"], "jwks_uri": meta["jwks_uri"],
        "auth_method": meta.get("auth_method") or "basic", "binding_hash": _hash_binding(binding),
        "created_at": datetime.now(timezone.utc),
    }
    return LoginStart(url=url, state_doc=doc, binding=binding)


def state_is_fresh(doc: dict | None, now: datetime | None = None) -> bool:
    created = (doc or {}).get("created_at")
    if not isinstance(created, datetime):
        return False
    created = created if created.tzinfo else created.replace(tzinfo=timezone.utc)
    age = ((now or datetime.now(timezone.utc)) - created).total_seconds()
    return 0 <= age <= STATE_MAX_AGE_SECONDS


def binding_matches(doc: dict, binding: str | None) -> bool:
    if not binding or not doc.get("binding_hash"):
        return False
    return hmac.compare_digest(_hash_binding(binding).encode("ascii"), str(doc["binding_hash"]).encode("ascii"))


async def exchange_code(state_doc: dict, *, client_id: str, client_secret: str, code: str) -> dict:
    data = {
        "grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri(),
        "code_verifier": state_doc["code_verifier"],
    }
    headers = {"Accept": "application/json"}
    if state_doc.get("auth_method") == "post":
        data["client_id"], data["client_secret"] = client_id, client_secret
    else:
        pair = f"{quote(client_id, safe='')}:{quote(client_secret, safe='')}"
        headers["Authorization"] = "Basic " + base64.b64encode(pair.encode("utf-8")).decode("ascii")
    what = "The provider's token endpoint"
    response = await _request("POST", _https_url(state_doc["token_endpoint"]), what, headers=headers, data=data)
    body = _json_object(response, what) if response.content else {}
    if response.status_code != 200:
        raise SsoError(f"{what} refused the code ({str(body.get('error') or response.status_code)[:60]}).")
    if not isinstance(body.get("id_token"), str) or not body["id_token"]:
        raise SsoError(f"{what} did not return an ID token.")
    return body


def _select_key(jwks: dict, alg: str, kid) -> dict:
    kty = "RSA" if alg == "RS256" else "EC"
    keys = [
        k for k in jwks.get("keys", [])
        if isinstance(k, dict) and k.get("kty") == kty and k.get("use", "sig") == "sig" and k.get("alg", alg) == alg
        and (alg != "ES256" or k.get("crv") == "P-256")
    ]
    if kid is not None:
        keys = [k for k in keys if k.get("kid") == kid]
    if len(keys) != 1:
        raise SsoError("The ID token was not signed with a key the provider has published.")
    return keys[0]


def validate_id_token(id_token: str, jwks: dict, *, issuer: str, client_id: str, nonce: str) -> dict:
    try:
        header = jwt.get_unverified_header(id_token)
    except Exception:
        raise SsoError("The ID token is malformed.")
    alg = header.get("alg")
    if alg not in ALLOWED_ALGS:
        raise SsoError("The ID token uses a signing algorithm that is not allowed.")
    key = _select_key(jwks, alg, header.get("kid"))
    try:
        claims = jwt.decode(
            id_token, key, algorithms=[alg], audience=client_id, issuer=issuer,
            options={
                "verify_at_hash": False, "require_exp": True, "require_iat": True,
                "require_aud": True, "require_iss": True, "require_sub": True,
                "leeway": CLOCK_SKEW_SECONDS,
            },
        )
    except Exception as exc:
        raise SsoError(f"The ID token did not pass verification ({type(exc).__name__}).")

    audience = claims.get("aud")
    authorized_party = claims.get("azp")
    if (isinstance(audience, list) and len(audience) > 1 and authorized_party != client_id) or (
        authorized_party is not None and authorized_party != client_id
    ):
        raise SsoError("The ID token was issued to a different client.")
    issued = claims.get("iat")
    if isinstance(issued, bool) or not isinstance(issued, (int, float)):
        raise SsoError("The ID token has no valid issue time.")
    now = time.time()
    if issued > now + CLOCK_SKEW_SECONDS or now - issued > TOKEN_MAX_AGE_SECONDS:
        raise SsoError("The ID token was not issued just now.")
    claim_nonce = claims.get("nonce")
    if not isinstance(claim_nonce, str) or not hmac.compare_digest(claim_nonce.encode("utf-8"), nonce.encode("utf-8")):
        raise SsoError("The ID token does not belong to this sign-in.")
    if claims.get("email_verified") is not True:
        raise SsoError("The provider has not verified this email address.")
    email = claims.get("email")
    if not isinstance(email, str) or "@" not in email or not claims.get("sub"):
        raise SsoError("The ID token has no email address.")
    return {**claims, "email": email.strip().lower()}


async def complete_login(state_doc: dict, cfg: dict, code: str) -> dict:
    secret = secret_store.decrypt(cfg.get("client_secret"))
    if not secret:
        raise SsoError("The client secret is missing or can no longer be read.")
    tokens = await exchange_code(state_doc, client_id=cfg["client_id"], client_secret=secret, code=code)
    jwks = await fetch_jwks(state_doc["jwks_uri"])
    return validate_id_token(
        tokens["id_token"], jwks, issuer=state_doc["issuer"], client_id=cfg["client_id"], nonce=state_doc["nonce"],
    )
