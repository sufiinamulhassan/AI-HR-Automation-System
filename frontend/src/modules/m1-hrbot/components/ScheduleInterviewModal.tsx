import { useEffect, useState } from 'react'
import { candidatesApi, integrationsApi, interviewApi } from '../../../lib/api'
import { useAuthStore } from '../../../store/auth.store'
import './ScheduleInterviewModal.css'

interface Props {
  candidateId: string
  candidateName?: string
  onClose: () => void
}


function toIsoFromLocalInput(value: string): string {
  return value.length === 16 ? `${value}:00` : value
}

function toLocalInputFromIso(iso?: string | null): string {
  if (!iso) return ''
  const match = iso.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/)
  return match ? match[1] : ''
}

function formatUtcDisplay(iso?: string | null): string {
  if (!iso) return ''
  const match = iso.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/)
  return match ? `${match[1]} ${match[2]} UTC` : iso
}

export default function ScheduleInterviewModal({ candidateId, candidateName, onClose }: Props) {
  const token = useAuthStore(s => s.token)

  const [loading, setLoading] = useState(true)
  const [scheduledStartAt, setScheduledStartAt] = useState<string | null>(null)
  const [inputValue, setInputValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [icsLoading, setIcsLoading] = useState(false)
  const [toast, setToast] = useState('')

  const [meetingProviders, setMeetingProviders] = useState<string[]>([])
  const [createMeeting, setCreateMeeting] = useState(false)
  const [meetingProvider, setMeetingProvider] = useState<string>('')
  const [joinUrl, setJoinUrl] = useState<string | null>(null)
  const [meetingError, setMeetingError] = useState('')

  useEffect(() => { load() }, [candidateId])

  useEffect(() => {
    integrationsApi.status()
      .then(r => setMeetingProviders(r.data?.meetings?.configured_providers ?? []))
      .catch(() => setMeetingProviders([]))
  }, [])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  async function load() {
    setLoading(true)
    try {
      const r = await candidatesApi.get(candidateId)
      const existing = (r.data?.scheduled_start_at as string | null) ?? null
      setScheduledStartAt(existing)
      setInputValue(toLocalInputFromIso(existing))
      setJoinUrl((r.data?.meeting_join_url as string | null) ?? null)
    } catch {
      setScheduledStartAt(null)
    }
    setLoading(false)
  }

  async function handleSave() {
    if (!inputValue) return
    setSaving(true)
    setMeetingError('')
    try {
      const iso = toIsoFromLocalInput(inputValue)
      const r = await interviewApi.schedule(candidateId, iso, {
        create_meeting: createMeeting,
        meeting_provider: meetingProvider || null,
      })
      setScheduledStartAt((r.data?.scheduled_start_at as string | undefined) ?? iso)
      const err = r.data?.meeting_error as string | undefined
      const meeting = r.data?.meeting as { join_url?: string } | null | undefined
      if (meeting?.join_url) setJoinUrl(meeting.join_url)
      if (err) {
        setMeetingError(err)
        showToast('Schedule saved - the meeting could not be created')
      } else {
        showToast(meeting ? 'Schedule saved and meeting created' : 'Interview schedule saved')
      }
    } catch {
      showToast('Failed to save schedule')
    }
    setSaving(false)
  }

  async function handleClear() {
    if (!confirm('Clear the scheduled interview time? The candidate will be able to start their interview immediately.')) return
    setClearing(true)
    try {
      await interviewApi.schedule(candidateId, null)
      setScheduledStartAt(null)
      setInputValue('')
      setJoinUrl(null)
      setMeetingError('')
      showToast('Schedule cleared')
    } catch {
      showToast('Failed to clear schedule')
    }
    setClearing(false)
  }

  async function handleDownloadIcs() {
    setIcsLoading(true)
    try {
      const url = interviewApi.scheduleIcsUrl(candidateId)
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = `interview_${candidateId.slice(0, 8)}.ics`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(blobUrl)
    } catch {
      showToast('Failed to download calendar invite')
    }
    setIcsLoading(false)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box sim-modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Schedule Interview{candidateName ? ` - ${candidateName}` : ''}</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="sim-body">
          {toast && <div className="sim-toast">{toast}</div>}

          {loading ? (
            <div className="sim-loading">Loading schedule…</div>
          ) : (
            <>
              <label className="sim-field">
                <span className="form-label">Scheduled Start (UTC)</span>
                <input
                  className="form-input"
                  type="datetime-local"
                  value={inputValue}
                  onChange={e => setInputValue(e.target.value)}
                />
              </label>
              <p className="sim-hint">
                The candidate cannot begin their interview session before this time.
                Leave blank / clear to allow starting immediately. All times are UTC.
              </p>

              {scheduledStartAt && (
                <div className="sim-current">
                  Currently scheduled for <strong>{formatUtcDisplay(scheduledStartAt)}</strong>
                </div>
              )}

              {meetingProviders.length > 0 && (
                <div className="sim-meeting">
                  <label className="sim-checkbox">
                    <input
                      type="checkbox"
                      checked={createMeeting}
                      onChange={e => setCreateMeeting(e.target.checked)}
                    />
                    <span>Create a video meeting for this slot</span>
                  </label>
                  {createMeeting && meetingProviders.length > 1 && (
                    <select
                      className="form-input sim-provider"
                      value={meetingProvider}
                      onChange={e => setMeetingProvider(e.target.value)}
                    >
                      <option value="">Default provider</option>
                      {meetingProviders.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  )}
                  {meetingError && <div className="sim-meeting-error">{meetingError}</div>}
                  {joinUrl && (
                    <div className="sim-join">
                      <span className="form-label">Join link</span>
                      <a href={joinUrl} target="_blank" rel="noreferrer">{joinUrl}</a>
                    </div>
                  )}
                </div>
              )}

              <div className="sim-actions">
                <button
                  className="btn btn-primary"
                  disabled={!inputValue || saving}
                  onClick={handleSave}
                >
                  {saving ? 'Saving…' : scheduledStartAt ? 'Update Schedule' : 'Save Schedule'}
                </button>
                {scheduledStartAt && (
                  <button
                    className="btn btn-ghost"
                    disabled={clearing}
                    onClick={handleClear}
                  >
                    {clearing ? 'Clearing…' : 'Clear Schedule'}
                  </button>
                )}
              </div>

              {scheduledStartAt && (
                <div className="sim-ics-section">
                  <button
                    className="btn btn-ghost sim-ics-btn"
                    disabled={icsLoading}
                    onClick={handleDownloadIcs}
                  >
                    {icsLoading ? 'Preparing…' : '⬇ Download Calendar Invite (.ics)'}
                  </button>
                  <p className="sim-hint">
                    Imports directly into Google Calendar, Outlook, or Apple Calendar -
                    no account connection required.
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
