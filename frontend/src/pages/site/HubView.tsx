import { Blocks } from '../../components/site/Blocks'
import type { Block } from '../../components/site/blockModel'
import {
  Btn, CtaBand, PageHero, Section, StatsRow, Steps, type Crumb,
} from '../../components/site/kit'
import { LinkGrid } from '../../components/site/Related'
import { breadcrumbLd } from '../../lib/jsonLd'
import type { Stat, Step } from '../../lib/siteContent'
import type { NavItem } from '../../lib/siteNav'
import { usePageMeta } from '../../lib/usePageMeta'

export interface HubConfig {
  label: string
  metaTitle: string
  metaDescription: string
  eyebrow: string
  headline: string
  accent: string
  lead: string
  stats?: Stat[]
  itemsEyebrow: string
  itemsTitle: string
  itemsLead?: string
  items: NavItem[]
  stepsEyebrow?: string
  stepsTitle?: string
  steps?: Step[]
  extra?: { id: string; eyebrow: string; title: string; blocks: Block[] }
  ctaTitle: string
  ctaText: string
}

export default function HubView({ hub }: { hub: HubConfig }) {
  const crumbs: Crumb[] = [{ label: 'Home', to: '/' }, { label: hub.label }]

  usePageMeta({
    title: hub.metaTitle,
    description: hub.metaDescription,
    jsonLd: [breadcrumbLd(crumbs)],
  })

  return (
    <div className="hub-page">
      <PageHero eyebrow={hub.eyebrow} title={hub.headline} accent={hub.accent} lead={hub.lead} />

      {hub.stats && hub.stats.length > 0 && (
        <Section tone="ink">
          <StatsRow stats={hub.stats} />
        </Section>
      )}

      <Section id="hub-items" eyebrow={hub.itemsEyebrow} title={hub.itemsTitle} lead={hub.itemsLead}>
        <LinkGrid items={hub.items} columns={hub.items.length === 4 ? 2 : 3} />
      </Section>

      {hub.steps && hub.steps.length > 0 && (
        <Section id="hub-steps" tone="ink" eyebrow={hub.stepsEyebrow} title={hub.stepsTitle}>
          <Steps steps={hub.steps} />
        </Section>
      )}

      {hub.extra && (
        <Section id={hub.extra.id} eyebrow={hub.extra.eyebrow} title={hub.extra.title}>
          <div className="xv-prose">
            <Blocks blocks={hub.extra.blocks} />
          </div>
        </Section>
      )}

      <CtaBand title={hub.ctaTitle} text={hub.ctaText}>
        <Btn to="/contact?topic=sales" variant="white">Talk to sales</Btn>
        <Btn to="/pricing" variant="ghost">See pricing</Btn>
      </CtaBand>
    </div>
  )
}
