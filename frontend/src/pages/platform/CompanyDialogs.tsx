import { useState } from 'react'
import { platformApi } from '../../lib/api'
import type { CompanyRow } from '../../lib/platformTypes'
import { Field, Modal, type ToastTone } from './PlatformUi'
import {
  EMPTY_NEW_COMPANY, buildAdminInput, buildNewCompanyInput, firstBadDomain, parseDomains, validateAdminForm,
  validateNewCompany, validatePassword, type AdminForm, type FormErrors, type NewCompanyForm,
} from './clientForms'
import { errorDetail } from './format'

export const INVITE_NOT_SENT = 'The account was created but the email could not be sent'

export interface DialogProps {
  onClose: () => void
  onDone: (message: string, tone?: ToastTone) => void
}

function Footer({ busy, submitLabel, busyLabel, onClose }: { busy: boolean; submitLabel: string; busyLabel: string; onClose: () => void }) {
  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>Cancel</button>
      <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>{busy ? busyLabel : submitLabel}</button>
    </>
  )
}

export function AdminFields({ form, errors, onChange }: {
  form: AdminForm
  errors: FormErrors
  onChange: (patch: Partial<AdminForm>) => void
}) {
  const invite = !!form.adminInvite
  return (
    <>
      <Field label="Administrator name" error={errors.adminName}>
        <input className="form-input" autoComplete="off" value={form.adminName} onChange={e => onChange({ adminName: e.target.value })} />
      </Field>
      <div className="pco-field-row">
        <Field label="Administrator email" error={errors.adminEmail}>
          <input className="form-input" type="email" autoComplete="off" value={form.adminEmail} onChange={e => onChange({ adminEmail: e.target.value })} />
        </Field>
        {!invite && (
          <Field label="Administrator password" error={errors.adminPassword} hint="Optional. Leave blank to send an invitation email.">
            <input className="form-input" type="password" autoComplete="new-password" value={form.adminPassword} onChange={e => onChange({ adminPassword: e.target.value })} />
          </Field>
        )}
      </div>
      <label className="pco-check">
        <input type="checkbox" checked={invite} onChange={e => onChange({ adminInvite: e.target.checked })} />
        <span>Send an invitation email instead</span>
      </label>
    </>
  )
}

function useSubmit() {
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  async function run(work: () => Promise<void>, fallback: string) {
    setBusy(true)
    setFailure('')
    try {
      await work()
    } catch (e) {
      setFailure(errorDetail(e, fallback))
      setBusy(false)
    }
  }
  return { busy, failure, setFailure, run }
}

export function AddCompanyDialog({ clientId, onClose, onDone }: DialogProps & { clientId: string }) {
  const [form, setForm] = useState<NewCompanyForm>(EMPTY_NEW_COMPANY)
  const [errors, setErrors] = useState<FormErrors>({})
  const { busy, failure, run } = useSubmit()
  const set = (key: keyof NewCompanyForm, value: string) => setForm(f => ({ ...f, [key]: value }))

  function submit() {
    const found = validateNewCompany(form)
    setErrors(found)
    if (Object.keys(found).length > 0) return
    void run(async () => {
      const input = buildNewCompanyInput(form)
      const r = await platformApi.createCompany(clientId, input)
      if (input.admin.password !== undefined) onDone(`Company ${input.name} created`)
      else if (r.data.email_sent === true) onDone(`Company ${input.name} created, invitation sent to ${input.admin.email}`)
      else onDone(INVITE_NOT_SENT, 'warn')
    }, 'Could not create the company.')
  }

  return (
    <Modal
      title="Add company"
      onClose={busy ? () => {} : onClose}
      onSubmit={e => { e.preventDefault(); if (!busy) submit() }}
      footer={<Footer busy={busy} submitLabel="Create company" busyLabel="Creating…" onClose={onClose} />}
    >
      <div className="pco-field-row">
        <Field label="Company name" error={errors.name}>
          <input className="form-input" autoComplete="off" value={form.name} onChange={e => set('name', e.target.value)} />
        </Field>
        <Field label="Company slug" hint="Used in the sign-in link. Made from the name when blank.">
          <input className="form-input" autoComplete="off" value={form.slug} onChange={e => set('slug', e.target.value)} />
        </Field>
      </div>
      <AdminFields form={form} errors={errors} onChange={patch => setForm(f => ({ ...f, ...patch }))} />
      {failure && <div className="pco-form-error" role="alert">{failure}</div>}
    </Modal>
  )
}

const EMPTY_ADMIN: AdminForm = { adminName: '', adminEmail: '', adminPassword: '', adminInvite: false }

