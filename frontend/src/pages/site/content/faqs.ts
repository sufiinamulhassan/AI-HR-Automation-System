import type { FaqGroup } from '../../../lib/siteContent'

export const FAQ_GROUPS: FaqGroup[] = [
  {
    id: 'getting-started',
    title: 'Getting started',
    items: [
      {
        q: 'What does a hiring run look like from start to finish?',
        a: 'You add a job description and upload resumes, and each resume is scored against every open role. A recruiter invites candidates to a voice interview, reads the scored reports and decides. See the [features](/features) page.',
      },
      {
        q: 'What do I need before I start?',
        a: 'A job description and some resumes. You can paste or import the job description, and upload up to 500 resume files in one bulk upload.',
      },
      {
        q: 'Which resume files work, and what happens to duplicates?',
        a: 'The upload takes PDF, DOC (Word 97 to 2003) and DOCX files, and the careers page also takes TXT. A file with the same content as one already uploaded is detected as a duplicate.',
      },
      {
        q: 'How do I see it on my own roles?',
        a: 'Ask us through the [contact form](/contact?topic=sales) and tell us about your hiring process. To plan a trial yourself, start with a few real roles and compare the shortlists with your current process.',
      },
      {
        q: 'Where do candidates apply?',
        a: 'On the [careers page](/careers), where each public job has its own page and an apply form. The application goes only to the company that owns the job, and it is parsed and scored automatically.',
      },
      {
        q: 'How is Hirely.ai different from an applicant tracking system?',
        a: 'A traditional system is built to store applicants and move them through stages. Hirely.ai tracks stages too, and adds resume scoring, voice interviews, coding assessments and reports; see the [full comparison](/compare/traditional-ats).',
      },
    ],
  },
  {
    id: 'ai-and-decisions',
    title: 'AI and decisions',
    items: [
      {
        q: 'Which steps of the process use AI?',
        a: 'Resume classification, matching and scoring, interview question generation, speech to text and text to speech, answer scoring, report summaries and code evaluation, plus the browser checks behind integrity signals. The table on [Responsible AI](/responsible-ai) lists what the AI sees, what it produces and who decides.',
      },
      {
        q: 'Where do the interview questions come from?',
        a: "They are generated from the candidate's resume and the role, and the AI can add a follow-up after an answer. Company admins edit the AI prompts and interview scenarios; see [AI interviews](/features#interviews).",
      },
      {
        q: 'What is in an interview report?',
        a: 'Per-question marks, the transcript, integrity flags and a recommendation. A recruiter reads it and decides, and a report can be downloaded as a PDF or shared through a link that can expire or be revoked. See [reports and scorecards](/features#interviews).',
      },
      {
        q: 'Does the integrity score decide anything?',
        a: 'No. It is computed from the flags and shown to the recruiter, and it does not reject anyone by itself. Flags are signals for a person to review, not proof.',
      },
      {
        q: 'Which AI providers are used?',
        a: 'Language models come from OpenAI by default (the gpt-4o family), or from Anthropic Claude when a company or the operator configures it. Embeddings use OpenAI text-embedding-3-small, and interview speech uses OpenAI speech models. Hirely.ai does not train models on customer data; see [subprocessors](/subprocessors).',
      },
      {
        q: 'Have you published a bias audit?',
        a: 'No. We have not published a bias audit, so test your own process on your own roles and read [Responsible AI](/responsible-ai).',
      },
    ],
  },
  {
    id: 'candidates',
    title: 'Candidates',
    items: [
      {
        q: 'What does a candidate need for an AI interview?',
        a: 'A computer with Google Chrome, a camera, a microphone and speakers or headphones. The page asks the browser for camera and microphone access and enters fullscreen. See the [candidate help page](/candidates).',
      },
      {
        q: 'What is recorded during an interview?',
        a: 'Spoken answers are recorded as audio and transcribed. If the candidate turns on camera monitoring, face analysis runs in the browser and no video is uploaded or stored. Integrity flags such as tab switches are recorded and shown to the recruiter.',
      },
      {
        q: 'Do candidates see their scores?',
        a: "Interview scores and reports go to the recruiter, and email to candidates never carries scores or report content. In a coding assessment, the page shows the candidate's test results and score after the tests run.",
      },
      {
        q: 'What happens if a candidate switches tabs?',
        a: 'The candidate sees a warning, and the event is recorded and shared with the recruiter. On the third time the interview ends and the answers so far are submitted, and a person decides what happens next.',
      },
      {
        q: 'Who tells candidates the outcome?',
        a: 'The employer does. Hirely.ai is the tool and the employer decides, so candidates should contact the employer about the result of an application. The [Candidate Privacy Notice](/candidate-privacy) explains how candidate data is handled.',
      },
    ],
  },
  {
    id: 'security-and-privacy',
    title: 'Security and privacy',
    items: [
      {
        q: 'How does sign-in work?',
        a: "Users sign in with a password (hashed with bcrypt), with Google, or with their company's own OIDC identity provider on the Enterprise plan. A second step with an authenticator app or an emailed code is available, with recovery codes. Each company sets password rules, lockout and session timeout; see [security](/security).",
      },
      {
        q: 'Who can see interview reports and scores?',
        a: 'Access is role based. Reading an interview report is its own permission: the built-in Standard role does not have it, and the Admin and Superadmin roles do. Companies can create custom roles, and department scoping limits which candidates a user sees.',
      },
      {
        q: 'How long is candidate data kept?',
        a: 'Each company chooses how long to keep candidate records and resumes. The minimum is 30 days, and if the setting is empty, records are kept until they are deleted. See the [Candidate Privacy Notice](/candidate-privacy).',
      },
      {
        q: 'How are candidate records erased?',
        a: 'A user with the erase permission can erase a candidate by record or by email address. Erasure removes personal fields and keeps a minimal record of ids, status and dates unless employment records are also confirmed, and resumes, files and vectors are deleted. By default only the Superadmin role has that permission, and a candidate who wants erasure asks the employer or uses the [privacy form](/contact?topic=privacy).',
      },
      {
        q: 'How can we export our data?',
        a: 'Interview reports download as PDF, and the compare view exports a CSV of the candidates on screen. Records of hired candidates can be exported or pushed to an HR system through the HRMS integration, on plans that include it. For anything else, [ask us](/contact?topic=support).',
      },
      {
        q: 'Has Hirely.ai published security certifications?',
        a: 'No. We have not published third-party certifications, audit reports or penetration test results, and we do not claim any. Read what we do state in the [trust center](/trust), or ask through the [security form](/contact?topic=security).',
      },
      {
        q: 'Where is data stored, and who processes it?',
        a: 'The app is hosted on Vercel over HTTPS, data is in MongoDB and resume and job vectors are in Pinecone. Which regions providers use depends on how a deployment is configured, so we do not state them. The [subprocessors](/subprocessors) page lists every provider.',
      },
    ],
  },
  {
    id: 'plans-and-setup',
    title: 'Plans and setup',
    items: [
      {
        q: 'What do the plans limit?',
        a: 'Plans differ in the number of companies, the users per company, the monthly AI budget and storage. The current limits are on the [pricing](/pricing) page, which reads them live.',
      },
      {
        q: 'Which features depend on the plan?',
        a: 'Coding assessments, performance reviews, outbound webhooks, workflow automation, custom SMTP and the HRMS, Zoom and Teams integrations are not part of Starter. SSO with your own identity provider and a custom domain are Enterprise only; see [features](/features).',
      },
      {
        q: 'What if we use up our AI budget early?',
        a: "Once a company's monthly AI budget is spent, new AI actions wait for the next month or for a higher limit. If storage fills up, uploads are refused until space is freed or the limit goes up. To ask about higher limits, use the [sales form](/contact?topic=sales).",
      },
      {
        q: 'Can one account run several companies?',
        a: 'Yes, within the plan. A client owns the plan, and the plan sets how many companies it can have, each a separate workspace with its own jobs, candidates, settings and branding. See [multiple companies](/features#multi-company).',
      },
      {
        q: 'Can we use our own branding?',
        a: "Yes. A company sets its logo and colours, and candidate pages can show the company's own Terms and Privacy links. A custom domain is an Enterprise feature.",
      },
    ],
  },
  {
    id: 'integrations',
    title: 'Integrations',
    items: [
      {
        q: 'Which meeting tools can schedule interviews?',
        a: 'Zoom and Microsoft Teams. An admin adds the account in company settings, and Hirely.ai can then create a meeting when an interview is scheduled. These integrations are not part of Starter; see [Zoom](/integrations/zoom) and [Microsoft Teams](/integrations/microsoft-teams).',
      },
      {
        q: 'How does the HRMS integration work?',
        a: 'A company sets an HTTPS address and an optional authentication header. Hirely.ai sends a JSON employee record for a hired candidate to that address, on request or automatically on hire, and keeps a log of each attempt. See [HRMS](/integrations/hrms).',
      },
      {
        q: 'What can webhooks send?',
        a: 'Events such as candidate invited, status changed, hired and rejected, interview completed, scorecard submitted, offer sent, accepted and declined, and application received. Each delivery carries an HMAC signature, private-network addresses are refused, and webhooks are not part of Starter. See [webhooks](/integrations/webhooks).',
      },
      {
        q: 'Can we send email from our own server?',
        a: "Yes, on plans that include custom SMTP. Hirely.ai can also send through Amazon SES when it is enabled, or through the platform's own mail server, and mail passwords are encrypted at rest and shown masked. See [email delivery](/integrations/email-delivery).",
      },
      {
        q: 'Does Hirely.ai connect to our applicant tracking system?',
        a: 'There are no prebuilt connectors to named applicant tracking products. Signed webhooks and the HRMS push can send data to systems that accept web requests, on plans that include them; see [integrations](/integrations).',
      },
    ],
  },
]
