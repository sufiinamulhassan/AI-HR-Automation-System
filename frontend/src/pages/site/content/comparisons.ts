import type { Comparison } from '../../../lib/siteContent'

export const COMPARISONS: Comparison[] = [
  {
    slug: 'manual-screening',
    title: 'Manual screening',
    metaTitle: 'AI resume screening vs manual screening',
    metaDescription:
      'Reading resumes by hand or scoring them with Hirely.ai? See how they differ on consistency, candidate experience and records, and when manual is enough.',
    eyebrow: 'Comparison',
    headline: 'Screening by hand',
    accent: 'or with Hirely.ai',
    lead: 'Manual screening means a person reads each resume and decides. Hirely.ai reads and scores resumes against every open role, and a person still decides.',
    summary:
      'Manual screening is a sound choice when applications are few and the reader knows the role well. Hirely.ai fits better once the pile is too big to read with care, or when you want every candidate scored by the same method and a record of the result.',
    columns: ['What you compare', 'Manual screening', 'Hirely.ai'],
    rows: [
      [
        'Reading resumes',
        'A person opens and reads each resume. Careful reading is possible, and the time needed grows with every resume. Duplicates are caught only if someone notices.',
        'Each uploaded resume is read automatically: text is extracted, then classified by domain, seniority, skills, experience and education. One bulk upload takes up to 500 files, and a file with the same content as one already uploaded is detected as a duplicate.',
      ],
      [
        'Matching to roles',
        'The reader compares each resume with the role from memory, notes or a checklist.',
        'Each resume is scored against every open role, using vector similarity, skills overlap and a seniority flex window.',
      ],
      [
        'Consistency',
        'Depends on the reader, the time of day and the order of the pile. A written rubric helps.',
        'The same method scores every resume against the criteria parsed from the job description. A recruiter can still overrule any score.',
      ],
      [
        'Candidate experience',
        'A person can reply, answer questions and adjust. How fast depends on workload.',
        'Candidates can apply on the careers page and take a voice interview from a link in their browser. The employer can schedule the interview or leave it open.',
      ],
      [
        'Integrity checks',
        'The interviewer notices what they notice, in person or on a call.',
        'Tab switches, leaving fullscreen, multiple faces, a phone in view and other signals are flagged for a recruiter to review. Camera checks are optional for the candidate.',
      ],
      [
        'Record keeping',
        'Notes, emails and spreadsheets, as complete as the team keeps them.',
        'Scores, transcripts, per-question marks, flags and stage history sit on the candidate record, and an audit log records administrative actions.',
      ],
      [
        'Who decides',
        'The reader.',
        'A recruiter. Scores, summaries and flags are inputs. The platform does not reject candidates automatically, and auto-invite is off by default.',
      ],
      [
        'Setup effort',
        'None beyond a shared folder and a checklist.',
        'Add a job description and upload resumes. Admins can then adjust prompts and interview scenarios.',
      ],
      [
        'Cost drivers',
        'Recruiter and hiring-manager time, which grows with the number of applicants.',
        'A plan with limits on companies, users, monthly AI budget and storage. See the pricing page for the current plans.',
      ],
    ],
    chooseOther: [
      'You get a handful of applications per role and can read each one with care.',
      'The decision rests on judgement that a resume rarely shows, and one experienced person will read every application anyway.',
      'Your policies or local rules do not allow candidate data to be processed by an AI service.',
      'You hire rarely, and a shared folder and a checklist already work.',
    ],
    chooseHirely: [
      'A role draws more resumes than anyone can read with the same care, and you want each one scored against the role.',
      'You want every candidate measured by the same method, with scores you can look back at.',
      'You want first-round interviews to happen without booking a call for every candidate, with a scored report waiting for the recruiter.',
      'You want the resume, interview, coding test, offer and stage history in one record.',
      'You want the decision to stay with a person while the groundwork moves off their desk.',
    ],
    faqs: [
      {
        q: 'Does Hirely.ai replace the person who reads resumes?',
        a: 'No. It scores and ranks, and a recruiter decides who moves forward. Nothing is rejected automatically. See [Responsible AI](/responsible-ai).',
      },
      {
        q: 'Can we keep control of who gets an interview?',
        a: 'Yes. Auto-invite is off by default, so a recruiter invites candidates unless the deployment has switched automatic invitations on.',
      },
      {
        q: 'How could we compare it with what we do today?',
        a: 'Run both on the same roles for a while and compare the shortlists. Start with a few real roles so the comparison is fair.',
      },
    ],
    related: [
      '/features',
      '/responsible-ai',
      '/pricing',
    ],
  },
  {
    slug: 'traditional-ats',
    title: 'Traditional ATS',
    metaTitle: 'AI recruitment platform vs a traditional ATS',
    metaDescription:
      'What an applicant tracking system does, what Hirely.ai adds, and which one suits a small team, a high-volume team, or both used together.',
    eyebrow: 'Comparison',
    headline: 'A traditional ATS',
    accent: 'or Hirely.ai',
    lead: 'A traditional applicant tracking system is built to store applicants and move them through stages. Hirely.ai also tracks stages, and adds resume scoring, voice interviews, coding assessments and reports.',
    summary:
      'A traditional applicant tracking system is the right base when your main need is a durable record of applicants and stages. Hirely.ai fits when reading, interviewing and scoring are where your team loses time, and it can sit alongside an existing system.',
    columns: ['What you compare', 'Traditional ATS', 'Hirely.ai'],
    rows: [
      [
        'Main job',
        'Stores applicants, tracks them through stages and keeps the hiring record.',
        'Reads and scores resumes, interviews candidates by voice, tests code and builds reports. It also tracks stages from matched to hired or rejected.',
      ],
      [
        'Reading resumes',
        'The file and the application fields are stored. Ranking, if there is any, depends on the product.',
        'Every resume is parsed, classified and scored against every open role. Applications from the careers page are parsed and scored automatically.',
      ],
      [
        'Interviews',
        'Interviews that people run are scheduled and tracked. Tools for running them vary by product.',
        'Candidates answer an AI voice interviewer in their browser. Questions come from the resume and the role, and a scored report follows.',
      ],
      [
        'Integrity checks',
        'Not what a stage-tracking system is built to do. Some products add them.',
        'Flags for tab switches, leaving fullscreen, multiple faces, a phone in view and more, for a recruiter to review. No video is stored.',
      ],
      [
        'Candidate experience',
        'A careers page and application form, with email from templates.',
        "A careers page with a per-job apply form, then unguessable links for the interview, coding assessment and offer. Candidate pages can show the employer's own Terms and Privacy links.",
      ],
      [
        'Record keeping',
        'The long-lived record of applicants, stages and notes is the core of the product.',
        'A candidate history timeline, scores, transcripts and flags. An audit log records administrative actions, and each company sets how long records are kept.',
      ],
      [
        'Who decides',
        'People move candidates between stages.',
        'A recruiter. Scores and flags are inputs. The platform does not reject candidates automatically.',
      ],
      [
        'Setup effort',
        'Configure stages, forms and users, and bring existing applicants across.',
        'Add job descriptions and resumes. Admins can adjust prompts, workflow rules and email templates without a redeploy.',
      ],
      [
        'Cost drivers',
        'Set by the vendor you choose, so compare their pricing pages.',
        'A plan with limits on companies, users, monthly AI budget and storage. See the pricing page.',
      ],
    ],
    chooseOther: [
      'You mainly need a dependable record of applicants and stages, and reading and interviewing stay with your team.',
      'Other teams, reports or audits already depend on your current system, and you do not want a second place for candidates.',
      'Your current system already includes screening or interviewing tools you are happy with.',
      'You rely on a connector to a specific system. Hirely.ai offers Zoom, Microsoft Teams, an HRMS push, signed webhooks and single sign-on, not connectors to named applicant tracking products.',
    ],
    chooseHirely: [
      'The slow part of your hiring is reading resumes and running first interviews, not tracking stages.',
      'You want one tool from job description to offer letter, including the careers page.',
      'You want each candidate scored against every open role, and a report that shows how a result came about.',
      'You want to add screening and interviews to a process that already exists, and pass events to other systems through signed webhooks or an HRMS push on plans that include them.',
      'You run hiring for several client companies and need each one kept apart.',
    ],
    faqs: [
      {
        q: 'Is Hirely.ai an applicant tracking system?',
        a: 'It has pipeline stages, bulk actions, saved filters, a candidate history timeline, a careers page and offers, so a team can keep its hiring record in it. Its focus is the work before and between stages: reading, interviewing and scoring.',
      },
      {
        q: 'Can we use Hirely.ai next to our current system?',
        a: 'It can work alongside one if the other system can receive what Hirely.ai sends. Signed webhooks and an HRMS push are available on Growth and Enterprise, and there are no prebuilt connectors to named applicant tracking products. See [integrations](/integrations).',
      },
      {
        q: 'Do applicant tracking systems have AI features too?',
        a: 'Some include screening or interview features. Compare what your own system offers with the [features](/features) list before you decide.',
      },
    ],
    related: ['/features', '/integrations', '/pricing'],
  },
  {
    slug: 'one-way-video-interviews',
    title: 'One-way video interviews',
    metaTitle: 'AI voice interviews vs one-way video interviews',
    metaDescription:
      'How Hirely.ai voice interviews compare with one-way video interviews: question design, what is recorded, scoring, integrity checks and the candidate experience.',
    eyebrow: 'Comparison',
    headline: 'One-way video interviews',
    accent: 'or AI voice interviews',
    lead: 'A one-way video interview asks every candidate the same prepared questions and records a video answer to each, for a reviewer to watch later. A Hirely.ai interview is a voice interview: an AI voice asks questions drawn from the resume and the role, and answers are recorded as audio.',
    summary:
      'One-way video suits roles where seeing and hearing the candidate matters and every answer should respond to the same question. Hirely.ai suits teams that want to read a scored, per-question report, keep video out of storage and leave the decision with a person.',
    columns: ['What you compare', 'One-way video interview', 'Hirely.ai'],
    rows: [
      [
        'What the candidate records',
        'A video answer to each prepared question.',
        'A spoken answer to each question, recorded as audio and transcribed. Hirely.ai does not record or store video.',
      ],
      [
        'Question design',
        'A fixed list of questions written in advance, the same for everyone.',
        "Questions are generated from the candidate's resume and the role, and the AI can add a follow-up after an answer. Admins edit the prompts and interview scenarios.",
      ],
      [
        'What the reviewer gets',
        'Recordings to watch. Presence, tone and body language are visible, and watching takes time for every candidate.',
        'A scored report: per-question marks, the transcript, integrity flags and a recommendation. The reviewer reads instead of watching.',
      ],
      [
        'Seeing the candidate',
        'The reviewer sees and hears the candidate.',
        'The reviewer does not see the candidate, because no video is stored.',
      ],
      [
        'Comparing candidates',
        'Same questions in the same order, so answers line up side by side.',
        'Questions differ with each resume, so answers are scored question by question. A compare view lines candidates up by score.',
      ],
      [
        'Integrity checks',
        'Depends on the product. The recording shows what happened on camera.',
        'Flags for tab switches, leaving fullscreen, multiple faces, a phone in view and more, for a recruiter to review. Camera checks run in the browser and are optional for the candidate.',
      ],
      [
        'Technical screening',
        'Whether coding is covered depends on the product.',
        'Coding assessments run against hidden test cases, with a paste-blocked editor and typing analysis, from the same candidate record. They are not part of the Starter plan.',
      ],
      [
        'Candidate experience',
        'Candidates answer on camera, so appearance and surroundings are part of what the reviewer sees.',
        'Candidates answer aloud to an AI voice in their browser. They see a timer, their own camera image and a live transcript, and can choose whether to turn on camera monitoring.',
      ],
      [
        'Cost drivers',
        'Depends on the vendor, plus the reviewer time spent watching recordings.',
        'A plan with limits on companies, users, monthly AI budget and storage. See the pricing page.',
      ],
    ],
    chooseOther: [
      'The role is about presence and communication on camera, such as sales, teaching or customer-facing work, and you want to see and hear candidates.',
      'You need every candidate to answer exactly the same questions in the same order.',
      'Your panel wants to watch recordings and form its own impression rather than read a transcript and a report.',
      'You do not want candidate speech processed by an AI service.',
    ],
    chooseHirely: [
      'You want to review a scored report with a transcript instead of watching every recording.',
      "You want questions that follow from each candidate's resume and the role, with follow-ups.",
      'You prefer not to store video of candidates.',
      'You want the interview, the coding assessment and the integrity flags in one record, with a recruiter making the decision.',
    ],
    faqs: [
      {
        q: 'Is a Hirely.ai interview a video interview?',
        a: "No. The candidate's browser asks for camera and microphone access, but only the answers are recorded, as audio, and then transcribed. If the candidate turns on camera monitoring, face analysis runs in the browser and no video is stored.",
      },
      {
        q: 'Do candidates have to be monitored by camera?',
        a: 'No. Before the interview starts, the candidate chooses whether to enable camera-based monitoring, and the interview goes ahead either way. Integrity flags are signals for a recruiter to review, not proof.',
      },
      {
        q: 'Can a recruiter still see the candidate?',
        a: 'Not in a recording, because no video is stored. If you need to see candidates, Hirely.ai can create Zoom or Microsoft Teams meetings on plans that include those integrations; see [Zoom](/integrations/zoom) and [Microsoft Teams](/integrations/microsoft-teams).',
      },
    ],
    related: [
      '/features',
      '/candidates',
      '/pricing',
    ],
  },
]
