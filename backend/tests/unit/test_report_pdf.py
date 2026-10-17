import base64
import io
from datetime import datetime, timezone

import pdfplumber
import pytest
from PIL import Image

import services.hr_module.url_safety as url_safety
from services.hr_module import branding_service
from services.hr_module import report_pdf_service as pdf_service
from services.hr_module.report_pdf_service import Letterhead, build_report_pdf, letterhead_from_branding

pytestmark = pytest.mark.anyio

NOW = datetime(2026, 10, 13, 10, 30, tzinfo=timezone.utc)


def logo_png(color=(200, 30, 30)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (60, 30), color).save(buf, "PNG")
    return buf.getvalue()


LETTERHEAD = Letterhead(
    company_name="Acme Talent", logo=logo_png(), header_text="12 High Street\nLahore 54000",
    footer_text="Acme Talent Ltd. Registered in Pakistan.",
)

BREAKDOWN = {
    "dimensions": [
        {"name": "technical", "score": 82, "weight": 0.30, "rationale": "Explained partitioning correctly."},
        {"name": "communication", "score": 74, "weight": 0.20, "rationale": "Clear and structured."},
        {"name": "problem_solving", "score": 80, "weight": 0.25, "rationale": "Diagnosed the stalled consumer."},
        {"name": "cultural_fit", "score": 70, "weight": 0.15, "rationale": "Collaborative language."},
        {"name": "confidence", "score": 65, "weight": 0.10, "rationale": "Steady on familiar topics."},
    ],
    "integrity_deductions": [{"event": "tab_switch", "timestamp": "2026-10-12T09:12:10+00:00", "points": -5}],
    "integrity_multiplier": 0.97, "final_score": 71,
}


def ai_candidate(**over) -> dict:
    candidate = {
        "name": "Priya Raman", "email": "priya@example.test", "match_score": 0.83,
        "interview_started_at": "2026-10-12T09:00:00+00:00", "interview_ended_at": "2026-10-12T09:41:00+00:00",
        "integrity_flags": ["tab_switch@2026-10-12T09:12:10+00:00", "face_detected@2026-10-12T09:12:30+00:00"],
        "transcript": [
            {"question": "Tell me about a system you scaled.", "answer": "I rebuilt the notification service."},
            {"question": "Cache or replica?", "answer": "It depends on the read pattern."},
        ],
        "report": {
            "overall_score": 78, "technical_score": 82, "communication_score": 74, "problem_solving_score": 80,
            "cultural_fit_score": 70, "confidence_score": 65, "integrity_score": 88, "coding_score": 90,
            "recommendation": "hire", "final_score": 71, "summary": "Strong systems thinking.",
            "strengths": ["Concrete examples"], "areas_for_improvement": ["Testing strategy"],
            "integrity_assessment": "Two minor events.", "score_breakdown": BREAKDOWN,
        },
    }
    candidate.update(over)
    return candidate


def scorecard_candidate() -> dict:
    return {
        "name": "Sam Rivera", "email": "sam@example.test",
        "report": {
            "source": "interviewer_scorecard", "overall_score": 80, "technical_score": 80, "communication_score": 70,
            "problem_solving_score": 75, "cultural_fit_score": 85, "confidence_score": 60, "final_score": 74,
            "recommendation": "maybe", "interviewer_recommendation": "hire", "interview_platform": "Zoom",
            "summary": "Two interviewers agree.",
            "integrity_assessment": "No proctoring data exists because this interview was held on another platform (Zoom), not in the AI interview room.",
            "interviewers": [{"name": "Priya Nair & Co <HR>", "role": "hr", "recommendation": "hire", "overall": 4}],
            "questions": [{"text": "Guide question 1", "dimension": "technical", "entries": [
                {"by": "Priya Nair & Co <HR>", "role": "hr", "rating": 4, "notes": "Fine <b>bold</b> & careful."}]}],
            "score_breakdown": {**BREAKDOWN, "integrity_deductions": [], "integrity_multiplier": 1},
        },
        "transcript": [],
    }


