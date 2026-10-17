import { Btn, CtaBand, FaqList, PageHero, Section, type Crumb } from '../../components/site/kit'
import { breadcrumbLd, faqLd } from '../../lib/jsonLd'
import { usePageMeta } from '../../lib/usePageMeta'
import { FAQ_GROUPS } from './content/faqs'
import './FaqPage.css'

export default function FaqPage() {
  const crumbs: Crumb[] = [{ label: 'Home', to: '/' }, { label: 'FAQ' }]

  usePageMeta({
    title: 'Frequently asked questions',
    description: 'Answers on how Hirely.ai works: AI and decisions, candidates, security and privacy, plans and setup, and integrations.',
    jsonLd: [breadcrumbLd(crumbs), faqLd(FAQ_GROUPS.flatMap(group => group.items))],
  })

  return (
    <div className="faq-page">
      <PageHero
        eyebrow="FAQ"
        title="Questions,"
        accent="answered plainly"
        lead="Short answers on AI and decisions, candidates, security, plans and integrations."
      />

      <section className="xv-card-section">
        <nav className="faq-chips" aria-label="Question topics">
          {FAQ_GROUPS.map(group => (
            <a key={group.id} href={`#${group.id}`} className="faq-chip">{group.title}</a>
          ))}
        </nav>
      </section>

      {FAQ_GROUPS.map(group => (
        <Section key={group.id} id={group.id} eyebrow="Questions" title={group.title} center>
          <FaqList items={group.items} />
        </Section>
      ))}

      <CtaBand title="Still have a question?" text="A person reads every message and replies by email.">
        <Btn to="/contact" variant="white">Contact us</Btn>
        <Btn to="/pricing" variant="ghost">See pricing</Btn>
      </CtaBand>
    </div>
  )
}
