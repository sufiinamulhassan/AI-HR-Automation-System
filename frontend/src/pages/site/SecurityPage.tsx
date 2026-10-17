import { DataTable, Inline } from '../../components/site/Blocks'
import { Btn, CtaBand, FaqList, InfoCard, InfoGrid, PageHero, Section } from '../../components/site/kit'
import { SITE } from '../../lib/site'
import { usePageMeta } from '../../lib/usePageMeta'
import './SecurityPage.css'

const CONTROLS_HEAD = ['Area', 'What we do']

const CONTROLS_ROWS: string[][] = [
  ['Passwords', 'Hashed with bcrypt.'],
  ['Sessions', 'Signed JWT tokens, with a session timeout each company can set.'],
  ['Two-step sign-in', 'An authenticator app (TOTP) or an emailed code, with recovery codes.'],
  ['Single sign-on', 'Google sign-in, and sign-in with a company-owned OIDC identity provider.'],
  ['Access control', 'Role-based access with a per-endpoint permission matrix, and department scoping.'],
  ['Company isolation', 'Every record is tied to a company and every query is scoped to it. Vectors are tagged by company.'],
  ['Stored credentials', 'Integration credentials and mail passwords are encrypted at rest with Fernet and shown masked.'],
  ['Start-up checks', 'The API audits its own configuration and refuses to boot with a shipped default secret or default admin password.'],
  ['Rate limiting', 'Applied to sign-in and to the public pages and links candidates use.'],
  ['Uploads', 'Checked for size, type and content signature.'],
  ['Webhooks', 'Signed with HMAC. Target URLs are checked against private-network (SSRF) targets.'],
  ['Audit log', 'Administrative actions are recorded.'],
  ['Candidate email', 'Never carries scores or report content.'],
  ['Hosting', 'One project on Vercel over HTTPS. Data in MongoDB, vectors in Pinecone.'],
]

const FAQ = [
  {
    q: 'Does Hirely.ai support two-step sign-in?',
    a: 'Yes. Users can use an authenticator app (TOTP) or an emailed code, and recovery codes are provided.',
  },
  {
    q: "Can one company see another company's data?",
    a: 'No. Every record is tied to a company and every query is scoped to that company in the data layer. Cross-company access is rejected and covered by automated tests.',
  },
  {
    q: 'Are integration credentials stored in plain text?',
    a: 'No. Integration credentials and mail passwords are encrypted at rest and shown masked in the product.',
  },
  {
    q: 'Do candidate emails include scores?',
    a: 'No. Candidate-facing email never carries scores or report content.',
  },
  {
    q: 'Can candidate data be deleted?',
    a: 'Yes. Candidate records can be erased by candidate or by email address, and resumes, files and vectors are deleted with the candidate. Each company also chooses a retention period. See the [Candidate Privacy Notice](/candidate-privacy).',
  },
  {
    q: 'Does Hirely.ai use tracking cookies?',
    a: 'No advertising, analytics or tracking cookies are used, and there are no third-party trackers. See the [Cookie Policy](/cookies).',
  },
]

