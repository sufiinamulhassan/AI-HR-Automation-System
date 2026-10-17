import pytest

from services.hr_module import resume_profile as rp
from services.hr_module.resume_taxonomy import JOB_FAMILY_LABELS


def test_clean_text_trims_and_collapses_whitespace():
    assert rp.clean_text("  Senior \n\t Engineer  ", 50) == "Senior Engineer"


@pytest.mark.parametrize("value", [None, 5, 3.2, True, [], {}, ["a"], b"bytes"])
def test_clean_text_rejects_non_strings(value):
    assert rp.clean_text(value, 50) is None


@pytest.mark.parametrize("value", ["", "   ", "\n\t", "null", "None", "N/A", "n/a.", "na", "Unknown", "undefined", "Not stated", "not specified", "-", "--"])
def test_clean_text_treats_blanks_and_placeholders_as_missing(value):
    assert rp.clean_text(value, 50) is None


def test_clean_text_truncates_to_the_limit_and_trims_the_tail():
    out = rp.clean_text("abcde fghij", 6)
    assert out == "abcde"
    assert rp.clean_text("x" * 500, 120) == "x" * 120


def test_clean_text_removes_control_characters():
    assert rp.clean_text("Lahore\x00,\x07 Pakistan", 50) == "Lahore , Pakistan"


def test_clean_text_with_a_zero_limit_does_not_truncate():
    assert rp.clean_text("kept whole", 0) == "kept whole"


def test_availability_and_notice_period_are_gone_from_the_profile():
    assert "notice_period" not in rp.PROFILE_KEYS
    assert not hasattr(rp, "derive_availability") and not hasattr(rp, "NOTICE_LIMIT")
    assert "availability_status" not in rp.profile_fields({"notice_period": "30 days"}, None)
    assert "notice_period" not in rp.profile_fields({"notice_period": "30 days"}, None)


def test_the_taxonomy_keeps_the_family_and_domain_helpers_and_drops_availability():
    from services.hr_module import resume_taxonomy as taxonomy

    for name in ("AVAILABILITY", "availability_label", "is_known_availability"):
        assert not hasattr(taxonomy, name)
    for name in (
        "JOB_FAMILY_LABELS", "BUSINESS_DOMAINS", "family_label", "domain_slug_for_family", "domain_label",
        "families_for_domain", "is_known_domain", "known_families",
    ):
        assert hasattr(taxonomy, name)


def test_the_profile_no_longer_has_a_certifications_field_or_list_helper():
    assert "certifications" not in rp.PROFILE_KEYS
    assert not hasattr(rp, "clean_list") and not hasattr(rp, "MAX_CERTIFICATIONS")


def test_clean_experience_keeps_title_and_company():
    out = rp.clean_experience([{"title": "  Engineer ", "company": " Acme "}], 8)
    assert out == [{"title": "Engineer", "company": "Acme"}]


def test_clean_experience_drops_entries_with_neither_title_nor_company():
    value = [{}, {"title": "", "company": None}, {"title": "   "}, {"title": "N/A", "company": "null"}, {"title": "Dev"}]
    assert rp.clean_experience(value, 8) == [{"title": "Dev", "company": None}]


def test_clean_experience_keeps_an_entry_with_only_a_company():
    assert rp.clean_experience([{"company": "Acme"}], 8) == [{"title": None, "company": "Acme"}]


def test_clean_experience_dedupes_ignoring_case_and_ignores_extra_keys():
    value = [
        {"title": "Engineer", "company": "Acme", "years": 3},
        {"title": "engineer", "company": "ACME"},
        {"title": "Engineer", "company": "Beta"},
    ]
    assert rp.clean_experience(value, 8) == [
        {"title": "Engineer", "company": "Acme"},
        {"title": "Engineer", "company": "Beta"},
    ]


def test_clean_experience_caps_and_keeps_the_order():
    value = [{"title": f"Role {i}", "company": f"Co {i}"} for i in range(20)]
    out = rp.clean_experience(value, 8)
    assert len(out) == 8
    assert [e["title"] for e in out] == [f"Role {i}" for i in range(8)]


