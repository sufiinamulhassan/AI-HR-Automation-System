import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const intelStats = vi.fn()
const jobsStats = vi.fn()
const costTotal = vi.fn()
const dashboard = vi.fn()

vi.mock('../../../lib/api', () => ({
  intelApi: {
    stats: (...a: unknown[]) => intelStats(...a),
    costTotal: (...a: unknown[]) => costTotal(...a),
  },
  jobsApi: { stats: (...a: unknown[]) => jobsStats(...a) },
  analyticsApi: { dashboard: (...a: unknown[]) => dashboard(...a) },
  companySettingsApi: { onboarding: vi.fn().mockResolvedValue({ data: { steps: [], dismissed: true } }), dismissOnboarding: vi.fn() },
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

const READY = {
  status: 'ready',
  total_cost_usd: 1.5,
  categories: [
    { key: 'resume_parsing', label: 'Résumé parsing', cost_usd: 0.5, calls: 100, items: 100, avg_item_usd: 0.005 },
    { key: 'interviews', label: 'Interviews', cost_usd: 0.3, calls: 12 },
    { key: 'reports', label: 'Report generation', cost_usd: 0.0117, calls: 3, items: 3, avg_item_usd: 0.0039 },
    { key: 'voice', label: 'Interview voice', cost_usd: 0.4, calls: 8 },
    { key: 'job_descriptions', label: 'Job descriptions', cost_usd: 0.1, calls: 2 },
    { key: 'coding', label: 'Coding assessments', cost_usd: 0.0, calls: 0 },
    { key: 'offers', label: 'Offers', cost_usd: 0.0, calls: 0 },
    { key: 'matching', label: 'Matching', cost_usd: 0.1, calls: 4 },
    { key: 'email', label: 'Email', cost_usd: 0.1, calls: 1000 },
    { key: 'other', label: 'Other', cost_usd: 0.0, calls: 0 },
  ],
  llm: { total_cost_usd: 1.0, total_calls: 118, prompt_tokens: 1000, completion_tokens: 500, embedding_tokens: 0, by_feature: {} },
  email: { estimated_cost_usd: 0.1, sent_count: 1000, cost_per_email_usd: 0.0001, note: 'n' },
  voice: {
    estimated_cost_usd: 0.4,
    tts: { cost_usd: 0.1, calls: 3, characters: 1200 },
    stt: { cost_usd: 0.3, calls: 5, duration_minutes: 12.5, estimated_calls: 2 },
    note: 'n',
  },
  code_execution: { trackable: false, note: 'n' },
}

function renderPage() {
  return render(
    <MemoryRouter>
      <DashboardOverview />
    </MemoryRouter>
  )
}

describe('DashboardOverview: cost', () => {
  beforeEach(() => {
    intelStats.mockReset().mockResolvedValue({ data: {} })
    jobsStats.mockReset().mockResolvedValue({ data: {} })
    costTotal.mockReset().mockResolvedValue({ data: null })
    dashboard.mockReset()
    useAuthStore.setState({ token: null, user: null })
  })

  it.each(['admin', 'superadmin'])('shows a %s the overall price and a price for each area, from the one analytics request', async role => {
    useAuthStore.setState({ token: 'tok', user: { role, email: `${role}@x.com`, name: role } })
    dashboard.mockResolvedValue({ data: { ...BASE_ANALYTICS, cost_summary: READY } })
    renderPage()

    const total = await screen.findByLabelText('Total cost')
    expect(total).toHaveTextContent('$1.50')
    const cost = screen.getByLabelText('Cost')
    for (const label of ['Résumé parsing', 'Interviews', 'Report generation', 'Interview voice', 'Job descriptions', 'Matching', 'Email']) {
      expect(within(cost).getByRole('heading', { name: label })).toBeInTheDocument()
    }
    expect(within(cost).queryByRole('heading', { name: 'Other' })).not.toBeInTheDocument()
    expect(within(cost).queryByRole('heading', { name: 'Coding assessments' })).not.toBeInTheDocument()
    expect(within(cost).queryByRole('heading', { name: 'Offers' })).not.toBeInTheDocument()
    expect(costTotal).not.toHaveBeenCalled()
    expect(dashboard).toHaveBeenCalledTimes(1)
  })

  it('shows the same block to anyone the server sends figures to, whatever their role', async () => {
    useAuthStore.setState({ token: 'tok', user: { role: 'standard', email: 's@x.com', name: 's' } })
    dashboard.mockResolvedValue({ data: { ...BASE_ANALYTICS, cost_summary: READY } })
    renderPage()
    expect(await screen.findByLabelText('Total cost')).toBeInTheDocument()
  })

  it('has none of the old cost cards, and no by-feature chart', async () => {
    dashboard.mockResolvedValue({ data: { ...BASE_ANALYTICS, cost_summary: READY } })
    renderPage()
    await screen.findByLabelText('Total cost')

    for (const gone of ['Total AI Spend · Lifetime', 'Total Platform Cost', 'LLM Usage', 'Email Cost', 'Voice Cost', 'LLM Cost by Feature', 'AI & Email Cost']) {
      expect(screen.queryByText(gone)).not.toBeInTheDocument()
    }
  })

  it('puts the cost block above the time-to-hire row', async () => {
    dashboard.mockResolvedValue({ data: { ...BASE_ANALYTICS, cost_summary: READY } })
    renderPage()
    const cost = await screen.findByLabelText('Cost')
    const timeToHire = screen.getByRole('heading', { name: 'Time to Hire' })
    expect(cost.compareDocumentPosition(timeToHire) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows one small card with the server note when there are no figures to show (no data yet, or no cost:read)', async () => {
    dashboard.mockResolvedValue({
      data: {
        ...BASE_ANALYTICS,
        cost_summary: { ...READY, status: 'insufficient_data', total_cost_usd: 0, categories: [], note: 'No AI usage has been cost-tracked yet, or you do not have the `cost:read` permission required to view this section.' },
      },
    })
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Cost' })).toBeInTheDocument()
    expect(screen.getByText(/No AI usage has been cost-tracked yet/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Total cost')).not.toBeInTheDocument()
  })

  it('renders the rest of the dashboard fine when cost_summary is absent from an older backend response', async () => {
    dashboard.mockResolvedValue({ data: { ...BASE_ANALYTICS } })
    renderPage()

    await screen.findByText('Recruitment Overview')
    expect(screen.queryByLabelText('Cost')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Cost' })).not.toBeInTheDocument()
  })

  it('renders the rest of the dashboard fine when the analytics request fails', async () => {
    dashboard.mockRejectedValue(new Error('500'))
    renderPage()
    await screen.findByText('Recruitment Overview')
    expect(screen.queryByLabelText('Cost')).not.toBeInTheDocument()
  })
})
