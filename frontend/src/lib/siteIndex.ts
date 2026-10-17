import {
  COMPANY_NAV, COMPARE_NAV, INTEGRATION_NAV, RESOURCE_NAV, TRUST_NAV, type NavItem,
} from './siteNav'

const STATIC: NavItem[] = [
  { label: 'Pricing', to: '/pricing', icon: 'wallet', description: 'Plans, limits and what each one includes' },
  { label: 'Careers', to: '/careers', icon: 'briefcase', description: 'Open roles across companies on the platform' },
  { label: 'Contact us', to: '/contact', icon: 'mail', description: 'Sales, support, privacy and security' },
]

const ALL: NavItem[] = [
  ...STATIC,
  ...INTEGRATION_NAV,
  ...COMPARE_NAV,
  ...RESOURCE_NAV,
  ...TRUST_NAV,
  ...COMPANY_NAV,
]

export const PAGE_INDEX: ReadonlyMap<string, NavItem> = new Map(ALL.map(item => [item.to, item]))

export function pageEntry(path: string): NavItem | undefined {
  return PAGE_INDEX.get(path)
}
