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
}))

const { default: DashboardOverview } = await import('./DashboardOverview')

const BASE_ANALYTICS = {
  jobs_active_vs_total: { active: 0, total: 0 },
  source_wise_applications: {},
  recruiter_performance: [],
  time_to_hire: { avg_days: null, median_days: null, sample_size: 0 },
  offer_acceptance_rate: { sent: 0, accepted: 0, declined: 0, rate_pct: null },
  candidate_drop_off: [],
  ai_recommendations: [],
}

function renderPage() {
  return render(
    <MemoryRouter>
      <DashboardOverview />
    </MemoryRouter>
  )
}

async function findDropOffSection() {
  const heading = await screen.findByText('Candidate Drop-off')
  const section = heading.closest('section')
  if (!section) throw new Error('Candidate Drop-off section not found')
  return within(section)
}

describe('DashboardOverview, Candidate Drop-off', () => {
  beforeEach(() => {
    intelStats.mockReset().mockResolvedValue({ data: {} })
    jobsStats.mockReset().mockResolvedValue({ data: {} })
    costTotal.mockReset().mockResolvedValue({ data: null })
    dashboard.mockReset()
  })

  it('renders each stage with its count and a stage-to-stage badge from a populated payload', async () => {
    dashboard.mockResolvedValue({
      data: {
        ...BASE_ANALYTICS,
        candidate_drop_off: [
          { stage: 'invited', count: 100, drop_pct_from_prev: null },
          { stage: 'interviewing', count: 60, drop_pct_from_prev: 40.0 },
          { stage: 'completed', count: 45, drop_pct_from_prev: 25.0 },
          { stage: 'hired', count: 10, drop_pct_from_prev: 77.8 },
        ],
      },
    })
    renderPage()

    const section = await findDropOffSection()

    expect(section.getByText('Invited')).toBeInTheDocument()
    expect(section.getByText('100')).toBeInTheDocument()
    expect(section.getByText('entry point')).toBeInTheDocument()

    expect(section.getByText('Interviewing')).toBeInTheDocument()
    expect(section.getByText('60')).toBeInTheDocument()
    expect(section.getByText('-40% drop')).toBeInTheDocument()

    expect(section.getByText('Completed')).toBeInTheDocument()
    expect(section.getByText('45')).toBeInTheDocument()
    expect(section.getByText('-25% drop')).toBeInTheDocument()

    expect(section.getByText('Hired')).toBeInTheDocument()
    expect(section.getByText('10')).toBeInTheDocument()
    expect(section.getByText('-78% drop')).toBeInTheDocument()
  })

  it('renders a growth badge instead of "drop" when a later stage has more candidates than the one before it', async () => {
    dashboard.mockResolvedValue({
      data: {
        ...BASE_ANALYTICS,
        candidate_drop_off: [
          { stage: 'invited', count: 10, drop_pct_from_prev: null },
          { stage: 'interviewing', count: 25, drop_pct_from_prev: -150.0 },
        ],
      },
    })
    renderPage()

    expect(await screen.findByText('Candidate Drop-off')).toBeInTheDocument()
    expect(screen.getByText('+150% increase')).toBeInTheDocument()
    expect(screen.queryByText(/drop$/)).not.toBeInTheDocument()
  })

  it('renders "no prior data" when the previous stage had zero candidates', async () => {
    dashboard.mockResolvedValue({
      data: {
        ...BASE_ANALYTICS,
        candidate_drop_off: [
          { stage: 'invited', count: 0, drop_pct_from_prev: null },
          { stage: 'interviewing', count: 5, drop_pct_from_prev: null },
        ],
      },
    })
    renderPage()

    expect(await screen.findByText('Candidate Drop-off')).toBeInTheDocument()
    expect(screen.getByText('entry point')).toBeInTheDocument()
    expect(screen.getByText('no prior data')).toBeInTheDocument()
  })

  it('renders an empty state instead of crashing when candidate_drop_off is empty', async () => {
    dashboard.mockResolvedValue({ data: { ...BASE_ANALYTICS, candidate_drop_off: [] } })
    renderPage()

    expect(await screen.findByText('Candidate Drop-off')).toBeInTheDocument()
    expect(screen.getByText('No pipeline activity yet.')).toBeInTheDocument()
  })

  it('renders the rest of the dashboard fine when analytics itself fails to load', async () => {
    dashboard.mockRejectedValue(new Error('network error'))
    renderPage()

    await screen.findByText('Recruitment Overview')
    expect(screen.queryByText('Candidate Drop-off')).not.toBeInTheDocument()
  })
})
