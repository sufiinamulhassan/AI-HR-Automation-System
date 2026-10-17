import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const intelStats = vi.fn()
const jobsStats = vi.fn()
const costTotal = vi.fn()
const dashboard = vi.fn()
const attention = vi.fn()
const onboarding = vi.fn()

vi.mock('../../../lib/api', () => ({
  intelApi: {
    stats: (...a: unknown[]) => intelStats(...a),
    costTotal: (...a: unknown[]) => costTotal(...a),
  },
  jobsApi: { stats: (...a: unknown[]) => jobsStats(...a) },
  analyticsApi: { dashboard: (...a: unknown[]) => dashboard(...a) },
  attentionApi: { get: (...a: unknown[]) => attention(...a), detail: vi.fn() },
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

function signIn(role: string) {
  useAuthStore.setState({ token: 'tok', user: { role, email: `${role}@x.com`, name: role } })
}

beforeEach(() => {
  onboarding.mockReset().mockResolvedValue({ data: { steps: [], dismissed: true } })
  intelStats.mockReset().mockResolvedValue({ data: { total: 42 } })
  jobsStats.mockReset().mockResolvedValue({ data: {} })
  costTotal.mockReset().mockResolvedValue({ data: null })
  dashboard.mockReset().mockResolvedValue({ data: BASE_ANALYTICS })
  attention.mockReset().mockResolvedValue({ data: { generated_at: 'x', items: [{ key: 'k', label: 'Interviews awaiting a scorecard', count: 2, severity: 'urgent', path: '/dashboard/hrbot' }] } })
  useAuthStore.setState({ token: null, user: null })
})

describe('DashboardOverview: no Needs attention widget', () => {
  it.each(['admin', 'superadmin', 'standard'])('shows no Needs attention card to a %s and never asks for its data', async role => {
    signIn(role)
    const { container } = render(<MemoryRouter><DashboardOverview /></MemoryRouter>)
    const tile = await screen.findByRole('link', { name: /Total Résumés/ })
    await waitFor(() => expect(tile).toHaveTextContent('42'))

    expect(screen.queryByRole('heading', { name: 'Needs attention' })).not.toBeInTheDocument()
    expect(screen.queryByText('Interviews awaiting a scorecard')).not.toBeInTheDocument()
    expect(container.querySelector('.att-card, .att-list')).toBeNull()
    expect(attention).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'Recruitment Overview' })).toBeInTheDocument()
  })
})
