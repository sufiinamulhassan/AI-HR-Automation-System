import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const intelStats = vi.fn()
const jobsStats = vi.fn()
const costTotal = vi.fn()
const dashboard = vi.fn()
const onboarding = vi.fn()

vi.mock('../../../lib/api', () => ({
  intelApi: {
    stats: (...a: unknown[]) => intelStats(...a),
    costTotal: (...a: unknown[]) => costTotal(...a),
  },
  jobsApi: { stats: (...a: unknown[]) => jobsStats(...a) },
  analyticsApi: { dashboard: (...a: unknown[]) => dashboard(...a) },
  attentionApi: { get: vi.fn().mockResolvedValue({ data: { generated_at: 'x', items: [] } }), detail: vi.fn() },
  companySettingsApi: {
    onboarding: (...a: unknown[]) => onboarding(...a),
    dismissOnboarding: vi.fn(),
  },
}))

const { default: DashboardOverview } = await import('./DashboardOverview')
const { useAuthStore } = await import('../../../store/auth.store')

const BASE_ANALYTICS = {
  jobs_active_vs_total: { active: 0, total: 0 },
  source_wise_applications: {},
  recruiter_performance: [],
  time_to_hire: { avg_days: null, median_days: null, sample_size: 0 },
  offer_acceptance_rate: { sent: 0, accepted: 0, declined: 0, rate_pct: null },
  candidate_drop_off: [],
  ai_recommendations: [],
}

const STEPS = [
  { key: 'profile', label: 'Complete the company profile', done: true },
  { key: 'branding', label: 'Add your logo and colours', done: false },
  { key: 'users', label: 'Invite your team', done: false },
  { key: 'job', label: 'Create your first job', done: false },
  { key: 'resume', label: 'Upload résumés', done: false },
]

function signIn(role: string) {
  useAuthStore.setState({ token: 'tok', user: { role, email: `${role}@x.com`, name: role } })
}

function renderPage() {
  return render(
    <MemoryRouter>
      <DashboardOverview />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  intelStats.mockReset().mockResolvedValue({ data: { total: 42 } })
  jobsStats.mockReset().mockResolvedValue({ data: {} })
  costTotal.mockReset().mockResolvedValue({ data: null })
  dashboard.mockReset().mockResolvedValue({ data: BASE_ANALYTICS })
  onboarding.mockReset().mockResolvedValue({ data: { steps: STEPS, dismissed: false } })
  useAuthStore.setState({ token: null, user: null })
})

describe('DashboardOverview: Get started', () => {
  it.each(['admin', 'superadmin'])('shows a %s the checklist, with where each step is done', async role => {
    signIn(role)
    renderPage()

    const card = await screen.findByRole('region', { name: 'Get started' })
    expect(card).toHaveTextContent('1 of 5')
    expect(screen.getByRole('link', { name: 'Add your logo and colours' })).toHaveAttribute('href', '/dashboard/organization?tab=branding')
    expect(screen.getByRole('link', { name: 'Invite your team' })).toHaveAttribute('href', '/dashboard/users')
    expect(screen.getByRole('link', { name: 'Create your first job' })).toHaveAttribute('href', '/dashboard/hrbot')
    expect(screen.getByRole('link', { name: 'Upload résumés' })).toHaveAttribute('href', '/dashboard/resumes')
  })

  it('sits above the figures', async () => {
    signIn('admin')
    renderPage()

    const started = await screen.findByRole('region', { name: 'Get started' })
    const figures = await screen.findByRole('link', { name: /Total Résumés/ })
    expect(started.compareDocumentPosition(figures) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it.each(['standard', 'recruiter'])('shows a %s nothing, and makes no request for it', async role => {
    signIn(role)
    renderPage()
    await screen.findByRole('link', { name: /Total Résumés/ })

    expect(screen.queryByRole('region', { name: 'Get started' })).not.toBeInTheDocument()
    expect(onboarding).not.toHaveBeenCalled()
  })

  it('shows nobody who is signed out any of it', async () => {
    renderPage()
    await screen.findByRole('link', { name: /Total Résumés/ })
    expect(screen.queryByRole('region', { name: 'Get started' })).not.toBeInTheDocument()
    expect(onboarding).not.toHaveBeenCalled()
  })

  it('leaves it off the page once every step is done', async () => {
    signIn('admin')
    onboarding.mockResolvedValue({ data: { steps: STEPS.map(s => ({ ...s, done: true })), dismissed: false } })
    renderPage()
    await screen.findByRole('link', { name: /Total Résumés/ })
    expect(screen.queryByRole('region', { name: 'Get started' })).not.toBeInTheDocument()
  })

  it('keeps the page working when the checklist cannot be read', async () => {
    signIn('admin')
    onboarding.mockRejectedValue(new Error('Network Error'))
    renderPage()
    expect(await screen.findByRole('link', { name: /Total Résumés/ })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Get started' })).not.toBeInTheDocument()
  })

  it('keeps the writing rules with the card on screen: no subtitle, no caption paragraph, no em dash', async () => {
    signIn('admin')
    const { container } = renderPage()
    const card = await screen.findByRole('region', { name: 'Get started' })
    await screen.findByRole('link', { name: /Total Résumés/ })

    expect(card.querySelector('p')).toBeNull()
    expect(container.querySelector('[class*="-sub"]')).toBeNull()
    expect(container.querySelector('[class*="-note"]')).toBeNull()
    expect(container.textContent).not.toContain(String.fromCharCode(0x2014))
  })
})
