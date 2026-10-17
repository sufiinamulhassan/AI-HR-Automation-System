from config.settings import settings
from services.hr_module import security_policy_service as svc


def _values(doc: dict) -> dict:
    return {k: doc[k] for k in svc.POLICY_FIELDS}


def test_debug_keeps_the_permissive_defaults(monkeypatch):
    monkeypatch.setattr(settings, "DEBUG", True)
    assert _values(svc._default_doc()) == svc._DEFAULTS


def test_a_fresh_install_outside_debug_is_not_open(monkeypatch):
    monkeypatch.setattr(settings, "DEBUG", False)
    doc = svc._default_doc()
    assert doc["password_min_length"] >= 8
    assert doc["password_require_number"] is True
    assert doc["max_login_attempts_before_lockout"] > 0
    assert doc["account_lockout_duration_minutes"] > 0


def test_the_hardened_defaults_are_valid_policy_values():
    assert svc._validate_fields(dict(svc._HARDENED_DEFAULTS)) == svc._HARDENED_DEFAULTS
    assert set(svc._HARDENED_DEFAULTS) == set(svc._DEFAULTS)
