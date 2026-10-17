import { useEffect, useState } from 'react'
import { authApi, offersApi } from '../../../lib/api'
import { useAuthStore } from '../../../store/auth.store'
import './OfferModal.css'

function errorDetail(e: unknown, fallback: string): string {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  if (typeof detail === 'string' && detail.trim()) return detail
  if (Array.isArray(detail) && detail.length) {
    return detail
      .map(d => (d && typeof d === 'object' && 'msg' in d) ? String((d as { msg: unknown }).msg) : String(d))
      .join('; ')
  }
  return fallback
}

interface OfferSignature {
  typed_name: string
  consented: boolean
  ip_address?: string
  user_agent?: string
  signed_at: string
  document_hash?: string
}

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
  signature?: OfferSignature
  ai_letter_body?: string
  ai_letter_source?: 'ai' | 'template_fallback'
  ai_letter_approved?: boolean
  ai_letter_approved_by?: string
  ai_letter_approved_at?: string
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

  const [permissions, setPermissions] = useState<string[]>([])
  useEffect(() => {
    if (!canManage) { setPermissions([]); return }
    authApi.myPermissions()
      .then(r => setPermissions(r.data?.permissions ?? []))
      .catch(() => setPermissions([]))
  }, [canManage])
  const canDraftLetter = canManage && permissions.includes('offers:draft_letter')
  const canApproveLetter = canManage && permissions.includes('offers:approve_letter')

  const [offers, setOffers] = useState<Offer[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [pdfBusy, setPdfBusy] = useState<Record<string, boolean>>({})
  const [letterBusy, setLetterBusy] = useState<Record<string, boolean>>({})
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
    } catch (e) {
      showToast(errorDetail(e, 'Failed to send offer'))
    }
    endBusy(offerId)
  }

  function startLetterBusy(id: string) { setLetterBusy(b => ({ ...b, [id]: true })) }
  function endLetterBusy(id: string)   { setLetterBusy(b => { const n = { ...b }; delete n[id]; return n }) }

  async function handleDraftLetter(offerId: string) {
    startLetterBusy(offerId)
    try {
      await offersApi.draftLetter(offerId)
      showToast('AI letter drafted: review and approve before sending')
      load()
    } catch (e) {
      showToast(errorDetail(e, 'Failed to draft AI letter'))
    }
    endLetterBusy(offerId)
  }

  async function handleApproveLetter(offerId: string) {
    startLetterBusy(offerId)
    try {
      await offersApi.approveLetter(offerId)
      showToast('AI letter approved')
      load()
    } catch (e) {
      showToast(errorDetail(e, 'Failed to approve AI letter'))
    }
    endLetterBusy(offerId)
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

  async function handleDownloadPdf(offerId: string) {
    setPdfBusy(b => ({ ...b, [offerId]: true }))
    try {
      const r = await offersApi.pdf(offerId)
      const url = URL.createObjectURL(r.data as Blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `offer_${offerId.slice(0, 8)}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      showToast('Failed to download offer PDF')
    } finally {
      setPdfBusy(b => { const n = { ...b }; delete n[offerId]; return n })
    }
  }

  function formatDateTime(iso?: string) {
    if (!iso) return '-'
    const parsed = new Date(iso)
    if (isNaN(parsed.getTime())) return iso
    return parsed.toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })
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
    } catch (e) {
      showToast(errorDetail(e, 'Failed to create offer'))
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
                const isPdfBusy = !!pdfBusy[o.offer_id]
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
                      {o.signature && (
                        <div className="offer-signature">
                          <div className="offer-signature-row">
                            <span className="offer-signature-label">Signed by</span>
                            <span className="offer-signature-value">{o.signature.typed_name}</span>
                          </div>
                          <div className="offer-signature-row">
                            <span className="offer-signature-label">Signed at</span>
                            <span className="offer-signature-value">{formatDateTime(o.signature.signed_at)}</span>
                          </div>
                          {(o.signature.ip_address || o.signature.user_agent || o.signature.document_hash) && (
                            <details className="offer-signature-details">
                              <summary>Signature details</summary>
                              {o.signature.ip_address && (
                                <div className="offer-signature-row">
                                  <span className="offer-signature-label">IP address</span>
                                  <span className="offer-signature-value">{o.signature.ip_address}</span>
                                </div>
                              )}
                              {o.signature.user_agent && (
                                <div className="offer-signature-row">
                                  <span className="offer-signature-label">User agent</span>
                                  <span className="offer-signature-value offer-signature-ua">{o.signature.user_agent}</span>
                                </div>
                              )}
                              {o.signature.document_hash && (
                                <div className="offer-signature-row">
                                  <span className="offer-signature-label">Document hash</span>
                                  <span className="offer-signature-value offer-signature-ua">{o.signature.document_hash}</span>
                                </div>
                              )}
                            </details>
                          )}
                        </div>
                      )}

                      {(canDraftLetter || o.ai_letter_body) && (
                        <div className="offer-ai-letter">
                          <div className="offer-ai-letter-header">
                            <span className="offer-ai-letter-title">AI-Drafted Letter</span>
                            {o.ai_letter_body && (
                              <span className={`badge ${o.ai_letter_approved ? 'badge-green' : 'badge-yellow'}`}>
                                {o.ai_letter_approved ? 'Approved' : 'Needs approval'}
                              </span>
                            )}
                          </div>

                          {o.ai_letter_body ? (
                            <div className="offer-ai-letter-body">{o.ai_letter_body}</div>
                          ) : (
                            <p className="offer-ai-letter-empty">No AI-drafted letter content yet.</p>
                          )}

                          <div className="offer-ai-letter-actions">
                            {canDraftLetter && !terminal && (
                              <button
                                className="btn btn-ghost btn-sm"
                                disabled={!!letterBusy[o.offer_id]}
                                onClick={() => handleDraftLetter(o.offer_id)}
                              >
                                {letterBusy[o.offer_id] ? '…' : o.ai_letter_body ? 'Re-draft Letter' : 'Draft AI Letter'}
                              </button>
                            )}
                            {canApproveLetter && o.ai_letter_body && (
                              <button
                                className="btn btn-primary btn-sm"
                                disabled={!!letterBusy[o.offer_id] || o.ai_letter_approved === true}
                                onClick={() => handleApproveLetter(o.offer_id)}
                              >
                                {letterBusy[o.offer_id] ? '…' : o.ai_letter_approved ? 'Approved' : 'Approve Letter'}
                              </button>
                            )}
                          </div>
                          {o.ai_letter_body && !o.ai_letter_approved && (
                            <p className="offer-ai-letter-hint">
                              Generated text: if it's wrong, re-draft it rather than editing it by hand.
                              Sending is blocked until it's approved.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="offer-row-actions">
                      {canManage && (
                        <button
                          className="btn btn-ghost btn-sm"
                          disabled={isPdfBusy}
                          onClick={() => handleDownloadPdf(o.offer_id)}
                        >
                          {isPdfBusy ? '…' : '⬇ PDF'}
                        </button>
                      )}
                      {!terminal && (
                        <>
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
                        </>
                      )}
                    </div>
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
