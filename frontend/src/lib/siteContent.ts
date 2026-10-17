import type { Block, DocSection } from '../components/site/blockModel'

export interface Faq {
  q: string
  a: string
}

export interface Feature {
  icon: string
  title: string
  text: string
  to?: string
}

export interface Step {
  title: string
  description: string
}

export interface Stat {
  value: string
  label: string
}

export interface ExplainerSection {
  id: string
  eyebrow: string
  title: string
  lead?: string
  blocks: Block[]
}

export interface Explainer {
  slug: string
  title: string
  icon: string
  metaTitle: string
  metaDescription: string
  eyebrow: string
  headline: string
  accent: string
  lead: string
  stats?: Stat[]
  stepsEyebrow: string
  stepsTitle: string
  steps: Step[]
  featuresEyebrow: string
  featuresTitle: string
  features: Feature[]
  sections: ExplainerSection[]
  plan: string
  faqs: Faq[]
  related: string[]
  ctaTitle: string
  ctaText: string
}

export interface Article {
  slug: string
  title: string
  description: string
  category: string
  readMinutes: number
  intro: string
  takeaways: string[]
  sections: DocSection[]
  faqs: Faq[]
  related: string[]
}

export interface Comparison {
  slug: string
  title: string
  metaTitle: string
  metaDescription: string
  eyebrow: string
  headline: string
  accent: string
  lead: string
  summary: string
  columns: [string, string, string]
  rows: string[][]
  chooseOther: string[]
  chooseHirely: string[]
  faqs: Faq[]
  related: string[]
}

export interface FaqGroup {
  id: string
  title: string
  items: Faq[]
}

export interface CandidateGuide {
  intro: string
  steps: Step[]
  sections: DocSection[]
  faqs: Faq[]
}

export interface TrustCommitment {
  title: string
  items: string[]
}

export interface TrustContent {
  intro: string
  pillars: Feature[]
  commitments: TrustCommitment[]
  faqs: Faq[]
}
