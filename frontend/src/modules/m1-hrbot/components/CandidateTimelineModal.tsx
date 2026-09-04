import { useEffect, useState } from 'react'
import { candidatesApi } from '../../../lib/api'
import { useAuthStore } from '../../../store/auth.store'
import './CandidateTimelineModal.css'

interface TimelineEntry {
  candidate_id?: string
  job_id?: string
  job_title?: string
  status?: string
  decision?: string
  invite_type?: string
  created_at?: string
  decided_at?: string
}

interface CandidateProfile {
  profile_id?: string
  profile_notes?: string | null
  updated_at?: string
}

interface Props {
  candidateId: string
  candidateName?: string
  onClose: () => void
}

function badgeClass(status?: string) {
  switch (status) {
    case 'hired': return 'badge-green'
    case 'rejected': return 'badge-red'
    case 'invited':
    case 'interviewing': return 'badge-blue'
    case 'completed': return 'badge-yellow'
    default: return 'badge-gray'
  }
}

export default function CandidateTimelineModal({ candidateId, candidateName, onClose }: Props) {
  const user = useAuthStore(s => s.user) as Record<string, string> | null
  const role = user?.role || ''
  const canEditProfileNotes = role === 'admin' || role === 'superadmin'

  const [timeline, setTimeline] = useState<TimelineEntry[]>([])
  const [loading, setLoading] = useState(true)

  const [profile, setProfile] = useState<CandidateProfile | null>(null)
  const [profileLoading, setProfileLoading] = useState(true)
  const [notes, setNotes] = useState('')
  const [notesSaving, setNotesSaving] = useState(false)
  const [toast, setToast] = useState('')

  useEffect(() => { load() }, [candidateId])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  async function load() {
    setLoading(true)
    setProfileLoading(true)
    try {
      const r = await candidatesApi.getTimeline(candidateId)
      setTimeline(r.data?.timeline || [])
    } catch {
      setTimeline([])
    }
    setLoading(false)

    try {
      const candRes = await candidatesApi.get(candidateId)
      const email = candRes.data?.email as string | undefined
      if (email) {
        const profRes = await candidatesApi.getProfileByEmail(email)
        setProfile(profRes.data || null)
        setNotes(profRes.data?.profile_notes || '')
      } else {
        setProfile(null)
      }
    } catch {
      setProfile(null)
    }
    setProfileLoading(false)
  }

  async function handleSaveNotes() {
    if (!profile?.profile_id) return
    setNotesSaving(true)
    try {
      const r = await candidatesApi.updateProfileNotes(profile.profile_id, notes)
      setProfile(p => p ? { ...p, profile_notes: r.data?.profile_notes ?? notes, updated_at: r.data?.updated_at } : p)
      showToast('Cross-job notes saved')
    } catch {
      showToast('Failed to save notes')
    }
    setNotesSaving(false)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box timeline-modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Cross-Job History{candidateName ? ` - ${candidateName}` : ''}</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="timeline-modal-body">
          {toast && <div className="timeline-modal-toast">{toast}</div>}

          {!profileLoading && profile && (
            <div className="profile-notes-section">
              <div className="profile-notes-label">
                Notes about this person (across every job - distinct from any single job's notes)
              </div>
              <textarea
                className="profile-notes-textarea"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Cross-job notes about this person - shared across every job they've applied to, separate from per-job recruiter notes."
                rows={4}
                disabled={!canEditProfileNotes || notesSaving}
              />
              {canEditProfileNotes ? (
                <div className="profile-notes-actions">
                  {profile.updated_at && (
                    <span className="profile-notes-meta">
                      Last updated {new Date(profile.updated_at).toLocaleString()}
                    </span>
                  )}
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={notesSaving}
                    onClick={handleSaveNotes}
                  >
                    {notesSaving ? 'Saving…' : 'Save Notes'}
                  </button>
                </div>
              ) : (
                <div className="profile-notes-meta">Admin-only to edit</div>
              )}
            </div>
          )}

          <div className="timeline-divider" />

          {loading ? (
            <div className="timeline-modal-loading">Loading history…</div>
          ) : timeline.length === 0 ? (
            <div className="timeline-modal-empty">
              No other applications found for this person (matched by email, phone, or LinkedIn).
            </div>
          ) : (
            <ul className="timeline-list">
              {timeline.map((t, i) => (
                <li className="timeline-item" key={`${t.job_id}-${i}`}>
                  <div className="timeline-item-dot" />
                  <div className="timeline-item-content">
                    <div className="timeline-item-top">
                      <span className="timeline-item-title">{t.job_title || t.job_id || 'Unknown role'}</span>
                      <span className={`badge ${badgeClass(t.status)}`}>{t.status || 'unknown'}</span>
                    </div>
                    <div className="timeline-item-meta">
                      {t.invite_type && <span>{t.invite_type} invite</span>}
                      {t.decision && <span>Decision: {t.decision}</span>}
                      {t.created_at && <span>Applied {new Date(t.created_at).toLocaleDateString()}</span>}
                      {t.decided_at && <span>Decided {new Date(t.decided_at).toLocaleDateString()}</span>}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
