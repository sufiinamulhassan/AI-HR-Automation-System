import re
from types import SimpleNamespace

import pytest

from config.tenancy import company_context, db_for_company
from fake_mongo import FakeCollection, FakeRaw, matches
from services.hr_module import resume_search as rs
from services.hr_module import resume_taxonomy as taxonomy

pytestmark = pytest.mark.anyio

ADA = {
    "resume_id": "ada", "candidate_name": "Ada Lovelace", "candidate_email": "ada@acme.io",
    "filename": "ada_cv.pdf", "processing_status": "processed", "salary_expectation": 120000,
    "headline": "Senior Python Engineer", "location": "Berlin, Germany",
    "notice_period": "30 days (negotiable)",
    "certifications": ["AWS Certified Developer (SAA-C03)", "PMP"],
    "experience": [
        {"title": "Backend Engineer", "company": "Google"},
        {"title": "Developer", "company": "A+B Corp"},
    ],
    "department": "Backend Engineer",
    "classification": {
        "job_domain": "software_engineering", "seniority_level": "senior",
        "skills": ["Python", "Java", "Spring Boot", "C++"], "years_experience": 9,
        "education_level": "master", "industry": "fintech",
    },
    "matched_jds": [{"job_id": "j1", "score": 0.9}, {"job_id": "j2", "score": 0.4}],
}
BOB = {
    "resume_id": "bob", "candidate_name": "Bob Stone", "candidate_email": "bob@web.dev",
    "filename": "bob_stone.docx", "processing_status": "failed", "salary_expectation": 70000,
    "headline": "Frontend Developer", "location": "London", "notice_period": "15 days",
    "certifications": ["pmp"],
    "experience": [{"title": "Frontend Developer", "company": "Mongo Labs"}],
    "department": "frontend developer",
    "classification": {
        "job_domain": "devops", "seniority_level": "mid",
        "skills": ["JavaScript", "NoSQL", "MongoDB", "Google Cloud"], "years_experience": 4,
        "education_level": "bachelor", "industry": "healthcare",
    },
    "matched_jds": [{"job_id": "j1", "score": 0.3}],
}
CY = {
    "resume_id": "cy", "candidate_name": "Cy Young", "candidate_email": "cy@growth.co",
    "filename": "cy_young.pdf", "processing_status": "processed", "salary_expectation": 30000,
    "headline": "Growth Marketer", "location": "Paris", "notice_period": "Immediate",
    "certifications": [], "experience": [{"title": "Marketer", "company": "Acme"}],
    "department": "Growth",
    "classification": {
        "job_domain": "marketing", "seniority_level": "junior", "skills": ["SEO", "SQL"],
        "years_experience": 2, "education_level": "high_school", "industry": "fintech",
    },
    "matched_jds": [],
}
DEE = {
    "resume_id": "dee", "candidate_name": "Dee Park", "candidate_email": "dee@lab.ai",
    "filename": "dee_park.pdf", "processing_status": "processed", "salary_expectation": None,
    "headline": "Machine Learning Lead", "location": "Berlin", "notice_period": "60 days",
    "certifications": ["Google ML Engineer"],
    "experience": [{"title": "ML Lead", "company": "Lab"}],
    "department": "Data Scientist",
    "classification": {
        "job_domain": "machine_learning", "seniority_level": "lead",
        "skills": ["Machine Learning", "Python", "C", "Go"], "years_experience": 12,
        "education_level": "phd", "industry": "technology",
    },
    "matched_jds": [],
}
EVE = {
    "resume_id": "eve", "candidate_name": "Eve Hart", "candidate_email": "eve@x.org",
    "filename": "eve.pdf", "processing_status": "processed", "salary_expectation": 90000,
    "classification": {
        "job_domain": "astrology", "seniority_level": "senior", "skills": [],
        "years_experience": 0, "education_level": "other", "industry": "other",
    },
}
FLO = {
    "resume_id": "flo", "candidate_name": "Flo Reed", "filename": "flo.pdf",
    "processing_status": "processed",
    "classification": {
        "job_domain": "marketing", "seniority_level": "mid", "skills": ["SEO"], "years_experience": 6,
    },
}
OLD = {
    "resume_id": "old", "candidate_name": "Old Timer", "filename": "old.pdf",
    "processing_status": "processed",
}
CORPUS = [ADA, BOB, CY, DEE, EVE, FLO, OLD]
EVERYONE = sorted(doc["resume_id"] for doc in CORPUS)


@pytest.fixture(autouse=True)
def fresh_pool_cache():
    rs.reset_skill_pool_cache()
    yield
    rs.reset_skill_pool_cache()


def found(filters, known=()):
    query = rs.build_resume_query(filters, known)
    return sorted(doc["resume_id"] for doc in CORPUS if matches(doc, query))


def patterns(node):
    if isinstance(node, dict):
        for key, value in node.items():
            if key == "$regex":
                yield value
            else:
                yield from patterns(value)
    elif isinstance(node, list):
        for item in node:
            yield from patterns(item)


