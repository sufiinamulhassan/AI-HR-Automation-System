import pytest

from config.database import get_db
from services.hr_module import prompt_config_service as pcs

pytestmark = pytest.mark.anyio

URL = "/api/v1/prompt-config"


def _body(template: str, system: str = "You are a careful assistant.") -> dict:
    return {"system_prompt": system, "user_prompt_template": template}


@pytest.fixture
async def clean():
    yield
    await get_db().prompt_templates.delete_many({"key": {"$in": list(pcs.KNOWN_PROMPT_KEYS)}})


@pytest.mark.parametrize("key", sorted(pcs.KNOWN_PROMPT_KEYS))
async def test_every_built_in_prompt_passes_its_own_validation(key):
    _system, template = pcs._get_hardcoded_default(key)
    pcs.validate_user_prompt_template(key, template)


@pytest.mark.parametrize("key", sorted(pcs.KNOWN_PROMPT_KEYS))
async def test_a_template_that_passes_renders_with_what_the_call_site_supplies(key):
    template = " ".join("{" + p + "}" for p in pcs.required_placeholders(key))
    pcs.validate_user_prompt_template(key, template)
    values = {name: "x" for name in pcs.required_placeholders(key) + pcs._OPTIONAL_PLACEHOLDERS.get(key, [])}
    assert template.format(**values)


async def test_missing_placeholders_are_named_in_the_documented_order():
    with pytest.raises(pcs.PromptTemplateError) as err:
        pcs.validate_user_prompt_template("jd_parse", "Parse this job please.")
    assert str(err.value) == "Missing placeholders: {jd}, {industries}"

    with pytest.raises(pcs.PromptTemplateError) as err:
        pcs.validate_user_prompt_template("interview_eval", "{title} and {transcript}")
    assert str(err.value) == "Missing placeholders: {flags}"


async def test_an_unknown_placeholder_is_refused_because_it_would_not_render():
    template = "{jd} {industries} {surprise}"
    with pytest.raises(KeyError):
        template.format(jd="a", industries="b")
    with pytest.raises(pcs.PromptTemplateError) as err:
        pcs.validate_user_prompt_template("jd_parse", template)
    assert str(err.value) == "Unknown placeholders: {surprise}"


async def test_missing_is_reported_before_unknown():
    with pytest.raises(pcs.PromptTemplateError) as err:
        pcs.validate_user_prompt_template("jd_parse", "{jd} {surprise}")
    assert str(err.value) == "Missing placeholders: {industries}"


@pytest.mark.parametrize("template", ["{jd} {industries} {", "{jd} {industries} }", "{jd} {industries} {0}", "{jd} {industries} {}"])
async def test_stray_braces_and_positional_fields_are_refused(template):
    with pytest.raises(pcs.PromptTemplateError) as err:
        pcs.validate_user_prompt_template("jd_parse", template)
    message = str(err.value)
    assert message.startswith("Invalid template") or message.startswith("Unknown placeholders")


async def test_escaped_braces_and_optional_placeholders_are_fine():
    pcs.validate_user_prompt_template("jd_parse", 'Return {{"skills": []}} for {jd} in {industries}')
    template = " ".join("{" + p + "}" for p in pcs.required_placeholders("interview_questions"))
    pcs.validate_user_prompt_template("interview_questions", template + " {stage_line}{angle_line}")


async def test_a_placeholder_may_repeat_and_carry_a_conversion():
    pcs.validate_user_prompt_template("jd_parse", "{jd!r} again {jd} in {industries}")


async def test_an_unknown_key_is_a_key_error():
    with pytest.raises(KeyError):
        pcs.validate_user_prompt_template("nope", "{x}")


async def test_a_template_missing_placeholders_is_a_422_with_a_string_detail_and_is_not_saved(client, admin_headers, clean):
    response = await client.patch(f"{URL}/jd_parse", json=_body("Parse: {jd}"), headers=admin_headers)
    assert response.status_code == 422
    assert response.json()["detail"] == "Missing placeholders: {industries}"
    assert await get_db().prompt_templates.count_documents({"key": "jd_parse"}) == 0
    detail = (await client.get(f"{URL}/jd_parse", headers=admin_headers)).json()
    assert detail["is_customized"] is False


async def test_two_missing_placeholders_are_listed_with_a_comma(client, admin_headers, clean):
    response = await client.patch(f"{URL}/jd_parse", json=_body("Nothing to substitute here."), headers=admin_headers)
    assert response.status_code == 422
    assert response.json()["detail"] == "Missing placeholders: {jd}, {industries}"


async def test_an_unknown_or_malformed_template_is_a_422_string_too(client, admin_headers, clean):
    unknown = await client.patch(f"{URL}/jd_parse", json=_body("{jd} {industries} {invented}"), headers=admin_headers)
    assert unknown.status_code == 422 and unknown.json()["detail"] == "Unknown placeholders: {invented}"
    broken = await client.patch(f"{URL}/jd_parse", json=_body("{jd} {industries} {"), headers=admin_headers)
    assert broken.status_code == 422 and isinstance(broken.json()["detail"], str)
    assert broken.json()["detail"].startswith("Invalid template")


async def test_a_complete_template_is_saved_and_reported_as_customised(client, admin_headers, clean):
    template = "Job:\n{jd}\n\nIndustries: {industries}\nReturn JSON."
    response = await client.patch(f"{URL}/jd_parse", json=_body(template), headers=admin_headers)
    assert response.status_code == 200, response.text
    assert response.json()["user_prompt_template"] == template
    detail = (await client.get(f"{URL}/jd_parse", headers=admin_headers)).json()
    assert detail["is_customized"] is True and detail["user_prompt_template"] == template


async def test_every_key_enforces_its_own_placeholders(client, admin_headers, clean):
    for key in pcs.KNOWN_PROMPT_KEYS:
        response = await client.patch(f"{URL}/{key}", json=_body("a template with no placeholders"), headers=admin_headers)
        assert response.status_code == 422, key
        expected = ", ".join("{" + p + "}" for p in pcs.required_placeholders(key))
        assert response.json()["detail"] == f"Missing placeholders: {expected}"


async def test_the_built_in_default_can_be_saved_back_unchanged(client, admin_headers, clean):
    _system, template = pcs._get_hardcoded_default("interview_eval")
    response = await client.patch(f"{URL}/interview_eval", json=_body(template), headers=admin_headers)
    assert response.status_code == 200, response.text


async def test_the_older_checks_still_come_first(client, admin_headers, standard_headers, clean):
    assert (await client.patch(f"{URL}/jd_parse", json=_body("{jd} {industries}"), headers=standard_headers)).status_code == 403
    assert (await client.patch(f"{URL}/nope", json=_body("{x}"), headers=admin_headers)).status_code == 404
    blank = await client.patch(f"{URL}/jd_parse", json=_body("   "), headers=admin_headers)
    assert blank.status_code == 400
