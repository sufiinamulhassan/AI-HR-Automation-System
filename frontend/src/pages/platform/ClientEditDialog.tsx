import { useState } from 'react'
import { platformApi } from '../../lib/api'
import type { ClientRow } from '../../lib/platformTypes'
import PlanFields from './PlanFields'
import { Field, Modal } from './PlatformUi'
import {
  buildClientPatch, clientFieldsFrom, validateClientEdit, type ClientFields, type FormErrors,
} from './clientForms'
import { errorDetail } from './format'

export default function ClientEditDialog({ client, onClose, onDone }: {
  client: ClientRow
  onClose: () => void
  onDone: (message: string) => void
}) {
  const [form, setForm] = useState<ClientFields>(() => clientFieldsFrom(client))
  const [errors, setErrors] = useState<FormErrors>({})
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')

  const field = (key: 'name' | 'contactName' | 'contactEmail' | 'notes') => ({
    value: form[key],
    onChange: (e: { target: { value: string } }) => setForm(f => ({ ...f, [key]: e.target.value })),
  })

  async function submit() {
    const found = validateClientEdit(form)
    setErrors(found)
    setFailure('')
    if (Object.keys(found).length > 0) return
    const patch = buildClientPatch(client, form)
    if (Object.keys(patch).length === 0) {
      onClose()
      return
    }
    setBusy(true)
    try {
      await platformApi.updateClient(client.client_id, patch)
      onDone(`${form.name.trim()} updated`)
    } catch (e) {
      setFailure(errorDetail(e, 'Could not save the client.'))
      setBusy(false)
    }
  }

  return (
    <Modal
      title={`Edit ${client.name}`}
      wide
      onClose={busy ? () => {} : onClose}
      onSubmit={e => { e.preventDefault(); if (!busy) void submit() }}
      footer={
        <>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
        </>
      }
    >
      <Field label="Name" error={errors.name}>
        <input className="form-input" autoComplete="off" {...field('name')} />
      </Field>

      <PlanFields form={form} errors={errors} onChange={patch => setForm(f => ({ ...f, ...patch }))} />

      <fieldset className="pco-fieldset">
        <legend>Contact</legend>
        <div className="pco-field-row">
          <Field label="Contact name">
            <input className="form-input" autoComplete="off" {...field('contactName')} />
          </Field>
          <Field label="Contact email" error={errors.contactEmail}>
            <input className="form-input" type="email" autoComplete="off" {...field('contactEmail')} />
          </Field>
        </div>
        <Field label="Notes">
          <textarea className="form-input" rows={2} {...field('notes')} />
        </Field>
      </fieldset>

      {failure && <div className="pco-form-error" role="alert">{failure}</div>}
    </Modal>
  )
}
