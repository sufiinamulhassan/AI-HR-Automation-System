export type SortDir = 'asc' | 'desc'

export interface SortState {
  key: string
  dir: SortDir
}

type Cell = number | string | null | undefined

function compareCells(a: Cell, b: Cell, dir: SortDir): number {
  const aMissing = a === null || a === undefined || a === ''
  const bMissing = b === null || b === undefined || b === ''
  if (aMissing || bMissing) return aMissing === bMissing ? 0 : aMissing ? 1 : -1
  const order =
    typeof a === 'number' && typeof b === 'number'
      ? a - b
      : String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true })
  return dir === 'asc' ? order : -order
}

export function sortRows<T>(rows: readonly T[], sort: SortState | null, valueOf: (row: T, key: string) => Cell): T[] {
  if (!sort) return [...rows]
  return [...rows].sort((x, y) => compareCells(valueOf(x, sort.key), valueOf(y, sort.key), sort.dir))
}

export function nextSort(current: SortState | null, key: string, numeric: boolean): SortState {
  if (current && current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
  return { key, dir: numeric ? 'desc' : 'asc' }
}

export function ariaSortOf(current: SortState | null, key: string): 'ascending' | 'descending' | 'none' {
  if (!current || current.key !== key) return 'none'
  return current.dir === 'asc' ? 'ascending' : 'descending'
}
