import re

from services.hr_module.resume_taxonomy import family_label, known_families

PROFILE_VERSION = 1

CLASSIFICATION_KEYS = (
    "job_domain", "seniority_level", "skills", "confidence",
    "years_experience", "education_level", "industry",
)
PROFILE_KEYS = ("headline", "location", "experience")

HEADLINE_LIMIT = 120
LOCATION_LIMIT = 120
ITEM_LIMIT = 120
MAX_EXPERIENCE = 8

_PLACEHOLDERS = frozenset({
    "null", "none", "n/a", "na", "unknown", "undefined",
    "not stated", "not specified", "not mentioned", "-", "--",
})
_SPACES = re.compile(r"\s+")
_CONTROL = re.compile(r"[\x00-\x08\x0e-\x1f\x7f]")


def clean_text(value, limit: int = ITEM_LIMIT) -> str | None:
    if not isinstance(value, str):
        return None
    text = _SPACES.sub(" ", _CONTROL.sub(" ", value)).strip()
    if not text or text.lower().strip(". ") in _PLACEHOLDERS:
        return None
    if limit and len(text) > limit:
        text = text[:limit].rstrip()
    return text


def clean_experience(value, limit: int = MAX_EXPERIENCE) -> list[dict]:
    if not isinstance(value, (list, tuple)) or limit <= 0:
        return []
    out: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for item in value:
        if not isinstance(item, dict):
            continue
        title = clean_text(item.get("title"), ITEM_LIMIT)
        company = clean_text(item.get("company"), ITEM_LIMIT)
        if title is None and company is None:
            continue
        key = ((title or "").lower(), (company or "").lower())
        if key in seen:
            continue
        seen.add(key)
        out.append({"title": title, "company": company})
        if len(out) >= limit:
            break
    return out


def clean_profile(source) -> dict:
    data = source if isinstance(source, dict) else {}
    return {
        "headline": clean_text(data.get("headline"), HEADLINE_LIMIT),
        "location": clean_text(data.get("location"), LOCATION_LIMIT),
        "experience": clean_experience(data.get("experience"), MAX_EXPERIENCE),
    }


def has_profile_data(profile) -> bool:
    data = profile if isinstance(profile, dict) else {}
    return any(data.get(key) for key in PROFILE_KEYS)


