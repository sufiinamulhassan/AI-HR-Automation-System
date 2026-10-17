import { useEffect, useState } from 'react'
import { platformApi } from '../../lib/api'
import type { CompanyDomains } from '../../lib/platformTypes'
import { Field, Modal } from './PlatformUi'
import { firstBadDomain, parseDomains } from './clientForms'
import { errorDetail } from './format'

export const MAX_CUSTOM_DOMAINS = 5

function DomainsDialog({ companyId, companyName, current, onClose, onDone }: {
  companyId: string
  companyName: string
  current: string[]
  onClose: () => void
  onDone: (domains: string[]) => void
}) {
  const [text, setText] = useState(current.join('\n'))
  const [error, setError] = useState('')
  const [failure, setFailure] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    const domains = parseDomains(text)
    const bad = firstBadDomain(domains)
    if (bad) {
      setError(`${bad} is not a valid hostname.`)
      return
    }
    if (domains.length > MAX_CUSTOM_DOMAINS) {
      setError(`Use at most ${MAX_CUSTOM_DOMAINS} domains.`)
      return
    }
    setError('')
    setFailure('')
    setBusy(true)
    try {
      const r = await platformApi.setDomains(companyId, domains)
      onDone(Array.isArray(r.data?.domains) ? r.data.domains : domains)
    } catch (e) {
      setFailure(errorDetail(e, 'Could not save the domains.'))
      setBusy(false)
    }
  }

  return (
    <Modal
      title={`Custom domains for ${companyName}`}
      onClose={busy ? () => {} : onClose}
      onSubmit={e => { e.preventDefault(); if (!busy) void submit() }}
      footer={
        <>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>{busy ? 'Saving…' : 'Save domains'}</button>
        </>
      }
    >
      <Field
        label="Domains"
        hint={`One hostname per line, up to ${MAX_CUSTOM_DOMAINS}. The first is used in the links emailed for this company. A hostname can belong to one company only.`}
        error={error}
      >
        <textarea className="form-input" rows={5} value={text} onChange={e => setText(e.target.value)} placeholder="careers.example.com" />
      </Field>
      {failure && <div className="pco-form-error" role="alert">{failure}</div>}
    </Modal>
  )
}

export default function CustomDomainsCard({ companyId, companyName, onSaved }: {
  companyId: string
  companyName: string
  onSaved: (message: string) => void
}) {
  const [data, setData] = useState<CompanyDomains | null>(null)
  const [loading, setLoading] = useState(true)
  const [failure, setFailure] = useState('')
  const [editing, setEditing] = useState(false)
  const [round, setRound] = useState(0)

  useEffect(() => {
    let current = true
    async function load() {
      setLoading(true)
      setFailure('')
      try {
        const r = await platformApi.getDomains(companyId)
        if (current) setData(r.data)
      } catch (e) {
        if (current) setFailure(errorDetail(e, 'Could not load the custom domains.'))
      }
      if (current) setLoading(false)
    }
    void load()
    return () => { current = false }
  }, [companyId, round])

  const planAllows = data?.plan_allows !== false
  const domains = data?.domains ?? []

  return (
    <section className="pco-card" aria-labelledby="pco-co-domains">
      <div className="pco-card-head">
        <h2 className="pco-card-title" id="pco-co-domains">Custom domains</h2>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={!data || !planAllows}
          title={data && !planAllows ? 'This plan does not include custom domains.' : undefined}
          onClick={() => setEditing(true)}
        >
          Edit custom domains
        </button>
      </div>

      {loading && !data && <div className="pco-state" role="status">Loading…</div>}
      {failure && (
        <div className="pco-state pco-state-error" role="alert">
          <span>{failure}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRound(n => n + 1)}>Retry</button>
        </div>
      )}
      {data && !planAllows && (
        <div className="pco-hint" role="status">This plan does not include custom domains.</div>
      )}
      {data && (domains.length === 0
        ? <div className="pco-state pco-state-empty">No custom domain is set.</div>
        : <ul className="pco-domains">{domains.map(d => <li key={d} className="pco-chip">{d}</li>)}</ul>)}

      {editing && (
        <DomainsDialog
          companyId={companyId}
          companyName={companyName}
          current={domains}
          onClose={() => setEditing(false)}
          onDone={saved => {
            setEditing(false)
            setData(d => ({ company_id: companyId, plan_allows: d?.plan_allows, domains: saved }))
            onSaved(`Custom domains saved for ${companyName}`)
          }}
        />
      )}
    </section>
  )
}
