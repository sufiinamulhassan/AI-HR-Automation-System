import pytest

from config.settings import settings
from shared import secrets


@pytest.fixture(autouse=True)
def keys(monkeypatch):
    monkeypatch.setattr(settings, "SECRETS_ENCRYPTION_KEY", "first-key")
    monkeypatch.setattr(settings, "SECRETS_ENCRYPTION_KEY_PREVIOUS", "")
    monkeypatch.setattr(settings, "SECRET_KEY", "jwt-secret-for-tests-" + "x" * 20)


def test_a_secret_round_trips_and_is_not_stored_in_the_clear():
    stored = secrets.encrypt("smtp-password-123")
    assert stored.startswith(secrets.PREFIX) and "smtp-password-123" not in stored
    assert secrets.decrypt(stored) == "smtp-password-123"
    assert secrets.encrypt("smtp-password-123") != stored


def test_empty_and_foreign_values_are_not_secrets():
    assert secrets.encrypt("") == "" and secrets.decrypt("") is None and secrets.decrypt(None) is None
    assert secrets.decrypt("plain text") is None


def test_a_tampered_or_wrongly_keyed_value_reads_as_not_set(monkeypatch):
    stored = secrets.encrypt("value")
    assert secrets.decrypt(stored[:-3] + "AAA") is None
    monkeypatch.setattr(settings, "SECRETS_ENCRYPTION_KEY", "some-other-key")
    assert secrets.decrypt(stored) is None


def test_rotation_reads_old_values_and_writes_with_the_new_key(monkeypatch):
    old = secrets.encrypt("rotating")
    monkeypatch.setattr(settings, "SECRETS_ENCRYPTION_KEY", "second-key")
    assert secrets.decrypt(old) is None
    monkeypatch.setattr(settings, "SECRETS_ENCRYPTION_KEY_PREVIOUS", "first-key")
    assert secrets.decrypt(old) == "rotating"
    fresh = secrets.encrypt("rotating")
    monkeypatch.setattr(settings, "SECRETS_ENCRYPTION_KEY_PREVIOUS", "")
    assert secrets.decrypt(fresh) == "rotating"


def test_with_no_dedicated_key_one_is_derived_from_the_jwt_secret(monkeypatch):
    monkeypatch.setattr(settings, "SECRETS_ENCRYPTION_KEY", "")
    stored = secrets.encrypt("derived")
    assert secrets.decrypt(stored) == "derived"
    monkeypatch.setattr(settings, "SECRET_KEY", "a-different-jwt-secret-" + "y" * 20)
    assert secrets.decrypt(stored) is None


def test_a_real_fernet_key_is_used_as_it_is():
    from cryptography.fernet import Fernet

    key = Fernet.generate_key().decode()
    assert secrets._fernet_key(key) == key.encode()


def test_masks_never_reveal_an_encrypted_value():
    assert secrets.mask(secrets.encrypt("topsecret")) == "********"
    assert secrets.mask("") == "" and secrets.mask(None) == ""
    assert secrets.mask("short") == "********"
    assert secrets.mask("abcdefghijklmnop").endswith("mnop")
