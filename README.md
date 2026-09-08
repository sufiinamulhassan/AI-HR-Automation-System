<div align="center">

# Hirely.ai

**An AI recruitment platform.** Upload job descriptions and résumés, let the system match and
invite candidates automatically, run an AI voice interview with live proctoring, then review a
scored report, with an admin layer for users, roles, branding, prompts and workflow rules.

![Top language](https://img.shields.io/badge/top_language-Python_40.5%25-3776AB?style=flat-square&logo=python&logoColor=white)
![Languages](https://img.shields.io/badge/languages-6-informational?style=flat-square)
![Endpoints](https://img.shields.io/badge/endpoints-158-orange?style=flat-square)
![Tests](https://img.shields.io/badge/tests-554_passing-brightgreen?style=flat-square)

![Version](https://img.shields.io/badge/version-3.0.0-blueviolet?style=flat-square)
[![License](https://img.shields.io/badge/license-Apache_2.0-green?style=flat-square)](LICENSE)
[![Visits](https://visitor-badge.laobi.icu/badge?page_id=sufiinamulhassan.AI-HR-Automation-System&left_text=visits&left_color=555555&right_color=blueviolet&style=flat-square)](https://github.com/sufiinamulhassan/AI-HR-Automation-System)

<!--
  LIVE GITHUB BADGES: swap the static block above for this once the repository is
  PUBLIC on GitHub. shields.io reads the GitHub API anonymously, so while the repo
  is private or unpushed every one of these renders as "repo not found".

[![Stars](https://img.shields.io/github/stars/sufiinamulhassan/AI-HR-Automation-System?style=flat-square)](https://github.com/sufiinamulhassan/AI-HR-Automation-System/stargazers)
[![Forks](https://img.shields.io/github/forks/sufiinamulhassan/AI-HR-Automation-System?style=flat-square)](https://github.com/sufiinamulhassan/AI-HR-Automation-System/network/members)
[![Issues](https://img.shields.io/github/issues/sufiinamulhassan/AI-HR-Automation-System?style=flat-square)](https://github.com/sufiinamulhassan/AI-HR-Automation-System/issues)
[![Last commit](https://img.shields.io/github/last-commit/sufiinamulhassan/AI-HR-Automation-System?style=flat-square)](https://github.com/sufiinamulhassan/AI-HR-Automation-System/commits)
[![Top language](https://img.shields.io/github/languages/top/sufiinamulhassan/AI-HR-Automation-System?style=flat-square)](https://github.com/sufiinamulhassan/AI-HR-Automation-System)
[![License](https://img.shields.io/github/license/sufiinamulhassan/AI-HR-Automation-System?style=flat-square)](LICENSE)
-->

![Python](https://img.shields.io/badge/Python-3.11%2B-3776AB?style=flat-square&logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.115%2B-009688?style=flat-square&logo=fastapi&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-Motor-47A248?style=flat-square&logo=mongodb&logoColor=white)
![React](https://img.shields.io/badge/React-18.3-61DAFB?style=flat-square&logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-6.0-646CFF?style=flat-square&logo=vite&logoColor=white)

One product, two halves, a **FastAPI** backend and a **Vite + React** SPA, deployed together as
a single Vercel project.

**23 routers · 158 endpoints · 33 services · 470 backend tests · 84 frontend tests**

</div>

---

## Contents

- [What it does](#what-it-does)
- [Languages in this repo](#languages-in-this-repo)
- [Tech stack](#tech-stack)
- [Architecture](#architecture)
- [Repository layout](#repository-layout)
- [Prerequisites](#prerequisites)
- [Setup, step by step](#setup-step-by-step)
- [Environment variables](#environment-variables)
- [How the pipeline works](#how-the-pipeline-works)
- [API surface](#api-surface)
- [Frontend routes](#frontend-routes)
- [Roles and permissions](#roles-and-permissions)
- [Testing](#testing)
- [Deploying to Vercel](#deploying-to-vercel)
- [Conventions](#conventions)
- [Troubleshooting](#troubleshooting)
- [Scope](#scope)
- [Authors](#authors)

---

## What it does

### Recruiting

Write or import a job description. It is parsed into structured targeting criteria, embedded,
and matched against the résumé pool. Bulk upload up to **500 résumés** at a time. Each one is
text extracted, classified, embedded, deduplicated by content hash, matched and scored.
Anything above the auto invite threshold gets an interview invitation with no human involved.

Job descriptions can also be imported from external boards (LinkedIn, Naukri, Dice,
CareerBuilder, Indeed) when the matching API key is set.

### Interviewing

A token linked voice interview. The AI asks, the candidate speaks, the answer is transcribed
and confirmed back to them. Proctoring runs in browser through MediaPipe, so tab switches,
focus loss and face presence anomalies are recorded with timestamps and fed into the
evaluator's prompt.

The result is a scored report covering technical competency, communication, problem solving and
cultural fit, plus a hire / maybe / reject recommendation and any integrity concerns.

### Coding assessment

A separate token linked, in browser coding workspace. Code is executed server side through a
sandbox provider (Judge0 or Piston), with paste blocking, keystroke counting and plagiarism
similarity checking.

### Offers and analytics

Generate offers, send them for token linked acceptance, and push hired candidates to an
external HRMS through a webhook. The analytics dashboard aggregates pipeline metrics, and each
sub metric fails independently so one bad aggregation never blanks the page.

### Administering

Four settings areas, each a tabbed page driven by `?tab=`:

| Page | Tabs |
|---|---|
| **Users & Roles** | accounts, the permission matrix, the audit log |
| **Platform Settings** | webhooks, AI prompts, email templates, system |
| **Organization** | company profile, branding, departments and designations |
| **Interview & Automation** | scenarios, workflow rules, coding question bank, submissions |

---

## Languages in this repo

Measured across tracked source, excluding `node_modules`, `venv`, build output, vendored
MediaPipe assets and `package-lock.json`.

| Language | Files | Lines | Share |
|---|---:|---:|---:|
| Python | 122 | 25,108 | 40.5% |
| TypeScript (React `.tsx`) | 60 | 17,231 | 27.8% |
| CSS | 53 | 12,873 | 20.8% |
| TypeScript (`.ts`) | 30 | 6,669 | 10.8% |
| JavaScript (`.mjs`) | 2 | 116 | 0.2% |
| HTML | 1 | 30 | 0.1% |
| **Total code** | **268** | **62,027** | **100%** |

Counting both TypeScript kinds together, the frontend is 90 files and 23,900 lines, which is
38.5% of the codebase. Add JSON config and Markdown docs and the repo is 279 files, 65,425
lines.

| Language | Where it is used |
|---|---|
| **Python 3.11+** | `backend/` and `api/`, developed and tested on 3.14 |
| **TypeScript 5.7** | `frontend/src/`, strict mode, `.ts` and `.tsx` |
| **CSS** | `frontend/src/`, plain CSS, one file per component |
| **JavaScript (ESM)** | build scripts and the ESLint config, `.mjs` |
| **HTML** | a single Vite entry point, `frontend/index.html` |

---

## Tech stack

### Backend packages

| Package | Version | Role |
|---|---|---|
| `fastapi` | >= 0.115 | web framework, OpenAPI generation |
| `uvicorn[standard]` | >= 0.30 | ASGI server |
| `pydantic` / `pydantic-settings` | >= 2.9 / >= 2.5 | schemas and env backed settings |
| `motor` / `pymongo` | >= 3.6 / >= 4.10 | **async** MongoDB driver |
| `pinecone` | >= 5.4 | vector store for résumé to JD matching |
| `langgraph` / `langchain` | >= 0.2.50 / >= 0.3 | agent pipelines |
| `openai` | >= 1.55 | LLM, embeddings, TTS, transcription |
| `anthropic` | >= 0.37 | optional second LLM provider |
| `pdfplumber` / `python-docx` | >= 0.11 / >= 1.1 | résumé text extraction |
| `python-jose[cryptography]` | >= 3.3 | JWT |
| `passlib[bcrypt]` + `bcrypt` | >= 1.7.4 + 4.0.1 (pinned) | password hashing |
| `aiosmtplib` | >= 3.0 | async SMTP |
| `reportlab` | >= 4.2 | PDF report export |

### Frontend packages

| Package | Version | Role |
|---|---|---|
| `react` / `react-dom` | 18.3 | UI |
| `react-router-dom` | 6.28 | routing |
| `zustand` | 5.0 | state (auth persisted, model, upload) |
| `axios` | 1.7 | the single HTTP layer, `src/lib/api.ts` |
| `vite` | 6.0 | dev server and bundler |
| `@mediapipe/tasks-vision` | 1.0 | in browser proctoring |
| `mammoth` / `docx-preview` | 1.12 / 0.3 | in browser résumé preview |

There is **no Tailwind, no CSS-in-JS, no component library and no icon package.** Styling is
one plain `.css` file per component using the custom properties in `frontend/src/index.css`.
Icons are inline SVG components.

### Testing tools

| Tool | Scope |
|---|---|
| `pytest` >= 9.0 with `pytest-asyncio` and `anyio` | 470 backend tests |
| `vitest` 2.1 with Testing Library and `jsdom` | 84 frontend tests |
| `eslint` 9 with `typescript-eslint` 8 | linting |

---

## Architecture

```
                    ┌───────────────────────────────────────┐
   Browser  ───────▶│  Vite SPA        frontend/dist        │
                    │  React 18 · Router 6 · Zustand        │
                    └──────────────┬────────────────────────┘
                                   │  /api/v1/*   (same origin, no CORS)
                    ┌──────────────▼────────────────────────┐
                    │  FastAPI         api/index.py         │
                    │  ┌─────────────────────────────────┐  │
                    │  │ routes/     HTTP, authz, shapes │  │
                    │  ├─────────────────────────────────┤  │
                    │  │ services/hr_module/  the work   │  │
                    │  ├─────────────────────────────────┤  │
                    │  │ agents/     LangGraph pipelines │  │
                    │  └─────────────────────────────────┘  │
                    └───┬──────────────┬─────────────┬──────┘
                        │              │             │
                   ┌────▼────┐   ┌─────▼─────┐  ┌────▼────┐
                   │ MongoDB │   │ Pinecone  │  │ OpenAI  │
                   │ (Motor) │   │ (vectors) │  │ Claude  │
                   └─────────┘   └───────────┘  └─────────┘
```

**Layering rule:** `routes/` does HTTP only, meaning validation, authorization and response
shaping. Anything reusable lives in `services/hr_module/`. `agents/` holds the LangGraph
pipelines.

---

## Repository layout

```
AI-HR-Automation-System/
├── api/index.py            Vercel entrypoint, wraps backend/main.py and nothing else
├── vercel.json             build, function config, /api rewrites
├── requirements.txt        the deployable dependency list (Vercel reads root)
│
├── backend/
│   ├── main.py             app + CORS + include_router per area + lifespan
│   ├── requirements.txt    includes the root list, for local installs
│   ├── requirements-dev.txt  adds pytest, never installed by Vercel
│   ├── .env.example        every setting, one comment line each
│   ├── routes/             23 routers, 158 endpoints
│   ├── services/hr_module/ 33 service modules, the actual work
│   ├── agents/             base_agent · resume_agent · interview_agent
│   ├── shared/             auth deps · rate limit · schemas · utils
│   ├── config/             settings (env) · database (get_db) · llm (ask_llm)
│   ├── seed/               demo data and user guide seeding
│   └── tests/              33 API test modules plus 9 in tests/unit/ (no DB needed)
│
└── frontend/
    ├── vite.config.ts · vitest.config.ts · eslint.config.mjs
    ├── scripts/setup-mediapipe.mjs   vendors ~15 MB proctoring assets at build time
    └── src/
        ├── App.tsx                   every route, PrivateRoute and AdminRoute guards
        ├── components/layout/        DashboardLayout, the sidebar and shell
        ├── components/coding/        coding workspace
        ├── modules/m1-hrbot/         DashboardOverview, HRBotDashboard, components
        ├── pages/admin/              the four Admin Settings pages
        ├── pages/interview/          live interview UI and hooks
        ├── pages/guide/              role specific user guides
        ├── lib/api.ts                the single axios layer
        └── store/                    Zustand: auth (persisted), model, upload
```

---

## Prerequisites

| Requirement | Notes |
|---|---|
| **Python 3.11+** | 3.14 recommended |
| **Node.js 18+** | 20+ recommended, npm ships with it |
| **MongoDB** | local install, Docker, or a free Atlas cluster |
| **OpenAI API key** | required for parsing, matching, interviews, TTS and transcription |
| Pinecone account | optional. Without it vector matching is disabled and everything else works |
| SMTP credentials | optional. Without them emails are generated but never sent |

---

## Setup, step by step

### 1. Clone

```bash
git clone https://github.com/sufiinamulhassan/AI-HR-Automation-System.git
cd AI-HR-Automation-System
```

### 2. Start MongoDB

Pick one:

```bash
# Docker
docker run -d -p 27017:27017 --name hirely-mongo mongo:7
```

Or install MongoDB Community locally, or create a free
[Atlas](https://www.mongodb.com/atlas) cluster and copy its SRV connection string.

### 3. Backend: virtual environment and dependencies

```bash
cd backend
python -m venv venv

# Windows
venv/Scripts/pip install -r requirements-dev.txt

# macOS and Linux
venv/bin/pip install -r requirements-dev.txt
```

Use `requirements-dev.txt` locally. It includes `requirements.txt` plus the test tooling.
`requirements.txt` on its own is the deployable set.

### 4. Backend: configuration

```bash
cp .env.example .env
```

Open `.env` and fill in the required values. The minimum for a working system:

```dotenv
MONGODB_URI=mongodb://localhost:27017
OPENAI_API_KEY=sk-...
SECRET_KEY=<32+ random characters>
DEFAULT_SUPERADMIN_EMAIL=you@example.com
DEFAULT_SUPERADMIN_PASSWORD=<12+ chars, not a common password>
FRONTEND_URL=http://localhost:5173
```

Generate a `SECRET_KEY`:

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

> **The app refuses to boot** on the shipped `SECRET_KEY` or `DEFAULT_SUPERADMIN_PASSWORD`
> defaults unless `DEBUG=true`. The startup audit also rejects placeholder looking values such
> as `change-me`, `example`, `your-`, `todo` and `xxx`.

### 5. Backend: run

```bash
uvicorn main:app --reload
```

| URL | What |
|---|---|
| http://localhost:8000 | API root |
| http://localhost:8000/api/docs | Swagger UI |
| http://localhost:8000/api/redoc | ReDoc |
| http://localhost:8000/health | health probe |

On the first successful database connection the superadmin account is seeded from
`DEFAULT_SUPERADMIN_EMAIL` and `DEFAULT_SUPERADMIN_PASSWORD`. That is how you first sign in.

**Read the startup log.** `validate_runtime_config()` prints one line per capability it had to
disable, such as no email transport, no Pinecone, or no LLM key. Those lines are the only
warning you get before a feature silently does nothing.

### 6. Frontend: install and run

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

`npm install` and `npm run dev` both trigger `scripts/setup-mediapipe.mjs`, which vendors the
roughly 15 MB of MediaPipe proctoring assets into `public/`. They are gitignored rather than
committed, so the interview page never depends on a third party CDN at runtime.

UI on **http://localhost:5173**.

### 7. Sign in

Open the UI, go to `/login`, and use the `DEFAULT_SUPERADMIN_EMAIL` and
`DEFAULT_SUPERADMIN_PASSWORD` from your `.env`.

### 8. Optional: demo data

```bash
cd backend
venv/Scripts/python seed/seed_production_data.py    # venv/bin/python on macOS and Linux
venv/Scripts/python seed/seed_user_guides.py        # populates the in-app User Guide
```

---

## Environment variables

Everything not listed here has a working default in `backend/config/settings.py`. Unknown keys
are ignored because `Settings.Config` sets `extra = "ignore"`, so a misspelled variable fails
silently. Check spelling against `settings.py` if a setting seems to do nothing.

### Required

| Variable | Default | Purpose |
|---|---|---|
| `SECRET_KEY` | none | Signs every JWT. 32+ random characters. |
| `DEFAULT_SUPERADMIN_EMAIL` | none | Seeded on the first DB connection. |
| `DEFAULT_SUPERADMIN_PASSWORD` | none | 12+ chars, not a common password. |
| `MONGODB_URI` | `mongodb://localhost:27017` | On Vercel this must be an Atlas SRV string. |
| `MONGODB_DB` | `hr_bot` | Database name. |
| `OPENAI_API_KEY` | none | Parsing, classification, matching, interviews, embeddings, TTS, transcription. |
| `FRONTEND_URL` | `http://localhost:5173` | Every candidate facing link is built from this. |

### Recommended

| Variable | Default | Purpose |
|---|---|---|
| `PINECONE_API_KEY` | none | Without it, résumé to JD vector matching is disabled. |
| `PINECONE_INDEX_NAME` | `hr-bot` | The index must be created with **dimension 1536**. |
| `PINECONE_ENV` | `us-east-1` | Pinecone region. |
| `ALLOWED_ORIGINS` | `["http://localhost:5173","http://localhost:3000"]` | CORS allowlist, JSON array. |
| `DEBUG` | `false` | Verbose logs and relaxed startup checks. **Must be false in production.** |
| `STRICT_SECURITY_VALIDATION` | `false` | Turns startup weak value warnings into a refusal to boot. |
| `ALLOW_DEMO_AUTH` | `false` | **Danger.** `Bearer demo-<role>-token` grants any role with no credentials. Local UI work only. |

### Optional integrations

| Group | Variables | Effect when unset |
|---|---|---|
| **Email** | `EMAIL_HOST` `EMAIL_PORT` `EMAIL_USERNAME` `EMAIL_PASSWORD` `EMAIL_FROM` `EMAIL_FROM_NAME` `EMAIL_USE_TLS` | No invite, OTP, status or offer email is delivered. Links must be copied from the UI by hand. |
| **AWS SES** | `AWS_SES_ENABLED` `AWS_SES_REGION` | Alternative to SMTP. |
| **Code sandbox** | `CODE_SANDBOX_PROVIDER` `JUDGE0_API_URL` `JUDGE0_API_KEY` `JUDGE0_API_HOST` `PISTON_API_URL` `PISTON_API_KEY` | Assessments can be taken but code cannot be executed. |
| **Second LLM** | `ANTHROPIC_API_KEY` | Adds Claude models to the picker. Does **not** cover embeddings, TTS or transcription. |
| **SSO** | `GOOGLE_OAUTH_CLIENT_ID` `GOOGLE_OAUTH_CLIENT_SECRET` `GOOGLE_OAUTH_REDIRECT_URI` | Google sign in unavailable. |
| **Meetings** | `MEETING_PROVIDER` `ZOOM_*` `MS_TEAMS_*` | No meeting links on scheduled interviews. |
| **Outbound** | `WEBHOOK_SIGNING_SECRET` `HRMS_WEBHOOK_URL` `HRMS_AUTH_HEADER` `HRMS_AUTH_TOKEN` `HRMS_AUTO_PUSH_ON_HIRE` | No signed webhooks and no HRMS push. |
| **Job boards** | `LINKEDIN_API_KEY` `NAUKRI_API_KEY` `DICE_API_KEY` `CAREERBUILDER_API_KEY` `INDEED_API_KEY` `JOB_IMPORT_SYNC_INTERVAL_HOURS` | Manual JD entry only, which is the normal path. |

### Tuning

| Variable | Default | Purpose |
|---|---|---|
| `DEFAULT_LLM_MODEL` | `gpt-4o` | Overridable per request or globally by an admin. |
| `RESUME_CLASSIFICATION_MODEL` | `gpt-4o-mini` | Cheaper model for classification. |
| `RESUME_EMBEDDING_MODEL` | `text-embedding-3-small` | 1536 dimensions, must match the Pinecone index. |
| `RESUME_SIMILARITY_THRESHOLD` | `0.35` | Below this a match is not stored. |
| `CROSS_DOMAIN_SIMILARITY_THRESHOLD` | `0.55` | Higher bar for cross domain matches. |
| `AUTO_INVITE_THRESHOLD` | `0.70` | At or above this the system invites with no human review. |
| `RESUME_TOP_N_MATCHES_PER_JD` | `20` | Matches retained per job description. |
| `MAX_BULK_UPLOAD_FILES` | `500` | Per batch résumé ceiling. |
| `INTERVIEW_DURATION_MINUTES` | `30` | Target interview length. |
| `INTERVIEW_QUESTION_COUNT` | `15` | Questions generated. |
| `TTS_VOICE` | `alloy` | OpenAI TTS voice. |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `1440` | JWT lifetime, 24 hours. |
| `INVITE_LINK_EXPIRY_DAYS` | `7` | Candidate link validity. |

> **The two thresholds are the product.** `0.35` decides what a recruiter *sees* in the
> pipeline. `0.70` decides what the system *acts on* without a human. The gap between them is
> the review step. Moving them together removes it.

### Tests only

`MONGODB_TEST_URI`, `MONGODB_TEST`, `PINECONE_API_KEY_TEST` and `PINECONE_INDEX_NAME_TEST`.
The suite runs against these when set, so it never touches real data.

---

## How the pipeline works

### Résumé to invited candidate

1. **Upload** through `POST /api/v1/resumes/bulk-upload`, up to 500 files.
2. **Extract** text with `pdfplumber` and `python-docx`. Parsing is CPU bound, so it runs in an
   executor rather than blocking the event loop.
3. **Deduplicate** using a content hash, which rejects a file already ingested.
4. **Classify** with `RESUME_CLASSIFICATION_MODEL` to extract skills, seniority and domain.
5. **Embed** with `RESUME_EMBEDDING_MODEL` to produce a 1536 dimension vector, upserted to
   Pinecone.
6. **Match** by cosine similarity against every stored JD vector, with a seniority flex window
   and a higher bar for cross domain matches.
7. **Store or act.** Above `RESUME_SIMILARITY_THRESHOLD` the match is stored and appears in the
   pipeline. At or above `AUTO_INVITE_THRESHOLD` an invite is sent automatically.

### Job description to matched pool

1. **Create or import** through `POST /api/v1/jobs`, or import from a job board.
2. **Parse** the JD into structured targeting criteria (`jd_intel`).
3. **Embed** and store as a vector.
4. **Match backwards** against the existing résumé pool, so a job posted today finds candidates
   uploaded last month.
5. **Auto invite** anything clearing the threshold.

Parsing and matching run as a FastAPI background task, so `POST /jobs` returns immediately.

### Interview

1. **Prepare.** Questions are generated from the JD and the candidate's résumé.
2. **Live turn loop.** TTS asks, the candidate speaks, audio is transcribed, the transcript is
   confirmed back to them, and the next question adapts.
3. **Proctoring.** MediaPipe watches for tab switches, focus loss and face anomalies, each
   flagged with a timestamp.
4. **Evaluate.** The transcript *and* the integrity flags go to the evaluator, producing per
   dimension scores and a hire / maybe / reject recommendation.

### Email rules, which are compliance rather than style

| Email | Contains |
|---|---|
| Candidate **invite** | link and instructions only, **no scores** |
| Candidate **status** | "thank you, we'll be in touch", **no report content** |
| **Report** with scores and recommendation | admin only, through the authenticated `/report/{token}` endpoint |
| **PDF export** | admin only, **never emailed** |

---

## API surface

All routers are mounted under `/api/v1`. Full interactive docs at `/api/docs`.

| Prefix | Endpoints | Area |
|---|---:|---|
| `/jobs` | 16 | JD CRUD, import, deadlines, scheduled sync |
| `/coding` | 14 | question bank, sessions, execution, submissions |
| `/candidates` | 13 | pipeline, profiles, notes, timeline |
| `/auth` | 12 | login, OTP, JWT, users, model default |
| `/interview` | 11 | prepare, turn loop, evaluate, report |
| `/rbac` | 9 | roles, permission matrix |
| `/offers` | 9 | generation, acceptance, HRMS push |
| `/intel` | 9 | batches, extraction insights |
| `/admin` | 8 | platform configuration |
| `/workflows` | 7 | trigger, condition and action rules |
| `/resumes` | 7 | upload, bulk ingest, versions |
| `/webhooks` | 6 | outbound webhook config and delivery |
| `/scenarios` | 5 | interview scenarios |
| `/saved-filters` | 5 | saved pipeline filters |
| `/user-guide` | 4 | in-app role guides |
| `/prompt-config` | 4 | AI prompt overrides |
| `/integrations` | 4 | third party connections |
| `/email-templates` | 4 | template CRUD |
| `/company-settings` | 3 | company profile |
| `/branding` | 3 | logo and colours |
| `/sso` | 2 | Google OAuth |
| `/notification-settings` | 2 | event toggles |
| `/analytics` | 1 | the whole dashboard in one call |

`main.py` sets `redirect_slashes=False`, so `/api/v1/jobs` and `/api/v1/jobs/` are **different
paths**.

---

## Frontend routes

### Public

| Path | Page |
|---|---|
| `/` | landing |
| `/login` | sign in with password, OTP or Google SSO |
| `/interview/:token` | candidate interview, token linked and lazy loaded |
| `/coding/:token` | candidate coding assessment |
| `/offer/:token` | offer acceptance |
| `/sso-callback` | OAuth return |

### Dashboard, behind `PrivateRoute`

| Path | Page |
|---|---|
| `/dashboard` | overview |
| `/dashboard/hrbot` | Recruiting: jobs, résumés, candidate pipeline |
| `/dashboard/activity` | ingestion batches and activity |
| `/dashboard/profile` | own profile |
| `/dashboard/guide` | role specific user guide |
| `/dashboard/api-reference` | in-app API reference |

### Admin, behind `AdminRoute`

| Path | Page |
|---|---|
| `/dashboard/users` | Users & Roles, with `?tab=roles` and `?tab=audit` |
| `/dashboard/settings` | Platform Settings, with `?tab=webhooks`, `prompts`, `email` |
| `/dashboard/organization` | Organization, with `?tab=branding` and `?tab=departments` |
| `/dashboard/interview-automation` | scenarios, workflows, questions, submissions |

Merged pages keep `<Navigate>` redirects from their old paths such as `/dashboard/roles`,
`/dashboard/branding` and `/dashboard/webhooks`. Those are **load bearing for existing links
and bookmarks**, so preserve them when editing routes.

---

## Roles and permissions

Three built in roles, plus admin authored custom roles stored in the database:

| Role | Sidebar reads | Can do |
|---|---|---|
| `standard` | Recruiter Portal | the recruiting pipeline |
| `admin` | HR Admin Portal | the above, plus the four admin pages, `audit:read` and `rbac:read` |
| `superadmin` | Super Admin Portal | everything, including user deletion, role assignment, custom roles, activity purge and the spend view |

Permission strings live in `services/hr_module/permissions.py`. **A new endpoint needs its
permission string registered there**, or RBAC silently allows everyone who passes the role
check.

Department scoping through `get_department_scope` narrows visibility where a `department_id` is
set. A job with none stays visible to everyone.

---

## Testing

```bash
# backend
cd backend
venv/Scripts/python -c "import main"        # highest value check in the repo
venv/Scripts/python -m pytest -q            # 470 passed, 1 skipped
venv/Scripts/python -m pytest -q tests/unit # no database required

# frontend
cd frontend
npx tsc -p tsconfig.json --noEmit           # typecheck
npm run lint                                # eslint
npm test                                    # 84 tests
npm run build                               # production build
```

`python -c "import main"` resolves the entire router and service graph, so a bad import shows
up as **one line** instead of a collection error across every test file.

Most of the backend suite needs a live MongoDB, so point `MONGODB_TEST_URI` at a throwaway
database. `tests/unit/` is pure logic and needs nothing.

> `npx tsc -b` currently reports `TS6310` because a referenced project disables emit. Use
> `npx tsc -p tsconfig.json --noEmit` for a clean typecheck.

---

## Deploying to Vercel

One project serves both halves. The Vite build is the static site, and `api/index.py` runs the
FastAPI app as a Python function. `vercel.json` rewrites `/api/*` and `/health` to it, and
everything else to `index.html` for the SPA router. Both sit on one domain, so the browser
never makes a cross origin request. There is **no CORS to configure and no API URL to set**.

### 1. Deploy

```bash
npm i -g vercel
vercel          # first run links the project
vercel --prod
```

Or import the repo at [vercel.com](https://vercel.com), where `vercel.json` is picked up
automatically. Leave the framework preset as **Other**, because the build command and output
directory are already specified.

### 2. Set environment variables

Go to Project, then Settings, then Environment Variables, **before the first deploy**:

| Variable | Why |
|---|---|
| `MONGODB_URI` | Atlas SRV string. Serverless egress IPs are not stable, so the cluster's network access list must allow `0.0.0.0/0`. |
| `OPENAI_API_KEY` | Parsing, matching, interviews. |
| `SECRET_KEY` | JWT signing. Refuses to boot on the default unless `DEBUG=true`. |
| `DEFAULT_SUPERADMIN_EMAIL` and `DEFAULT_SUPERADMIN_PASSWORD` | Seeded on first connect, your first sign in. |
| `FRONTEND_URL` | `https://<your-project>.vercel.app`. A wrong value sends real emails whose links go nowhere. |
| `STRICT_SECURITY_VALIDATION` | Set to `true` on a real deploy. |
| `PINECONE_API_KEY` | Optional. Without it matching is disabled. |
| `EMAIL_*` | Optional. Without SMTP, invites are generated but never sent. |

**Do not set `VITE_API_BASE_URL`.** Leaving it unset is what makes the frontend call its own
origin.

### What serverless changes

Worth knowing before you rely on it, rather than after:

- **Request bodies cap around 4.5 MB.** Bulk upload accepts 500 files, but a batch over that
  ceiling is rejected by the platform before FastAPI sees it. Upload in smaller batches.
- **`maxDuration` is 60 s**, the Hobby ceiling. Raise it in `vercel.json` on a paid plan.
  Background tasks such as résumé processing and JD parse and match run inside the request, so
  a large batch can be cut off mid flight.
- **Fire and forget audit writes may be dropped.** `asyncio.create_task(...)` is not awaited
  and the function can freeze once the response is sent. That is fine for audit logs, but not
  for anything a user is waiting on.
- **The in-process scheduler does not run.** `start_scheduler()` detects the serverless host
  and no-ops. `POST /api/v1/jobs/scheduled-sync` exists but needs an admin bearer token, so
  Vercel Cron cannot drive it. Use an external scheduler that can set a header, or trigger it
  from the admin UI. Stale invite reminders have no HTTP equivalent.
- **Nothing may be written to local disk** or held in module level state between requests.
  `config/database.py` is the one deliberate exception, a cached connection guarded by
  `_initialized`.
- **Cold starts.** The first request after idle opens a fresh MongoDB connection.
  `api/index.py` handles that lazily, so it is slow rather than broken.

If those constraints do not suit the workload, the backend is an ordinary uvicorn app. Run
`backend/` on any host with a long lived process and point `VITE_API_BASE_URL` at it.

---

## Conventions

### Backend rules

- Every handler is `async def`. Motor is async, so **one sync call blocks the whole event
  loop.**
- Never construct a Mongo or Pinecone client. Take `db = Depends(get_db)`.
- Never call an LLM SDK directly. Go through `config.llm.ask_llm`, or model override and cost
  tracking stop working.
- Declare literal paths such as `/announcements` **before** catch-alls such as `/{job_id}`, or
  the catch-all swallows them.
- Register every new endpoint's permission string in `services/hr_module/permissions.py`.
- CPU bound parsing with `pdfplumber` and `python-docx` runs in `asyncio.run_in_executor`.

### Agent rules

- Validate required state keys before entering a node.
- Return only **changed** state keys. Never re-emit the whole state and never mutate in place.
- Never hardcode model IDs. Read `settings.DEFAULT_LLM_MODEL` or the request's
  `model_override`.
- Catch exceptions in any node touching an external service and return `{"error": str(e)}`.
  The conditional edge then routes to `error_node`.

### Frontend rules

- Plain CSS, one file per component, tokens from `src/index.css`.
- Components never call axios directly. Everything goes through `src/lib/api.ts`.
- Icons are inline SVG components, not a package.

---

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| App refuses to boot, "insecure default" | `SECRET_KEY` or `DEFAULT_SUPERADMIN_PASSWORD` is still the shipped value, or looks like a placeholder. Set real values. |
| `bad auth : authentication failed` | MongoDB credentials rejected. Check `MONGODB_URI`, the Atlas user's password, and the network access list. |
| Tests error with "Database connection not initialized" | No reachable MongoDB. Set `MONGODB_TEST_URI`, or run `pytest tests/unit` which needs none. |
| A feature silently does nothing | Its key is unset. Re-read the startup log, which prints one line per disabled capability. |
| Matching returns nothing | No `PINECONE_API_KEY`, or the index was not created with dimension 1536. |
| Emails never arrive | No `EMAIL_HOST` or `AWS_SES_ENABLED`. Links must be copied from the UI. |
| Candidate links point at the wrong host | `FRONTEND_URL` is wrong. |
| A setting appears to be ignored | Unknown keys are silently dropped. Check the spelling against `config/settings.py`. |
| 404 on an endpoint that exists | `redirect_slashes=False`, so the trailing slash matters. |
| Interview page fails to load proctoring | `npm run setup:mediapipe` did not complete. Re-run it. |

---

## Scope

**In scope:** the recruiting pipeline end to end, covering job descriptions, résumé ingestion
and matching, the candidate pipeline, AI voice interviews with proctoring, coding assessments,
offers and analytics, plus the four Admin Settings pages.

**Out of scope**, as three adjacent things this product deliberately does not do:

| Not built | What that means in practice |
|---|---|
| A public talent marketplace | no searchable profile directory, no shareable candidate links |
| An alumni network | no alumni directory, career graph, or re-engagement campaigns |
| A backup and restore admin UI | no in-app export or import of platform data |

The password policy that a security admin page would edit still exists and is still enforced,
because `services/hr_module/security_policy_service.py` backs `routes/auth.py`. There is simply
no screen for changing it, so it runs on its defaults.

These are product decisions rather than gaps to fill in passing. Adding any of them means
building a backend *and* a frontend, so treat it as a real feature rather than a patch.

---

## Authors

Made by:

| Author | GitHub |
|---|---|
| **Sufi Inam Ul Hassan** | [@sufiinamulhassan](https://github.com/sufiinamulhassan) |
| **Syeda Kinza Batool** | [@syedakinzabatool](https://github.com/syedakinzabatool) |

---

## License

See [LICENSE](LICENSE).
