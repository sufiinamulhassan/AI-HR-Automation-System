# hr_module — API Documentation

## Overview
The hr_module handles the full recruitment lifecycle:
Superadmin → Admins → Job Descriptions → Resume Upload → Auto-Screening → Auto-Invite → Interview → Decision → Offer

## Roles
| Role | Can Do |
|------|--------|
| `superadmin` | Everything + create/delete admins + manage all users |
| `admin` | Upload JDs, upload resumes, view candidates, manage interviews, make decisions |
| `standard` | Read-only access (if enabled) |

## Authentication
```
POST /api/v1/auth/login          # email + password → token or OTP trigger
POST /api/v1/auth/verify-otp     # OTP → token
POST /api/v1/auth/token          # OAuth2 form → token (Swagger UI)
GET  /api/v1/auth/me             # current user info
```

## User Management
```
POST   /api/v1/auth/users        # create admin
GET    /api/v1/auth/users        # superadmin: all users; admin: standard users only
PATCH  /api/v1/auth/users/{email}
DELETE /api/v1/auth/users/{email}
POST   /api/v1/auth/change-password
POST   /api/v1/auth/admin/reset-password
```

## Job Descriptions
```
POST   /api/v1/jobs/             # upload JD → parsed + embedded + match existing resumes (background)
GET    /api/v1/jobs/             # list (paginated, searchable)
GET    /api/v1/jobs/{job_id}
PATCH  /api/v1/jobs/{job_id}     # re-parses + re-matches if description changed
DELETE /api/v1/jobs/{job_id}
GET    /api/v1/jobs/{job_id}/pipeline        # candidates at each stage
PATCH  /api/v1/jobs/{job_id}/pipeline/{resume_id}  # move stage
```

## Resume Upload
```
POST /api/v1/resumes/upload                   # single file (PDF/DOCX)
GET  /api/v1/resumes/                         # list (filterable by domain/seniority)
GET  /api/v1/resumes/{resume_id}
DELETE /api/v1/resumes/{resume_id}

POST /api/v1/intel/resumes/upload-bulk        # up to 500 files → returns batch_id
GET  /api/v1/intel/resumes/batch/{id}/status  # processing progress + auto_invited count
GET  /api/v1/intel/resumes/stats              # pool stats + invite funnel
```

## Auto-Invite Flow
When a resume scores **≥ 0.70** against any open JD:
1. Candidate record created (`invite_type="auto"`)
2. Interview questions pre-generated in background
3. Email sent to candidate with personalised interview link
4. Admin sees candidate in list with `invite_type=auto`

Below 0.70 threshold: resume stored, admin can manually invite.

## Candidate Management
```
POST /api/v1/candidates/                           # manual create + auto-send invite email
GET  /api/v1/candidates/                           # list (filterable by job, status, invite_type)
GET  /api/v1/candidates/{id}
POST /api/v1/candidates/{id}/resend-invite         # resend current invite email (admin)
POST /api/v1/candidates/{id}/regenerate-token      # new token + optional resend (admin)
POST /api/v1/candidates/{id}/decision              # hire / reject / hold
```

## Interview
```
GET  /api/v1/interview/session/{token}             # candidate — validate link, fetch questions
POST /api/v1/interview/session/{token}/speak       # candidate — question text → MP3 (AI reads aloud)
POST /api/v1/interview/session/{token}/transcribe  # candidate — recorded answer audio → text
POST /api/v1/interview/session/{token}/followup    # candidate — adaptive probing follow-up
POST /api/v1/interview/session/{token}/flag        # candidate — record an integrity event
POST /api/v1/interview/session/{token}/submit      # candidate — final transcript, triggers eval
PATCH /api/v1/interview/{candidate_id}/schedule    # ADMIN ONLY — set earliest start time
GET  /api/v1/interview/{candidate_id}/schedule.ics # ADMIN ONLY — calendar invite download
GET  /api/v1/interview/report/{token}              # ADMIN ONLY — full report + scores
GET  /api/v1/interview/report/{token}/pdf          # ADMIN ONLY — PDF export
```

The interview is a **live voice session driven client-side over plain HTTP** —
there is no WebSocket. The backend runs on a Lambda Function URL, which is
request/response only. Each turn: `/speak` synthesises the question, the browser
records the spoken answer and posts it to `/transcribe`, and the confirmed text
is appended to the transcript that `/submit` finally sends for evaluation.

### Session payload
```jsonc
{
  "candidate_name": "…",
  "duration_minutes": 30,
  "questions": ["…"],
  "coding_assigned": false   // does this candidate have a coding question?
}
```
`coding_assigned` exists because the candidate interview screen hosts the coding
workspace inline, on the same page and the **same token** —
`/coding/session/{token}` reuses `candidates.secure_token` rather than minting a
separate invite. Without the flag the client would have to probe that endpoint
and swallow a 400 for every candidate with nothing assigned. It leaks no
question text or test cases; it only says whether the Code tab should exist.

### Integrity flags
`POST /flag` **appends** each event (`$push`); `POST /submit` also appends any
final flags rather than replacing the array — the accumulated history from the
session must survive submission or the recruiter sees a falsely clean score.

