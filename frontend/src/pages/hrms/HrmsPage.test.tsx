import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  overview: vi.fn(), employees: vi.fn(), employee: vi.fn(), createEmployee: vi.fn(), updateEmployee: vi.fn(), offboard: vi.fn(),
  leaveTypes: vi.fn(), createLeaveType: vi.fn(), updateLeaveType: vi.fn(), leaveRequests: vi.fn(), requestLeave: vi.fn(),
  approveLeave: vi.fn(), rejectLeave: vi.fn(), cancelLeave: vi.fn(), attendance: vi.fn(), markAttendance: vi.fn(),
  attendanceSummary: vi.fn(), holidays: vi.fn(), addHoliday: vi.fn(), deleteHoliday: vi.fn(),
  requestCoverage: vi.fn(), hireQuality: vi.fn(), riskRadar: vi.fn(), analytics: vi.fn(),
}))
const listDepartments = vi.fn()

vi.mock('../../lib/api', () => ({
  hrmsApi: api,
  adminConfigApi: { listDepartments: (...a: unknown[]) => listDepartments(...a) },
}))

const { default: HrmsPage } = await import('./HrmsPage')
const { useAuthStore } = await import('../../store/auth.store')

const ANA = {
  employee_id: 'e1', full_name: 'Ana Ruiz', email: 'ana@acme.io', designation: 'Engineer', department: 'd1',
  department_name: 'Engineering', manager_id: null, manager_name: '', employment_type: 'full_time',
  joined_on: '2026-01-05', status: 'active', source: 'manual',
}
const BEN = { ...ANA, employee_id: 'e2', full_name: 'Ben Cole', email: 'ben@acme.io', designation: 'Analyst', department: null, department_name: '', status: 'exited' }
const TYPES = [
  { leave_type_id: 't1', code: 'annual', name: 'Annual leave', annual_allowance: 14, active: true },
  { leave_type_id: 't2', code: 'sick', name: 'Sick leave', annual_allowance: 8, active: true },
]
const REQUEST = {
  request_id: 'r1', employee_id: 'e1', employee_name: 'Ana Ruiz', department_name: 'Engineering',
  leave_type_id: 't1', leave_type_name: 'Annual leave', start_date: '2026-10-12', end_date: '2026-10-14',
  half_day: false, days: 3, reason: 'Family trip', status: 'pending',
}
const OK_COVERAGE = {
  employee_name: 'Ana Ruiz', team: 'Engineering', team_size: 5, low_days: 0, warning: false,
  days: [{ date: '2026-10-12', off: [], available: 4, coverage: 0.8, low: false }],
}
const LOW_COVERAGE = {
  employee_name: 'Ana Ruiz', team: 'Engineering', team_size: 4, low_days: 1, warning: true,
  days: [
    { date: '2026-10-12', off: [{ employee_id: 'e5', full_name: 'Cat Lee', status: 'approved' }, { employee_id: 'e6', full_name: 'Dan Wu', status: 'pending' }], available: 1, coverage: 0.25, low: true },
    { date: '2026-10-13', off: [], available: 3, coverage: 0.75, low: false },
  ],
}
const ANALYTICS = {
  date: '2026-10-23',
  headcount_trend: [
    { month: '2026-08', headcount: 10, joiners: 2, exits: 0 },
    { month: '2026-09', headcount: 11, joiners: 1, exits: 1 },
    { month: '2026-10', headcount: 12, joiners: 1, exits: 0 },
  ],
  attendance_trend: [
    { date: '2026-10-21', present: 8, remote: 1, half_day: 1, absent: 0, on_leave: 1, marked: 11, rate: 95 },
    { date: '2026-10-22', present: 7, remote: 1, half_day: 0, absent: 2, on_leave: 1, marked: 11, rate: 80 },
  ],
  leave_by_type: [{ name: 'Annual leave', approved: 12, pending: 3 }, { name: 'Sick leave', approved: 4, pending: 0 }],
  employment_mix: [{ type: 'full_time', count: 10 }, { type: 'intern', count: 2 }],
  tenure: [{ label: 'Under 6 months', count: 4 }, { label: '6 to 12 months', count: 3 }, { label: '1 to 2 years', count: 5 }],
  attrition_rate: 8.7,
  average_attendance: 87.5,
  joiners_12m: 4,
  exits_12m: 1,
}
const COUNTS = { present: 1, remote: 0, half_day: 0, absent: 0, on_leave: 0, unmarked: 1 }

