import type { SitePlan } from '../../lib/siteTypes'

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

export function formatPrice(price: number | null): string {
  return price === null ? 'Custom' : USD.format(price)
}

export function formatCount(value: number | null, singular: string, plural: string = `${singular}s`): string {
  if (value === null) return 'Unlimited'
  return `${value.toLocaleString('en-US')} ${value === 1 ? singular : plural}`
}

export function formatBudget(value: number | null): string {
  return value === null ? 'Unlimited' : `${USD.format(value)} a month`
}

export function formatStorage(mb: number | null): string {
  if (mb === null) return 'Unlimited'
  if (mb >= 1024 && mb % 1024 === 0) return `${mb / 1024} GB`
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  return `${mb} MB`
}

export function limitsOf(plan: SitePlan): { label: string; value: string }[] {
  return [
    { label: 'Companies', value: formatCount(plan.max_companies, 'company', 'companies') },
    { label: 'Users per company', value: plan.max_users_per_company === null ? 'Unlimited' : plan.max_users_per_company.toLocaleString('en-US') },
    { label: 'AI usage', value: formatBudget(plan.monthly_ai_budget_usd) },
    { label: 'Storage', value: formatStorage(plan.max_storage_mb) },
  ]
}

export function limitsTable(plans: SitePlan[]): { head: string[]; rows: string[][] } {
  if (plans.length === 0) return { head: [], rows: [] }
  const labels = limitsOf(plans[0]).map(l => l.label)
  return {
    head: ['Limit', ...plans.map(p => p.label)],
    rows: labels.map((label, i) => [label, ...plans.map(p => limitsOf(p)[i].value)]),
  }
}

export function featuresTable(plans: SitePlan[]): { head: string[]; rows: string[][] } {
  const first = plans[0]
  return {
    head: ['Feature', ...plans.map(p => p.label)],
    rows: (first?.features ?? []).map(feature => [
      feature.label,
      ...plans.map(p => (p.features.find(f => f.key === feature.key)?.included ? '**Included**' : 'Not included')),
    ]),
  }
}