@pytest.mark.parametrize("value", [None, "Engineer at Acme", 4, {"title": "x"}, ["Engineer", 3, None]])
def test_clean_experience_returns_empty_for_wrong_types(value):
    assert rp.clean_experience(value, 8) == []


def test_clean_experience_truncates_long_values():
    out = rp.clean_experience([{"title": "t" * 400, "company": "c" * 400}], 8)
    assert len(out[0]["title"]) == rp.ITEM_LIMIT and len(out[0]["company"]) == rp.ITEM_LIMIT


def test_clean_profile_returns_exactly_the_four_keys_with_safe_defaults():
    assert rp.clean_profile({}) == {
        "headline": None, "location": None, "experience": [],
    }
    assert list(rp.clean_profile(None)) == list(rp.PROFILE_KEYS)
    assert list(rp.PROFILE_KEYS) == ["headline", "location", "experience"]


def test_clean_profile_cleans_every_field():
    out = rp.clean_profile({
        "headline": " Data Scientist ", "location": "Lahore, Pakistan", "notice_period": "30 days",
        "certifications": ["AWS", "PMP"], "experience": [{"title": "DS", "company": "Acme"}],
        "classification_noise": "ignored",
    })
    assert out == {
        "headline": "Data Scientist", "location": "Lahore, Pakistan",
        "experience": [{"title": "DS", "company": "Acme"}],
    }


def test_clean_profile_applies_the_documented_caps():
    out = rp.clean_profile({
        "experience": [{"title": f"t{i}", "company": f"c{i}"} for i in range(40)],
        "headline": "h" * 900,
        "location": "l" * 900,
    })
    assert len(out["experience"]) == 8
    assert len(out["headline"]) == rp.HEADLINE_LIMIT
    assert len(out["location"]) == rp.LOCATION_LIMIT


def test_has_profile_data():
    assert not rp.has_profile_data(rp.clean_profile({}))
    assert not rp.has_profile_data(None)
    assert rp.has_profile_data({"headline": "Engineer"})
    assert not rp.has_profile_data({"certifications": ["PMP"]})
    assert rp.has_profile_data({"experience": [{"title": "a", "company": None}]})


