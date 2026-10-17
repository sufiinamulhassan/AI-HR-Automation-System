import { useParams } from 'react-router-dom'
import { DataTable, Inline } from '../../components/site/Blocks'
import {
  Btn, CtaBand, FaqList, InfoCard, InfoGrid, PageHero, Section, type Crumb,
} from '../../components/site/kit'
import { RelatedGrid } from '../../components/site/Related'
import { breadcrumbLd, faqLd } from '../../lib/jsonLd'
import type { Comparison } from '../../lib/siteContent'
import { usePageMeta } from '../../lib/usePageMeta'
import NotFoundPage from '../NotFoundPage'
import { COMPARISONS } from './content/comparisons'
import HubView from './HubView'
import { COMPARE_HUB } from './hubConfigs'
import './CompareSection.css'

export function CompareHub() {
  return <HubView hub={COMPARE_HUB} />
}

export function ComparisonDetail() {
  const { slug } = useParams()
  const page = COMPARISONS.find(item => item.slug === slug)
  return page ? <ComparisonView page={page} /> : <NotFoundPage />
}

function ComparisonView({ page }: { page: Comparison }) {
  const crumbs: Crumb[] = [{ label: 'Home', to: '/' }, { label: 'Compare', to: '/compare' }, { label: page.title }]

  usePageMeta({
    title: page.metaTitle,
    description: page.metaDescription,
    jsonLd: [breadcrumbLd(crumbs), ...(page.faqs.length > 0 ? [faqLd(page.faqs)] : [])],
  })

  return (
    <div className="cmp-page">
      <PageHero eyebrow={page.eyebrow} title={page.headline} accent={page.accent} lead={page.lead} />

      <Section id="cmp-summary" eyebrow="The short version" title="Where each approach fits">
        <p className="cmp-summary"><Inline text={page.summary} /></p>
      </Section>

      <Section id="cmp-table" tone="ink" eyebrow="Side by side" title={page.title}>
        <div className="cmp-table">
          <DataTable head={[...page.columns]} rows={page.rows} caption={page.title} />
        </div>
        <p className="cmp-fine">
          This compares approaches in general. Products inside a category differ, so check the details of anything you evaluate.
        </p>
      </Section>

      <Section id="cmp-choose" eyebrow="Choosing" title="When each one is the better fit">
        <InfoGrid columns={2}>
          <InfoCard icon="scale" title="When the other approach is enough" items={page.chooseOther} />
          <InfoCard icon="target" title="When Hirely.ai fits" items={page.chooseHirely} />
        </InfoGrid>
      </Section>

      {page.faqs.length > 0 && (
        <Section id="cmp-faq" eyebrow="Questions" title="Common questions" center>
          <FaqList items={page.faqs} />
        </Section>
      )}

      {page.related.length > 0 && (
        <Section id="cmp-related" eyebrow="Keep exploring" title="Related pages">
          <RelatedGrid paths={page.related} />
        </Section>
      )}

      <CtaBand title="Judge it on your own roles" text="Talk to us and compare the output with how you work today.">
        <Btn to="/contact?topic=sales" variant="white">Talk to sales</Btn>
        <Btn to="/compare" variant="ghost">All comparisons</Btn>
      </CtaBand>
    </div>
  )
}
