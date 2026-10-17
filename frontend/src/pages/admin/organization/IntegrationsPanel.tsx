import { useEffect, useState } from 'react'
import {
  companySettingsApi, type CompanyIntegrations, type IntegrationInput, type IntegrationName, type IntegrationSource,
} from '../../../lib/api'
import { errorText, statusOf } from './helpers'
import PlanGate, { PlanBlocked } from './PlanGate'
import SecretField from './SecretField'
import './OrgPanels.css'

const TITLE = 'Integrations'

interface FieldDef {
  key: string
  label: string
  type?: 'text' | 'url' | 'email'
  placeholder?: string
}

interface CardDef {
  name: IntegrationName
  title: string
  fields: FieldDef[]
  secret: { key: string; has: string; noun: string }
  toggle?: { key: string; label: string }
}

const CARDS: CardDef[] = [
  {
    name: 'hrms',
    title: 'HR system',
    fields: [
      { key: 'url', label: 'Endpoint URL', type: 'url', placeholder: 'https://hr.example.com/api/candidates' },
      { key: 'auth_header', label: 'Authorization header', placeholder: 'Authorization' },
    ],
    secret: { key: 'auth_token', has: 'has_auth_token', noun: 'Token' },
    toggle: { key: 'auto_push_on_hire', label: 'Send the candidate when they are hired' },
  },
  {
    name: 'zoom',
    title: 'Zoom',
    fields: [
      { key: 'account_id', label: 'Account ID' },
      { key: 'client_id', label: 'Client ID' },
    ],
    secret: { key: 'client_secret', has: 'has_client_secret', noun: 'Client secret' },
  },
  {
    name: 'teams',
    title: 'Microsoft Teams',
    fields: [
      { key: 'tenant_id', label: 'Tenant ID' },
      { key: 'client_id', label: 'Client ID' },
      { key: 'organizer', label: 'Organizer', type: 'email', placeholder: 'recruiting@example.com' },
    ],
    secret: { key: 'client_secret', has: 'has_client_secret', noun: 'Client secret' },
  },
]

type View = Record<string, unknown> & { configured: boolean; source: IntegrationSource }

function textOf(view: View, key: string): string {
  const v = view[key]
  return typeof v === 'string' ? v : ''
}

function IntegrationCard({ def, view, onSaved, onBlocked }: {
  def: CardDef
  view: View
  onSaved: (view: View) => void
  onBlocked: (message: string) => void
}) {
  const initial = () => Object.fromEntries(def.fields.map(f => [f.key, textOf(view, f.key)])) as Record<string, string>
  const [values, setValues] = useState<Record<string, string>>(initial)
  const [on, setOn] = useState(def.toggle ? view[def.toggle.key] === true : false)
  const [secret, setSecret] = useState('')
  const [removed, setRemoved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [secretRound, setSecretRound] = useState(0)

  const hasSecret = view[def.secret.has] === true
  const was = initial()

  const changed: IntegrationInput = {}
  for (const f of def.fields) if (values[f.key].trim() !== was[f.key]) changed[f.key] = values[f.key].trim()
  if (def.toggle && on !== (view[def.toggle.key] === true)) changed[def.toggle.key] = on
  if (secret) changed[def.secret.key] = secret
  else if (removed) changed.clear_secret = true
  const dirty = Object.keys(changed).length > 0

  async function save() {
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      const r = await companySettingsApi.updateIntegration(def.name, changed)
      const next = r.data as unknown as View
      onSaved(next)
      setValues(Object.fromEntries(def.fields.map(f => [f.key, textOf(next, f.key)])) as Record<string, string>)
      if (def.toggle) setOn(next[def.toggle.key] === true)
      setSecret('')
      setRemoved(false)
      setSecretRound(n => n + 1)
      setSaved(true)
    } catch (e) {
      if (statusOf(e) === 402) onBlocked(errorText(e, 'Your plan does not include integrations.'))
      else setError(errorText(e, `Could not save ${def.title}.`))
    }
    setSaving(false)
  }

  return (
    <div className="org-card card org-integration">
      <div className="card-header">
        <span className="card-title">{def.title}</span>
        {view.source === 'platform' ? (
          <span className="badge badge-blue">Using the platform&apos;s account</span>
        ) : (
          <span className={`badge ${view.configured ? 'badge-green' : 'badge-gray'}`}>{view.configured ? 'Configured' : 'Not configured'}</span>
        )}
      </div>
      <form className="org-form" onSubmit={e => { e.preventDefault(); if (dirty && !saving) void save() }}>
        {def.fields.map(f => (
          <label className="org-field" key={f.key}>
            <span className="form-label">{f.label}</span>
            <input
              className="form-input"
              type={f.type ?? 'text'}
              value={values[f.key]}
              placeholder={f.placeholder}
              autoComplete="off"
              onChange={e => { setValues(v => ({ ...v, [f.key]: e.target.value })); setSaved(false) }}
            />
          </label>
        ))}
        <SecretField
          key={secretRound}
          noun={def.secret.noun}
          saved={hasSecret}
          value={secret}
          onChange={v => { setSecret(v); setSaved(false) }}
          removed={removed}
          onRemovedChange={v => { setRemoved(v); setSaved(false) }}
          disabled={saving}
        />
        {def.toggle && (
          <label className="org-check">
            <input type="checkbox" checked={on} onChange={e => { setOn(e.target.checked); setSaved(false) }} />
            <span>{def.toggle.label}</span>
          </label>
        )}
        {error && <div className="org-result org-result-bad" role="alert">{error}</div>}
        <div className="org-form-footer">
          <span className="org-updated-at">
            {saved ? 'Saved' : view.updated_at ? `Last saved ${new Date(String(view.updated_at)).toLocaleString()}` : ''}
          </span>
          <button type="submit" className="btn btn-primary" disabled={saving || !dirty}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </form>
    </div>
  )
}

function IntegrationsForm() {
  const [views, setViews] = useState<CompanyIntegrations | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [blocked, setBlocked] = useState('')

  useEffect(() => { void load() }, [])

  async function load() {
    setLoading(true)
    setLoadError('')
    try {
      const r = await companySettingsApi.listIntegrations()
      setViews(r.data.integrations)
    } catch (e) {
      if (statusOf(e) === 402) setBlocked(errorText(e, 'Your plan does not include integrations.'))
      else setLoadError(errorText(e, 'Could not load the integrations.'))
    }
    setLoading(false)
  }

  if (blocked) return <PlanBlocked title={TITLE} sentence={blocked} />

  if (loading || loadError || !views) {
    return (
      <section className="org-section">
        <div className="org-card card">
          <div className="card-header"><span className="card-title">{TITLE}</span></div>
          {loading ? (
            <div className="org-loading">Loading…</div>
          ) : (
            <div className="org-error">
              <span role="alert">{loadError || 'Could not load the integrations.'}</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void load()}>Retry</button>
            </div>
          )}
        </div>
      </section>
    )
  }

  return (
    <div className="org-integrations">
      {CARDS.map(def => {
        const view = views[def.name] as unknown as View | undefined
        if (!view) return null
        return (
          <IntegrationCard
            key={def.name}
            def={def}
            view={view}
            onSaved={next => setViews(v => (v ? { ...v, [def.name]: next } as unknown as CompanyIntegrations : v))}
            onBlocked={setBlocked}
          />
        )
      })}
    </div>
  )
}

export default function IntegrationsPanel() {
  return (
    <PlanGate flag="integrations" title={TITLE}>
      <IntegrationsForm />
    </PlanGate>
  )
}