@pytest.mark.parametrize("headline,expected", [
    ("Software Engineer", "Software Developer"),
    ("Senior Software Engineer", "Software Developer"),
    ("Sr. Python Developer", "Software Developer"),
    ("Jr. Java Developer", "Software Developer"),
    (".NET Developer", "Software Developer"),
    ("C# Developer", "Software Developer"),
    ("Software Engineering Intern", "Software Developer"),
    ("Full Stack Developer", "Full Stack Developer"),
    ("Full-Stack Engineer", "Full Stack Developer"),
    ("MERN Stack Developer", "Full Stack Developer"),
    ("Frontend & Backend Developer", "Full Stack Developer"),
    ("Front-end Developer", "Frontend Developer"),
    ("React Developer", "Frontend Developer"),
    ("Angular Developer", "Frontend Developer"),
    ("UI Developer", "Frontend Developer"),
    ("Backend Engineer", "Backend Developer"),
    ("Staff Backend Engineer", "Backend Developer"),
    ("Node.js Developer", "Backend Developer"),
    ("Spring Boot Developer", "Backend Developer"),
    ("Django Developer", "Backend Developer"),
    ("Web Developer", "Web Developer"),
    ("WordPress Developer", "Web Developer"),
    ("iOS Developer", "Mobile Developer"),
    ("Android Engineer", "Mobile Developer"),
    ("React Native Developer", "Mobile Developer"),
    ("Mobile Application Developer", "Mobile Developer"),
    ("DevOps Engineer", "DevOps Engineer"),
    ("Site Reliability Engineer", "DevOps Engineer"),
    ("Platform Engineer", "DevOps Engineer"),
    ("Cloud Engineer", "Cloud Engineer"),
    ("AWS Cloud Architect", "Cloud Engineer"),
    ("Data Scientist", "Data Scientist"),
    ("Lead Data Scientist", "Data Scientist"),
    ("Data Science Intern", "Data Scientist"),
    ("Data Engineer", "Data Engineer"),
    ("Big Data Engineer", "Data Engineer"),
    ("Data Analyst", "Data Analyst"),
    ("Business Intelligence Developer", "Data Analyst"),
    ("Power BI Developer", "Data Analyst"),
    ("Machine Learning Engineer", "Machine Learning Engineer"),
    ("Principal Machine Learning Engineer", "Machine Learning Engineer"),
    ("AI/ML Engineer", "Machine Learning Engineer"),
    ("AI Engineer", "Machine Learning Engineer"),
    ("MLOps Engineer", "Machine Learning Engineer"),
    ("NLP Engineer", "Machine Learning Engineer"),
    ("QA Engineer", "QA Engineer"),
    ("QA Lead", "QA Engineer"),
    ("SDET", "QA Engineer"),
    ("Software Tester", "QA Engineer"),
    ("Test Automation Engineer", "QA Engineer"),
    ("Quality Assurance Engineer", "QA Engineer"),
    ("Security Engineer", "Security Engineer"),
    ("Cyber Security Analyst", "Security Engineer"),
    ("Network Engineer", "Network Engineer"),
    ("System Administrator", "System Administrator"),
    ("Help Desk Technician", "IT Support Specialist"),
    ("Database Administrator", "Database Administrator"),
    ("Engineering Manager", "Engineering Manager"),
    ("Product Manager", "Product Manager"),
    ("Associate Product Manager", "Product Manager"),
    ("Technical Product Manager", "Product Manager"),
    ("Product Owner", "Product Manager"),
    ("Project Manager", "Project Manager"),
    ("IT Project Manager", "Project Manager"),
    ("Delivery Manager", "Project Manager"),
    ("Business Analyst", "Business Analyst"),
    ("Senior Business Analyst", "Business Analyst"),
    ("UI/UX Designer", "UI/UX Designer"),
    ("UX Designer", "UI/UX Designer"),
    ("Product Designer", "UI/UX Designer"),
    ("Graphic Designer", "Graphic Designer"),
    ("Content Writer", "Content Writer"),
    ("Marketing Manager", "Marketing Manager"),
    ("Digital Marketing Manager", "Marketing Manager"),
    ("Product Marketing Manager", "Marketing Manager"),
    ("Digital Marketer", "Digital Marketer"),
    ("SEO Specialist", "Digital Marketer"),
    ("Social Media Manager", "Digital Marketer"),
    ("Sales Executive", "Sales Executive"),
    ("Sales Associate", "Sales Executive"),
    ("Account Executive", "Sales Executive"),
    ("Business Development Executive", "Sales Executive"),
    ("Sales Manager", "Sales Manager"),
    ("Account Manager", "Account Manager"),
    ("Key Account Manager", "Account Manager"),
    ("Recruiter", "Recruiter"),
    ("Technical Recruiter", "Recruiter"),
    ("Talent Acquisition Specialist", "Recruiter"),
    ("HR Manager", "HR Manager"),
    ("Human Resources Manager", "HR Manager"),
    ("HR Business Partner", "HR Manager"),
    ("Accountant", "Accountant"),
    ("Chartered Accountant", "Accountant"),
    ("Accounts Payable Specialist", "Accountant"),
    ("Financial Analyst", "Financial Analyst"),
    ("Finance Manager", "Finance Manager"),
    ("Customer Support Executive", "Customer Support Specialist"),
    ("Customer Service Representative", "Customer Support Specialist"),
    ("Technical Support Engineer", "Customer Support Specialist"),
    ("Customer Support Associate", "Customer Support Specialist"),
    ("Operations Manager", "Operations Manager"),
    ("Business Operations Manager", "Operations Manager"),
    ("Legal Counsel", "Legal Counsel"),
    ("Corporate Lawyer", "Legal Counsel"),
])
def test_role_rules(headline, expected):
    assert rp.derive_role(headline, [], None) == expected


