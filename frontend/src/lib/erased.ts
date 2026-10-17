export const ERASED_LABEL = 'Erased candidate'

export function isErased(record: unknown): boolean {
  if (!record || typeof record !== 'object') return false
  const r = record as { erased?: unknown; resume?: unknown }
  if (r.erased === true) return true
  return !!r.resume && typeof r.resume === 'object' && (r.resume as { erased?: unknown }).erased === true
}

export function candidateLabel(
  record: { erased?: unknown; name?: unknown; candidate_name?: unknown; resume?: unknown } | null | undefined,
  fallback = '-',
): string {
  if (isErased(record)) return ERASED_LABEL
  const name = record?.name ?? record?.candidate_name
  return typeof name === 'string' && name.trim() ? name : fallback
}

export function failedVectors(value: unknown): number {
  if (Array.isArray(value)) return value.length
  if (typeof value === 'number') return value
  return value === true ? 1 : 0
}

export function eraseSummary(counts: Record<string, number> | undefined): string {
  return Object.entries(counts ?? {})
    .filter(([, n]) => typeof n === 'number' && n > 0)
    .map(([store, n]) => `${store.replace(/_/g, ' ')} ${n}`)
    .join(', ')
}
