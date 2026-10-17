import random
from pathlib import Path

import olefile
import pytest
from fastapi import HTTPException

from services.hr_module import application_service
from services.hr_module.legacy_doc import OLE_MAGIC, extract_doc_text
from services.hr_module.resume_intel import extract_text

FIXTURES = Path(__file__).parent / "fixtures"
RICH = (FIXTURES / "resume_rich.doc").read_bytes()
UNICODE = (FIXTURES / "resume_unicode.doc").read_bytes()


@pytest.fixture
def locked(tmp_path) -> bytes:
    path = tmp_path / "locked.doc"
    path.write_bytes(RICH)
    ole = olefile.OleFileIO(str(path), write_mode=True)
    word = bytearray(ole.openstream("WordDocument").read())
    word[0x0B] |= 0x01
    ole.write_stream("WordDocument", bytes(word))
    ole.close()
    return path.read_bytes()


def test_a_word_97_document_is_read_with_its_structure():
    text = extract_doc_text(RICH)
    lines = text.split("\n")
    assert lines[0] == "Sara Khan" and lines[1] == "Senior Platform Engineer"
    assert "sara.khan@example.com" in lines[2] and "+92 300 1234567" in lines[2]
    assert "Café Solutions – 2018 to 2024" in text
    assert "“Reduced latency by 40 percent”" in text
    assert "• Led a team of six engineers" in lines
    assert "Skill\tYears" in lines and "Python\t10" in lines
    assert "HYPERLINK" not in text and "mailto" not in text and "\x13" not in text and "\x15" not in text
    assert "Confidential header text" not in text


def test_text_outside_the_latin_range_survives():
    first, second = extract_doc_text(UNICODE).split("\n")
    assert first == "José García – 中文 مرحبا"
    assert second.startswith("Ingeniero de software con diez años")


@pytest.mark.anyio
async def test_the_resume_parser_reads_a_doc_file_by_its_name():
    text = await extract_text(RICH, "Sara_CV.DOC")
    assert text.startswith("Sara Khan\nSenior Platform Engineer\n")


@pytest.mark.anyio
async def test_the_resume_parser_reports_a_bad_doc_as_a_value_error():
    with pytest.raises(ValueError, match="Could not read DOC file"):
        await extract_text(b"not a word file", "cv.doc")


def test_a_password_protected_document_is_named_as_such(locked):
    with pytest.raises(ValueError, match="password protected"):
        extract_doc_text(locked)


@pytest.mark.parametrize("raw", [
    pytest.param(b"", id="empty"),
    pytest.param(b"plain text", id="plain-text"),
    pytest.param(b"%PDF-1.4 mislabelled", id="pdf"),
    pytest.param(OLE_MAGIC, id="magic-only"),
    pytest.param(OLE_MAGIC + b"\x00" * 600, id="blank-container"),
    pytest.param(RICH[:2000], id="first-2000-bytes"),
    pytest.param(RICH[:len(RICH) // 2], id="first-half"),
])
def test_anything_that_is_not_a_readable_word_document_is_a_value_error(raw):
    with pytest.raises(ValueError):
        extract_doc_text(raw)


def test_random_corruption_only_ever_ends_in_text_or_a_value_error():
    rng = random.Random(7)
    for _ in range(300):
        data = bytearray(RICH)
        for _ in range(rng.randint(1, 40)):
            data[rng.randrange(len(data))] = rng.randrange(256)
        try:
            result = extract_doc_text(bytes(data))
        except ValueError:
            continue
        assert isinstance(result, str)


def test_the_careers_form_takes_a_real_doc_file_and_still_checks_what_it_is():
    assert application_service.validate_file("Sara CV.doc", RICH) == "Sara CV.doc"
    with pytest.raises(HTTPException) as err:
        application_service.validate_file("cv.doc", b"%PDF-1.4 not word")
    assert err.value.status_code == 415 and "valid DOC" in err.value.detail


@pytest.mark.anyio
async def test_a_real_doc_file_is_readable_and_a_locked_one_says_why(locked):
    await application_service.ensure_readable("cv.doc", RICH)
    with pytest.raises(HTTPException) as err:
        await application_service.ensure_readable("cv.doc", locked)
    assert err.value.status_code == 422 and "password protected" in err.value.detail
