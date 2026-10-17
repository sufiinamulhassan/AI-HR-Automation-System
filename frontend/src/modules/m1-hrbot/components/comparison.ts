import type { ComparisonRecommendation, ComparisonRow, ComparisonSource } from '../../../lib/api'
import { candidateLabel } from '../../../lib/erased'
import { DIMENSIONS } from './externalInterview'

export const SOURCE_LABEL: Record<ComparisonSource, string> = {
  ai: 'AI interview',
  interviewer_scorecard: 'Scorecard',
}

export const RECOMMENDATION_BADGE: Record<ComparisonRecommendation, { label: string; tone: string }> = {
  hire: { label: 'Hire', tone: 'badge-green' },
  maybe: { label: 'Maybe', tone: 'badge-yellow' },
  reject: { label: 'Reject', tone: 'badge-red' },
}

const RECOMMENDATION_ORDER: Record<ComparisonRecommendation, number> = { hire: 2, maybe: 1, reject: 0 }

export type SortKey =
  | 'rank' | 'name' | 'stage' | 'source' | 'final_score' | 'technical' | 'communication'
  | 'problem_solving' | 'cultural_fit' | 'confidence' | 'recommendation' | 'offer_status'

export interface SortState { key: SortKey; dir: 'asc' | 'desc' }

export const SCORE_COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'final_score', label: 'Final score' },
  ...DIMENSIONS.map(d => ({ key: d.key as SortKey, label: d.label })),
]

export function isScoreKey(key: SortKey): boolean {
  return SCORE_COLUMNS.some(c => c.key === key)
}

export function offerLabel(status: string | null | undefined): string {
  if (!status) return '-'
  const spaced = status.replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

export function scoreText(value: number | null | undefined): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-'
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

export function scoreOf(row: ComparisonRow, key: SortKey): number | null {
  const v = key === 'final_score' ? row.final_score : row.dimensions?.[key as keyof ComparisonRow['dimensions']]
  return typeof v === 'number' && !Number.isNaN(v) ? v : null
}

export function bestScore(values: (number | null)[]): number | null {
  const scored = values.filter((v): v is number => v !== null)
  if (scored.length < 2) return null
  const max = Math.max(...scored)
  return max > Math.min(...scored) ? max : null
}

export function bestRecommendation(values: (ComparisonRecommendation | null)[]): ComparisonRecommendation | null {
  const given = values.filter((v): v is ComparisonRecommendation => v !== null)
  if (given.length < 2) return null
  const ranks = given.map(v => RECOMMENDATION_ORDER[v] ?? 0)
  const max = Math.max(...ranks)
  if (max === Math.min(...ranks)) return null
  return given.find(v => (RECOMMENDATION_ORDER[v] ?? 0) === max) ?? null
}

export function defaultDirection(key: SortKey): 'asc' | 'desc' {
  return isScoreKey(key) || key === 'recommendation' ? 'desc' : 'asc'
}

export function sortRows(rows: ComparisonRow[], sort: SortState): ComparisonRow[] {
  const sign = sort.dir === 'asc' ? 1 : -1
  const valueOf = (row: ComparisonRow): number | string | null => {
    switch (sort.key) {
      case 'rank': return row.rank
      case 'name': return (row.name ?? '').toLowerCase() || null
      case 'stage': return row.stage || null
      case 'source': return row.source || null
      case 'offer_status': return row.offer_status || null
      case 'recommendation': return row.recommendation ? RECOMMENDATION_ORDER[row.recommendation] ?? null : null
      default: return scoreOf(row, sort.key)
    }
  }
  return rows
    .map((row, index) => ({ row, index, value: valueOf(row) }))
    .sort((a, b) => {
      if (a.value === null && b.value === null) return a.index - b.index
      if (a.value === null) return 1
      if (b.value === null) return -1
      const order = typeof a.value === 'string' && typeof b.value === 'string'
        ? a.value.localeCompare(b.value)
        : Number(a.value) - Number(b.value)
      return order !== 0 ? order * sign : a.index - b.index
    })
    .map(entry => entry.row)
}

export function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  let text = String(value)
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

const BOM = String.fromCharCode(0xfeff)

export const CSV_HEADER = [
  'Rank', 'Candidate', 'Stage', 'Source', 'Final score',
  ...DIMENSIONS.map(d => d.label),
  'Recommendation', 'Offer status', 'Interviewed', 'Match score',
]

export function comparisonToCsv(rows: ComparisonRow[]): string {
  const lines = [CSV_HEADER.map(csvField).join(',')]
  for (const row of rows) {
    lines.push([
      row.rank,
      candidateLabel(row, ''),
      row.stage,
      SOURCE_LABEL[row.source] ?? row.source,
      scoreOf(row, 'final_score'),
      ...DIMENSIONS.map(d => scoreOf(row, d.key)),
      row.recommendation ? RECOMMENDATION_BADGE[row.recommendation]?.label ?? row.recommendation : '',
      row.offer_status ? offerLabel(row.offer_status) : '',
      row.interviewed_at ?? '',
      typeof row.match_score === 'number' ? row.match_score : null,
    ].map(csvField).join(','))
  }
  return `${BOM}${lines.join('\r\n')}\r\n`
}

export function csvFileName(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return `comparison-${slug || 'job'}.csv`
}
