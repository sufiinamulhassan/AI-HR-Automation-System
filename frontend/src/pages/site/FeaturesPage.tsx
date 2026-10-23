import { DataTable, Inline } from '../../components/site/Blocks'
import { Btn, CtaBand, FaqList, InfoCard, InfoGrid, PageHero, Section } from '../../components/site/kit'
import { usePageMeta } from '../../lib/usePageMeta'
import './FeaturesPage.css'

const INCLUDED = '**Included**'
const NOT_INCLUDED = 'Not included'

const PLAN_HEAD = ['Feature', 'Starter', 'Growth', 'Max', 'Enterprise']

const PLAN_ROWS: string[][] = [
  ['Coding assessments', INCLUDED, INCLUDED, INCLUDED, INCLUDED],
  ['Performance reviews', NOT_INCLUDED, NOT_INCLUDED, INCLUDED, INCLUDED],
  ['Outbound webhooks', NOT_INCLUDED, INCLUDED, INCLUDED, INCLUDED],
  ['Workflow automation', NOT_INCLUDED, INCLUDED, INCLUDED, INCLUDED],
  ['Custom SMTP', NOT_INCLUDED, INCLUDED, INCLUDED, INCLUDED],
  ['SSO with your own identity provider', NOT_INCLUDED, NOT_INCLUDED, NOT_INCLUDED, INCLUDED],
  ['Custom domain', NOT_INCLUDED, NOT_INCLUDED, NOT_INCLUDED, INCLUDED],
  ['HRMS, Zoom and Teams integrations', NOT_INCLUDED, INCLUDED, INCLUDED, INCLUDED],
]

const FAQ = [
  {
    q: 'Does Hirely.ai reject candidates automatically?',
    a: 'No. The platform does not automatically reject candidates, and the recruiter makes every decision. Auto-invite exists, but it is off by default and is switched on only in the deployment settings. See [Responsible AI](/responsible-ai).',
  },
  {
    q: 'Which resume formats can I upload?',
    a: 'PDF, DOC (Word 97 to 2003) and DOCX, with up to 500 files in one bulk upload. The careers page also accepts TXT.',
  },
  {
    q: 'Is the candidate recorded on video?',
    a: "No. Face analysis runs in the candidate's browser, and Hirely.ai does not record or store video. Answers are recorded as audio and transcribed.",
  },
  {
    q: 'Do my jobs appear on the public careers page?',
    a: 'Jobs a company writes in Hirely.ai can be shown on the careers page, and you can opt out per job. Imported jobs are not public by default.',
  },
  {
    q: 'How are companies kept apart?',
    a: 'Every record is tied to a company, and every query is scoped to that company in the data layer. Vectors are tagged by company too. See [Security](/security).',
  },
  {
    q: 'What happens when the monthly AI budget is used up?',
    a: 'New AI actions pause until the next month or until the limit is raised. When storage is full, uploads are refused until space is freed or the limit is raised.',
  },
  {
    q: 'Can we sign in with our own identity provider?',
    a: 'Yes, with OIDC, on the Enterprise plan. Google sign-in is also supported. See [pricing](/pricing) for plan details.',
  },
]