def pages(pdf_bytes: bytes) -> list[str]:
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        return [" ".join((page.extract_text() or "").split()) for page in pdf.pages]


def text_of(pdf_bytes: bytes) -> str:
    return " ".join(pages(pdf_bytes))


def build(candidate=None, **kwargs) -> bytes:
    kwargs.setdefault("letterhead", LETTERHEAD)
    kwargs.setdefault("generated_at", NOW)
    return build_report_pdf(candidate or ai_candidate(), **kwargs)


def long_transcript(turns=60) -> list[dict]:
    return [{"question": f"Question number {i}?", "answer": f"Answer {i}. " + "Some detail. " * 25} for i in range(turns)]


def test_the_company_name_and_header_text_are_on_the_first_page_and_the_footer_on_every_page():
    pdf = build(ai_candidate(transcript=long_transcript()))
    all_pages = pages(pdf)
    assert len(all_pages) >= 3
    assert "Acme Talent" in all_pages[0] and "12 High Street" in all_pages[0] and "Lahore 54000" in all_pages[0]
    for number, page in enumerate(all_pages, 1):
        assert "Acme Talent Ltd. Registered in Pakistan." in page
        assert f"Page {number} of {len(all_pages)}" in page
        assert "Confidential. For authorised hiring staff only." in page


def test_later_pages_carry_a_compact_header_with_the_company_and_the_candidate():
    all_pages = pages(build(ai_candidate(transcript=long_transcript())))
    assert "Interview Report: Priya Raman" in all_pages[1] and "Acme Talent" in all_pages[1]
    assert "12 High Street" not in all_pages[1]


def test_the_logo_is_on_the_first_page_only():
    with pdfplumber.open(io.BytesIO(build(ai_candidate(transcript=long_transcript())))) as pdf:
        assert len(pdf.pages[0].images) == 1
        assert all(len(page.images) == 0 for page in pdf.pages[1:])


def test_a_logo_the_library_cannot_read_leaves_the_report_without_one():
    pdf = build(letterhead=Letterhead(company_name="Acme Talent", logo=b"not an image at all"))
    with pdfplumber.open(io.BytesIO(pdf)) as document:
        assert len(document.pages[0].images) == 0
    assert "Interview Report: Priya Raman" in text_of(pdf)


def test_with_no_letterhead_the_report_still_has_a_plain_header_and_its_page_numbers():
    pdf = build_report_pdf(ai_candidate(), generated_at=NOW)
    text = text_of(pdf)
    assert "Interview report" in text and "Page 1 of" in text and "Interview Report: Priya Raman" in text


def test_the_first_page_names_the_report_not_a_company_when_the_company_has_no_name():
    assert "Interview report" in pages(build(letterhead=Letterhead()))[0]


def test_an_ai_report_has_every_section():
    text = text_of(build(job={"title": "Senior Backend Engineer"}))
    for expected in (
        "Interview Report: Priya Raman", "Senior Backend Engineer", "priya@example.test", "AI interview", "41 min",
        "13 Oct 2026, 10:30 UTC", "FINAL SCORE RECOMMENDATION INTEGRITY MATCH SCORE", "71 HIRE 88 83 /100 /100 %",
        "Summary", "Strong systems thinking.", "Scores", "AI overall 78/100", "Coding (tests passed) 90/100",
        "Score breakdown", "Weighted score", "Integrity multiplier x0.97", "Final score 71/100", "Explained partitioning correctly.",
        "Integrity deductions", "Tab switch", "Strengths and areas to improve", "Concrete examples", "Testing strategy",
        "Integrity Assessment", "Two minor events.", "Proctoring log", "Face detected",
        "Interview transcript", "4 messages", "Tell me about a system you scaled.", "I rebuilt the notification service.",
    ):
        assert expected in text, expected


