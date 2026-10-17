import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
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
  attentionApi: { get: vi.fn().mockResolvedValue({ data: { generated_at: 'x', items: [] } }), detail: vi.fn() },
  companySettingsApi: {
    onboarding: vi.fn().mockResolvedValue({ data: { steps: [], dismissed: true } }),
    dismissOnboarding: vi.fn(),
  },
}))

vi.mock('../components/ImportJDModal', () => ({ default: () => <div role="dialog" aria-label="Import Job Descriptions" /> }))
vi.mock('../components/UploadResumesModal', () => ({ default: () => <div role="dialog" aria-label="Upload Résumés" /> }))

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

function Address() {
  const location = useLocation()
  return <div data-testid="address">{location.pathname}{location.search}</div>
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <DashboardOverview />
      <Address />
    </MemoryRouter>,
  )
}

const CREATE = { name: /Create JD/ }
const IMPORT = { name: /Import JDs/ }
const UPLOAD = { name: /Upload Résumés/ }

beforeEach(() => {
  intelStats.mockReset().mockResolvedValue({ data: { total: 42 } })
  jobsStats.mockReset().mockResolvedValue({ data: {} })
  costTotal.mockReset().mockResolvedValue({ data: null })
  dashboard.mockReset().mockResolvedValue({ data: BASE_ANALYTICS })
  useAuthStore.setState({ token: null, user: null })
})

describe('DashboardOverview: header actions', () => {
  it.each(['admin', 'superadmin'])('gives a %s Create JD, Import JDs and Upload Résumés', async role => {
    signIn(role)
    renderPage()
    await screen.findByRole('link', { name: /Total Résumés/ })

    expect(screen.getByRole('button', CREATE)).toBeInTheDocument()
    expect(screen.getByRole('button', IMPORT)).toBeInTheDocument()
    expect(screen.getByRole('button', UPLOAD)).toBeInTheDocument()
  })

  it('opens the import window and the upload window from their buttons for an admin', async () => {
    signIn('admin')
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('link', { name: /Total Résumés/ })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', IMPORT))
    expect(screen.getByRole('dialog', { name: 'Import Job Descriptions' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', UPLOAD))
    expect(screen.getByRole('dialog', { name: 'Upload Résumés' })).toBeInTheDocument()
  })

  it('takes an admin to the new-job form in the workspace from Create JD', async () => {
    signIn('admin')
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', CREATE))
    expect(screen.getByTestId('address')).toHaveTextContent('/dashboard/hrbot?new=1')
  })

  it.each(['standard', 'recruiter'])('gives a %s none of them, and no empty block where they were', async role => {
    signIn(role)
    const { container } = renderPage()
    await screen.findByRole('link', { name: /Total Résumés/ })

    expect(screen.getByRole('heading', { name: 'Recruitment Overview' })).toBeInTheDocument()
    expect(screen.queryByRole('button', CREATE)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', IMPORT)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', UPLOAD)).not.toBeInTheDocument()
    expect(container.querySelector('.dv-head-actions')).toBeNull()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('gives nobody signed in none of them either', async () => {
    renderPage()
    await screen.findByRole('link', { name: /Total Résumés/ })
    expect(screen.queryByRole('button', CREATE)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', IMPORT)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', UPLOAD)).not.toBeInTheDocument()
  })
})
