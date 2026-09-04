import { useEffect, useState } from 'react'
import { offersApi } from '../../../lib/api'
import { useAuthStore } from '../../../store/auth.store'
import './OfferModal.css'

interface Offer {
  offer_id: string
  candidate_id: string
  job_id: string
  salary: string
  benefits?: string
  joining_date?: string
  status: 'draft' | 'pending_approval' | 'approved' | 'sent' | 'accepted' | 'declined' | 'withdrawn'
  created_by?: string
  approved_by?: string
  sent_at?: string
  responded_at?: string
  decline_reason?: string
  created_at?: string
  updated_at?: string
}

interface Props {
  candidateId: string
  onClose: () => void
}

const EMPTY_FORM = { salary: '', benefits: '', joining_date: '' }

function badgeClass(status: string) {
  switch (status) {
    case 'sent': return 'badge-blue'
    case 'accepted': return 'badge-green'
    case 'declined':
    case 'withdrawn': return 'badge-red'
    case 'draft':
    case 'pending_approval':
    case 'approved': return 'badge-yellow'
    default: return 'badge-gray'
  }
}

function statusLabel(status: string) {
  return status.replace(/_/g, ' ')
}

const TERMINAL = new Set(['accepted', 'declined', 'withdrawn'])

export default function OfferModal({ candidateId, onClose }: Props) {
  const user = useAuthStore(s => s.user) as Record<string, string> | null
  const role = user?.role || ''
  const canApprove = role === 'admin' || role === 'superadmin'
  const canManage = canApprove

  const [offers, setOffers] = useState<Offer[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [creating, setCreating] = useState(false)
  const [toast, setToast] = useState('')

  useEffect(() => { load() }, [candidateId])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  async function load() {
    setLoading(true)
    try {
      const r = await offersApi.list({ candidate_id: candidateId })
      setOffers(r.data.offers || [])
    } catch {
      setOffers([])
    }
    setLoading(false)
  }

  function startBusy(id: string) { setBusy(b => ({ ...b, [id]: true })) }
  function endBusy(id: string)   { setBusy(b => { const n = { ...b }; delete n[id]; return n }) }

  async function handleApprove(offerId: string) {
    startBusy(offerId)
    try {
      await offersApi.approve(offerId)
      showToast('Offer approved')
      load()
    } catch {
      showToast('Failed to approve offer')
    }
    endBusy(offerId)
  }

  async function handleSend(offerId: string) {
    startBusy(offerId)
    try {
      await offersApi.send(offerId)
      showToast('Offer sent to candidate')
      load()
    } catch {
      showToast('Failed to send offer')
    }
    endBusy(offerId)
  }

  async function handleWithdraw(offerId: string) {
    if (!confirm('Withdraw this offer? The candidate will no longer be able to respond.')) return
    startBusy(offerId)
    try {
      await offersApi.withdraw(offerId)
      showToast('Offer withdrawn')
      load()
    } catch {
      showToast('Failed to withdraw offer')
    }
    endBusy(offerId)
  }

  async function handleCreate() {
    if (!form.salary.trim()) return
    setCreating(true)
    try {
      await offersApi.create({
        candidate_id: candidateId,
        salary: form.salary.trim(),
        benefits: form.benefits.trim() || undefined,
        joining_date: form.joining_date || undefined,
      })
      showToast('Offer created')
      setForm({ ...EMPTY_FORM })
      load()
    } catch {
      showToast('Failed to create offer')
    }
    setCreating(false)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box offer-modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Offers</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="offer-modal-body">
          {toast && <div className="offer-modal-toast">{toast}</div>}

          {loading ? (
            <div className="offer-modal-loading">Loading offers…</div>
          ) : offers.length === 0 ? (
            <div className="offer-modal-empty">No offers yet for this candidate.</div>
          ) : (
            <div className="offer-modal-list">
              {offers.map(o => {
                const isBusy = !!busy[o.offer_id]
                const terminal = TERMINAL.has(o.status)
                return (
                  <div className="offer-row" key={o.offer_id}>
                    <div className="offer-row-main">
                      <div className="offer-row-top">
                        <span className={`badge ${badgeClass(o.status)}`}>{statusLabel(o.status)}</span>
                        <span className="offer-row-salary">{o.salary}</span>
                      </div>
                      <div className="offer-row-meta">
                        {o.benefits && <span>{o.benefits}</span>}
                        {o.joining_date && <span>Joins {o.joining_date}</span>}
                      </div>
                    </div>
                    {!terminal && (
                      <div className="offer-row-actions">
                        {(o.status === 'draft' || o.status === 'pending_approval') && canApprove && (
                          <button
                            className="btn btn-primary btn-sm"
                            disabled={isBusy}
                            onClick={() => handleApprove(o.offer_id)}
                          >
                            {isBusy ? '…' : 'Approve'}
                          </button>
                        )}
                        {o.status === 'approved' && canManage && (
                          <button
                            className="btn btn-primary btn-sm"
                            disabled={isBusy}
                            onClick={() => handleSend(o.offer_id)}
                          >
                            {isBusy ? '…' : 'Send'}
                          </button>
                        )}
                        {canManage && (
                          <button
                            className="btn btn-ghost btn-sm offer-withdraw-btn"
                            disabled={isBusy}
                            onClick={() => handleWithdraw(o.offer_id)}
                          >
                            Withdraw
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {canManage && (
            <div className="offer-create-form">
              <div className="offer-create-title">+ Create New Offer</div>
              <label className="offer-field">
                <span className="form-label">Salary *</span>
                <input
                  className="form-input"
                  value={form.salary}
                  onChange={e => setForm(f => ({ ...f, salary: e.target.value }))}
                  placeholder="e.g. £55,000 / year"
                />
              </label>
              <label className="offer-field">
                <span className="form-label">Benefits</span>
                <input
                  className="form-input"
                  value={form.benefits}
                  onChange={e => setForm(f => ({ ...f, benefits: e.target.value }))}
                  placeholder="e.g. Private healthcare, 25 days leave"
                />
              </label>
              <label className="offer-field">
                <span className="form-label">Joining Date</span>
                <input
                  className="form-input"
                  type="date"
                  value={form.joining_date}
                  onChange={e => setForm(f => ({ ...f, joining_date: e.target.value }))}
                />
              </label>
              <button
                className="btn btn-primary offer-create-btn"
                disabled={creating || !form.salary.trim()}
                onClick={handleCreate}
              >
                {creating ? 'Creating…' : 'Create Offer'}
              </button>
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
