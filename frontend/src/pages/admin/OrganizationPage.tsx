import { Fragment, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  adminConfigApi, brandingApi, companySettingsApi, jobGradesApi, notificationSettingsApi, offersApi,
  type CompanyUsage,
} from '../../lib/api'
import { isUploadedLogo, resolveLogoUrl } from '../../lib/brand'
import { useAuthStore } from '../../store/auth.store'
import DataPanel from './organization/DataPanel'
import IntegrationsPanel from './organization/IntegrationsPanel'
import MailPanel from './organization/MailPanel'
import SignInPanel from './organization/SignInPanel'
import { daysUntil, fmtDay, fmtMb } from './organization/helpers'
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

function LoadFailed({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="org-error">
      <span role="alert">{message}</span>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry}>Retry</button>
    </div>
  )
}

interface CompanyProfile {
  company_name: string
  industry: string
  size: string
  website: string
  address: string
  primary_contact_email: string
  terms_url: string
  privacy_url: string
  updated_at?: string
}

interface IntegrationItem {
  id?: string
  label?: string
  configured?: boolean
  active?: boolean
  requires_key?: boolean
}

type IntegrationsStatus = Record<string, unknown>

const INTEGRATION_GROUP_TITLES: Record<string, string> = {
  core: 'Core Services',
  job_sources: 'Job Board Sources',
}

function titleCase(s: string) {
  return s.split('_').filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

function isIntegrationItem(value: unknown): value is IntegrationItem {
  if (!value || typeof value !== 'object') return false
  const v = value as IntegrationItem
  return typeof v.id === 'string' || typeof v.label === 'string'
}

function integrationGroups(status: IntegrationsStatus) {
  const keys = ['core', 'job_sources', ...Object.keys(status).filter(k => k !== 'core' && k !== 'job_sources')]
  return keys.flatMap(key => {
    const raw = status[key]
    const items = Array.isArray(raw) ? raw.filter(isIntegrationItem) : []
    return items.length ? [{ key, title: INTEGRATION_GROUP_TITLES[key] ?? titleCase(key), items }] : []
  })
}

function integrationBadge(item: IntegrationItem): { label: string; cls: string } {
  if (item.active === false) return { label: 'Not in use', cls: 'badge-gray' }
  return item.configured
    ? { label: 'Configured', cls: 'badge-green' }
    : { label: 'Not Configured', cls: 'badge-gray' }
}

function emptyProfile(): CompanyProfile {
  return {
    company_name: '', industry: '', size: '', website: '', address: '', primary_contact_email: '',
    terms_url: '', privacy_url: '',
  }
}

function legalLinkError(value: string, what: string): string {
  const v = value.trim()
  if (v === '') return ''
  try {
    return new URL(v).protocol === 'https:' ? '' : `${what} must start with https://`
  } catch {
    return `${what} must be a full address starting with https://`
  }
}

function shareOf(used: number, limit: number | null): number | null {
  if (limit === null) return null
  return limit > 0 ? (used / limit) * 100 : 100
}

function usd(n: number): string {
  return n < 1 && n > 0 ? `$${n.toFixed(4)}` : `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function monthName(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month)
  if (!m) return month
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

function UsageMeter({ label, percent }: { label: string; percent: number }) {
  const shown = Math.min(100, Math.max(0, percent))
  const tone = percent >= 100 ? 'error' : percent >= 80 ? 'warning' : 'ok'
  return (
    <div
      className={`org-meter org-meter-${tone}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(shown)}
      aria-valuetext={`${Math.round(percent)}%`}
    >
      <div className="org-meter-fill" style={{ width: `${shown}%` }} />
    </div>
  )
}

function SubscriptionNotice({ subscription }: { subscription: NonNullable<CompanyUsage['subscription']> }) {
  if (subscription.status === 'past_due') {
    return (
      <div className="org-banner org-banner-error" role="alert">
        Your subscription is past due. Ask your administrator to bring it up to date.
      </div>
    )
  }
  if (subscription.status === 'trialing') {
    const left = daysUntil(subscription.trial_ends_at)
    const when = subscription.trial_ends_at ? `Your trial ends on ${fmtDay(subscription.trial_ends_at)}` : 'Your workspace is on a trial'
    const days = left === null ? '' : left < 0 ? ', which has passed' : left === 0 ? ', today' : `, in ${left} ${left === 1 ? 'day' : 'days'}`
    const urgent = left !== null && left <= 3
    return (
      <div className={`org-banner${urgent ? ' org-banner-warning' : ''}`} role={urgent ? 'alert' : 'status'}>
        {when}{days}.
      </div>
    )
  }
  return null
}