class TestParseSearch:

    def test_a_known_skill_is_a_skill_and_the_rest_are_words(self):
        parsed = rs.parse_search("Python developer", ["Python"])
        assert parsed == rs.ParsedSearch(("python",), ("developer",))

    def test_commas_separate_terms(self):
        assert rs.parse_search("python, java", ["python", "java"]) == rs.ParsedSearch(("python", "java"), ())
        assert rs.parse_search("john smith, python", ["python"]) == rs.ParsedSearch(("python",), ("john", "smith"))

    def test_the_longest_run_of_words_that_is_a_skill_wins(self):
        known = ["spring", "boot", "spring boot", "machine learning", "machine"]
        assert rs.parse_search("spring boot", known) == rs.ParsedSearch(("spring boot",), ())
        assert rs.parse_search("senior machine learning engineer", known) == rs.ParsedSearch(
            ("machine learning",), ("senior", "engineer"),
        )

    def test_a_shorter_known_skill_leaves_the_rest_as_words(self):
        assert rs.parse_search("spring boot", ["spring"]) == rs.ParsedSearch(("spring",), ("boot",))

    def test_a_skill_nobody_has_reads_as_a_word(self):
        assert rs.parse_search("python", []) == rs.ParsedSearch((), ("python",))

    def test_symbolic_skills_are_known_without_any_pool(self):
        parsed = rs.parse_search("C++ c# .NET Node.js")
        assert parsed.skills == ("c++", "c#", ".net", "node.js")
        assert parsed.words == ()

    def test_skill_matching_ignores_case_and_spacing(self):
        assert rs.parse_search("  PYTHON   Spring   BOOT ", ["python", "Spring Boot"]) == rs.ParsedSearch(
            ("python", "spring boot"), (),
        )

    def test_repeats_collapse(self):
        assert rs.parse_search("Python python PYTHON dev DEV", ["python"]) == rs.ParsedSearch(("python",), ("dev",))

    def test_at_most_twelve_skills_and_words_are_kept(self):
        words = " ".join(f"w{i}" for i in range(30))
        skills = ", ".join(f"s{i}" for i in range(30))
        assert len(rs.parse_search(words).words) == 12
        assert len(rs.parse_search(skills, [f"s{i}" for i in range(30)]).skills) == 12

    @pytest.mark.parametrize("text", [
        "(", "[", "*", "\\", "))", "((", "{", "}", "a|b", "(?", "$", "^", "?", "|", "+++", "'", '"', ",,,", " , ",
        "", "   ", None, 5, ["python"], {"a": 1}, "\x00", "\n\t",
    ])
    def test_odd_input_never_raises_and_yields_nothing_searchable(self, text):
        parsed = rs.parse_search(text, ["python"])
        assert isinstance(parsed, rs.ParsedSearch)
        if not isinstance(text, str) or not any(ch.isalnum() for ch in text):
            assert parsed.is_empty()

    @pytest.mark.parametrize("text, skills, words", [
        ("(python)", ("python",), ()),
        ("[c++]", ("c++",), ()),
        ("*python*", ("python",), ()),
        ("\"python\", 'java'", ("python", "java"), ()),
        ("node.js.", ("node.js",), ()),
        ("(c++),", ("c++",), ()),
        (".net", (".net",), ()),
        ("c++ & python", ("c++", "python"), ()),
        ("hello!", (), ("hello",)),
    ])
    def test_edge_punctuation_is_stripped_but_symbols_inside_a_skill_survive(self, text, skills, words):
        assert rs.parse_search(text, ["python", "java"]) == rs.ParsedSearch(skills, words)

    def test_punctuation_alone_is_dropped(self):
        assert rs.parse_search("( ) [ ] * \\ & - +").is_empty()

    def test_skill_filter_splits_on_commas_and_dedupes(self):
        assert rs.parse_skill_filter("Python, python , Go,,  ") == ("python", "go")
        assert rs.parse_skill_filter("") == ()
        assert rs.parse_skill_filter(None) == ()
        assert rs.parse_skill_filter(7) == ()
        assert rs.parse_skill_filter("(") == ("(",)

    def test_filters_merge_the_skill_param_into_the_searched_skills(self):
        parsed = rs.parse_filters({"search": "python lead", "skill": "go, python"}, ["python"])
        assert parsed == rs.ParsedSearch(("python", "go"), ("lead",))
        assert rs.parse_filters(None).is_empty()
        assert rs.parse_filters({"skill": " "}).is_empty()


class TestWordSafeSkillMatching:

    @staticmethod
    def has(skills, wanted):
        return matches({"classification": {"skills": skills}}, rs.skill_clause(wanted))

    def test_java_is_not_javascript(self):
        assert self.has(["Java"], "java")
        assert self.has(["java"], "java")
        assert self.has([" Java "], "java")
        assert not self.has(["JavaScript"], "java")
        assert not self.has(["Javascript", "Java EE"], "java")

    def test_sql_is_not_nosql(self):
        assert self.has(["SQL"], "sql")
        assert not self.has(["NoSQL"], "sql")
        assert not self.has(["MySQL", "PostgreSQL", "SQL Server"], "sql")

    def test_go_is_not_google_or_mongodb(self):
        assert self.has(["Go"], "go")
        assert not self.has(["Google Cloud"], "go")
        assert not self.has(["MongoDB"], "go")
        assert not self.has(["Golang"], "go")

    def test_c_is_not_c_plus_plus_or_c_sharp(self):
        assert self.has(["C"], "c")
        assert not self.has(["C++", "C#", "CSS"], "c")

    def test_c_plus_plus_works_and_is_regex_escaped(self):
        assert self.has(["C++"], "c++")
        assert self.has(["c++"], "C++")
        assert not self.has(["C"], "c++")
        assert not self.has(["CC"], "c++")
        assert "\\+\\+" in rs.skill_clause("c++")["classification.skills"]["$regex"]

    def test_dot_net_is_not_asp_dot_net(self):
        assert self.has([".NET"], ".net")
        assert not self.has(["ASP.NET"], ".net")
        assert not self.has(["NET"], ".net")

    def test_a_multi_word_skill_needs_the_whole_entry(self):
        assert self.has(["Spring Boot"], "spring boot")
        assert not self.has(["Spring"], "spring boot")
        assert not self.has(["Spring Boot Admin"], "spring boot")

    def test_a_missing_or_malformed_skill_list_never_matches_and_never_raises(self):
        clause = rs.skill_clause("python")
        for doc in ({}, {"classification": None}, {"classification": {}}, {"classification": {"skills": None}},
                    {"classification": {"skills": "Python2"}}, {"classification": {"skills": [None, 3]}}):
            assert not matches(doc, clause)


