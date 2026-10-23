import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { siteApi } from '../../lib/api'
import type { SitePlan } from '../../lib/siteTypes'
import PricingPage from './PricingPage'
import { expectHeadingOrder, expectMeta, expectNoEmDash, expectValidInternalLinks } from './siteTestKit'

const KEYS: [string, string][] = [
  ['coding', 'Coding assessments'],
  ['performance', 'Performance reviews'],
  ['webhooks', 'Outbound webhooks'],
  ['workflows', 'Workflow automation'],
  ['custom_smtp', 'Own mail server'],
  ['oidc_sso', 'Single sign-on (OIDC)'],
  ['custom_domain', 'Custom domain'],
  ['integrations', 'HRMS, Zoom and Teams'],
]

type Limit = number | null

function plan(
  tier: string, label: string, price: number | null, limits: [Limit, Limit, Limit, Limit],
  allowances: [Limit, Limit, Limit, Limit], off: string[],
): SitePlan {
  return {
    tier, label, price_monthly_usd: price, max_companies: limits[0], max_users_per_company: limits[1],
    monthly_ai_budget_usd: limits[2], max_storage_mb: limits[3],
    allowances: {
      positions_per_month: allowances[0], resumes_per_position: allowances[1],
      interviews_per_position: allowances[2], resumes_kept: allowances[3],
    },
    features: KEYS.map(([key, name]) => ({ key, label: name, included: !off.includes(key) })),
  }
}

const PLANS = [
  plan('starter', 'Starter', 109, [1, 5, 25, 20480], [10, 500, 10, 60000], ['performance', 'webhooks', 'workflows', 'custom_smtp', 'oidc_sso', 'custom_domain', 'integrations']),
  plan('growth', 'Growth', 199, [3, 25, 70, 61440], [15, 750, 15, 135000], ['performance', 'oidc_sso', 'custom_domain']),
  plan('max', 'Max', 379, [10, 100, 170, 153600], [25, 1000, 20, 300000], ['oidc_sso', 'custom_domain']),
  plan('enterprise', 'Enterprise', null, [25, 500, null, null], [null, null, null, null], []),
]

const plans = vi.spyOn(siteApi, 'plans')

function open() {
  return render(<MemoryRouter><PricingPage /></MemoryRouter>)
}

beforeEach(() => {
  plans.mockReset()
  plans.mockResolvedValue({ data: { plans: PLANS } } as never)
})