function signIn(role: string) {
  useAuthStore.setState({ token: 'tok', user: { role, email: `${role}@x.com`, name: role } })
}

async function openTab(name: string) {
  await userEvent.click(screen.getByRole('tab', { name }))
}

beforeEach(() => {
  Object.values(api).forEach(fn => fn.mockReset())
  listDepartments.mockReset().mockResolvedValue({ data: { departments: [{ department_id: 'd1', name: 'Engineering' }] } })
  api.overview.mockResolvedValue({ data: {
    date: '2026-10-23', headcount: 1, active: 1, exited: 1, pending_leave: 1,
    on_leave_today: [{ employee_id: 'e1', employee_name: 'Ana Ruiz', leave_type_name: 'Annual leave', end_date: '2026-10-24' }],
    attendance_today: COUNTS, new_joiners: [{ employee_id: 'e1', full_name: 'Ana Ruiz', designation: 'Engineer', joined_on: '2026-10-01' }],
    upcoming_holidays: [{ holiday_id: 'h1', date: '2026-12-25', name: 'Christmas', optional: false }],
    departments: [{ name: 'Engineering', count: 1 }],
  } })
  api.employees.mockResolvedValue({ data: { employees: [ANA, BEN], total: 2 } })
  api.employee.mockResolvedValue({ data: { ...ANA, leave_balances: [{ leave_type_id: 't1', name: 'Annual leave', allowance: 14, used: 3, pending: 2, remaining: 9, active: true }], leave_requests: [] } })
  api.leaveTypes.mockResolvedValue({ data: { leave_types: TYPES } })
  api.leaveRequests.mockResolvedValue({ data: { requests: [REQUEST], total: 1, page: 1, pages: 1, limit: 10, counts: { pending: 1, approved: 0, rejected: 0, cancelled: 0, all: 1 } } })
  api.analytics.mockResolvedValue({ data: ANALYTICS })
  api.attendance.mockResolvedValue({ data: {
    date: '2026-10-23', weekend: false, holiday: null, counts: COUNTS,
    rows: [
      { employee_id: 'e1', full_name: 'Ana Ruiz', designation: 'Engineer', department_name: 'Engineering', record: { status: 'present', check_in: '09:00', check_out: '17:00', source: 'manual' } },
      { employee_id: 'e3', full_name: 'Cy Young', designation: '', department_name: '', record: null },
    ],
  } })
  api.attendanceSummary.mockResolvedValue({ data: { year: 2026, month: 10, working_days: 17, rows: [
    { employee_id: 'e1', full_name: 'Ana Ruiz', department_name: 'Engineering', present: 15, absent: 1, half_day: 0, remote: 1, on_leave: 0, working_days: 17, unmarked: 0, attendance_rate: 94.1, hours: 120 },
  ] } })
  api.holidays.mockResolvedValue({ data: { holidays: [{ holiday_id: 'h1', date: '2026-12-25', name: 'Christmas', optional: false }] } })
  api.requestCoverage.mockResolvedValue({ data: OK_COVERAGE })
  api.hireQuality.mockResolvedValue({ data: {
    hired_through_hirely: 2, with_review: 2, paired: 2, correlation: null,
    correlation_label: 'Not enough hires with both an interview score and a review yet.',
    strong_interview_performance: 88, other_interview_performance: 40, early_exits: 1,
    rows: [
      { employee_id: 'e1', full_name: 'Ana Ruiz', designation: 'Engineer', department_name: 'Engineering', status: 'active', match_score: 81, interview_score: 90, performance_score: 88, attendance_rate: 96, tenure_days: 300, verdict: 'Strong hire' },
      { employee_id: 'e2', full_name: 'Ben Cole', designation: 'Analyst', department_name: '', status: 'exited', match_score: 55, interview_score: 45, performance_score: 40, attendance_rate: null, tenure_days: 90, verdict: 'Below expectations' },
    ],
  } })
  api.riskRadar.mockResolvedValue({ data: {
    date: '2026-10-23', counts: { high: 1, medium: 0, low: 1 }, burnout: 1,
    rows: [
      { employee_id: 'e2', full_name: 'Ben Cole', designation: 'Analyst', department_name: '', score: 55, level: 'high', burnout: true, signals: [
        { points: 20, kind: 'burnout', text: 'Averaging 11.5 hour days over the last 30 days' },
        { points: 20, kind: 'attrition', text: 'Attendance fell from 95% to 60% compared with the month before' },
      ] },
      { employee_id: 'e1', full_name: 'Ana Ruiz', designation: 'Engineer', department_name: 'Engineering', score: 0, level: 'low', burnout: false, signals: [] },
    ],
  } })
  signIn('admin')
})