class TestPlainWordMatching:

    @staticmethod
    def hit(doc, word):
        return matches(doc, rs.word_clause(word))

    def test_a_word_matches_the_start_of_a_word_in_name_email_and_filename(self):
        doc = {"candidate_name": "Ada Lovelace", "candidate_email": "ada.l@acme.io", "filename": "ada_lovelace_cv.pdf"}
        for word in ("ada", "ADA", "lov", "love", "acme", "cv"):
            assert self.hit(doc, word), word
        for word in ("ace", "ovelace", "xyz"):
            assert not self.hit(doc, word), word

    def test_a_half_typed_name_finds_the_person_but_the_middle_of_a_word_does_not(self):
        assert self.hit({"candidate_name": "Jonathan Smith"}, "jon")
        assert self.hit({"candidate_name": "Jonathan Smith"}, "smi")
        assert not self.hit({"candidate_name": "Jonathan Smith"}, "than")

    @pytest.mark.parametrize("field, value, word", [
        ("headline", "Senior Python Engineer", "eng"),
        ("location", "Berlin, Germany", "germ"),
        ("department", "Backend Engineer", "back"),
        ("candidate_email", "dee@lab.ai", "lab"),
    ])
    def test_each_searched_field_is_covered(self, field, value, word):
        assert self.hit({field: value}, word)

    def test_experience_titles_and_companies_are_searched(self):
        doc = {"experience": [{"title": "Staff Developer", "company": "Initech"}, {"title": "Intern", "company": "Hooli"}]}
        assert self.hit(doc, "dev")
        assert self.hit(doc, "init")
        assert self.hit(doc, "hoo")
        assert not self.hit(doc, "evelop")

    def test_a_word_also_matches_as_a_whole_word_inside_a_skill(self):
        doc = {"classification": {"skills": ["Spring Boot", "Machine Learning"]}}
        assert self.hit(doc, "boot")
        assert self.hit(doc, "learning")
        assert not self.hit(doc, "boo")
        assert not self.hit(doc, "earning")

    def test_a_word_is_not_found_inside_nosql_or_mongodb(self):
        assert not self.hit({"classification": {"skills": ["NoSQL"]}}, "sql")
        assert not self.hit({"classification": {"skills": ["MongoDB"]}}, "go")
        assert self.hit({"classification": {"skills": ["Go"]}}, "go")

    def test_a_word_made_of_regex_characters_is_literal_and_never_raises(self):
        doc = {"candidate_name": "A+B (Test) [x]"}
        assert self.hit(doc, "a+b")
        assert self.hit(doc, "(test)")
        assert not self.hit({"candidate_name": "aab"}, "a+b")
        for word in ("(", "[", "*", "\\", "a|b", ".*", "?", "$", "^"):
            self.hit(doc, word)
            re.compile(rs.word_clause(word)["$or"][0]["candidate_name"]["$regex"])

    def test_missing_fields_do_not_match(self):
        assert not self.hit({}, "ada")
        assert not self.hit({"experience": None, "classification": None, "headline": 7}, "ada")


