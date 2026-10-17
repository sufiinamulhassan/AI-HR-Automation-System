import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const cyclesList = vi.fn()
const cyclesListActive = vi.fn()
const cyclesCreate = vi.fn()
const cyclesUpdate = vi.fn()
const cyclesClose = vi.fn()
const cyclesCoverage = vi.fn()
const employeesList = vi.fn()
const ratingConfigGet = vi.fn()
const ratingDimensionsCreate = vi.fn()
const ratingDimensionsUpdate = vi.fn()
const ratingDimensionsDelete = vi.fn()
const ratingScaleUpdate = vi.fn()
const myReports = vi.fn()
const managerSubmit = vi.fn()
const reviewsMine = vi.fn()
const listDepartments = vi.fn()
const jobGradesList = vi.fn()
const authListUsers = vi.fn()
const myPermissions = vi.fn()
const candidatesGet = vi.fn()

vi.mock('../../lib/api', () => ({
  performanceApi: {
    ratingConfig: (...a: unknown[]) => ratingConfigGet(...a),
    ratingDimensions: {
      create: (...a: unknown[]) => ratingDimensionsCreate(...a),
      update: (...a: unknown[]) => ratingDimensionsUpdate(...a),
      delete: (...a: unknown[]) => ratingDimensionsDelete(...a),
    },
    ratingScale: { update: (...a: unknown[]) => ratingScaleUpdate(...a) },
    cycles: {
      list: (...a: unknown[]) => cyclesList(...a),
      listActive: (...a: unknown[]) => cyclesListActive(...a),
      get: vi.fn(),
      create: (...a: unknown[]) => cyclesCreate(...a),
      update: (...a: unknown[]) => cyclesUpdate(...a),
      close: (...a: unknown[]) => cyclesClose(...a),
      coverage: (...a: unknown[]) => cyclesCoverage(...a),
    },
    employees: {
      list: (...a: unknown[]) => employeesList(...a),
      get: vi.fn(),
      setManager: vi.fn(),
      listGoals: vi.fn().mockResolvedValue({ data: { goals: [] } }),
      createGoal: vi.fn(),
    },
    goals: { update: vi.fn() },
    reviews: { assign: vi.fn(), list: vi.fn().mockResolvedValue({ data: { reviews: [] } }), get: vi.fn() },
    myReports: (...a: unknown[]) => myReports(...a),
    managerSubmit: (...a: unknown[]) => managerSubmit(...a),
    reviewsMine: (...a: unknown[]) => reviewsMine(...a),
  },
  adminConfigApi: {
    listDepartments: (...a: unknown[]) => listDepartments(...a),
    listDesignations: vi.fn().mockResolvedValue({ data: { designations: [] } }),
    createDepartment: vi.fn(), updateDepartment: vi.fn(), deleteDepartment: vi.fn(),
    createDesignation: vi.fn(), updateDesignation: vi.fn(), deleteDesignation: vi.fn(),
  },
  jobGradesApi: {
    list: (...a: unknown[]) => jobGradesList(...a),
    create: vi.fn(), update: vi.fn(), delete: vi.fn(),
  },
  authApi: {
    listUsers: (...a: unknown[]) => authListUsers(...a),
    myPermissions: (...a: unknown[]) => myPermissions(...a),
  },
  candidatesApi: {
    get: (...a: unknown[]) => candidatesGet(...a),
  },
}))

const { default: PerformancePage } = await import('./PerformancePage')
const { useAuthStore } = await import('../../store/auth.store')

const RATING_CONFIG = {
  scale_min: 1,
  scale_max: 5,
  dimensions: [{ dimension_id: 'dim-1', name: 'Communication', description: 'How well they communicate' }],
}

