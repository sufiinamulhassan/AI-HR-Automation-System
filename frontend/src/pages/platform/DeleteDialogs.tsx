import { useEffect, useRef, useState } from 'react'
import { platformApi } from '../../lib/api'
import type { ClientRow, CompanyRow } from '../../lib/platformTypes'
import { Field, Modal } from './PlatformUi'
import { errorDetail, fmtInt } from './format'

const MAX_ROUNDS = 200
const MAX_IDLE_ROUNDS = 3

const sum = (counts: Record<string, number> | undefined) =>
  Object.values(counts ?? {}).reduce((total, n) => total + (Number(n) || 0), 0)

function SlugConfirm({ slug, value, onChange, disabled }: {
  slug: string
  value: string
  onChange: (v: string) => void
  disabled: boolean
}) {
  return (
    <Field label={`Type ${slug} to confirm`}>
      <input
        className="form-input"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        value={value}
        disabled={disabled}
        onChange={e => onChange(e.target.value)}
      />
    </Field>
  )
}

function Footer({ busy, ready, label, busyLabel, onClose }: {
  busy: boolean
  ready: boolean
  label: string
  busyLabel: string
  onClose: () => void
}) {
  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>Cancel</button>
      <button type="submit" className="btn btn-danger btn-sm" disabled={busy || !ready}>{busy ? busyLabel : label}</button>
    </>
  )
}

export function DeleteCompanyDialog({ company, onClose, onDone }: {
  company: CompanyRow
  onClose: () => void
  onDone: (rowsDeleted: number) => void
}) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  const [removed, setRemoved] = useState(0)
  const [remaining, setRemaining] = useState<number | null>(null)
  const total = useRef(0)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  const ready = typed.trim() === company.slug

  async function remove() {
    setBusy(true)
    setFailure('')
    let rounds = 0
    let idle = 0
    try {
      for (;;) {
        const r = (await platformApi.deleteCompany(company.company_id, company.slug)).data
        const so_far = sum(r.deleted)
        const progressed = so_far > total.current
        total.current = Math.max(total.current, so_far)
        if (!alive.current) return
        setRemoved(total.current)
        setRemaining(typeof r.remaining === 'number' ? r.remaining : null)
        if (r.complete) {
          onDone(total.current)
          return
        }
        idle = progressed ? 0 : idle + 1
        rounds += 1
        if (idle >= MAX_IDLE_ROUNDS || rounds >= MAX_ROUNDS) {
          setFailure('The deletion stopped making progress. Try again in a moment.')
          setBusy(false)
          return
        }
      }
    } catch (e) {
      if (!alive.current) return
      setFailure(errorDetail(e, 'Could not delete the company.'))
      setBusy(false)
    }
  }

  const started = removed > 0 || remaining !== null

  return (
    <Modal
      title={`Delete ${company.name}?`}
      onClose={busy ? () => {} : onClose}
      onSubmit={e => { e.preventDefault(); if (!busy && ready) void remove() }}
      footer={
        <Footer
          busy={busy}
          ready={ready}
          label={started ? 'Continue deleting' : 'Delete company'}
          busyLabel="Deleting…"
          onClose={onClose}
        />
      }
    >
      <div className="pco-warning">
        This permanently deletes the company and everything in it: its users, jobs, résumés, candidates,
        interviews, offers, settings and search entries. It cannot be undone.
      </div>
      <SlugConfirm slug={company.slug} value={typed} onChange={setTyped} disabled={busy} />
      {(busy || started) && (
        <div className="pco-progress" role="status">
          {fmtInt(removed)} rows deleted
          {remaining !== null && `, ${fmtInt(remaining)} left`}
        </div>
      )}
      {failure && <div className="pco-form-error" role="alert">{failure}</div>}
    </Modal>
  )
}

export function DeleteClientDialog({ client, onClose, onDone }: {
  client: ClientRow
  onClose: () => void
  onDone: () => void
}) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')

  const ready = typed.trim() === client.slug

  async function remove() {
    setBusy(true)
    setFailure('')
    try {
      await platformApi.deleteClient(client.client_id, client.slug)
      onDone()
    } catch (e) {
      setFailure(errorDetail(e, 'Could not delete the client.'))
      setBusy(false)
    }
  }

  return (
    <Modal
      title={`Delete ${client.name}?`}
      onClose={busy ? () => {} : onClose}
      onSubmit={e => { e.preventDefault(); if (!busy && ready) void remove() }}
      footer={<Footer busy={busy} ready={ready} label="Delete client" busyLabel="Deleting…" onClose={onClose} />}
    >
      <div className="pco-warning">
        This permanently deletes the client and its plan and contact details. It cannot be undone.
      </div>
      <SlugConfirm slug={client.slug} value={typed} onChange={setTyped} disabled={busy} />
      {failure && <div className="pco-form-error" role="alert">{failure}</div>}
    </Modal>
  )
}
