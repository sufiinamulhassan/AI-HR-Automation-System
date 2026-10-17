import { relativeTime } from '../../lib/relativeTime'

export function fmtInt(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString()
}

export function fmtUsd(n: number | null | undefined): string {
  const v = n ?? 0
  if (v === 0) return '$0.00'
  if (v < 1) return `$${v.toFixed(4)}`
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function costBreakdownTiles(row: { ai_cost_usd: number; email_cost_usd: number }): [string, string][] {
  return [['AI spend', fmtUsd(row.ai_cost_usd)], ['Email (estimated)', fmtUsd(row.email_cost_usd)]]
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '-'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleDateString()
}

export function fmtMb(n: number | null | undefined): string {
  if (n === null || n === undefined) return '-'
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 1 })} MB`
}

export function fmtStorage(used: number | null | undefined, limit: number | null | undefined): string {
  if (used === null || used === undefined) return '-'
  if (limit === null || limit === undefined) return fmtMb(used)
  const num = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 })
  return `${num(used)} / ${num(limit)} MB`
}

export function fmtAsOf(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  return sameDay ? time : `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, ${time}`
}

export function fmtWhen(iso: string | null | undefined): string {
  return relativeTime(iso)
}

export function actionLabel(action: string): string {
  const spaced = action.replace(/[._]+/g, ' ').trim()
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : '-'
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function monthLabel(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month)
  if (!m) return month
  const name = MONTHS[Number(m[2]) - 1]
  return name ? `${name} ${m[1]}` : month
}

export function monthShort(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month)
  return (m && MONTHS[Number(m[2]) - 1]) || month
}

export function dayLabel(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  const name = m && MONTHS[Number(m[2]) - 1]
  return m && name ? `${Number(m[3])} ${name}` : date
}

export function errorDetail(e: unknown, fallback: string): string {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  if (typeof detail === 'string' && detail.trim()) return detail
  if (Array.isArray(detail)) {
    const messages = detail
      .map(d => (typeof d === 'string' ? d : (d as { msg?: unknown })?.msg))
      .filter((m): m is string => typeof m === 'string' && m.trim() !== '')
    if (messages.length) return messages.join('. ')
  }
  return fallback
}

export function errorStatus(e: unknown): number | undefined {
  return (e as { response?: { status?: number } })?.response?.status
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export function isEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim())
}

export const MIN_PASSWORD_LENGTH = 8

const pad2 = (n: number) => String(n).padStart(2, '0')

export function fmtPeriodEdge(value: string): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  const date = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
  const midnight = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0
  return midnight ? date : `${date} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())} UTC`
}

export function currentMonth(): string {
  const now = new Date()
  return `${now.getUTCFullYear()}-${pad2(now.getUTCMonth() + 1)}`
}
