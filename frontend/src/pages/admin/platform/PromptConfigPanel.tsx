import { useEffect, useState } from 'react'
import { promptConfigApi } from '../../../lib/api'
import '../PromptConfigPage.css'

interface PromptTemplate {
  key: string
  label: string
  description: string
  placeholders: string[]
  is_customized: boolean
  system_prompt: string
  user_prompt_template: string
  default_system_prompt: string
  default_user_prompt_template: string
  updated_by: string | null
  updated_at: string | null
}

interface EditForm {
  system_prompt: string
  user_prompt_template: string
}

function missingPlaceholders(template: string, placeholders: string[]): string[] {
  return placeholders.filter(p => !template.includes(`{${p}}`))
}

export default function PromptConfigPanel({ showToast }: { showToast: (msg: string) => void }) {
  const [prompts, setPrompts] = useState<PromptTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [resettingKey, setResettingKey] = useState<string | null>(null)

  const [editKey, setEditKey] = useState<string | null>(null)
  const [form, setForm] = useState<EditForm>({ system_prompt: '', user_prompt_template: '' })
  const [showDefault, setShowDefault] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const r = await promptConfigApi.list()
      setPrompts(r.data.prompts ?? [])
    } catch {}
    setLoading(false)
  }

  const editing = prompts.find(p => p.key === editKey) || null

  function openEdit(p: PromptTemplate) {
    setEditKey(p.key)
    setForm({ system_prompt: p.system_prompt, user_prompt_template: p.user_prompt_template })
    setShowDefault(false)
  }

  function closeEdit() {
    setEditKey(null)
  }

  async function save() {
    if (!editing) return
    setSaving(true)
    try {
      await promptConfigApi.update(editing.key, {
        system_prompt: form.system_prompt,
        user_prompt_template: form.user_prompt_template,
      })
      showToast(`"${editing.label}" prompt updated`)
      closeEdit()
      load()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      showToast(err?.response?.data?.detail || 'Failed to save prompt')
    }
    setSaving(false)
  }

  async function resetToDefault(p: PromptTemplate) {
    if (!confirm(`Reset "${p.label}" to its built-in default? This deletes your customization.`)) return
    setResettingKey(p.key)
    try {
      await promptConfigApi.reset(p.key)
      showToast(`"${p.label}" reset to default`)
      if (editKey === p.key) closeEdit()
      load()
    } catch {
      showToast('Failed to reset prompt')
    }
    setResettingKey(null)
  }

  const missingUser = editing ? missingPlaceholders(form.user_prompt_template, editing.placeholders) : []

  return (
    <>
      <div className="ps-intro">
        Customize the system and user prompts behind JD parsing and interview question
        generation / evaluation - without a code deploy. Leave a prompt at its default
        unless you have a specific reason to change it.
      </div>

      <section className="pc-section ps-section card">
        <div className="card-header">
          <span className="card-title">Prompts</span>
        </div>
        {loading ? (
          <div className="pc-loading">Loading…</div>
        ) : (
          <table className="pc-table">
            <thead>
              <tr>
                <th>Prompt</th>
                <th>Key</th>
                <th>Status</th>
                <th>Last Updated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {prompts.length === 0 ? (
                <tr><td colSpan={5} className="pc-empty">No prompt definitions found.</td></tr>
              ) : prompts.map(p => (
                <tr key={p.key}>
                  <td data-label="Prompt">
                    <div className="pc-name">{p.label}</div>
                    <div className="pc-desc">{p.description}</div>
                  </td>
                  <td data-label="Key"><code className="pc-key">{p.key}</code></td>
                  <td data-label="Status">
                    <span className={`badge ${p.is_customized ? 'badge-blue' : 'badge-gray'}`}>
                      {p.is_customized ? 'Customized' : 'Default'}
                    </span>
                  </td>
                  <td className="pc-updated" data-label="Last Updated">
                    {p.is_customized && p.updated_at ? (
                      <>
                        <div>{new Date(p.updated_at).toLocaleString()}</div>
                        {p.updated_by && <div className="pc-updated-by">by {p.updated_by}</div>}
                      </>
                    ) : '-'}
                  </td>
                  <td data-label="Actions">
                    <div className="pc-actions">
                      <button className="pc-action-btn" onClick={() => openEdit(p)}>Edit</button>
                      <button
                        className="pc-action-btn pc-action-reset"
                        disabled={!p.is_customized || resettingKey === p.key}
                        onClick={() => resetToDefault(p)}
                      >
                        {resettingKey === p.key ? 'Resetting…' : 'Reset to Default'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {editing && (
        <div className="modal-overlay" onClick={closeEdit}>
          <div className="modal-box pc-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Edit - {editing.label}</h2>
              <button className="modal-close" onClick={closeEdit}>✕</button>
            </div>

            <div className="pc-form">
              <div className="pc-hint">
                <span className="pc-hint-label">Required placeholders - your User Prompt Template MUST include all of these exactly as written (curly braces included), or the save will silently fall back to the built-in default at run time:</span>
                <div className="pc-placeholders">
                  {editing.placeholders.map(p => (
                    <code key={p} className={`pc-pill ${missingUser.includes(p) ? 'pc-pill-missing' : ''}`}>
                      {'{' + p + '}'}
                    </code>
                  ))}
                </div>
                {missingUser.length > 0 && (
                  <div className="pc-warning">
                    Missing: {missingUser.map(p => `{${p}}`).join(', ')} - this template will not apply until every
                    placeholder above is present.
                  </div>
                )}
              </div>

              <label className="pc-field">
                <span className="form-label">System Prompt</span>
                <textarea className="form-input pc-textarea" rows={3} value={form.system_prompt}
                  onChange={e => setForm(f => ({ ...f, system_prompt: e.target.value }))} />
              </label>

              <label className="pc-field">
                <span className="form-label">User Prompt Template</span>
                <textarea className="form-input pc-textarea pc-textarea-lg" rows={12} value={form.user_prompt_template}
                  onChange={e => setForm(f => ({ ...f, user_prompt_template: e.target.value }))} />
              </label>

              <div className="pc-default-toggle">
                <button type="button" className="pc-link-btn" onClick={() => setShowDefault(s => !s)}>
                  {showDefault ? 'Hide built-in default' : 'Show built-in default (read-only)'}
                </button>
              </div>

              {showDefault && (
                <div className="pc-default-box">
                  <div className="pc-default-block">
                    <span className="pc-default-label">Default System Prompt</span>
                    <pre className="pc-default-pre">{editing.default_system_prompt}</pre>
                  </div>
                  <div className="pc-default-block">
                    <span className="pc-default-label">Default User Prompt Template</span>
                    <pre className="pc-default-pre">{editing.default_user_prompt_template}</pre>
                  </div>
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={closeEdit}>Cancel</button>
              <button className="btn btn-primary" onClick={save}
                disabled={saving || !form.system_prompt.trim() || !form.user_prompt_template.trim()}>
                {saving ? 'Saving…' : 'Save Override'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
