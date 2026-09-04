import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { scenariosApi, workflowsApi } from '../../lib/api'
import { codingApi, type CodingQuestion, type CodingSubmission, type CodingTestCase } from '../../lib/codingApi'
import '../../styles/admin-tabs.css'
import './InterviewAutomationPage.css'


function errorMessage(e: unknown, fallback: string): string {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  if (typeof detail === 'string' && detail.trim()) return detail
  if (Array.isArray(detail) && detail.length) {
    return detail
      .map(d => (d && typeof d === 'object' && 'msg' in d) ? String((d as { msg: unknown }).msg) : String(d))
      .join('; ')
  }
  return fallback
}

type ShowToast = (msg: string) => void

interface TabProps {
  showToast: ShowToast
}


interface Scenario {
  scenario_id: string
  name: string
  prompt: string
  evaluation_dimensions: string[]
  job_domain: string | null
  is_active: boolean
  created_by: string
  created_at: string
}

const DEFAULT_DIMENSIONS = ['technical', 'problem_solving', 'communication', 'decision_making', 'confidence']

const DIMENSION_LABELS: Record<string, string> = {
  technical: 'Technical',
  problem_solving: 'Problem Solving',
  communication: 'Communication',
  decision_making: 'Decision Making',
  confidence: 'Confidence',
}

interface ScenarioForm {
  name: string
  prompt: string
  job_domain: string
  evaluation_dimensions: string[]
  is_active: boolean
}

function emptyScenarioForm(): ScenarioForm {
  return { name: '', prompt: '', job_domain: '', evaluation_dimensions: [...DEFAULT_DIMENSIONS], is_active: true }
}