_RULE_SOURCES: tuple[tuple[str, str], ...] = (
    ("Full Stack Developer",
     r"\bfull ?stack\b|\b(?:mern|mean|lamp) stack\b|\bfront ?end\b.*\bback ?end\b|\bback ?end\b.*\bfront ?end\b"),
    ("Machine Learning Engineer",
     r"\b(?:machine learning|ml|mlops|deep learning|computer vision|nlp|llm|genai|generative ai|ai"
     r"|artificial intelligence)\b(?: \w+){0,2} (?:engineer|developer|specialist|architect|programmer)s?\b"
     r"|\bmlops\b"),
    ("Data Scientist",
     r"\bdata scien(?:ce|tist)s?\b|\bdecision scientist\b|\b(?:ai|ml|machine learning) scientist\b"),
    ("Data Engineer",
     r"\bdata (?:engineer|engineers|engineering|architect|platform|pipeline)\b"
     r"|\b(?:etl|big data|bigdata|analytics|dwh|data warehouse|databricks|spark|hadoop|snowflake)"
     r" (?:developer|engineer|architect)s?\b"),
    ("Data Analyst",
     r"\bdata analysts?\b"
     r"|\b(?:bi|business intelligence|reporting|analytics|insights?|mis) (?:analyst|developer|engineer|specialist)s?\b"
     r"|\bpower ?bi (?:developer|analyst|engineer)s?\b"),
    ("DevOps Engineer",
     r"\bdev ?ops\b|\bdevsecops\b|\bsre\b|\bsite reliability\b|\bplatform engineers?\b"
     r"|\binfrastructure engineers?\b|\brelease engineers?\b"),
    ("Cloud Engineer",
     r"\bcloud (?:engineer|architect|developer|administrator|specialist|consultant)s?\b"
     r"|\b(?:aws|azure|gcp|google cloud) (?:engineer|architect|developer|administrator|consultant)s?\b"),
    ("Security Engineer",
     r"\b(?:cyber ?security|information security|infosec|network security|application security|appsec"
     r"|cloud security|it security)\b(?: \w+)? "
     r"(?:engineer|analyst|architect|specialist|consultant|tester|administrator|researcher)s?\b"
     r"|\bsecurity (?:engineer|architect)s?\b|\bpenetration test(?:er|ing)\b|\bpentest(?:er|ing)?\b"
     r"|\bethical hacker\b|\bsoc analyst\b|\bvapt\b"),
    ("QA Engineer",
     r"\bqa\b|\bquality assurance (?:engineer|analyst|tester|specialist|automation|consultant|developer)s?\b"
     r"|\bsdet\b|\btesters?\b|\bsoftware testing\b|\b(?:test|testing) (?:engineer|analyst|specialist|automation)s?\b"
     r"|\bengineer in test\b|\btest automation\b"),
    ("Mobile Developer",
     r"\b(?:android|ios|mobile|flutter|react native|swift|xamarin|iphone|ipad|ionic)\b(?: \w+){0,2}"
     r" (?:developer|engineer|programmer)s?\b"),
    ("Frontend Developer",
     r"\bfront ?end\b|\b(?:react|reactjs|angular|angularjs|vue|vuejs|svelte|nextjs|ui|html|css)\b(?: \w+){0,2}"
     r" (?:developer|engineer)s?\b"),
    ("Backend Developer",
     r"\bback ?end\b|\b(?:node|nodejs|django|flask|fastapi|spring|laravel|rails|nestjs|golang|api|microservices?"
     r"|graphql)\b(?: \w+){0,2} (?:developer|engineer)s?\b"),
    ("Web Developer",
     r"\bweb (?:developer|programmer|engineer)s?\b"
     r"|\b(?:wordpress|shopify|wix|drupal|magento|joomla|webflow) (?:developer|engineer)s?\b"),
    ("Database Administrator", r"\bdba\b|\bdatabase (?:administrator|admin)s?\b"),
    ("Network Engineer",
     r"\bnetwork (?:engineer|administrator|admin|architect|specialist)s?\b|\bccna\b|\bccnp\b"),
    ("System Administrator",
     r"\b(?:system|systems|linux|windows|server|unix|it) (?:administrator|admin)s?\b|\bsysadmin\b"),
    ("IT Support Specialist",
     r"\b(?:it|desktop) support\b|\bhelp ?desk\b|\bservice desk\b|\bit technician\b"),
    ("Engineering Manager",
     r"\bengineering (?:manager|director)s?\b|\bsoftware (?:engineering |development )?(?:manager|director)s?\b"),
    ("Product Manager", r"\bproduct (?:manager|owner|management|lead)s?\b"),
    ("Project Manager",
     r"\bproject (?:manager|management|director|lead)s?\b|\bdelivery (?:manager|lead)s?\b|\bpmp\b"),
    ("Business Analyst", r"\bbusiness analy(?:st|sts|sis)\b"),
    ("UI/UX Designer",
     r"\b(?:ui ux|ux ui|ui|ux|user experience|user interface|interaction|experience) design(?:er|ers)?\b"
     r"|\bproduct designers?\b"),
    ("Graphic Designer",
     r"\bgraphics? design(?:er|ers)?\b|\b(?:brand|creative|communication) designers?\b"),
    ("Content Writer", r"\b(?:content|copy|blog) writers?\b|\bcopywriters?\b"),
    ("Marketing Manager",
     r"\bmarketing (?:manager|director|head)s?\b|\bbrand managers?\b|\bgrowth managers?\b"),
    ("Digital Marketer",
     r"\bdigital market(?:er|ers|ing)\b|\bseo\b|\bsem\b|\bppc\b|\bsocial media\b"
     r"|\b(?:content|performance|growth|email) market(?:er|ers|ing)\b"),
    ("Sales Manager", r"\bsales (?:manager|director|head)s?\b"),
    ("Sales Executive",
     r"\bsales (?:executive|representative|rep|associate|officer|consultant|specialist|agent|advisor|adviser"
     r"|coordinator|person)s?\b|\baccount executives?\b"
     r"|\bbusiness development (?:executive|representative|associate|officer)s?\b"
     r"|\b(?:bdr|sdr)\b|\binside sales\b|\bsales development\b"),
    ("Account Manager",
     r"\b(?:key |technical |strategic |enterprise )?account managers?\b|\baccount management\b"),
    ("HR Manager",
     r"\b(?:hr|human resources?|people (?:and )?culture) (?:\w+ )?(?:manager|director|head)s?\b"
     r"|\bhrbp\b|\bhr business partner\b"),
    ("Recruiter",
     r"^(?!.*\b(?:manager|director|head)\b).*"
     r"\b(?:recruiters?|recruitment|talent acquisition|sourcers?|headhunters?|talent partner)\b"),
    ("Finance Manager",
     r"\b(?:finance|financial|accounts|accounting) (?:manager|director|head)s?\b"
     r"|\bfinancial controller\b|\bcfo\b|\bchief financial officer\b"),
    ("Financial Analyst",
     r"\b(?:financial|finance|investment|credit|equity|treasury|fp a) analysts?\b|\bfp a\b"
     r"|\bfinancial planning and analysis\b|\bequity research\b"),
    ("Accountant",
     r"\baccountants?\b|\bbookkeepers?\b|\baccounts (?:payable|receivable|executive|officer|assistant)\b"
     r"|\baccounting (?:executive|officer|assistant|clerk|associate)\b"),
    ("Customer Support Specialist",
     r"^(?!.*\b(?:manager|director|head)\b).*"
     r"(?:\b(?:customer|client) (?:support|service|services|care|experience)\b|\btechnical support\b"
     r"|\bsupport (?:representative|agent|executive|associate)\b|\bcall cent(?:er|re)\b"
     r"|\bcontact cent(?:er|re)\b)"),
    ("Operations Manager",
     r"^(?:(?:business|general|plant|site|branch|regional|area|retail|store|warehouse|logistics|global|district"
     r"|field|production|manufacturing|hotel|restaurant|delivery|service) )?(?:operations?|ops)"
     r" (?:manager|director|head)s?\b"),
    ("Legal Counsel",
     r"\b(?:legal|general|corporate|in house|inhouse) (?:counsel|advisor|adviser|officer|associate|consultant)s?\b"
     r"|\b(?:lawyer|attorney|solicitor|barrister)s?\b|\bcounsel\b"),
    ("Software Developer",
     r"\bsoftware (?:developer|engineer|programmer|architect|development|engineering)s?\b|\bsde\b|\bswe\b"
     r"|\bprogrammers?\b|\b(?:application|applications|systems|platform) (?:developer|programmer)s?\b"
     r"|\b(?:java|python|javascript|typescript|js|c\+\+|c#|cpp|net|dotnet|php|ruby|go|golang|rust|scala|perl"
     r"|kotlin|sql|abap) (?:developer|engineer|programmer)s?\b"),
)