def test_the_score_breakdown_shows_each_weight_and_what_it_adds_up_to():
    text = text_of(build())
    assert "Technical 82/100 30% 24.6" in text
    assert "Communication 74/100 20% 14.8" in text
    assert "Weighted score 76.4" in text


def test_a_score_the_report_does_not_have_prints_not_applicable_never_na():
    candidate = ai_candidate(report={
        "overall_score": 70, "technical_score": 71, "recommendation": "maybe", "summary": "Thin evidence.",
        "integrity_assessment": "No integrity flags to report.", "strengths": [], "areas_for_improvement": [],
    })
    text = text_of(build(candidate))
    assert "N/A" not in text
    assert text.count("Not applicable") >= 5
    assert "71/100" in text and "70/100" in text


def test_an_interview_with_no_usable_answers_says_not_scored_instead_of_a_zero():
    candidate = ai_candidate(transcript=[], report={
        "evaluation_status": "insufficient_transcript", "recommendation": "maybe", "summary": "No answer content was captured.",
    })
    text = text_of(build(candidate))
    assert "Not scored" in text and "No answer content was captured." in text
    assert "0 /100" not in text and "N/A" not in text


def test_a_failed_report_says_why():
    candidate = ai_candidate(report={**ai_candidate()["report"], "report_status": "failed", "report_error": "The model timed out."})
    assert "Report generation failed: The model timed out." in text_of(build(candidate))


def test_a_report_with_only_strengths_does_not_name_the_empty_side():
    candidate = ai_candidate()
    candidate["report"]["areas_for_improvement"] = []
    text = text_of(build(candidate))
    assert "Strengths" in text and "Concrete examples" in text
    assert "Areas for" not in text and "Strengths and areas" not in text


def test_a_scorecard_report_lists_interviewers_and_questions_and_has_no_integrity_record_or_transcript():
    text = text_of(build(scorecard_candidate()))
    assert "Interview Report: Sam Rivera" in text
    assert "Integrity " not in text.replace("Integrity Assessment", "")
    assert "Interviewers" in text and "Priya Nair & Co <HR> (HR)" in text
    assert "Questions" in text and "Guide question 1" in text
    assert "Interviewer recommendation: Hire" in text and "Interview held on Zoom" in text
    assert "Interviewer overall 80/100" in text and "Interviewer scorecards" in text
    assert "Integrity Assessment" in text and "held on another platform (Zoom)" in text
    assert "Proctoring log" not in text and "transcript" not in text.lower()
    assert "Not applicable" not in text and "N/A" not in text


def test_what_an_interviewer_typed_is_shown_as_typed_never_parsed():
    text = text_of(build(scorecard_candidate()))
    assert "Fine <b>bold</b> & careful." in text


def test_markup_in_a_name_a_message_or_a_note_is_text():
    candidate = ai_candidate(name="<b>Bold</b> & <img src='http://169.254.169.254/x'>", transcript=[
        {"question": "<font size=99>Q</font> & more", "answer": "<a href='http://evil.test'>click</a>"},
    ])
    candidate["report"]["summary"] = "<para>Summary</para> & <b>stuff"
    pdf = build(candidate, job={"title": "<i>Engineer</i>"})
    text = text_of(pdf)
    assert "<b>Bold</b> & <img src='http://169.254.169.254/x'>" in text
    assert "<font size=99>Q</font> & more" in text and "<a href='http://evil.test'>click</a>" in text
    assert "<para>Summary</para> & <b>stuff" in text and "<i>Engineer</i>" in text


def test_a_message_in_a_script_the_font_cannot_draw_is_replaced_by_a_note_not_boxes():
    candidate = ai_candidate(transcript=[{"question": "Tell us about yourself.", "answer": "میں ایک انجینئر ہوں اور مجھے کام پسند ہے"}])
    text = text_of(build(candidate))
    assert "[This message is written in a script this PDF cannot show (Arabic). Read it in the app.]" in text
    assert "میں" not in text


