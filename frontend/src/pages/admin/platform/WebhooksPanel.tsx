import { useEffect, useRef, useState } from 'react'
import { webhooksApi } from '../../../lib/api'
import { relativeTime } from '../../../lib/relativeTime'
import '../WebhooksPage.css'

type WebhookFormat = 'raw' | 'slack' | 'teams'

interface Webhook {
  webhook_id: string
  url: string
  event_types: string[]
  is_active: boolean
  format?: WebhookFormat
  has_secret?: boolean
}

interface EventType {
  key: string
  label: string
}

interface Delivery {
  delivery_id: string
  event: string
  status: 'sent' | 'failed'
  http_status: number | null
  duration_ms: number
  error: string | null
  created_at: string
}

interface TestResult {
  delivered: boolean
  http_status: number | null
  detail: string
}

interface WebhookForm {
  url: string
  event_types: string[]
  is_active: boolean
  format: WebhookFormat
  secret: string
}

const DELIVERIES_LIMIT = 50

function emptyForm(): WebhookForm {
  return { url: '', event_types: [], is_active: true, format: 'raw', secret: '' }
}

function errorDetail(e: unknown, fallback: string): string {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  return typeof detail === 'string' && detail.trim() ? detail : fallback
}

function inlineSaveError(e: unknown): string {
  const status = (e as { response?: { status?: number } })?.response?.status
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  return status === 422 && typeof detail === 'string' && detail.trim() ? detail : ''
}

