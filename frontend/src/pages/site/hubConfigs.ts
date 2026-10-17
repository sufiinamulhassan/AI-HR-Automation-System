import { p } from '../../components/site/blockModel'
import { COMPARE_NAV, INTEGRATION_NAV } from '../../lib/siteNav'
import type { HubConfig } from './HubView'

export const INTEGRATIONS_HUB: HubConfig = {
  label: 'Integrations',
  metaTitle: 'Integrations: Zoom, Teams, HR systems and more',
  metaDescription: 'Connect Hirely.ai to Zoom, Microsoft Teams, your HR system, single sign-on, signed webhooks and your own mail server.',
  eyebrow: 'Integrations',
  headline: 'Connect it to',
  accent: 'the tools you use',
  lead: 'Meetings, HR records, sign-in, events and email. A company admin sets up each connection, and credentials are stored encrypted.',
  itemsEyebrow: 'Connections',
  itemsTitle: 'Six ways to connect',
  items: INTEGRATION_NAV,
  extra: {
    id: 'hub-availability',
    eyebrow: 'Availability',
    title: 'Which plans include them',
    blocks: [
      p('Zoom, Microsoft Teams, HR system integrations, webhooks and custom SMTP are on the Growth and Enterprise plans.'),
      p('Single sign-on with your own identity provider is on the Enterprise plan. Google sign-in is also supported. Limits and features by plan are on the [pricing page](/pricing).'),
    ],
  },
  ctaTitle: 'Need a connection we do not list?',
  ctaText: 'Tell us what you use and we will say what is possible.',
}

export const COMPARE_HUB: HubConfig = {
  label: 'Compare',
  metaTitle: 'Compare Hirely.ai with the usual alternatives',
  metaDescription: 'How AI screening and voice interviews compare with manual screening, a traditional ATS and one-way video interviews, and when each fits best.',
  eyebrow: 'Compare',
  headline: 'Compare it with',
  accent: 'the usual alternatives',
  lead: 'Three common ways to handle early hiring, set against Hirely.ai. Each page says when the other approach is the better choice.',
  itemsEyebrow: 'Comparisons',
  itemsTitle: 'Three approaches, side by side',
  items: COMPARE_NAV,
  extra: {
    id: 'hub-method',
    eyebrow: 'How we compare',
    title: 'Approaches, not named products',
    blocks: [
      p('We compare approaches, not specific products. Features differ inside any category, so check the details of whatever you are evaluating.'),
      p('If a claim on these pages looks wrong to you, [tell us](/contact?topic=other) and we will look at it.'),
    ],
  },
  ctaTitle: 'See how it works on your roles',
  ctaText: 'Talk to us and judge the comparison for yourself.',
}
