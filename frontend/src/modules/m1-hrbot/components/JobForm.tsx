import { useState } from 'react'
import { jobsApi } from '../../../lib/api'
import { useModelStore } from '../../../store/model.store'
import './JobForm.css'

interface Props {
  job: Record<string, unknown> | null
  onSave: () => void
  onClose: () => void
}

export default function JobForm({ job, onSave, onClose }: Props) {
  const activeModel = useModelStore(s => s.activeModel)
  const [form, setForm] = useState({
    title: (job?.title as string) || '',
    description: (job?.description as string) || '',
    difficulty: (job?.difficulty as string) || 'mid',
    employment_type: (job?.employment_type as string) || 'full-time',
    location: (job?.location as string) || '',
    company_name: (job?.company_name as string) || '',
    salary_min: (job?.salary_min as number) || '',
    salary_max: (job?.salary_max as number) || '',
    is_remote: (job?.is_remote as boolean) || false,
    deadline_days: (job?.deadline_days as number) ?? 30,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError('')
    try {
      const payload = {
        ...form,
        salary_min: form.salary_min === '' ? null : form.salary_min,
        salary_max: form.salary_max === '' ? null : form.salary_max,
        deadline_days: form.deadline_days === ('' as unknown) ? null : Number(form.deadline_days),
        model_override: activeModel
      }
      if (job?.job_id) await jobsApi.update(job.job_id as string, payload)
      else await jobsApi.create(payload)
      onSave()
    } catch (err: unknown) {
      setError((err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Save failed')
    } finally { setSaving(false) }
  }

  function set(k: string, v: string | boolean | number) { setForm(f => ({ ...f, [k]: v })) }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card wide" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{job ? 'Edit Job' : 'New Job Description'}</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {error && <div className="form-error">{error}</div>}

        <form onSubmit={handleSubmit} className="job-form">
          <div className="form-row">
            <label>Job Title *
              <input value={form.title} onChange={e => set('title', e.target.value)} required placeholder="Senior React Developer" />
            </label>
            <label>Company
              <input value={form.company_name} onChange={e => set('company_name', e.target.value)} placeholder="Acme Corp" />
            </label>
          </div>

          <label>Job Description *
            <textarea value={form.description} onChange={e => set('description', e.target.value)}
              required rows={8} placeholder="Describe the role, responsibilities, and requirements…" />
          </label>

          <div className="form-row">
            <label>Difficulty
              <select value={form.difficulty} onChange={e => set('difficulty', e.target.value)}>
                {['junior', 'mid', 'senior', 'lead'].map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
            <label>Employment Type
              <select value={form.employment_type} onChange={e => set('employment_type', e.target.value)}>
                {['full-time', 'part-time', 'contract', 'internship'].map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label>Location
              <input value={form.location} onChange={e => set('location', e.target.value)} placeholder="London, UK" />
            </label>
          </div>

          <div className="form-row">
            <label>Salary Min (£)
              <input type="number" value={form.salary_min} onChange={e => set('salary_min', e.target.value === '' ? '' : Number(e.target.value))} placeholder="40000" />
            </label>
            <label>Salary Max (£)
              <input type="number" value={form.salary_max} onChange={e => set('salary_max', e.target.value === '' ? '' : Number(e.target.value))} placeholder="70000" />
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={form.is_remote} onChange={e => set('is_remote', e.target.checked)} />
              Remote OK
            </label>
          </div>

          <div className="form-row">
            <label>Days open
              <input type="number" min={0} max={365} value={form.deadline_days}
                onChange={e => set('deadline_days', e.target.value === '' ? '' : Number(e.target.value))}
                placeholder="30" />
              <small className="form-hint">Application window in days. After it ends, no new candidates are matched. 0 = no deadline.</small>
            </label>
          </div>

          <div className="form-footer">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving…' : job ? 'Update JD' : 'Create JD'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
