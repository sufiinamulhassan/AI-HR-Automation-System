import type { SitePlan, SitePlanFeature } from '../../lib/siteTypes'

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const USD_CENTS = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const POPULAR_TIER = 'growth'

const TAGLINES: Record<string, string> = {
  starter: 'For small teams filling a few roles each month.',
  growth: 'For growing teams that hire every week.',
  max: 'For high volume hiring across several companies.',
  enterprise: 'For large organisations that need their own terms.',
}

export function taglineOf(plan: SitePlan): string {
  return TAGLINES[plan.tier] ?? 'A plan sized for the way you hire.'
}

export function formatPrice(price: number | null): string {
  if (price === null) return 'Custom'
  return Number.isInteger(price) ? USD.format(price) : USD_CENTS.format(price)
}

export function formatCount(value: number | null, singular: string, plural: string = `${singular}s`): string {
  if (value === null) return 'Unlimited'
  return `${value.toLocaleString('en-US')} ${value === 1 ? singular : plural}`
}

export function formatStorage(mb: number | null): string {
  if (mb === null) return 'By usage'
  if (mb >= 1024 && mb % 1024 === 0) return `${mb / 1024} GB`
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  return `${mb} MB`
}

export function formatAllowance(value: number | null | undefined, unlimited: string = 'Agreed'): string {
  if (value === null || value === undefined) return unlimited
  return value.toLocaleString('en-US')
}

function eachPosition(plan: SitePlan): string | null {
  const positions = plan.allowances?.positions_per_month
  if (plan.price_monthly_usd === null || !positions) return null
  const each = plan.price_monthly_usd / positions
  return Number.isInteger(each) ? USD.format(each) : USD_CENTS.format(each)
}

export function perPosition(plan: SitePlan): string | null {
  const each = eachPosition(plan)
  return each === null ? null : `${each} per position`
}

export function ctaLabel(plan: SitePlan): string {
  return plan.price_monthly_usd === null ? 'Get a quote' : `Choose ${plan.label}`
}

export function highlightsOf(plan: SitePlan): string[] {
  const a = plan.allowances
  const out: string[] = []
  if (a) {
    if (a.positions_per_month === null) {
      out.push('Unlimited positions')
      out.push('Resumes and interviews agreed with you')
    } else {
      out.push(`${formatCount(a.positions_per_month, 'position')} a month`)
      if (a.resumes_per_position !== null) out.push(`${formatAllowance(a.resumes_per_position)} resumes per position`)
      if (a.interviews_per_position !== null) out.push(`${formatAllowance(a.interviews_per_position)} AI interviews per position`)
    }
  }
  out.push(formatCount(plan.max_companies, 'company', 'companies'))
  out.push(plan.max_users_per_company === null ? 'Unlimited users' : `${plan.max_users_per_company.toLocaleString('en-US')} users per company`)
  out.push('HRMS included')
  return out
}

export const SERVICES = [
  'AI resume reading, scoring and shortlist',
  'Job description reading and resume matching',
  'AI voice interview, 25 minutes, with scored report and PDF',
  'Coding test with AI review, one per interview',
  'Offer letters and branded emails',
]

export const HRMS_FEATURES = [
  'Employee records',
  'Leave requests and balances',
  'Attendance tracking',
  'Holiday calendar',
  'People insights',
]

const SERVICE_KEYS = new Set(['coding'])

const PAGE_LABELS: Record<string, string> = {
  integrations: 'HRMS sync, Zoom and Teams',
}

const FEATURE_ORDER = ['workflows', 'webhooks', 'integrations', 'custom_smtp', 'performance', 'oidc_sso', 'custom_domain']

export function featuresOf(plan: SitePlan): SitePlanFeature[] {
  const rank = (key: string) => {
    const at = FEATURE_ORDER.indexOf(key)
    return at === -1 ? FEATURE_ORDER.length : at
  }
  return plan.features
    .filter(f => !SERVICE_KEYS.has(f.key))
    .map(f => (PAGE_LABELS[f.key] ? { ...f, label: PAGE_LABELS[f.key] } : f))
    .map((f, i) => ({ f, i }))
    .sort((a, b) => rank(a.f.key) - rank(b.f.key) || a.i - b.i)
    .map(({ f }) => f)
}

export function addedFeatures(plan: SitePlan, previous: SitePlan | undefined): string[] {
  const had = new Set((previous ? featuresOf(previous) : []).filter(f => f.included).map(f => f.key))
  return featuresOf(plan).filter(f => f.included && !had.has(f.key)).map(f => f.label)
}

export type CompareCell = string | boolean

export interface CompareGroup {
  title: string
  rows: { label: string; values: CompareCell[] }[]
}

function monthly(perPositionValue: number | null | undefined, positions: number | null | undefined): string {
  if (perPositionValue === null || perPositionValue === undefined || positions === null || positions === undefined) return 'By usage'
  return (perPositionValue * positions).toLocaleString('en-US')
}

export function compareGroups(plans: SitePlan[]): CompareGroup[] {
  if (plans.length === 0) return []
  const groups: CompareGroup[] = [
    {
      title: 'Price',
      rows: [
        { label: 'Price a month', values: plans.map(p => (p.price_monthly_usd === null ? 'Custom quote' : formatPrice(p.price_monthly_usd))) },
        { label: 'Price per position', values: plans.map(p => eachPosition(p) ?? 'Pay as you go') },
      ],
    },
  ]
  if (plans.some(p => p.allowances)) {
    groups.push({
      title: 'Positions',
      rows: [
        { label: 'Positions open a month', values: plans.map(p => formatAllowance(p.allowances?.positions_per_month, 'Unlimited')) },
        { label: 'Resumes per position', values: plans.map(p => formatAllowance(p.allowances?.resumes_per_position)) },
        { label: 'AI interviews per position', values: plans.map(p => formatAllowance(p.allowances?.interviews_per_position)) },
        { label: 'Resumes a month at full use', values: plans.map(p => monthly(p.allowances?.resumes_per_position, p.allowances?.positions_per_month)) },
        { label: 'AI interviews a month at full use', values: plans.map(p => monthly(p.allowances?.interviews_per_position, p.allowances?.positions_per_month)) },
        { label: 'Resumes stored for 12 months', values: plans.map(p => formatAllowance(p.allowances?.resumes_kept, 'By usage')) },
      ],
    })
  }
  groups.push({ title: 'Services', rows: SERVICES.map(service => ({ label: service, values: plans.map(() => true) })) })
  groups.push({ title: 'HRMS', rows: HRMS_FEATURES.map(item => ({ label: item, values: plans.map(() => true) })) })
  groups.push({
    title: 'Features',
    rows: featuresOf(plans[0]).map(feature => ({
      label: feature.label,
      values: plans.map(p => !!p.features.find(f => f.key === feature.key)?.included),
    })),
  })
  groups.push({
    title: 'Limits',
    rows: [
      { label: 'Companies', values: plans.map(p => formatAllowance(p.max_companies, 'Unlimited')) },
      { label: 'Users per company', values: plans.map(p => formatAllowance(p.max_users_per_company, 'Unlimited')) },
      { label: 'Storage', values: plans.map(p => formatStorage(p.max_storage_mb)) },
    ],
  })
  return groups
}
