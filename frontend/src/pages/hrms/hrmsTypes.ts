export interface Employee {
  employee_id: string
  full_name: string
  email: string
  phone?: string | null
  designation: string
  department?: string | null
  department_name: string
  manager_id?: string | null
  manager_name: string
  employment_type?: string | null
  location?: string | null
  joined_on?: string | null
  employee_code?: string | null
  job_grade?: string | null
  status: 'active' | 'on_leave' | 'exited'
  source: 'manual' | 'offer'
  exited_on?: string | null
  exit_reason?: string | null
}

export interface LeaveBalance {
  leave_type_id: string
  name: string
  allowance: number
  used: number
  pending: number
  remaining: number
  active: boolean
}

export interface LeaveType {
  leave_type_id: string
  code: string
  name: string
  annual_allowance: number
  active: boolean
}

export interface LeaveRequest {
  request_id: string
  employee_id: string
  employee_name: string
  department_name: string
  leave_type_id: string
  leave_type_name: string
  start_date: string
  end_date: string
  half_day: boolean
  days: number
  reason?: string | null
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  decision_note?: string | null
}

export interface AttendanceRecord {
  status: AttendanceStatus
  check_in?: string | null
  check_out?: string | null
  note?: string | null
  source?: string
}

export type AttendanceStatus = 'present' | 'absent' | 'half_day' | 'remote' | 'on_leave'

export interface AttendanceRow {
  employee_id: string
  full_name: string
  designation: string
  department_name: string
  record: AttendanceRecord | null
}

export interface AttendanceSheet {
  date: string
  weekend: boolean
  holiday: string | null
  rows: AttendanceRow[]
  counts: Record<AttendanceStatus | 'unmarked', number>
}

export interface SummaryRow {
  employee_id: string
  full_name: string
  department_name: string
  present: number
  absent: number
  half_day: number
  remote: number
  on_leave: number
  working_days: number
  unmarked: number
  attendance_rate: number | null
  hours: number
}

export interface Holiday {
  holiday_id: string
  date: string
  name: string
  optional: boolean
}

export interface Overview {
  date: string
  headcount: number
  active: number
  exited: number
  on_leave_today: { employee_id: string; employee_name: string; leave_type_name: string; end_date: string }[]
  pending_leave: number
  attendance_today: Record<AttendanceStatus | 'unmarked', number>
  new_joiners: { employee_id: string; full_name: string; designation: string; joined_on: string }[]
  upcoming_holidays: Holiday[]
  departments: { name: string; count: number }[]
}

export const STATUS_LABELS: Record<Employee['status'], string> = {
  active: 'Active',
  on_leave: 'On leave',
  exited: 'Exited',
}

export const STATUS_BADGE: Record<Employee['status'], string> = {
  active: 'badge-green',
  on_leave: 'badge-yellow',
  exited: 'badge-gray',
}

export const EMPLOYMENT_LABELS: Record<string, string> = {
  full_time: 'Full time',
  part_time: 'Part time',
  contract: 'Contract',
  intern: 'Intern',
}

export const ATTENDANCE_LABELS: Record<AttendanceStatus, string> = {
  present: 'Present',
  remote: 'Remote',
  half_day: 'Half day',
  absent: 'Absent',
  on_leave: 'On leave',
}

export const LEAVE_BADGE: Record<LeaveRequest['status'], string> = {
  pending: 'badge-yellow',
  approved: 'badge-green',
  rejected: 'badge-red',
  cancelled: 'badge-gray',
}

export function todayIso(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function formatDay(iso?: string | null): string {
  if (!iso) return '-'
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export function errorText(err: unknown, fallback: string): string {
  const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  return typeof detail === 'string' && detail ? detail : fallback
}

export function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`
}

export interface HireQualityRow {
  employee_id: string
  full_name: string
  designation: string
  department_name: string
  status: Employee['status']
  match_score: number | null
  interview_score: number | null
  performance_score: number | null
  attendance_rate: number | null
  tenure_days: number | null
  verdict: string
}

export interface HireQuality {
  hired_through_hirely: number
  with_review: number
  paired: number
  correlation: number | null
  correlation_label: string
  strong_interview_performance: number | null
  other_interview_performance: number | null
  early_exits: number
  rows: HireQualityRow[]
}

export interface RiskSignal {
  points: number
  kind: 'attrition' | 'burnout'
  text: string
}

export interface RiskRow {
  employee_id: string
  full_name: string
  designation: string
  department_name: string
  score: number
  level: 'high' | 'medium' | 'low'
  burnout: boolean
  signals: RiskSignal[]
}

export interface RiskRadar {
  date: string
  counts: Record<RiskRow['level'], number>
  burnout: number
  rows: RiskRow[]
}

export interface CoverageDay {
  date: string
  off: { employee_id: string; full_name: string; status: string; leave_type_name?: string }[]
  available: number
  coverage: number
  low: boolean
}

export interface Coverage {
  employee_name: string
  team: string
  team_size: number
  days: CoverageDay[]
  low_days: number
  warning: boolean
}

export interface Analytics {
  date: string
  headcount_trend: { month: string; headcount: number; joiners: number; exits: number }[]
  attendance_trend: { date: string; present: number; remote: number; half_day: number; absent: number; on_leave: number; marked: number; rate: number | null }[]
  leave_by_type: { name: string; approved: number; pending: number }[]
  employment_mix: { type: string; count: number }[]
  tenure: { label: string; count: number }[]
  attrition_rate: number | null
  average_attendance: number | null
  joiners_12m: number
  exits_12m: number
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  if (!y || !m) return month
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
}

export function shortDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}
