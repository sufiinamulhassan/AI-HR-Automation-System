import { describe, expect, it } from 'vitest'
import type { SitePlan } from '../../lib/siteTypes'
import { featuresTable, formatBudget, formatCount, formatPrice, formatStorage, limitsOf, limitsTable } from './pricingFormat'

const feature = (key: string, label: string, included: boolean) => ({ key, label, included })

const STARTER: SitePlan = {
  tier: 'starter', label: 'Starter', price_monthly_usd: 49, max_companies: 1, max_users_per_company: 5,
  monthly_ai_budget_usd: 25, max_storage_mb: 1024,
  features: [feature('coding', 'Coding assessments', false), feature('webhooks', 'Outbound webhooks', true)],
}
const GROWTH: SitePlan = {
  tier: 'growth', label: 'Growth', price_monthly_usd: 199, max_companies: 3, max_users_per_company: 25,
  monthly_ai_budget_usd: 150, max_storage_mb: 10240,
  features: [feature('coding', 'Coding assessments', true), feature('webhooks', 'Outbound webhooks', true)],
}

describe('formatters', () => {
  it('writes prices in whole dollars, and Custom when there is none', () => {
    expect(formatPrice(49)).toBe('$49')
    expect(formatPrice(1999)).toBe('$1,999')
    expect(formatPrice(null)).toBe('Custom')
  })

  it('writes counts with the right singular or plural', () => {
    expect(formatCount(1, 'company', 'companies')).toBe('1 company')
    expect(formatCount(25, 'company', 'companies')).toBe('25 companies')
    expect(formatCount(3, 'seat')).toBe('3 seats')
    expect(formatCount(null, 'seat')).toBe('Unlimited')
  })

  it('writes the monthly AI budget', () => {
    expect(formatBudget(25)).toBe('$25 a month')
    expect(formatBudget(1000)).toBe('$1,000 a month')
    expect(formatBudget(null)).toBe('Unlimited')
  })

  it('writes storage in the unit people expect', () => {
    expect(formatStorage(512)).toBe('512 MB')
    expect(formatStorage(1024)).toBe('1 GB')
    expect(formatStorage(10240)).toBe('10 GB')
    expect(formatStorage(102400)).toBe('100 GB')
    expect(formatStorage(1536)).toBe('1.5 GB')
    expect(formatStorage(null)).toBe('Unlimited')
  })
})

describe('plan tables', () => {
  it('lists the four limits of a plan', () => {
    expect(limitsOf(STARTER)).toEqual([
      { label: 'Companies', value: '1 company' },
      { label: 'Users per company', value: '5' },
      { label: 'AI usage', value: '$25 a month' },
      { label: 'Storage', value: '1 GB' },
    ])
  })

  it('builds the limits table with one column per plan', () => {
    const { head, rows } = limitsTable([STARTER, GROWTH])
    expect(head).toEqual(['Limit', 'Starter', 'Growth'])
    expect(rows[0]).toEqual(['Companies', '1 company', '3 companies'])
    expect(rows[3]).toEqual(['Storage', '1 GB', '10 GB'])
  })

  it('builds the features table and marks what is included', () => {
    const { head, rows } = featuresTable([STARTER, GROWTH])
    expect(head).toEqual(['Feature', 'Starter', 'Growth'])
    expect(rows).toEqual([
      ['Coding assessments', 'Not included', '**Included**'],
      ['Outbound webhooks', '**Included**', '**Included**'],
    ])
  })

  it('copes with no plans at all', () => {
    expect(limitsTable([])).toEqual({ head: [], rows: [] })
    expect(featuresTable([])).toEqual({ head: ['Feature'], rows: [] })
  })
})
