import type { ExternalPlatform } from '../../../lib/api'
import { PLATFORM_OPTIONS, toLocalInput } from './externalInterview'
import { readStoredJson, writeStoredJson } from './safeStorage'

export interface InterviewPrefs {
  platform: ExternalPlatform
  duration: string
  label: string
}

const KEY_PREFIX = 'hr-bot.interview-setup:'
const MAX_LABEL = 40

const keyFor = (userKey: string) => `${KEY_PREFIX}${userKey.trim().toLowerCase()}`

export function loadInterviewPrefs(userKey: string | null | undefined): Partial<InterviewPrefs> {
  if (!userKey?.trim()) return {}
  const raw = readStoredJson(keyFor(userKey))
  if (!raw || typeof raw !== 'object') return {}
  const stored = raw as Record<string, unknown>
  const out: Partial<InterviewPrefs> = {}
  if (PLATFORM_OPTIONS.some(p => p.value === stored.platform)) out.platform = stored.platform as ExternalPlatform
  if (typeof stored.duration === 'string') {
    const minutes = Number(stored.duration)
    if (stored.duration.trim() !== '' && Number.isInteger(minutes) && minutes >= 5 && minutes <= 480) out.duration = String(minutes)
  }
  if (typeof stored.label === 'string' && stored.label.trim().length <= MAX_LABEL) out.label = stored.label.trim()
  return out
}

export function saveInterviewPrefs(userKey: string | null | undefined, prefs: InterviewPrefs): void {
  if (!userKey?.trim()) return
  const label = prefs.label.trim() || loadInterviewPrefs(userKey).label || ''
  writeStoredJson(keyFor(userKey), { platform: prefs.platform, duration: prefs.duration, label })
}

export function nextBusinessDayAtTen(now: Date = new Date()): string {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 10, 0, 0, 0)
  while (day.getDay() === 0 || day.getDay() === 6) day.setDate(day.getDate() + 1)
  return toLocalInput(day)
}