export function AddAdminDialog({ company, onClose, onDone }: DialogProps & { company: CompanyRow }) {
  const [form, setForm] = useState<AdminForm>(EMPTY_ADMIN)
  const [errors, setErrors] = useState<FormErrors>({})
  const { busy, failure, run } = useSubmit()

  function submit() {
    const found = validateAdminForm(form)
    setErrors(found)
    if (Object.keys(found).length > 0) return
    void run(async () => {
      const input = buildAdminInput(form)
      const r = await platformApi.addAdmin(company.company_id, input)
      if (input.password !== undefined) onDone(`Administrator added to ${company.name}`)
      else if (r.data.email_sent === true) onDone(`Invitation sent to ${input.email}`)
      else onDone(INVITE_NOT_SENT, 'warn')
    }, 'Could not add the administrator.')
  }

  return (
    <Modal
      title={`Add administrator to ${company.name}`}
      onClose={busy ? () => {} : onClose}
      onSubmit={e => { e.preventDefault(); if (!busy) submit() }}
      footer={<Footer busy={busy} submitLabel="Add administrator" busyLabel="Adding…" onClose={onClose} />}
    >
      <AdminFields form={form} errors={errors} onChange={patch => setForm(f => ({ ...f, ...patch }))} />
      {failure && <div className="pco-form-error" role="alert">{failure}</div>}
    </Modal>
  )
}

export function RenameCompanyDialog({ company, onClose, onDone }: DialogProps & { company: CompanyRow }) {
  const [name, setName] = useState(company.name)
  const [error, setError] = useState('')
  const { busy, failure, run } = useSubmit()

  function submit() {
    const next = name.trim()
    if (!next) { setError("Enter the company's name."); return }
    setError('')
    if (next === company.name) { onClose(); return }
    void run(async () => {
      await platformApi.updateCompany(company.company_id, { name: next })
      onDone(`Company renamed to ${next}`)
    }, 'Could not rename the company.')
  }

  return (
    <Modal
      title={`Rename ${company.name}`}
      onClose={busy ? () => {} : onClose}
      onSubmit={e => { e.preventDefault(); if (!busy) submit() }}
      footer={<Footer busy={busy} submitLabel="Save name" busyLabel="Saving…" onClose={onClose} />}
    >
      <Field label="Company name" error={error}>
        <input className="form-input" autoComplete="off" value={name} onChange={e => setName(e.target.value)} />
      </Field>
      {failure && <div className="pco-form-error" role="alert">{failure}</div>}
    </Modal>
  )
}

export function ResetPasswordDialog({ company, onClose, onDone }: DialogProps & { company: CompanyRow }) {
  const [email, setEmail] = useState(company.admins[0]?.email ?? '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const { busy, failure, run } = useSubmit()

  function submit() {
    const problem = validatePassword(password)
    setError(problem)
    if (problem) return
    void run(async () => {
      await platformApi.resetAdminPassword(company.company_id, email, password)
      onDone(`Password reset for ${email}`)
    }, 'Could not reset the password.')
  }

  if (company.admins.length === 0) {
    return (
      <Modal
        title={`Reset a password in ${company.name}`}
        onClose={onClose}
        footer={<button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>}
      >
        <div className="pco-confirm-message">This company has no administrators. Add one first.</div>
      </Modal>
    )
  }

  return (
    <Modal
      title={`Reset a password in ${company.name}`}
      onClose={busy ? () => {} : onClose}
      onSubmit={e => { e.preventDefault(); if (!busy) submit() }}
      footer={<Footer busy={busy} submitLabel="Reset password" busyLabel="Resetting…" onClose={onClose} />}
    >
      <Field label="Administrator">
        <select className="form-input" value={email} onChange={e => setEmail(e.target.value)}>
          {company.admins.map(a => <option key={a.email} value={a.email}>{a.name ? `${a.name} (${a.email})` : a.email}</option>)}
        </select>
      </Field>
      <Field label="New password" error={error}>
        <input className="form-input" type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} />
      </Field>
      {failure && <div className="pco-form-error" role="alert">{failure}</div>}
    </Modal>
  )
}

export function SsoDomainsDialog({ company, onClose, onDone }: DialogProps & { company: CompanyRow }) {
  const [text, setText] = useState(company.sso_domains.join('\n'))
  const [error, setError] = useState('')
  const { busy, failure, run } = useSubmit()

  function submit() {
    const domains = parseDomains(text)
    const bad = firstBadDomain(domains)
    setError(bad ? `${bad} is not a valid domain.` : '')
    if (bad) return
    void run(async () => {
      await platformApi.updateCompany(company.company_id, { sso_domains: domains })
      onDone(`SSO domains saved for ${company.name}`)
    }, 'Could not save the domains.')
  }

  return (
    <Modal
      title={`SSO domains for ${company.name}`}
      onClose={busy ? () => {} : onClose}
      onSubmit={e => { e.preventDefault(); if (!busy) submit() }}
      footer={<Footer busy={busy} submitLabel="Save domains" busyLabel="Saving…" onClose={onClose} />}
    >
      <Field label="Domains" hint="One per line. A first-time Google sign-in from one of these domains is created in this company. A domain can belong to one company only." error={error}>
        <textarea className="form-input" rows={5} value={text} onChange={e => setText(e.target.value)} placeholder="example.com" />
      </Field>
      {failure && <div className="pco-form-error" role="alert">{failure}</div>}
    </Modal>
  )
}