const SUBSCRIPTION_LABEL: Record<string, string> = {
  trialing: 'Trial', active: 'Active', past_due: 'Past due', canceled: 'Canceled',
}

function PlanUsageCard() {
  const [usage, setUsage] = useState<CompanyUsage | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  async function load() {
    setLoading(true)
    setFailed(false)
    try {
      const r = await companySettingsApi.usage()
      setUsage(r.data)
    } catch {
      setUsage(null)
      setFailed(true)
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const users = usage?.users
  const ai = usage?.ai
  const userShare = users ? shareOf(users.used, users.limit) : null
  const aiShare = ai ? (ai.percent ?? shareOf(ai.used_usd, ai.budget_usd)) : null
  const storage = usage?.storage
  const storageShare = storage ? shareOf(storage.used_mb, storage.limit_mb) : null
  const subscription = usage?.subscription
  const subscriptionLabel = subscription ? SUBSCRIPTION_LABEL[subscription.status] : undefined

  return (
    <section className="org-section">
      <div className="org-card card">
        <div className="card-header">
          <span className="card-title">Plan and usage</span>
          <span className="org-plan-chips">
            {usage?.plan?.name && <span className="org-plan-name">{usage.plan.name}</span>}
            {subscriptionLabel && <span className="org-plan-status">{subscriptionLabel}</span>}
          </span>
        </div>
        {loading ? (
          <div className="org-loading">Loading…</div>
        ) : failed || !usage || !users || !ai ? (
          <LoadFailed message="Could not load plan and usage." onRetry={load} />
        ) : (
          <>
          {subscription && <SubscriptionNotice subscription={subscription} />}
          <ul className="org-plan-usage">
            <li className="org-usage-row">
              <div className="org-usage-top">
                <span className="org-usage-label">Users</span>
                {users.limit === null ? (
                  <span className="org-usage-value">{users.used.toLocaleString()} <span className="org-usage-limit">Unlimited</span></span>
                ) : (
                  <span className="org-usage-value">{users.used.toLocaleString()} of {users.limit.toLocaleString()}</span>
                )}
              </div>
              {userShare !== null && <UsageMeter label="Users used" percent={userShare} />}
            </li>
            <li className="org-usage-row">
              <div className="org-usage-top">
                <span className="org-usage-label">AI spend, {monthName(ai.month)}</span>
                {ai.budget_usd === null ? (
                  <span className="org-usage-value">{usd(ai.used_usd)} <span className="org-usage-limit">Unlimited</span></span>
                ) : (
                  <span className="org-usage-value">{usd(ai.used_usd)} of {usd(ai.budget_usd)}</span>
                )}
              </div>
              {aiShare !== null && <UsageMeter label="AI budget used" percent={aiShare} />}
            </li>
            {storage && (
              <li className="org-usage-row">
                <div className="org-usage-top">
                  <span className="org-usage-label">Storage</span>
                  {storage.limit_mb === null ? (
                    <span className="org-usage-value">{fmtMb(storage.used_mb)} MB <span className="org-usage-limit">Unlimited</span></span>
                  ) : (
                    <span className="org-usage-value">{fmtMb(storage.used_mb)} MB of {fmtMb(storage.limit_mb)} MB</span>
                  )}
                </div>
                {storageShare !== null && <UsageMeter label="Storage used" percent={storageShare} />}
              </li>
            )}
            {typeof usage.emails_30d === 'number' && (
              <li className="org-usage-row">
                <div className="org-usage-top">
                  <span className="org-usage-label">Emails, last 30 days</span>
                  <span className="org-usage-value">{usage.emails_30d.toLocaleString()}</span>
                </div>
              </li>
            )}
          </ul>
          </>
        )}
      </div>
    </section>
  )
}

function CompanyTab({ showToast }: { showToast: ShowToast }) {
  const [profile, setProfile] = useState<CompanyProfile>(emptyProfile())
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [legalError, setLegalError] = useState('')
  const [legalChecked, setLegalChecked] = useState(false)

  const [status, setStatus] = useState<IntegrationsStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(true)

  useEffect(() => { load(); loadStatus() }, [])

  async function load() {
    setLoading(true)
    setLoadError('')
    try {
      const r = await companySettingsApi.get()
      setProfile({ ...emptyProfile(), ...r.data })
    } catch (e) {
      setLoadError(errorMessage(e, 'Could not load the company settings.'))
    }
    setLoading(false)
  }

  async function loadStatus() {
    setStatusLoading(true)
    setStatus(null)
    try {
      const r = await companySettingsApi.integrationsStatus()
      setStatus(r.data && typeof r.data === 'object' ? r.data : null)
    } catch { }
    setStatusLoading(false)
  }

  function setField(field: keyof CompanyProfile, value: string) {
    setProfile(p => ({ ...p, [field]: value }))
    if (field === 'terms_url' || field === 'privacy_url') setLegalError('')
  }

  const termsError = legalChecked ? legalLinkError(profile.terms_url, 'The terms link') : ''
  const privacyError = legalChecked ? legalLinkError(profile.privacy_url, 'The privacy link') : ''

  async function handleSave() {
    if (loadError) return
    setLegalChecked(true)
    if (legalLinkError(profile.terms_url, 'The terms link') || legalLinkError(profile.privacy_url, 'The privacy link')) return
    setSaving(true)
    setLegalError('')
    try {
      const { company_name, industry, size, website, address, primary_contact_email, terms_url, privacy_url } = profile
      const r = await companySettingsApi.update({
        company_name, industry, size, website, address, primary_contact_email,
        terms_url: terms_url.trim(), privacy_url: privacy_url.trim(),
      })
      setProfile({ ...emptyProfile(), ...r.data })
      setLegalChecked(false)
      showToast('Company settings saved')
    } catch (e) {
      const message = errorMessage(e, 'Failed to save company settings')
      if (statusOf(e) === 400) setLegalError(message)
      showToast(message)
    }
    setSaving(false)
  }

  return (
    <>
      <PlanUsageCard />

      <section className="org-section">
        <div className="org-card card">
          <div className="card-header">
            <span className="card-title">Company Profile</span>
          </div>
          {loading ? (
            <div className="org-loading">Loading…</div>
          ) : loadError ? (
            <div className="org-form">
              <LoadFailed message={loadError} onRetry={load} />
              <div className="org-form-footer">
                <button className="btn btn-primary" disabled>Save Changes</button>
              </div>
            </div>
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
                <div className="org-field">
                  <label className="form-label" htmlFor="company-terms-url">Terms link</label>
                  <input id="company-terms-url" className="form-input" type="url" value={profile.terms_url}
                    onChange={e => setField('terms_url', e.target.value)}
                    placeholder="https://example.com/terms" aria-invalid={!!termsError || undefined} />
                  {termsError
                    ? <span className="org-field-error" role="alert">{termsError}</span>
                    : <span className="org-hint">Shown to candidates as Terms. Must start with https://</span>}
                </div>
                <div className="org-field">
                  <label className="form-label" htmlFor="company-privacy-url">Privacy link</label>
                  <input id="company-privacy-url" className="form-input" type="url" value={profile.privacy_url}
                    onChange={e => setField('privacy_url', e.target.value)}
                    placeholder="https://example.com/privacy" aria-invalid={!!privacyError || undefined} />
                  {privacyError
                    ? <span className="org-field-error" role="alert">{privacyError}</span>
                    : <span className="org-hint">Shown to candidates as Privacy. Must start with https://</span>}
                </div>
                {legalError && <span className="org-field-error org-field-wide" role="alert">{legalError}</span>}
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
            <LoadFailed message="Could not load integrations status." onRetry={loadStatus} />
          ) : (
            <div className="org-status-body">
              {integrationGroups(status).map((group, i) => (
                <Fragment key={group.key}>
                  <div className={`org-status-group-title${i > 0 ? ' org-status-group-title-spaced' : ''}`}>{group.title}</div>
                  <div className="org-status-grid">
                    {group.items.map((item, j) => {
                      const badge = integrationBadge(item)
                      return (
                        <div key={item.id ?? `${group.key}-${j}`} className="org-status-row">
                          <span className="org-status-label">
                            {item.label ?? item.id}
                            {item.requires_key === false && <span className="org-free-tag">Free</span>}
                          </span>
                          <span className={`badge ${badge.cls}`}>{badge.label}</span>
                        </div>
                      )
                    })}
                  </div>
                </Fragment>
              ))}
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
  letterhead_header_text: string
  letterhead_footer_text: string
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

const LOGO_MAX_BYTES = 1_000_000

const DEFAULT_BRANDING: BrandingSettings = {
  company_logo_url: '',
  primary_color: '#4778f3',
  accent_color: '#222022',
  letterhead_header_text: '',
  letterhead_footer_text: '',
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/

interface LetterheadTemplate {
  filename: string | null
  header_text: string
  footer_text: string
  has_logo: boolean
  body_paragraph_count: number
}

const EMPTY_LETTERHEAD_TEMPLATE: LetterheadTemplate = {
  filename: null, header_text: '', footer_text: '', has_logo: false, body_paragraph_count: 0,
}

interface NotificationTestResult {
  sent: boolean
  to: string | null
  detail: string
}

function BrandingTab({ showToast }: { showToast: ShowToast }) {
  const [branding, setBranding] = useState<BrandingSettings>(DEFAULT_BRANDING)
  const [brandingLoading, setBrandingLoading] = useState(true)
  const [brandingError, setBrandingError] = useState('')
  const [brandingSaving, setBrandingSaving] = useState(false)

  const [notif, setNotif] = useState<NotificationSettings>({ notify_email: '', events: [] })
  const [notifLoading, setNotifLoading] = useState(true)
  const [notifError, setNotifError] = useState('')
  const [notifSaving, setNotifSaving] = useState(false)
  const [savedEmail, setSavedEmail] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<NotificationTestResult | null>(null)

  const [letterheadTemplate, setLetterheadTemplate] = useState<LetterheadTemplate>(EMPTY_LETTERHEAD_TEMPLATE)
  const [letterheadLoading, setLetterheadLoading] = useState(true)
  const [letterheadUploading, setLetterheadUploading] = useState(false)
  const [letterheadBlocked, setLetterheadBlocked] = useState(false)
  const letterheadInputRef = useRef<HTMLInputElement>(null)
  const logoInputRef = useRef<HTMLInputElement>(null)
  const [logoBusy, setLogoBusy] = useState(false)

  useEffect(() => { loadBranding(); loadNotifications(); loadLetterheadTemplate() }, [])

  async function loadBranding() {
    setBrandingLoading(true)
    setBrandingError('')
    try {
      const r = await brandingApi.get()
      setBranding({ ...DEFAULT_BRANDING, ...r.data })
    } catch (e) {
      setBrandingError(errorMessage(e, 'Could not load the branding settings.'))
    }
    setBrandingLoading(false)
  }

  async function loadNotifications() {
    setNotifLoading(true)
    setNotifError('')
    try {
      const r = await notificationSettingsApi.get()
      setNotif({
        notify_email: r.data.notify_email || '',
        events: r.data.events || [],
        updated_at: r.data.updated_at,
      })
      setSavedEmail(r.data.notify_email || '')
    } catch (e) {
      setNotifError(errorMessage(e, 'Could not load the notification settings.'))
    }
    setNotifLoading(false)
  }

  async function loadLetterheadTemplate() {
    setLetterheadLoading(true)
    setLetterheadBlocked(false)
    try {
      const r = await offersApi.getLetterheadTemplate()
      setLetterheadTemplate({ ...EMPTY_LETTERHEAD_TEMPLATE, ...r.data })
    } catch (e) {
      if (statusOf(e) === 403) setLetterheadBlocked(true)
    }
    setLetterheadLoading(false)
  }

  async function handleLetterheadUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.docx')) {
      showToast('Only .docx files are supported for the letterhead template')
      return
    }
    setLetterheadUploading(true)
    try {
      const r = await offersApi.uploadLetterheadTemplate(file)
      setLetterheadTemplate({ ...EMPTY_LETTERHEAD_TEMPLATE, ...r.data })
      showToast('Letterhead template uploaded')
    } catch (e) {
      showToast(errorMessage(e, 'Failed to upload letterhead template'))
    }
    setLetterheadUploading(false)
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!/^image\/(png|jpeg)$/.test(file.type) && !/\.(png|jpe?g)$/i.test(file.name)) {
      showToast('The logo must be a PNG or JPEG image')
      return
    }
    if (file.size > LOGO_MAX_BYTES) {
      showToast('The logo is larger than 1 MB. Use a smaller image')
      return
    }
    setLogoBusy(true)
    try {
      const r = await brandingApi.uploadLogo(file)
      setBranding(b => ({ ...b, company_logo_url: r.data?.company_logo_url ?? '' }))
      showToast('Logo uploaded')
    } catch (err) {
      showToast(errorMessage(err, 'Failed to upload the logo'))
    }
    setLogoBusy(false)
  }

  async function removeLogo() {
    setLogoBusy(true)
    try {
      await brandingApi.removeLogo()
      setBranding(b => ({ ...b, company_logo_url: '' }))
      showToast('Logo removed')
    } catch (err) {
      showToast(errorMessage(err, 'Failed to remove the logo'))
    }
    setLogoBusy(false)
  }

  async function saveBranding() {
    if (brandingError) return
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
        letterhead_header_text: branding.letterhead_header_text,
        letterhead_footer_text: branding.letterhead_footer_text,
      })
      setBranding({ ...DEFAULT_BRANDING, ...r.data })
      showToast('Branding saved. Reload other open tabs to see it applied there too')
    } catch (e) {
      showToast(errorMessage(e, 'Failed to save branding'))
    }
    setBrandingSaving(false)
  }

  function resetToDefaults() {
    if (brandingError) return
    if (!confirm('Reset branding to the defaults?')) return
    setBranding(b => ({ ...b, ...DEFAULT_BRANDING }))
  }

  function toggleEvent(event: string) {
    setNotif(n => ({
      ...n,
      events: n.events.map(e => (e.event === event ? { ...e, enabled: !e.enabled } : e)),
    }))
  }

  async function saveNotifications() {
    if (notifError) return
    setNotifSaving(true)
    try {
      const eventsMap = Object.fromEntries(notif.events.map(e => [e.event, e.enabled]))
      const r = await notificationSettingsApi.update({ notify_email: notif.notify_email, events: eventsMap })
      setNotif({
        notify_email: r.data.notify_email || '',
        events: r.data.events || [],
        updated_at: r.data.updated_at,
      })
      setSavedEmail(r.data.notify_email || '')
      showToast('Notification settings saved')
    } catch (e) {
      showToast(errorMessage(e, 'Failed to save notification settings'))
    }
    setNotifSaving(false)
  }

  async function sendTestNotification() {
    setTesting(true)
    setTestResult(null)
    try {
      const r = await notificationSettingsApi.test()
      setTestResult({
        sent: r.data?.sent === true,
        to: r.data?.to ?? null,
        detail: typeof r.data?.detail === 'string' ? r.data.detail : '',
      })
    } catch (e) {
      setTestResult({ sent: false, to: null, detail: errorMessage(e, 'The test notification could not be sent.') })
    }
    setTesting(false)
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
          ) : brandingError ? (
            <div className="org-form">
              <LoadFailed message={brandingError} onRetry={loadBranding} />
              <div className="org-form-footer">
                <div className="org-form-actions">
                  <button className="btn btn-ghost" disabled>Reset to Defaults</button>
                  <button className="btn btn-primary" disabled>Save Branding</button>
                </div>
              </div>
            </div>
          ) : (
            <div className="org-form">
              <div className="org-brand-grid">
                <div className="org-brand-fields">
                  <div className="org-field">
                    <span className="form-label">Company Logo</span>
                    <div className="org-logo-row">
                      <input
                        ref={logoInputRef}
                        type="file"
                        accept="image/png,image/jpeg"
                        className="org-logo-file"
                        aria-label="Logo file"
                        onChange={handleLogoUpload}
                      />
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => logoInputRef.current?.click()} disabled={logoBusy}>
                        {logoBusy ? 'Working…' : 'Upload logo'}
                      </button>
                      {branding.company_logo_url && (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={removeLogo} disabled={logoBusy}>
                          Remove logo
                        </button>
                      )}
                    </div>
                    <span className="org-hint">PNG or JPEG, up to 1 MB. Leave empty to keep the default Hirely mark</span>
                  </div>

                  <label className="org-field">
                    <span className="form-label">Or use a link to a logo</span>
                    <input className="form-input" value={isUploadedLogo(branding.company_logo_url) ? '' : branding.company_logo_url}
                      onChange={e => setBranding(b => ({ ...b, company_logo_url: e.target.value }))}
                      placeholder={isUploadedLogo(branding.company_logo_url) ? 'Using the uploaded logo' : 'https://example.com/logo.png'} />
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

                  <label className="org-field">
                    <span className="form-label">Offer Letterhead Header</span>
                    <input className="form-input" value={branding.letterhead_header_text}
                      onChange={e => setBranding(b => ({ ...b, letterhead_header_text: e.target.value }))}
                      placeholder="e.g. Acme Bank Ltd., 123 Main St, Suite 400" />
                    <span className="org-hint">Printed at the top of generated offer-letter PDFs</span>
                  </label>

                  <label className="org-field">
                    <span className="form-label">Offer Letterhead Footer</span>
                    <input className="form-input" value={branding.letterhead_footer_text}
                      onChange={e => setBranding(b => ({ ...b, letterhead_footer_text: e.target.value }))}
                      placeholder="e.g. Confidential: for the named recipient only" />
                    <span className="org-hint">Printed at the bottom of generated offer-letter PDFs</span>
                  </label>
                </div>

                <div className="org-preview">
                  <div className="org-preview-label">Live Preview</div>
                  <div className="org-preview-card">
                    {branding.company_logo_url ? (
                      <img
                        src={resolveLogoUrl(branding.company_logo_url)}
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

              <div className="org-letterhead-docx">
                <div className="org-letterhead-docx-header">
                  <span className="form-label">Offer Letterhead Template (.docx)</span>
                  {letterheadTemplate.filename && <span className="badge badge-green">Active</span>}
                </div>
                <p className="org-hint">
                  Upload a Word document to use as the offer-letter letterhead: its header/footer text and
                  embedded logo are extracted automatically. <strong>When a template is uploaded, it takes
                  priority over the plain-text header/footer fields above</strong> for every generated
                  offer-letter PDF.
                </p>

                {letterheadBlocked ? (
                  <p className="org-note">
                    Managing the letterhead template requires the "offers:manage_letterhead" permission.
                  </p>
                ) : letterheadLoading ? (
                  <div className="org-loading">Loading…</div>
                ) : (
                  <>
                    <button
                      type="button"
                      className="btn btn-ghost org-letterhead-upload-btn"
                      onClick={() => letterheadInputRef.current?.click()}
                      disabled={letterheadUploading}
                    >
                      {letterheadUploading ? 'Uploading…' : letterheadTemplate.filename ? 'Replace Template' : 'Upload .docx Template'}
                    </button>
                    <input
                      ref={letterheadInputRef}
                      type="file"
                      accept=".docx"
                      hidden
                      onChange={handleLetterheadUpload}
                    />

                    {letterheadTemplate.filename ? (
                      <div className="org-letterhead-preview">
                        <div className="org-letterhead-preview-row">
                          <span className="org-letterhead-preview-label">File</span>
                          <span className="org-letterhead-preview-value">{letterheadTemplate.filename}</span>
                        </div>
                        <div className="org-letterhead-preview-row">
                          <span className="org-letterhead-preview-label">Logo</span>
                          <span className={`badge ${letterheadTemplate.has_logo ? 'badge-green' : 'badge-gray'}`}>
                            {letterheadTemplate.has_logo ? 'Logo found' : 'No logo found'}
                          </span>
                        </div>
                        <div className="org-letterhead-preview-row">
                          <span className="org-letterhead-preview-label">Body placeholders</span>
                          <span className="org-letterhead-preview-value">
                            {letterheadTemplate.body_paragraph_count} paragraph{letterheadTemplate.body_paragraph_count === 1 ? '' : 's'}
                          </span>
                        </div>
                        {letterheadTemplate.header_text && (
                          <div className="org-letterhead-preview-row org-letterhead-preview-row-wide">
                            <span className="org-letterhead-preview-label">Header</span>
                            <span className="org-letterhead-preview-pre">{letterheadTemplate.header_text}</span>
                          </div>
                        )}
                        {letterheadTemplate.footer_text && (
                          <div className="org-letterhead-preview-row org-letterhead-preview-row-wide">
                            <span className="org-letterhead-preview-label">Footer</span>
                            <span className="org-letterhead-preview-pre">{letterheadTemplate.footer_text}</span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="org-hint">No template uploaded yet: the plain-text fields above are used instead.</p>
                    )}
                  </>
                )}
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
          ) : notifError ? (
            <div className="org-form">
              <LoadFailed message={notifError} onRetry={loadNotifications} />
              <div className="org-form-footer">
                <div className="org-form-actions">
                  <button className="btn btn-ghost" disabled>Send test notification</button>
                  <button className="btn btn-primary" disabled>Save Notification Settings</button>
                </div>
              </div>
            </div>
          ) : (
            <div className="org-form">
              <label className="org-field org-field-wide">
                <span className="form-label">Notify Email</span>
                <input className="form-input" type="email" value={notif.notify_email}
                  onChange={e => setNotif(n => ({ ...n, notify_email: e.target.value }))}
                  placeholder="alerts@example.com" />
                <span className="org-hint">Where event notifications are sent</span>
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
                <div className="org-form-actions">
                  <button
                    className="btn btn-ghost"
                    onClick={sendTestNotification}
                    disabled={testing || notifSaving || notif.notify_email.trim() !== savedEmail.trim()}
                    title={notif.notify_email.trim() !== savedEmail.trim() ? 'Save the notify email first' : undefined}
                  >
                    {testing ? 'Sending…' : 'Send test notification'}
                  </button>
                  <button className="btn btn-primary" onClick={saveNotifications} disabled={notifSaving}>
                    {notifSaving ? 'Saving…' : 'Save Notification Settings'}
                  </button>
                </div>
              </div>

              {testResult && (
                <div className="org-test-result" role="status">
                  <span className={`badge ${testResult.sent ? 'badge-green' : 'badge-red'}`}>
                    {testResult.sent ? 'Sent' : 'Failed'}
                  </span>
                  <span>{[testResult.to, testResult.detail].filter(Boolean).join(': ')}</span>
                </div>
              )}
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

interface JobGrade {
  job_grade_id: string
  name: string
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
  const [grades, setGrades] = useState<JobGrade[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [deptModal, setDeptModal] = useState<'create' | 'edit' | null>(null)
  const [deptSelected, setDeptSelected] = useState<Department | null>(null)
  const [deptForm, setDeptForm] = useState({ name: '', description: '' })

  const [desigModal, setDesigModal] = useState<'create' | 'edit' | null>(null)
  const [desigSelected, setDesigSelected] = useState<Designation | null>(null)
  const [desigForm, setDesigForm] = useState({ name: '', department: '', description: '' })

  const [gradeModal, setGradeModal] = useState<'create' | 'edit' | null>(null)
  const [gradeSelected, setGradeSelected] = useState<JobGrade | null>(null)
  const [gradeForm, setGradeForm] = useState({ name: '', description: '' })

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const [d, r] = await Promise.all([adminConfigApi.listDepartments(), adminConfigApi.listDesignations()])
      setDepartments(d.data.departments ?? [])
      setDesignations(r.data.designations ?? [])
    } catch { }
    try {
      const g = await jobGradesApi.list()
      setGrades(g.data.job_grades ?? g.data.grades ?? [])
    } catch { }
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
          ? `Department updated, ${renamed} designation${renamed === 1 ? '' : 's'} re-pointed`
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
        ? `Department deleted, ${detached} designation${detached === 1 ? '' : 's'} detached`
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

  function openCreateGrade() {
    setGradeForm({ name: '', description: '' })
    setGradeSelected(null)
    setGradeModal('create')
  }

  function openEditGrade(g: JobGrade) {
    setGradeSelected(g)
    setGradeForm({ name: g.name, description: g.description || '' })
    setGradeModal('edit')
  }

  async function saveGrade() {
    setSaving(true)
    try {
      if (gradeModal === 'create') {
        await jobGradesApi.create({ name: gradeForm.name, description: gradeForm.description || undefined })
        showToast('Job grade created')
      } else if (gradeSelected) {
        await jobGradesApi.update(gradeSelected.job_grade_id, { name: gradeForm.name, description: gradeForm.description })
        showToast('Job grade updated')
      }
      setGradeModal(null); load()
    } catch (e) {
      showToast(errorMessage(e, 'Failed to save job grade'))
    }
    setSaving(false)
  }

  async function deleteGrade(g: JobGrade) {
    if (!confirm(`Delete job grade "${g.name}"?`)) return
    try {
      await jobGradesApi.delete(g.job_grade_id)
      showToast('Job grade deleted')
      load()
    } catch (e) { showToast(errorMessage(e, 'Failed to delete job grade')) }
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

          <div className="org-table-card card">
            <div className="card-header">
              <span className="card-title">Job Grades</span>
              <button className="btn btn-primary" onClick={openCreateGrade}>+ Add Job Grade</button>
            </div>
            {loading ? (
              <div className="org-loading">Loading…</div>
            ) : (
              <table className="org-table">
                <thead><tr><th>Name</th><th>Description</th><th></th></tr></thead>
                <tbody>
                  {grades.length === 0 ? (
                    <tr><td colSpan={3} className="org-empty">No job grades yet.</td></tr>
                  ) : grades.map(g => (
                    <tr key={g.job_grade_id}>
                      <td className="org-name" data-label="Name">{g.name}</td>
                      <td className="org-muted" data-label="Description">{g.description || '-'}</td>
                      <td data-label="Actions">
                        <div className="org-actions">
                          <button className="org-action-btn" onClick={() => openEditGrade(g)}>Edit</button>
                          <button className="org-action-btn org-action-delete" onClick={() => deleteGrade(g)}>Delete</button>
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
              <h2>{deptModal === 'create' ? 'Add Department' : `Edit, ${deptSelected?.name}`}</h2>
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
              <h2>{desigModal === 'create' ? 'Add Designation' : `Edit, ${desigSelected?.name}`}</h2>
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
                  <option value="">None</option>
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

      {gradeModal && (
        <div className="modal-overlay" onClick={() => setGradeModal(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{gradeModal === 'create' ? 'Add Job Grade' : `Edit, ${gradeSelected?.name}`}</h2>
              <button className="modal-close" onClick={() => setGradeModal(null)}>✕</button>
            </div>
            <div className="org-modal-form">
              <label className="org-field">
                <span className="form-label">Name *</span>
                <input className="form-input" value={gradeForm.name}
                  onChange={e => setGradeForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Grade 5, AVP, VP" />
              </label>
              <label className="org-field">
                <span className="form-label">Description</span>
                <input className="form-input" value={gradeForm.description}
                  onChange={e => setGradeForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Optional" />
              </label>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setGradeModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveGrade} disabled={saving || !gradeForm.name.trim()}>
                {saving ? 'Saving…' : gradeModal === 'create' ? 'Create' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

const TABS = ['company', 'branding', 'departments', 'email', 'signin', 'integrations', 'data'] as const
type Tab = typeof TABS[number]

const TAB_LABELS: Record<Tab, string> = {
  company: 'Company Profile',
  branding: 'Branding & Notifications',
  departments: 'Departments, Designations & Grades',
  email: 'Email',
  signin: 'Sign-in',
  integrations: 'Integrations',
  data: 'Data',
}

const SUPERADMIN_TABS: readonly Tab[] = ['email', 'signin', 'integrations', 'data']

export default function OrganizationPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const isSuperAdmin = useAuthStore(s => s.user?.role) === 'superadmin'
  const visibleTabs = TABS.filter(t => isSuperAdmin || !SUPERADMIN_TABS.includes(t))
  const rawTab = searchParams.get('tab')
  const tab: Tab = visibleTabs.find(t => t === rawTab) ?? 'company'

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
        </div>
      </div>

      <div className="adm-tabs" role="tablist">
        {visibleTabs.map(t => (
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
      {tab === 'email' && <MailPanel showToast={showToast} />}
      {tab === 'signin' && <SignInPanel showToast={showToast} />}
      {tab === 'integrations' && <IntegrationsPanel />}
      {tab === 'data' && <DataPanel showToast={showToast} />}
    </div>
  )
}