| Event | Score weight |
|-------|--------------|
| `tab_switch` | −10 |
| `window_blur` | −8 |
| `page_unload_attempt` | −20 |
| `connection_lost` / `connection_restored` | −5 / 0 |
| `no_face_detected` | −12 |
| `multiple_faces_detected` | −15 |
| `gaze_off_screen` | −6 |
| `terminated_tab_switches` | −40 |
| `fullscreen_exit` | −12 |
| `multiple_displays_detected` | −2 |
| `screen_share_detected` | −25 |
| `paste_blocked` / `drop_blocked` | −8 |
| `paste_burst` | −15 |
| `low_typing_ratio` | −20 |
| *(unrecognised event)* | −3 |

Weights live in `services/hr_module/integrity.py`, shared by the interview and
the coding assessment. The two keep **separate flag arrays** on the candidate
(`integrity_flags` vs `coding_integrity_flags`) — merging them would let a
candidate's coding tab-switches silently lower their interview integrity score.

**What screen lockdown can and cannot do:** a browser cannot lock the operating
system. Fullscreen is enforced and its exit recorded, a second display is
detected via `screen.isExtended`, and a screen capture *started from the page*
is caught — but OS-level sharing (Zoom, OBS), a second machine, or a phone
camera are all invisible to it. The gaze and face signals are what cover those.

### Interview Email Flow
| Event | Email to Candidate | Content |
|-------|-------------------|---------|
| Invited | ✅ | Interview link + instructions |
| Interview completed | ✅ | "Thank you, we'll be in touch" |
| Report / Scores | ❌ | Never sent — admin only |

## Invite Funnel (stats)
```json
{
  "invite_funnel": {
    "auto_invited": 120,
    "manually_invited": 30,
    "interviewed": 65,
    "hired": 18
  }
}
```

## LLM Model Management
```
GET   /api/v1/auth/models          # list available models
PATCH /api/v1/auth/models/default  # set default (persisted to DB + runtime)
```

### Coding assessment scoring

Two independent axes, deliberately kept separate:

| Field | Source | Meaning |
|-------|--------|---------|
| `score` | Judge0 | Test-case pass rate, `100 * passed / total`. Unchanged. |
| `quality_score` | Claude (`CODE_EVAL_MODEL`) | Overall code-quality score, 0–100 |
| `quality` | Claude | Full review: readability, structure, efficiency, idiom, problem-solving, strengths, concerns, approach summary, and feedback for both recruiter and candidate |

The quality review runs **alongside** correctness, never instead of it, and is
best-effort: no `ANTHROPIC_API_KEY`, a provider error, or unparseable output
leaves `quality` as `null` and the submission still scores on its pass rate.

Judge0 alone cannot distinguish a clean solution from an unreadable one that
passes the same tests — both score identically on `score`. That gap is what
`quality` exists to fill.

The evaluator prompt is admin-editable via the `code_evaluation` key in
`PATCH /api/v1/prompt-config/{key}`.

### Static analysis: complexity and plagiarism

Two more fields, both computed by `services/hr_module/code_analysis.py`. Pure
text processing — no code execution, no LLM, no external service — so they run
on every submission at no cost and never fail one.

| Field | Meaning |
|-------|---------|
| `complexity` | `cyclomatic_complexity`, `max_nesting_depth`, `lines_of_code`, `comment_ratio`, `function_count`, `complexity_band` (`low`/`moderate`/`high`/`very_high`) |
| `plagiarism` | `max_similarity`, `flagged`, `threshold`, `checked_against`, `truncated`, and up to 5 `matches` naming the other candidate and submission |
| `plagiarism_flagged` | Convenience boolean — `max_similarity >= PLAGIARISM_SIMILARITY_THRESHOLD` |

Similarity compares k-gram fingerprints of the **identifier-normalised** token
stream: comments and string contents are stripped, identifiers become `V` and
numbers `N`. Renaming variables or reformatting therefore does not lower the
score, while independent solutions to the same short problem land well below the
0.80 default threshold. Only *other* candidates' submissions are compared — a
candidate resubmitting their own attempt is normal behaviour, not plagiarism.

Complexity is advisory. High complexity on a genuinely hard problem is not a
defect, and nothing in the platform gates a decision on it.

**Redaction.** `plagiarism`, `plagiarism_flagged`, `complexity`, `quality_score`
and `code` are admin-only — `GET /coding/submissions/{candidate_id}` returns
them, the candidate-facing `POST /coding/session/{token}/submit` never does.
Of the AI review, a candidate receives only `feedback_for_candidate`; the
recruiter-addressed narrative and the sub-scores stay internal.

### Interview report — coding dimensions

`evaluate_interview()` folds the candidate's latest completed coding submission
into the interview report as `coding_score` (Judge0 pass rate) and
`coding_quality_score` (AI review overall). Both are **additive**:
`overall_score` is not recomputed, so nothing that already reads it changes
meaning. A candidate who was never assigned a coding question leaves both keys
absent, and every consumer renders an absent dimension as `—`/`N/A` rather than
as a zero.

### Video meetings on a scheduled interview

`PATCH /api/v1/interview/{candidate_id}/schedule` accepts `create_meeting: true`
and an optional `meeting_provider` (`zoom` | `teams`). Meeting creation is
best-effort: the schedule saves regardless, and any failure comes back in
`meeting_error` rather than as a 5xx. See `GET /api/v1/integrations/status` for
which providers are configured. Clearing a schedule clears the meeting with it.
