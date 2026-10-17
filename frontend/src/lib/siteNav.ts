import type { SiteLink } from './site'

export interface NavItem extends SiteLink {
  icon: string
  description: string
}

export interface NavFeatured {
  eyebrow: string
  title: string
  description: string
  cta: string
  to: string
}

export interface NavMenu {
  label: string
  to?: string
  items?: NavItem[]
  columns?: 1 | 2
  all?: SiteLink
  featured?: NavFeatured[]
}

export const INTEGRATION_SLUGS = [
  'zoom',
  'microsoft-teams',
  'hrms',
  'single-sign-on',
  'webhooks',
  'email-delivery',
] as const

export const COMPARISON_SLUGS = ['manual-screening', 'traditional-ats', 'one-way-video-interviews'] as const

export type IntegrationSlug = (typeof INTEGRATION_SLUGS)[number]
export type ComparisonSlug = (typeof COMPARISON_SLUGS)[number]

export const INTEGRATION_NAV: NavItem[] = [
  { label: 'Zoom', to: '/integrations/zoom', icon: 'video', description: 'Connect your Zoom account to interviews' },
  { label: 'Microsoft Teams', to: '/integrations/microsoft-teams', icon: 'users', description: 'Connect your Teams account to interviews' },
  { label: 'HR systems', to: '/integrations/hrms', icon: 'database', description: 'Connect your HRMS to the pipeline' },
  { label: 'Single sign-on', to: '/integrations/single-sign-on', icon: 'key', description: 'Sign in with Google or your own identity provider' },
  { label: 'Webhooks', to: '/integrations/webhooks', icon: 'webhook', description: 'Signed events sent to your own systems' },
  { label: 'Email delivery', to: '/integrations/email-delivery', icon: 'mail', description: 'Send from the platform or from your own mail server' },
]

export const COMPARE_NAV: NavItem[] = [
  { label: 'Hirely.ai vs manual screening', to: '/compare/manual-screening', icon: 'search', description: 'Reading every resume by hand, compared' },
  { label: 'Hirely.ai vs a traditional ATS', to: '/compare/traditional-ats', icon: 'database', description: 'A system of record, compared with a screening pipeline' },
  { label: 'Hirely.ai vs one-way video interviews', to: '/compare/one-way-video-interviews', icon: 'video', description: 'Recorded answers, compared with voice interviews and reports' },
]

export const RESOURCE_NAV: NavItem[] = [
  { label: 'Features', to: '/features', icon: 'layers', description: 'Every capability, post to offer' },
  { label: 'Integrations', to: '/integrations', icon: 'plug', description: 'Zoom, Teams, HRMS and webhooks' },
  { label: 'Compare', to: '/compare', icon: 'scale', description: 'How we differ from alternatives' },
  { label: 'ROI calculator', to: '/roi-calculator', icon: 'calculator', description: 'Estimate the hours you save' },
  { label: 'FAQ', to: '/faq', icon: 'help', description: 'Answers to common questions' },
  { label: 'Candidate help', to: '/candidates', icon: 'heart', description: 'What to expect in an interview' },
]

export const TRUST_NAV: NavItem[] = [
  { label: 'Security', to: '/security', icon: 'shield', description: 'How we protect accounts and data' },
  { label: 'Responsible AI', to: '/responsible-ai', icon: 'eye', description: 'People decide, AI assists' },
  { label: 'Trust center', to: '/trust', icon: 'lock', description: 'Every policy and document' },
  { label: 'Privacy Policy', to: '/privacy', icon: 'filecheck', description: 'What we collect and why' },
  { label: 'Candidate Privacy Notice', to: '/candidate-privacy', icon: 'users', description: 'For applicants and interviewees' },
  { label: 'Terms of Service', to: '/terms', icon: 'file', description: 'The terms for using Hirely.ai' },
  { label: 'Data Processing Addendum', to: '/dpa', icon: 'database', description: 'Our duties as your processor' },
  { label: 'Subprocessors', to: '/subprocessors', icon: 'server', description: 'The providers we use' },
  { label: 'Cookie Policy', to: '/cookies', icon: 'cookie', description: 'What the app stores locally' },
  { label: 'Acceptable Use Policy', to: '/acceptable-use', icon: 'scale', description: 'Rules for using the service' },
  { label: 'Accessibility', to: '/accessibility', icon: 'accessibility', description: 'Our goal and reporting barriers' },
]

export const COMPANY_NAV: NavItem[] = [
  { label: 'About us', to: '/about', icon: 'building', description: 'Who builds Hirely.ai and how' },
]

export const NAV_MENUS: NavMenu[] = [
  { label: 'About Us', to: '/about' },
  { label: 'Careers', to: '/careers' },
  {
    label: 'Resources',
    items: RESOURCE_NAV,
    columns: 2,
    featured: [
      {
        eyebrow: 'Features',
        title: 'From job post to offer',
        description: 'Every capability, organised by stage.',
        cta: 'See all features',
        to: '/features',
      },
    ],
  },
  {
    label: 'Trust',
    items: TRUST_NAV,
    columns: 2,
    featured: [
      {
        eyebrow: 'Security',
        title: 'How we protect your data',
        description: 'Access controls, company separation and what we have not published.',
        cta: 'Read about security',
        to: '/security',
      },
      {
        eyebrow: 'Trust center',
        title: 'Every policy in one place',
        description: 'Security, responsible AI, privacy and every legal document.',
        cta: 'Open the trust center',
        to: '/trust',
      },
    ],
  },
  { label: 'Pricing', to: '/pricing' },
  { label: 'Contact Us', to: '/contact' },
]

export const NAV_LOGIN: SiteLink = { label: 'Login', to: '/login' }

export const CONTENT_PATHS: string[] = [
  '/integrations',
  ...INTEGRATION_SLUGS.map(slug => `/integrations/${slug}`),
  '/compare',
  ...COMPARISON_SLUGS.map(slug => `/compare/${slug}`),
  '/roi-calculator',
  '/candidates',
  '/trust',
  '/faq',
]