class TestBuildResumeQuery:

    def test_no_filters_means_no_conditions(self):
        assert rs.build_resume_query({}) == {}
        assert rs.build_resume_query(None) == {}
        assert rs.build_resume_query([]) == {}
        assert rs.build_resume_query({"nonsense": "x"}) == {}
        assert found({}) == EVERYONE

    def test_simple_filters_become_plain_field_conditions(self):
        query = rs.build_resume_query({"status": "processed", "seniority": " senior "})
        assert query == {"processing_status": "processed", "classification.seniority_level": "senior"}
        assert rs.build_resume_query({"experience_min": 3, "experience_max": 9}) == {
            "classification.years_experience": {"$gte": 3, "$lte": 9},
        }
        assert rs.build_resume_query({"salary_expectation_min": 1}) == {"salary_expectation": {"$gte": 1}}
        assert rs.build_resume_query({"salary_expectation_max": 5}) == {"salary_expectation": {"$lte": 5}}

    def test_a_search_adds_one_required_clause_per_skill_and_word(self):
        query = rs.build_resume_query({"search": "java developer berlin"}, ["java"])
        assert list(query) == ["$and"]
        assert len(query["$and"]) == 3
        assert query["$and"][0] == rs.skill_clause("java")

    def test_an_already_parsed_search_is_used_as_is(self):
        parsed = rs.ParsedSearch(("go",), ("lead",))
        query = rs.build_resume_query({"search": "something else entirely"}, ["python"], parsed)
        assert query == {"$and": [rs.skill_clause("go"), rs.word_clause("lead")]}

    def test_the_same_skill_from_search_and_skill_param_is_required_once(self):
        query = rs.build_resume_query({"search": "python", "skill": "Python"}, ["python"])
        assert query == {"$and": [rs.skill_clause("python")]}

    def test_two_conditions_on_one_field_are_both_kept(self):
        query = rs.build_resume_query({"domain": "devops", "business_domain": "it_software"})
        assert query["classification.job_domain"] == "devops"
        assert {"classification.job_domain": {"$in": list(taxonomy.families_for_domain("it_software"))}} in query["$and"]

    def test_user_text_is_escaped(self):
        query = rs.build_resume_query({"certification": "(SAA", "location": "a+b", "worked_at_company": "x.y"})
        assert query["certifications"]["$regex"] == r"\(SAA"
        assert query["location"]["$regex"] == r"a\+b"
        assert query["experience.company"]["$regex"] == r"x\.y"
        assert all(v["$options"] == "i" for v in (query["certifications"], query["location"]))

    def test_other_means_a_family_in_no_domain(self):
        condition = rs.build_resume_query({"business_domain": "other"})["classification.job_domain"]
        assert set(condition) == {"$nin"}
        assert len(condition["$nin"]) == len(taxonomy.known_families())
        assert set(condition["$nin"]) == set(taxonomy.known_families())

    def test_availability_is_not_a_filter(self):
        assert rs.build_resume_query({"availability_status": "immediate"}) == {}
        assert "availability_status" not in rs.FILTER_KEYS

    def test_an_unknown_business_domain_matches_nothing(self):
        assert rs.build_resume_query({"business_domain": "nonsense"}) == {"classification.job_domain": {"$in": []}}
        assert found({"business_domain": "nonsense"}) == []

    SINGLE = [
        ({"search": "ada"}, ["ada"]),
        ({"search": "lovel"}, ["ada"]),
        ({"search": "park"}, ["dee"]),
        ({"search": "ark"}, []),
        ({"search": "stone"}, ["bob"]),
        ({"search": "acme"}, ["ada", "cy"]),
        ({"search": "berlin"}, ["ada", "dee"]),
        ({"search": "back"}, ["ada"]),
        ({"search": "ml"}, ["dee"]),
        ({"search": "growth"}, ["cy"]),
        ({"search": "spring"}, ["ada"]),
        ({"search": "boo"}, []),
        ({"search": "cloud"}, ["bob"]),
        ({"search": "clo"}, []),
        ({"search": "c++"}, ["ada"]),
        ({"search": ".net"}, []),
        ({"search": "go"}, ["ada", "dee"]),
        ({"search": "machine learning"}, ["dee"]),
        ({"search": "spring boo"}, []),
        ({"skill": "Python"}, ["ada", "dee"]),
        ({"skill": "python,java"}, ["ada"]),
        ({"skill": " python , JAVA "}, ["ada"]),
        ({"skill": "py"}, []),
        ({"skill": "c++"}, ["ada"]),
        ({"skill": "c"}, ["dee"]),
        ({"skill": "go"}, ["dee"]),
        ({"skill": "java"}, ["ada"]),
        ({"skill": "sql"}, ["cy"]),
        ({"skill": "seo"}, ["cy", "flo"]),
        ({"skill": "("}, []),
        ({"skill": ".*"}, []),
        ({"skill": ", ,"}, EVERYONE),
        ({"status": "processed"}, ["ada", "cy", "dee", "eve", "flo", "old"]),
        ({"status": "failed"}, ["bob"]),
        ({"domain": "devops"}, ["bob"]),
        ({"domain": "astrology"}, ["eve"]),
        ({"domain": "software_engineering"}, ["ada"]),
        ({"business_domain": "it_software"}, ["ada", "bob"]),
        ({"business_domain": " IT_Software "}, ["ada", "bob"]),
        ({"business_domain": "data_ai"}, ["dee"]),
        ({"business_domain": "marketing"}, ["cy", "flo"]),
        ({"business_domain": "other"}, ["eve", "old"]),
        ({"business_domain": "sales"}, []),
        ({"seniority": "senior"}, ["ada", "eve"]),
        ({"seniority": "lead"}, ["dee"]),
        ({"seniority": "mid"}, ["bob", "flo"]),
        ({"experience_min": 5}, ["ada", "dee", "flo"]),
        ({"experience_max": 4}, ["bob", "cy", "eve"]),
        ({"experience_min": 3, "experience_max": 9}, ["ada", "bob", "flo"]),
        ({"experience_min": 0}, ["ada", "bob", "cy", "dee", "eve", "flo"]),
        ({"experience_min": 13}, []),
        ({"experience_min": 9, "experience_max": 3}, []),
        ({"department": "backend engineer"}, ["ada"]),
        ({"department": "FRONTEND DEVELOPER"}, ["bob"]),
        ({"department": "Growth"}, ["cy"]),
        ({"department": "Backend"}, []),
        ({"department": "("}, []),
        ({"department": "marketing"}, ["flo"]),
        ({"department": "Software Engineering"}, []),
        ({"department": "Machine Learning"}, []),
        ({"department": "Astrology"}, ["eve"]),
        ({"department": "astrology"}, ["eve"]),
        ({"department": "Not classified"}, ["old"]),
        ({"department": "NOT CLASSIFIED"}, ["old"]),
        ({"department": "Hr"}, []),
        ({"department": "Human Resources"}, []),
        ({"education_level": "master"}, ["ada"]),
        ({"education_level": "phd"}, ["dee"]),
        ({"education_level": "high_school"}, ["cy"]),
        ({"education_level": "bachelor"}, ["bob"]),
        ({"certification": "pmp"}, ["ada", "bob"]),
        ({"certification": "(saa"}, ["ada"]),
        ({"certification": "saa-c03"}, ["ada"]),
        ({"certification": "google"}, ["dee"]),
        ({"certification": ".*"}, []),
        ({"industry": "fintech"}, ["ada", "cy"]),
        ({"industry": "healthcare"}, ["bob"]),
        ({"industry": "other"}, ["eve"]),
        ({"salary_expectation_min": 100000}, ["ada"]),
        ({"salary_expectation_max": 70000}, ["bob", "cy"]),
        ({"salary_expectation_min": 50000, "salary_expectation_max": 100000}, ["bob", "eve"]),
        ({"salary_expectation_min": 0}, ["ada", "bob", "cy", "eve"]),
        ({"worked_at_company": "google"}, ["ada"]),
        ({"worked_at_company": "a+b"}, ["ada"]),
        ({"worked_at_company": "corp"}, ["ada"]),
        ({"worked_at_company": "acme"}, ["cy"]),
        ({"worked_at_company": "mongo"}, ["bob"]),
        ({"worked_at_company": "("}, []),
        ({"location": "berlin"}, ["ada", "dee"]),
        ({"location": "germany"}, ["ada"]),
        ({"location": "("}, []),
        ({"notice_period": "30 days"}, ["ada"]),
        ({"notice_period": "(negotiable)"}, ["ada"]),
        ({"notice_period": "days"}, ["ada", "bob", "dee"]),
        ({"notice_period": "immediate"}, ["cy"]),
        ({"min_match_score": 0.5}, ["ada"]),
        ({"min_match_score": 0.3}, ["ada", "bob"]),
        ({"min_match_score": 0.95}, []),
        ({"min_match_score": 0.5, "job_id": "j2"}, []),
        ({"min_match_score": 0.3, "job_id": "j2"}, ["ada"]),
        ({"min_match_score": 0.3, "job_id": "j1"}, ["ada", "bob"]),
        ({"job_id": "j1"}, EVERYONE),
    ]

    @pytest.mark.parametrize("filters, expected", SINGLE, ids=[str(f) for f, _ in SINGLE])
    def test_each_filter_on_its_own(self, filters, expected):
        assert found(filters) == expected

    SEARCH_WITH_POOL = [
        ({"search": "python"}, ["ada", "dee"]),
        ({"search": "  PYTHON  "}, ["ada", "dee"]),
        ({"search": "java"}, ["ada"]),
        ({"search": "sql"}, ["cy"]),
        ({"search": "go"}, ["dee"]),
        ({"search": "c"}, ["dee"]),
        ({"search": "c++"}, ["ada"]),
        ({"search": "seo"}, ["cy", "flo"]),
        ({"search": "java developer"}, ["ada"]),
        ({"search": "python, berlin"}, ["ada", "dee"]),
        ({"search": "python lead"}, ["dee"]),
        ({"search": "machine learning"}, ["dee"]),
        ({"search": "spring boot"}, ["ada"]),
        ({"search": "spring boo"}, []),
        ({"search": "python", "seniority": "senior"}, ["ada"]),
        ({"search": "python", "skill": "go"}, ["dee"]),
    ]
    POOL = ["python", "java", "sql", "go", "c", "seo", "machine learning", "spring boot"]

    @pytest.mark.parametrize("filters, expected", SEARCH_WITH_POOL, ids=[str(f) for f, _ in SEARCH_WITH_POOL])
    def test_searches_that_use_the_skill_pool(self, filters, expected):
        assert found(filters, self.POOL) == expected

    def test_without_the_pool_a_skill_word_still_finds_people_who_list_it(self):
        assert found({"search": "java"}) == ["ada"]
        assert found({"search": "python"}) == ["ada", "dee"]
        assert found({"search": "mongodb"}) == ["bob"]
        assert found({"search": "sql"}) == ["cy"]

    def test_go_never_matches_mongodb_in_either_mode(self):
        assert "bob" not in found({"search": "go"})
        assert "bob" not in found({"search": "go"}, self.POOL)
        assert "bob" not in found({"skill": "go"})

    def test_filters_combine_with_and(self):
        assert found({"skill": "python", "business_domain": "data_ai", "experience_min": 10}) == ["dee"]
        assert found({"status": "processed", "seniority": "senior", "industry": "fintech"}) == ["ada"]
        assert found({"domain": "devops", "business_domain": "it_software"}) == ["bob"]
        assert found({"domain": "devops", "business_domain": "data_ai"}) == []
        assert found({"search": "berlin", "skill": "python", "education_level": "master"}, ["python"]) == ["ada"]

    def test_every_filter_at_once(self):
        everything = {
            "search": "ada python", "skill": "java", "business_domain": "it_software",
            "domain": "software_engineering", "seniority": "senior", "status": "processed",
            "experience_min": 5, "experience_max": 10, "department": "backend engineer",
            "education_level": "master", "certification": "pmp",
            "industry": "fintech", "salary_expectation_min": 100000, "salary_expectation_max": 130000,
            "worked_at_company": "google", "location": "berlin", "notice_period": "30",
            "min_match_score": 0.5, "job_id": "j1",
        }
        assert set(everything) == set(rs.FILTER_KEYS)
        assert found(everything, ["python", "java"]) == ["ada"]
        assert found({**everything, "industry": "healthcare"}, ["python", "java"]) == []
        assert found({**everything, "min_match_score": 0.95}, ["python", "java"]) == []

    def test_blank_and_invalid_values_are_ignored(self):
        ignored = {
            "search": "", "skill": "  ", "business_domain": "   ", "domain": None, "seniority": "",
            "status": " ", "experience_min": "", "experience_max": "abc", "department": "\t",
            "education_level": None, "certification": "", "industry": None,
            "salary_expectation_min": float("nan"), "salary_expectation_max": float("inf"),
            "worked_at_company": "", "location": " ", "notice_period": None, "min_match_score": True,
            "job_id": "",
        }
        assert rs.build_resume_query(ignored) == {}
        assert found(ignored) == EVERYONE

    def test_values_of_the_wrong_type_are_ignored(self):
        odd = {"status": 5, "domain": ["devops"], "seniority": {"a": 1}, "search": 7, "skill": ["python"],
               "experience_min": [3], "location": 3.5, "min_match_score": "high"}
        assert rs.build_resume_query(odd) == {}

    def test_numbers_may_arrive_as_text(self):
        assert found({"experience_min": "5"}) == ["ada", "dee", "flo"]
        assert found({"experience_min": "5.0", "experience_max": 9.0}) == ["ada", "flo"]
        assert rs.build_resume_query({"min_match_score": "0.5"}) == {
            "matched_jds": {"$elemMatch": {"score": {"$gte": 0.5}}},
        }

    def test_a_min_match_score_of_zero_still_filters(self):
        assert found({"min_match_score": 0}) == ["ada", "bob"]

    ONE_PER_FILTER = {
        "search": "ada", "skill": "python", "business_domain": "it_software", "domain": "devops",
        "seniority": "senior", "status": "processed", "experience_min": 3, "experience_max": 9,
        "department": "x", "education_level": "master", "certification": "pmp",
        "industry": "fintech", "salary_expectation_min": 1,
        "salary_expectation_max": 5, "worked_at_company": "g", "location": "b", "notice_period": "3",
        "min_match_score": 0.5, "job_id": "j1",
    }

    @pytest.mark.parametrize("key", rs.FILTER_KEYS)
    def test_a_filter_never_matches_a_resume_that_lacks_the_field(self, key):
        legacy = {"resume_id": "legacy"}
        query = rs.build_resume_query({key: self.ONE_PER_FILTER[key]}, ["python"])
        expected = key in ("job_id",)
        assert matches(legacy, query) is expected

    @pytest.mark.parametrize("key", rs.FILTER_KEYS)
    def test_a_filter_never_crashes_on_malformed_stored_values(self, key):
        weird = {
            "resume_id": "weird", "classification": None, "experience": "n/a", "certifications": "PMP",
            "matched_jds": None, "headline": 7, "department": ["x"], "location": {"a": 1},
            "candidate_name": None, "salary_expectation": "lots",
        }
        for classification in (None, "x", {"skills": "python", "years_experience": "many"}, {"skills": [None, 3]}):
            doc = {**weird, "classification": classification}
            assert matches(doc, rs.build_resume_query({key: self.ONE_PER_FILTER[key]}, ["python"])) in (True, False)

    def test_the_old_resume_is_only_in_other(self):
        assert found({"business_domain": "other"}) == ["eve", "old"]
        for slug, _label, _families in taxonomy.BUSINESS_DOMAINS:
            assert "old" not in found({"business_domain": slug})

    @pytest.mark.parametrize("text", [
        "(", "[", "*", "\\", "c++", ".net", "a|b", "(?", "{1,2}", "$", "^", "\\d+", ".*", "+++", "'", '"',
        "a\\", "((((", "))))", "[a-", "ü", "李", "\x00", "a" * 5000, "?", "|", "c#", "node.js", "\\E", "(?i)",
    ])
    def test_hostile_text_builds_a_valid_query_in_every_text_filter(self, text):
        filters = {
            "search": text, "skill": text, "certification": text, "location": text,
            "notice_period": text, "worked_at_company": text, "department": text,
        }
        query = rs.build_resume_query(filters, ["python"])
        for pattern in patterns(query):
            re.compile(pattern)
        for doc in CORPUS:
            assert matches(doc, query) in (True, False)


