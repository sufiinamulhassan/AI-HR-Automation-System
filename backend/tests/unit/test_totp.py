import base64
import re
from urllib.parse import parse_qs, urlsplit

import pytest

from services.hr_module import totp_service as totp

RFC_SECRET = base64.b32encode(b"12345678901234567890").decode()
RFC_VECTORS = [
    (59, "94287082"),
    (1111111109, "07081804"),
    (1111111111, "14050471"),
    (1234567890, "89005924"),
    (2000000000, "69279037"),
    (20000000000, "65353130"),
]


@pytest.mark.parametrize("timestamp,expected", RFC_VECTORS)
def test_the_published_eight_digit_vectors(timestamp, expected):
    assert totp.totp_at(RFC_SECRET, timestamp, digits=8) == expected


@pytest.mark.parametrize("timestamp,expected", RFC_VECTORS)
def test_six_digit_codes_are_the_last_six_digits_of_the_published_ones(timestamp, expected):
    assert totp.totp_at(RFC_SECRET, timestamp) == expected[-6:]
    assert totp.totp_at(RFC_SECRET, 59) == "287082"


def test_hotp_matches_the_rfc_4226_vectors():
    key = b"12345678901234567890"
    expected = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"]
    assert [totp.hotp(key, counter) for counter in range(10)] == expected


def test_a_new_secret_is_twenty_random_bytes_in_base32():
    secret = totp.new_secret()
    assert re.fullmatch(r"[A-Z2-7]{32}", secret)
    assert len(base64.b32decode(secret)) == 20
    assert totp.new_secret() != secret


def test_the_secret_may_be_typed_in_lower_case_with_spaces():
    spaced = " ".join(RFC_SECRET[i:i + 4] for i in range(0, len(RFC_SECRET), 4)).lower()
    assert totp.totp_at(spaced, 59) == "287082"


def test_the_previous_current_and_next_step_are_accepted_and_no_other():
    now = 1_700_000_000
    step = totp.step_for(now)
    for offset, accepted in ((-2, False), (-1, True), (0, True), (1, True), (2, False)):
        code = totp.hotp(base64.b32decode(RFC_SECRET), step + offset)
        got = totp.match_step(RFC_SECRET, code, now=now)
        assert got == (step + offset if accepted else None), offset


def test_a_step_is_never_accepted_twice():
    now = 1_700_000_000
    step = totp.step_for(now)
    code = totp.totp_at(RFC_SECRET, now)
    first = totp.match_step(RFC_SECRET, code, now=now)
    assert first == step
    assert totp.match_step(RFC_SECRET, code, now=now, last_step=first) is None
    older = totp.hotp(base64.b32decode(RFC_SECRET), step - 1)
    assert totp.match_step(RFC_SECRET, older, now=now, last_step=first) is None
    later = totp.hotp(base64.b32decode(RFC_SECRET), step + 1)
    assert totp.match_step(RFC_SECRET, later, now=now, last_step=first) == step + 1


@pytest.mark.parametrize("bad", [None, "", "12345", "1234567", "abcdef", "12 34", "12345١", "١٢٣٤٥٦"])
def test_malformed_codes_never_match(bad):
    assert totp.normalize_code(bad) is None
    assert totp.match_step(RFC_SECRET, bad, now=59) is None


def test_spaces_in_a_code_are_ignored():
    assert totp.normalize_code("287 082") == "287082"
    assert totp.match_step(RFC_SECRET, "287 082", now=59) == 1


def test_a_wrong_code_does_not_match():
    assert totp.match_step(RFC_SECRET, "000000", now=59) is None
    assert totp.match_step("not base32 !!", "287082", now=59) is None


def test_the_provisioning_uri_is_what_an_authenticator_app_reads():
    uri = totp.provisioning_uri(RFC_SECRET, "ann@example.com", "Hirely.ai")
    parts = urlsplit(uri)
    assert parts.scheme == "otpauth" and parts.netloc == "totp"
    assert parts.path == "/Hirely.ai:ann%40example.com"
    query = parse_qs(parts.query)
    assert query == {
        "secret": [RFC_SECRET], "issuer": ["Hirely.ai"], "algorithm": ["SHA1"], "digits": ["6"], "period": ["30"],
    }


def test_recovery_codes_are_eight_distinct_xxxxx_xxxxx_codes():
    codes = totp.generate_recovery_codes()
    assert len(codes) == 8 == len(set(codes))
    assert all(re.fullmatch(r"[a-z2-7]{5}-[a-z2-7]{5}", c) for c in codes)


def test_recovery_codes_are_stored_as_sha256_hashes():
    codes = totp.generate_recovery_codes()
    hashes = totp.hash_recovery_codes(codes)
    assert all(re.fullmatch(r"[0-9a-f]{64}", h) for h in hashes)
    assert not set(codes) & set(hashes)


def test_a_recovery_code_works_once():
    codes = totp.generate_recovery_codes()
    stored = totp.hash_recovery_codes(codes)
    remaining = totp.spend_recovery_code(stored, codes[3])
    assert remaining is not None and len(remaining) == 7
    assert totp.hash_recovery_code(codes[3]) not in remaining
    assert totp.spend_recovery_code(remaining, codes[3]) is None
    assert totp.spend_recovery_code(remaining, codes[0]) is not None


def test_a_recovery_code_may_be_typed_loosely():
    stored = totp.hash_recovery_codes(["abcde-fg234"])
    for typed in ("abcde-fg234", "ABCDE-FG234", "abcdefg234", " abcde - fg234 "):
        assert totp.spend_recovery_code(stored, typed) == [], typed


@pytest.mark.parametrize("bad", [None, "", "abcde", "abcde-fghi", "abcde-fg2349", "abcd0-fg234", "12345-67890"])
def test_something_that_is_not_a_recovery_code_matches_nothing(bad):
    stored = totp.hash_recovery_codes(["abcde-fg234"])
    assert totp.normalize_recovery_code(bad) is None
    assert totp.spend_recovery_code(stored, bad) is None


def test_the_hash_list_is_never_changed_in_place():
    stored = totp.hash_recovery_codes(["abcde-fg234", "hjkmn-pqrst"])
    snapshot = list(stored)
    totp.spend_recovery_code(stored, "abcde-fg234")
    assert stored == snapshot