function ScenariosTab({ scenarios, loading, reload, showToast }: TabProps & {
  scenarios: Scenario[]
  loading: boolean
  reload: () => void
}) {
  const [modal, setModal] = useState<'create' | 'edit' | null>(null)
  const [selected, setSelected] = useState<Scenario | null>(null)
  const [form, setForm] = useState<ScenarioForm>(emptyScenarioForm())
  const [saving, setSaving] = useState(false)

  function openCreate() {
    setForm(emptyScenarioForm())
    setSelected(null)
    setModal('create')
  }

  function openEdit(s: Scenario) {
    setSelected(s)
    setForm({
      name: s.name,
      prompt: s.prompt,
      job_domain: s.job_domain || '',
      evaluation_dimensions: s.evaluation_dimensions.length ? [...s.evaluation_dimensions] : [...DEFAULT_DIMENSIONS],
      is_active: s.is_active,
    })
    setModal('edit')
  }

  function toggleDimension(dim: string) {
    setForm(f => ({
      ...f,
      evaluation_dimensions: f.evaluation_dimensions.includes(dim)
        ? f.evaluation_dimensions.filter(d => d !== dim)
        : [...f.evaluation_dimensions, dim],
    }))
  }

  async function save() {
    setSaving(true)
    try {
      if (modal === 'create') {
        await scenariosApi.create({
          name: form.name,
          prompt: form.prompt,
          evaluation_dimensions: form.evaluation_dimensions,
          job_domain: form.job_domain || undefined,
        })
        showToast('Scenario created')
      } else if (selected) {
        await scenariosApi.update(selected.scenario_id, {
          name: form.name,
          prompt: form.prompt,
          evaluation_dimensions: form.evaluation_dimensions,
          job_domain: form.job_domain || undefined,
          is_active: form.is_active,
        })
        showToast('Scenario updated')
      }
      setModal(null); reload()
    } catch (e) {
      showToast(errorMessage(e, 'Failed to save scenario'))
    }
    setSaving(false)
  }

  async function deleteScenario(s: Scenario) {
    if (!confirm(`Delete scenario "${s.name}"?`)) return
    try {
      await scenariosApi.delete(s.scenario_id)
      showToast('Scenario deleted')
      reload()
    } catch (e) { showToast(errorMessage(e, 'Failed to delete scenario')) }
  }

  return (
    <>
      <section className="ia-section card">
        <div className="card-header">
          <span className="card-title">Scenarios</span>
          <button className="btn btn-primary" onClick={openCreate}>+ Add Scenario</button>
        </div>
        {loading ? (
          <div className="ia-loading">Loading…</div>
        ) : (
          <div className="ia-table-wrap">
            <table className="ia-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Job Domain</th>
                  <th>Evaluation Dimensions</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {scenarios.length === 0 ? (
                  <tr><td colSpan={5} className="ia-empty">No scenarios yet.</td></tr>
                ) : scenarios.map(s => (
                  <tr key={s.scenario_id}>
                    <td className="ia-name" data-label="Name">{s.name}</td>
                    <td className="ia-muted" data-label="Job Domain">{s.job_domain || '-'}</td>
                    <td data-label="Evaluation Dimensions">
                      <div className="ia-tags">
                        {s.evaluation_dimensions.map(d => (
                          <span key={d} className="ia-tag">{DIMENSION_LABELS[d] || d}</span>
                        ))}
                      </div>
                    </td>
                    <td data-label="Status">
                      <span className={`badge ${s.is_active ? 'badge-green' : 'badge-gray'}`}>
                        {s.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td data-label="Actions">
                      <div className="ia-actions">
                        <button className="ia-action-btn" onClick={() => openEdit(s)}>Edit</button>
                        <button className="ia-action-btn ia-action-delete" onClick={() => deleteScenario(s)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal-box ia-modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{modal === 'create' ? 'Add Scenario' : `Edit - ${selected?.name}`}</h2>
              <button className="modal-close" onClick={() => setModal(null)}>✕</button>
            </div>
            <div className="ia-form">
              <label className="ia-field">
                <span className="form-label">Name *</span>
                <input className="form-input" value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. System Design Deep Dive" />
              </label>
              <label className="ia-field">
                <span className="form-label">Prompt *</span>
                <textarea className="form-input" rows={6} value={form.prompt}
                  onChange={e => setForm(f => ({ ...f, prompt: e.target.value }))}
                  placeholder="Describe the scenario the interviewer should present to the candidate…" />
              </label>
              <label className="ia-field">
                <span className="form-label">Job Domain</span>
                <input className="form-input" value={form.job_domain}
                  onChange={e => setForm(f => ({ ...f, job_domain: e.target.value }))}
                  placeholder="e.g. software_engineering - optional" />
              </label>
              <div className="ia-field">
                <span className="form-label">Evaluation Dimensions</span>
                <div className="ia-checkbox-grid">
                  {DEFAULT_DIMENSIONS.map(dim => (
                    <label key={dim} className="ia-checkbox">
                      <input type="checkbox"
                        checked={form.evaluation_dimensions.includes(dim)}
                        onChange={() => toggleDimension(dim)} />
                      <span>{DIMENSION_LABELS[dim]}</span>
                    </label>
                  ))}
                </div>
              </div>
              {modal === 'edit' && (
                <label className="ia-checkbox">
                  <input type="checkbox" checked={form.is_active}
                    onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />
                  <span>Active</span>
                </label>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={save}
                disabled={saving || !form.name.trim() || !form.prompt.trim()}>
                {saving ? 'Saving…' : modal === 'create' ? 'Create' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}


interface Condition { field: string; operator: string; value: string }

interface WorkflowRule {
  rule_id: string
  name: string
  trigger_type: string
  conditions: Condition[]
  action_type: string
  action_params: Record<string, unknown>
  is_active: boolean
}

const TRIGGER_TYPES = [
  'resume_processed', 'candidate_invited', 'candidate_status_changed',
  'interview_completed', 'offer_created', 'offer_status_changed',
]

const ACTION_TYPES = [
  'send_email', 'change_pipeline_stage', 'fire_webhook',
  'approve_offer', 'send_offer', 'withdraw_offer',
]

const ACTION_HELP: Record<string, string> = {
  send_email: 'Sends a reminder/follow-up (or the offer letter with email_kind="offer") to the candidate.',
  change_pipeline_stage: 'Moves the candidate to action_params.stage.',
  fire_webhook: 'Posts the trigger context to every matching webhook subscription.',
  approve_offer: 'Approves the offer in context (draft or pending_approval only). Pair with the offer_created trigger to auto-approve below a salary threshold.',
  send_offer: 'Emails an approved offer to the candidate. Pair with offer_status_changed + status eq approved.',
  withdraw_offer: 'Withdraws a non-terminal offer.',
}

const OFFER_TRIGGERS = new Set(['offer_created', 'offer_status_changed'])
const OFFER_ACTIONS = new Set(['approve_offer', 'send_offer', 'withdraw_offer'])

const OPERATORS = ['eq', 'neq', 'gte', 'lte', 'contains']

interface RuleForm {
  name: string
  trigger_type: string
  conditions: Condition[]
  action_type: string
  action_params_text: string
  is_active: boolean
}

function emptyCondition(): Condition {
  return { field: '', operator: 'eq', value: '' }
}

function emptyRuleForm(): RuleForm {
  return {
    name: '',
    trigger_type: TRIGGER_TYPES[0],
    conditions: [emptyCondition()],
    action_type: ACTION_TYPES[0],
    action_params_text: '{}',
    is_active: true,
  }
}

function WorkflowRulesTab({ rules, loading, reload, showToast }: TabProps & {
  rules: WorkflowRule[]
  loading: boolean
  reload: () => void
}) {
  const [modal, setModal] = useState<'create' | 'edit' | null>(null)
  const [selected, setSelected] = useState<WorkflowRule | null>(null)
  const [form, setForm] = useState<RuleForm>(emptyRuleForm())
  const [jsonError, setJsonError] = useState('')
  const [saving, setSaving] = useState(false)
  const [remindersLoading, setRemindersLoading] = useState(false)

  const [testFor, setTestFor] = useState<WorkflowRule | null>(null)
  const [testContext, setTestContext] = useState('{}')
  const [testResult, setTestResult] = useState<string | null>(null)
  const [testError, setTestError] = useState('')
  const [testing, setTesting] = useState(false)

  function openCreate() {
    setForm(emptyRuleForm())
    setSelected(null)
    setJsonError('')
    setModal('create')
  }

  function openEdit(r: WorkflowRule) {
    setSelected(r)
    setForm({
      name: r.name,
      trigger_type: r.trigger_type,
      conditions: (r.conditions ?? []).length ? [...r.conditions] : [emptyCondition()],
      action_type: r.action_type,
      action_params_text: JSON.stringify(r.action_params ?? {}, null, 2),
      is_active: r.is_active,
    })
    setJsonError('')
    setModal('edit')
  }

  function updateCondition(i: number, k: keyof Condition, v: string) {
    setForm(f => ({
      ...f,
      conditions: f.conditions.map((c, idx) => idx === i ? { ...c, [k]: v } : c),
    }))
  }

  function addCondition() {
    setForm(f => ({ ...f, conditions: [...f.conditions, emptyCondition()] }))
  }

  function removeCondition(i: number) {
    setForm(f => ({ ...f, conditions: f.conditions.filter((_, idx) => idx !== i) }))
  }

  function validateJson(text: string): Record<string, unknown> | null {
    try {
      const parsed = JSON.parse(text)
      setJsonError('')
      return parsed
    } catch {
      setJsonError('action_params must be valid JSON')
      return null
    }
  }

  async function save() {
    const params = validateJson(form.action_params_text)
    if (params === null) return
    setSaving(true)
    try {
      const payload = {
        name: form.name,
        trigger_type: form.trigger_type,
        conditions: form.conditions.filter(c => c.field.trim()),
        action_type: form.action_type,
        action_params: params,
        ...(modal === 'edit' ? { is_active: form.is_active } : {}),
      }
      if (modal === 'create') {
        await workflowsApi.create(payload)
        showToast('Workflow rule created')
      } else if (selected) {
        await workflowsApi.update(selected.rule_id, payload)
        showToast('Workflow rule updated')
      }
      setModal(null); reload()
    } catch (e) {
      showToast(errorMessage(e, 'Failed to save rule'))
    }
    setSaving(false)
  }

  async function deleteRule(r: WorkflowRule) {
    if (!confirm(`Delete workflow rule "${r.name}"?`)) return
    try {
      await workflowsApi.delete(r.rule_id)
      showToast('Workflow rule deleted')
      reload()
    } catch (e) { showToast(errorMessage(e, 'Failed to delete rule')) }
  }

  function openTest(r: WorkflowRule) {
    setTestFor(r)
    setTestContext('{}')
    setTestResult(null)
    setTestError('')
  }

  async function runTest() {
    if (!testFor) return
    let context: Record<string, unknown>
    try {
      context = JSON.parse(testContext)
    } catch {
      setTestError('Context must be valid JSON')
      return
    }
    setTestError('')
    setTesting(true)
    try {
      const r = await workflowsApi.test(testFor.rule_id, context)
      setTestResult(r.data.matched ? 'Matched: true' : 'Matched: false')
    } catch {
      setTestError('Test request failed')
    }
    setTesting(false)
  }

  async function sendReminders() {
    setRemindersLoading(true)
    try {
      const r = await workflowsApi.runReminders()
      showToast(`Reminders sent: ${r.data.sent ?? 0}`)
    } catch (e) { showToast(errorMessage(e, 'Failed to send reminders')) }
    setRemindersLoading(false)
  }

  return (
    <>
      <section className="ia-section card">
        <div className="card-header">
          <span className="card-title">Rules</span>
          <div className="ia-actions">
            <button className="btn btn-secondary" onClick={sendReminders} disabled={remindersLoading}>
              {remindersLoading ? 'Sending…' : 'Send Pending Reminders Now'}
            </button>
            <button className="btn btn-primary" onClick={openCreate}>+ Add Rule</button>
          </div>
        </div>
        {loading ? (
          <div className="ia-loading">Loading…</div>
        ) : (
          <div className="ia-table-wrap">
            <table className="ia-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Trigger</th>
                  <th>Action</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rules.length === 0 ? (
                  <tr><td colSpan={5} className="ia-empty">No workflow rules yet.</td></tr>
                ) : rules.map(r => (
                  <tr key={r.rule_id}>
                    <td className="ia-name" data-label="Name">{r.name}</td>
                    <td className="ia-mono" data-label="Trigger">{r.trigger_type}</td>
                    <td className="ia-mono" data-label="Action">{r.action_type}</td>
                    <td data-label="Status">
                      <span className={`badge ${r.is_active ? 'badge-green' : 'badge-gray'}`}>
                        {r.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td data-label="Actions">
                      <div className="ia-actions">
                        <button className="ia-action-btn" onClick={() => openTest(r)}>Test</button>
                        <button className="ia-action-btn" onClick={() => openEdit(r)}>Edit</button>
                        <button className="ia-action-btn ia-action-delete" onClick={() => deleteRule(r)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal-box ia-modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{modal === 'create' ? 'Add Rule' : `Edit - ${selected?.name}`}</h2>
              <button className="modal-close" onClick={() => setModal(null)}>✕</button>
            </div>
            <div className="ia-form">
              <label className="ia-field">
                <span className="form-label">Name *</span>
                <input className="form-input" value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Auto-invite high scorers" />
              </label>

              <label className="ia-field">
                <span className="form-label">Trigger Type</span>
                <select className="form-input" value={form.trigger_type}
                  onChange={e => setForm(f => ({ ...f, trigger_type: e.target.value }))}>
                  {TRIGGER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>

              <div className="ia-field">
                <span className="form-label">Conditions</span>
                <div className="ia-conditions">
                  {form.conditions.map((c, i) => (
                    <div key={i} className="ia-condition-row">
                      <input className="form-input" placeholder="field"
                        value={c.field} onChange={e => updateCondition(i, 'field', e.target.value)} />
                      <select className="form-input" value={c.operator}
                        onChange={e => updateCondition(i, 'operator', e.target.value)}>
                        {OPERATORS.map(op => <option key={op} value={op}>{op}</option>)}
                      </select>
                      <input className="form-input" placeholder="value"
                        value={c.value} onChange={e => updateCondition(i, 'value', e.target.value)} />
                      <button type="button" className="ia-condition-remove"
                        onClick={() => removeCondition(i)}
                        disabled={form.conditions.length <= 1}>✕</button>
                    </div>
                  ))}
                  <button type="button" className="ia-add-row" onClick={addCondition}>
                    + Add Condition
                  </button>
                </div>
              </div>

              <label className="ia-field">
                <span className="form-label">Action Type</span>
                <select className="form-input" value={form.action_type}
                  onChange={e => setForm(f => ({ ...f, action_type: e.target.value }))}>
                  {ACTION_TYPES.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
                {ACTION_HELP[form.action_type] && (
                  <span className="ia-field-help">{ACTION_HELP[form.action_type]}</span>
                )}
                {OFFER_ACTIONS.has(form.action_type) && !OFFER_TRIGGERS.has(form.trigger_type) && (
                  <span className="ia-field-warn">
                    ⚠ This action needs an offer_id, which only the{' '}
                    <strong>offer_created</strong> and <strong>offer_status_changed</strong>{' '}
                    triggers provide. On “{form.trigger_type}” it will be skipped every time
                    unless you put an explicit offer_id in Action Params.
                  </span>
                )}
              </label>

              <label className="ia-field">
                <span className="form-label">Action Params (JSON)</span>
                <textarea className="form-input ia-json-area" rows={5}
                  value={form.action_params_text}
                  onChange={e => { setForm(f => ({ ...f, action_params_text: e.target.value })); validateJson(e.target.value) }}
                  placeholder='{"template": "invite"}' />
                {jsonError && <div className="ia-form-error">{jsonError}</div>}
              </label>

              {modal === 'edit' && (
                <label className="ia-checkbox">
                  <input type="checkbox" checked={form.is_active}
                    onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />
                  <span>Active</span>
                </label>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={save}
                disabled={saving || !form.name.trim() || !!jsonError}>
                {saving ? 'Saving…' : modal === 'create' ? 'Create' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {testFor && (
        <div className="modal-overlay" onClick={() => setTestFor(null)}>
          <div className="modal-box ia-modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Test Rule - {testFor.name}</h2>
              <button className="modal-close" onClick={() => setTestFor(null)}>✕</button>
            </div>
            <div className="ia-form">
              <label className="ia-field">
                <span className="form-label">Context (JSON)</span>
                <textarea className="form-input ia-json-area" rows={6}
                  value={testContext} onChange={e => setTestContext(e.target.value)}
                  placeholder='{"match_score": 0.82}' />
              </label>
              {testError && <div className="ia-form-error">{testError}</div>}
              {testResult && <div className="ia-test-result">{testResult}</div>}
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setTestFor(null)}>Close</button>
              <button className="btn btn-primary" onClick={runTest} disabled={testing}>
                {testing ? 'Running…' : 'Run Test'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}


const LANGUAGE_KEYS = ['python', 'javascript'] as const

const DEFAULT_TEMPLATES: Record<string, string> = {
  python: '# Write your solution here\n',
  javascript: '// Write your solution here\n',
}

interface QuestionForm {
  title: string
  description: string
  job_domain: string
  difficulty: string
  language_templates: Record<string, string>
  test_cases: CodingTestCase[]
}

function emptyQuestionForm(): QuestionForm {
  return {
    title: '',
    description: '',
    job_domain: '',
    difficulty: 'medium',
    language_templates: { ...DEFAULT_TEMPLATES },
    test_cases: [{ input: '', expected_output: '', is_hidden: false }],
  }
}

const difficultyBadge = (d: string) =>
  d === 'easy' ? 'badge-green' : d === 'hard' ? 'badge-red' : 'badge-yellow'

function CodingQuestionsTab({ questions, loading, reload, showToast }: TabProps & {
  questions: CodingQuestion[]
  loading: boolean
  reload: () => void
}) {
  const [modal, setModal] = useState<'create' | 'edit' | null>(null)
  const [selected, setSelected] = useState<CodingQuestion | null>(null)
  const [form, setForm] = useState<QuestionForm>(emptyQuestionForm())
  const [saving, setSaving] = useState(false)

  function openCreate() {
    setForm(emptyQuestionForm())
    setSelected(null)
    setModal('create')
  }

  function openEdit(q: CodingQuestion) {
    setSelected(q)
    setForm({
      title: q.title,
      description: q.description,
      job_domain: q.job_domain || '',
      difficulty: q.difficulty,
      language_templates: { ...DEFAULT_TEMPLATES, ...q.language_templates },
      test_cases: (q.test_cases ?? []).length
        ? q.test_cases.map(tc => ({ ...tc }))
        : [{ input: '', expected_output: '', is_hidden: false }],
    })
    setModal('edit')
  }

  function setTemplate(lang: string, value: string) {
    setForm(f => ({ ...f, language_templates: { ...f.language_templates, [lang]: value } }))
  }

  function addTestCase() {
    setForm(f => ({ ...f, test_cases: [...f.test_cases, { input: '', expected_output: '', is_hidden: false }] }))
  }

  function removeTestCase(idx: number) {
    setForm(f => ({ ...f, test_cases: f.test_cases.filter((_, i) => i !== idx) }))
  }

  function updateTestCase(idx: number, patch: Partial<CodingTestCase>) {
    setForm(f => ({
      ...f,
      test_cases: f.test_cases.map((tc, i) => (i === idx ? { ...tc, ...patch } : tc)),
    }))
  }

  async function save() {
    setSaving(true)
    try {
      const payload = {
        title: form.title,
        description: form.description,
        job_domain: form.job_domain || undefined,
        difficulty: form.difficulty,
        language_templates: form.language_templates,
        test_cases: form.test_cases,
      }
      if (modal === 'create') {
        await codingApi.createQuestion(payload)
        showToast('Coding question created')
      } else if (selected) {
        await codingApi.updateQuestion(selected.question_id, payload)
        showToast('Coding question updated')
      }
      setModal(null); reload()
    } catch (e) {
      showToast(errorMessage(e, 'Failed to save coding question'))
    }
    setSaving(false)
  }

  async function deleteQuestion(q: CodingQuestion) {
    if (!confirm(`Delete coding question "${q.title}"?`)) return
    try {
      await codingApi.deleteQuestion(q.question_id)
      showToast('Coding question deleted')
      reload()
    } catch (e) { showToast(errorMessage(e, 'Failed to delete coding question')) }
  }

  return (
    <>
      <section className="ia-section card">
        <div className="card-header">
          <span className="card-title">Questions</span>
          <button className="btn btn-primary" onClick={openCreate}>+ Add Question</button>
        </div>
        {loading ? (
          <div className="ia-loading">Loading…</div>
        ) : (
          <div className="ia-table-wrap">
            <table className="ia-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Job Domain</th>
                  <th>Difficulty</th>
                  <th>Languages</th>
                  <th>Test Cases</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {questions.length === 0 ? (
                  <tr><td colSpan={6} className="ia-empty">No coding questions yet.</td></tr>
                ) : questions.map(q => (
                  <tr key={q.question_id}>
                    <td className="ia-name" data-label="Title">{q.title}</td>
                    <td className="ia-muted" data-label="Job Domain">{q.job_domain || '-'}</td>
                    <td data-label="Difficulty"><span className={`badge ${difficultyBadge(q.difficulty)}`}>{q.difficulty}</span></td>
                    <td className="ia-muted" data-label="Languages">{Object.keys(q.language_templates || {}).join(', ') || '-'}</td>
                    <td data-label="Test Cases">{q.test_cases?.length ?? 0}</td>
                    <td data-label="Actions">
                      <div className="ia-actions">
                        <button className="ia-action-btn" onClick={() => openEdit(q)}>Edit</button>
                        <button className="ia-action-btn ia-action-delete" onClick={() => deleteQuestion(q)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal-box ia-modal-box-wide" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{modal === 'create' ? 'Add Coding Question' : `Edit - ${selected?.title}`}</h2>
              <button className="modal-close" onClick={() => setModal(null)}>✕</button>
            </div>
            <div className="ia-form">
              <label className="ia-field">
                <span className="form-label">Title *</span>
                <input className="form-input" value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="e.g. Two Sum" />
              </label>

              <label className="ia-field">
                <span className="form-label">Description *</span>
                <textarea className="form-input" rows={4} value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Problem statement shown to the candidate…" />
              </label>

              <div className="ia-field-row">
                <label className="ia-field">
                  <span className="form-label">Job Domain</span>
                  <input className="form-input" value={form.job_domain}
                    onChange={e => setForm(f => ({ ...f, job_domain: e.target.value }))}
                    placeholder="e.g. software_engineering - optional" />
                </label>
                <label className="ia-field">
                  <span className="form-label">Difficulty</span>
                  <select className="form-input" value={form.difficulty}
                    onChange={e => setForm(f => ({ ...f, difficulty: e.target.value }))}>
                    <option value="easy">Easy</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Hard</option>
                  </select>
                </label>
              </div>

              <div className="ia-field">
                <span className="form-label">Starter Code by Language</span>
                <div className="ia-templates">
                  {LANGUAGE_KEYS.map(lang => (
                    <div key={lang} className="ia-template-block">
                      <div className="ia-template-lang">{lang}</div>
                      <textarea
                        className="form-input ia-code-input"
                        rows={5}
                        value={form.language_templates[lang] ?? ''}
                        onChange={e => setTemplate(lang, e.target.value)}
                        spellCheck={false}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="ia-field">
                <div className="ia-subhead">
                  <span className="form-label">Test Cases</span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={addTestCase}>+ Add Test Case</button>
                </div>
                <div className="ia-case-list">
                  {form.test_cases.map((tc, idx) => (
                    <div key={idx} className="ia-case">
                      <div className="ia-case-inputs">
                        <label className="ia-case-col">
                          <span className="ia-case-label">Input</span>
                          <textarea className="form-input ia-code-input" rows={2}
                            value={tc.input}
                            onChange={e => updateTestCase(idx, { input: e.target.value })} />
                        </label>
                        <label className="ia-case-col">
                          <span className="ia-case-label">Expected Output</span>
                          <textarea className="form-input ia-code-input" rows={2}
                            value={tc.expected_output}
                            onChange={e => updateTestCase(idx, { expected_output: e.target.value })} />
                        </label>
                      </div>
                      <div className="ia-case-footer">
                        <label className="ia-checkbox">
                          <input type="checkbox" checked={tc.is_hidden}
                            onChange={e => updateTestCase(idx, { is_hidden: e.target.checked })} />
                          <span>Hidden test (not shown to candidate)</span>
                        </label>
                        <button type="button" className="ia-action-btn ia-action-delete"
                          onClick={() => removeTestCase(idx)}
                          disabled={form.test_cases.length <= 1}>
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={save}
                disabled={saving || !form.title.trim() || !form.description.trim()}>
                {saving ? 'Saving…' : modal === 'create' ? 'Create' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}


const PAGE_SIZE = 25

function scoreBadge(score: number) {
  if (score >= 80) return 'badge-green'
  if (score >= 50) return 'badge-yellow'
  return 'badge-red'
}

const COMPLEXITY_BADGE: Record<string, string> = {
  low: 'badge-green',
  moderate: 'badge-gray',
  high: 'badge-yellow',
  very_high: 'badge-yellow',
}

function SubmissionsTab({ candidateIdParam, onCandidateIdChange }: {
  candidateIdParam: string
  onCandidateIdChange: (id: string) => void
}) {
  const [candidateIdInput, setCandidateIdInput] = useState(candidateIdParam)
  const [flaggedOnly, setFlaggedOnly] = useState(false)
  const [page, setPage] = useState(1)
  const [submissions, setSubmissions] = useState<CodingSubmission[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => { setCandidateIdInput(candidateIdParam) }, [candidateIdParam])
  useEffect(() => { setPage(1) }, [candidateIdParam, flaggedOnly])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError('')
      try {
        const r = await codingApi.listSubmissions({
          candidate_id: candidateIdParam || undefined,
          flagged: flaggedOnly || undefined,
          page,
          limit: PAGE_SIZE,
        })
        if (cancelled) return
        setSubmissions(r.data.submissions ?? [])
        setTotal(r.data.total ?? 0)
      } catch {
        if (cancelled) return
        setError('Failed to load coding submissions')
        setSubmissions([])
        setTotal(0)
      }
      if (!cancelled) setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [candidateIdParam, flaggedOnly, page])

  function onSearch(e: React.FormEvent) {
    e.preventDefault()
    onCandidateIdChange(candidateIdInput.trim())
  }

  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <>
      <section className="ia-section card">
        <div className="card-header">
          <span className="card-title">Filter</span>
        </div>
        <form className="ia-filters" onSubmit={onSearch}>
          <input
            className="form-input"
            value={candidateIdInput}
            onChange={e => setCandidateIdInput(e.target.value)}
            placeholder="Filter by candidate_id - leave blank for all"
          />
          <button className="btn btn-primary" type="submit">Apply</button>
          {candidateIdParam && (
            <button type="button" className="btn btn-ghost" onClick={() => onCandidateIdChange('')}>
              Clear
            </button>
          )}
          <label className="ia-checkbox">
            <input type="checkbox" checked={flaggedOnly}
              onChange={e => setFlaggedOnly(e.target.checked)} />
            <span>Similarity-flagged only</span>
          </label>
        </form>
      </section>

      <section className="ia-section card">
        <div className="card-header">
          <span className="card-title">
            {candidateIdParam ? `Submissions for ${candidateIdParam}` : 'All submissions'}
          </span>
          {!loading && !error && <span className="ia-muted">{total} total</span>}
        </div>

        {loading ? (
          <div className="ia-loading">Loading…</div>
        ) : error ? (
          <div className="ia-empty">{error}</div>
        ) : submissions.length === 0 ? (
          <div className="ia-empty">
            {candidateIdParam || flaggedOnly
              ? 'No coding submissions match these filters.'
              : 'No coding submissions yet.'}
          </div>
        ) : (
          <>
            <div className="ia-list">
              {submissions.map(s => {
                const isOpen = expanded === s.submission_id
                const hiddenResults = s.results.filter(r => r.is_hidden)
                const visibleResults = s.results.filter(r => !r.is_hidden)
                const hiddenPassed = hiddenResults.filter(r => r.passed).length
                return (
                  <div key={s.submission_id} className="ia-item">
                    <button
                      className="ia-item-header"
                      onClick={() => setExpanded(isOpen ? null : s.submission_id)}
                    >
                      <div className="ia-item-main">
                        <span className="ia-item-title">
                          {s.candidate_name || s.candidate_email || s.candidate_id}
                        </span>
                        <span className="ia-item-sub">
                          {s.question_title || s.question_id}
                          {' · '}
                          <span className="ia-item-lang">{s.language}</span>
                          {' · '}
                          {new Date(s.submitted_at).toLocaleString()}
                        </span>
                      </div>
                      <div className="ia-item-meta">
                        <span className={`badge ${s.status === 'completed' ? 'badge-green' : s.status === 'error' ? 'badge-red' : 'badge-gray'}`}>
                          {s.status}
                        </span>
                        <span className={`badge ${scoreBadge(s.score)}`}>{s.score}%</span>
                        {s.quality_score != null && (
                          <span className={`badge ${scoreBadge(s.quality_score)}`} title="AI code-quality review">
                            Q {s.quality_score}
                          </span>
                        )}
                        {s.plagiarism_flagged && (
                          <span className="badge badge-red" title="Highly similar to another candidate's submission">
                            ⚠ Similarity
                          </span>
                        )}
                        <span className="ia-caret">{isOpen ? '▲' : '▼'}</span>
                      </div>
                    </button>

                    {isOpen && (
                      <div className="ia-item-body">
                        {s.plagiarism && s.plagiarism.checked_against > 0 && (
                          <div className={`ia-analysis ${s.plagiarism.flagged ? 'ia-analysis-alert' : ''}`}>
                            <div className="ia-results-label">
                              Similarity check
                              <span className="ia-analysis-sub">
                                {' '}- compared against {s.plagiarism.checked_against} other candidate
                                {s.plagiarism.checked_against === 1 ? '' : 's'} on this question
                                {s.plagiarism.truncated ? ' (most recent only)' : ''}
                              </span>
                            </div>
                            <div className="ia-metric-row">
                              <span className="ia-metric">
                                <span className="ia-metric-val">
                                  {Math.round(s.plagiarism.max_similarity * 100)}%
                                </span>
                                <span className="ia-metric-label">overall overlap</span>
                              </span>
                              <span className="ia-metric">
                                <span className="ia-metric-val">
                                  {Math.round((s.plagiarism.max_containment ?? 0) * 100)}%
                                </span>
                                <span className="ia-metric-label">contained in another</span>
                              </span>
                              <span className="ia-metric">
                                <span className="ia-metric-val">
                                  {Math.round(s.plagiarism.threshold * 100)}%
                                </span>
                                <span className="ia-metric-label">flag threshold</span>
                              </span>
                            </div>
                            {s.plagiarism.matches.length > 0 && (
                              <div className="ia-match-list">
                                {s.plagiarism.matches.map(m => (
                                  <div key={m.submission_id} className="ia-match-row">
                                    <span className="ia-match-pct">
                                      {Math.round((m.score ?? m.similarity) * 100)}%
                                    </span>
                                    <code className="ia-match-id">{m.candidate_id}</code>
                                    {m.identical_normalized && (
                                      <span className="badge badge-red">identical</span>
                                    )}
                                    {m.one_sided && !m.identical_normalized && (
                                      <span className="badge badge-yellow" title="This submission is largely contained in the other, padded with extra code">
                                        contained + padded
                                      </span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                            {s.plagiarism.comparable === false && (
                              <p className="ia-analysis-note">
                                This submission is too short for a similarity score to mean anything -
                                short answers converge by construction - so it is reported but never flagged.
                              </p>
                            )}
                            <p className="ia-analysis-note">
                              Structural comparison after stripping comments and normalising names, so
                              renaming variables or reformatting does not lower it. “Contained in another”
                              catches a verbatim copy padded out with extra code, which overall overlap
                              alone misses. Treat a flag as a prompt to review, not as proof.
                            </p>
                          </div>
                        )}

                        {s.complexity?.cyclomatic_complexity != null && (
                          <div className="ia-analysis">
                            <div className="ia-results-label">
                              Complexity
                              {s.complexity.complexity_band && (
                                <span className={`badge ${COMPLEXITY_BADGE[s.complexity.complexity_band] || 'badge-gray'}`}>
                                  {s.complexity.complexity_band.replace('_', ' ')}
                                </span>
                              )}
                            </div>
                            <div className="ia-metric-row">
                              {([
                                ['cyclomatic', s.complexity.cyclomatic_complexity],
                                ['max nesting', s.complexity.max_nesting_depth],
                                ['lines of code', s.complexity.lines_of_code],
                                ['functions', s.complexity.function_count],
                              ] as [string, number | undefined][]).map(([label, val]) => (
                                <span key={label} className="ia-metric">
                                  <span className="ia-metric-val">{val ?? '-'}</span>
                                  <span className="ia-metric-label">{label}</span>
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {s.quality && (
                          <div className="ia-analysis">
                            <div className="ia-results-label">
                              AI code-quality review
                              {s.quality.overall_quality_score != null && (
                                <span className={`badge ${scoreBadge(s.quality.overall_quality_score)}`}>
                                  {s.quality.overall_quality_score}/100
                                </span>
                              )}
                            </div>
                            <div className="ia-metric-row">
                              {([
                                ['readability', s.quality.readability_score],
                                ['structure', s.quality.structure_score],
                                ['efficiency', s.quality.efficiency_score],
                                ['idiomatic', s.quality.idiomatic_score],
                                ['problem solving', s.quality.problem_solving_score],
                              ] as [string, number | undefined][]).map(([label, val]) => (
                                <span key={label} className="ia-metric">
                                  <span className="ia-metric-val">{val ?? '-'}</span>
                                  <span className="ia-metric-label">{label}</span>
                                </span>
                              ))}
                            </div>
                            {s.quality.approach_summary && (
                              <p className="ia-analysis-note">{s.quality.approach_summary}</p>
                            )}
                            {s.quality.feedback_for_recruiter && (
                              <p className="ia-analysis-note"><strong>For the recruiter:</strong> {s.quality.feedback_for_recruiter}</p>
                            )}
                            {(!!s.quality.strengths?.length || !!s.quality.concerns?.length) && (
                              <div className="ia-quality-lists">
                                {!!s.quality.strengths?.length && (
                                  <div>
                                    <h5>Strengths</h5>
                                    <ul>{s.quality.strengths.map((t, i) => <li key={i}>{t}</li>)}</ul>
                                  </div>
                                )}
                                {!!s.quality.concerns?.length && (
                                  <div>
                                    <h5>Concerns</h5>
                                    <ul>{s.quality.concerns.map((t, i) => <li key={i}>{t}</li>)}</ul>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        <div className="ia-code-block">
                          <div className="ia-code-label">Submitted Code</div>
                          <pre className="ia-code">{s.code || '(not stored)'}</pre>
                        </div>

                        <div className="ia-results-block">
                          <div className="ia-results-label">Visible Test Cases</div>
                          {visibleResults.length === 0 ? (
                            <div className="ia-empty-small">None</div>
                          ) : visibleResults.map(r => (
                            <div key={r.test_case_index} className={`ia-result-row ${r.passed ? 'ia-pass' : 'ia-fail'}`}>
                              <span className="ia-result-badge">{r.passed ? 'PASS' : 'FAIL'}</span>
                              <div className="ia-result-detail">
                                <div><strong>Expected:</strong> <code>{r.expected_output}</code></div>
                                <div><strong>Actual:</strong> <code>{r.actual_output}</code></div>
                              </div>
                            </div>
                          ))}
                        </div>

                        <div className="ia-results-block">
                          <div className="ia-results-label">
                            Hidden Test Cases - {hiddenPassed} of {hiddenResults.length} passed
                          </div>
                          {hiddenResults.map(r => (
                            <div key={r.test_case_index} className={`ia-result-row ${r.passed ? 'ia-pass' : 'ia-fail'}`}>
                              <span className="ia-result-badge">{r.passed ? 'PASS' : 'FAIL'}</span>
                              <div className="ia-result-detail">
                                <div><strong>Expected:</strong> <code>{r.expected_output}</code></div>
                                <div><strong>Actual:</strong> <code>{r.actual_output}</code></div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {total > PAGE_SIZE && (
              <div className="ia-pager">
                <span>Page {page} of {lastPage}</span>
                <button className="ia-action-btn" disabled={page <= 1}
                  onClick={() => setPage(p => Math.max(1, p - 1))}>← Previous</button>
                <button className="ia-action-btn" disabled={page >= lastPage}
                  onClick={() => setPage(p => p + 1)}>Next →</button>
              </div>
            )}
          </>
        )}
      </section>
    </>
  )
}


const TABS = ['scenarios', 'workflows', 'questions', 'submissions'] as const
type Tab = typeof TABS[number]

const TAB_LABELS: Record<Tab, string> = {
  scenarios: 'Scenarios',
  workflows: 'Workflow Rules',
  questions: 'Coding Questions',
  submissions: 'Submissions',
}

const TAB_SUBTITLES: Record<Tab, string> = {
  scenarios: 'Scenario-based interview prompts and the dimensions each one is evaluated on',
  workflows: 'Automate actions based on recruitment pipeline events',
  questions: 'The AI coding assessment question bank - starter code, test cases, and difficulty',
  submissions: 'Candidate coding submissions with hidden-test detail, similarity and AI quality review',
}

function isTab(value: string | null): value is Tab {
  return !!value && (TABS as readonly string[]).includes(value)
}

export default function InterviewAutomationPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const rawTab = searchParams.get('tab')
  const tab: Tab = isTab(rawTab) ? rawTab : 'scenarios'
  const candidateIdParam = searchParams.get('candidate_id') || ''

  function setTab(next: Tab) {
    const params: Record<string, string> = next === 'scenarios' ? {} : { tab: next }
    if (next === 'submissions' && candidateIdParam) params.candidate_id = candidateIdParam
    setSearchParams(params, { replace: true })
  }

  function setCandidateId(id: string) {
    const params: Record<string, string> = { tab: 'submissions' }
    if (id) params.candidate_id = id
    setSearchParams(params, { replace: true })
  }

  const [toast, setToast] = useState('')
  const showToast = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }, [])

  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [rules, setRules] = useState<WorkflowRule[]>([])
  const [questions, setQuestions] = useState<CodingQuestion[]>([])
  const [loading, setLoading] = useState(true)

  const loadScenarios = useCallback(async () => {
    try {
      const r = await scenariosApi.list()
      setScenarios(r.data.scenarios ?? [])
    } catch {}
  }, [])

  const loadRules = useCallback(async () => {
    try {
      const r = await workflowsApi.list()
      setRules(r.data.rules || r.data.results || [])
    } catch {}
  }, [])

  const loadQuestions = useCallback(async () => {
    try {
      const r = await codingApi.listQuestions()
      setQuestions(r.data.questions ?? [])
    } catch {}
  }, [])

  useEffect(() => {
    let cancelled = false
    Promise.all([loadScenarios(), loadRules(), loadQuestions()]).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [loadScenarios, loadRules, loadQuestions])

  const counts: Partial<Record<Tab, number>> = loading
    ? {}
    : { scenarios: scenarios.length, workflows: rules.length, questions: questions.length }

  return (
    <div className="ia-page">
      {toast && <div className="ia-toast">{toast}</div>}

      <div className="page-header">
        <div>
          <div className="page-title">Interview &amp; Automation</div>
          <div className="page-sub">{TAB_SUBTITLES[tab]}</div>
        </div>
      </div>

      <div className="adm-tabs" role="tablist">
        {TABS.map(t => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={`adm-tab${tab === t ? ' adm-tab-active' : ''}`}
            onClick={() => setTab(t)}
          >
            {TAB_LABELS[t]}
            {counts[t] != null && <span className="adm-tab-count">{counts[t]}</span>}
          </button>
        ))}
      </div>

      <div className="ia-body">
        {tab === 'scenarios' && (
          <ScenariosTab scenarios={scenarios} loading={loading} reload={loadScenarios} showToast={showToast} />
        )}
        {tab === 'workflows' && (
          <WorkflowRulesTab rules={rules} loading={loading} reload={loadRules} showToast={showToast} />
        )}
        {tab === 'questions' && (
          <CodingQuestionsTab questions={questions} loading={loading} reload={loadQuestions} showToast={showToast} />
        )}
        {tab === 'submissions' && (
          <SubmissionsTab candidateIdParam={candidateIdParam} onCandidateIdChange={setCandidateId} />
        )}
      </div>
    </div>
  )
}