export default function WebhooksPanel({ showToast }: { showToast: (msg: string) => void }) {
  const [webhooks, setWebhooks] = useState<Webhook[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({})

  const [modal, setModal] = useState<'create' | 'edit' | null>(null)
  const [selected, setSelected] = useState<Webhook | null>(null)
  const [form, setForm] = useState<WebhookForm>(emptyForm())
  const [formError, setFormError] = useState('')

  const [eventTypes, setEventTypes] = useState<EventType[] | null>(null)
  const [eventTypesError, setEventTypesError] = useState('')

  const [drawerFor, setDrawerFor] = useState<Webhook | null>(null)
  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  const [deliveriesLoading, setDeliveriesLoading] = useState(false)
  const [deliveriesError, setDeliveriesError] = useState('')
  const deliveriesRequest = useRef(0)
  const drawerCloseRef = useRef<HTMLButtonElement>(null)

  useEffect(() => { load(); loadEventTypes() }, [])

  useEffect(() => {
    if (!drawerFor) return
    drawerCloseRef.current?.focus()
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') closeDeliveries()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [drawerFor])

  async function loadEventTypes() {
    setEventTypesError('')
    try {
      const r = await webhooksApi.eventTypes()
      setEventTypes(r.data.event_types ?? [])
    } catch (e) {
      setEventTypesError(errorDetail(e, 'Could not load event types.'))
    }
  }

  const knownKeys = new Set((eventTypes ?? []).map(t => t.key))
  const isUnknown = (key: string) => eventTypes !== null && !knownKeys.has(key)
  const labelFor = (key: string) => (eventTypes ?? []).find(t => t.key === key)?.label ?? key

  async function load() {
    setLoading(true)
    setLoadError('')
    try {
      const r = await webhooksApi.list()
      setWebhooks(r.data.webhooks || r.data.results || [])
    } catch (e) {
      setLoadError(errorDetail(e, 'Could not load webhooks.'))
    }
    setLoading(false)
  }

  function openCreate() {
    setForm(emptyForm())
    setSelected(null)
    setFormError('')
    setModal('create')
  }

  function openEdit(w: Webhook) {
    setSelected(w)
    setForm({
      url: w.url,
      event_types: [...(w.event_types ?? [])],
      is_active: w.is_active,
      format: w.format ?? 'raw',
      secret: '',
    })
    setFormError('')
    setModal('edit')
  }

  function toggleEvent(key: string) {
    setForm(f => ({
      ...f,
      event_types: f.event_types.includes(key)
        ? f.event_types.filter(k => k !== key)
        : [...f.event_types, key],
    }))
  }

  const catalogKeys = (eventTypes ?? []).map(t => t.key)
  const allSelected = catalogKeys.length > 0 && catalogKeys.every(k => form.event_types.includes(k))

  function toggleAllEvents() {
    setForm(f => ({
      ...f,
      event_types: allSelected
        ? f.event_types.filter(k => !catalogKeys.includes(k))
        : [...f.event_types, ...catalogKeys.filter(k => !f.event_types.includes(k))],
    }))
  }

  async function save() {
    setSaving(true)
    setFormError('')
    try {
      const secret = form.secret.trim()
      const payload = {
        url: form.url.trim(),
        event_types: form.event_types,
        format: form.format,
        ...(modal === 'edit' ? { is_active: form.is_active } : {}),
        ...(secret ? { secret } : {}),
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
      const inline = inlineSaveError(e)
      if (inline) setFormError(inline)
      else showToast(errorDetail(e, 'Failed to save webhook'))
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
    let result: TestResult
    try {
      const r = await webhooksApi.test(w.webhook_id)
      result = {
        delivered: r.data.delivered === true,
        http_status: r.data.http_status ?? null,
        detail: typeof r.data.detail === 'string' ? r.data.detail : '',
      }
    } catch (e) {
      result = { delivered: false, http_status: null, detail: errorDetail(e, 'The test could not be sent.') }
    }
    setTestResults(prev => ({ ...prev, [w.webhook_id]: result }))
    setTestingId(null)
  }

  async function loadDeliveries(w: Webhook) {
    const request = ++deliveriesRequest.current
    setDeliveriesLoading(true)
    setDeliveriesError('')
    try {
      const r = await webhooksApi.deliveries(w.webhook_id, DELIVERIES_LIMIT)
      if (request !== deliveriesRequest.current) return
      const rows = Array.isArray(r.data) ? r.data : (r.data?.deliveries ?? [])
      setDeliveries(rows)
    } catch (e) {
      if (request !== deliveriesRequest.current) return
      setDeliveries([])
      setDeliveriesError(errorDetail(e, 'Could not load deliveries.'))
    }
    if (request === deliveriesRequest.current) setDeliveriesLoading(false)
  }

  function openDeliveries(w: Webhook) {
    setDeliveries([])
    setDrawerFor(w)
    loadDeliveries(w)
  }

  function closeDeliveries() {
    deliveriesRequest.current++
    setDrawerFor(null)
  }

  return (
    <>
      <section className="wh-section ps-section card">
        <div className="card-header">
          <span className="card-title">Subscriptions</span>
          <button className="btn btn-primary" onClick={openCreate}>+ Add Webhook</button>
        </div>
        {loading ? (
          <div className="wh-loading">Loading…</div>
        ) : loadError ? (
          <div className="wh-load-error">
            <span role="alert">{loadError}</span>
            <button className="btn btn-ghost btn-sm" onClick={load}>Retry</button>
          </div>
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
                      {(w.event_types ?? []).map(e => (
                        <span key={e} className={isUnknown(e) ? 'wh-tag wh-tag-flag' : 'wh-tag'}
                          title={isUnknown(e) ? 'Unknown event type' : undefined}>
                          {labelFor(e)}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td data-label="Format">
                    <span className="wh-tag">{(w.format ?? 'raw').toUpperCase()}</span>
                  </td>
                  <td data-label="Status">
                    <span className={`badge ${w.is_active ? 'badge-green' : 'badge-gray'}`}>
                      {w.is_active ? 'Active' : 'Inactive'}
                    </span>
                    {w.has_secret && <span className="badge badge-blue wh-secret-badge">Secret set</span>}
                  </td>
                  <td data-label="Actions">
                    <div className="wh-actions-col">
                      <div className="wh-actions">
                        <button className="wh-action-btn" onClick={() => testWebhook(w)}
                          disabled={testingId === w.webhook_id}>
                          {testingId === w.webhook_id ? 'Sending…' : 'Send test'}
                        </button>
                        <button className="wh-action-btn" onClick={() => openDeliveries(w)}>Deliveries</button>
                        <button className="wh-action-btn" onClick={() => openEdit(w)}>Edit</button>
                        <button className="wh-action-btn wh-action-delete" onClick={() => deleteWebhook(w)}>Delete</button>
                      </div>
                      {testResults[w.webhook_id] && (
                        <div className="wh-test-result" role="status">
                          <span className={`badge ${testResults[w.webhook_id].delivered ? 'badge-green' : 'badge-red'}`}>
                            {testResults[w.webhook_id].delivered ? 'Delivered' : 'Failed'}
                          </span>
                          {testResults[w.webhook_id].http_status != null && (
                            <span className="wh-test-status">HTTP {testResults[w.webhook_id].http_status}</span>
                          )}
                          {testResults[w.webhook_id].detail && (
                            <span className="wh-test-detail">{testResults[w.webhook_id].detail}</span>
                          )}
                        </div>
                      )}
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
              <h2>{modal === 'create' ? 'Add Webhook' : `Edit, ${selected?.url}`}</h2>
              <button className="modal-close" onClick={() => setModal(null)}>✕</button>
            </div>
            <div className="wh-form">
              <label className="wh-field">
                <span className="form-label">URL *</span>
                <input className="form-input" value={form.url}
                  onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
                  placeholder="https://example.com/webhook" />
              </label>
              <div className="wh-field" role="group" aria-labelledby="wh-events-label">
                <span id="wh-events-label" className="form-label">Event Types *</span>
                {eventTypesError ? (
                  <div className="wh-load-error wh-load-error-inline">
                    <span role="alert">{eventTypesError}</span>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={loadEventTypes}>Retry</button>
                  </div>
                ) : eventTypes === null ? (
                  <div className="wh-hint">Loading…</div>
                ) : (
                  <>
                    <label className="wh-checkbox wh-check-all">
                      <input type="checkbox" checked={allSelected} onChange={toggleAllEvents}
                        disabled={catalogKeys.length === 0} />
                      <span>All events</span>
                    </label>
                    <div className="wh-event-grid">
                      {eventTypes.map(t => (
                        <label key={t.key} className="wh-checkbox">
                          <input type="checkbox" checked={form.event_types.includes(t.key)}
                            onChange={() => toggleEvent(t.key)} />
                          <span>{t.label}</span>
                        </label>
                      ))}
                    </div>
                    {form.event_types.some(isUnknown) && (
                      <div className="wh-chips">
                        {form.event_types.filter(isUnknown).map(k => (
                          <span key={k} className="wh-chip wh-chip-flag">
                            <span>{k}</span>
                            <span className="wh-chip-note">Unknown</span>
                            <button type="button" className="wh-chip-remove" aria-label={`Remove ${k}`}
                              onClick={() => toggleEvent(k)}>✕</button>
                          </span>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
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
              <div className="wh-field">
                <div className="wh-label-row">
                  <label className="form-label" htmlFor="wh-secret">Signing secret</label>
                  {modal === 'edit' && selected?.has_secret && (
                    <span className="badge badge-blue">Secret set</span>
                  )}
                </div>
                <input id="wh-secret" className="form-input" type="password" autoComplete="new-password"
                  value={form.secret}
                  onChange={e => setForm(f => ({ ...f, secret: e.target.value }))}
                  placeholder={modal === 'edit' && selected?.has_secret ? 'Leave empty to keep the current secret' : 'Optional'} />
              </div>
              {modal === 'edit' && (
                <label className="wh-checkbox">
                  <input type="checkbox" checked={form.is_active}
                    onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />
                  <span>Active</span>
                </label>
              )}
              {formError && <div className="wh-form-error" role="alert">{formError}</div>}
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={save}
                disabled={saving || !form.url.trim() || form.event_types.length === 0}>
                {saving ? 'Saving…' : modal === 'create' ? 'Create' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {drawerFor && (
        <div className="wh-drawer-backdrop" onClick={closeDeliveries}>
          <div className="wh-drawer" role="dialog" aria-modal="true" aria-label="Deliveries"
            onClick={e => e.stopPropagation()}>
            <div className="wh-drawer-header">
              <div className="wh-drawer-text">
                <div className="wh-drawer-title">Deliveries</div>
                <div className="wh-drawer-url">{drawerFor.url}</div>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => loadDeliveries(drawerFor)}
                disabled={deliveriesLoading}>
                {deliveriesLoading ? 'Refreshing…' : 'Refresh'}
              </button>
              <button type="button" ref={drawerCloseRef} className="modal-close" aria-label="Close deliveries"
                onClick={closeDeliveries}>✕</button>
            </div>
            <div className="wh-drawer-body">
              {deliveriesError ? (
                <div className="wh-load-error wh-load-error-inline">
                  <span role="alert">{deliveriesError}</span>
                </div>
              ) : deliveriesLoading && deliveries.length === 0 ? (
                <div className="wh-loading">Loading…</div>
              ) : deliveries.length === 0 ? (
                <div className="wh-empty">No deliveries yet.</div>
              ) : (
                <div className="wh-table-wrap">
                  <table className="wh-del-table">
                    <thead>
                      <tr>
                        <th>Status</th>
                        <th>Event</th>
                        <th>HTTP</th>
                        <th>Time</th>
                        <th>When</th>
                        <th>Error</th>
                      </tr>
                    </thead>
                    <tbody>
                      {deliveries.map(d => (
                        <tr key={d.delivery_id}>
                          <td>
                            <span className={`badge ${d.status === 'sent' ? 'badge-green' : 'badge-red'}`}>
                              {d.status === 'sent' ? 'Sent' : 'Failed'}
                            </span>
                          </td>
                          <td>{labelFor(d.event)}</td>
                          <td>{d.http_status ?? '-'}</td>
                          <td className="wh-nowrap">{d.duration_ms} ms</td>
                          <td className="wh-nowrap">
                            <time dateTime={d.created_at} title={new Date(d.created_at).toLocaleString()}>
                              {relativeTime(d.created_at)}
                            </time>
                          </td>
                          <td className={d.error ? 'wh-del-error' : undefined}>{d.error || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
