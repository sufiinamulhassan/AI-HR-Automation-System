import { useEffect, useState } from 'react'
import { jobGradesApi, jobsApi } from '../../../lib/api'
import { isJobPublic } from './careersVisibility'
import './JobForm.css'

interface Props {
  job: Record<string, unknown> | null
  onSave: () => void
  onClose: () => void
}

export default function JobForm({ job, onSave, onClose }: Props) {
  const [form, setForm] = useState({
    title: (job?.title as string) || '',
    description: (job?.description as string) || '',
    difficulty: (job?.difficulty as string) || 'mid',
    employment_type: (job?.employment_type as string) || 'full-time',
    location: (job?.location as string) || '',
    job_grade: (job?.job_grade as string) || '',
    company_name: (job?.company_name as string) || '',
    salary_min: (job?.salary_min as number) || '',
    salary_max: (job?.salary_max as number) || '',
    is_remote: (job?.is_remote as boolean) || false,
    deadline_days: (job?.deadline_days as number) ?? 30,
    max_resumes: (job?.max_resumes as number) ?? 0,
    is_public: job ? isJobPublic(job) : true,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [gradeOptions, setGradeOptions] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    jobGradesApi.list()
      .then(r => {
        if (cancelled) return
        const raw = (r.data?.job_grades ?? r.data?.grades ?? []) as unknown[]
        const names = raw
          .map(g => (typeof g === 'string' ? g : (g as { name?: string } | null)?.name))
          .filter((n): n is string => Boolean(n))
        setGradeOptions(names)
      })
      .catch(() => { })
    return () => { cancelled = true }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError('')
    try {
      const payload = {
        ...form,
        salary_min: form.salary_min === '' ? null : form.salary_min,
        salary_max: form.salary_max === '' ? null : form.salary_max,
        deadline_days: form.deadline_days === ('' as unknown) ? null : Number(form.deadline_days),
        max_resumes: form.max_resumes === ('' as unknown) ? 0 : Math.max(0, Math.floor(Number(form.max_resumes))),
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
            <label>Job Grade
              {gradeOptions.length > 0 ? (
                <select value={form.job_grade} onChange={e => set('job_grade', e.target.value)}>
                  <option value="">None</option>
                  {gradeOptions.map(g => <option key={g} value={g}>{g}</option>)}
                  {form.job_grade && !gradeOptions.includes(form.job_grade) && (
                    <option value={form.job_grade}>{form.job_grade} (custom)</option>
                  )}
                </select>
              ) : (
                <input value={form.job_grade} onChange={e => set('job_grade', e.target.value)} placeholder="e.g. Grade 5, AVP, VP" />
              )}
            </label>
          </div>

          <div className="form-row form-row-4">
            <label>Salary Min (£)
              <input type="number" value={form.salary_min} onChange={e => set('salary_min', e.target.value === '' ? '' : Number(e.target.value))} placeholder="40000" />
            </label>
            <label>Salary Max (£)
              <input type="number" value={form.salary_max} onChange={e => set('salary_max', e.target.value === '' ? '' : Number(e.target.value))} placeholder="70000" />
            </label>
            <label title="0 means no deadline">Days open
              <input type="number" min={0} max={365} value={form.deadline_days}
                onChange={e => set('deadline_days', e.target.value === '' ? '' : Number(e.target.value))}
                placeholder="0 = no deadline" />
            </label>
            <label title="0 means no limit">Max résumés
              <input type="number" min={0} max={100000} step={1} value={form.max_resumes}
                onChange={e => set('max_resumes', e.target.value === '' ? '' : Number(e.target.value))}
                placeholder="0 = no limit" />
            </label>
          </div>

          <div className="form-toggles">
            <label className="toggle-chip">
              <input type="checkbox" checked={form.is_remote} onChange={e => set('is_remote', e.target.checked)} />
              <span>Remote OK</span>
            </label>
            <label className="toggle-chip">
              <input type="checkbox" checked={form.is_public} onChange={e => set('is_public', e.target.checked)} />
              <span>Show on the careers page</span>
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
