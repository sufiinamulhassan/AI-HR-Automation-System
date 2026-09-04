import { useEffect, useState } from 'react'
import { candidatesApi } from '../../../lib/api'
import { useAuthStore } from '../../../store/auth.store'
import './CommunicationModal.css'

interface Props {
  candidateId: string
  candidateName?: string
  onClose: () => void
}

type Tab = 'send' | 'history'

interface EmailLogEntry {
  to: string
  subject: string
  template: string | null
  status: string
  created_at: string
}

const TEMPLATES: { value: string; label: string }[] = [
  { value: 'assessment_invitation', label: 'Assessment Invitation' },
  { value: 'offer_letter', label: 'Offer Letter' },
  { value: 'reminder', label: 'Reminder' },
  { value: 'follow_up', label: 'Follow-up' },
]

function templateLabel(t: string | null) {
  return TEMPLATES.find(x => x.value === t)?.label || t || '-'
}

function statusBadge(status: string) {
  return status === 'sent' ? 'badge-green' : status === 'failed' ? 'badge-red' : 'badge-gray'
}

export default function CommunicationModal({ candidateId, candidateName, onClose }: Props) {
  const user = useAuthStore(s => s.user) as Record<string, string> | null
  const role = user?.role || ''
  const canSend = role === 'admin' || role === 'superadmin'

  const [tab, setTab] = useState<Tab>('send')

  const [template, setTemplate] = useState('assessment_invitation')
  const [salary, setSalary] = useState('')
  const [joiningDate, setJoiningDate] = useState('')
  const [benefits, setBenefits] = useState('')
  const [sending, setSending] = useState(false)
  const [lastResult, setLastResult] = useState<{ sent: boolean; template: string } | null>(null)

  const [emails, setEmails] = useState<EmailLogEntry[]>([])
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [historyLoaded, setHistoryLoaded] = useState(false)

  const [toast, setToast] = useState('')

  useEffect(() => {
    if (tab === 'history' && !historyLoaded) loadHistory()
  }, [tab, historyLoaded])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 3500)
  }

  async function loadHistory() {
    setLoadingHistory(true)
    try {
      const r = await candidatesApi.listEmails(candidateId)
      const list: EmailLogEntry[] = r.data?.emails ?? []
      list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      setEmails(list)
    } catch {
      setEmails([])
    }
    setHistoryLoaded(true)
    setLoadingHistory(false)
  }

  async function handleSend() {
    setSending(true)
    setLastResult(null)
    try {
      const r = await candidatesApi.sendEmail(candidateId, {
        template,
        salary: template === 'offer_letter' ? (salary.trim() || undefined) : undefined,
        joining_date: template === 'offer_letter' ? (joiningDate || undefined) : undefined,
        benefits: template === 'offer_letter' ? (benefits.trim() || undefined) : undefined,
      })
      const sent = !!r.data?.sent
      setLastResult({ sent, template })
      showToast(sent ? `${templateLabel(template)} email sent` : 'Send failed - recorded in the log below')
      setHistoryLoaded(false)
      if (tab === 'history') loadHistory()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      showToast(err?.response?.data?.detail || 'Failed to send email')
    }
    setSending(false)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box cm-modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Communication Center{candidateName ? ` - ${candidateName}` : ''}</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="cm-body">
          {toast && <div className="cm-toast">{toast}</div>}

          <div className="cm-tabs">
            <button
              className={`cm-tab${tab === 'send' ? ' cm-tab-active' : ''}`}
              onClick={() => setTab('send')}
            >
              Send Email
            </button>
            <button
              className={`cm-tab${tab === 'history' ? ' cm-tab-active' : ''}`}
              onClick={() => setTab('history')}
            >
              Email History
            </button>
          </div>

          {tab === 'send' && (
            <div className="cm-section">
              {!canSend ? (
                <div className="cm-permission-notice">
                  Sending candidate emails requires an admin account. You can still view the Email History tab.
                </div>
              ) : (
                <>
                  <label className="cm-field">
                    <span className="form-label">Template</span>
                    <select
                      className="form-input"
                      value={template}
                      onChange={e => { setTemplate(e.target.value); setLastResult(null) }}
                    >
                      {TEMPLATES.map(t => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                  </label>

                  {template === 'offer_letter' && (
                    <div className="cm-offer-fields">
                      <label className="cm-field">
                        <span className="form-label">Salary</span>
                        <input
                          className="form-input"
                          value={salary}
                          onChange={e => setSalary(e.target.value)}
                          placeholder="e.g. £55,000 / year"
                        />
                      </label>
                      <label className="cm-field">
                        <span className="form-label">Joining Date</span>
                        <input
                          className="form-input"
                          type="date"
                          value={joiningDate}
                          onChange={e => setJoiningDate(e.target.value)}
                        />
                      </label>
                      <label className="cm-field">
                        <span className="form-label">Benefits</span>
                        <input
                          className="form-input"
                          value={benefits}
                          onChange={e => setBenefits(e.target.value)}
                          placeholder="e.g. Private healthcare, 25 days leave"
                        />
                      </label>
                    </div>
                  )}

                  <button className="btn btn-primary cm-send-btn" disabled={sending} onClick={handleSend}>
                    {sending ? 'Sending…' : `Send ${templateLabel(template)}`}
                  </button>

                  {lastResult && (
                    <div className={lastResult.sent ? 'cm-confirm' : 'cm-send-error'}>
                      {lastResult.sent
                        ? `${templateLabel(lastResult.template)} email delivered successfully.`
                        : `${templateLabel(lastResult.template)} email could not be delivered - see Email History for the failed log entry.`}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {tab === 'history' && (
            <div className="cm-section">
              <div className="cm-history-head">
                <span className="cm-history-count">
                  {emails.length} email{emails.length === 1 ? '' : 's'} logged
                </span>
                <button className="cm-refresh-btn" onClick={loadHistory} disabled={loadingHistory}>
                  {loadingHistory ? 'Refreshing…' : 'Refresh'}
                </button>
              </div>

              {loadingHistory ? (
                <div className="cm-loading">Loading email history…</div>
              ) : emails.length === 0 ? (
                <div className="cm-empty">No emails logged yet for this candidate.</div>
              ) : (
                <div className="cm-history-list">
                  {emails.map((e, i) => (
                    <div className="cm-history-row" key={i}>
                      <div className="cm-history-top">
                        <span className="cm-history-subject">{e.subject}</span>
                        <span className={`badge ${statusBadge(e.status)}`}>{e.status}</span>
                      </div>
                      <div className="cm-history-meta">
                        <span>To: {e.to}</span>
                        <span>{templateLabel(e.template)}</span>
                        <span>{e.created_at ? new Date(e.created_at).toLocaleString() : '-'}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
