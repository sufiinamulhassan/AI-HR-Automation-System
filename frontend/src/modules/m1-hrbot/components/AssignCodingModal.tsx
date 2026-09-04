import { useEffect, useMemo, useState } from 'react'
import { codingApi, type CodingQuestion } from '../../../lib/codingApi'
import './AssignCodingModal.css'

interface Props {
  candidateId: string
  candidateName?: string
  jobDomain?: string
  onClose: () => void
}

type Mode = 'existing' | 'generate'

function difficultyBadge(d: string) {
  return d === 'easy' ? 'badge-green' : d === 'hard' ? 'badge-red' : 'badge-yellow'
}

export default function AssignCodingModal({ candidateId, candidateName, jobDomain, onClose }: Props) {
  const [mode, setMode] = useState<Mode>('existing')

  const [questions, setQuestions] = useState<CodingQuestion[]>([])
  const [loadingQuestions, setLoadingQuestions] = useState(true)
  const [selectedQuestionId, setSelectedQuestionId] = useState('')

  const [genForm, setGenForm] = useState({
    job_domain: jobDomain || '',
    difficulty: 'medium',
    topic_hint: '',
  })
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState('')
  const [generated, setGenerated] = useState<CodingQuestion | null>(null)

  const [assigning, setAssigning] = useState(false)
  const [assignedResult, setAssignedResult] = useState<{ email_sent: boolean } | null>(null)
  const [toast, setToast] = useState('')

  useEffect(() => { loadQuestions() }, [])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 3500)
  }

  async function loadQuestions() {
    setLoadingQuestions(true)
    try {
      const r = await codingApi.listQuestions({ limit: 100 })
      setQuestions(r.data.questions ?? [])
    } catch {
      setQuestions([])
    }
    setLoadingQuestions(false)
  }

  const selectedFromBank = useMemo(
    () => questions.find(q => q.question_id === selectedQuestionId) || null,
    [questions, selectedQuestionId]
  )
  const preview = generated && generated.question_id === selectedQuestionId ? generated : selectedFromBank

  function selectExisting(id: string) {
    setSelectedQuestionId(id)
    setGenerated(null)
    setAssignedResult(null)
  }

  async function handleGenerate() {
    if (!genForm.job_domain.trim()) return
    setGenerating(true)
    setGenError('')
    setAssignedResult(null)
    try {
      const r = await codingApi.generateQuestion({
        job_domain: genForm.job_domain.trim(),
        difficulty: genForm.difficulty,
        topic_hint: genForm.topic_hint.trim() || undefined,
      })
      const q = r.data as CodingQuestion
      setGenerated(q)
      setSelectedQuestionId(q.question_id)
      loadQuestions()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      setGenError(err?.response?.data?.detail || 'AI question generation failed - please try again')
    }
    setGenerating(false)
  }

  async function handleAssign() {
    if (!selectedQuestionId) return
    setAssigning(true)
    try {
      const r = await codingApi.assignQuestion(candidateId, selectedQuestionId)
      const emailSent = !!r.data?.email_sent
      setAssignedResult({ email_sent: emailSent })
      showToast(emailSent
        ? 'Question assigned - coding assessment invite email sent'
        : 'Question assigned - email could not be sent (see Communication log)')
    } catch {
      showToast('Failed to assign coding question')
    }
    setAssigning(false)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box acm-modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Assign Coding Question{candidateName ? ` - ${candidateName}` : ''}</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="acm-body">
          {toast && <div className="acm-toast">{toast}</div>}

          <div className="acm-tabs">
            <button
              className={`acm-tab${mode === 'existing' ? ' acm-tab-active' : ''}`}
              onClick={() => setMode('existing')}
            >
              Pick from Bank
            </button>
            <button
              className={`acm-tab${mode === 'generate' ? ' acm-tab-active' : ''}`}
              onClick={() => setMode('generate')}
            >
              Generate with AI
            </button>
          </div>

          {mode === 'existing' && (
            <div className="acm-section">
              {loadingQuestions ? (
                <div className="acm-loading">Loading question bank…</div>
              ) : questions.length === 0 ? (
                <div className="acm-empty">No coding questions yet - try Generate with AI, or add one from the Coding Questions admin page.</div>
              ) : (
                <select
                  className="form-input"
                  value={selectedQuestionId}
                  onChange={e => selectExisting(e.target.value)}
                >
                  <option value="">- Select a question -</option>
                  {questions.map(q => (
                    <option key={q.question_id} value={q.question_id}>
                      {q.title} · {q.job_domain || 'any domain'} · {q.difficulty}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {mode === 'generate' && (
            <div className="acm-section">
              <div className="acm-gen-form">
                <label className="acm-field">
                  <span className="form-label">Job Domain *</span>
                  <input
                    className="form-input"
                    value={genForm.job_domain}
                    onChange={e => setGenForm(f => ({ ...f, job_domain: e.target.value }))}
                    placeholder="e.g. software_engineering"
                  />
                </label>
                <label className="acm-field">
                  <span className="form-label">Difficulty</span>
                  <select
                    className="form-input"
                    value={genForm.difficulty}
                    onChange={e => setGenForm(f => ({ ...f, difficulty: e.target.value }))}
                  >
                    <option value="easy">Easy</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Hard</option>
                  </select>
                </label>
                <label className="acm-field">
                  <span className="form-label">Topic Hint (optional)</span>
                  <input
                    className="form-input"
                    value={genForm.topic_hint}
                    onChange={e => setGenForm(f => ({ ...f, topic_hint: e.target.value }))}
                    placeholder="e.g. binary trees, string parsing…"
                  />
                </label>
                <button
                  className="btn btn-primary acm-gen-btn"
                  disabled={generating || !genForm.job_domain.trim()}
                  onClick={handleGenerate}
                >
                  {generating ? 'Generating…' : '✨ Generate with AI'}
                </button>
                {genError && <div className="acm-gen-error">{genError}</div>}
              </div>
            </div>
          )}

          {preview && (
            <div className="acm-preview">
              <div className="acm-preview-header">
                <span className="acm-preview-title">{preview.title}</span>
                <span className={`badge ${difficultyBadge(preview.difficulty)}`}>{preview.difficulty}</span>
              </div>
              {mode === 'generate' && generated && (
                <div className="acm-preview-note">
                  Review this AI-generated question before assigning it - it will not be sent to the candidate until you click Assign below.
                </div>
              )}
              <p className="acm-preview-desc">{preview.description}</p>
              <div className="acm-preview-meta">
                <span>Languages: {Object.keys(preview.language_templates || {}).join(', ') || '-'}</span>
                <span>
                  Test cases: {preview.test_cases?.length ?? 0}
                  {' '}({(preview.test_cases || []).filter(tc => tc.is_hidden).length} hidden)
                </span>
              </div>
            </div>
          )}

          {assignedResult && (
            <div className="acm-confirm">
              Assigned successfully.{' '}
              {assignedResult.email_sent
                ? 'A coding assessment invite email was sent to the candidate.'
                : 'The email could not be sent - check the Communication log.'}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>
            {assignedResult ? 'Close' : 'Cancel'}
          </button>
          {!assignedResult && (
            <button
              className="btn btn-primary"
              disabled={!selectedQuestionId || assigning}
              onClick={handleAssign}
            >
              {assigning ? 'Assigning…' : 'Assign to Candidate'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