def test_every_role_in_the_table_is_reachable_and_the_required_ones_exist():
    required = {
        "Software Developer", "Full Stack Developer", "Frontend Developer", "Backend Developer", "Mobile Developer",
        "DevOps Engineer", "Data Scientist", "Data Engineer", "Machine Learning Engineer", "QA Engineer",
        "Product Manager", "Project Manager", "Business Analyst", "UI/UX Designer", "Graphic Designer",
        "Digital Marketer", "Marketing Manager", "Sales Executive", "Account Manager", "Recruiter", "HR Manager",
        "Accountant", "Financial Analyst", "Customer Support Specialist", "Operations Manager", "Legal Counsel",
    }
    assert required <= set(rp.ROLE_NAMES)
    assert len(rp.ROLE_NAMES) == len(set(rp.ROLE_NAMES))


@pytest.mark.parametrize("headline,expected", [
    ("SENIOR SOFTWARE ENGINEER", "Software Developer"),
    ("software engineer", "Software Developer"),
    ("Software Engineer II", "Software Developer"),
    ("Software Engineer III", "Software Developer"),
    ("Software Engineer at Google", "Software Developer"),
    ("Software Engineer @ Google", "Software Developer"),
    ("Software Engineer - Payments Team", "Software Developer"),
    ("Software Engineer | Python | AWS", "Software Developer"),
    ("Software Engineer (Backend)", "Software Developer"),
    ("Software Engineer, Machine Learning", "Software Developer"),
    ("Mid-Level Software Engineer", "Software Developer"),
    ("Entry Level Software Engineer", "Software Developer"),
    ("Principal Software Engineer", "Software Developer"),
    ("Staff Software Engineer", "Software Developer"),
    ("Lead Software Engineer", "Software Developer"),
    ("Trainee Software Engineer", "Software Developer"),
    ("Associate Software Engineer", "Software Developer"),
    ("Junior Data Analyst", "Data Analyst"),
    ("Senior Sales Executive", "Sales Executive"),
])
def test_role_strips_level_words_and_employer_noise(headline, expected):
    assert rp.derive_role(headline, [], None) == expected


@pytest.mark.parametrize("headline,expected", [
    ("Head of Marketing", "Marketing Manager"),
    ("Head of Sales", "Sales Manager"),
    ("Head of Engineering", "Engineering Manager"),
    ("Head of Product", "Product Manager"),
    ("Head of Product Management", "Product Manager"),
    ("Head of HR", "HR Manager"),
    ("Head of Finance", "Finance Manager"),
    ("Head of Operations", "Operations Manager"),
    ("VP of Sales", "Sales Manager"),
])
def test_role_head_of_means_manager_of_that_function(headline, expected):
    assert rp.derive_role(headline, [], None) == expected


@pytest.mark.parametrize("headline,expected", [
    ("Software Engineer / Data Scientist", None),
    ("Marketing and Sales Manager", "Marketing and Sales Manager"),
    ("Java and Python Developer", "Java and Python Developer"),
    ("Backend & DevOps Engineer", None),
    ("Data Scientist and Machine Learning Engineer", None),
    ("Research and Development Engineer", "Research and Development Engineer"),
])
def test_role_ambiguous_titles_are_not_guessed(headline, expected):
    assert rp.derive_role(headline, [], None) == expected


def test_role_ambiguous_titles_fall_back_to_the_family_label():
    assert rp.derive_role("Software Engineer / Data Scientist", [], "software_engineering") == "Software Engineering"
    assert rp.derive_role("Backend & DevOps Engineer", [], "devops") == "DevOps"


def test_role_a_title_plus_a_leadership_word_is_not_ambiguous():
    assert rp.derive_role("Software Engineer and Team Lead", [], None) == "Software Developer"
    assert rp.derive_role("Frontend and Backend Developer", [], None) == "Full Stack Developer"


