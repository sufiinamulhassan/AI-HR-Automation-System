import { render, screen, waitFor } from '@testing-library/react'
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

describe('DashboardOverview, Total Résumés tile', () => {
  beforeEach(() => {
    intelStats.mockReset().mockResolvedValue({ data: { total: 42 } })
    jobsStats.mockReset().mockResolvedValue({ data: {} })
    costTotal.mockReset().mockResolvedValue({ data: null })
    dashboard.mockReset().mockResolvedValue({ data: BASE_ANALYTICS })
  })

  it('links to the Résumés page, filtered to the processed set the tile counts', async () => {
    renderPage()
    const tile = await screen.findByRole('link', { name: /Total Résumés/ })
    expect(tile).toHaveAttribute('href', '/dashboard/resumes?status=processed')
    await waitFor(() => expect(tile).toHaveTextContent('42'))
  })

  it('leaves the tiles that have nowhere to go as plain, non-clickable cards', async () => {
    renderPage()
    await screen.findByRole('link', { name: /Total Résumés/ })
    for (const name of [/Domains/, /Distinct Skills/, /Seniority Levels/, /Hired/]) {
      expect(screen.queryByRole('link', { name })).not.toBeInTheDocument()
    }
  })

  it('opens Recruiting, the sidebar page, when the Open JDs tile is clicked', async () => {
    jobsStats.mockResolvedValue({ data: {} })
    dashboard.mockResolvedValue({ data: { ...BASE_ANALYTICS, jobs_active_vs_total: { active: 100, total: 100 } } })
    renderPage()
    const tile = await screen.findByRole('link', { name: /Open JDs/ })
    expect(tile).toHaveAttribute('href', '/dashboard/hrbot')
    expect(tile).toHaveAttribute('title', 'Open Recruiting')
    expect(tile).toHaveClass('dv-kpi-link')
    await waitFor(() => expect(tile).toHaveTextContent('100 active'))
    expect(tile).toHaveTextContent('→')
  })

  it('keeps the Total Résumés tile hover hint as it was', async () => {
    renderPage()
    const tile = await screen.findByRole('link', { name: /Total Résumés/ })
    expect(tile).toHaveAttribute('title', 'View all total résumés')
  })
})

describe('DashboardOverview, writing rules', () => {
  beforeEach(() => {
    intelStats.mockReset().mockResolvedValue({ data: { total: 42 } })
    jobsStats.mockReset().mockResolvedValue({ data: {} })
    costTotal.mockReset().mockResolvedValue({ data: null })
    dashboard.mockReset().mockResolvedValue({ data: BASE_ANALYTICS })
  })

  it('shows titles and numbers only: no page subtitle and no description under a card title', async () => {
    const { container } = renderPage()
    await screen.findByRole('link', { name: /Total Résumés/ })
    expect(screen.getByRole('heading', { name: 'Recruitment Overview' })).toBeInTheDocument()
    expect(container.querySelector('[class*="-sub"]')).toBeNull()
    expect(container.querySelector('[class*="-note"]')).toBeNull()
  })

  it('contains no em dash anywhere in the rendered page', async () => {
    const { container } = renderPage()
    await screen.findByRole('link', { name: /Total Résumés/ })
    expect(container.textContent).not.toContain(String.fromCharCode(0x2014))
  })
})

describe('DashboardOverview, coding assessment analytics', () => {
  beforeEach(() => {
    intelStats.mockReset().mockResolvedValue({ data: {} })
    jobsStats.mockReset().mockResolvedValue({ data: {} })
    costTotal.mockReset().mockResolvedValue({ data: null })
    dashboard.mockReset()
  })

  it('renders completion rate, avg score and score distribution from a populated payload', async () => {
    dashboard.mockResolvedValue({
      data: {
        ...BASE_ANALYTICS,
        coding_assessment: {
          candidates_assigned: 20,
          candidates_completed: 15,
          completion_rate_pct: 75,
          total_submissions: 18,
          graded_submissions: 15,
          avg_score: 67.5,
          score_distribution: { '0-20': 1, '20-40': 2, '40-60': 4, '60-80': 5, '80-100': 3 },
        },
      },
    })
    renderPage()

    expect(await screen.findByText('Coding Assessment Completion')).toBeInTheDocument()
    expect(screen.getByText('75%')).toBeInTheDocument()
    expect(screen.getByText('15 of 20 candidates completed · 18 submissions')).toBeInTheDocument()

    expect(screen.getByText('Coding Assessment Avg Score')).toBeInTheDocument()
    expect(screen.getByText('67.5 / 100')).toBeInTheDocument()
    expect(screen.getByText('15 submissions graded')).toBeInTheDocument()

    expect(screen.getByText('Coding Score Distribution')).toBeInTheDocument()
    expect(screen.getByText('0-20')).toBeInTheDocument()
    expect(screen.getByText('80-100')).toBeInTheDocument()
  })

  it('handles the all-zero / empty payload without crashing', async () => {
    dashboard.mockResolvedValue({
      data: {
        ...BASE_ANALYTICS,
        coding_assessment: {
          candidates_assigned: 0,
          candidates_completed: 0,
          completion_rate_pct: null,
          total_submissions: 0,
          graded_submissions: 0,
          avg_score: null,
          score_distribution: { '0-20': 0, '20-40': 0, '40-60': 0, '60-80': 0, '80-100': 0 },
        },
      },
    })
    renderPage()

    expect(await screen.findByText('Coding Assessment Completion')).toBeInTheDocument()
    expect(screen.getByText('No coding questions assigned yet.')).toBeInTheDocument()
    expect(screen.getByText('No graded submissions yet.')).toBeInTheDocument()
    expect(screen.getByText('No graded coding submissions yet.')).toBeInTheDocument()
  })

  it('renders nothing extra when coding_assessment is absent from an older backend', async () => {
    dashboard.mockResolvedValue({ data: { ...BASE_ANALYTICS } })
    renderPage()

    await screen.findByText('Recruitment Overview')
    expect(screen.queryByText('Coding Assessment Completion')).not.toBeInTheDocument()
    expect(screen.queryByText('Coding Score Distribution')).not.toBeInTheDocument()
  })
})
