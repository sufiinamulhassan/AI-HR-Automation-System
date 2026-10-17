import { DataTable, Inline } from '../../components/site/Blocks'
import { Btn, CtaBand, FaqList, InfoCard, InfoGrid, PageHero, Section } from '../../components/site/kit'
import { usePageMeta } from '../../lib/usePageMeta'
import './ResponsibleAiPage.css'

const AI_HEAD = ['Task', 'What the AI sees', 'What it produces', 'Who decides']

const AI_ROWS: string[][] = [
  [
    'Resume classification',
    'The text extracted from the resume',
    'Domain, seniority, skills, experience and education',
    'The recruiter reviews the candidate. Nothing is rejected automatically.',
  ],
  [
    'Matching and scoring',
    'The resume and the job description, as extracted fields and embedding vectors',
    'A relevance score against each open role, from vector similarity, skills overlap and a seniority window',
    'The recruiter decides who moves forward. Auto-invite is off by default and is switched on only in the deployment settings.',
  ],
  [
    'Interview question generation',
    "The candidate's resume and the role",
    'The interview questions',
    'Company admins edit the prompts and scenarios. The recruiter reads the result in the report.',
  ],
  [
    'Speech to text and text to speech',
    "The question text, which an AI voice speaks, and the candidate's answer audio, which is transcribed",
    'A spoken question and a transcript of each answer',
    'The recruiter reads the transcript in the report.',
  ],
  [
    'Answer scoring and report summaries',
    'The questions and the transcribed answers',
    'Per-question marks, a summary and a recommendation',
    'The recruiter reads the report and decides.',
  ],
  [
    'Integrity signals',
    "Camera images analysed in the candidate's browser, and browser events such as tab switches",
    'Flags and an integrity score. No video is recorded or stored.',
    'The recruiter reviews the flags. The score does not reject anyone by itself.',
  ],
  [
    'Code evaluation',
    "The candidate's code, the task and the sandbox test results",
    'Reviews of code quality and output correctness, alongside plagiarism and typing checks',
    'The recruiter reviews the results.',
  ],
]

const FAQ = [
  {
    q: 'Does Hirely.ai make hiring decisions?',
    a: 'No. AI outputs are scores, summaries, recommendations and flags. A person makes the hiring decision.',
  },
  {
    q: 'Can the platform reject a candidate on its own?',
    a: 'No. The platform does not automatically reject candidates. An interview can end automatically after repeated tab switches, but that does not reject anyone.',
  },
  {
    q: 'Is auto-invite on?',
    a: 'It is off by default. It is switched on, and its score threshold set, only in the deployment settings.',
  },
  {
    q: 'Is video of candidates recorded?',
    a: "No. Face analysis runs in the candidate's browser, and Hirely.ai does not record or store video.",
  },
  {
    q: 'Do you train models on our data?',
    a: 'No. Hirely.ai has no model-training pipeline and does not train models on customer data.',
  },
  {
    q: 'Which AI providers are used?',
    a: 'OpenAI by default, and Anthropic Claude models when a company or the operator configures them. See [subprocessors](/subprocessors).',
  },
  {
    q: 'Have you published a bias audit?',
    a: 'No. We have not published a bias audit, so please test your own process. See the limits above.',
  },
]

