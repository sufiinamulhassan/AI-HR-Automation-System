import { Blocks, Inline } from '../../components/site/Blocks'
import { Btn, CtaBand, FaqList, PageHero, Section, Steps, type Crumb } from '../../components/site/kit'
import { breadcrumbLd, faqLd } from '../../lib/jsonLd'
import { usePageMeta } from '../../lib/usePageMeta'
import { CANDIDATE_GUIDE } from './content/candidates'
import './CandidatesPage.css'

export default function CandidatesPage() {
  const crumbs: Crumb[] = [{ label: 'Home', to: '/' }, { label: 'Candidate help' }]

  usePageMeta({
    title: 'Candidate help: taking an AI interview',
    description: 'What to expect from an AI interview or coding assessment, how to prepare your device, what is checked, and how to manage your data.',
    jsonLd: [breadcrumbLd(crumbs), faqLd(CANDIDATE_GUIDE.faqs)],
  })

  return (
    <div className="cd-page">
      <PageHero
        eyebrow="Candidate help"
        title="Taking an AI interview?"
        accent="Here is what to expect"
        lead={<Inline text={CANDIDATE_GUIDE.intro} />}
      />

      <Section id="cd-journey" eyebrow="Your journey" title="From invite to decision">
        <Steps steps={CANDIDATE_GUIDE.steps} />
      </Section>

      {CANDIDATE_GUIDE.sections.map(section => (
        <Section key={section.id} id={section.id} eyebrow="Guide" title={section.title}>
          <div className="xv-prose cd-prose">
            <Blocks blocks={section.blocks} />
          </div>
        </Section>
      ))}

      <Section id="cd-faq" eyebrow="Questions" title="Common questions from candidates" center>
        <FaqList items={CANDIDATE_GUIDE.faqs} />
      </Section>

      <CtaBand title="Questions about your data?" text="Ask us, and we will pass requests about a candidate record to the employer that holds it.">
        <Btn to="/contact?topic=privacy" variant="white">Make a privacy request</Btn>
        <Btn to="/candidate-privacy" variant="ghost">Read the notice</Btn>
      </CtaBand>
    </div>
  )
}
