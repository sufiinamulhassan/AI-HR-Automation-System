import { useId, useState } from 'react'
import { candidatesApi, type EraseResult } from '../../../lib/api'
import TypedConfirmDialog from '../../../components/TypedConfirmDialog'
import './EraseCandidateModal.css'

const MIN_REASON = 3
const MAX_REASON = 500

function detailOf(e: unknown): string {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  return typeof detail === 'string' && detail.trim() ? detail : ''
}

interface Props {
  candidateId: string
  name: string
  onClose: () => void
  onErased: (result: EraseResult) => void
}

export default function EraseCandidateModal({ candidateId, name, onClose, onErased }: Props) {
  const reasonId = useId()
  const [reason, setReason] = useState('')
  const [includeEmployment, setIncludeEmployment] = useState(false)
  const [employmentAsked, setEmploymentAsked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const trimmed = reason.trim()
  const reasonOk = trimmed.length >= MIN_REASON && trimmed.length <= MAX_REASON

  async function erase() {
    setBusy(true)
    setError('')
    try {
      const r = await candidatesApi.erase(candidateId, {
        reason: trimmed,
        ...(employmentAsked && includeEmployment ? { include_employment: true } : {}),
      })
      onErased(r.data)
      return
    } catch (e) {
      const status = (e as { response?: { status?: number } })?.response?.status
      if (status === 409 && !employmentAsked) setEmploymentAsked(true)
      setError(detailOf(e) || 'Could not erase this person. Try again.')
    }
    setBusy(false)
  }

  return (
    <TypedConfirmDialog
      title={`Erase personal data of ${name}?`}
      confirmWord="ERASE"
      confirmLabel="Erase personal data"
      busy={busy}
      error={error}
      ready={reasonOk}
      onConfirm={() => void erase()}
      onCancel={onClose}
    >
      <p className="ecm-warning">
        This removes the name, email, résumé, interview, notes and every other personal detail of this person from the
        company. It cannot be undone. Only a record that they once applied remains, with no personal data.
      </p>
      <div className="ecm-field">
        <label className="form-label" htmlFor={reasonId}>Reason</label>
        <textarea
          id={reasonId}
          className="form-input"
          rows={3}
          maxLength={MAX_REASON}
          value={reason}
          onChange={e => setReason(e.target.value)}
          disabled={busy}
        />
        <span className="ecm-help">{trimmed.length < MIN_REASON ? `At least ${MIN_REASON} characters. ` : ''}{trimmed.length} / {MAX_REASON}</span>
      </div>
      {employmentAsked && (
        <label className="ecm-check">
          <input type="checkbox" checked={includeEmployment} onChange={e => setIncludeEmployment(e.target.checked)} disabled={busy} />
          <span>Also erase their offer and employee records</span>
        </label>
      )}
    </TypedConfirmDialog>
  )
}
