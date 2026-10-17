import { PRODUCT_NAME } from './brand'
import { CONTENT_PATHS, RESOURCE_NAV } from './siteNav'

const fromEnv = (name: string): string => String(import.meta.env[name] ?? '').trim()

export const SITE = {
  name: PRODUCT_NAME,
  entity: PRODUCT_NAME,
  contactEmail: fromEnv('VITE_CONTACT_EMAIL') || 'sales@hirely.ai',
  privacyEmail: fromEnv('VITE_PRIVACY_EMAIL'),
  securityEmail: fromEnv('VITE_SECURITY_EMAIL'),
  address: fromEnv('VITE_COMPANY_ADDRESS'),
  governingLaw: fromEnv('VITE_GOVERNING_LAW'),
}

export const LEGAL_UPDATED = { iso: '2026-10-15', label: '15 October 2026' }

export interface SiteLink {
  label: string
  to: string
}

export interface SiteLinkGroup {
  title: string
  links: SiteLink[]
}

export const LEGAL_LINKS: SiteLink[] = [
  { label: 'Terms of Service', to: '/terms' },
  { label: 'Privacy Policy', to: '/privacy' },
  { label: 'Candidate Privacy Notice', to: '/candidate-privacy' },
  { label: 'Cookie Policy', to: '/cookies' },
  { label: 'Acceptable Use Policy', to: '/acceptable-use' },
  { label: 'Data Processing Addendum', to: '/dpa' },
  { label: 'Subprocessors', to: '/subprocessors' },
  { label: 'Accessibility', to: '/accessibility' },
]

const asLinks = (items: { label: string; to: string }[]): SiteLink[] => items.map(({ label, to }) => ({ label, to }))

export const FOOTER_GROUPS: SiteLinkGroup[] = [
  {
    title: 'Product',
    links: [
      { label: 'Features', to: '/features' },
      { label: 'Pricing', to: '/pricing' },
      { label: 'Integrations', to: '/integrations' },
      { label: 'Compare', to: '/compare' },
      { label: 'ROI calculator', to: '/roi-calculator' },
    ],
  },
  {
    title: 'Resources',
    links: asLinks(RESOURCE_NAV).filter(link => ['/faq', '/candidates'].includes(link.to)),
  },
  {
    title: 'Trust',
    links: [
      { label: 'Security', to: '/security' },
      { label: 'Responsible AI', to: '/responsible-ai' },
      { label: 'Trust center', to: '/trust' },
      { label: 'Report a security issue', to: '/contact?topic=security' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'About', to: '/about' },
      { label: 'Careers', to: '/careers' },
      { label: 'Contact', to: '/contact' },
      { label: 'Sign in', to: '/login' },
    ],
  },
  { title: 'Legal', links: LEGAL_LINKS },
]

export const PUBLIC_PATHS: string[] = [
  '/',
  '/features',
  '/pricing',
  '/security',
  '/responsible-ai',
  '/about',
  '/contact',
  ...CONTENT_PATHS,
  ...LEGAL_LINKS.map(link => link.to),
]

export const CONTACT_TOPICS = [
  { value: 'sales', label: 'Pricing and plans' },
  { value: 'support', label: 'Support' },
  { value: 'privacy', label: 'Privacy request' },
  { value: 'security', label: 'Security report' },
  { value: 'other', label: 'Something else' },
] as const

export type ContactTopic = (typeof CONTACT_TOPICS)[number]['value']
