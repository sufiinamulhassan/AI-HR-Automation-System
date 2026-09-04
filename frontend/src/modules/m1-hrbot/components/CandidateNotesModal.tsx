import { useEffect, useState } from 'react'
import { candidatesApi } from '../../../lib/api'
import './CandidateNotesModal.css'

interface Props {
  candidateId: string
  candidateName?: string
  onClose: () => void
}

export default function CandidateNotesModal({ candidateId, candidateName, onClose }: Props) {
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const [updatedAt, setUpdatedAt] = useState<string | undefined>()

  useEffect(() => { load() }, [candidateId])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  async function load() {
    setLoading(true)
    try {
      const r = await candidatesApi.get(candidateId)
      setNotes((r.data?.recruiter_notes as string) || '')
      setUpdatedAt(r.data?.recruiter_notes_updated_at as string | undefined)
    } catch {
      setNotes('')
    }
    setLoading(false)
  }

  async function handleSave() {
    setSaving(true)
    try {
      const r = await candidatesApi.updateNotes(candidateId, notes)
      setUpdatedAt(r.data?.updated_at)
      showToast('Notes saved')
    } catch {
      showToast('Failed to save notes')
    }
    setSaving(false)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box notes-modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Recruiter Notes{candidateName ? ` - ${candidateName}` : ''}</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="notes-modal-body">
          {toast && <div className="notes-modal-toast">{toast}</div>}

          {loading ? (
            <div className="notes-modal-loading">Loading notes…</div>
          ) : (
            <>
              <textarea
                className="notes-textarea"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Private notes about this candidate - visible only to recruiters/admins, never shared with the candidate. Freely editable at any pipeline stage."
                rows={8}
              />
              {updatedAt && (
                <div className="notes-modal-meta">
                  Last updated {new Date(updatedAt).toLocaleString()}
                </div>
              )}
            </>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
          <button className="btn btn-primary" disabled={loading || saving} onClick={handleSave}>
            {saving ? 'Saving…' : 'Save Notes'}
          </button>
        </div>
      </div>
    </div>
  )
}
