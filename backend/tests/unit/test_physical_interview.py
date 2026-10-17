import re
from datetime import datetime, timedelta, timezone

import pytest

from services.hr_module import calendar_ics, email_service
from services.hr_module import external_interview_service as ext
from services.hr_module.email_template_samples import PREVIEW_VALUES, SAMPLES
from services.hr_module.email_template_service import TEMPLATE_KEYS, render
from services.hr_module.scorecard_service import integrity_sentence

pytestmark = pytest.mark.anyio

START = (datetime.now(timezone.utc) + timedelta(days=2)).replace(microsecond=0).isoformat()
ADDRESS = "Hirely.ai Head Office, 228 Rose Commercial, Park View, Lahore"


def test_a_physical_interview_is_one_more_platform_labelled_in_person():
    assert "physical" in ext.PLATFORMS and ext.PHYSICAL == "physical"
    assert ext.platform_label("physical", None) == "In person"
    assert ext.platform_label("physical", "ignored") == "In person"


@pytest.mark.parametrize("typed, expected", [
    (ADDRESS, ADDRESS),
    ("  12  High Street,\n  Lahore \t 54000  ", "12 High Street, Lahore 54000"),
    ("Building 4, بلاک 4", "Building 4, بلاک 4"),
])
def test_an_address_is_kept_as_one_tidy_line(typed, expected):
    assert ext.validate_location(typed) == expected


@pytest.mark.parametrize("typed, message", [
    (None, "Add the address"), ("", "Add the address"), ("   \n\t ", "Add the address"),
    ("x" * 301, "at most 300"), ("Room 4\x00", "not valid"), ("Room\x1b[31m 4", "not valid"),
])
def test_an_address_that_is_missing_too_long_or_not_text_is_refused_with_a_message(typed, message):
    with pytest.raises(ext.ExternalInterviewError, match=message):
        ext.validate_location(typed)


def test_an_address_of_exactly_the_longest_length_is_accepted():
    assert ext.validate_location("a" * 300) == "a" * 300


def test_a_row_of_the_pipeline_carries_the_place_and_no_link():
    candidate = {
        "interview_mode": "external",
        "external_interview": {"platform": "physical", "platform_label": "In person", "location": ADDRESS, "join_url": None,
                               "scheduled_start_at": START, "duration_minutes": 45, "status": "scheduled"},
    }
    fields = ext.pipeline_fields(candidate)
    assert fields["external_platform"] == "physical" and fields["external_platform_label"] == "In person"
    assert fields["external_location"] == ADDRESS and fields["external_join_url"] is None
    assert ext.pipeline_fields(None)["external_location"] is None
    assert ext.pipeline_fields({"interview_mode": "platform"})["external_location"] is None


def test_moving_the_place_is_a_change_the_candidate_is_told_about():
    old = {"platform": "physical", "platform_label": "In person", "location": "Office A", "scheduled_start_at": START, "duration_minutes": 45}
    assert ext.reschedule_changes(old, {**old, "location": "Office B"}) == {"location": ["Office A", "Office B"]}
    assert ext.reschedule_changes(old, old) == {}


def test_changing_from_a_meeting_to_a_place_records_the_platform_and_both_ends():
    zoom = {"platform": "zoom", "platform_label": "Zoom", "join_url": "https://zoom.us/j/1?pwd=secret", "scheduled_start_at": START}
    physical = {"platform": "physical", "platform_label": "In person", "location": "Office A", "scheduled_start_at": START}
    changes = ext.reschedule_changes(zoom, physical)
    assert changes["platform"] == ["Zoom", "In person"] and changes["location"] == [None, "Office A"]
    assert changes["join_url"] == ["https://zoom.us/j/1", None]


def test_the_review_still_stands_between_an_interview_in_person_and_a_hire():
    candidate = {"interview_mode": "external", "external_interview": {"platform": "physical"}}
    assert ext.needs_review(candidate) is True
    assert ext.needs_review({**candidate, "external_review": {"summary": "x"}}) is False


def test_the_report_says_the_interview_was_held_in_person_not_on_another_platform():
    assert "held in person" in integrity_sentence("In person") and "another platform" not in integrity_sentence("In person")
    assert "held on another platform (Zoom)" in integrity_sentence("Zoom")


