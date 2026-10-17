import { useState } from 'react'
import { platformApi } from '../../lib/api'
import type { ClientRow, CompanyRow } from '../../lib/platformTypes'
import { ConfirmDialog, Field } from './PlatformUi'
import { MAX_REASON_LENGTH, validateReason } from './clientForms'
import { errorDetail } from './format'

interface StatusDialogProps {
  onClose: () => void
  onDone: (message: string) => void
}

function ReasonField({ value, error, onChange }: { value: string; error: string; onChange: (v: string) => void }) {
  return (
    <Field label="Reason" error={error} hint={`Required. Up to ${MAX_REASON_LENGTH} characters.`}>
      <textarea className="form-input" rows={3} maxLength={MAX_REASON_LENGTH} value={value} onChange={e => onChange(e.target.value)} />
    </Field>
  )
}

export function ClientStatusDialog({ client, onClose, onDone }: StatusDialogProps & { client: ClientRow }) {
  const suspending = client.status === 'active'
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')

  async function confirm() {
    if (suspending) {
      const problem = validateReason(reason)
      setReasonError(problem)
      if (problem) return
    }
    setBusy(true)
    setFailure('')
    try {
      if (suspending) await platformApi.suspendClient(client.client_id, reason.trim())
      else await platformApi.activateClient(client.client_id)
      onDone(suspending ? `${client.name} suspended` : `${client.name} activated`)
    } catch (e) {
      setFailure(errorDetail(e, suspending ? 'Could not suspend the client.' : 'Could not activate the client.'))
      setBusy(false)
    }
  }

  return (
    <ConfirmDialog
      title={suspending ? `Suspend ${client.name}?` : `Activate ${client.name}?`}
      message={suspending
        ? 'Every company under this client stops working until it is activated again. Nothing is deleted.'
        : 'Companies under this client can be used again, unless they were suspended on their own.'}
      confirmLabel={suspending ? 'Suspend client' : 'Activate client'}
      danger={suspending}
      busy={busy}
      error={failure}
      onConfirm={() => void confirm()}
      onCancel={onClose}
    >
      {suspending && <ReasonField value={reason} error={reasonError} onChange={setReason} />}
    </ConfirmDialog>
  )
}

export function CompanyStatusDialog({ company, onClose, onDone }: StatusDialogProps & { company: CompanyRow }) {
  const suspending = company.status === 'active'
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')

  async function confirm() {
    if (suspending) {
      const problem = validateReason(reason)
      setReasonError(problem)
      if (problem) return
    }
    setBusy(true)
    setFailure('')
    try {
      if (suspending) await platformApi.suspendCompany(company.company_id, reason.trim())
      else await platformApi.activateCompany(company.company_id)
      onDone(suspending ? `${company.name} suspended` : `${company.name} activated`)
    } catch (e) {
      setFailure(errorDetail(e, suspending ? 'Could not suspend the company.' : 'Could not activate the company.'))
      setBusy(false)
    }
  }

  return (
    <ConfirmDialog
      title={suspending ? `Suspend ${company.name}?` : `Activate ${company.name}?`}
      message={suspending
        ? 'Its people cannot sign in until it is activated again. Nothing is deleted.'
        : 'Its people can sign in again.'}
      confirmLabel={suspending ? 'Suspend company' : 'Activate company'}
      danger={suspending}
      busy={busy}
      error={failure}
      onConfirm={() => void confirm()}
      onCancel={onClose}
    >
      {suspending && <ReasonField value={reason} error={reasonError} onChange={setReason} />}
    </ConfirmDialog>
  )
}
