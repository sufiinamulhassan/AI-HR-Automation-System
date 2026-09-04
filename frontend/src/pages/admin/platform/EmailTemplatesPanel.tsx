import { useEffect, useState } from 'react'
import { emailTemplatesApi } from '../../../lib/api'
import '../EmailTemplatesPage.css'

interface EmailTemplateInfo {
  key: string
  label: string
  description: string
  candidate_facing: boolean
  placeholders: string[]
  is_customized: boolean
  subject_template: string | null
  html_body_template: string | null
  text_body_template: string | null
  updated_by: string | null
  updated_at: string | null
}

interface EditForm {
  subject_template: string
  html_body_template: string
  text_body_template: string
}

function emptyForm(t: EmailTemplateInfo): EditForm {
  return {
    subject_template: t.subject_template || '',
    html_body_template: t.html_body_template || '',
    text_body_template: t.text_body_template || '',
  }
}

export default function EmailTemplatesPanel({ showToast }: { showToast: (msg: string) => void }) {
  const [templates, setTemplates] = useState<EmailTemplateInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [editing, setEditing] = useState<EmailTemplateInfo | null>(null)
  const [form, setForm] = useState<EditForm>({ subject_template: '', html_body_template: '', text_body_template: '' })

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const r = await emailTemplatesApi.list()
      setTemplates(r.data.templates ?? [])
    } catch {}
    setLoading(false)
  }

  function openEditor(t: EmailTemplateInfo) {
    setEditing(t)
    setForm(emptyForm(t))
  }

  async function save() {
    if (!editing) return
    setSaving(true)
    try {
      await emailTemplatesApi.upsert(editing.key, {
        subject_template: form.subject_template.trim() || undefined,
        html_body_template: form.html_body_template.trim() || undefined,
        text_body_template: form.text_body_template.trim() || undefined,
      })
      showToast('Template saved')
      setEditing(null)
      load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      showToast(err?.response?.data?.detail || 'Failed to save template')
    }
    setSaving(false)
  }

  async function resetTemplate(t: EmailTemplateInfo) {
    if (!confirm(`Reset "${t.label}" to the built-in default? Your customized subject/body will be deleted.`)) return
    try {
      await emailTemplatesApi.reset(t.key)
      showToast('Reset to default')
      if (editing?.key === t.key) setEditing(null)
      load()
    } catch {
      showToast('Failed to reset template')
    }
  }

  return (
    <>
      <div className="ps-intro">
        Customize the subject and body of system emails. Leave any field blank to keep using the
        built-in default for that field.
      </div>

      <section className="et-section ps-section card">
        <div className="card-header">
          <span className="card-title">Templates</span>
        </div>
        {loading ? (
          <div className="et-loading">Loading…</div>
        ) : (
          <table className="et-table">
            <thead>
              <tr>
                <th>Template</th>
                <th>Audience</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {templates.length === 0 ? (
                <tr><td colSpan={4} className="et-empty">No templates found.</td></tr>
              ) : templates.map(t => (
                <tr key={t.key}>
                  <td data-label="Template">
                    <div className="et-name">{t.label}</div>
                    <div className="et-desc">{t.description}</div>
                  </td>
                  <td data-label="Audience">
                    {t.candidate_facing
                      ? <span className="badge badge-yellow">Candidate-facing</span>
                      : <span className="badge badge-gray">Internal</span>}
                  </td>
                  <td data-label="Status">
                    <span className={`badge ${t.is_customized ? 'badge-blue' : 'badge-gray'}`}>
                      {t.is_customized ? 'Customized' : 'Default'}
                    </span>
                  </td>
                  <td data-label="Actions">
                    <div className="et-actions">
                      <button className="et-action-btn" onClick={() => openEditor(t)}>Edit</button>
                      {t.is_customized && (
                        <button className="et-action-btn et-action-reset" onClick={() => resetTemplate(t)}>
                          Reset to Default
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {editing && (
        <div className="modal-overlay" onClick={() => setEditing(null)}>
          <div className="modal-box et-modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Edit - {editing.label}</h2>
              <button className="modal-close" onClick={() => setEditing(null)}>✕</button>
            </div>

            <div className="et-form">
              {editing.candidate_facing && (
                <div className="et-warning">
                  <span className="et-warning-icon">⚠</span>
                  <div>
                    <strong>This email goes directly to the candidate.</strong> It must NEVER include
                    interview scores, evaluation results, recommendations, or any report content.
                    Candidates may only ever see a link and plain instructions - scores and reports
                    are admin-only and are never emailed to candidates, no matter what is written here.
                  </div>
                </div>
              )}

              <div className="et-placeholders">
                <span className="form-label">Available placeholders for this template</span>
                <div className="et-tags">
                  {editing.placeholders.map(p => (
                    <code key={p} className="et-tag">{`{{${p}}}`}</code>
                  ))}
                </div>
              </div>

              <label className="et-field">
                <span className="form-label">Subject</span>
                <input
                  className="form-input"
                  value={form.subject_template}
                  onChange={e => setForm(f => ({ ...f, subject_template: e.target.value }))}
                  placeholder="Leave blank to use the built-in default subject"
                />
              </label>

              <label className="et-field">
                <span className="form-label">HTML Body</span>
                <textarea
                  className="form-input et-textarea"
                  rows={10}
                  value={form.html_body_template}
                  onChange={e => setForm(f => ({ ...f, html_body_template: e.target.value }))}
                  placeholder="Leave blank to use the built-in default HTML body"
                />
              </label>

              <label className="et-field">
                <span className="form-label">Plain-text Body</span>
                <textarea
                  className="form-input et-textarea"
                  rows={6}
                  value={form.text_body_template}
                  onChange={e => setForm(f => ({ ...f, text_body_template: e.target.value }))}
                  placeholder="Leave blank to use the built-in default plain-text body"
                />
              </label>
            </div>

            <div className="modal-footer">
              {editing.is_customized && (
                <button className="btn btn-ghost et-reset-footer-btn" onClick={() => resetTemplate(editing)}>
                  Reset to Default
                </button>
              )}
              <button className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={saving} onClick={save}>
                {saving ? 'Saving…' : 'Save Template'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
