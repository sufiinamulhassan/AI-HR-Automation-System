import { useState } from 'react'
import { platformApi } from '../../lib/api'
import type { PlatformOwner } from '../../lib/platformTypes'
import { useAuthStore } from '../../store/auth.store'
import { ConfirmDialog, EmptyState, ErrorState, Field, LoadingState, Modal, StatusBadge, useToast } from './PlatformUi'
import { buildOwnerInput, validateAdminForm, type AdminForm, type FormErrors } from './clientForms'
import { errorDetail, fmtWhen } from './format'
import { useLoaded } from './usePlatformData'

const EMPTY: AdminForm = { adminName: '', adminEmail: '', adminPassword: '' }

export default function PlatformOwnersPage() {
  const me = useAuthStore(s => s.user?.email)
  const { toast, showToast } = useToast()
  const { data, loading, error, reload } = useLoaded(
    () => platformApi.listOwners().then(r => r.data.owners),
    [],
    'Could not load the platform owners.',
  )
  const [adding, setAdding] = useState(false)
  const [toggling, setToggling] = useState<PlatformOwner | null>(null)

  const isMe = (owner: PlatformOwner) => !!me && owner.email.toLowerCase() === me.toLowerCase()
  const showOtp = !!data && data.some(o => typeof o.otp_required === 'boolean')

  return (
    <div className="pco-page" aria-busy={loading}>
      {toast}
      <div className="pco-header">
        <h1 className="pco-title">Platform owners</h1>
        <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>Add owner</button>
      </div>

      <section className="pco-card">
        {!data && loading && <LoadingState label="Loading the owners…" />}
        {!data && !loading && error && <ErrorState message={error} onRetry={reload} />}
        {data && error && <ErrorState message={error} onRetry={reload} />}
        {data && data.length === 0 && <EmptyState>No platform owners yet.</EmptyState>}

        {data && data.length > 0 && (
          <div className="pco-table-wrap">
            <table className="pco-table">
              <thead>
                <tr>
                  <th scope="col">Owner</th>
                  <th scope="col">Status</th>
                  <th scope="col">Workspace</th>
                  {showOtp && <th scope="col">One-time code</th>}
                  <th scope="col">Last sign-in</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.map(o => (
                  <tr key={o.email}>
                    <th scope="row">
                      <span className="pco-name">{o.name || o.email}</span>
                      {o.name && <span className="pco-cell-meta">{o.email}</span>}
                    </th>
                    <td><StatusBadge status={o.is_active ? 'active' : 'suspended'} inactiveLabel="Inactive" /></td>
                    <td>{o.company_name || '-'}</td>
                    {showOtp && <td>{typeof o.otp_required === 'boolean' ? (o.otp_required ? 'Required' : 'Off') : '-'}</td>}
                    <td>{fmtWhen(o.last_login_at)}</td>
                    <td>
                      <button
                        type="button"
                        className={`btn btn-sm ${o.is_active ? 'btn-danger' : 'btn-primary'}`}
                        disabled={o.is_active && isMe(o)}
                        title={o.is_active && isMe(o) ? 'You cannot deactivate your own account.' : undefined}
                        onClick={() => setToggling(o)}
                      >
                        {o.is_active ? 'Deactivate' : 'Reactivate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {adding && (
        <AddOwnerDialog
          onClose={() => setAdding(false)}
          onDone={message => { setAdding(false); showToast(message); reload() }}
        />
      )}
      {toggling && (
        <OwnerStatusDialog
          owner={toggling}
          onClose={() => setToggling(null)}
          onDone={message => { setToggling(null); showToast(message); reload() }}
        />
      )}
    </div>
  )
}

function AddOwnerDialog({ onClose, onDone }: { onClose: () => void; onDone: (message: string) => void }) {
  const [form, setForm] = useState<AdminForm>(EMPTY)
  const [errors, setErrors] = useState<FormErrors>({})
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  const set = (key: keyof AdminForm, value: string) => setForm(f => ({ ...f, [key]: value }))

  async function submit() {
    const found = validateAdminForm(form, 'owner', true)
    setErrors(found)
    setFailure('')
    if (Object.keys(found).length > 0) return
    setBusy(true)
    try {
      await platformApi.createOwner(buildOwnerInput(form))
      onDone(`${form.adminName.trim()} added as a platform owner`)
    } catch (e) {
      setFailure(errorDetail(e, 'Could not add the owner.'))
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Add platform owner"
      onClose={busy ? () => {} : onClose}
      onSubmit={e => { e.preventDefault(); if (!busy) void submit() }}
      footer={
        <>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>{busy ? 'Adding…' : 'Add owner'}</button>
        </>
      }
    >
      <Field label="Name" error={errors.adminName}>
        <input className="form-input" autoComplete="off" value={form.adminName} onChange={e => set('adminName', e.target.value)} />
      </Field>
      <Field label="Email" error={errors.adminEmail}>
        <input className="form-input" type="email" autoComplete="off" value={form.adminEmail} onChange={e => set('adminEmail', e.target.value)} />
      </Field>
      <Field label="Password" error={errors.adminPassword} hint="At least 8 characters. Owners always sign in with a one-time code as well.">
        <input className="form-input" type="password" autoComplete="new-password" value={form.adminPassword} onChange={e => set('adminPassword', e.target.value)} />
      </Field>
      {failure && <div className="pco-form-error" role="alert">{failure}</div>}
    </Modal>
  )
}

function OwnerStatusDialog({ owner, onClose, onDone }: {
  owner: PlatformOwner
  onClose: () => void
  onDone: (message: string) => void
}) {
  const deactivating = owner.is_active
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')

  async function confirm() {
    setBusy(true)
    setFailure('')
    try {
      await platformApi.setOwnerActive(owner.email, !deactivating)
      onDone(deactivating ? `${owner.name || owner.email} deactivated` : `${owner.name || owner.email} reactivated`)
    } catch (e) {
      setFailure(errorDetail(e, deactivating ? 'Could not deactivate the owner.' : 'Could not reactivate the owner.'))
      setBusy(false)
    }
  }

  return (
    <ConfirmDialog
      title={deactivating ? `Deactivate ${owner.name || owner.email}?` : `Reactivate ${owner.name || owner.email}?`}
      message={deactivating
        ? 'They can no longer sign in. You can reactivate them later.'
        : 'They can sign in again.'}
      confirmLabel={deactivating ? 'Deactivate' : 'Reactivate'}
      danger={deactivating}
      busy={busy}
      error={failure}
      onConfirm={() => void confirm()}
      onCancel={onClose}
    />
  )
}
