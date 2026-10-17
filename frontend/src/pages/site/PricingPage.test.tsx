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

function plan(tier: string, label: string, price: number, limits: [number, number, number, number], off: string[]): SitePlan {
  return {
    tier, label, price_monthly_usd: price, max_companies: limits[0], max_users_per_company: limits[1],
    monthly_ai_budget_usd: limits[2], max_storage_mb: limits[3],
    features: KEYS.map(([key, name]) => ({ key, label: name, included: !off.includes(key) })),
  }
}

const PLANS = [
  plan('starter', 'Starter', 49, [1, 5, 25, 1024], ['coding', 'performance', 'webhooks', 'workflows', 'custom_smtp', 'oidc_sso', 'custom_domain', 'integrations']),
  plan('growth', 'Growth', 199, [3, 25, 150, 10240], ['oidc_sso', 'custom_domain']),
  plan('enterprise', 'Enterprise', 799, [25, 500, 1000, 102400], []),
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
    expect(container.querySelectorAll('.xv-plan-skeleton')).toHaveLength(3)
    expect(screen.queryByText('Starter')).not.toBeInTheDocument()
  })

  it('shows each plan with its price and limits', async () => {
    open()
    const starter = (await screen.findByRole('heading', { level: 3, name: 'Starter' })).closest('article') as HTMLElement
    expect(within(starter).getByText('$49')).toBeInTheDocument()
    expect(within(starter).getByText(/per month/)).toBeInTheDocument()
    expect(within(starter).getByText('1 company')).toBeInTheDocument()
    expect(within(starter).getByText('$25 a month')).toBeInTheDocument()
    expect(within(starter).getByText('1 GB')).toBeInTheDocument()

    const enterprise = screen.getByRole('heading', { level: 3, name: 'Enterprise' }).closest('article') as HTMLElement
    expect(within(enterprise).getByText('$799')).toBeInTheDocument()
    expect(within(enterprise).getByText('25 companies')).toBeInTheDocument()
    expect(within(enterprise).getByText('100 GB')).toBeInTheDocument()
  })

  it('says for every feature whether it is included, in words as well as marks', async () => {
    open()
    const starter = (await screen.findByRole('heading', { level: 3, name: 'Starter' })).closest('article') as HTMLElement
    expect(within(starter).getByText('Coding assessments').closest('li')).toHaveTextContent('Coding assessments (not included)')
    const growth = screen.getByRole('heading', { level: 3, name: 'Growth' }).closest('article') as HTMLElement
    expect(within(growth).getByText('Coding assessments').closest('li')).toHaveTextContent('Coding assessments (included)')
    expect(within(growth).getByText('Single sign-on (OIDC)').closest('li')).toHaveTextContent('(not included)')
  })

  it('invites you to talk to us about each plan', async () => {
    open()
    const links = await screen.findAllByRole('link', { name: /Talk to us about/ })
    expect(links.map(a => a.textContent)).toEqual(['Talk to us about Starter', 'Talk to us about Growth', 'Talk to us about Enterprise'])
    links.forEach(a => expect(a).toHaveAttribute('href', '/contact?topic=sales'))
  })

  it('compares every limit and feature in two tables', async () => {
    open()
    const limits = await screen.findByRole('table', { name: 'Plan limits' })
    expect(within(limits).getAllByRole('columnheader').map(c => c.textContent)).toEqual(['Limit', 'Starter', 'Growth', 'Enterprise'])
    expect(within(limits).getByRole('row', { name: /Users per company 5 25 500/ })).toBeInTheDocument()

    const features = screen.getByRole('table', { name: 'Features by plan' })
    expect(within(features).getAllByRole('row')).toHaveLength(KEYS.length + 1)
    expect(within(features).getByRole('row', { name: /Custom domain Not included Not included Included/ })).toBeInTheDocument()
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
    expect(screen.queryByRole('table', { name: 'Plan limits' })).not.toBeInTheDocument()

    await u.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { level: 3, name: 'Growth' })).toBeInTheDocument()
    expect(plans).toHaveBeenCalledTimes(2)
  })

  it('points to the team when no plans are published', async () => {
    plans.mockResolvedValue({ data: { plans: [] } } as never)
    open()
    expect(await screen.findByText(/Plans are set up with our team/)).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: 'Plan limits' })).not.toBeInTheDocument()
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
    await u.click(within(faq).getByText('What happens when we reach the AI limit or run out of storage?'))
    expect(within(faq).getByText(/new AI actions pause/)).toBeVisible()
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
    await waitFor(() => expect(screen.getByRole('table', { name: 'Plan limits' })).toBeInTheDocument())
    expectMeta('Pricing')
    expectHeadingOrder(container)
    expectValidInternalLinks(container)
    expectNoEmDash(container)
  })
})
