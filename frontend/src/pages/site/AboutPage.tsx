import { Inline } from '../../components/site/Blocks'
import { Btn, CtaBand, InfoCard, InfoGrid, PageHero, Section } from '../../components/site/kit'
import { SITE } from '../../lib/site'
import type { Feature } from '../../lib/siteContent'
import { usePageMeta } from '../../lib/usePageMeta'
import './AboutPage.css'

const BUILDS: Feature[] = [
  {
    icon: 'resume',
    title: 'Resume matching',
    text: 'Job descriptions parsed into targeting criteria, resumes ingested in bulk, and matches made in both directions.',
  },
  {
    icon: 'mic',
    title: 'Voice interviews',
    text: 'Interviews with integrity signals and a scored report for every candidate.',
  },
  {
    icon: 'code',
    title: 'Coding assessments',
    text: 'Code runs in a sandbox against hidden tests.',
  },
  {
    icon: 'usercheck',
    title: 'Candidate pipeline',
    text: 'Scorecards, offers and performance reviews sit next to the candidate record.',
  },
  {
    icon: 'briefcase',
    title: 'Careers site',
    text: 'A public page of open roles. Each application goes to the company that owns the job.',
  },
  {
    icon: 'settings',
    title: 'Administration',
    text: 'Roles, workflows, webhooks, single sign-on, branding and an audit log.',
  },
  {
    icon: 'building2',
    title: 'Many companies',
    text: 'Several companies on one deployment, each kept separate.',
  },
  {
    icon: 'eye',
    title: 'People decide',
    text: 'The platform does not reject candidates on its own, and auto-invite is off by default.',
  },
]

const STACK = [
  '**Backend:** FastAPI and Python',
  '**Frontend:** React and TypeScript',
  '**Database:** MongoDB',
  '**Vector search:** Pinecone',
  '**AI pipelines:** LangGraph',
  '**Hosting:** Vercel, with the frontend and the API deployed together as one project',
]

export default function AboutPage() {
  usePageMeta({
    title: 'About',
    description: 'Hirely.ai is an AI recruitment platform. What we build, how it is built and how we work.',
  })

  return (
    <div className="ab-page">
      <PageHero
        eyebrow="About"
        title="Hiring software"
        accent="where the recruiter decides"
        lead="Hirely.ai is an AI recruitment platform. It removes the work between a job post and a decision."
      />

      <Section
        id="what"
        eyebrow="What it is"
        title="What Hirely.ai is, and why"
        lead="The recruiter makes every decision. The platform does the work in between."
      >
        <div className="xv-prose ab-body">
          <p>
            Hiring involves a lot of reading, matching, scheduling and note taking before a person can decide. Hirely.ai does that work and leaves the decision to the recruiter.
          </p>
          <p>
            <Inline text="It reads resumes, matches them to open roles, runs voice interviews and coding assessments, and produces a scored report for each candidate. For where AI is involved and where it is not, see [Responsible AI](/responsible-ai)." />
          </p>
        </div>
      </Section>

      <Section
        id="build"
        tone="ink"
        eyebrow="Product"
        title="What we build"
        lead="One product for the path from job post to offer."
      >
        <InfoGrid columns={4}>
          {BUILDS.map(item => (
            <InfoCard key={item.title} icon={item.icon} title={item.title}>
              <p>{item.text}</p>
            </InfoCard>
          ))}
        </InfoGrid>
        <p className="ab-after ab-after-dark">
          <Inline text="The details are on the [features](/features) page." />
        </p>
      </Section>

      <Section
        id="stack"
        eyebrow="Stack"
        title="How it is built"
        lead="The main pieces of the stack."
      >
        <div className="xv-prose ab-body">
          <ul>
            {STACK.map(item => <li key={item}><Inline text={item} /></li>)}
          </ul>
        </div>
      </Section>

      <Section
        id="practices"
        tone="ink"
        eyebrow="How we work"
        title="Practices we hold ourselves to"
        lead="Stated as things the product does, not as promises."
      >
        <InfoGrid columns={2}>
          <InfoCard icon="shield" title="It refuses to boot insecurely">
            The API audits its own configuration at start-up and will not start on a shipped default secret or default admin password.
          </InfoCard>
          <InfoCard icon="bell" title="Nothing fails silently">
            When something is switched off or misconfigured, the system says so instead of failing quietly.
          </InfoCard>
          <InfoCard icon="circlecheck" title="Tested, not just demoed">
            The project has thousands of automated tests across the backend and the frontend, including tests that cross-company access is rejected.
          </InfoCard>
          <InfoCard icon="lock" title="Candidate data stays scoped">
            Every query is scoped to a company, and candidate-facing email never carries scores or report content.
          </InfoCard>
        </InfoGrid>
      </Section>

      <Section
        id="company"
        eyebrow="Data"
        title="Who is responsible for data"
        lead="Who decides, and who processes."
      >
        <div className="xv-prose ab-body">
          <p>
            <Inline text="For account, billing, contact-form and site data, Hirely.ai is the controller. For candidate data that a company uploads or collects, the company is the controller and Hirely.ai is the processor. Details are in the [Privacy Policy](/privacy) and the [Data Processing Addendum](/dpa)." />
          </p>
        </div>
      </Section>

      <Section
        id="careers"
        eyebrow="Careers"
        title="Careers on Hirely.ai"
        lead="Open roles from the companies on the platform."
      >
        <div className="xv-prose ab-body">
          <p>
            <Inline text="The [careers page](/careers) lists open roles across the companies that use Hirely.ai. Each application goes only to the company that owns the job." />
          </p>
        </div>
      </Section>

      <Section
        id="contact"
        eyebrow="Contact"
        title="Get in touch"
        lead="Pick the topic that fits, and the message reaches the right place."
      >
        <InfoGrid columns={3}>
          <InfoCard icon="message" title="Questions before you start">
            <p><Inline text="Ask anything about the product: [send us a message](/contact)." /></p>
          </InfoCard>
          <InfoCard icon="wallet" title="Plans and pricing">
            <p><Inline text="Questions about plans and limits: [talk to sales](/contact?topic=sales). Plans are also on the [pricing](/pricing) page." /></p>
          </InfoCard>
          <InfoCard icon="headphones" title="Help with the product">
            <p><Inline text="Something not working: [contact support](/contact?topic=support)." /></p>
          </InfoCard>
        </InfoGrid>
        {SITE.contactEmail && (
          <p className="ab-after">
            <Inline text={`You can also write to [${SITE.contactEmail}](mailto:${SITE.contactEmail}).`} />
          </p>
        )}
      </Section>

      <CtaBand title="Talk to us" text="Ask about plans or send a question.">
        <Btn to="/contact?topic=sales" variant="white">Talk to sales</Btn>
        <Btn to="/contact" variant="ghost">Contact us</Btn>
      </CtaBand>
    </div>
  )
}