@pytest.mark.parametrize("headline,expected", [
    ("Mechanical Engineer", "Mechanical Engineer"),
    ("Civil Engineer", "Civil Engineer"),
    ("Teacher", "Teacher"),
    ("Staff Nurse", "Nurse"),
    ("Embedded Systems Engineer", "Embedded Systems Engineer"),
    ("Customer Success Manager", "Customer Success Manager"),
    ("Customer Support Manager", "Customer Support Manager"),
    ("Talent Acquisition Manager", "Talent Acquisition Manager"),
    ("Business Development Manager", "Business Development Manager"),
    ("Marketing Executive", "Marketing Executive"),
    ("Paralegal", "Paralegal"),
    ("Quality Assurance Officer", "Quality Assurance Officer"),
    ("Program Manager", "Program Manager"),
    ("Scrum Master", "Scrum Master"),
    ("HR Generalist", "HR Generalist"),
    ("UX Researcher", "UX Researcher"),
    ("Research Scientist", "Research Scientist"),
    ("Director of Engineering", "Director of Engineering"),
    ("Head of Data", "Head of Data"),
    ("AWS Solutions Architect", "AWS Solutions Architect"),
    ("Lead Generation Specialist", "Lead Generation Specialist"),
    ("Product Design Engineer", "Product Design Engineer"),
    ("Design Lead", "Design"),
    ("Marketing Intern", "Marketing"),
])
def test_role_unmatched_titles_keep_their_own_words(headline, expected):
    assert rp.derive_role(headline, [], "software_engineering") == expected


@pytest.mark.parametrize("headline", [
    "Open to work",
    "Passionate software professional seeking new challenges",
    "Manager",
    "Intern",
    "Senior",
    "Team Lead",
    "Tech Lead",
    "Plant Operator/Technician",
    "Sales + Support Hybrid Wizard Extraordinaire",
    "Data Entry Operator 2.0",
    "Ninja!!!",
    "C++ Guru",
    "",
    "   ",
    "None",
    "N/A",
])
def test_role_unusable_headlines_fall_back_to_the_family(headline):
    assert rp.derive_role(headline, [], "finance") == "Finance"
    assert rp.derive_role(headline, [], None) is None


def test_role_the_first_experience_title_is_used_when_the_headline_is_empty():
    experience = [{"title": "Senior Data Engineer", "company": "Acme"}, {"title": "Accountant", "company": "Beta"}]
    assert rp.derive_role(None, experience, "software_engineering") == "Data Engineer"
    assert rp.derive_role("", experience, None) == "Data Engineer"
    assert rp.derive_role("Intern", experience, None) == "Data Engineer"


def test_role_skips_experience_entries_without_a_title():
    experience = [{"title": None, "company": "Acme"}, {"title": "QA Lead", "company": "Beta"}]
    assert rp.derive_role(None, experience, None) == "QA Engineer"


def test_role_the_headline_wins_over_experience_when_it_is_usable():
    experience = [{"title": "Accountant", "company": "Acme"}]
    assert rp.derive_role("Product Manager", experience, None) == "Product Manager"
    assert rp.derive_role("Mechanical Engineer", experience, None) == "Mechanical Engineer"


def test_role_experience_titles_are_ignored_when_the_headline_has_content_that_cannot_be_titled():
    experience = [{"title": "Accountant", "company": "Acme"}]
    assert rp.derive_role("Open to work", experience, "finance") == "Finance"


def test_role_handles_wrong_types_without_raising():
    assert rp.derive_role(5, "not a list", 7) is None
    assert rp.derive_role(None, [None, 3, "x", {"title": 9}], {"a": 1}) is None
    assert rp.derive_role(["Engineer"], [{"title": ["x"]}], None) is None


def test_role_unknown_job_domain_gives_none():
    assert rp.derive_role(None, [], "underwater_basketry") is None
    assert rp.derive_role(None, [], "") is None
    assert rp.derive_role(None, [], None) is None


@pytest.mark.parametrize("family", sorted(JOB_FAMILY_LABELS))
def test_role_known_job_domains_use_the_taxonomy_label(family):
    assert rp.derive_role(None, [], family) == JOB_FAMILY_LABELS[family]