export default function SecurityPage() {
  usePageMeta({
    title: 'Security',
    description: 'How Hirely.ai protects accounts, candidate data and public links: access control, company isolation, encrypted credentials and audit logs.',
  })

  return (
    <div className="sc-page">
      <PageHero
        eyebrow="Security"
        title="Security at Hirely.ai"
        lead="How we protect accounts, candidate data and public links, and what we have not published."
      />

      <Section
        id="controls"
        eyebrow="Overview"
        title="Controls at a glance"
        lead="What the platform does, stated plainly. The sections below explain each area."
      >
        <div className="sc-table">
          <DataTable head={CONTROLS_HEAD} rows={CONTROLS_ROWS} caption="Security controls by area" />
        </div>
      </Section>

      <Section
        id="access"
        eyebrow="Access control"
        title="Who can sign in and what they can do"
        lead="Each company sets its own sign-in policy."
      >
        <InfoGrid columns={2}>
          <InfoCard
            tag="Sign-in"
            title="Passwords, sessions and single sign-on"
            items={[
              'Sign in with Google',
              'Sign in with your own OIDC identity provider, on plans that include it',
            ]}
          >
            Passwords are hashed with bcrypt. Sessions use signed JWT tokens.
          </InfoCard>
          <InfoCard tag="Two-step" title="Two-step sign-in">
            Users can add a second step with an authenticator app (TOTP) or an emailed code. Recovery codes are provided.
          </InfoCard>
          <InfoCard
            tag="Policy"
            title="Company security policy"
            items={[
              'Minimum password length',
              'Require a number and require a symbol',
              'Lockout after a set number of failed sign-ins, for a lockout period',
              'Session timeout',
            ]}
          />
          <InfoCard tag="Roles" title="Roles and departments">
            Access is role based, with a per-endpoint permission matrix. Department scoping limits who sees what.
          </InfoCard>
        </InfoGrid>
      </Section>

      <Section
        id="isolation"
        tone="ink"
        eyebrow="Data isolation"
        title="Companies are kept apart"
        lead="Hirely.ai is built for several companies on one deployment. A record belongs to exactly one company."
      >
        <InfoGrid columns={3}>
          <InfoCard tag="Database" title="Scoped in the data layer">
            Every record is tied to a company, and every query is scoped to that company.
          </InfoCard>
          <InfoCard tag="Vector search" title="Tagged by company">
            Resume and job vectors in Pinecone are tagged by company.
          </InfoCard>
          <InfoCard tag="Tests" title="Rejected and tested">
            Cross-company access is rejected, and automated tests cover it.
          </InfoCard>
        </InfoGrid>
      </Section>

      <Section
        id="secrets"
        eyebrow="Secrets and credentials"
        title="Protecting what unlocks other systems"
        lead="Credentials are encrypted, and the API will not start in an unsafe state."
      >
        <InfoGrid columns={2}>
          <InfoCard tag="At rest" title="Encrypted credentials">
            Integration credentials and mail passwords are encrypted at rest with Fernet, an authenticated encryption scheme. They are shown masked in the product.
          </InfoCard>
          <InfoCard tag="Start-up" title="Configuration audit">
            The API audits its own configuration when it starts. It refuses to boot with a shipped default secret or a default admin password.
          </InfoCard>
        </InfoGrid>
      </Section>

      <Section
        id="public-endpoints"
        eyebrow="Public endpoints and uploads"
        title="Protecting the parts anyone can reach"
        lead="Careers pages, applications and candidate links are open to the public, so they are limited and checked."
      >
        <InfoGrid columns={3}>
          <InfoCard tag="Limits" title="Rate limiting">
            Sign-in and the public pages and links candidates use are rate limited: careers, applications, and interview and offer links. IP addresses are used for this and kept only for the short limiting window.
          </InfoCard>
          <InfoCard tag="Files" title="Upload checks">
            Uploaded files are checked for size, type and content signature.
          </InfoCard>
          <InfoCard tag="Webhooks" title="Safe webhook targets">
            Webhook URLs are checked against private-network (SSRF) targets, and outbound payloads carry an HMAC signature.
          </InfoCard>
        </InfoGrid>
      </Section>

      <Section
        id="auditability"
        eyebrow="Auditability"
        title="A record of what changed"
        lead="Admins can see who did what."
      >
        <InfoGrid columns={2}>
          <InfoCard tag="Audit log" title="Administrative actions">
            Administrative actions are recorded in an audit log. Changes to AI prompts and email templates are included.
          </InfoCard>
          <InfoCard tag="Activity" title="Activity feed">
            An activity feed shows recent activity in the workspace.
          </InfoCard>
        </InfoGrid>
      </Section>

      <Section
        id="candidate-safeguards"
        eyebrow="Candidate-facing safeguards"
        title="What candidates see is limited"
        lead="Candidates reach Hirely.ai through links, not accounts."
      >
        <InfoGrid columns={3}>
          <InfoCard tag="Links" title="Unguessable links">
            Interview links and interviewer scorecard links are unguessable tokens.
          </InfoCard>
          <InfoCard tag="Email" title="No scores in candidate email">
            Candidate-facing email never carries scores or report content.
          </InfoCard>
          <InfoCard tag="Branding" title="Your terms, shown to candidates">
            Candidate pages can show your own Terms and Privacy links when your company has set them.
          </InfoCard>
        </InfoGrid>
      </Section>

      <Section
        id="data-lifecycle"
        eyebrow="Data lifecycle"
        title="Keeping data only as long as needed"
        lead="Each company decides how long candidate data stays."
      >
        <InfoGrid columns={3}>
          <InfoCard tag="Retention" title="Set by each company">
            A company chooses how long to keep candidate records and resumes. The minimum is 30 days. If the setting is empty, records are kept until deleted.
          </InfoCard>
          <InfoCard tag="Erasure" title="By candidate or email address">
            Erasure removes personal fields and keeps only a minimal record (ids, status and dates), unless employment records are also confirmed for erasure. Resumes, files and vectors are deleted with the candidate.
          </InfoCard>
          <InfoCard tag="Browser" title="No tracking cookies">
            No advertising, analytics or tracking cookies, and no third-party trackers. Details are in the [Cookie Policy](/cookies).
          </InfoCard>
        </InfoGrid>
        <p className="sc-after">
          <Inline text="For the full picture, read the [Privacy Policy](/privacy) and the [Candidate Privacy Notice](/candidate-privacy)." />
        </p>
      </Section>

      <Section
        id="data-location"
        eyebrow="Where data lives"
        title="Where data lives and who processes it"
        lead="A short list of the systems involved."
      >
        <div className="xv-prose sc-body">
          <ul>
            <li><Inline text="**Hosting:** one project on Vercel, served over HTTPS." /></li>
            <li><Inline text="**Database:** MongoDB." /></li>
            <li><Inline text="**Vector search:** Pinecone." /></li>
            <li><Inline text="**AI, email and code execution:** providers such as OpenAI, optionally Anthropic, an SMTP server or Amazon SES, and a Judge0 or Piston sandbox." /></li>
          </ul>
          <p>
            <Inline text="Where these providers process data depends on how a deployment is configured, so we do not state regions here. The full list, including providers a company can enable, is on the [subprocessors](/subprocessors) page." />
          </p>
        </div>
      </Section>

      <Section
        id="shared-responsibility"
        eyebrow="Shared responsibility"
        title="What we do and what you configure"
        lead="Security depends on both sides."
      >
        <InfoGrid columns={2}>
          <InfoCard
            tag="We do"
            title="Built into the platform"
            items={[
              'Audit the configuration at start-up',
              'Hash passwords and encrypt stored credentials',
              'Rate limit sign-in and public endpoints',
              'Check uploads and webhook URLs',
              'Scope every query to a company',
            ]}
          />
          <InfoCard
            tag="You configure"
            title="Set by your admins"
            items={[
              'Password, lockout and session timeout policy',
              'Roles and department scoping',
              'Single sign-on and two-step sign-in',
              'The retention period for candidate records',
              'Webhook endpoints and integrations',
            ]}
          />
        </InfoGrid>
      </Section>

      <Section id="not-published" eyebrow="Honesty" title="What we have not published">
        <div className="xv-prose sc-body">
          <p>
            We have not published third-party certifications, audit reports, penetration test results or uptime figures. We do not claim any on this page.
          </p>
          <p>
            <Inline text="If you need security documentation for a review, ask through [the contact form](/contact?topic=security)." />
          </p>
        </div>
      </Section>

      <Section
        id="report"
        eyebrow="Security reports"
        title="Report a vulnerability"
        lead="If you think you found a security problem in Hirely.ai, tell us."
      >
        <div className="xv-prose sc-body">
          <p>Please include:</p>
          <ul>
            <li>What you found and where (the page, endpoint or feature)</li>
            <li>The steps to reproduce it</li>
            <li>What you think the impact is</li>
            <li>How we can reach you</li>
          </ul>
          <p>
            <Inline text="Send your report through [the contact form](/contact?topic=security) and choose the security report topic." />
          </p>
          <p>
            Please do not test against other people&apos;s data. Use your own account and your own test data, and stop if you reach data that is not yours.
          </p>
          {SITE.securityEmail && (
            <p>
              <Inline text={`You can also write to [${SITE.securityEmail}](mailto:${SITE.securityEmail}).`} />
            </p>
          )}
        </div>
      </Section>

      <Section id="faq" eyebrow="Questions" title="Frequently asked questions" center>
        <FaqList items={FAQ} />
      </Section>

      <CtaBand title="Need more detail?" text="Ask a security question, or talk to us about your own review.">
        <Btn to="/contact?topic=security" variant="white">Contact us about security</Btn>
        <Btn to="/privacy" variant="ghost">Read the privacy policy</Btn>
      </CtaBand>
    </div>
  )
}
