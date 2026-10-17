import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { candidatesApi, type InterviewDimension, type InterviewGuide } from '../../../lib/api'
import { DIMENSIONS, GENERIC_GUIDE_NOTE, dimensionLabel, errorDetail, formatWhen, guideAsText } from './externalInterview'
import { useDialog } from './useDialog'
import './InterviewGuideModal.css'

interface Props {
  candidateId: string
  candidateName: string
  onClose: () => void
}

const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
)
const UpIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>
  </svg>
)
const DownIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>
  </svg>
)
const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
  </svg>
)

type LoadState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; guide: InterviewGuide | null }

const PRINTING = 'igm-printing'
const MAX_QUESTION = 500
const MAX_LISTEN_FOR = 500

export default function InterviewGuideModal({ candidateId, candidateName, onClose }: Props) {
  const titleId = useId()
  const formId = useId()
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [working, setWorking] = useState(false)
  const [problem, setProblem] = useState('')
  const [copied, setCopied] = useState(false)
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>()

  const [adderOpen, setAdderOpen] = useState(false)
  const [draftText, setDraftText] = useState('')
  const [draftDimension, setDraftDimension] = useState<InterviewDimension>('technical')
  const [draftListenFor, setDraftListenFor] = useState('')
  const [adding, setAdding] = useState(false)
  const [addProblem, setAddProblem] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rowProblem, setRowProblem] = useState<{ id: string; text: string } | null>(null)

  const requestClose = useCallback(() => {
    if (adderOpen && draftText.trim() && !confirm('Discard the question you were typing?')) return
    onClose()
  }, [adderOpen, draftText, onClose])

  const { boxRef, trapTab, onBackdropMouseDown, onBackdropClick } = useDialog(requestClose)

  useEffect(() => {
    let current = true
    setState({ status: 'loading' })
    candidatesApi.getInterviewGuide(candidateId)
      .then(r => { if (current) setState({ status: 'ready', guide: r.data ?? null }) })
      .catch(() => { if (current) setState({ status: 'error' }) })
    return () => { current = false }
  }, [candidateId, attempt])

  useEffect(() => () => {
    clearTimeout(copiedTimer.current)
    document.body.classList.remove(PRINTING)
  }, [])

  const guide = state.status === 'ready' ? state.guide : null

  async function generate(regenerate: boolean) {
    if (working) return
    if (regenerate && !confirm('Regenerate the questions? The current ones will be replaced.')) return
    setWorking(true)
    setProblem('')
    try {
      const r = await candidatesApi.generateInterviewGuide(candidateId, regenerate)
      setState({ status: 'ready', guide: r.data })
    } catch (e) {
      setProblem(errorDetail(e) || 'Could not generate the questions. Please try again')
    } finally {
      setWorking(false)
    }
  }

  function closeAdder() {
    setAdderOpen(false)
    setDraftText('')
    setDraftListenFor('')
    setDraftDimension('technical')
    setAddProblem('')
  }

  async function addQuestion(e: FormEvent) {
    e.preventDefault()
    const text = draftText.trim()
    if (adding || !text) return
    const listenFor = draftListenFor.trim()
    setAdding(true)
    setAddProblem('')
    try {
      const r = await candidatesApi.addGuideQuestion(candidateId, {
        text, dimension: draftDimension, ...(listenFor ? { listen_for: listenFor } : {}),
      })
      setState({ status: 'ready', guide: r.data })
      closeAdder()
    } catch (err) {
      setAddProblem(errorDetail(err) || 'Could not add the question. Please try again')
    } finally {
      setAdding(false)
    }
  }

  async function change(id: string, request: () => Promise<{ data: InterviewGuide }>, fallback: string) {
    if (busyId) return
    setBusyId(id)
    setRowProblem(null)
    try {
      const r = await request()
      setState({ status: 'ready', guide: r.data })
    } catch (err) {
      setRowProblem({ id, text: errorDetail(err) || fallback })
    } finally {
      setBusyId(null)
    }
  }

  function removeQuestion(id: string) {
    if (!confirm('Remove this question?')) return
    change(id, () => candidatesApi.removeGuideQuestion(candidateId, id), 'Could not remove the question. Please try again')
  }

  function moveQuestion(index: number, by: -1 | 1) {
    if (!guide) return
    const ids = guide.questions.map(q => q.id)
    const target = index + by
    if (target < 0 || target >= ids.length) return
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    change(ids[target], () => candidatesApi.reorderGuideQuestions(candidateId, ids), 'Could not move the question. Please try again')
  }

  const copyAll = useCallback(() => {
    if (!guide) return
    const clipboard = navigator.clipboard
    if (!clipboard) { setProblem('Copying is not available in this browser'); return }
    setProblem('')
    clipboard.writeText(guideAsText(guide.questions, `Interview guide: ${candidateName}`))
      .then(() => {
        setCopied(true)
        clearTimeout(copiedTimer.current)
        copiedTimer.current = setTimeout(() => setCopied(false), 1800)
      })
      .catch(() => setProblem('Could not copy the questions'))
  }, [guide, candidateName])

  function print() {
    const done = () => {
      document.body.classList.remove(PRINTING)
      window.removeEventListener('afterprint', done)
    }
    document.body.classList.add(PRINTING)
    window.addEventListener('afterprint', done)
    window.print()
  }

  return createPortal(
    <div className="modal-overlay igm-overlay" data-testid="guide-backdrop" onMouseDown={onBackdropMouseDown} onClick={onBackdropClick}>
      <div
        ref={boxRef}
        className="modal-box igm-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={trapTab}
      >
        <div className="modal-header igm-header">
          <h2 id={titleId}>Interview guide, {candidateName}</h2>
          <button type="button" className="modal-close igm-no-print" aria-label="Close guide" onClick={requestClose}>
            <CloseIcon />
          </button>
        </div>

        <div className="igm-body">
          {state.status === 'loading' && <div className="igm-status" role="status">Loading guide…</div>}

          {state.status === 'error' && (
            <div className="igm-error igm-no-print" role="alert">
              <span>Could not load the guide.</span>
              <button type="button" className="igm-link-btn" onClick={() => setAttempt(a => a + 1)}>Retry</button>
            </div>
          )}

          {state.status === 'ready' && !guide && <p className="igm-empty">No interview guide yet</p>}

          {guide && (
            <>
              {guide.fallback && <p className="igm-note">{GENERIC_GUIDE_NOTE}</p>}
              <ol className="igm-list">
                {guide.questions.map((q, i) => {
                  const rowBusy = busyId !== null
                  const issue = rowProblem?.id === q.id ? rowProblem.text : ''
                  return (
                    <li className="igm-item" key={q.id}>
                      <div className="igm-item-row">
                        <div className="igm-item-main">
                          <p className="igm-q">{q.text}</p>
                          <div className="igm-tags">
                            <p className="igm-dim">{dimensionLabel(q.dimension)}</p>
                            {q.source === 'custom' && <span className="badge badge-gray igm-custom igm-no-print">Custom</span>}
                          </div>
                          {q.listen_for && <p className="igm-listen">Listen for: {q.listen_for}</p>}
                        </div>
                        <div className="igm-item-actions igm-no-print">
                          <button type="button" className="igm-icon-btn" aria-label={`Move up: ${q.text}`} title="Move up"
                            disabled={rowBusy || i === 0} onClick={() => moveQuestion(i, -1)}><UpIcon /></button>
                          <button type="button" className="igm-icon-btn" aria-label={`Move down: ${q.text}`} title="Move down"
                            disabled={rowBusy || i === guide.questions.length - 1} onClick={() => moveQuestion(i, 1)}><DownIcon /></button>
                          <button type="button" className="igm-icon-btn igm-icon-btn-danger" aria-label={`Remove: ${q.text}`} title="Remove"
                            disabled={rowBusy} onClick={() => removeQuestion(q.id)}><TrashIcon /></button>
                        </div>
                      </div>
                      {issue && <div className="igm-error igm-no-print" role="alert">{issue}</div>}
                    </li>
                  )
                })}
              </ol>

              <div className="igm-add igm-no-print">
                {!adderOpen ? (
                  <button type="button" className="btn btn-ghost btn-sm igm-add-open" onClick={() => setAdderOpen(true)}>Add question</button>
                ) : (
                  <form className="igm-add-form" onSubmit={addQuestion} noValidate>
                    <div className="igm-add-field">
                      <label className="form-label" htmlFor={`${formId}-text`}>Question</label>
                      <textarea
                        id={`${formId}-text`}
                        className="form-input igm-textarea"
                        rows={3}
                        maxLength={MAX_QUESTION}
                        autoFocus
                        value={draftText}
                        onChange={e => setDraftText(e.target.value)}
                      />
                    </div>
                    <div className="igm-add-field">
                      <label className="form-label" htmlFor={`${formId}-area`}>Area</label>
                      <select
                        id={`${formId}-area`}
                        className="form-input"
                        value={draftDimension}
                        onChange={e => setDraftDimension(e.target.value as InterviewDimension)}
                      >
                        {DIMENSIONS.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
                      </select>
                    </div>
                    <div className="igm-add-field">
                      <label className="form-label" htmlFor={`${formId}-listen`}>Listen for (optional)</label>
                      <input
                        id={`${formId}-listen`}
                        className="form-input"
                        maxLength={MAX_LISTEN_FOR}
                        value={draftListenFor}
                        onChange={e => setDraftListenFor(e.target.value)}
                      />
                    </div>
                    {addProblem && <div className="igm-error" role="alert">{addProblem}</div>}
                    <div className="igm-add-actions">
                      <button type="button" className="btn btn-ghost btn-sm" disabled={adding} onClick={closeAdder}>Cancel</button>
                      <button type="submit" className="btn btn-primary btn-sm" disabled={adding || !draftText.trim()}>
                        {adding ? 'Adding…' : 'Add'}
                      </button>
                    </div>
                  </form>
                )}
              </div>
              {formatWhen(guide.generated_at) && <p className="igm-meta">Generated {formatWhen(guide.generated_at)}</p>}
            </>
          )}

          {problem && <div className="igm-error igm-no-print" role="alert">{problem}</div>}
        </div>

        <div className="modal-footer igm-footer igm-no-print">
          {guide && (
            <>
              <button type="button" className="btn btn-ghost" onClick={copyAll}>{copied ? 'Copied' : 'Copy all'}</button>
              <button type="button" className="btn btn-ghost" onClick={print}>Print</button>
            </>
          )}
          {state.status === 'ready' && (
            <button type="button" className="btn btn-ghost" disabled={working} onClick={() => generate(!!guide)}>
              {working ? 'Working…' : guide ? 'Regenerate' : 'Generate'}
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={requestClose}>Close</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
