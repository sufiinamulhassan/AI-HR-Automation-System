import { Link } from 'react-router-dom'
import { Blocks, Inline } from '../../components/site/Blocks'
import {
  Btn, CtaBand, FaqList, InfoCard, InfoGrid, PageHero, Section, StatsRow, Steps, type Crumb,
} from '../../components/site/kit'
import { RelatedGrid } from '../../components/site/Related'
import { breadcrumbLd, faqLd } from '../../lib/jsonLd'
import type { Explainer } from '../../lib/siteContent'
import { usePageMeta } from '../../lib/usePageMeta'
import './ExplainerView.css'

export interface ExplainerParent {
  label: string
  to: string
}

export default function ExplainerView({ page, parent }: { page: Explainer; parent: ExplainerParent }) {
  const crumbs: Crumb[] = [{ label: 'Home', to: '/' }, { label: parent.label, to: parent.to }, { label: page.title }]

  usePageMeta({
    title: page.metaTitle,
    description: page.metaDescription,
    jsonLd: [breadcrumbLd(crumbs), ...(page.faqs.length > 0 ? [faqLd(page.faqs)] : [])],
  })

  return (
    <div className="ex-page">
      <PageHero eyebrow={page.eyebrow} title={page.headline} accent={page.accent} lead={page.lead} />

      {page.stats && page.stats.length > 0 && (
        <Section tone="ink">
          <StatsRow stats={page.stats} />
        </Section>
      )}

      <Section id="ex-how" eyebrow={page.stepsEyebrow} title={page.stepsTitle}>
        <Steps steps={page.steps} />
      </Section>

      <Section id="ex-features" tone="ink" eyebrow={page.featuresEyebrow} title={page.featuresTitle}>
        <InfoGrid columns={page.features.length % 3 === 0 ? 3 : 2}>
          {page.features.map(feature => (
            <InfoCard key={feature.title} icon={feature.icon} title={feature.title}>
              <p><Inline text={feature.text} /></p>
            </InfoCard>
          ))}
        </InfoGrid>
      </Section>

      {page.sections.map(section => (
        <Section key={section.id} id={section.id} eyebrow={section.eyebrow} title={section.title} lead={section.lead}>
          <div className="xv-prose ex-prose">
            <Blocks blocks={section.blocks} />
          </div>
        </Section>
      ))}

      <Section id="ex-plan" eyebrow="Availability" title="Which plans include it">
        <div className="xv-prose ex-prose">
          <p><Inline text={page.plan} /></p>
          <p>
            Limits and features by plan are on the <Link to="/pricing">pricing page</Link>.
          </p>
        </div>
      </Section>

      {page.faqs.length > 0 && (
        <Section id="ex-faq" eyebrow="Questions" title={`${page.title}: common questions`} center>
          <FaqList items={page.faqs} />
        </Section>
      )}

      {page.related.length > 0 && (
        <Section id="ex-related" eyebrow="Keep exploring" title="Related pages">
          <RelatedGrid paths={page.related} />
        </Section>
      )}

      <CtaBand title={page.ctaTitle} text={page.ctaText}>
        <Btn to="/contact?topic=sales" variant="white">Talk to sales</Btn>
        <Btn to="/pricing" variant="ghost">See pricing</Btn>
      </CtaBand>
    </div>
  )
}