describe('PricingPage: plans', () => {
  it('shows a placeholder while the plans load', () => {
    plans.mockReturnValue(new Promise(() => {}) as never)
    const { container } = open()
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(container.querySelectorAll('.xv-plan-skeleton')).toHaveLength(4)
    expect(screen.queryByText('Starter')).not.toBeInTheDocument()
  })

  it('shows each plan with its price, what it is for and its allowances', async () => {
    open()
    const starter = (await screen.findByRole('heading', { level: 3, name: 'Starter' })).closest('article') as HTMLElement
    expect(within(starter).getByText('$109')).toBeInTheDocument()
    expect(within(starter).getByText(/per month/)).toBeInTheDocument()
    expect(within(starter).getByText('$10.90 per position')).toBeInTheDocument()
    expect(within(starter).getByText(/small teams/)).toBeInTheDocument()
    for (const line of ['10 positions a month', '500 resumes per position', '10 AI interviews per position', '1 company', '5 users per company', 'HRMS included']) {
      expect(within(starter).getByText(line)).toBeInTheDocument()
    }

    const growth = screen.getByRole('heading', { level: 3, name: 'Growth' }).closest('article') as HTMLElement
    expect(within(growth).getByText('$199')).toBeInTheDocument()
    expect(within(growth).getByText('$13.27 per position')).toBeInTheDocument()
    expect(within(growth).getByText('750 resumes per position')).toBeInTheDocument()
    expect(within(growth).getByText('15 AI interviews per position')).toBeInTheDocument()

    const enterprise = screen.getByRole('heading', { level: 3, name: 'Enterprise' }).closest('article') as HTMLElement
    expect(within(enterprise).getByText('Custom')).toBeInTheDocument()
    expect(within(enterprise).getByText('Pay as you go')).toBeInTheDocument()
    expect(within(enterprise).queryByText(/per month/)).not.toBeInTheDocument()
    expect(within(enterprise).getByText('Unlimited positions')).toBeInTheDocument()
    expect(within(enterprise).getByText('25 companies')).toBeInTheDocument()
  })

  it('marks Growth as the most popular plan', async () => {
    open()
    const growth = (await screen.findByRole('heading', { level: 3, name: 'Growth' })).closest('article') as HTMLElement
    expect(within(growth).getByText('Most popular')).toBeInTheDocument()
    expect(growth).toHaveClass('is-popular')
    const starter = screen.getByRole('heading', { level: 3, name: 'Starter' }).closest('article') as HTMLElement
    expect(within(starter).queryByText('Most popular')).not.toBeInTheDocument()
  })

  it('lists the services on Starter, then what each bigger plan adds', async () => {
    open()
    const starter = (await screen.findByRole('heading', { level: 3, name: 'Starter' })).closest('article') as HTMLElement
    expect(within(starter).getByText('Included in every plan')).toBeInTheDocument()
    expect(within(starter).getByText('Coding test with AI review, one per interview')).toBeInTheDocument()
    expect(within(starter).queryByText('Outbound webhooks')).not.toBeInTheDocument()
    expect(within(starter).getByText('HRMS in every plan')).toBeInTheDocument()
    for (const item of ['Employee records', 'Leave requests and balances', 'Attendance tracking', 'Holiday calendar', 'People insights']) {
      expect(within(starter).getByText(item)).toBeInTheDocument()
    }

    const growth = screen.getByRole('heading', { level: 3, name: 'Growth' }).closest('article') as HTMLElement
    expect(within(growth).getByText('Everything in Starter, plus')).toBeInTheDocument()
    expect(Array.from(growth.querySelectorAll('.xv-plan-features li')).map(li => li.textContent)).toEqual([
      'Workflow automation', 'Outbound webhooks', 'HRMS sync, Zoom and Teams', 'Own mail server',
    ].map(t => `✓${t}`))
    expect(within(growth).getByText('HRMS included')).toBeInTheDocument()
    expect(within(growth).queryByText('HRMS in every plan')).not.toBeInTheDocument()

    const max = screen.getByRole('heading', { level: 3, name: 'Max' }).closest('article') as HTMLElement
    expect(within(max).getByText('Everything in Growth, plus')).toBeInTheDocument()
    expect(within(max).getByText('Performance reviews')).toBeInTheDocument()

    const enterprise = screen.getByRole('heading', { level: 3, name: 'Enterprise' }).closest('article') as HTMLElement
    expect(within(enterprise).getByText('Everything in Max, plus')).toBeInTheDocument()
    expect(within(enterprise).getByText('Single sign-on (OIDC)')).toBeInTheDocument()
    expect(within(enterprise).getByText('Custom domain')).toBeInTheDocument()
  })

  it('invites you to choose each plan, or ask for a quote for Enterprise', async () => {
    open()
    const links = await screen.findAllByRole('link', { name: /^(Choose|Get a quote)/ })
    expect(links.map(a => a.textContent)).toEqual(['Choose Starter', 'Choose Growth', 'Choose Max', 'Get a quote'])
    links.forEach(a => expect(a).toHaveAttribute('href', '/contact?topic=sales'))
  })

  it('compares every plan in one table, grouped', async () => {
    open()
    const table = await screen.findByRole('table', { name: 'Compare plans' })
    expect(within(table.querySelector('thead') as HTMLElement).getAllByRole('columnheader').map(c => c.textContent)).toEqual([
      'Plan', 'Starter$109 a month', 'Growth$199 a month', 'Max$379 a month', 'EnterpriseCustom quote',
    ])
    expect(within(table).getAllByRole('columnheader', { name: /^(Price|Positions|Services|HRMS|Features|Limits)$/ }).map(c => c.textContent)).toEqual([
      'Price', 'Positions', 'Services', 'HRMS', 'Features', 'Limits',
    ])
    expect(within(table).getByRole('row', { name: /Attendance tracking Included Included Included Included/ })).toBeInTheDocument()
    expect(within(table).getByRole('row', { name: /HRMS sync, Zoom and Teams Not included Included Included Included/ })).toBeInTheDocument()
    expect(within(table).getByRole('row', { name: /Price per position \$10\.90 \$13\.27 \$15\.16 Pay as you go/ })).toBeInTheDocument()
    expect(within(table).getByRole('row', { name: /Positions open a month 10 15 25 Unlimited/ })).toBeInTheDocument()
    expect(within(table).getByRole('row', { name: /AI interviews per position 10 15 20 Agreed/ })).toBeInTheDocument()
    expect(within(table).getByRole('row', { name: /AI interviews a month at full use 100 225 500 By usage/ })).toBeInTheDocument()
    expect(within(table).getByRole('row', { name: /Resumes stored for 12 months 60,000 135,000 300,000 By usage/ })).toBeInTheDocument()
    expect(within(table).getByRole('row', { name: /Resumes a month at full use 5,000 11,250 25,000 By usage/ })).toBeInTheDocument()
    expect(within(table).getByRole('row', { name: /Users per company 5 25 100 500/ })).toBeInTheDocument()
    expect(within(table).queryByText(/AI usage/)).not.toBeInTheDocument()
    expect(within(table).queryByText(/a month \$/)).not.toBeInTheDocument()
    expect(within(table).getByRole('row', { name: /Offer letters and branded emails Included Included Included Included/ })).toBeInTheDocument()
    expect(within(table).getByRole('row', { name: /Custom domain Not included Not included Not included Included/ })).toBeInTheDocument()
    expect(within(table).queryByText('Coding assessments')).not.toBeInTheDocument()
    expect(screen.queryByRole('table', { name: 'Features by plan' })).not.toBeInTheDocument()
  })
})

