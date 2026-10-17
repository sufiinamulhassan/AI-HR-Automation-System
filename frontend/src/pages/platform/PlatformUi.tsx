import { cloneElement, useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { PLATFORM_WINDOWS, type EntityStatus, type PlatformPeriod, type PlatformWindow, type UsagePeriod } from '../../lib/platformTypes'
import { currentMonth, fmtAsOf, fmtPeriodEdge } from './format'
import { ariaSortOf, type SortState } from './tableSort'
import './PlatformUi.css'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

interface ModalProps {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  onSubmit?: (e: FormEvent<HTMLFormElement>) => void
  wide?: boolean
}

export function Modal({ title, onClose, children, footer, onSubmit, wide }: ModalProps) {
  const boxRef = useRef<HTMLFormElement>(null)
  const titleId = useId()
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const box = boxRef.current
    const field = box?.querySelector<HTMLElement>('.pco-modal-body input, .pco-modal-body select, .pco-modal-body textarea')
    const cancel = box?.querySelector<HTMLElement>('.modal-footer .btn-ghost')
    ;(field ?? cancel ?? box?.querySelector<HTMLElement>(FOCUSABLE))?.focus()

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        closeRef.current()
        return
      }
      if (e.key !== 'Tab' || !box) return
      const items = Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      opener?.focus?.()
    }
  }, [])

  return createPortal(
    <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <form
        ref={boxRef}
        className={`modal-box pco-modal${wide ? ' pco-modal-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={onSubmit ?? (e => e.preventDefault())}
        noValidate
      >
        <div className="modal-header">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>&times;</button>
        </div>
        <div className="pco-modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </form>
    </div>,
    document.body,
  )
}

interface ConfirmDialogProps {
  title: string
  message: ReactNode
  confirmLabel: string
  danger?: boolean
  busy?: boolean
  error?: string
  onConfirm: () => void
  onCancel: () => void
  children?: ReactNode
}

export function ConfirmDialog({ title, message, confirmLabel, danger, busy, error, onConfirm, onCancel, children }: ConfirmDialogProps) {
  return (
    <Modal
      title={title}
      onClose={busy ? () => {} : onCancel}
      onSubmit={e => { e.preventDefault(); if (!busy) onConfirm() }}
      footer={
        <>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="submit" className={`btn btn-sm ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </>
      }
    >
      <div className="pco-confirm-message">{message}</div>
      {children}
      {error && <div className="pco-form-error" role="alert">{error}</div>}
    </Modal>
  )
}

export function Field({ label, hint, error, children }: {
  label: string
  hint?: string
  error?: string
  children: ReactElement<{ id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }>
}) {
  const id = useId()
  const helpId = `${id}-help`
  const message = error || hint
  return (
    <div className="pco-field">
      <label className="form-label" htmlFor={id}>{label}</label>
      {cloneElement(children, {
        id,
        'aria-describedby': message ? helpId : undefined,
        'aria-invalid': error ? true : undefined,
      })}
      {message && (
        error
          ? <span className="pco-field-error" id={helpId} role="alert">{error}</span>
          : <span className="pco-hint" id={helpId}>{hint}</span>
      )}
    </div>
  )
}

export function StatusBadge({ status, inactiveLabel = 'Suspended' }: { status: EntityStatus; inactiveLabel?: string }) {
  const active = status === 'active'
  return (
    <span className={`badge pco-status ${active ? 'badge-green' : 'badge-red'}`}>
      <span className="pco-status-dot" aria-hidden>{active ? '●' : '○'}</span>
      {active ? 'Active' : inactiveLabel}
    </span>
  )
}

export function WindowSelect({ value, onChange }: { value: PlatformWindow | null; onChange: (w: PlatformWindow) => void }) {
  return (
    <div className="pco-window" role="radiogroup" aria-label="Time window">
      {PLATFORM_WINDOWS.map(w => (
        <button
          key={w}
          type="button"
          role="radio"
          aria-checked={value === w}
          className={`pco-window-opt${value === w ? ' pco-window-opt-on' : ''}`}
          onClick={() => onChange(w)}
        >
          {w} days
        </button>
      ))}
    </div>
  )
}

export function PeriodSelect({ value, onChange }: { value: PlatformPeriod; onChange: (p: PlatformPeriod) => void }) {
  const month = typeof value === 'number' ? '' : value.month
  return (
    <div className="pco-period">
      <WindowSelect value={typeof value === 'number' ? value : null} onChange={onChange} />
      <label className="pco-month">
        <span className="pco-month-label">Calendar month</span>
        <input
          type="month"
          className="form-input pco-month-input"
          value={month}
          max={currentMonth()}
          onChange={e => { if (e.target.value) onChange({ month: e.target.value }) }}
        />
      </label>
    </div>
  )
}

export function PeriodRange({ period }: { period?: UsagePeriod }) {
  if (!period) return null
  return (
    <span className="pco-range" aria-label="Period covered">
      <time dateTime={period.from}>{fmtPeriodEdge(period.from)}</time>
      {' to '}
      <time dateTime={period.to}>{fmtPeriodEdge(period.to)}</time>
    </span>
  )
}

export function AsOf({ at, loading, onRefresh }: { at?: string; loading?: boolean; onRefresh: () => void }) {
  const when = fmtAsOf(at)
  return (
    <span className="pco-asof">
      {when && <time dateTime={at}>As of {when}</time>}
      <button type="button" className="btn btn-ghost btn-sm" onClick={onRefresh} disabled={loading}>Refresh</button>
    </span>
  )
}

export function SortHeader({ label, sortKey, sort, onSort, numeric }: {
  label: string
  sortKey: string
  sort: SortState | null
  onSort: (key: string, numeric: boolean) => void
  numeric?: boolean
}) {
  const state = ariaSortOf(sort, sortKey)
  return (
    <th scope="col" aria-sort={state} className={numeric ? 'pco-num' : undefined}>
      <button type="button" className="pco-sort" onClick={() => onSort(sortKey, !!numeric)}>
        {label}
        <span className="pco-sort-arrow" aria-hidden>{state === 'ascending' ? '▲' : state === 'descending' ? '▼' : ''}</span>
      </button>
    </th>
  )
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return <div className="pco-state" role="status">{label}</div>
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="pco-state pco-state-error" role="alert">
      <span>{message}</span>
      {onRetry && <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry}>Retry</button>}
    </div>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="pco-state pco-state-empty">{children}</div>
}

export type ToastTone = 'info' | 'warn'

export function useToast(): { toast: ReactNode; showToast: (message: string, tone?: ToastTone) => void } {
  const [shown, setShown] = useState<{ message: string; tone: ToastTone } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showToast = useCallback((next: string, tone: ToastTone = 'info') => {
    if (timer.current) clearTimeout(timer.current)
    setShown({ message: next, tone })
    timer.current = setTimeout(() => {
      timer.current = null
      setShown(null)
    }, tone === 'warn' ? 7000 : 3500)
  }, [])
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  return {
    showToast,
    toast: shown
      ? (
        <div
          className={`pco-toast${shown.tone === 'warn' ? ' pco-toast-warn' : ''}`}
          role={shown.tone === 'warn' ? 'alert' : 'status'}
        >
          {shown.message}
        </div>
      )
      : null,
  }
}
