import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { adminConfigApi, brandingApi, companySettingsApi, notificationSettingsApi } from '../../lib/api'
import '../../styles/admin-tabs.css'
import './OrganizationPage.css'


function errorMessage(e: unknown, fallback: string): string {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  if (typeof detail === 'string' && detail.trim()) return detail
  if (Array.isArray(detail) && detail.length) {
    return detail
      .map(d => (d && typeof d === 'object' && 'msg' in d) ? String((d as { msg: unknown }).msg) : String(d))
      .join('; ')
  }
  return fallback
}

function statusOf(e: unknown): number | undefined {
  return (e as { response?: { status?: number } })?.response?.status
}

type ShowToast = (msg: string) => void


interface CompanyProfile {
  company_name: string
  industry: string
  size: string
  website: string
  address: string
  primary_contact_email: string
  updated_at?: string
}

interface IntegrationItem {
  id: string
  label: string
  configured: boolean
}

interface JobSourceItem extends IntegrationItem {
  requires_key: boolean
}

interface IntegrationsStatus {
  core: IntegrationItem[]
  job_sources: JobSourceItem[]
}

function emptyProfile(): CompanyProfile {
  return { company_name: '', industry: '', size: '', website: '', address: '', primary_contact_email: '' }
}

function CompanyTab({ showToast }: { showToast: ShowToast }) {
  const [profile, setProfile] = useState<CompanyProfile>(emptyProfile())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [status, setStatus] = useState<IntegrationsStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(true)

  useEffect(() => { load(); loadStatus() }, [])

  async function load() {
    setLoading(true)
    try {
      const r = await companySettingsApi.get()
      setProfile({ ...emptyProfile(), ...r.data })
    } catch {}
    setLoading(false)
  }

  async function loadStatus() {
    setStatusLoading(true)
    try {
      const r = await companySettingsApi.integrationsStatus()
      setStatus(r.data)
    } catch {}
    setStatusLoading(false)
  }

  function setField(field: keyof CompanyProfile, value: string) {
    setProfile(p => ({ ...p, [field]: value }))
  }

  async function handleSave() {
    setSaving(true)
    try {
      const { company_name, industry, size, website, address, primary_contact_email } = profile
      const r = await companySettingsApi.update({
        company_name, industry, size, website, address, primary_contact_email,
      })
      setProfile({ ...emptyProfile(), ...r.data })
      showToast('Company settings saved')
    } catch (e) {
      showToast(errorMessage(e, 'Failed to save company settings'))
    }
    setSaving(false)
  }

  return (
    <>
      <section className="org-section">
        <div className="org-card card">
          <div className="card-header">
            <span className="card-title">Company Profile</span>
          </div>
          {loading ? (
            <div className="org-loading">Loading…</div>
          ) : (
            <div className="org-form">
              <div className="org-form-grid">
                <label className="org-field">
                  <span className="form-label">Company Name</span>
                  <input className="form-input" value={profile.company_name}
                    onChange={e => setField('company_name', e.target.value)}
                    placeholder="Acme Corporation" />
                </label>
                <label className="org-field">
                  <span className="form-label">Industry</span>
                  <input className="form-input" value={profile.industry}
                    onChange={e => setField('industry', e.target.value)}
                    placeholder="Software & Technology" />
                </label>
                <label className="org-field">
                  <span className="form-label">Company Size</span>
                  <input className="form-input" value={profile.size}
                    onChange={e => setField('size', e.target.value)}
                    placeholder="e.g. 51-200 employees" />
                </label>
                <label className="org-field">
                  <span className="form-label">Website</span>
                  <input className="form-input" value={profile.website}
                    onChange={e => setField('website', e.target.value)}
                    placeholder="https://example.com" />
                </label>
                <label className="org-field">
                  <span className="form-label">Primary Contact Email</span>
                  <input className="form-input" type="email" value={profile.primary_contact_email}
                    onChange={e => setField('primary_contact_email', e.target.value)}
                    placeholder="hr@example.com" />
                </label>
                <label className="org-field org-field-wide">
                  <span className="form-label">Address</span>
                  <input className="form-input" value={profile.address}
                    onChange={e => setField('address', e.target.value)}
                    placeholder="123 Main St, City, Country" />
                </label>
              </div>
              <div className="org-form-footer">
                {profile.updated_at && (
                  <span className="org-updated-at">Last saved {new Date(profile.updated_at).toLocaleString()}</span>
                )}
                <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="org-section">
        <div className="org-card card">
          <div className="card-header">
            <span className="card-title">Integrations Status</span>
            <span className="org-readonly-tag">Read-only</span>
          </div>
          {statusLoading ? (
            <div className="org-loading">Loading…</div>
          ) : !status ? (
            <div className="org-loading">Could not load integrations status.</div>
          ) : (
            <div className="org-status-body">
              <div className="org-status-group-title">Core Services</div>
              <div className="org-status-grid">
                {status.core.map(item => (
                  <div key={item.id} className="org-status-row">
                    <span className="org-status-label">{item.label}</span>
                    <span className={`badge ${item.configured ? 'badge-green' : 'badge-gray'}`}>
                      {item.configured ? 'Configured' : 'Not Configured'}
                    </span>
                  </div>
                ))}
              </div>

              <div className="org-status-group-title org-status-group-title-spaced">Job Board Sources</div>
              <div className="org-status-grid">
                {status.job_sources.map(item => (
                  <div key={item.id} className="org-status-row">
                    <span className="org-status-label">
                      {item.label}
                      {!item.requires_key && <span className="org-free-tag">Free</span>}
                    </span>
                    <span className={`badge ${item.configured ? 'badge-green' : 'badge-gray'}`}>
                      {item.configured ? 'Configured' : 'Not Configured'}
                    </span>
                  </div>
                ))}
              </div>

              <p className="org-note">
                Statuses only indicate whether a key is present - actual secret values are never shown or transmitted here.
              </p>
            </div>
          )}
        </div>
      </section>
    </>
  )
}


interface BrandingSettings {
  company_logo_url: string
  primary_color: string
  accent_color: string
  updated_at?: string
}

interface NotificationEvent {
  event: string
  label: string
  description: string
  enabled: boolean
}

interface NotificationSettings {
  notify_email: string
  events: NotificationEvent[]
  updated_at?: string
}

const DEFAULT_BRANDING: BrandingSettings = {
  company_logo_url: '',
  primary_color: '#4778f3',
  accent_color: '#222022',
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/

function BrandingTab({ showToast }: { showToast: ShowToast }) {
  const [branding, setBranding] = useState<BrandingSettings>(DEFAULT_BRANDING)
  const [brandingLoading, setBrandingLoading] = useState(true)
  const [brandingSaving, setBrandingSaving] = useState(false)

  const [notif, setNotif] = useState<NotificationSettings>({ notify_email: '', events: [] })
  const [notifLoading, setNotifLoading] = useState(true)
  const [notifSaving, setNotifSaving] = useState(false)

  useEffect(() => { loadBranding(); loadNotifications() }, [])

  async function loadBranding() {
    setBrandingLoading(true)
    try {
      const r = await brandingApi.get()
      setBranding({ ...DEFAULT_BRANDING, ...r.data })
    } catch {}
    setBrandingLoading(false)
  }

  async function loadNotifications() {
    setNotifLoading(true)
    try {
      const r = await notificationSettingsApi.get()
      setNotif({
        notify_email: r.data.notify_email || '',
        events: r.data.events || [],
        updated_at: r.data.updated_at,
      })
    } catch {}
    setNotifLoading(false)
  }

  async function saveBranding() {
    if (!HEX_RE.test(branding.primary_color) || !HEX_RE.test(branding.accent_color)) {
      showToast('Colors must be valid 6-digit hex codes, e.g. #4778f3')
      return
    }
    setBrandingSaving(true)
    try {
      const r = await brandingApi.update({
        company_logo_url: branding.company_logo_url,
        primary_color: branding.primary_color,
        accent_color: branding.accent_color,
      })
      setBranding({ ...DEFAULT_BRANDING, ...r.data })
      showToast('Branding saved - reload other open tabs to see it applied there too')
    } catch (e) {
      showToast(errorMessage(e, 'Failed to save branding'))
    }
    setBrandingSaving(false)
  }

  function resetToDefaults() {
    setBranding(b => ({ ...b, ...DEFAULT_BRANDING }))
  }

  function toggleEvent(event: string) {
    setNotif(n => ({
      ...n,
      events: n.events.map(e => (e.event === event ? { ...e, enabled: !e.enabled } : e)),
    }))
  }

  async function saveNotifications() {
    setNotifSaving(true)
    try {
      const eventsMap = Object.fromEntries(notif.events.map(e => [e.event, e.enabled]))
      const r = await notificationSettingsApi.update({ notify_email: notif.notify_email, events: eventsMap })
      setNotif({
        notify_email: r.data.notify_email || '',
        events: r.data.events || [],
        updated_at: r.data.updated_at,
      })
      showToast('Notification settings saved')
    } catch (e) {
      showToast(errorMessage(e, 'Failed to save notification settings'))
    }
    setNotifSaving(false)
  }

  return (
    <>
      <section className="org-section">
        <div className="org-card card">
          <div className="card-header">
            <span className="card-title">Branding / White-Labeling</span>
          </div>
          {brandingLoading ? (
            <div className="org-loading">Loading…</div>
          ) : (
            <div className="org-form">
              <div className="org-brand-grid">
                <div className="org-brand-fields">
                  <label className="org-field">
                    <span className="form-label">Company Logo URL</span>
                    <input className="form-input" value={branding.company_logo_url}
                      onChange={e => setBranding(b => ({ ...b, company_logo_url: e.target.value }))}
                      placeholder="https://example.com/logo.png" />
                    <span className="org-hint">Leave blank to keep the default Hirely.ai mark</span>
                  </label>

                  <label className="org-field">
                    <span className="form-label">Primary Color</span>
                    <div className="org-color-row">
                      <input type="color" className="org-color-swatch-input"
                        value={HEX_RE.test(branding.primary_color) ? branding.primary_color : '#4778f3'}
                        onChange={e => setBranding(b => ({ ...b, primary_color: e.target.value }))} />
                      <input className="form-input org-color-text" value={branding.primary_color}
                        onChange={e => setBranding(b => ({ ...b, primary_color: e.target.value }))}
                        placeholder="#4778f3" />
                    </div>
                  </label>

                  <label className="org-field">
                    <span className="form-label">Accent Color</span>
                    <div className="org-color-row">
                      <input type="color" className="org-color-swatch-input"
                        value={HEX_RE.test(branding.accent_color) ? branding.accent_color : '#222022'}
                        onChange={e => setBranding(b => ({ ...b, accent_color: e.target.value }))} />
                      <input className="form-input org-color-text" value={branding.accent_color}
                        onChange={e => setBranding(b => ({ ...b, accent_color: e.target.value }))}
                        placeholder="#222022" />
                    </div>
                  </label>
                </div>

                <div className="org-preview">
                  <div className="org-preview-label">Live Preview</div>
                  <div className="org-preview-card">
                    {branding.company_logo_url ? (
                      <img
                        src={branding.company_logo_url}
                        alt="Logo preview"
                        className="org-preview-logo"
                        onError={e => { (e.target as HTMLImageElement).style.visibility = 'hidden' }}
                      />
                    ) : (
                      <div className="org-preview-logo-placeholder" style={{ background: branding.primary_color }}>HR</div>
                    )}
                    <div className="org-preview-swatches">
                      <button type="button" className="org-preview-btn" style={{ background: branding.primary_color }}>
                        Primary Button
                      </button>
                      <span className="org-preview-badge" style={{ background: branding.accent_color }}>
                        Accent Badge
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="org-form-footer">
                {branding.updated_at && (
                  <span className="org-updated-at">Last saved {new Date(branding.updated_at).toLocaleString()}</span>
                )}
                <div className="org-form-actions">
                  <button className="btn btn-ghost" onClick={resetToDefaults} disabled={brandingSaving}>
                    Reset to Defaults
                  </button>
                  <button className="btn btn-primary" onClick={saveBranding} disabled={brandingSaving}>
                    {brandingSaving ? 'Saving…' : 'Save Branding'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="org-section">
        <div className="org-card card">
          <div className="card-header">
            <span className="card-title">Notification Settings</span>
          </div>
          {notifLoading ? (
            <div className="org-loading">Loading…</div>
          ) : (
            <div className="org-form">
              <label className="org-field org-field-wide">
                <span className="form-label">Notify Email</span>
                <input className="form-input" type="email" value={notif.notify_email}
                  onChange={e => setNotif(n => ({ ...n, notify_email: e.target.value }))}
                  placeholder="alerts@example.com" />
                <span className="org-hint">Where these internal event notifications would be sent</span>
              </label>

              <div className="org-events">
                {notif.events.map(ev => (
                  <label key={ev.event} className="org-event-row">
                    <div className="org-event-text">
                      <span className="org-event-label">{ev.label}</span>
                      <span className="org-event-desc">{ev.description}</span>
                    </div>
                    <input type="checkbox" checked={ev.enabled} onChange={() => toggleEvent(ev.event)} />
                  </label>
                ))}
                {notif.events.length === 0 && (
                  <div className="org-loading">No notification events available.</div>
                )}
              </div>

              <div className="org-form-footer">
                {notif.updated_at && (
                  <span className="org-updated-at">Last saved {new Date(notif.updated_at).toLocaleString()}</span>
                )}
                <button className="btn btn-primary" onClick={saveNotifications} disabled={notifSaving}>
                  {notifSaving ? 'Saving…' : 'Save Notification Settings'}
                </button>
              </div>

              <p className="org-note">
                Saving these settings does not yet send any emails - wiring actual notification delivery into each
                event (offer declines, integrity flags, failed imports, etc.) is a follow-up, out of scope for this pass.
              </p>
            </div>
          )}
        </div>
      </section>
    </>
  )
}


interface DepartmentUsage {
  designations: number
  jobs: number
  users: number
  total: number
}

interface Department {
  department_id: string
  name: string
  description?: string | null
  usage?: DepartmentUsage
}

interface Designation {
  designation_id: string
  name: string
  department?: string | null
  description?: string | null
}

const USAGE_LABELS: [keyof DepartmentUsage, string][] = [
  ['designations', 'designation'],
  ['jobs', 'job'],
  ['users', 'user'],
]

function usageTags(usage?: DepartmentUsage) {
  if (!usage || !usage.total) return null
  return USAGE_LABELS
    .filter(([key]) => usage[key] > 0)
    .map(([key, label]) => `${usage[key]} ${label}${usage[key] === 1 ? '' : 's'}`)
}

function DepartmentsTab({ showToast }: { showToast: ShowToast }) {
  const [departments, setDepartments] = useState<Department[]>([])
  const [designations, setDesignations] = useState<Designation[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [deptModal, setDeptModal] = useState<'create' | 'edit' | null>(null)
  const [deptSelected, setDeptSelected] = useState<Department | null>(null)
  const [deptForm, setDeptForm] = useState({ name: '', description: '' })

  const [desigModal, setDesigModal] = useState<'create' | 'edit' | null>(null)
  const [desigSelected, setDesigSelected] = useState<Designation | null>(null)
  const [desigForm, setDesigForm] = useState({ name: '', department: '', description: '' })

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const [d, r] = await Promise.all([adminConfigApi.listDepartments(), adminConfigApi.listDesignations()])
      setDepartments(d.data.departments ?? [])
      setDesignations(r.data.designations ?? [])
    } catch {}
    setLoading(false)
  }

  function openCreateDept() {
    setDeptForm({ name: '', description: '' })
    setDeptSelected(null)
    setDeptModal('create')
  }

  function openEditDept(d: Department) {
    setDeptSelected(d)
    setDeptForm({ name: d.name, description: d.description || '' })
    setDeptModal('edit')
  }

  async function saveDept() {
    setSaving(true)
    try {
      if (deptModal === 'create') {
        await adminConfigApi.createDepartment({ name: deptForm.name, description: deptForm.description || undefined })
        showToast('Department created')
      } else if (deptSelected) {
        const r = await adminConfigApi.updateDepartment(deptSelected.department_id, {
          name: deptForm.name, description: deptForm.description,
        })
        const renamed = r.data?.designations_renamed ?? 0
        showToast(renamed
          ? `Department updated - ${renamed} designation${renamed === 1 ? '' : 's'} re-pointed`
          : 'Department updated')
      }
      setDeptModal(null); load()
    } catch (e) {
      showToast(errorMessage(e, 'Failed to save department'))
    }
    setSaving(false)
  }

  async function deleteDept(d: Department) {
    if (!confirm(`Delete department "${d.name}"?`)) return
    try {
      await adminConfigApi.deleteDepartment(d.department_id)
      showToast('Department deleted')
      load()
      return
    } catch (e) {
      if (statusOf(e) !== 409) {
        showToast(errorMessage(e, 'Failed to delete department'))
        return
      }
      const detail = errorMessage(e, 'This department is still in use.')
      if (!confirm(`${detail}\n\nDelete it anyway? Designations naming it will be detached.`)) return
    }
    try {
      const r = await adminConfigApi.deleteDepartment(d.department_id, true)
      const detached = r.data?.designations_detached ?? 0
      showToast(detached
        ? `Department deleted - ${detached} designation${detached === 1 ? '' : 's'} detached`
        : 'Department deleted')
      load()
    } catch (e) {
      showToast(errorMessage(e, 'Failed to delete department'))
    }
  }

  function openCreateDesig() {
    setDesigForm({ name: '', department: '', description: '' })
    setDesigSelected(null)
    setDesigModal('create')
  }

  function openEditDesig(d: Designation) {
    setDesigSelected(d)
    setDesigForm({ name: d.name, department: d.department || '', description: d.description || '' })
    setDesigModal('edit')
  }

  async function saveDesig() {
    setSaving(true)
    try {
      if (desigModal === 'create') {
        await adminConfigApi.createDesignation({
          name: desigForm.name,
          department: desigForm.department || undefined,
          description: desigForm.description || undefined,
        })
        showToast('Designation created')
      } else if (desigSelected) {
        await adminConfigApi.updateDesignation(desigSelected.designation_id, {
          name: desigForm.name, department: desigForm.department, description: desigForm.description,
        })
        showToast('Designation updated')
      }
      setDesigModal(null); load()
    } catch (e) {
      showToast(errorMessage(e, 'Failed to save designation'))
    }
    setSaving(false)
  }

  async function deleteDesig(d: Designation) {
    if (!confirm(`Delete designation "${d.name}"?`)) return
    try {
      await adminConfigApi.deleteDesignation(d.designation_id)
      showToast('Designation deleted')
      load()
    } catch (e) { showToast(errorMessage(e, 'Failed to delete designation')) }
  }

  return (
    <>
      <section className="org-section">
        <div className="org-columns">
          <div className="org-table-card card">
            <div className="card-header">
              <span className="card-title">Departments</span>
              <button className="btn btn-primary" onClick={openCreateDept}>+ Add Department</button>
            </div>
            {loading ? (
              <div className="org-loading">Loading…</div>
            ) : (
              <table className="org-table">
                <thead><tr><th>Name</th><th>Used by</th><th></th></tr></thead>
                <tbody>
                  {departments.length === 0 ? (
                    <tr><td colSpan={3} className="org-empty">No departments yet.</td></tr>
                  ) : departments.map(d => {
                    const tags = usageTags(d.usage)
                    return (
                      <tr key={d.department_id}>
                        <td className="org-name" data-label="Name">{d.name}</td>
                        <td data-label="Used by">
                          {tags ? (
                            <div className="org-usage">
                              {tags.map(t => <span key={t} className="org-usage-tag">{t}</span>)}
                            </div>
                          ) : (
                            <span className="org-usage-none">Not referenced</span>
                          )}
                        </td>
                        <td data-label="Actions">
                          <div className="org-actions">
                            <button className="org-action-btn" onClick={() => openEditDept(d)}>Edit</button>
                            <button className="org-action-btn org-action-delete" onClick={() => deleteDept(d)}>Delete</button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div className="org-table-card card">
            <div className="card-header">
              <span className="card-title">Designations</span>
              <button className="btn btn-primary" onClick={openCreateDesig}>+ Add Designation</button>
            </div>
            {loading ? (
              <div className="org-loading">Loading…</div>
            ) : (
              <table className="org-table">
                <thead><tr><th>Name</th><th>Department</th><th></th></tr></thead>
                <tbody>
                  {designations.length === 0 ? (
                    <tr><td colSpan={3} className="org-empty">No designations yet.</td></tr>
                  ) : designations.map(d => (
                    <tr key={d.designation_id}>
                      <td className="org-name" data-label="Name">{d.name}</td>
                      <td className="org-muted" data-label="Department">{d.department || '-'}</td>
                      <td data-label="Actions">
                        <div className="org-actions">
                          <button className="org-action-btn" onClick={() => openEditDesig(d)}>Edit</button>
                          <button className="org-action-btn org-action-delete" onClick={() => deleteDesig(d)}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </section>

      {deptModal && (
        <div className="modal-overlay" onClick={() => setDeptModal(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{deptModal === 'create' ? 'Add Department' : `Edit - ${deptSelected?.name}`}</h2>
              <button className="modal-close" onClick={() => setDeptModal(null)}>✕</button>
            </div>
            <div className="org-modal-form">
              <label className="org-field">
                <span className="form-label">Name *</span>
                <input className="form-input" value={deptForm.name}
                  onChange={e => setDeptForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Engineering" />
                {deptModal === 'edit' && !!deptSelected?.usage?.designations && (
                  <span className="org-hint">
                    Renaming also re-points the {deptSelected.usage.designations} designation
                    {deptSelected.usage.designations === 1 ? '' : 's'} that name this department.
                  </span>
                )}
              </label>
              <label className="org-field">
                <span className="form-label">Description</span>
                <input className="form-input" value={deptForm.description}
                  onChange={e => setDeptForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Optional" />
              </label>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setDeptModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveDept} disabled={saving || !deptForm.name.trim()}>
                {saving ? 'Saving…' : deptModal === 'create' ? 'Create' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {desigModal && (
        <div className="modal-overlay" onClick={() => setDesigModal(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{desigModal === 'create' ? 'Add Designation' : `Edit - ${desigSelected?.name}`}</h2>
              <button className="modal-close" onClick={() => setDesigModal(null)}>✕</button>
            </div>
            <div className="org-modal-form">
              <label className="org-field">
                <span className="form-label">Name *</span>
                <input className="form-input" value={desigForm.name}
                  onChange={e => setDesigForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Senior Software Engineer" />
              </label>
              <label className="org-field">
                <span className="form-label">Department</span>
                <select className="form-input" value={desigForm.department}
                  onChange={e => setDesigForm(f => ({ ...f, department: e.target.value }))}>
                  <option value="">- None -</option>
                  {departments.map(d => <option key={d.department_id} value={d.name}>{d.name}</option>)}
                </select>
              </label>
              <label className="org-field">
                <span className="form-label">Description</span>
                <input className="form-input" value={desigForm.description}
                  onChange={e => setDesigForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Optional" />
              </label>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setDesigModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveDesig} disabled={saving || !desigForm.name.trim()}>
                {saving ? 'Saving…' : desigModal === 'create' ? 'Create' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}


const TABS = ['company', 'branding', 'departments'] as const
type Tab = typeof TABS[number]

const TAB_LABELS: Record<Tab, string> = {
  company: 'Company Profile',
  branding: 'Branding & Notifications',
  departments: 'Departments & Designations',
}

const TAB_SUBTITLES: Record<Tab, string> = {
  company: 'Company profile details and a live status view of every external integration',
  branding: 'White-label the look of this app and choose which internal events email admins',
  departments: 'The department and job-title structure used across jobs, candidates and user scoping',
}

function isTab(value: string | null): value is Tab {
  return !!value && (TABS as readonly string[]).includes(value)
}

export default function OrganizationPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const rawTab = searchParams.get('tab')
  const tab: Tab = isTab(rawTab) ? rawTab : 'company'

  function setTab(next: Tab) {
    setSearchParams(next === 'company' ? {} : { tab: next }, { replace: true })
  }

  const [toast, setToast] = useState('')
  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 3500)
  }

  return (
    <div className="org-page">
      {toast && <div className="org-toast">{toast}</div>}

      <div className="page-header">
        <div>
          <div className="page-title">Organization</div>
          <div className="page-sub">{TAB_SUBTITLES[tab]}</div>
        </div>
      </div>

      <div className="adm-tabs" role="tablist">
        {TABS.map(t => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={`adm-tab${tab === t ? ' adm-tab-active' : ''}`}
            onClick={() => setTab(t)}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {tab === 'company' && <CompanyTab showToast={showToast} />}
      {tab === 'branding' && <BrandingTab showToast={showToast} />}
      {tab === 'departments' && <DepartmentsTab showToast={showToast} />}
    </div>
  )
}