describe('PricingPage: when plans cannot be shown', () => {
  it('says so, offers another way, and loads again on request', async () => {
    const u = userEvent.setup()
    plans.mockRejectedValueOnce(new Error('offline'))
    open()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('We could not load the plans right now.')
    expect(within(alert).getByRole('link', { name: 'Ask us for pricing' })).toHaveAttribute('href', '/contact?topic=sales')
    expect(screen.queryByRole('table', { name: 'Compare plans' })).not.toBeInTheDocument()

    await u.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { level: 3, name: 'Growth' })).toBeInTheDocument()
    expect(plans).toHaveBeenCalledTimes(2)
  })

  it('points to the team when no plans are published', async () => {
    plans.mockResolvedValue({ data: { plans: [] } } as never)
    open()
    expect(await screen.findByText(/Plans are set up with our team/)).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: 'Compare plans' })).not.toBeInTheDocument()
  })
})

describe('PricingPage: around the plans', () => {
  it('answers the common questions', async () => {
    const u = userEvent.setup()
    open()
    await screen.findByRole('heading', { level: 3, name: 'Starter' })
    const faq = screen.getByRole('heading', { name: 'Pricing questions, answered' }).closest('section') as HTMLElement
    const questions = within(faq).getAllByText(/\?$/)
    expect(questions.length).toBeGreaterThanOrEqual(5)
    expect(within(faq).queryByText(/AI usage/)).not.toBeInTheDocument()
    await u.click(within(faq).getByText('What happens when we reach a plan limit or run out of storage?'))
    expect(within(faq).getByText(/new work of that kind pauses/)).toBeVisible()
  })

  it('ends with a call to talk to sales', async () => {
    open()
    await screen.findByRole('heading', { level: 3, name: 'Starter' })
    expect(screen.getByRole('link', { name: 'Talk to sales' })).toHaveAttribute('href', '/contact?topic=sales')
    expect(screen.getByRole('link', { name: 'Explore features' })).toHaveAttribute('href', '/features')
  })

  it('states what the prices are per, and offers custom limits', async () => {
    open()
    await screen.findByRole('heading', { level: 3, name: 'Starter' })
    expect(screen.getByText(/per client, in US dollars, per month/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'We can set custom limits.' })).toHaveAttribute('href', '/contact?topic=sales')
  })

  it('follows the site rules', async () => {
    const { container } = open()
    await waitFor(() => expect(screen.getByRole('table', { name: 'Compare plans' })).toBeInTheDocument())
    expectMeta('Pricing')
    expectHeadingOrder(container)
    expectValidInternalLinks(container)
    expectNoEmDash(container)
  })
})
