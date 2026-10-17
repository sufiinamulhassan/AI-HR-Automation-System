import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { useDialog } from '../modules/m1-hrbot/components/useDialog'
import './TypedConfirmDialog.css'

interface Props {
  title: string
  confirmWord: string
  confirmLabel: string
  busy?: boolean
  error?: string
  ready?: boolean
  onConfirm: () => void
  onCancel: () => void
  children?: ReactNode
}

export default function TypedConfirmDialog({
  title, confirmWord, confirmLabel, busy, error, ready = true, onConfirm, onCancel, children,
}: Props) {
  const titleId = useId()
  const inputId = useId()
  const [typed, setTyped] = useState('')
  const requestClose = () => { if (!busy) onCancel() }
  const { boxRef, trapTab, onBackdropMouseDown, onBackdropClick } = useDialog(requestClose)
  const armed = typed === confirmWord && ready && !busy

  function submit(e: FormEvent) {
    e.preventDefault()
    if (armed) onConfirm()
  }

  return (
    <div className="modal-overlay" data-testid="typed-confirm-backdrop" onMouseDown={onBackdropMouseDown} onClick={onBackdropClick}>
      <div
        ref={boxRef}
        className="modal-box tcd-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={trapTab}
      >
        <div className="modal-header">
          <h2 id={titleId}>{title}</h2>
        </div>
        <form className="tcd-body" onSubmit={submit} noValidate>
          {children}
          <div className="tcd-field">
            <label className="form-label" htmlFor={inputId}>{`Type ${confirmWord} to confirm`}</label>
            <input
              id={inputId}
              className="form-input tcd-typed"
              value={typed}
              onChange={e => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
            />
          </div>
          {error && <div className="tcd-error" role="alert">{error}</div>}
          <div className="tcd-footer">
            <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} disabled={busy}>Cancel</button>
            <button type="submit" className="btn btn-sm tcd-danger" disabled={!armed}>
              {busy ? 'Working…' : confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