export default function ResponsibleAiPage() {
  usePageMeta({
    title: 'Responsible AI',
    description: 'Where Hirely.ai uses AI, what it produces and who decides. People make hiring decisions, and nothing is rejected automatically.',
  })

  return (
    <div className="ra-page">
      <PageHero
        eyebrow="Responsible AI"
        title="People decide. AI does the groundwork."
        lead="Where Hirely.ai uses AI, what it sees, what it produces, and who makes the call."
      />

      <Section
        id="principles"
        tone="ink"
        eyebrow="Our principles"
        title="How we approach AI in hiring"
        lead="Five rules the product is built around."
      >
        <InfoGrid columns={3}>
          <InfoCard tag="01" title="People decide">
            AI outputs are scores, summaries, recommendations and flags. A recruiter makes every hiring decision.
          </InfoCard>
          <InfoCard tag="02" title="Transparency">
            Reports show per-question marks, the transcript and integrity flags, so a recruiter can see how a result came about.
          </InfoCard>
          <InfoCard tag="03" title="Control">
            Company admins edit AI prompts and email templates. Auto-invite is off by default.
          </InfoCard>
          <InfoCard tag="04" title="Minimal data">
            Face analysis runs in the candidate's browser, and Hirely.ai does not record or store video. We do not train models on customer data.
          </InfoCard>
          <InfoCard tag="05" title="Accountability">
            The audit log records administrative actions, including changes to prompts and templates.
          </InfoCard>
        </InfoGrid>
      </Section>

      <Section
        id="where-ai-is-used"
        eyebrow="AI in the product"
        title="Where AI is used"
        lead="Every use of AI in the product, and who decides after it."
      >
        <div className="ra-table">
          <DataTable head={AI_HEAD} rows={AI_ROWS} caption="Where AI is used in Hirely.ai" />
        </div>
      </Section>

      <Section
        id="human-oversight"
        eyebrow="Human oversight"
        title="A person stays in charge"
        lead="Automation here means doing the groundwork, not making the decision."
      >
        <InfoGrid columns={2}>
          <InfoCard tag="Review" title="A recruiter reviews every result">
            Scores, summaries, recommendations and flags are inputs. A recruiter reads them and makes the hiring decision.
          </InfoCard>
          <InfoCard tag="Deployment setting" title="Auto-invite is off by default">
            Inviting candidates above a score threshold is an automated action. It is switched on, and its threshold set, only in the deployment settings.
          </InfoCard>
          <InfoCard tag="Rejection" title="No automatic rejection">
            The platform does not automatically reject candidates. The integrity score adjusts the interview score and is shown to the recruiter. It does not reject anyone by itself.
          </InfoCard>
          <InfoCard tag="Interviews" title="Interviews can end early">
            An interview can end automatically after repeated tab switches. A person still makes the hiring decision.
          </InfoCard>
        </InfoGrid>
      </Section>

      <Section
        id="your-controls"
        eyebrow="Your controls"
        title="What customers can control"
        lead="Company admins configure the wording and who sees what. The platform operator sets the scoring thresholds."
      >
        <InfoGrid columns={3}>
          <InfoCard
            tag="Platform operator"
            title="Thresholds"
            items={['Relevance thresholds for matching', 'Whether auto-invite is on, and its score threshold']}
          />
          <InfoCard
            tag="Wording"
            title="Prompts and templates"
            items={['Editable AI prompts', 'Interview scenarios', 'Editable email templates']}
          />
          <InfoCard
            tag="Data and access"
            title="Retention and visibility"
            items={[
              'How long candidate records and resumes are kept',
              'Roles and department scoping decide who sees what',
              'An audit log records changes',
            ]}
          />
        </InfoGrid>
      </Section>

      <Section
        id="candidates"
        eyebrow="Candidates"
        title="What candidates are told"
        lead="Candidates can read how their data is handled."
      >
        <div className="xv-prose ra-body">
          <p>
            <Inline text="Our [Candidate Privacy Notice](/candidate-privacy) explains how candidate data is handled when someone applies, interviews or takes an assessment." />
          </p>
          <p>
            Candidate pages can also show your own Terms and Privacy links when your company has set them. Candidate-facing email never carries scores or report content.
          </p>
          <p>
            How your company describes its use of AI to candidates is up to you as the employer.
          </p>
        </div>
      </Section>

      <Section
        id="limits"
        eyebrow="Limits and cautions"
        title="What AI cannot do for you"
        lead="Read these before you rely on a score."
      >
        <div className="xv-prose ra-body">
          <ul>
            <li><Inline text="**AI scores can be wrong.** A score is an estimate. Transcripts can contain errors too." /></li>
            <li><Inline text="**Check for bias in your own process.** Look at who is shortlisted and who is not, and review the criteria and prompts you set." /></li>
            <li><Inline text="**Do not use a score as the only basis for a decision.** Use it alongside the resume, the interview and your own judgement." /></li>
            <li><Inline text="**Integrity flags are signals, not proof.** They are for a person to review." /></li>
            <li><Inline text="**We have not published a bias audit.** Do not read the absence of one as a finding either way." /></li>
          </ul>
        </div>
      </Section>

      <Section
        id="legal"
        eyebrow="Legal responsibilities"
        title="Your obligations as an employer"
        lead="Using a tool does not move the responsibility."
      >
        <div className="xv-prose ra-body">
          <p>
            Employers remain responsible for complying with the laws that apply to automated and AI-assisted hiring, for example in the EU, the UK and some US states. Depending on where you hire, these can cover things like notice to candidates, human review and bias testing.
          </p>
          <p>
            <Inline text="For candidate data, your company is the controller and Hirely.ai is the processor. See the [Data Processing Addendum](/dpa)." />
          </p>
          <aside className="xv-note">
            This page is information, not legal advice. Ask your own counsel what applies to you.
          </aside>
        </div>
      </Section>

      <Section
        id="providers"
        eyebrow="AI providers"
        title="Which providers process AI requests"
        lead="The defaults, and what a company can change."
      >
        <div className="xv-prose ra-body">
          <ul>
            <li><Inline text="**Language models:** OpenAI by default (the gpt-4o family), and Anthropic Claude models when a company or the operator configures them." /></li>
            <li><Inline text="**Embeddings:** OpenAI text-embedding-3-small." /></li>
            <li><Inline text="**Speech:** OpenAI speech models. The candidate's answer audio is sent for transcription." /></li>
            <li><Inline text="**Vector search:** Pinecone." /></li>
          </ul>
          <p>
            <Inline text="Hirely.ai has no model-training pipeline and does not train models on customer data. The full list of providers is on the [subprocessors](/subprocessors) page." />
          </p>
        </div>
      </Section>

      <Section id="faq" eyebrow="Questions" title="Frequently asked questions" center>
        <FaqList items={FAQ} />
      </Section>

      <CtaBand title="Questions about AI in your hiring process?" text="Tell us what you need to know and a person will reply.">
        <Btn to="/contact?topic=other" variant="white">Ask a question</Btn>
        <Btn to="/security" variant="ghost">Read about security</Btn>
      </CtaBand>
    </div>
  )
}
