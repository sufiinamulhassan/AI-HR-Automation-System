import type { ExternalRatings, ExternalRecommendation, InterviewDimension, InterviewerRole } from '../../../lib/api'
import { DIMENSIONS, INTERVIEWER_ROLES, RECOMMENDATIONS } from './externalInterview'
import { readStoredJson, removeStored, writeStoredJson } from './safeStorage'

export const SCORECARD_LIMITS = { name: 120, summary: 4000, detail: 2000, notes: 2000 } as const

export interface DraftEntry { rating: number | null; notes: string }

export interface ScorecardDraft {
  name: string
  role: InterviewerRole | ''
  marks: Record<string, DraftEntry>
  ratings: Partial<ExternalRatings>
  recommendation: ExternalRecommendation | ''
  summary: string
  strengths: string
  concerns: string
}

const KEY_PREFIX = 'hr-bot.scorecard-draft:'
export const DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000
const MAX_MARKS = 200

export function scorecardDraftKey(scope: 'candidate' | 'link', id: string, owner?: string | null): string {
  const who = scope === 'candidate' && owner?.trim() ? `${owner.trim().toLowerCase()}:` : ''
  return `${KEY_PREFIX}${scope}:${who}${id}`
}

const isRating = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')

export function loadScorecardDraft(key: string, now: number = Date.now()): ScorecardDraft | null {
  const raw = readStoredJson(key)
  if (!raw || typeof raw !== 'object') return null
  const stored = raw as Record<string, unknown>
  const savedAt = typeof stored.savedAt === 'number' ? stored.savedAt : 0
  if (now - savedAt > DRAFT_TTL_MS) {
    removeStored(key)
    return null
  }

  const marks: Record<string, DraftEntry> = {}
  if (stored.marks && typeof stored.marks === 'object') {
    for (const [id, entry] of Object.entries(stored.marks as Record<string, unknown>).slice(0, MAX_MARKS)) {
      if (!entry || typeof entry !== 'object') continue
      const e = entry as Record<string, unknown>
      marks[id] = { rating: isRating(e.rating) ? e.rating : null, notes: text(e.notes, SCORECARD_LIMITS.notes) }
    }
  }

  const ratings: Partial<ExternalRatings> = {}
  if (stored.ratings && typeof stored.ratings === 'object') {
    const r = stored.ratings as Record<string, unknown>
    for (const d of DIMENSIONS) if (isRating(r[d.key])) ratings[d.key as InterviewDimension] = r[d.key] as number
  }

  return {
    name: text(stored.name, SCORECARD_LIMITS.name),
    role: INTERVIEWER_ROLES.some(r => r.value === stored.role) ? (stored.role as InterviewerRole) : '',
    marks,
    ratings,
    recommendation: RECOMMENDATIONS.some(r => r.value === stored.recommendation) ? (stored.recommendation as ExternalRecommendation) : '',
    summary: text(stored.summary, SCORECARD_LIMITS.summary),
    strengths: text(stored.strengths, SCORECARD_LIMITS.detail),
    concerns: text(stored.concerns, SCORECARD_LIMITS.detail),
  }
}

export function saveScorecardDraft(key: string, draft: ScorecardDraft, now: number = Date.now()): void {
  writeStoredJson(key, { v: 1, savedAt: now, ...draft })
}

export function clearScorecardDraft(key: string | undefined): void {
  if (key) removeStored(key)
}
