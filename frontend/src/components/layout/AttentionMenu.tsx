import { useEffect, useId, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  attentionApi, type AttentionDetail, type AttentionItem, type AttentionSeverity,
} from '../../lib/api'
import { candidateLabel } from '../../lib/erased'
import './AttentionMenu.css'

type LoadStatus = 'loading' | 'error' | 'ready'
type DetailState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: AttentionDetail }

const BADGE_TONE: Record<AttentionSeverity, string> = {
  info: 'badge-blue',
  warn: 'badge-yellow',
  urgent: 'badge-red',
}
const SEVERITY_ORDER: AttentionSeverity[] = ['urgent', 'warn', 'info']

const WORKSPACE_PATH = '/dashboard/hrbot'

const AlertIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
)

const ChevronIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="att-chevron">
    <polyline points="6 9 12 15 18 9" />
  </svg>
)

const isAppPath = (path: string) => path.startsWith('/') && !path.startsWith('//')

function destination(path: string, query?: Record<string, string>): { pathname: string; search: string } {
  const at = path.indexOf('?')
  const pathname = at === -1 ? path : path.slice(0, at)
  const params = new URLSearchParams(at === -1 ? '' : path.slice(at + 1))
  for (const [name, value] of Object.entries(query ?? {})) params.set(name, value)
  const search = params.toString()
  return { pathname, search: search ? `?${search}` : '' }
}

const shown = (n: number) => (n > 99 ? '99+' : String(n))

export default function AttentionMenu() {
  const titleId = useId()
  const navigate = useNavigate()
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [items, setItems] = useState<AttentionItem[]>([])
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [details, setDetails] = useState<Record<string, DetailState>>({})
  const alive = useRef(true)

  function load() {
    attentionApi.get()
      .then(r => { if (alive.current) { setItems(r.data?.items ?? []); setStatus('ready') } })
      .catch(() => { if (alive.current) setStatus(s => (s === 'ready' ? s : 'error')) })
  }

  useEffect(() => {
    alive.current = true
    load()
    return () => { alive.current = false }
  }, [])

  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function close() {
    setOpen(false)
    setOpenKey(null)
  }

  function toggle() {
    if (open) { close(); return }
    setOpen(true)
    load()
  }

  function loadDetail(key: string) {
    setDetails(d => (d[key]?.status === 'ready' ? d : { ...d, [key]: { status: 'loading' } }))
    attentionApi.detail(key)
      .then(r => setDetails(d => ({ ...d, [key]: { status: 'ready', data: r.data } })))
      .catch(() => setDetails(d => ({ ...d, [key]: { status: 'error' } })))
  }

  function choose(item: AttentionItem) {
    const attentionKey = item.query?.attention
    if (attentionKey) {
      if (openKey === item.key) { setOpenKey(null); return }
      setOpenKey(item.key)
      loadDetail(attentionKey)
      return
    }
    if (!isAppPath(item.path)) return
    navigate(destination(item.path, item.query))
    close()
  }

  function openCandidate(jobId: string, candidateId: string) {
    navigate({ pathname: WORKSPACE_PATH, search: `?${new URLSearchParams({ job: jobId, candidate: candidateId }).toString()}` })
    close()
  }

  function renderDetail(item: AttentionItem, attentionKey: string) {
    const detail = details[attentionKey]
    if (!detail || detail.status === 'loading') return <p className="att-status" role="status">Loading…</p>
    if (detail.status === 'error') {
      return (
        <div className="att-error" role="alert">
          <span>Could not load.</span>
          <button type="button" className="att-retry" onClick={() => loadDetail(attentionKey)}>Retry</button>
        </div>
      )
    }
    const { items: people, total } = detail.data
    if (people.length === 0) return <p className="att-empty">Nothing to show</p>
    return (
      <>
        <ul className="att-items" aria-label={item.label}>
          {people.map(c => (
            <li key={`${c.job_id}-${c.candidate_id}`}>
              <button type="button" className="att-item" onClick={() => openCandidate(c.job_id, c.candidate_id)}>
                <span className={`att-item-name${c.erased ? ' att-item-erased' : ''}`}>{candidateLabel(c, '-')}</span>
                <span className="att-item-where">
                  {c.job_title}
                  {c.job_title && c.stage ? ' · ' : ''}
                  {c.stage && <span className="att-stage">{c.stage.replace(/_/g, ' ')}</span>}
                </span>
                {c.detail && <span className="att-item-detail">{c.detail}</span>}
              </button>
            </li>
          ))}
        </ul>
        {total > people.length && <p className="att-more">Showing {people.length} of {total}</p>}
      </>
    )
  }

  const total = items.reduce((sum, i) => sum + (Number(i.count) || 0), 0)
  const worst = SEVERITY_ORDER.find(s => items.some(i => i.severity === s)) ?? 'info'
  const label = status === 'ready' && total > 0 ? `Needs attention, ${total} waiting` : 'Needs attention'

  return (
    <div className="attm" ref={rootRef}>
      <button
        type="button"
        className="attm-trigger"
        aria-label={label}
        title="Needs attention"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
      >
        <AlertIcon />
        {status === 'ready' && total > 0 && (
          <span className={`attm-count attm-count-${worst}`} data-severity={worst}>{shown(total)}</span>
        )}
      </button>

      {open && (
        <div className="attm-panel" role="dialog" aria-labelledby={titleId}>
          <h3 className="attm-title" id={titleId}>Needs attention</h3>

          {status === 'loading' && <p className="att-status" role="status">Loading…</p>}

          {status === 'error' && (
            <div className="att-error" role="alert">
              <span>Could not load.</span>
              <button type="button" className="att-retry" onClick={load}>Retry</button>
            </div>
          )}

          {status === 'ready' && items.length === 0 && <p className="att-empty">Nothing needs attention</p>}

          {status === 'ready' && items.length > 0 && (
            <ul className="att-list">
              {items.map(item => {
                const attentionKey = item.query?.attention
                const expandable = !!attentionKey
                const isOpen = expandable && openKey === item.key
                const panelId = `${titleId}-${item.key}`
                return (
                  <li key={item.key} className={isOpen ? 'att-open' : undefined}>
                    <button
                      type="button"
                      className="att-row"
                      aria-expanded={expandable ? isOpen : undefined}
                      aria-controls={isOpen ? panelId : undefined}
                      onClick={() => choose(item)}
                    >
                      <span className="att-label">{item.label}</span>
                      <span className="att-row-end">
                        <span className={`badge att-count ${BADGE_TONE[item.severity] ?? BADGE_TONE.info}`} data-severity={item.severity}>
                          {item.count}
                        </span>
                        {expandable && <ChevronIcon />}
                      </span>
                    </button>
                    {isOpen && attentionKey && <div className="att-detail" id={panelId}>{renderDetail(item, attentionKey)}</div>}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