def test_a_few_foreign_characters_in_an_english_message_print_as_question_marks():
    candidate = ai_candidate(transcript=[{"question": "Where are you based?", "answer": "I live in Zürich, near the 東京 office"}])
    text = text_of(build(candidate))
    assert "I live in Zürich, near the ?? office" in text


def test_a_name_in_another_script_prints_without_boxes():
    text = text_of(build(ai_candidate(name="علی خان")))
    assert "Interview Report: ??? ???" in text


def test_a_very_long_message_is_cut_and_a_very_long_transcript_still_builds():
    candidate = ai_candidate(transcript=[{"question": "Q?", "answer": "word " * 5000}] + long_transcript(200))
    pdf = build(candidate)
    assert pdf.startswith(b"%PDF")
    text = text_of(pdf)
    assert "..." in text and text.count("word word word word") < 5000


def test_transcript_entries_in_the_chat_shape_are_read_too():
    candidate = ai_candidate(transcript=[
        {"role": "assistant", "content": "What is a mutex?"}, {"role": "user", "content": "A lock for shared data."}, {"role": "junk"}, "not a dict",
    ])
    text = text_of(build(candidate))
    assert "2 messages" in text and "What is a mutex?" in text and "A lock for shared data." in text
    assert "Interviewer" in text and "Candidate" in text


def test_an_answer_left_empty_is_shown_as_no_answer():
    candidate = ai_candidate(transcript=[{"question": "Describe a disagreement.", "answer": ""}])
    assert "(no answer)" in text_of(build(candidate))


def test_a_report_with_no_transcript_has_no_transcript_section():
    assert "Interview transcript" not in text_of(build(ai_candidate(transcript=[])))


def test_the_pdf_is_the_same_whatever_the_clock_when_the_date_is_given():
    assert pages(build()) == pages(build())


def test_the_uploaded_template_text_comes_before_the_plain_text_fields():
    letterhead = letterhead_from_branding({
        "letterhead_template": {"header_text": "From the template", "footer_text": "Template footer"},
        "letterhead_header_text": "Plain header", "letterhead_footer_text": "Plain footer",
    }, company_name="Acme", logo=None)
    assert (letterhead.header_text, letterhead.footer_text) == ("From the template", "Template footer")


def test_plain_text_fields_are_used_when_there_is_no_template():
    letterhead = letterhead_from_branding(
        {"letterhead_header_text": "Plain header", "letterhead_footer_text": "Plain footer"}, company_name=" Acme ", logo=b"x")
    assert (letterhead.company_name, letterhead.header_text, letterhead.footer_text, letterhead.logo) == ("Acme", "Plain header", "Plain footer", b"x")


def test_a_pasted_address_has_its_tabs_and_blank_lines_tidied():
    letterhead = letterhead_from_branding(
        {"letterhead_footer_text": "228, Rose Commercial\t+92 308 3406338\r\n\r\n   Lahore   53720  \n"}, company_name="Acme", logo=None)
    assert letterhead.footer_text == "228, Rose Commercial +92 308 3406338\nLahore 53720"


def test_the_companys_colours_are_used_when_they_are_valid_and_dark_enough_to_carry_white_text():
    letterhead = letterhead_from_branding({"primary_color": "#112233", "accent_color": "#0b3d91"}, company_name="Acme", logo=None)
    assert (letterhead.primary, letterhead.accent) == ("#112233", "#0b3d91")


@pytest.mark.parametrize("accent", ["#f0f0f0", "not a colour", "", None, "#12345"])
def test_an_unusable_accent_falls_back_to_the_default(accent):
    letterhead = letterhead_from_branding({"accent_color": accent, "primary_color": "nope"}, company_name="Acme", logo=None)
    assert letterhead.accent == pdf_service.DEFAULT_ACCENT_COLOR
    assert letterhead.primary == pdf_service.DEFAULT_PRIMARY_COLOR


def test_no_branding_at_all_gives_a_plain_letterhead():
    letterhead = letterhead_from_branding(None, company_name=None, logo=None)
    assert letterhead == Letterhead()