class TestKnownSkillPool:

    @staticmethod
    def stocked():
        raw = FakeRaw()
        raw.add("resumes", {"classification": {"skills": ["Python", "python", "Spring Boot", None, 4, "  "]}}, "cmp_a")
        raw.add("resumes", {"classification": {"skills": ["Cobol"]}}, "cmp_b")
        raw.add("resumes", {"classification": None}, "cmp_a")
        raw.add("resumes", {}, "cmp_a")
        return raw

    async def test_the_pool_is_this_companys_skills_lowercased(self):
        raw = self.stocked()
        with company_context("cmp_a"):
            assert await rs.known_skill_pool(db_for_company(raw, "cmp_a")) == frozenset({"python", "spring boot"})
        with company_context("cmp_b"):
            assert await rs.known_skill_pool(db_for_company(raw, "cmp_b")) == frozenset({"cobol"})

    async def test_it_is_cached_for_three_hundred_seconds_per_company(self, monkeypatch):
        raw = self.stocked()
        scans = []
        original = FakeCollection.aggregate

        def counting(self, pipeline, *args, **kwargs):
            scans.append(self.name)
            return original(self, pipeline, *args, **kwargs)

        monkeypatch.setattr(FakeCollection, "aggregate", counting)
        clock = {"now": 1000.0}
        monkeypatch.setattr(rs, "_now", lambda: clock["now"])
        db = db_for_company(raw, "cmp_a")
        with company_context("cmp_a"):
            first = await rs.known_skill_pool(db)
            raw.add("resumes", {"classification": {"skills": ["Rust"]}}, "cmp_a")
            clock["now"] = 1299.0
            assert await rs.known_skill_pool(db) == first
            assert len(scans) == 1
            clock["now"] = 1300.0
            assert "rust" in await rs.known_skill_pool(db)
            assert len(scans) == 2
        with company_context("cmp_b"):
            assert await rs.known_skill_pool(db_for_company(raw, "cmp_b")) == frozenset({"cobol"})
        assert len(scans) == 3

    async def test_a_failed_scan_gives_an_empty_pool_or_the_last_good_one(self, monkeypatch):
        raw = self.stocked()
        state = {"now": 0.0, "down": True}
        original = FakeCollection.aggregate

        def flaky(self, pipeline, *args, **kwargs):
            if state["down"]:
                raise RuntimeError("down")
            return original(self, pipeline, *args, **kwargs)

        monkeypatch.setattr(FakeCollection, "aggregate", flaky)
        monkeypatch.setattr(rs, "_now", lambda: state["now"])
        db = db_for_company(raw, "cmp_a")
        with company_context("cmp_a"):
            assert await rs.known_skill_pool(db) == frozenset()
            state["down"] = False
            good = await rs.known_skill_pool(db)
            assert good == frozenset({"python", "spring boot"})
            state["now"] = 10_000.0
            state["down"] = True
            assert await rs.known_skill_pool(db) == good

    async def test_no_database_means_no_pool(self):
        assert await rs.known_skill_pool(None) == frozenset()

    async def test_the_cache_does_not_grow_without_bound(self):
        raw = FakeRaw()
        for index in range(rs.POOL_CACHE_LIMIT + 20):
            company = f"cmp_{index}"
            raw.add("resumes", {"classification": {"skills": ["Python"]}}, company)
            with company_context(company):
                await rs.known_skill_pool(db_for_company(raw, company))
        assert len(rs._pool_cache) <= rs.POOL_CACHE_LIMIT

    async def test_the_pool_turns_a_typed_skill_into_a_requirement(self):
        raw = self.stocked()
        with company_context("cmp_a"):
            pool = await rs.known_skill_pool(db_for_company(raw, "cmp_a"))
        assert rs.parse_search("spring boot", pool).skills == ("spring boot",)
        assert rs.parse_search("cobol", pool).words == ("cobol",)