_RULES = tuple((role, re.compile(source)) for role, source in _RULE_SOURCES)

ROLE_NAMES = tuple(role for role, _ in _RULE_SOURCES)

_BRACKETS = re.compile(r"[\(\[\{][^\)\]\}]*[\)\]\}]")
_EMPLOYER_CUT = re.compile(r"\s+at\s+|\s*@\s*|\s*[|;,•·]\s*|\s+[-–]\s+", re.IGNORECASE)
_HEAD_OF = re.compile(r"\b(?:head|vp|vice president)\s+of\s+(.+)$", re.IGNORECASE)
_LEADING_ASSOCIATE = re.compile(r"^\s*associate\s+", re.IGNORECASE)
_LEVEL = re.compile(
    r"\b(?:senior|sr|junior|jr|principal|staff|intern|interns|internship|trainee|graduate|fresher|experienced"
    r"|entry[\s-]?level|mid[\s-]?level|mid|contract|contractor|freelance|freelancer|remote"
    r"|part[\s-]time|full[\s-]time"
    r"|lead(?!\s+(?:generation|gen|qualification|development|nurturing)))\b\.?",
    re.IGNORECASE,
)
_TRAILING_RANK = re.compile(r"\s+(?:i{1,3}|iv|v|\d+)$", re.IGNORECASE)
_CONJUNCTION = re.compile(r"\s+(?:and|&|\+)\s+|\s+/\s+", re.IGNORECASE)
_NON_WORD = re.compile(r"[^\w+#]+|_")
_TITLE_WORD = re.compile(r"^[^\W\d_]+(?:['’-][^\W\d_]+)*$")

_FILLER_SEGMENTS = frozenset({
    "team", "tech", "technical", "leadership", "mentor", "mentoring", "manager", "management",
    "consultant", "specialist", "expert", "trainer",
})
_WEAK_TITLES = frozenset({
    "team", "tech", "technical", "department", "group", "unit", "management", "manager", "professional",
    "specialist", "executive", "consultant", "officer", "member", "staff", "employee", "worker",
    "candidate", "fresher", "student", "graduate", "profile", "resume", "cv",
})
_JUNK_WORDS = frozenset({
    "seeking", "looking", "open", "opportunities", "opportunity", "passionate", "motivated",
    "hardworking", "dedicated", "aspiring", "currently", "unemployed", "available", "hiring", "work",
    "job", "jobs", "career", "objective", "summary", "curriculum", "vitae", "enthusiastic", "results",
    "driven", "oriented",
})
_SMALL_WORDS = frozenset({"and", "of", "for", "in", "the", "to", "at", "on", "a", "an"})
_ACRONYMS = {
    "qa": "QA", "hr": "HR", "ui": "UI", "ux": "UX", "it": "IT", "ai": "AI", "ml": "ML", "seo": "SEO",
    "sap": "SAP", "erp": "ERP", "crm": "CRM", "bi": "BI", "etl": "ETL", "api": "API", "sre": "SRE",
    "vp": "VP", "cto": "CTO", "cfo": "CFO", "ceo": "CEO", "coo": "COO", "pr": "PR", "sql": "SQL",
    "nlp": "NLP", "aws": "AWS", "gcp": "GCP", "ios": "iOS", "devops": "DevOps",
}