def test_the_report_is_drawn_in_the_companys_colours():
    pdf = build(letterhead=Letterhead(company_name="Acme", accent="#0b3d91", primary="#ff0000"))
    with pdfplumber.open(io.BytesIO(pdf)) as document:
        fills = {
            tuple(round(c, 3) for c in rect["non_stroking_color"])
            for rect in document.pages[0].rects if isinstance(rect.get("non_stroking_color"), (tuple, list))
        }
    assert (1.0, 0.0, 0.0) in fills
    assert (0.043, 0.239, 0.569) in fills


async def test_the_templates_own_logo_comes_first():
    png = logo_png()
    branding = {"letterhead_template": {"logo_base64": base64.b64encode(png).decode()}, "company_logo_url": "https://cdn.example.test/l.png"}
    assert await branding_service.resolve_logo_bytes(branding) == png


async def test_a_template_logo_that_cannot_be_read_is_none_and_does_not_fall_back_to_the_company_logo(monkeypatch):
    async def never(*_a, **_k):
        raise AssertionError("the company logo must not be fetched")

    monkeypatch.setattr(url_safety, "fetch_public_image", never)
    branding = {"letterhead_template": {"logo_base64": "%%%not base64%%%"}, "company_logo_url": "https://cdn.example.test/l.png"}
    assert await branding_service.resolve_logo_bytes(branding) is None


async def test_an_uploaded_logo_is_read_from_storage(monkeypatch):
    async def stored():
        return b"stored-bytes", "image/png", "sha"

    monkeypatch.setattr(branding_service, "load_logo", stored)
    assert await branding_service.resolve_logo_bytes({"company_logo_url": branding_service.LOGO_PATH_PREFIX + "cmp_a"}) == b"stored-bytes"


async def test_a_logo_at_an_address_is_fetched_under_the_safe_fetchers_limits(monkeypatch):
    seen = []

    async def fetch(url):
        seen.append(url)
        return b"fetched"

    monkeypatch.setattr(url_safety, "fetch_public_image", fetch)
    assert await branding_service.resolve_logo_bytes({"company_logo_url": "https://cdn.example.test/l.png"}) == b"fetched"
    assert seen == ["https://cdn.example.test/l.png"]


@pytest.mark.parametrize("branding", [None, {}, {"company_logo_url": ""}, {"letterhead_template": None}])
async def test_no_logo_configured_is_none(branding):
    assert await branding_service.resolve_logo_bytes(branding) is None


async def test_a_missing_upload_or_an_unreachable_address_is_none_not_an_error(monkeypatch):
    async def missing():
        return None

    async def unreachable(url):
        raise OSError("connection refused")

    monkeypatch.setattr(branding_service, "load_logo", missing)
    assert await branding_service.resolve_logo_bytes({"company_logo_url": branding_service.LOGO_PATH_PREFIX + "cmp_a"}) is None
    monkeypatch.setattr(url_safety, "fetch_public_image", unreachable)
    assert await branding_service.resolve_logo_bytes({"company_logo_url": "https://cdn.example.test/l.png"}) is None


@pytest.fixture
async def world(monkeypatch):
    from types import SimpleNamespace

    from httpx import ASGITransport, AsyncClient

    import config.database as database
    from config import tenancy
    from fake_mongo import FakeRaw
    from main import app
    from shared import auth as auth_module

    company = "cmp_a"
    raw = FakeRaw()
    raw.add("branding_settings", {
        "_id": tenancy.namespaced_id(company, "singleton"), "company_logo_url": branding_service.LOGO_PATH_PREFIX + company,
        "logo_base64": base64.b64encode(logo_png()).decode(), "logo_content_type": "image/png", "logo_sha": "abc",
        "letterhead_header_text": "1 Office Road", "letterhead_footer_text": "Acme Route Ltd. Company no. 123",
        "primary_color": "#4778f3", "accent_color": "#222022",
    }, company)
    raw.add("company_settings", {"_id": tenancy.namespaced_id(company, "singleton"), "company_name": "Acme Organisation Ltd"}, company)
    raw.add("jobs", {"job_id": "job_1", "title": "Platform Engineer"}, company)
    candidate = ai_candidate()
    raw.add("candidates", {**candidate, "candidate_id": "c_1", "job_id": "job_1", "secure_token": "tok_pdf", "interview_mode": "platform"}, company)
    monkeypatch.setattr(database, "_db", raw)
    real_bind = auth_module.bind_company
    monkeypatch.setattr(auth_module, "bind_company", lambda cid, comp: real_bind(cid, {**comp, "name": "Acme Route", "settings": {}}))
    tenancy.use_fallback_company(None)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as client:
        yield SimpleNamespace(client=client, raw=raw)
    tenancy.use_fallback_company(tenancy.DEFAULT_COMPANY_ID)