@pytest.fixture
def sent(monkeypatch):
    out: list[dict] = []

    async def record(**kwargs):
        out.append(kwargs)
        return True

    async def no_override(key):
        return None

    monkeypatch.setattr(email_service, "send_email", record)
    monkeypatch.setattr(email_service, "get_template_override", no_override)
    return out


def call(**over):
    values = dict(
        to_email="c@example.com", candidate_name="Priya Sharma", job_title="Backend Engineer", company_name="Acme",
        location=ADDRESS, scheduled_start_at=START, duration_minutes=45, notes="Ask for Sana at reception.",
        display_timezone="Asia/Karachi", candidate_id="cand_1", job_id="job_1",
    )
    values.update(over)
    return email_service.send_physical_interview_email(**values)


async def test_the_email_says_when_how_long_and_where_with_a_link_to_the_map(sent):
    assert await call() is True
    (mail,) = sent
    assert mail["template"] == "physical_interview_call" and mail["subject"] == "Your in-person interview for Backend Engineer"
    text, html = mail["text_body"], mail["html_body"]
    for expected in ("Position: Backend Engineer at Acme", "In-person interview", "about 45 minutes", f"Location: {ADDRESS}"):
        assert expected in text
    assert "We would like to invite you to an interview in person." in text and "Ask for Sana at reception." in text
    assert "Please arrive a few minutes early" in text and text.rstrip().endswith("Best regards,\nHR Platform")
    maps = email_service.map_url(ADDRESS)
    assert maps.startswith("https://www.google.com/maps/search/?api=1&query=Hirely.ai%20Head%20Office") and maps in text
    assert ">Location<" in html and "Park View, Lahore" in html and "Get directions" in html
    assert f'href="{maps.replace("&", "&amp;")}"' in html and "Ask for Sana at reception." in html
    assert "Join the interview" not in html and "Join:" not in text and ">In-person interview<" in html


async def test_an_updated_interview_is_told_as_a_change(sent):
    await call(updated=True)
    (mail,) = sent
    assert mail["subject"] == "Updated interview details for Backend Engineer"
    assert "The details of your interview have changed." in mail["text_body"] and ">Interview details updated<" in mail["html_body"]


async def test_without_a_note_there_is_no_note_box(sent):
    await call(notes=None)
    assert "A note from the recruiter" not in sent[0]["text_body"] and "A note from the recruiter" not in sent[0]["html_body"]


async def test_the_message_has_no_score_or_report_words(sent):
    await call()
    visible = re.sub(r"<[^>]+>", " ", sent[0]["html_body"]) + sent[0]["text_body"]
    assert not re.search(r"\b(scores?|scored|recommend\w*|evaluat\w*|ranking|report)\b", visible, re.I)


async def test_what_a_person_typed_cannot_add_markup_or_a_link(sent):
    nasty = '<script>alert(1)</script> <a href="http://evil.test">x</a>'
    await call(location=nasty, notes=nasty, candidate_name=nasty, job_title=nasty, company_name=nasty)
    html = sent[0]["html_body"]
    assert "<script>" not in html and 'href="http://evil.test"' not in html
    assert html.count("&lt;script&gt;") >= 4


async def test_the_calendar_invitation_carries_the_place_as_its_location(sent):
    await call(calendar_sequence=2)
    mail = sent[0]
    assert mail["attachment_filename"] == "interview.ics" and mail["attachment_content_type"].startswith("text/calendar; method=REQUEST")
    ics = mail["attachment_bytes"].decode("utf-8").replace("\r\n ", "")
    assert "METHOD:REQUEST" in ics and "SEQUENCE:2" in ics and "UID:external-interview-cand_1@hrbot" in ics
    assert "LOCATION:Hirely.ai Head Office\\, 228 Rose Commercial\\, Park View\\, Lahore" in ics
    assert "SUMMARY:Interview for Backend Engineer" in ics and "In-person interview" in ics and "Join:" not in ics
    assert "ATTENDEE;ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:c@example.com" in ics


def test_a_meeting_on_a_platform_has_no_location_line_in_its_invitation():
    ics = email_service.build_external_interview_ics(
        candidate_id="c1", to_email="c@example.com", job_title="Dev", platform_label="Zoom", join_url="https://zoom.us/j/1",
        scheduled_start_at=START, duration_minutes=30,
    )
    assert "LOCATION" not in ics and "Platform: Zoom" in ics.replace("\r\n ", "") and "Join: https://zoom.us/j/1" in ics.replace("\r\n ", "")


