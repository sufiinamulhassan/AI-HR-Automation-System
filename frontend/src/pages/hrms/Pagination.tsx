import { useEffect, useMemo, useState } from 'react'

export const PAGE_SIZES = [10, 25, 50, 100]

export function usePaged<T>(rows: T[], initialSize = 10, resetKey = '') {
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(initialSize)
  const pages = Math.max(1, Math.ceil(rows.length / size))
  useEffect(() => { setPage(1) }, [resetKey, size])
  useEffect(() => { if (page > pages) setPage(pages) }, [page, pages])
  const slice = useMemo(() => rows.slice((page - 1) * size, page * size), [rows, page, size])
  return { page, size, pages, total: rows.length, slice, setPage, setSize }
}

interface Props {
  page: number
  pages: number
  total: number
  size: number
  label: string
  onPage: (page: number) => void
  onSize: (size: number) => void
}

function pageWindow(page: number, pages: number): (number | 'gap')[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1)
  const set = new Set([1, pages, page - 1, page, page + 1])
  const list = [...set].filter(n => n >= 1 && n <= pages).sort((a, b) => a - b)
  const out: (number | 'gap')[] = []
  list.forEach((n, i) => {
    if (i && n - list[i - 1] > 1) out.push('gap')
    out.push(n)
  })
  return out
}

export default function Pagination({ page, pages, total, size, label, onPage, onSize }: Props) {
  if (total === 0) return null
  const first = (page - 1) * size + 1
  const last = Math.min(total, page * size)
  return (
    <nav className="hr-pager" aria-label={`${label} pages`}>
      <span className="hr-muted">Showing {first.toLocaleString()} to {last.toLocaleString()} of {total.toLocaleString()} {label}</span>
      <div className="hr-pager-controls">
        <label className="hr-pager-size">
          Rows
          <select className="form-input" value={size} onChange={e => onSize(Number(e.target.value))} aria-label="Rows per page">
            {PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <button type="button" className="hr-page-btn" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous page">‹</button>
        {pageWindow(page, pages).map((n, i) => n === 'gap'
          ? <span key={`gap-${i}`} className="hr-page-gap" aria-hidden="true">…</span>
          : (
            <button key={n} type="button" className={`hr-page-btn${n === page ? ' hr-page-on' : ''}`}
              aria-current={n === page ? 'page' : undefined} aria-label={`Page ${n}`} onClick={() => onPage(n)}>
              {n}
            </button>
          ))}
        <button type="button" className="hr-page-btn" onClick={() => onPage(page + 1)} disabled={page >= pages} aria-label="Next page">›</button>
      </div>
    </nav>
  )
}

export function downloadCsv(filename: string, columns: string[], rows: (string | number | null | undefined)[][]) {
  const cell = (v: string | number | null | undefined) => {
    const text = v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  const body = [columns, ...rows].map(r => r.map(cell).join(',')).join('\n')
  const url = URL.createObjectURL(new Blob([body], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