class TestOptionsOrdering:

    @staticmethod
    def row(value, count):
        return {"_id": value, "count": count}

    def test_business_domains_are_busiest_first_with_other_last_even_when_largest(self):
        rows = [
            self.row("software_engineering", 3), self.row("devops", 1), self.row("marketing", 2),
            self.row(None, 4), self.row("astrology", 1), self.row("", 2),
        ]
        result = rs.build_options({"families": rows}, 13)["business_domains"]
        assert [(o["value"], o["label"], o["count"]) for o in result] == [
            ("it_software", "IT & Software", 4), ("marketing", "Marketing", 2), ("other", "Other", 7),
        ]

    def test_business_domain_ties_break_on_label(self):
        rows = [self.row("marketing", 2), self.row("machine_learning", 2), self.row("legal", 2)]
        result = rs.build_options({"families": rows}, 6)["business_domains"]
        assert [o["value"] for o in result] == ["data_ai", "legal", "marketing"]

    def test_seniorities_follow_rank_not_alphabet_and_unknown_values_come_last(self):
        rows = [self.row("senior", 2), self.row("intern", 1), self.row("executive", 1), self.row("mid", 3),
                self.row("weird", 1), self.row("", 5), self.row(None, 4), self.row("director", 0)]
        result = rs.build_options({"seniorities": rows}, 0)["seniorities"]
        assert [o["value"] for o in result] == ["intern", "mid", "senior", "executive", "weird"]
        assert [o["label"] for o in result] == ["Intern", "Mid", "Senior", "Executive", "Weird"]
        assert [o["count"] for o in result] == [1, 3, 2, 1, 1]

    def test_every_known_seniority_keeps_its_rank(self):
        rows = [self.row(v, 1) for v in reversed(taxonomy.SENIORITY_ORDER)]
        result = rs.build_options({"seniorities": rows}, 0)["seniorities"]
        assert [o["value"] for o in result] == list(taxonomy.SENIORITY_ORDER)

    def test_education_levels_follow_rank(self):
        rows = [self.row("phd", 1), self.row("bachelor", 2), self.row("high_school", 3), self.row("other", 1),
                self.row("bootcamp", 0), self.row("master", 4)]
        result = rs.build_options({"education_levels": rows}, 0)["education_levels"]
        assert [o["value"] for o in result] == ["high_school", "bachelor", "master", "phd", "other"]
        assert [o["label"] for o in result] == ["High school", "Bachelor", "Master", "PhD", "Other"]

    def test_statuses_are_alphabetical_and_carry_no_label(self):
        rows = [self.row("processed", 5), self.row("failed", 1), self.row("pending", 2), self.row("", 7)]
        assert rs.build_options({"statuses": rows}, 0)["statuses"] == [
            {"value": "failed", "count": 1}, {"value": "pending", "count": 2}, {"value": "processed", "count": 5},
        ]

    def test_industries_are_alphabetical_by_value(self):
        rows = [self.row("technology", 5), self.row("banking_finance", 1), self.row("fintech", 2), self.row("other", 1)]
        result = rs.build_options({"industries": rows}, 0)["industries"]
        assert [(o["value"], o["label"]) for o in result] == [
            ("banking_finance", "Banking & Finance"), ("fintech", "Fintech"), ("other", "Other"),
            ("technology", "Technology"),
        ]

    def test_job_families_and_availability_are_not_offered_as_options(self):
        rows = [self.row("devops", 2), self.row("immediate", 1)]
        built = rs.build_options({"families": rows, "availability_statuses": rows}, 0)
        assert "job_families" not in built and "availability_statuses" not in built
        assert "availability_statuses" not in rs.option_pipelines()
        assert [o["value"] for o in built["business_domains"]] == ["it_software", "other"]

    def test_certifications_are_not_offered_as_an_option(self):
        rows = [self.row("PMP", 2), self.row("pmp", 1), self.row("AWS SAA", 1)]
        assert "certifications" not in rs.build_options({"certifications": rows}, 0)
        assert "certifications" not in rs.option_pipelines()

    @staticmethod
    def role_row(family, department, count):
        key = {}
        if family is not None:
            key["family"] = family
        if department is not None:
            key["department"] = department
        return {"_id": key, "count": count}

    def test_roles_are_the_department_else_the_family_label_merged_by_case_and_alphabetical(self):
        rows = [
            self.role_row("software_engineering", "Backend Engineer", 2),
            self.role_row("devops", "backend engineer", 1),
            self.role_row("software_engineering", None, 4),
            self.role_row("devops", "Software Engineering", 1),
            self.role_row("devops", "  ", 2),
            self.role_row("astrology", "", 1),
            self.role_row(None, None, 3),
            self.role_row("", None, 1),
            self.role_row("  ", None, 1),
            self.role_row("hr", None, 0),
        ]
        assert rs.build_options({"roles": rows}, 0)["roles"] == [
            {"value": "Astrology", "count": 1},
            {"value": "Backend Engineer", "count": 3},
            {"value": "DevOps", "count": 2},
            {"value": "Not classified", "count": 5},
            {"value": "Software Engineering", "count": 5},
        ]

    def test_roles_are_capped_at_the_hundred_busiest_then_listed_alphabetically(self):
        rows = [self.role_row("sales", f"role {i:04d}", 1) for i in range(300)]
        rows.append(self.role_row("sales", "zzz busiest", 9))
        roles = rs.build_options({"roles": rows}, 0)["roles"]
        assert len(roles) == rs.ROLE_OPTION_LIMIT == 100
        assert roles[-1] == {"value": "zzz busiest", "count": 9}
        assert [r["value"] for r in roles[:-1]] == [f"role {i:04d}" for i in range(99)]

    def test_every_folder_role_chip_is_also_a_role_option(self):
        rows = [
            self.role_row("software_engineering", None, 2), self.role_row("sales", "Account Exec", 1),
            self.role_row(None, None, 1), self.role_row("astrology", None, 1), self.role_row("hr", "hr partner", 3),
        ]
        options = {r["value"].lower() for r in rs.build_options({"roles": rows}, 0)["roles"]}
        chips = {role["value"].lower() for folder in rs.build_folders(rows) for role in folder["roles"]}
        assert chips and chips <= options

    def test_skills_merge_case_busiest_first_and_are_capped_at_four_hundred(self):
        rows = [self.row("Python", 5), self.row("python", 2), self.row("PYTHON", 1), self.row("Go", 4),
                self.row("pytorch", 2), self.row("PyTorch", 2), self.row("Zig", 8)]
        result = rs.build_options({"skills": rows}, 0)["skills"]
        assert result == [
            {"value": "Python", "count": 8}, {"value": "Zig", "count": 8}, {"value": "Go", "count": 4},
            {"value": "PyTorch", "count": 4},
        ]
        assert rs.SKILL_OPTION_LIMIT == 400
        many = [self.row(f"skill {i:04d}", 450 - (i % 449)) for i in range(450)]
        capped = rs.build_options({"skills": many}, 0)["skills"]
        assert len(capped) == 400
        assert [o["count"] for o in capped] == sorted((o["count"] for o in capped), reverse=True)

    def test_the_most_used_spelling_is_shown_then_the_one_with_more_capitals(self):
        merged = {o["value"]: o["count"] for o in rs.merge_case_insensitive([
            self.row("node js", 3), self.row("Node JS", 1), self.row("sql", 1), self.row("SQL", 1), self.row("Sql", 1),
        ])}
        assert merged == {"node js": 4, "SQL": 3}

    def test_an_empty_or_partial_result_is_all_empty_lists_and_a_total(self):
        empty = rs.build_options({}, 0)
        assert empty == {
            "business_domains": [], "skills": [], "seniorities": [], "statuses": [],
            "education_levels": [], "industries": [],
            "roles": [], "total": 0,
        }
        assert rs.build_options({"skills": None}, None)["total"] == 0
        assert rs.build_options({}, 42)["total"] == 42

    def test_counts_that_are_zero_negative_or_not_numbers_never_show(self):
        rows = [self.row("senior", 0), self.row("mid", -2), self.row("lead", True), self.row("junior", "3"),
                self.row("intern", 2.9)]
        result = rs.build_options({"seniorities": rows}, 0)["seniorities"]
        assert [(o["value"], o["count"]) for o in result] == [("intern", 2)]

    def test_field_names_match_the_contract(self):
        assert set(rs.build_options({}, 0)) == {
            "business_domains", "skills", "seniorities", "statuses", "education_levels",
            "industries", "roles", "total",
        }

    def test_one_pipeline_per_option_group(self):
        pipelines = rs.option_pipelines()
        assert set(pipelines) == {
            "families", "seniorities", "statuses", "education_levels",
            "industries", "roles", "skills",
        }
        assert pipelines["skills"][0] == {"$unwind": "$classification.skills"}
        assert all(any("$group" in stage for stage in pipeline) for pipeline in pipelines.values())


