import re

import pytest

from services.hr_module.email_service import _html_context
from services.hr_module.email_template_samples import PREVIEW_VALUES, SAMPLES
from services.hr_module.email_template_service import TEMPLATE_KEYS, _shape_template, render

FORBIDDEN = re.compile(r"\b(scores?|scored|scoring|recommend\w*|evaluat\w*|report|ranking|rated|rating)\b", re.I)
TOKEN = re.compile(r"\{\{\s*([a-z_]+)\s*\}\}")
URL_KEYS = {"interview_url", "assessment_url", "accept_url", "join_url"}


def test_every_email_has_a_sample_and_nothing_else_does():
    assert set(SAMPLES) == set(TEMPLATE_KEYS)
    for key, sample in SAMPLES.items():
        assert set(sample) == {"subject", "html", "text"}, key
        assert all(sample[part].strip() for part in sample), key


@pytest.mark.parametrize("key", sorted(TEMPLATE_KEYS))
def test_a_sample_uses_only_the_placeholders_its_email_supports(key):
    allowed = set(TEMPLATE_KEYS[key]["placeholders"])
    for part, text in SAMPLES[key].items():
        used = set(TOKEN.findall(text))
        assert used <= allowed, f"{key}.{part} uses {sorted(used - allowed)}"
    assert "email_from_name" in TOKEN.findall(SAMPLES[key]["html"]), f"{key} is signed with the sender's name"


@pytest.mark.parametrize("key", sorted(TEMPLATE_KEYS))
def test_a_sample_fills_in_completely_from_the_preview_values(key):
    values = {p: PREVIEW_VALUES[p] for p in TEMPLATE_KEYS[key]["placeholders"]}
    for part, text in SAMPLES[key].items():
        rendered = render(text, values)
        assert "{{" not in rendered and "}}" not in rendered, f"{key}.{part} has an unfilled placeholder"
    link = next((k for k in TEMPLATE_KEYS[key]["placeholders"] if k in URL_KEYS), None)
    if link:
        assert f'href="{{{{{link}}}}}"' in SAMPLES[key]["html"]
        assert f"{{{{{link}}}}}" in SAMPLES[key]["text"]


@pytest.mark.parametrize("key", sorted(TEMPLATE_KEYS))
def test_a_sample_never_mentions_scores_evaluations_or_reports(key):
    for part, text in SAMPLES[key].items():
        stripped = re.sub(r"<[^>]+>", " ", text)
        found = FORBIDDEN.findall(stripped)
        assert not found, f"{key}.{part} talks about review content: {found}"


@pytest.mark.parametrize("key", sorted(TEMPLATE_KEYS))
def test_a_sample_has_no_em_dash(key):
    for part, text in SAMPLES[key].items():
        assert chr(0x2014) not in text, f"{key}.{part}"


def test_the_sender_escapes_what_it_fills_in_and_checks_the_links():
    html = SAMPLES["send_invite_email"]["html"]
    ctx = {
        "candidate_name": '<script>alert(1)</script>', "job_title": "Dev", "email_from_name": "Acme",
        "interview_url": "javascript:alert(1)", "interview_duration_minutes": 20, "invite_expiry_days": 7,
    }
    out = render(html, _html_context(ctx, ("interview_url",)))
    assert "<script>" not in out and "&lt;script&gt;" in out
    assert "javascript:" not in out and 'href=""' in out


def test_a_template_is_described_with_its_sample_and_preview_values():
    for key, meta in TEMPLATE_KEYS.items():
        shaped = _shape_template(key, meta, None)
        assert shaped["is_customized"] is False and shaped["subject_template"] is None
        assert shaped["sample_subject_template"] == SAMPLES[key]["subject"]
        assert shaped["sample_html_body_template"] == SAMPLES[key]["html"]
        assert shaped["sample_text_body_template"] == SAMPLES[key]["text"]
        assert set(shaped["preview_values"]) == set(meta["placeholders"])


def test_a_customized_template_still_reports_its_own_text_next_to_the_sample():
    meta = TEMPLATE_KEYS["send_invite_email"]
    shaped = _shape_template("send_invite_email", meta, {"subject_template": "Mine", "html_body_template": "<p>Mine</p>"})
    assert shaped["is_customized"] is True and shaped["subject_template"] == "Mine"
    assert shaped["sample_subject_template"] == SAMPLES["send_invite_email"]["subject"]