ROUTE = "/api/v1/interview/report/tok_pdf/pdf"
ADMIN = {"Authorization": "Bearer demo-admin-token@@cmp_a"}
STANDARD = {"Authorization": "Bearer demo-standard-token@@cmp_a"}


async def test_an_admin_downloads_the_report_on_the_companys_letterhead(world):
    response = await world.client.get(ROUTE, headers=ADMIN)
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/pdf" and response.content.startswith(b"%PDF")
    assert response.headers["content-disposition"] == "attachment; filename=report_tok_pdf.pdf"

    first = pages(response.content)[0]
    assert first.startswith("Acme Organisation Ltd") or " Acme Organisation Ltd " in f" {first} "
    assert "1 Office Road" in first
    assert "Acme Route Ltd. Company no. 123" in first
    assert "Interview Report: Priya Raman" in first and "Platform Engineer" in first
    with pdfplumber.open(io.BytesIO(response.content)) as document:
        assert len(document.pages[0].images) == 1


async def test_a_company_with_no_letterhead_still_gets_a_complete_report(world):
    world.raw["branding_settings"].docs.clear()
    response = await world.client.get(ROUTE, headers=ADMIN)
    assert response.status_code == 200, response.text
    text = text_of(response.content)
    assert "Acme Organisation Ltd" in text and "Interview Report: Priya Raman" in text and "Page 1 of" in text


async def test_without_a_name_on_the_organization_page_the_workspace_name_is_printed(world):
    world.raw["company_settings"].docs[0]["company_name"] = "   "
    first = pages((await world.client.get(ROUTE, headers=ADMIN)).content)[0]
    assert "Acme Route" in first and "Acme Organisation Ltd" not in first


@pytest.mark.parametrize("profile, workspace_name, expected", [
    ({"company_name": "Hirely.ai"}, "Default", "Hirely.ai"),
    ({"company_name": "  Hirely.ai  "}, "Default", "Hirely.ai"),
    ({"company_name": ""}, "Default", "Default"),
    ({"company_name": None}, "Default", "Default"),
    ({"company_name": "   "}, "Default", "Default"),
    ({}, "Default", "Default"),
    (None, "Default", "Default"),
    ({}, "", ""),
])
async def test_the_printed_company_name_prefers_the_organization_page(monkeypatch, profile, workspace_name, expected):
    from types import SimpleNamespace

    from config import tenancy
    from services.hr_module import company_settings_service

    class Profiles:
        async def find_one(self, *args, **kwargs):
            return profile

    monkeypatch.setattr(company_settings_service, "get_db", lambda: SimpleNamespace(company_settings=Profiles()))
    with tenancy.company_context("cmp_x", {"name": workspace_name}):
        assert await company_settings_service.display_name() == expected


async def test_the_report_pdf_is_for_admins_only(world):
    assert (await world.client.get(ROUTE, headers=STANDARD)).status_code == 403
    assert (await world.client.get(ROUTE)).status_code in (401, 403)


async def test_a_report_that_is_not_ready_is_a_404(world):
    world.raw["candidates"].docs[0]["report"] = None
    assert (await world.client.get(ROUTE, headers=ADMIN)).status_code == 404
