import { useId, useState } from 'react'
import type { RejectionReason } from '../../../lib/api'
import { useDialog } from './useDialog'
import './RejectReasonModal.css'

export const REJECTION_REASONS: { value: RejectionReason; label: string }[] = [
  { value: 'not_a_fit', label: 'Not a fit' },
  { value: 'salary', label: 'Salary' },
  { value: 'withdrew', label: 'Withdrew' },
  { value: 'no_show', label: 'No show' },
  { value: 'position_filled', label: 'Position filled' },
  { value: 'other', label: 'Other' },
]

interface Props {
  name: string
  askReason: boolean
  onConfirm: (reason: RejectionReason | undefined) => void
  onCancel: () => void
}

export default function RejectReasonModal({ name, askReason, onConfirm, onCancel }: Props) {
  const titleId = useId()
  const selectId = useId()
  const [reason, setReason] = useState<RejectionReason | ''>('')
  const { boxRef, trapTab, onBackdropMouseDown, onBackdropClick } = useDialog(onCancel)

  function submit() {
    if (askReason && reason === '') return
    onConfirm(askReason && reason !== '' ? reason : undefined)
  }

  return (
    <div className="modal-overlay" data-testid="reject-backdrop" onMouseDown={onBackdropMouseDown} onClick={onBackdropClick}>
      <div
        ref={boxRef}
        className="modal-box rrm-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={trapTab}
      >
        <div className="modal-header">
          <h2 id={titleId}>Reject {name}?</h2>
        </div>

        <div className="rrm-body">
          {askReason && (
            <div className="rrm-field">
              <label className="form-label" htmlFor={selectId}>Reason</label>
              <select
                id={selectId}
                className="form-input"
                value={reason}
                aria-required="true"
                onChange={e => setReason(e.target.value as RejectionReason | '')}
              >
                <option value="">Select a reason</option>
                {REJECTION_REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
          )}
          <p className="rrm-help">A candidate who was already invited may be sent a status email.</p>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn btn-danger" disabled={askReason && reason === ''} onClick={submit}>Reject</button>
        </div>
      </div>
    </div>
  )
}