class TestFolders:

    @staticmethod
    def row(family, department, count):
        key = {}
        if family is not None:
            key["family"] = family
        if department is not None:
            key["department"] = department
        return {"_id": key, "count": count}

    def test_folders_count_and_group_roles_with_the_family_label_as_fallback(self):
        rows = [
            self.row("software_engineering", "Backend Engineer", 3),
            self.row("software_engineering", "backend engineer", 1),
            self.row("software_engineering", None, 2),
            self.row("devops", "DevOps Engineer", 1),
            self.row("marketing", "  ", 1),
        ]
        folders = rs.build_folders(rows)
        assert folders[0] == {
            "value": "it_software", "label": "IT & Software", "count": 7,
            "roles": [
                {"value": "Backend Engineer", "count": 4},
                {"value": "Software Engineering", "count": 2},
                {"value": "DevOps Engineer", "count": 1},
            ],
        }
        assert folders[1] == {
            "value": "marketing", "label": "Marketing", "count": 1, "roles": [{"value": "Marketing", "count": 1}],
        }

    def test_other_is_last_even_when_it_is_the_biggest_and_covers_missing_and_unknown_families(self):
        rows = [self.row("sales", "AE", 1), self.row("legal", "Counsel", 2), self.row(None, None, 4),
                self.row("astrology", "Stargazer", 3), self.row("", None, 1)]
        folders = rs.build_folders(rows)
        assert [f["value"] for f in folders] == ["legal", "sales", "other"]
        assert folders[-1]["count"] == 8
        assert folders[-1]["roles"] == [
            {"value": "Not classified", "count": 5}, {"value": "Stargazer", "count": 3},
        ]

    def test_equal_folders_are_ordered_by_label(self):
        rows = [self.row("marketing", None, 2), self.row("machine_learning", None, 2), self.row("legal", None, 2)]
        assert [f["label"] for f in rs.build_folders(rows)] == ["Data & AI", "Legal", "Marketing"]

    def test_only_the_top_five_roles_are_kept_busiest_first_then_by_name(self):
        rows = [self.row("sales", f"Role {name}", count) for name, count in
                (("a", 1), ("b", 5), ("c", 3), ("d", 3), ("e", 2), ("f", 4), ("g", 1))]
        roles = rs.build_folders(rows)[0]["roles"]
        assert [r["value"] for r in roles] == ["Role b", "Role f", "Role c", "Role d", "Role e"]

    def test_zero_counts_and_malformed_rows_are_ignored(self):
        rows = [self.row("sales", "AE", 0), {"_id": "oops", "count": 3}, {"_id": None, "count": 1},
                {"count": 2}, self.row("sales", "AE", -1)]
        folders = rs.build_folders(rows)
        assert folders == [{"value": "other", "label": "Other", "count": 6, "roles": [{"value": "Not classified", "count": 6}]}]
        assert rs.build_folders([]) == []
        assert rs.build_folders(None) == []

    def test_the_folder_pipeline_matches_then_groups_by_family_and_role(self):
        pipeline = rs.folder_pipeline({"processing_status": "processed"})
        assert pipeline[0] == {"$match": {"processing_status": "processed"}}
        assert pipeline[1]["$group"]["_id"] == {"family": "$classification.job_domain", "department": "$department"}