def _head_of_to_manager(match: re.Match) -> str:
    scope = match.group(1).strip()
    if re.search(r"\b(?:manager|management|lead|head)\s*$", scope, re.IGNORECASE):
        return scope
    return f"{scope} Manager"


def _prepare(value, rewrite_head: bool = True) -> str:
    if not isinstance(value, str):
        return ""
    text = _BRACKETS.sub(" ", value)
    text = _EMPLOYER_CUT.split(text)[0]
    if rewrite_head:
        text = _HEAD_OF.sub(_head_of_to_manager, text)
    text = _LEADING_ASSOCIATE.sub("", text)
    text = _LEVEL.sub(" ", text)
    text = _SPACES.sub(" ", text).strip()
    text = _TRAILING_RANK.sub("", text)
    return text.strip(" -,/&+|.")


def _normalize(text: str) -> str:
    return _SPACES.sub(" ", _NON_WORD.sub(" ", text.lower())).strip()


def _rule_role(normalized: str) -> str | None:
    for role, pattern in _RULES:
        if pattern.search(normalized):
            return role
    return None


def _is_filler(segment: str) -> bool:
    tokens = _normalize(segment).split()
    return not tokens or all(token in _FILLER_SEGMENTS for token in tokens)


def _match_role(display: str) -> str | None:
    whole = _rule_role(_normalize(display))
    if whole is None or whole == "Full Stack Developer":
        return whole
    meaningful = [segment for segment in _CONJUNCTION.split(display) if not _is_filler(segment)]
    if len(meaningful) < 2:
        return whole
    roles = {_rule_role(_normalize(segment)) for segment in meaningful}
    if len(roles) == 1 and None not in roles:
        return whole
    return None


def _title_case(words: list[str]) -> str:
    out: list[str] = []
    for index, word in enumerate(words):
        lowered = word.lower()
        if lowered in _ACRONYMS:
            out.append(_ACRONYMS[lowered])
        elif word.isupper() and len(word) <= 4:
            out.append(word)
        elif index and lowered in _SMALL_WORDS:
            out.append(lowered)
        else:
            out.append("-".join(part[:1].upper() + part[1:].lower() for part in word.split("-")))
    return " ".join(out)


def _fallback_title(display: str) -> str | None:
    words = display.split()
    if not 1 <= len(words) <= 4:
        return None
    if not all(_TITLE_WORD.match(word) for word in words):
        return None
    lowered = [word.lower() for word in words]
    if any(word in _JUNK_WORDS for word in lowered):
        return None
    if len(words) == 1 and (lowered[0] in _WEAK_TITLES or len(lowered[0]) < 2):
        return None
    if all(word in _SMALL_WORDS for word in lowered):
        return None
    return _title_case(words)


def _first_title(experience) -> str | None:
    if not isinstance(experience, (list, tuple)):
        return None
    for item in experience:
        if isinstance(item, dict):
            title = clean_text(item.get("title"), ITEM_LIMIT)
            if title:
                return title
    return None


def _family(job_domain) -> str | None:
    if isinstance(job_domain, str) and job_domain in known_families():
        return family_label(job_domain)
    return None


def derive_role(headline, experience, job_domain) -> str | None:
    source = clean_text(headline, HEADLINE_LIMIT)
    if not _prepare(source):
        source = _first_title(experience)
    display = _prepare(source)
    if display:
        role = _match_role(display)
        if role:
            return role
        title = _fallback_title(_prepare(source, rewrite_head=False))
        if title:
            return title
    return _family(job_domain)


def split_profile(result) -> tuple[dict, dict]:
    data = result if isinstance(result, dict) else {}
    classification = {key: data[key] for key in CLASSIFICATION_KEYS if key in data}
    return classification, clean_profile(data)


def profile_fields(profile, job_domain) -> dict:
    cleaned = clean_profile(profile)
    return {
        **cleaned,
        "department": derive_role(cleaned["headline"], cleaned["experience"], job_domain),
        "profile_version": PROFILE_VERSION,
    }
