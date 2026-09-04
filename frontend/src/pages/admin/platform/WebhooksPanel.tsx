import { useEffect, useState } from 'react'
import { webhooksApi } from '../../../lib/api'
import '../WebhooksPage.css'

type WebhookFormat = 'raw' | 'slack' | 'teams'

interface Webhook {
  webhook_id: string
  url: string
  event_types: string[]
  is_active: boolean
  format?: WebhookFormat
}

interface WebhookForm {
  url: string
  event_types: string
  is_active: boolean
  format: WebhookFormat
}

function emptyForm(): WebhookForm {
  return { url: '', event_types: '', is_active: true, format: 'raw' }
}

export default function WebhooksPanel({ showToast }: { showToast: (msg: string) => void }) {
  const [webhooks, setWebhooks] = useState<Webhook[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, string>>({})

  const [modal, setModal] = useState<'create' | 'edit' | null>(null)
  const [selected, setSelected] = useState<Webhook | null>(null)
  const [form, setForm] = useState<WebhookForm>(emptyForm())

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const r = await webhooksApi.list()
      setWebhooks(r.data.webhooks || r.data.results || [])
    } catch {}
    setLoading(false)
  }

  function openCreate() {
    setForm(emptyForm())
    setSelected(null)
    setModal('create')
  }

  function openEdit(w: Webhook) {
    setSelected(w)
    setForm({
      url: w.url,
      event_types: w.event_types.join(', '),
      is_active: w.is_active,
      format: w.format ?? 'raw',
    })
    setModal('edit')
  }

  async function save() {
    setSaving(true)
    try {
      const payload = {
        url: form.url.trim(),
        event_types: form.event_types.split(',').map(s => s.trim()).filter(Boolean),
        format: form.format,
        ...(modal === 'edit' ? { is_active: form.is_active } : {}),
      }
      if (modal === 'create') {
        await webhooksApi.create(payload)
        showToast('Webhook created')
      } else if (selected) {
        await webhooksApi.update(selected.webhook_id, payload)
        showToast('Webhook updated')
      }
      setModal(null); load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      showToast(err?.response?.data?.detail || 'Failed to save webhook')
    }
    setSaving(false)
  }

  async function deleteWebhook(w: Webhook) {
    if (!confirm(`Delete webhook for "${w.url}"?`)) return
    try {
      await webhooksApi.delete(w.webhook_id)
      showToast('Webhook deleted')
      load()
    } catch { showToast('Failed to delete webhook') }
  }

  async function testWebhook(w: Webhook) {
    setTestingId(w.webhook_id)
    try {
      const r = await webhooksApi.test(w.webhook_id)
      setTestResults(prev => ({ ...prev, [w.webhook_id]: r.data.success ? 'Success' : 'Failed' }))
    } catch {
      setTestResults(prev => ({ ...prev, [w.webhook_id]: 'Failed' }))
    }
    setTestingId(null)
    setTimeout(() => setTestResults(prev => {
      const next = { ...prev }
      delete next[w.webhook_id]
      return next
    }), 5000)
  }

  return (
    <>
      <div className="ps-intro">
        Notify external systems when pipeline events occur.
      </div>

      <section className="wh-section ps-section card">
        <div className="card-header">
          <span className="card-title">Subscriptions</span>
          <button className="btn btn-primary" onClick={openCreate}>+ Add Webhook</button>
        </div>
        {loading ? (
          <div className="wh-loading">Loading…</div>
        ) : (
          <div className="wh-table-wrap">
          <table className="wh-table">
            <thead>
              <tr>
                <th>URL</th>
                <th>Event Types</th>
                <th>Format</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {webhooks.length === 0 ? (
                <tr><td colSpan={5} className="wh-empty">No webhooks configured yet.</td></tr>
              ) : webhooks.map(w => (
                <tr key={w.webhook_id}>
                  <td className="wh-url" data-label="URL">{w.url}</td>
                  <td data-label="Event Types">
                    <div className="wh-tags">
                      {(w.event_types ?? []).map(e => <span key={e} className="wh-tag">{e}</span>)}
                    </div>
                  </td>
                  <td data-label="Format">
                    <span className="wh-tag">{(w.format ?? 'raw').toUpperCase()}</span>
                  </td>
                  <td data-label="Status">
                    <span className={`badge ${w.is_active ? 'badge-green' : 'badge-gray'}`}>
                      {w.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td data-label="Actions">
                    <div className="wh-actions">
                      {testResults[w.webhook_id] && (
                        <span className={`badge ${testResults[w.webhook_id] === 'Success' ? 'badge-green' : 'badge-red'}`}>
                          {testResults[w.webhook_id]}
                        </span>
                      )}
                      <button className="wh-action-btn" onClick={() => testWebhook(w)}
                        disabled={testingId === w.webhook_id}>
                        {testingId === w.webhook_id ? 'Testing…' : 'Test'}
                      </button>
                      <button className="wh-action-btn" onClick={() => openEdit(w)}>Edit</button>
                      <button className="wh-action-btn wh-action-delete" onClick={() => deleteWebhook(w)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </section>

      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{modal === 'create' ? 'Add Webhook' : `Edit - ${selected?.url}`}</h2>
              <button className="modal-close" onClick={() => setModal(null)}>✕</button>
            </div>
            <div className="wh-form">
              <label className="wh-field">
                <span className="form-label">URL *</span>
                <input className="form-input" value={form.url}
                  onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
                  placeholder="https://example.com/webhook" />
              </label>
              <label className="wh-field">
                <span className="form-label">Event Types *</span>
                <input className="form-input" value={form.event_types}
                  onChange={e => setForm(f => ({ ...f, event_types: e.target.value }))}
                  placeholder="candidate_invited, interview_completed" />
                <div className="wh-hint">Comma-separated event type names</div>
              </label>
              <label className="wh-field">
                <span className="form-label">Format</span>
                <select className="form-input" value={form.format}
                  onChange={e => setForm(f => ({ ...f, format: e.target.value as WebhookFormat }))}>
                  <option value="raw">Raw (default JSON payload)</option>
                  <option value="slack">Slack (incoming webhook)</option>
                  <option value="teams">Teams (channel connector)</option>
                </select>
                <div className="wh-hint">
                  Slack/Teams wrap the event as a short human-readable summary line instead of the raw payload.
                </div>
              </label>
              {modal === 'edit' && (
                <label className="wh-checkbox">
                  <input type="checkbox" checked={form.is_active}
                    onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />
                  <span>Active</span>
                </label>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={save}
                disabled={saving || !form.url.trim() || !form.event_types.trim()}>
                {saving ? 'Saving…' : modal === 'create' ? 'Create' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
