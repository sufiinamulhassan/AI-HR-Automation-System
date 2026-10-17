from config.settings import settings
from config.tenancy import DEFAULT_COMPANY_ID
from shared.auth import _demo_user


def test_in_debug_the_test_suite_can_name_a_company_and_be_a_platform_owner(monkeypatch):
    monkeypatch.setattr(settings, "DEBUG", True)
    user = _demo_user("demo-admin-token@@cmp_other")
    assert user["company_id"] == "cmp_other" and user["role"] == "admin"
    assert _demo_user("demo-platform-token")["is_platform_admin"] is True


def test_outside_debug_the_backdoor_cannot_open_other_companies_or_the_console(monkeypatch):
    monkeypatch.setattr(settings, "DEBUG", False)
    named = _demo_user("demo-superadmin-token@@cmp_victim")
    assert named["company_id"] == DEFAULT_COMPANY_ID
    platform = _demo_user("demo-platform-token@@cmp_victim")
    assert platform["is_platform_admin"] is False and platform["company_id"] == DEFAULT_COMPANY_ID
    assert platform["role"] == "standard"
