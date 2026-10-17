JOB_FAMILY_LABELS: dict[str, str] = {
    "software_engineering": "Software Engineering",
    "machine_learning": "Machine Learning",
    "data_science": "Data Science",
    "data_engineering": "Data Engineering",
    "devops": "DevOps",
    "cybersecurity": "Cybersecurity",
    "qa_testing": "QA and Testing",
    "product_management": "Product Management",
    "design": "Design",
    "marketing": "Marketing",
    "sales": "Sales",
    "finance": "Finance",
    "hr": "Human Resources",
    "operations": "Operations",
    "legal": "Legal",
    "customer_success": "Customer Success",
}

BUSINESS_DOMAINS: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("it_software", "IT & Software", ("software_engineering", "devops", "qa_testing", "cybersecurity")),
    ("data_ai", "Data & AI", ("machine_learning", "data_science", "data_engineering")),
    ("product_design", "Product & Design", ("product_management", "design")),
    ("marketing", "Marketing", ("marketing",)),
    ("sales", "Sales", ("sales",)),
    ("finance", "Finance", ("finance",)),
    ("human_resources", "Human Resources", ("hr",)),
    ("operations", "Operations", ("operations",)),
    ("legal", "Legal", ("legal",)),
    ("customer_success", "Customer Success", ("customer_success",)),
)

OTHER_DOMAIN: tuple[str, str] = ("other", "Other")

SENIORITY_ORDER: tuple[str, ...] = (
    "intern", "junior", "mid", "senior", "lead", "manager", "director", "executive",
)

EDUCATION_ORDER: tuple[str, ...] = ("high_school", "bootcamp", "bachelor", "master", "phd", "other")

_DOMAIN_LABELS = {slug: label for slug, label, _ in BUSINESS_DOMAINS}
_DOMAIN_FAMILIES = {slug: families for slug, _, families in BUSINESS_DOMAINS}
_FAMILY_DOMAIN = {family: slug for slug, _, families in BUSINESS_DOMAINS for family in families}


def family_label(family: str | None) -> str:
    if not family:
        return "Not classified"
    return JOB_FAMILY_LABELS.get(family) or family.replace("_", " ").title()


def domain_slug_for_family(family: str | None) -> str:
    return _FAMILY_DOMAIN.get(family or "", OTHER_DOMAIN[0])


def domain_label(slug: str | None) -> str:
    if slug == OTHER_DOMAIN[0]:
        return OTHER_DOMAIN[1]
    return _DOMAIN_LABELS.get(slug or "", "")


def families_for_domain(slug: str | None) -> tuple[str, ...]:
    return _DOMAIN_FAMILIES.get(slug or "", ())


def is_known_domain(slug: str | None) -> bool:
    return slug == OTHER_DOMAIN[0] or (slug or "") in _DOMAIN_FAMILIES


def known_families() -> tuple[str, ...]:
    return tuple(JOB_FAMILY_LABELS)
