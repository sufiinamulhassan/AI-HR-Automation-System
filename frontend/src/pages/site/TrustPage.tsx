import { Link } from 'react-router-dom'
import { Inline } from '../../components/site/Blocks'
import {
  Btn, CtaBand, FaqList, InfoCard, InfoGrid, PageHero, Section, type Crumb,
} from '../../components/site/kit'
import { LinkGrid } from '../../components/site/Related'
import { breadcrumbLd, faqLd } from '../../lib/jsonLd'
import { TRUST_NAV } from '../../lib/siteNav'
import { usePageMeta } from '../../lib/usePageMeta'
import { TRUST } from './content/trust'

export default function TrustPage() {
  const crumbs: Crumb[] = [{ label: 'Home', to: '/' }, { label: 'Trust center' }]

  usePageMeta({
    title: 'Trust center',
    description: 'Security, responsible AI, privacy and every legal document for Hirely.ai in one place, with plain answers on what is and is not claimed.',
    jsonLd: [breadcrumbLd(crumbs), faqLd(TRUST.faqs)],
  })

  return (
    <div className="tr-page">
      <PageHero
        eyebrow="Trust center"
        title="How we protect"
        accent="your data and your decisions"
        lead={<Inline text={TRUST.intro} />}
      />

      <Section id="tr-pillars" eyebrow="The essentials" title="Where to start">
        <InfoGrid columns={3}>
          {TRUST.pillars.map(pillar => (
            <InfoCard key={pillar.title} icon={pillar.icon} title={pillar.title}>
              <p><Inline text={pillar.text} /></p>
              {pillar.to && <p><Link to={pillar.to}>Read more</Link></p>}
            </InfoCard>
          ))}
        </InfoGrid>
      </Section>

      <Section id="tr-commitments" tone="ink" eyebrow="What the product does" title="Stated as behaviour, not promises">
        <InfoGrid columns={2}>
          {TRUST.commitments.map(group => (
            <InfoCard key={group.title} title={group.title} items={group.items} />
          ))}
        </InfoGrid>
      </Section>

      <Section id="tr-documents" eyebrow="Documents" title="Every policy and notice">
        <LinkGrid items={TRUST_NAV} columns={3} />
      </Section>

      <Section id="tr-faq" eyebrow="Questions" title="Trust and security questions" center>
        <FaqList items={TRUST.faqs} />
      </Section>

      <CtaBand title="Need more detail?" text="Send a security questionnaire or a question and a person will reply.">
        <Btn to="/contact?topic=security" variant="white">Contact security</Btn>
        <Btn to="/security" variant="ghost">Read about security</Btn>
      </CtaBand>
    </div>
  )
}