export default function FeaturesPage() {
  usePageMeta({
    title: 'Features',
    description: 'Hirely.ai features: resume matching, voice interviews, coding assessments, offers, a careers site, governance and multiple companies.',
  })

  return (
    <div className="ft-page">
      <PageHero
        eyebrow="Features"
        title="Everything from job post to offer"
        lead="Hirely.ai reads resumes, matches them to your open roles, runs voice interviews and coding assessments, and sends offers. You make every decision."
      />

      <Section
        id="pipeline"
        eyebrow="Hiring pipeline"
        title="From job description to ranked candidates"
        lead="Add a role, add resumes, and every candidate is scored against every open role."
      >
        <InfoGrid columns={2}>
          <InfoCard
            tag="Jobs"
            title="Job descriptions"
            items={[
              'Skills, seniority, location and must-haves',
              'Embedded so they can be matched',
              'Jobs a company writes can be shown on the careers page, with an opt out per job',
              'Imported jobs are not public by default',
            ]}
          >
            Paste a job description or import one. Hirely.ai parses it into structured targeting criteria.
          </InfoCard>
          <InfoCard
            tag="Resumes"
            title="Resume ingest"
            items={[
              'Text extraction',
              'Duplicate detection by content hash',
              'Classification by domain, seniority, skills, experience and education',
              'A 1536-dimension embedding stored in Pinecone',
            ]}
          >
            Upload PDF, DOC (Word 97 to 2003) or DOCX files, up to 500 in one bulk upload.
          </InfoCard>
          <InfoCard
            tag="Matching"
            title="Matching in both directions"
            items={[
              'Vector similarity with skills overlap',
              'A seniority flex window',
              'Relevance thresholds set by the platform operator',
            ]}
          >
            Each resume is scored against every open role, and each role against the resume pool.
          </InfoCard>
          <InfoCard tag="Off by default" title="Auto-invite">
            Candidates above a score threshold can be invited to interview automatically. It is off by default, and it is switched on only in the deployment settings.
          </InfoCard>
        </InfoGrid>
      </Section>

      <Section
        id="interviews"
        tone="ink"
        eyebrow="Interviews"
        title="Voice interviews with a scored report"
        lead="The interview runs on its own. The recruiter reads the result."
      >
        <InfoGrid columns={3}>
          <InfoCard
            tag="Interview"
            title="Voice interviews"
            items={[
              'Answers are recorded as audio and transcribed',
              'Each answer is scored',
              'Interview links are unguessable tokens',
            ]}
          >
            Questions are generated from the candidate's resume and the role. An AI voice asks them and the candidate answers aloud.
          </InfoCard>
          <InfoCard
            tag="Proctoring"
            title="Integrity signals"
            items={[
              'Tab switch, window blur and leaving fullscreen',
              'Multiple displays and screen share detected',
              'No face, multiple faces and gaze off screen',
              'Phone detected and identity mismatch',
              'Connection lost and page unload attempt',
              'An interview can end automatically after repeated tab switches',
            ]}
          >
            Flags for a person to review, shown in the report. Face analysis runs in the candidate's browser, and Hirely.ai does not record or store video.
          </InfoCard>
          <InfoCard
            tag="Report"
            title="Scored report"
            items={['Per-question marks', 'Transcript', 'Integrity flags', 'Recommendation']}
          >
            An integrity score is computed from the flags. It adjusts the interview score, is shown to the recruiter, and does not reject anyone by itself.
          </InfoCard>
        </InfoGrid>
      </Section>

      <Section
        id="coding"
        eyebrow="Coding assessments"
        title="Test code, and check how it was written"
        lead="Coding assessments are part of every plan, with one coding test per AI interview."
      >
        <InfoGrid columns={2}>
          <InfoCard
            tag="Execution"
            title="Run against hidden tests"
            items={['Code runs in an external sandbox service', 'Test cases stay hidden from the candidate']}
          >
            Candidates solve a coding task in an editor, and their code is checked against hidden test cases.
          </InfoCard>
          <InfoCard
            tag="Integrity"
            title="Checks on how the code was written"
            items={[
              'A paste-blocked editor',
              'Typing ratio analysis',
              'Plagiarism comparison',
              'Flags for paste blocked, paste burst and low typing ratio',
            ]}
          />
        </InfoGrid>
      </Section>

      <Section
        id="decisions"
        eyebrow="Decisions and offers"
        title="Move candidates forward and close the loop"
        lead="Stages, scorecards, offers and reviews live next to the candidate record."
      >
        <InfoGrid columns={2}>
          <InfoCard
            tag="Pipeline"
            title="Pipeline stages"
            items={['Bulk actions', 'Saved filters', 'Compare candidates', 'Candidate history timeline']}
          >
            Matched, shortlisted, invited, interviewing, completed, hired and rejected.
          </InfoCard>
          <InfoCard tag="Scorecards" title="Interviewer scorecards">
            Interviewers add their own scorecards through unguessable links.
          </InfoCard>
          <InfoCard
            tag="Offers"
            title="Offer letters"
            items={['PDF letters with an optional .docx letterhead template', 'An emailed offer link', 'A candidate acceptance page']}
          />
          <InfoCard tag="Reviews" title="Performance reviews">
            Run review cycles with review links. Performance reviews are on the Max and Enterprise plans.
          </InfoCard>
        </InfoGrid>
      </Section>

      <Section
        id="careers-site"
        eyebrow="Careers site"
        title="A public page for your open roles"
        lead="Applications arrive already parsed and scored."
      >
        <InfoGrid columns={2}>
          <InfoCard tag="Public" title="Open jobs in one place">
            <p><Inline text="The [careers page](/careers) lists open public jobs from the companies on the platform. Each job has its own page and an apply form." /></p>
          </InfoCard>
          <InfoCard
            tag="Apply"
            title="An apply form that routes correctly"
            items={[
              'Name, email, optional phone and note, and consent',
              'A resume up to 4 MB: PDF, DOC, DOCX or TXT',
              'The application goes only to the company that owns the job',
              'It is parsed and scored automatically',
            ]}
          />
        </InfoGrid>
      </Section>

      <Section
        id="governance"
        tone="ink"
        eyebrow="Administration and governance"
        title="Control who does what, and see what changed"
        lead="Admins configure the platform without a redeploy."
      >
        <InfoGrid columns={3}>
          <InfoCard
            tag="Access"
            title="Roles and departments"
            items={['A per-endpoint permission matrix (RBAC) with roles', 'Department scoping limits who sees what']}
          />
          <InfoCard
            tag="Automation"
            title="Workflows, prompts and templates"
            items={['Workflow rules', 'Editable AI prompts', 'Editable email templates', 'Interview scenarios']}
          />
          <InfoCard
            tag="Connections"
            title="Webhooks and integrations"
            items={[
              'Signed outbound webhooks (HMAC signature, SSRF-protected)',
              'HRMS, Zoom and Teams integrations',
              'Custom SMTP for outgoing email',
            ]}
          />
          <InfoCard
            tag="Identity"
            title="Single sign-on"
            items={['Sign in with Google', 'Sign in with your own OIDC identity provider', 'Two-step sign-in with an authenticator app or an emailed code']}
          />
          <InfoCard
            tag="Brand"
            title="Branding"
            items={['Logo and colours', 'Your own Terms and Privacy links on candidate pages']}
          />
          <InfoCard
            tag="Visibility"
            title="Audit log and activity"
            items={['An audit log of administrative actions', 'An activity feed', 'Analytics']}
          />
        </InfoGrid>
      </Section>

      <Section
        id="multi-company"
        eyebrow="Multiple companies"
        title="Platform, client, company"
        lead="One deployment can serve many organisations, each kept separate."
      >
        <InfoGrid columns={3}>
          <InfoCard tag="Level 1" title="Platform">
            The operator of the deployment. A platform console covers clients, companies, usage, AI cost, billing, health, audit and owners.
          </InfoCard>
          <InfoCard tag="Level 2" title="Client">
            The paying customer. A client owns a plan, and the plan sets how many companies it can have.
          </InfoCard>
          <InfoCard tag="Level 3" title="Company">
            A workspace inside a client, with its own jobs, candidates, settings and branding.
          </InfoCard>
        </InfoGrid>
        <p className="ft-after">
          <Inline text="Every record is tied to a company, and every query is scoped to that company in the data layer. Cross-company access is rejected and covered by automated tests. More on [security](/security)." />
        </p>
      </Section>

      <Section
        id="plans"
        eyebrow="Plans"
        title="What each plan includes"
        lead="A few features depend on your plan."
      >
        <div className="ft-table">
          <DataTable head={PLAN_HEAD} rows={PLAN_ROWS} caption="Features by plan" />
        </div>
        <p className="ft-after">
          <Inline text="Plans also differ in companies, users, monthly AI budget and storage. See [pricing](/pricing) for limits." />
        </p>
      </Section>

      <Section id="faq" eyebrow="Questions" title="Frequently asked questions" center>
        <FaqList items={FAQ} />
      </Section>

      <CtaBand title="See it with your own roles" text="Tell us about your hiring process and we will help you get started.">
        <Btn to="/contact?topic=sales" variant="white">Talk to sales</Btn>
        <Btn to="/pricing" variant="ghost">See pricing</Btn>
      </CtaBand>
    </div>
  )
}