describe('HrmsPage', () => {
  it('opens on the overview with the headline numbers and lists', async () => {
    render(<HrmsPage />)
    expect(await screen.findByRole('heading', { name: 'Headcount by department' })).toBeInTheDocument()
    const tiles = screen.getAllByRole('button').filter(b => b.classList.contains('hr-tile')).map(b => b.textContent)
    await waitFor(() => expect(screen.getByText('87.5%')).toBeInTheDocument())
    expect(screen.getAllByRole('button').filter(b => b.classList.contains('hr-tile')).map(b => b.textContent)).toEqual([
      'Headcount11 active, 1 exited', 'On leave today1Approved leave', 'Present today11 not marked', 'Pending leave1Waiting for a decision',
      'Attendance, 30 days87.5%Average across working days', 'Attrition, 12 months8.7%4 joined, 1 left',
    ])
    expect(tiles).toHaveLength(6)
    expect(screen.getByText('Christmas')).toBeInTheDocument()
    expect(screen.getAllByText('Ana Ruiz')).toHaveLength(2)
  })

  it('a tile jumps to its tab', async () => {
    render(<HrmsPage />)
    await userEvent.click(await screen.findByRole('button', { name: /Pending leave/ }))
    expect(screen.getByRole('tab', { name: 'Leave' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByText('Family trip')).toBeInTheDocument()
  })

  it('lists employees and filters them by search and status', async () => {
    render(<HrmsPage />)
    await openTab('Employees')
    expect(await screen.findByText('Ana Ruiz')).toBeInTheDocument()
    expect(screen.getByText('Ben Cole')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Search employees'), 'analyst')
    expect(screen.queryByText('Ana Ruiz')).not.toBeInTheDocument()
    await userEvent.clear(screen.getByLabelText('Search employees'))
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'active')
    expect(screen.queryByText('Ben Cole')).not.toBeInTheDocument()
  })

  it('adds an employee and reloads the directory', async () => {
    api.createEmployee.mockResolvedValue({ data: { ...ANA, employee_id: 'e9', full_name: 'Dee Park' } })
    render(<HrmsPage />)
    await openTab('Employees')
    await userEvent.click(await screen.findByRole('button', { name: 'Add employee' }))
    const dialog = screen.getByRole('dialog', { name: 'Add employee' })
    await userEvent.type(within(dialog).getByLabelText(/Full name/), 'Dee Park')
    await userEvent.selectOptions(within(dialog).getByLabelText('Department'), 'd1')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add employee' }))
    await waitFor(() => expect(api.createEmployee).toHaveBeenCalled())
    expect(api.createEmployee.mock.calls[0][0]).toMatchObject({ full_name: 'Dee Park', department: 'd1', email: null, employment_type: 'full_time' })
    expect(await screen.findByRole('status')).toHaveTextContent('Dee Park was added.')
    expect(api.employees).toHaveBeenCalledTimes(2)
  })

  it('asks for a name before saving', async () => {
    render(<HrmsPage />)
    await openTab('Employees')
    await userEvent.click(await screen.findByRole('button', { name: 'Add employee' }))
    const dialog = screen.getByRole('dialog', { name: 'Add employee' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add employee' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Enter the employee name.')
    expect(api.createEmployee).not.toHaveBeenCalled()
  })

  it('shows the server error when saving fails', async () => {
    api.createEmployee.mockRejectedValue({ response: { data: { detail: 'Another employee already uses this email.' } } })
    render(<HrmsPage />)
    await openTab('Employees')
    await userEvent.click(await screen.findByRole('button', { name: 'Add employee' }))
    const dialog = screen.getByRole('dialog', { name: 'Add employee' })
    await userEvent.type(within(dialog).getByLabelText(/Full name/), 'Dee')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add employee' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Another employee already uses this email.')
  })

  it('offboards an employee with a last working day and reason', async () => {
    api.offboard.mockResolvedValue({ data: { ...ANA, status: 'exited' } })
    render(<HrmsPage />)
    await openTab('Employees')
    await userEvent.click(await screen.findByRole('button', { name: 'Offboard Ana Ruiz' }))
    const dialog = screen.getByRole('dialog', { name: 'Offboard Ana Ruiz?' })
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Relocated')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Offboard' }))
    await waitFor(() => expect(api.offboard).toHaveBeenCalledWith('e1', expect.objectContaining({ reason: 'Relocated' })))
    expect(screen.queryByRole('button', { name: 'Offboard Ben Cole' })).not.toBeInTheDocument()
  })

  it('shows a profile with the leave balance', async () => {
    render(<HrmsPage />)
    await openTab('Employees')
    await userEvent.click(await screen.findByRole('button', { name: 'View Ana Ruiz' }))
    const dialog = await screen.findByRole('dialog', { name: 'Ana Ruiz' })
    expect(await within(dialog).findByText('ana@acme.io')).toBeInTheDocument()
    const row = within(dialog).getByText('Annual leave').closest('tr') as HTMLElement
    expect(within(row).getAllByRole('cell').map(c => c.textContent)).toEqual(['Annual leave', '14', '3', '2', '9'])
  })

  it('approves a pending leave request', async () => {
    api.approveLeave.mockResolvedValue({ data: { ...REQUEST, status: 'approved' } })
    render(<HrmsPage />)
    await openTab('Leave')
    await userEvent.click(await screen.findByRole('button', { name: 'Approve leave for Ana Ruiz' }))
    await waitFor(() => expect(api.approveLeave).toHaveBeenCalledWith('r1'))
    expect(api.requestCoverage).toHaveBeenCalledWith('r1')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(await screen.findByRole('status')).toHaveTextContent('Leave approved for Ana Ruiz.')
    expect(api.leaveRequests).toHaveBeenCalledTimes(2)
  })

  it('stops to show who else is off when approving would leave the team short', async () => {
    api.requestCoverage.mockResolvedValue({ data: LOW_COVERAGE })
    api.approveLeave.mockResolvedValue({ data: { ...REQUEST, status: 'approved' } })
    render(<HrmsPage />)
    await openTab('Leave')
    await userEvent.click(await screen.findByRole('button', { name: 'Approve leave for Ana Ruiz' }))
    const dialog = await screen.findByRole('dialog', { name: 'Team coverage for Ana Ruiz' })
    expect(api.approveLeave).not.toHaveBeenCalled()
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Engineering would be under half strength on 1 day.')
    expect(within(dialog).getByText('Cat Lee, Dan Wu (pending)')).toBeInTheDocument()
    expect(within(dialog).getByText('1 in, 25%')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve anyway' }))
    await waitFor(() => expect(api.approveLeave).toHaveBeenCalledWith('r1'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('lets HR check coverage without approving', async () => {
    render(<HrmsPage />)
    await openTab('Leave')
    await userEvent.click(await screen.findByRole('button', { name: 'Check coverage for Ana Ruiz' }))
    const dialog = await screen.findByRole('dialog', { name: 'Team coverage for Ana Ruiz' })
    expect(within(dialog).getByRole('status')).toHaveTextContent('Engineering keeps enough people in on every day of this leave.')
    expect(within(dialog).getByRole('button', { name: 'Approve' })).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Not now' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(api.approveLeave).not.toHaveBeenCalled()
  })

  it('shows hire quality: hiring scores next to performance', async () => {
    render(<HrmsPage />)
    await openTab('People Insights')
    expect(await screen.findByRole('heading', { name: /Hire quality/ })).toBeInTheDocument()
    const table = await screen.findByRole('table')
    const row = within(table).getByText('Ana Ruiz').closest('tr') as HTMLElement
    expect(within(row).getAllByRole('cell').slice(1).map(c => c.textContent)).toEqual(['81%', '90', '88', '96%', 'Strong hire'])
    expect(screen.getByText('Not enough hires with both an interview score and a review yet.')).toBeInTheDocument()
  })

  it('shows the risk radar with the reasons behind each score', async () => {
    render(<HrmsPage />)
    await openTab('People Insights')
    const list = await screen.findByRole('list', { name: 'Employees by risk' })
    expect(list.querySelectorAll('.hr-risk')).toHaveLength(1)
    expect(within(list).getByText('Averaging 11.5 hour days over the last 30 days')).toBeInTheDocument()
    expect(within(list).getByLabelText('Risk score 55 out of 100')).toBeInTheDocument()
    expect(within(list).getByText('Burnout signs')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Everyone (2)' }))
    expect(screen.getByText('No warning signs.')).toBeInTheDocument()
  })

  it('switches the request filter', async () => {
    render(<HrmsPage />)
    await openTab('Leave')
    await screen.findByText('Family trip')
    await userEvent.click(screen.getByRole('button', { name: /^Approved/ }))
    await waitFor(() => expect(api.leaveRequests).toHaveBeenLastCalledWith({ status: 'approved', page: 1, limit: 10 }))
    await userEvent.click(screen.getByRole('button', { name: /^All/ }))
    await waitFor(() => expect(api.leaveRequests).toHaveBeenLastCalledWith({ page: 1, limit: 10 }))
  })

  it('creates a leave request for an active employee only', async () => {
    api.requestLeave.mockResolvedValue({ data: { ...REQUEST, request_id: 'r2', days: 2 } })
    render(<HrmsPage />)
    await openTab('Leave')
    await userEvent.click(await screen.findByRole('button', { name: 'New leave request' }))
    const dialog = screen.getByRole('dialog', { name: 'New leave request' })
    const options = within(within(dialog).getByLabelText('Employee')).getAllByRole('option').map(o => o.textContent)
    expect(options).toEqual(['Ana Ruiz'])
    await userEvent.selectOptions(within(dialog).getByLabelText('Leave type'), 't2')
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Flu')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create request' }))
    await waitFor(() => expect(api.requestLeave).toHaveBeenCalled())
    expect(api.requestLeave.mock.calls[0][0]).toMatchObject({ employee_id: 'e1', leave_type_id: 't2', reason: 'Flu' })
    expect(await screen.findByRole('status')).toHaveTextContent('Leave request created for Ana Ruiz (2 days).')
  })

  it('adds a leave type', async () => {
    api.createLeaveType.mockResolvedValue({ data: {} })
    render(<HrmsPage />)
    await openTab('Leave')
    await userEvent.type(await screen.findByLabelText('New leave type name'), 'Study leave')
    await userEvent.click(screen.getByRole('button', { name: 'Add type' }))
    expect(api.createLeaveType).toHaveBeenCalledWith({ name: 'Study leave', annual_allowance: 5 })
  })

  it('marks attendance for an unmarked employee', async () => {
    api.markAttendance.mockResolvedValue({ data: {} })
    render(<HrmsPage />)
    await openTab('Attendance')
    const select = await screen.findByLabelText('Status for Cy Young')
    expect(screen.getByRole('button', { name: 'Save attendance for Cy Young' })).toBeDisabled()
    await userEvent.selectOptions(select, 'remote')
    await userEvent.type(screen.getByLabelText('Check in for Cy Young'), '10:00')
    await userEvent.click(screen.getByRole('button', { name: 'Save attendance for Cy Young' }))
    await waitFor(() => expect(api.markAttendance).toHaveBeenCalled())
    expect(api.markAttendance.mock.calls[0][0]).toMatchObject({ employee_id: 'e3', status: 'remote', check_in: '10:00', check_out: null })
  })

  it('clears times when someone is marked absent', async () => {
    api.markAttendance.mockResolvedValue({ data: {} })
    render(<HrmsPage />)
    await openTab('Attendance')
    await userEvent.selectOptions(await screen.findByLabelText('Status for Ana Ruiz'), 'absent')
    expect(screen.getByLabelText('Check in for Ana Ruiz')).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Save attendance for Ana Ruiz' }))
    await waitFor(() => expect(api.markAttendance).toHaveBeenCalled())
    expect(api.markAttendance.mock.calls[0][0]).toMatchObject({ status: 'absent', check_in: null, check_out: null })
  })

  it('shows the monthly summary', async () => {
    render(<HrmsPage />)
    await openTab('Attendance')
    await userEvent.click(await screen.findByRole('button', { name: 'Monthly summary' }))
    expect(await screen.findByText('94.1%')).toBeInTheDocument()
    expect(screen.getByText('17 working days so far')).toBeInTheDocument()
  })

  it('adds and removes holidays', async () => {
    api.addHoliday.mockResolvedValue({ data: {} })
    api.deleteHoliday.mockResolvedValue({ data: {} })
    const year = new Date().getFullYear()
    render(<HrmsPage />)
    await openTab('Holidays')
    expect(await screen.findByText('Christmas')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Holiday date'), `${year}-08-14`)
    await userEvent.type(screen.getByLabelText('Holiday name'), 'Independence Day')
    await userEvent.click(screen.getByRole('button', { name: 'Add holiday' }))
    expect(api.addHoliday).toHaveBeenCalledWith({ date: `${year}-08-14`, name: 'Independence Day', optional: false })
    await userEvent.click(screen.getByRole('button', { name: 'Remove Christmas' }))
    expect(api.deleteHoliday).toHaveBeenCalledWith('h1')
  })

  it('moves between years', async () => {
    const year = new Date().getFullYear()
    render(<HrmsPage />)
    await openTab('Holidays')
    await screen.findByText('Christmas')
    await userEvent.click(screen.getByRole('button', { name: 'Next year' }))
    await waitFor(() => expect(api.holidays).toHaveBeenLastCalledWith(year + 1))
  })

  it('is read only for a recruiter', async () => {
    signIn('standard')
    render(<HrmsPage />)
    expect(screen.queryByRole('tab', { name: 'People Insights' })).not.toBeInTheDocument()
    await openTab('Employees')
    expect(await screen.findByText('Ana Ruiz')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add employee' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit Ana Ruiz' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'View Ana Ruiz' })).toBeInTheDocument()
    await openTab('Leave')
    await screen.findByText('Family trip')
    expect(screen.queryByRole('button', { name: /Approve leave/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add type' })).not.toBeInTheDocument()
    await openTab('Attendance')
    await screen.findByText('Cy Young')
    expect(screen.queryByLabelText('Status for Cy Young')).not.toBeInTheDocument()
    await openTab('Holidays')
    await screen.findByText('Christmas')
    expect(screen.queryByRole('button', { name: 'Add holiday' })).not.toBeInTheDocument()
  })

  it('draws the charts and offers each one as a table', async () => {
    render(<HrmsPage />)
    expect(await screen.findByRole('heading', { name: 'Headcount' })).toBeInTheDocument()
    expect(await screen.findByRole('img', { name: 'Headcount line chart' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Joined and Left bar chart' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Attendance rate line chart' })).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Joiners and leavers legend' })).toHaveTextContent('JoinedLeft')
    const leave = screen.getByRole('list', { name: 'Approved leave days by type' })
    expect(within(leave).getAllByRole('listitem').map(li => li.textContent)).toEqual(['Annual leave12 d', 'Sick leave4 d'])
    const card = screen.getByRole('heading', { name: 'Joiners and leavers' }).closest('section') as HTMLElement
    await userEvent.click(within(card).getByRole('button', { name: 'Show table' }))
    const rows = within(within(card).getByRole('table')).getAllByRole('row').map(r => r.textContent)
    expect(rows[0]).toBe('MonthJoinedLeft')
    expect(rows).toHaveLength(4)
  })

  it('reloads the charts for another range', async () => {
    render(<HrmsPage />)
    await screen.findByRole('heading', { name: 'Headcount' })
    await userEvent.click(screen.getByRole('button', { name: '24 months' }))
    await waitFor(() => expect(api.analytics).toHaveBeenLastCalledWith(24))
  })

  it('says so when there is nothing to chart yet', async () => {
    api.analytics.mockResolvedValue({ data: { ...ANALYTICS, headcount_trend: ANALYTICS.headcount_trend.map(r => ({ ...r, headcount: 0, joiners: 0, exits: 0 })), attendance_trend: [], leave_by_type: [] } })
    render(<HrmsPage />)
    expect(await screen.findByText('No attendance marked yet.')).toBeInTheDocument()
    expect(screen.getByText('Nobody joined or left in this range.')).toBeInTheDocument()
    expect(screen.getByText('No leave taken this year.')).toBeInTheDocument()
  })

  it('pages, sorts and exports the employee list', async () => {
    const many = Array.from({ length: 23 }, (_, i) => ({ ...ANA, employee_id: `p${i}`, full_name: `Person ${String(i + 1).padStart(2, '0')}`, email: `p${i}@acme.io` }))
    api.employees.mockResolvedValue({ data: { employees: many, total: many.length } })
    const created: string[] = []
    const origCreate = URL.createObjectURL
    URL.createObjectURL = vi.fn(() => { created.push('csv'); return 'blob:x' })
    URL.revokeObjectURL = vi.fn()
    render(<HrmsPage />)
    await openTab('Employees')
    expect(await screen.findByText('Person 01')).toBeInTheDocument()
    expect(screen.getByText('Showing 1 to 10 of 23 employees')).toBeInTheDocument()
    expect(screen.queryByText('Person 11')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Page 3' }))
    expect(screen.getByText('Person 21')).toBeInTheDocument()
    expect(screen.getByText('Showing 21 to 23 of 23 employees')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Employee' }))
    expect(screen.getByRole('columnheader', { name: /Employee/ })).toHaveAttribute('aria-sort', 'descending')
    expect(screen.getByText('Showing 1 to 10 of 23 employees')).toBeInTheDocument()
    expect(screen.getByText('Person 23')).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Rows per page'), '25')
    expect(screen.getByText('Showing 1 to 23 of 23 employees')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    expect(created).toEqual(['csv'])
    URL.createObjectURL = origCreate
  })

  it('pages and searches leave requests on the server', async () => {
    api.leaveRequests.mockImplementation(async (params: { page?: number }) => ({ data: { requests: [REQUEST], total: 31, page: params?.page ?? 1, pages: 4, limit: 10, counts: { pending: 31, approved: 2, rejected: 0, cancelled: 0, all: 33 } } }))
    render(<HrmsPage />)
    await openTab('Leave')
    expect(await screen.findByText('Showing 1 to 10 of 31 requests')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pending 31' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(api.leaveRequests).toHaveBeenLastCalledWith({ status: 'pending', page: 2, limit: 10 }))
    await userEvent.type(screen.getByLabelText('Search leave requests'), 'ana')
    await waitFor(() => expect(api.leaveRequests).toHaveBeenLastCalledWith({ status: 'pending', q: 'ana', page: 1, limit: 10 }))
  })

  it('filters the attendance sheet by status chip and search', async () => {
    render(<HrmsPage />)
    await openTab('Attendance')
    await screen.findByLabelText('Status for Cy Young')
    await userEvent.click(screen.getByRole('button', { name: '1 Not marked' }))
    expect(screen.queryByLabelText('Status for Ana Ruiz')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Status for Cy Young')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '1 Not marked' }))
    await userEvent.type(screen.getByLabelText('Search the attendance sheet'), 'ana')
    expect(screen.queryByLabelText('Status for Cy Young')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Status for Ana Ruiz')).toBeInTheDocument()
  })

  it('shows an error when the overview cannot load', async () => {
    api.overview.mockRejectedValue({ response: { data: { detail: 'Database unavailable' } } })
    render(<HrmsPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Database unavailable')
  })
})