class TestRanking:

    def test_the_default_order_is_newest_first_with_a_stable_tie_break(self):
        assert rs.NEWEST_FIRST == [("created_at", -1), ("resume_id", 1)]

    def test_a_ranked_page_sorts_by_relevance_then_years_then_newest_then_id(self):
        parsed = rs.ParsedSearch(("python",), ("lead",))
        pipeline = rs.ranked_pipeline({"x": 1}, parsed, 40, 20)
        assert [next(iter(stage)) for stage in pipeline] == [
            "$match", "$addFields", "$sort", "$skip", "$limit", "$project",
        ]
        assert pipeline[0] == {"$match": {"x": 1}}
        assert list(pipeline[2]["$sort"].items()) == [
            ("_relevance", -1), ("classification.years_experience", -1), ("created_at", -1), ("resume_id", 1),
        ]
        assert pipeline[3] == {"$skip": 40}
        assert pipeline[4] == {"$limit": 20}
        assert pipeline[5] == {"$project": {"_id": 0, "embedding": 0, "text": 0, "_relevance": 0}}

    def test_relevance_rewards_a_skill_on_the_list_and_a_skill_or_word_named_in_the_headline(self):
        parts = rs.relevance_expression(rs.ParsedSearch(("python",), ("lead",)))["$add"]
        assert parts[0] == 3
        skill_test = parts[1]["$cond"]
        assert skill_test[1:] == [3, 0]
        assert skill_test[0]["$regexMatch"]["regex"] == rs.whole_word_pattern("python")
        word_test = parts[2]["$cond"]
        assert word_test[1:] == [1, 0]
        assert word_test[0]["$regexMatch"]["regex"] == rs.whole_word_pattern("lead")
        assert len(parts) == 3

    def test_page_and_limit_are_kept_within_bounds(self):
        assert rs.page_bounds(None, None) == (1, 20)
        assert rs.page_bounds(0, 0) == (1, 20)
        assert rs.page_bounds(-3, -5) == (1, 1)
        assert rs.page_bounds(2, 1000) == (2, 500)
        assert rs.page_bounds("3", "7") == (3, 7)
        assert rs.MAX_PAGE_SIZE == 500


class TestSemanticHelpers:

    def test_hits_are_read_from_objects_or_dicts_and_garbage_is_skipped(self):
        result = SimpleNamespace(matches=[
            SimpleNamespace(id="a", score=0.9), {"id": "b", "score": 0.5}, {"id": None, "score": 1},
            {"id": 7, "score": 1}, SimpleNamespace(id="c", score=None), {"id": "d", "score": True}, {"id": ""},
        ])
        assert rs.pinecone_hits(result) == [("a", 0.9), ("b", 0.5), ("c", 0.0), ("d", 0.0)]
        assert rs.pinecone_hits({"matches": [{"id": "x", "score": 0.1}]}) == [("x", 0.1)]
        assert rs.pinecone_hits({}) == []
        assert rs.pinecone_hits(None) == []
        assert rs.pinecone_hits(SimpleNamespace(matches=None)) == []

    @pytest.mark.parametrize("limit, expected", [(1, 5), (20, 100), (39, 195), (40, 200), (50, 200)])
    def test_pinecone_is_asked_for_five_times_the_limit_up_to_two_hundred(self, limit, expected):
        assert rs.semantic_top_k(limit) == expected

    def test_documents_keep_the_pinecone_order_and_get_a_clamped_rounded_score(self):
        docs = [{"resume_id": "a"}, {"resume_id": "b"}, {"resume_id": "c"}]
        hits = [("c", 1.2), ("zzz", 0.9), ("a", 0.123456), ("c", 0.5), ("b", -0.3)]
        ranked = rs.rank_documents(hits, docs, 10)
        assert [(d["resume_id"], d["match_score"]) for d in ranked] == [("c", 1.0), ("a", 0.1235), ("b", 0.0)]
        assert "match_score" not in docs[0]

    def test_the_limit_cuts_the_ranked_list(self):
        docs = [{"resume_id": str(i)} for i in range(5)]
        hits = [(str(i), 1 - i / 10) for i in range(5)]
        assert [d["resume_id"] for d in rs.rank_documents(hits, docs, 2)] == ["0", "1"]
        assert rs.rank_documents([], docs, 5) == []
        assert rs.rank_documents(hits, [], 5) == []