const CYCLE_DRAFT = {
  cycle_id: 'cyc-draft', name: 'Draft Cycle', period_start: '2026-01-01', period_end: '2026-03-31',
  scope: { type: 'org_wide', value: null }, review_types: ['self'], status: 'draft',
}
const CYCLE_ACTIVE = {
  cycle_id: 'cyc-active', name: 'Active Cycle', period_start: '2026-04-01', period_end: '2026-06-30',
  scope: { type: 'org_wide', value: null }, review_types: ['manager'], status: 'active',
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/dashboard/performance']}>
      <PerformancePage />
    </MemoryRouter>
  )
}

describe('PerformancePage', () => {
  beforeEach(() => {
    cyclesList.mockReset().mockResolvedValue({ data: { cycles: [CYCLE_DRAFT, CYCLE_ACTIVE] } })
    cyclesListActive.mockReset().mockResolvedValue({ data: { cycles: [{ cycle_id: CYCLE_ACTIVE.cycle_id, name: CYCLE_ACTIVE.name, status: 'active' }] } })
    cyclesCreate.mockReset().mockResolvedValue({ data: {} })
    cyclesUpdate.mockReset().mockResolvedValue({ data: {} })
    cyclesClose.mockReset().mockResolvedValue({ data: {} })
    cyclesCoverage.mockReset().mockResolvedValue({ data: {
      cycle_id: CYCLE_ACTIVE.cycle_id, cycle_name: CYCLE_ACTIVE.name, reviewer_types: ['manager'],
      employees_in_scope: 10, expected_reviews: 10, submitted_reviews: 7, outstanding_reviews: 3,
      outstanding: [
        { employee_id: 'emp-1', employee_name: 'Alice Report', reviewer_type: 'manager', expected_reviewer_email: 'mgr@x.com', blocked: false },
        { employee_id: 'emp-2', employee_name: 'Bob Report', reviewer_type: 'manager', expected_reviewer_email: null, blocked: true },
        { employee_id: 'emp-3', employee_name: 'Cara Report', reviewer_type: 'manager', expected_reviewer_email: 'mgr2@x.com', blocked: false },
      ],
    } })
    employeesList.mockReset().mockResolvedValue({ data: { employees: [] } })
    ratingConfigGet.mockReset().mockResolvedValue({ data: RATING_CONFIG })
    ratingDimensionsCreate.mockReset().mockResolvedValue({ data: {} })
    ratingDimensionsUpdate.mockReset().mockResolvedValue({ data: {} })
    ratingDimensionsDelete.mockReset().mockResolvedValue({ data: {} })
    ratingScaleUpdate.mockReset().mockResolvedValue({ data: {} })
    myReports.mockReset().mockResolvedValue({ data: { direct_reports: [], skip_level_reports: [] } })
    managerSubmit.mockReset().mockResolvedValue({ data: {} })
    reviewsMine.mockReset().mockResolvedValue({ data: { reviews: [] } })
    listDepartments.mockReset().mockResolvedValue({ data: { departments: [] } })
    jobGradesList.mockReset().mockResolvedValue({ data: { job_grades: [] } })
    authListUsers.mockReset().mockResolvedValue({ data: [] })
    myPermissions.mockReset().mockResolvedValue({ data: { role: 'admin', permissions: ['performance:read', 'performance:review'] } })
    candidatesGet.mockReset().mockResolvedValue({ data: { name: 'Unknown', email: '' } })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('as an admin', () => {
    beforeEach(() => {
      useAuthStore.setState({ token: 'tok', user: { role: 'admin', email: 'admin@x.com' } })
    })

    it('defaults to the Cycles tab and lists existing cycles', async () => {
      renderPage()
      expect(await screen.findByText('Performance Cycles')).toBeInTheDocument()
      expect(await screen.findByText('Draft Cycle')).toBeInTheDocument()
      expect(screen.getByText('Active Cycle')).toBeInTheDocument()
      expect(cyclesList).toHaveBeenCalled()
    })

    it('creates a cycle with the chosen scope and review types', async () => {
      const user = userEvent.setup()
      renderPage()
      await user.click(await screen.findByText('+ New Cycle'))

      await user.type(screen.getByPlaceholderText('Q3 2026 Review'), 'H2 2026 Review')
      fireEvent.change(screen.getByLabelText('Period Start *'), { target: { value: '2026-07-01' } })
      fireEvent.change(screen.getByLabelText('Period End *'), { target: { value: '2026-12-31' } })
      await user.click(screen.getByRole('checkbox', { name: 'self' }))

      await user.click(screen.getByText('Create'))

      await waitFor(() => expect(cyclesCreate).toHaveBeenCalledWith({
        name: 'H2 2026 Review',
        period_start: '2026-07-01',
        period_end: '2026-12-31',
        scope: { type: 'org_wide', value: null },
        review_types: ['self'],
      }))
      await waitFor(() => expect(cyclesList).toHaveBeenCalledTimes(2))
    })

    it('activates a draft cycle and closes an active one', async () => {
      const user = userEvent.setup()
      vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))
      renderPage()

      await screen.findByText('Draft Cycle')
      const draftRow = screen.getAllByRole('row').find(r => within(r).queryByText('Draft Cycle'))!
      await user.click(within(draftRow).getByText('Activate'))
      await waitFor(() => expect(cyclesUpdate).toHaveBeenCalledWith('cyc-draft', { status: 'active' }))

      await screen.findByText('Active Cycle')
      const activeRow = screen.getAllByRole('row').find(r => within(r).queryByText('Active Cycle'))!
      await user.click(within(activeRow).getByText('Close'))
      await waitFor(() => expect(cyclesClose).toHaveBeenCalledWith('cyc-active'))
      await waitFor(() => expect(cyclesList).toHaveBeenCalledTimes(3))
    })

    it('does not offer Activate/Edit on a closed cycle', async () => {
      cyclesList.mockResolvedValue({ data: { cycles: [{ ...CYCLE_ACTIVE, cycle_id: 'cyc-closed', name: 'Closed Cycle', status: 'closed' }] } })
      renderPage()
      await screen.findByText('Closed Cycle')
      const row = screen.getByRole('row', { name: /Closed Cycle/ })
      expect(within(row).queryByText('Edit')).not.toBeInTheDocument()
      expect(within(row).queryByText('Activate')).not.toBeInTheDocument()
      expect(within(row).queryByText('Close')).not.toBeInTheDocument()
    })

    it('manages rating dimensions the same way Job Grades are managed', async () => {
      const user = userEvent.setup()
      renderPage()

      await user.click(await screen.findByRole('tab', { name: 'Rating Config' }))
      expect(await screen.findByText('Communication')).toBeInTheDocument()

      await user.click(screen.getByText('+ Add Dimension'))
      await user.type(screen.getByPlaceholderText(/e\.g\. communication/i), 'Teamwork')
      await user.click(screen.getByText('Create'))
      await waitFor(() => expect(ratingDimensionsCreate).toHaveBeenCalledWith({ name: 'Teamwork', description: undefined }))

      vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))
      await user.click(screen.getByText('Delete'))
      await waitFor(() => expect(ratingDimensionsDelete).toHaveBeenCalledWith('dim-1'))
      await waitFor(() => expect(ratingConfigGet).toHaveBeenCalledTimes(3))
    })
  })

  describe('as a manager with performance:review but not performance:read', () => {
    const DIRECT_REPORT = { employee_id: 'emp-1', candidate_id: 'cand-1', department: 'dept-1', job_grade: 'AVP' }

    beforeEach(() => {
      useAuthStore.setState({ token: 'tok', user: { role: 'standard', email: 'mgr@x.com' } })
      myPermissions.mockReset().mockResolvedValue({ data: { role: 'standard', permissions: ['performance:review'] } })
      myReports.mockReset().mockResolvedValue({ data: { direct_reports: [DIRECT_REPORT], skip_level_reports: [] } })
      cyclesListActive.mockReset().mockResolvedValue({ data: { cycles: [{ cycle_id: 'cyc-active', name: 'Active Cycle', status: 'active' }] } })
      candidatesGet.mockReset().mockResolvedValue({ data: { name: 'Alice Report', email: 'alice@x.com' } })
    })

    it('shows only the My Reports tab, the admin tabs need performance:read, which this caller lacks', async () => {
      renderPage()
      expect(await screen.findByText('Direct Reports')).toBeInTheDocument()
      expect(screen.queryByRole('tab', { name: 'Cycles' })).not.toBeInTheDocument()
      expect(screen.queryByRole('tab', { name: 'Rating Config' })).not.toBeInTheDocument()
      expect(screen.queryByRole('tab', { name: 'Employees' })).not.toBeInTheDocument()
      expect(await screen.findByText('Alice Report')).toBeInTheDocument()
    })

    it('names a report whose personal data was erased as Erased candidate, not by id', async () => {
      candidatesGet.mockReset().mockResolvedValue({ data: { candidate_id: 'cand-1', erased: true } })
      renderPage()
      await waitFor(() => expect(screen.getByText('Erased candidate')).toBeInTheDocument())
      expect(screen.queryByText('cand-1')).not.toBeInTheDocument()
    })

    it('gets a real cycle dropdown (not a manual cycle-ID field) and submits a manager review', async () => {
      const user = userEvent.setup()
      renderPage()
      await new Promise(r => setTimeout(r, 300))

      expect(await screen.findByText('Alice Report')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: /^submit review$/i }))

      expect(screen.queryByText(/cycle information isn.t available to you directly/i)).not.toBeInTheDocument()
      const select = await screen.findByLabelText('Cycle *')
      expect(within(select).getByText('Active Cycle')).toBeInTheDocument()
      await user.selectOptions(select, 'cyc-active')
      await user.selectOptions(screen.getByLabelText('Communication'), '5')
      await user.click(screen.getByRole('button', { name: /submit manager review/i }))

      await waitFor(() => expect(managerSubmit).toHaveBeenCalledWith({
        cycle_id: 'cyc-active',
        employee_id: 'emp-1',
        reviewer_type: 'manager',
        ratings: { Communication: 5 },
        comments: undefined,
      }))
    })
  })

  describe('with no performance access at all', () => {
    beforeEach(() => {
      useAuthStore.setState({ token: 'tok', user: { role: 'standard', email: 'nobody@x.com' } })
      myPermissions.mockReset().mockResolvedValue({ data: { role: 'standard', permissions: [] } })
    })

    it("shows a plain access notice instead of a blank or crashed page", async () => {
      renderPage()
      expect(await screen.findByText(/don.t have access to Performance Management/i)).toBeInTheDocument()
      expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    })
  })

  describe('cycle review coverage (admin)', () => {
    beforeEach(() => {
      useAuthStore.setState({ token: 'tok', user: { role: 'admin', email: 'admin@x.com' } })
    })

    it('offers a Coverage action only for cycles with a manager/skip_level review type', async () => {
      renderPage()
      await screen.findByText('Draft Cycle')
      const draftRow = screen.getAllByRole('row').find(r => within(r).queryByText('Draft Cycle'))!
      const activeRow = screen.getAllByRole('row').find(r => within(r).queryByText('Active Cycle'))!

      expect(within(draftRow).queryByText('Coverage')).not.toBeInTheDocument()
      expect(within(activeRow).getByText('Coverage')).toBeInTheDocument()
    })

    it('shows outstanding manager-review coverage for a cycle', async () => {
      const user = userEvent.setup()
      renderPage()
      await screen.findByText('Active Cycle')
      const activeRow = screen.getAllByRole('row').find(r => within(r).queryByText('Active Cycle'))!
      await user.click(within(activeRow).getByText('Coverage'))

      expect(cyclesCoverage).toHaveBeenCalledWith('cyc-active')
      expect(await screen.findByText('3')).toBeInTheDocument()
      expect(screen.getByText('10')).toBeInTheDocument()
      expect(screen.getByText(/manager reviews still outstanding/i)).toBeInTheDocument()
      expect(screen.getByText('Alice Report')).toBeInTheDocument()
      expect(screen.getByText('blocked')).toBeInTheDocument()
    })
  })
})
