export const NAME_MIN = 2
export const NAME_MAX = 120
export const PHONE_MIN = 5
export const PHONE_MAX = 30
export const NOTE_MAX = 2000
export const MAX_RESUME_MB = 4
export const MAX_RESUME_BYTES = MAX_RESUME_MB * 1024 * 1024
export const RESUME_EXTENSIONS = ['pdf', 'doc', 'docx', 'txt']
export const RESUME_ACCEPT = RESUME_EXTENSIONS.map(ext => `.${ext}`).join(',')

const PHONE_PATTERN = /^[0-9+()\-. ]+$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'} ago`
}

export function postedAgo(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const elapsed = Math.max(0, now - then)
  if (elapsed < MINUTE) return 'just now'
  if (elapsed < HOUR) return plural(Math.floor(elapsed / MINUTE), 'minute')
  if (elapsed < DAY) return plural(Math.floor(elapsed / HOUR), 'hour')
  const days = Math.floor(elapsed / DAY)
  if (days < 30) return plural(days, 'day')
  if (days < 365) return plural(Math.floor(days / 30), 'month')
  return plural(Math.floor(days / 365), 'year')
}

export function formatDate(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone })
}

export function deadlineText(iso: string | null | undefined, now: number = Date.now(), timeZone?: string): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  if (date.getTime() < now) return 'Closed'
  const yearOf = (d: Date) => d.toLocaleDateString('en-US', { year: 'numeric', timeZone })
  const sameYear = yearOf(date) === yearOf(new Date(now))
  const label = date.toLocaleDateString('en-US', sameYear
    ? { month: 'short', day: 'numeric', timeZone }
    : { month: 'short', day: 'numeric', year: 'numeric', timeZone })
  return `Closes ${label}`
}

export function placeLabel(location: string | null | undefined, isRemote: boolean): string {
  const place = (location ?? '').trim()
  return isRemote && place.toLowerCase() === 'remote' ? '' : place
}

export function sentenceCase(value: string | null | undefined): string {
  const text = String(value ?? '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : ''
}

export function employmentTypeLabel(value: string | null | undefined): string {
  return sentenceCase(value)
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${Math.round(bytes)} B`
  const trim = (n: number) => n.toFixed(1).replace(/\.0$/, '')
  if (bytes < 1024 * 1024) return `${trim(bytes / 1024)} KB`
  return `${trim(bytes / (1024 * 1024))} MB`
}

export function companyInitial(name: string | null | undefined): string {
  const first = String(name ?? '').trim().charAt(0)
  return first ? first.toUpperCase() : '?'
}

export function safeHttpUrl(value: string | null | undefined): string {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' || url.protocol === 'http:' ? raw : ''
  } catch {
    return ''
  }
}

export function collapseSpaces(value: string): string {
  return value.split(/\s+/).filter(Boolean).join(' ')
}

export function validateName(value: string): string {
  const name = collapseSpaces(value)
  if (name.length < NAME_MIN) return 'Enter your full name.'
  if (name.length > NAME_MAX) return `Your name must be at most ${NAME_MAX} characters.`
  return ''
}

export function validateEmail(value: string): string {
  return EMAIL_PATTERN.test(value.trim()) ? '' : 'Enter a valid email address.'
}

export function validatePhone(value: string): string {
  const phone = collapseSpaces(value)
  if (!phone) return ''
  const ok = phone.length >= PHONE_MIN && phone.length <= PHONE_MAX && PHONE_PATTERN.test(phone)
  return ok ? '' : 'Enter a valid phone number, or leave it empty.'
}

export function validateNote(value: string): string {
  return value.trim().length > NOTE_MAX ? `Your note must be at most ${NOTE_MAX} characters.` : ''
}

export function validateConsent(checked: boolean): string {
  return checked ? '' : 'Please agree to the processing of your application to continue.'
}

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase()
}

export function validateResume(file: { name: string; size: number } | null | undefined): string {
  if (!file) return 'Attach your résumé as a file.'
  if (!RESUME_EXTENSIONS.includes(fileExtension(file.name))) {
    return 'Upload a PDF, Word (.doc or .docx) or plain text (.txt) file.'
  }
  if (file.size <= 0) return 'That file is empty.'
  if (file.size > MAX_RESUME_BYTES) return `The file is too large. The limit is ${MAX_RESUME_MB} MB.`
  return ''
}

export interface ApplicationValues {
  name: string
  email: string
  phone: string
  note: string
  consent: boolean
  resume: File | null
}

export type ApplicationField = keyof ApplicationValues

export type ApplicationErrors = Partial<Record<ApplicationField, string>>

export function validateField(field: ApplicationField, values: ApplicationValues): string {
  switch (field) {
    case 'name': return validateName(values.name)
    case 'email': return validateEmail(values.email)
    case 'phone': return validatePhone(values.phone)
    case 'note': return validateNote(values.note)
    case 'consent': return validateConsent(values.consent)
    case 'resume': return validateResume(values.resume)
  }
}

export const APPLICATION_FIELDS: ApplicationField[] = ['name', 'email', 'phone', 'resume', 'note', 'consent']

export function validateApplication(values: ApplicationValues): ApplicationErrors {
  const errors: ApplicationErrors = {}
  for (const field of APPLICATION_FIELDS) {
    const message = validateField(field, values)
    if (message) errors[field] = message
  }
  return errors
}

export function applyErrorMessage(error: unknown): string {
  const failure = error as { response?: { status?: number; data?: { detail?: unknown } } }
  const response = failure?.response
  if (!response) return 'We could not reach the server. Check your connection and try again.'
  const detail = response.data?.detail
  if (typeof detail === 'string' && detail.trim()) return detail.trim()
  if (response.status === 429) return 'Too many attempts. Please wait a while and try again.'
  if (response.status === 413) return `The file is too large. The limit is ${MAX_RESUME_MB} MB.`
  if (response.status === 415) return 'Upload a PDF, Word (.doc or .docx) or plain text (.txt) file.'
  if (response.status === 404) return 'This job is no longer open.'
  return 'We could not send your application. Please try again.'
}
