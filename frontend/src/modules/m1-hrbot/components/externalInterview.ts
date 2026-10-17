import type {
  ExternalPlatform, ExternalRecommendation, ExternalStatus, GuideQuestion,
  InterviewDimension, InterviewerRole, StoredRatings,
} from '../../../lib/api'

export const PLATFORM_OPTIONS: { value: ExternalPlatform; label: string }[] = [
  { value: 'zoom', label: 'Zoom' },
  { value: 'meet', label: 'Google Meet' },
  { value: 'teams', label: 'Microsoft Teams' },
  { value: 'other', label: 'Other' },
]

export const PHYSICAL_PLATFORM_LABEL = 'In person'
export const MAX_LOCATION = 300

export function platformName(value?: string | null): string {
  if (!value) return ''
  if (value === 'physical') return PHYSICAL_PLATFORM_LABEL
  return PLATFORM_OPTIONS.find(p => p.value === value)?.label ?? ''
}

export const EXTERNAL_STATUS_BADGE: Record<ExternalStatus, { label: string; tone: string }> = {
  scheduled:       { label: 'Scheduled',       tone: 'badge-blue' },
  awaiting_review: { label: 'Awaiting review', tone: 'badge-yellow' },
  no_show:         { label: 'No-show',         tone: 'badge-red' },
  reviewed:        { label: 'Reviewed',        tone: 'badge-green' },
}

export function formatWhen(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

const MEETING_FIELD_LABEL: Record<string, string> = {
  scheduled_start_at: 'Time',
  join_url: 'Link',
  location: 'Address',
  platform: 'Platform',
  platform_label: 'Platform name',
  duration_minutes: 'Duration',
  notes: 'Notes',
}
const MAX_CHANGE_VALUE = 60

function meetingChangeValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '-'
  let shown: string
  if (field === 'scheduled_start_at' && typeof value === 'string') shown = formatWhen(value) || value
  else if (field === 'platform') shown = platformName(String(value)) || String(value)
  else if (field === 'duration_minutes') shown = `${String(value)} minutes`
  else shown = typeof value === 'string' ? value : String(value)
  return shown.length > MAX_CHANGE_VALUE ? `${shown.slice(0, MAX_CHANGE_VALUE - 1)}…` : shown
}

export function describeMeetingChange(field: string, change: unknown): string {
  const label = MEETING_FIELD_LABEL[field] ?? field.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())
  const [before, after] = Array.isArray(change) ? change : [undefined, change]
  return `${label}: ${meetingChangeValue(field, before)} to ${meetingChangeValue(field, after)}`
}

export function toLocalInput(when: string | Date | null | undefined): string {
  if (!when) return ''
  const d = typeof when === 'string' ? new Date(when) : when
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export function isHttpsUrl(value: string): boolean {
  try {
    const u = new URL(value)
    return u.protocol === 'https:' && u.hostname !== ''
  } catch {
    return false
  }
}

export function errorDetail(e: unknown): string {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  return typeof detail === 'string' ? detail.trim() : ''
}

export function errorStatus(e: unknown): number {
  const status = (e as { response?: { status?: unknown } })?.response?.status
  return typeof status === 'number' ? status : 0
}

export const DIMENSIONS: { key: InterviewDimension; label: string }[] = [
  { key: 'technical',       label: 'Technical' },
  { key: 'communication',   label: 'Communication' },
  { key: 'problem_solving', label: 'Problem solving' },
  { key: 'cultural_fit',    label: 'Cultural fit' },
  { key: 'confidence',      label: 'Confidence' },
]

export function dimensionLabel(key: string): string {
  return DIMENSIONS.find(d => d.key === key)?.label ?? key.replace(/_/g, ' ')
}

export const RATING_SCALE = [1, 2, 3, 4, 5]
export const RATING_LABELS: Record<number, string> = {
  1: 'Poor', 2: 'Below expectations', 3: 'Meets', 4: 'Strong', 5: 'Excellent',
}

export const INTERVIEWER_ROLES: { value: InterviewerRole; label: string }[] = [
  { value: 'hr',             label: 'HR' },
  { value: 'engineer',       label: 'Engineer' },
  { value: 'hiring_manager', label: 'Hiring manager' },
  { value: 'other',          label: 'Other' },
]

export function roleLabel(role?: string | null): string {
  return INTERVIEWER_ROLES.find(r => r.value === role)?.label ?? ''
}

export const RECOMMENDATIONS: { value: ExternalRecommendation; label: string; tone: string }[] = [
  { value: 'strong_hire', label: 'Strong hire', tone: 'badge-green' },
  { value: 'hire',        label: 'Hire',        tone: 'badge-green' },
  { value: 'hold',        label: 'Hold',        tone: 'badge-yellow' },
  { value: 'no_hire',     label: 'Do not hire', tone: 'badge-red' },
]

export const GENERIC_GUIDE_NOTE = 'These questions are generic, not tailored to this candidate.'

export function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null
}

export function overallOutOf100(ratings: Partial<Record<InterviewDimension, number>>): number | null {
  const m = mean(DIMENSIONS.map(d => ratings[d.key]).filter((v): v is number => typeof v === 'number'))
  return m === null ? null : Math.round(m * 20)
}

export function storedOverallOutOf100(overall: number | null | undefined): number | null {
  if (typeof overall !== 'number' || Number.isNaN(overall)) return null
  return Math.round(overall > 5 ? overall : overall * 20)
}

export function storedRating(ratings: StoredRatings | null | undefined, key: InterviewDimension): number | undefined {
  const v = ratings?.[key] ?? (key === 'cultural_fit' ? ratings?.culture_fit : undefined)
  return typeof v === 'number' ? v : undefined
}

export function guideAsText(questions: GuideQuestion[], heading: string): string {
  const lines = [heading, '']
  questions.forEach((q, i) => {
    lines.push(`${i + 1}. ${q.text} (${dimensionLabel(q.dimension)})`)
    if (q.listen_for) lines.push(`   Listen for: ${q.listen_for}`)
    lines.push('')
  })
  return lines.join('\n').trimEnd()
}
