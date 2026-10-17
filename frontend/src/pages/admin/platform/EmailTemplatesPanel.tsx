import { useEffect, useRef, useState } from 'react'
import { emailTemplatesApi } from '../../../lib/api'
import { fillPreview } from './emailPreview'
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
  sample_subject_template?: string
  sample_html_body_template?: string
  sample_text_body_template?: string
  preview_values?: Record<string, string>
}

interface EditForm {
  subject: string
  html: string
  text: string
}

type Field = keyof EditForm

function sampleOf(t: EmailTemplateInfo): EditForm {
  return {
    subject: t.sample_subject_template ?? '',
    html: t.sample_html_body_template ?? '',
    text: t.sample_text_body_template ?? '',
  }
}

function startingForm(t: EmailTemplateInfo): EditForm {
  const sample = sampleOf(t)
  return {
    subject: t.subject_template || sample.subject,
    html: t.html_body_template || sample.html,
    text: t.text_body_template || sample.text,
  }
}

const sameForm = (a: EditForm, b: EditForm) => a.subject === b.subject && a.html === b.html && a.text === b.text

export default function EmailTemplatesPanel({ showToast }: { showToast: (msg: string) => void }) {
  const [templates, setTemplates] = useState<EmailTemplateInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [editing, setEditing] = useState<EmailTemplateInfo | null>(null)
  const [form, setForm] = useState<EditForm>({ subject: '', html: '', text: '' })
  const [start, setStart] = useState<EditForm>({ subject: '', html: '', text: '' })
  const [view, setView] = useState<'edit' | 'preview'>('edit')
  const [target, setTarget] = useState<Field>('html')
  const [pending, setPending] = useState<string | null>(null)
  const refs = {
    subject: useRef<HTMLInputElement>(null),
    html: useRef<HTMLTextAreaElement>(null),
    text: useRef<HTMLTextAreaElement>(null),
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    if (pending === null || view !== 'edit') return
    setForm(f => ({ ...f, html: f.html + pending }))
    setPending(null)
  }, [pending, view])

  async function load() {
    setLoading(true)
    try {
      const r = await emailTemplatesApi.list()
      setTemplates(r.data.templates ?? [])
    } catch { }
    setLoading(false)
  }

  function openEditor(t: EmailTemplateInfo) {
    const initial = startingForm(t)
    setEditing(t)
    setForm(initial)
    setStart(initial)
    setView('edit')
    setTarget('html')
  }

  const dirty = !sameForm(form, start)
  const sample = editing ? sampleOf(editing) : null
  const canUseSample = !!sample && !!(sample.subject || sample.html) && !sameForm(form, sample)

  function insert(token: string) {
    const element = refs[target].current
    const text = `{{${token}}}`
    if (!element) {
      setView('edit')
      setTarget('html')
      setPending(text)
      return
    }
    const at = element.selectionStart ?? form[target].length
    const to = element.selectionEnd ?? at
    const next = form[target].slice(0, at) + text + form[target].slice(to)
    setForm(f => ({ ...f, [target]: next }))
    requestAnimationFrame(() => {
      element.focus()
      element.setSelectionRange(at + text.length, at + text.length)
    })
  }

  async function save() {
    if (!editing) return
    setSaving(true)
    try {
      await emailTemplatesApi.upsert(editing.key, {
        subject_template: form.subject.trim() || undefined,
        html_body_template: form.html.trim() || undefined,
        text_body_template: form.text.trim() || undefined,
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

  const values = editing?.preview_values ?? {}
  const preview = { subject: fillPreview(form.subject, values, false), html: fillPreview(form.html, values, true) }

  return (
    <>
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
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {templates.length === 0 ? (
                <tr><td colSpan={3} className="et-empty">No templates found.</td></tr>
              ) : templates.map(t => (
                <tr key={t.key}>
                  <td data-label="Template">
                    <div className="et-name">{t.label}</div>
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
          <div className="modal-box et-modal-box" role="dialog" aria-label={`Edit, ${editing.label}`} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Edit, {editing.label}</h2>
              <button className="modal-close" aria-label="Close" onClick={() => setEditing(null)}>✕</button>
            </div>

            <div className="et-form">
              {editing.candidate_facing && (
                <div className="et-warning" role="note">
                  <span className="et-warning-icon" aria-hidden="true">⚠</span>
                  <span>
                    <strong>Goes straight to the candidate.</strong> Never include scores, evaluation results or recommendations.
                  </span>
                </div>
              )}

              <div className="et-placeholders">
                <span className="form-label">Insert a placeholder</span>
                <div className="et-tags">
                  {editing.placeholders.map(p => (
                    <button key={p} type="button" className="et-tag" onClick={() => insert(p)} title={`Insert {{${p}}}`}>
                      {`{{${p}}}`}
                    </button>
                  ))}
                </div>
              </div>

              <label className="et-field">
                <span className="form-label">Subject</span>
                <input
                  ref={refs.subject}
                  className="form-input"
                  value={form.subject}
                  onFocus={() => setTarget('subject')}
                  onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
                />
              </label>

              <div className="et-field">
                <div className="et-field-head">
                  <span className="form-label">Message</span>
                  <div className="et-segment" role="tablist" aria-label="Message view">
                    {(['edit', 'preview'] as const).map(v => (
                      <button
                        key={v}
                        type="button"
                        role="tab"
                        aria-selected={view === v}
                        className={`et-segment-opt${view === v ? ' et-segment-on' : ''}`}
                        onClick={() => setView(v)}
                      >
                        {v === 'edit' ? 'Edit' : 'Preview'}
                      </button>
                    ))}
                  </div>
                </div>
                {view === 'edit' ? (
                  <textarea
                    ref={refs.html}
                    className="form-input et-textarea"
                    rows={12}
                    aria-label="Message"
                    value={form.html}
                    onFocus={() => setTarget('html')}
                    onChange={e => setForm(f => ({ ...f, html: e.target.value }))}
                  />
                ) : form.html.trim() ? (
                  <div className="et-preview">
                    <div className="et-preview-subject">{preview.subject || '-'}</div>
                    <iframe title="Email preview" className="et-preview-frame" sandbox="" srcDoc={preview.html} />
                  </div>
                ) : (
                  <div className="et-preview-empty">Nothing to preview</div>
                )}
              </div>

              <details className="et-details">
                <summary>Plain-text version</summary>
                <textarea
                  ref={refs.text}
                  className="form-input et-textarea"
                  rows={8}
                  aria-label="Plain-text version"
                  value={form.text}
                  onFocus={() => setTarget('text')}
                  onChange={e => setForm(f => ({ ...f, text: e.target.value }))}
                />
              </details>
            </div>

            <div className="modal-footer">
              {canUseSample && (
                <button className="btn btn-ghost et-sample-btn" onClick={() => sample && setForm(sample)}>
                  Use sample
                </button>
              )}
              {editing.is_customized && (
                <button className="btn btn-ghost et-reset-footer-btn" onClick={() => resetTemplate(editing)}>
                  Reset to Default
                </button>
              )}
              <button className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={saving || !dirty} onClick={save}>
                {saving ? 'Saving…' : 'Save Template'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