def test_a_calendar_location_is_escaped_and_folded_like_any_text():
    ics = calendar_ics.build_ics_event(
        uid="u", summary="s", description="d", start_iso=START, duration_minutes=30, organizer_email="o@example.com",
        location="Hall 3; Block B, " + "long " * 30,
    )
    unfolded = ics.replace("\r\n ", "")
    assert "LOCATION:Hall 3\\; Block B\\, long long" in unfolded
    assert all(len(line.encode()) <= 75 for line in ics.split("\r\n"))
    assert "LOCATION" not in calendar_ics.build_ics_event(
        uid="u", summary="s", description="d", start_iso=START, duration_minutes=30, organizer_email="o@example.com")


async def test_the_reminder_for_an_interview_in_person_names_the_place_and_has_no_join_link(sent):
    await email_service.send_external_interview_reminder_email(
        to_email="c@example.com", candidate_name="Priya", job_title="Dev", company_name=None, platform_label="In person",
        join_url=None, location=ADDRESS, scheduled_start_at=START, duration_minutes=45)
    mail = sent[0]
    assert mail["template"] == "external_interview_reminder"
    assert f"Location: {ADDRESS}" in mail["text_body"] and "Join:" not in mail["text_body"] and "Platform:" not in mail["text_body"]
    assert "Please arrive a few minutes early" in mail["text_body"]
    assert "Get directions" in mail["html_body"] and "Join the interview" not in mail["html_body"]


async def test_the_reminder_for_a_meeting_is_what_it_was(sent):
    await email_service.send_external_interview_reminder_email(
        to_email="c@example.com", candidate_name="Priya", job_title="Dev", company_name=None, platform_label="Zoom",
        join_url="https://zoom.us/j/1", scheduled_start_at=START, duration_minutes=45)
    mail = sent[0]
    assert "Platform: Zoom" in mail["text_body"] and "Join:     https://zoom.us/j/1" in mail["text_body"]
    assert "Join the interview" in mail["html_body"] and "Location" not in mail["html_body"]


def test_the_message_is_one_a_company_can_edit_and_starts_from_a_sample():
    meta = TEMPLATE_KEYS["send_physical_interview_email"]
    assert meta["label"] == "Physical Interview Call" and meta["candidate_facing"] is True
    assert {"location", "map_url", "when", "lead", "notes", "brand_logo_html"} <= set(meta["placeholders"])
    sample = SAMPLES["send_physical_interview_email"]
    assert "{{location}}" in sample["html"] and 'href="{{map_url}}"' in sample["html"] and "{{location}}" in sample["text"]


async def test_a_saved_template_is_used_with_the_place_escaped_and_the_map_link_checked(monkeypatch):
    out: list[dict] = []

    async def record(**kwargs):
        out.append(kwargs)
        return True

    async def override(key):
        assert key == "send_physical_interview_email"
        return {
            "subject_template": "Come to {{location}}",
            "html_body_template": '<p>{{candidate_name}} at {{location}}</p><a href="{{map_url}}">map</a>',
            "text_body_template": "Go to {{location}} ({{when}})",
        }

    monkeypatch.setattr(email_service, "send_email", record)
    monkeypatch.setattr(email_service, "get_template_override", override)
    await call(location="Hall <b>3</b>")
    (mail,) = out
    assert mail["subject"] == "Come to Hall <b>3</b>" and mail["text_body"].startswith("Go to Hall <b>3</b> (")
    assert "Hall &lt;b&gt;3&lt;/b&gt;" in mail["html_body"] and "<b>3</b>" not in mail["html_body"]
    assert 'href="https://www.google.com/maps/search/?api=1&amp;query=' in mail["html_body"]


def test_the_sample_fills_in_from_the_preview_values():
    meta = TEMPLATE_KEYS["send_physical_interview_email"]
    values = {p: PREVIEW_VALUES[p] for p in meta["placeholders"]}
    for part, text in SAMPLES["send_physical_interview_email"].items():
        assert "{{" not in render(text, values), part
