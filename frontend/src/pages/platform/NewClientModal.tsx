import { useState } from 'react'
import { platformApi } from '../../lib/api'
import type { ClientRow } from '../../lib/platformTypes'
import { AdminFields } from './CompanyDialogs'
import PlanFields from './PlanFields'
import { Field, Modal } from './PlatformUi'
import {
  EMPTY_NEW_CLIENT, buildNewClientInput, validateNewClient, type FormErrors, type NewClientForm,
} from './clientForms'
import { errorDetail } from './format'

export default function NewClientModal({ onClose, onCreated }: {
  onClose: () => void
  onCreated: (client: ClientRow, invitation?: 'sent' | 'not_sent') => void
}) {
  const [form, setForm] = useState<NewClientForm>(EMPTY_NEW_CLIENT)
  const [errors, setErrors] = useState<FormErrors>({})
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')

  const set = <K extends keyof NewClientForm>(key: K, value: NewClientForm[K]) =>
    setForm(f => ({ ...f, [key]: value }))
  const text = (key: Exclude<keyof NewClientForm, 'withCompany' | 'adminInvite' | 'features'>) => ({
    value: form[key] as string,
    onChange: (e: { target: { value: string } }) => set(key, e.target.value as NewClientForm[typeof key]),
  })

  async function submit() {
    const found = validateNewClient(form)
    setErrors(found)
    setFailure('')
    if (Object.keys(found).length > 0) return
    setBusy(true)
    try {
      const body = buildNewClientInput(form)
      const r = await platformApi.createClient(body)
      const invited = !!body.company && body.company.admin.password === undefined
      onCreated(r.data.client, invited ? (r.data.email_sent === true ? 'sent' : 'not_sent') : undefined)
    } catch (e) {
      setFailure(errorDetail(e, 'Could not create the client.'))
      setBusy(false)
    }
  }

  return (
    <Modal
      title="New client"
      wide
      onClose={busy ? () => {} : onClose}
      onSubmit={e => { e.preventDefault(); if (!busy) void submit() }}
      footer={
        <>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>{busy ? 'Creating…' : 'Create client'}</button>
        </>
      }
    >
      <Field label="Name" error={errors.name}>
        <input className="form-input" autoComplete="off" {...text('name')} />
      </Field>

      <PlanFields form={form} errors={errors} onChange={patch => setForm(f => ({ ...f, ...patch }))} />

      <fieldset className="pco-fieldset">
        <legend>Contact</legend>
        <div className="pco-field-row">
          <Field label="Contact name">
            <input className="form-input" autoComplete="off" {...text('contactName')} />
          </Field>
          <Field label="Contact email" error={errors.contactEmail}>
            <input className="form-input" type="email" autoComplete="off" {...text('contactEmail')} />
          </Field>
        </div>
        <Field label="Notes">
          <textarea className="form-input" rows={2} {...text('notes')} />
        </Field>
      </fieldset>

      <label className="pco-check">
        <input type="checkbox" checked={form.withCompany} onChange={e => set('withCompany', e.target.checked)} />
        <span>Create the first company now</span>
      </label>

      {form.withCompany && (
        <fieldset className="pco-fieldset">
          <legend>First company</legend>
          <div className="pco-field-row">
            <Field label="Company name" hint="Leave blank to use the client name.">
              <input className="form-input" autoComplete="off" {...text('companyName')} />
            </Field>
            <Field label="Company slug" hint="Used in the sign-in link. Made from the name when blank.">
              <input className="form-input" autoComplete="off" {...text('companySlug')} />
            </Field>
          </div>
          <AdminFields form={form} errors={errors} onChange={patch => setForm(f => ({ ...f, ...patch }))} />
        </fieldset>
      )}

      {failure && <div className="pco-form-error" role="alert">{failure}</div>}
    </Modal>
  )
}
