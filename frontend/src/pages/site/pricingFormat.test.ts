import { describe, expect, it } from 'vitest'
import type { SitePlan } from '../../lib/siteTypes'
import {
  addedFeatures, compareGroups, ctaLabel, featuresOf, formatAllowance, formatCount, formatPrice,
  formatStorage, highlightsOf, perPosition, SERVICES, taglineOf,
} from './pricingFormat'

const feature = (key: string, label: string, included: boolean) => ({ key, label, included })

const STARTER: SitePlan = {
  tier: 'starter', label: 'Starter', price_monthly_usd: 125, max_companies: 1, max_users_per_company: 5,
  monthly_ai_budget_usd: 40, max_storage_mb: 10240,
  allowances: { positions_per_month: 10, resumes_per_position: 250, interviews_per_position: 20, resumes_kept: 30000 },
  features: [feature('coding', 'Coding assessments', true), feature('webhooks', 'Outbound webhooks', false), feature('workflows', 'Workflow automation', false)],
}
const GROWTH: SitePlan = {
  ...STARTER, tier: 'growth', label: 'Growth', price_monthly_usd: 300, max_companies: 3, max_users_per_company: 25,
  allowances: { positions_per_month: 15, resumes_per_position: 500, interviews_per_position: 40, resumes_kept: 90000 },
  features: [feature('coding', 'Coding assessments', true), feature('webhooks', 'Outbound webhooks', true), feature('workflows', 'Workflow automation', true)],
}
const ENTERPRISE: SitePlan = {
  ...GROWTH, tier: 'enterprise', label: 'Enterprise', price_monthly_usd: null, monthly_ai_budget_usd: null, max_storage_mb: null,
  allowances: { positions_per_month: null, resumes_per_position: null, interviews_per_position: null, resumes_kept: null },
}

describe('formatters', () => {
  it('writes prices in whole dollars, and Custom when there is none', () => {
    expect(formatPrice(125)).toBe('$125')
    expect(formatPrice(1999)).toBe('$1,999')
    expect(formatPrice(193.5)).toBe('$193.50')
    expect(formatPrice(null)).toBe('Custom')
  })

  it('writes counts with the right singular or plural', () => {
    expect(formatCount(1, 'company', 'companies')).toBe('1 company')
    expect(formatCount(25, 'company', 'companies')).toBe('25 companies')
    expect(formatCount(null, 'seat')).toBe('Unlimited')
  })

  it('writes storage, with words for no limit', () => {
    expect(formatStorage(10240)).toBe('10 GB')
    expect(formatStorage(1536)).toBe('1.5 GB')
    expect(formatStorage(512)).toBe('512 MB')
    expect(formatStorage(null)).toBe('By usage')
  })

  it('writes allowances, with a word for the ones that are agreed or unlimited', () => {
    expect(formatAllowance(1000)).toBe('1,000')
    expect(formatAllowance(null)).toBe('Agreed')
    expect(formatAllowance(undefined, 'Unlimited')).toBe('Unlimited')
  })
})

describe('plan cards', () => {
  it('works out the price of one position', () => {
    expect(perPosition(STARTER)).toBe('$12.50 per position')
    expect(perPosition(GROWTH)).toBe('$20 per position')
    expect(perPosition(ENTERPRISE)).toBeNull()
  })

  it('labels the call to action by plan', () => {
    expect(ctaLabel(STARTER)).toBe('Choose Starter')
    expect(ctaLabel(ENTERPRISE)).toBe('Get a quote')
  })

  it('gives each plan a tagline, with a fallback', () => {
    expect(taglineOf(GROWTH)).toMatch(/hire every week/)
    expect(taglineOf({ ...GROWTH, tier: 'custom' })).toBe('A plan sized for the way you hire.')
  })

  it('sums up the allowances in short lines', () => {
    expect(highlightsOf(STARTER)).toEqual([
      '10 positions a month', '250 resumes per position', '20 AI interviews per position', '1 company', '5 users per company', 'HRMS included',
    ])
    expect(highlightsOf(ENTERPRISE).slice(0, 2)).toEqual(['Unlimited positions', 'Resumes and interviews agreed with you'])
  })

  it('leaves coding out of the features, because it is a service in every plan', () => {
    expect(featuresOf(GROWTH).map(f => f.key)).toEqual(['workflows', 'webhooks'])
  })

  it('lists only what a plan adds over the one before it', () => {
    expect(addedFeatures(GROWTH, STARTER)).toEqual(['Workflow automation', 'Outbound webhooks'])
    expect(addedFeatures(ENTERPRISE, GROWTH)).toEqual([])
  })
})

describe('comparison', () => {
  it('groups every row under price, positions, services, features and limits', () => {
    const groups = compareGroups([STARTER, GROWTH, ENTERPRISE])
    expect(groups.map(g => g.title)).toEqual(['Price', 'Positions', 'Services', 'HRMS', 'Features', 'Limits'])
    expect(groups.find(g => g.title === 'HRMS')!.rows.every(r => r.values.every(v => v === true))).toBe(true)
    const row = (title: string, label: string) => groups.find(g => g.title === title)!.rows.find(r => r.label === label)!.values
    expect(row('Price', 'Price a month')).toEqual(['$125', '$300', 'Custom quote'])
    expect(row('Price', 'Price per position')).toEqual(['$12.50', '$20', 'Pay as you go'])
    expect(row('Positions', 'Resumes a month at full use')).toEqual(['2,500', '7,500', 'By usage'])
    expect(row('Positions', 'AI interviews a month at full use')).toEqual(['200', '600', 'By usage'])
    expect(row('Features', 'Outbound webhooks')).toEqual([false, true, true])
    expect(groups.find(g => g.title === 'Limits')!.rows.map(r => r.label)).toEqual(['Companies', 'Users per company', 'Storage'])
    expect(groups.find(g => g.title === 'Services')!.rows).toHaveLength(SERVICES.length)
  })

  it('copes with no plans, and with plans that have no allowances', () => {
    expect(compareGroups([])).toEqual([])
    const bare = { ...STARTER, allowances: undefined }
    expect(compareGroups([bare]).map(g => g.title)).toEqual(['Price', 'Services', 'HRMS', 'Features', 'Limits'])
  })
})