def test_role_title_case_keeps_acronyms_and_small_words():
    assert rp.derive_role("SAP Basis Administrator", [], None) == "SAP Basis Administrator"
    assert rp.derive_role("hr operations coordinator", [], None) == "HR Operations Coordinator"
    assert rp.derive_role("head of marketing operations", [], None) == "Head of Marketing Operations"
    assert rp.derive_role("Vice President of Strategy", [], None) == "Vice President of Strategy"
    assert rp.derive_role("manager of people operations", [], None) == "Manager of People Operations"
    assert rp.derive_role("Sales Operations Manager", [], None) == "Sales Operations Manager"
    assert rp.derive_role("IT Operations Manager", [], None) == "IT Operations Manager"


def test_role_result_never_has_symbols_or_more_than_four_words_unless_it_is_a_table_role():
    for headline in ["Senior Staff Principal Lead Architect of Everything Cloud", "R&D Engineer", "Engineer (Civil)"]:
        role = rp.derive_role(headline, [], None)
        assert role is None or role in rp.ROLE_NAMES or (len(role.split()) <= 4 and role.replace(" ", "").isalpha())


def test_split_profile_separates_the_two_groups():
    result = {
        "job_domain": "devops", "seniority_level": "senior", "skills": ["k8s"], "confidence": 0.9,
        "years_experience": 8, "education_level": "bachelor", "industry": "technology",
        "headline": "SRE", "location": "Berlin", "notice_period": "30 days", "certifications": ["CKA"],
        "experience": [{"title": "SRE", "company": "Acme"}],
    }
    classification, profile = rp.split_profile(result)
    assert list(classification) == list(rp.CLASSIFICATION_KEYS)
    assert list(profile) == list(rp.PROFILE_KEYS)
    assert classification["job_domain"] == "devops" and classification["skills"] == ["k8s"]
    assert profile["experience"] == [{"title": "SRE", "company": "Acme"}]
    assert "certifications" not in profile and "certifications" not in classification
    assert "notice_period" not in profile and "notice_period" not in classification


def test_split_profile_keeps_only_the_classification_keys_that_exist():
    classification, profile = rp.split_profile({"job_domain": "hr", "skills": ["x"], "surprise": 1, "department": "No"})
    assert classification == {"job_domain": "hr", "skills": ["x"]}
    assert profile == rp.clean_profile({})


@pytest.mark.parametrize("value", [None, [], "text", 5, ()])
def test_split_profile_tolerates_non_dicts(value):
    assert rp.split_profile(value) == ({}, rp.clean_profile({}))


def test_split_profile_cleans_the_new_keys_and_does_not_mutate_the_input():
    result = {"job_domain": "hr", "headline": "  HR Lead ", "experience": [{"title": "HR", "company": "HR"}, {"title": "hr", "company": "hr"}]}
    before = dict(result)
    classification, profile = rp.split_profile(result)
    assert result == before
    assert profile["headline"] == "HR Lead" and profile["experience"] == [{"title": "HR", "company": "HR"}]
    assert "headline" not in classification


def test_profile_fields_has_exactly_the_stored_document_fields():
    fields = rp.profile_fields(
        {"headline": "Senior Data Engineer", "location": "Pune", "notice_period": "2 months",
         "certifications": ["GCP"], "experience": [{"title": "DE", "company": "Acme"}]},
        "data_engineering",
    )
    assert list(fields) == [
        "headline", "location", "experience",
        "department", "profile_version",
    ]
    assert fields["department"] == "Data Engineer"
    assert fields["profile_version"] == rp.PROFILE_VERSION == 1


def test_profile_fields_defaults_when_nothing_was_extracted():
    fields = rp.profile_fields({}, "marketing")
    assert fields == {
        "headline": None, "location": None, "experience": [],
        "department": "Marketing", "profile_version": 1,
    }
    assert rp.profile_fields(None, None)["department"] is None


def test_the_module_has_no_comments_docstrings_or_em_dashes():
    import inspect

    source = inspect.getsource(rp)
    assert chr(0x2014) not in source
    assert chr(34) * 3 not in source
    assert not any(line.lstrip().startswith("#") for line in source.splitlines())
