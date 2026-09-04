import { useEffect, useRef, useState } from 'react'
import type {
  CodingRunResult, CodingRunStatus, CodingSessionData, CodingStatus, CodingSubmissionResponse,
} from './useCodingSession'
import '../../pages/CodingAssessment.css'

interface Props {
  session: CodingSessionData
  status: CodingStatus
  errorMsg: string
  result: CodingSubmissionResponse | null
  onSubmit: (language: string, code: string, keystrokes: number) => void
  runStatus?: CodingRunStatus
  runResult?: CodingRunResult | null
  runErrorMsg?: string
  onRun?: (language: string, code: string) => void
  onIntegrityEvent?: (event: string) => void
}

const PASTE_BURST_CHARS = 40

const NON_COUNTING_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Escape'])

const LANGUAGE_LABELS: Record<string, string> = {
  cpp: 'C++', csharp: 'C#', fsharp: 'F#', vbnet: 'VB.NET', sql: 'SQL (SQLite)',
  r: 'R', d: 'D', basic: 'BASIC', assembly: 'Assembly (NASM)', javascript: 'JavaScript',
  typescript: 'TypeScript', php: 'PHP',
}
function languageLabel(lang: string): string {
  return LANGUAGE_LABELS[lang] ?? (lang.charAt(0).toUpperCase() + lang.slice(1))
}

export default function CodingWorkspace({
  session, status, errorMsg, result, onSubmit,
  runStatus = 'idle', runResult = null, runErrorMsg = '', onRun,
  onIntegrityEvent,
}: Props) {
  const [language, setLanguage] = useState('')
  const [code, setCode] = useState('')
  const [consoleOpen, setConsoleOpen] = useState(true)
  const [consoleTab, setConsoleTab] = useState<'output' | 'tests'>('output')
  const codeByLangRef = useRef<Record<string, string>>({})
  const keystrokesByLangRef = useRef<Record<string, number>>({})
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const langs = Object.keys(session.language_templates || {})
    const firstLang = langs[0] || 'python'
    const starter = session.language_templates?.[firstLang] || ''
    codeByLangRef.current = { [firstLang]: starter }
    keystrokesByLangRef.current = { [firstLang]: 0 }
    setLanguage(firstLang)
    setCode(starter)
  }, [session.question_id, session.language_templates])

  useEffect(() => {
    if (status === 'done' || status === 'error') setConsoleTab('tests')
  }, [status])

  const locked = status === 'submitting' || status === 'done'

  function changeLanguage(lang: string) {
    codeByLangRef.current[language] = code
    setLanguage(lang)
    const draft = codeByLangRef.current[lang] ?? session.language_templates?.[lang] ?? ''
    codeByLangRef.current[lang] = draft
    setCode(draft)
  }

  function resetCode() {
    const starter = session.language_templates?.[language] ?? ''
    codeByLangRef.current[language] = starter
    keystrokesByLangRef.current[language] = 0
    setCode(starter)
  }

  function runTests() {
    if (locked || !code.trim()) return
    onSubmit(language, code, keystrokesByLangRef.current[language] ?? 0)
  }

  function runCode() {
    if (runStatus === 'running' || !code.trim()) return
    onRun?.(language, code)
    setConsoleTab('output')
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!NON_COUNTING_KEYS.has(e.key)) {
      keystrokesByLangRef.current[language] = (keystrokesByLangRef.current[language] ?? 0) + 1
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      runTests()
      return
    }
    if (e.key !== 'Tab') return
    e.preventDefault()
    const el = e.currentTarget
    const start = el.selectionStart
    const end = el.selectionEnd
    const indent = '    '
    const next = code.slice(0, start) + indent + code.slice(end)
    setCode(next)
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = start + indent.length
    })
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    e.preventDefault()
    onIntegrityEvent?.('paste_blocked')
  }

  function handleDrop(e: React.DragEvent<HTMLTextAreaElement>) {
    e.preventDefault()
    onIntegrityEvent?.('drop_blocked')
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const next = e.target.value
    const delta = next.length - code.length
    if (delta >= PASTE_BURST_CHARS && (keystrokesByLangRef.current[language] ?? 0) < delta / 3) {
      onIntegrityEvent?.('paste_burst')
    }
    setCode(next)
  }

  function handleScroll(e: React.UIEvent<HTMLTextAreaElement>) {
    if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop
  }

  const templatedLangs = Object.keys(session.language_templates || {})
  const langs = [
    ...templatedLangs,
    ...(session.supported_languages || []).filter(l => !templatedLangs.includes(l)),
  ]
  const visibleCases = session.test_cases || []
  const lineCount = Math.max(1, code.split('\n').length)

  return (
    <div className="ca-body">
      <section className="ca-problem">
        <h1 className="ca-title">{session.title}</h1>
        <p className="ca-description">{session.description}</p>

        {visibleCases.length > 0 && (
          <div className="ca-samples">
            <div className="ca-samples-label">Sample Test Cases</div>
            {visibleCases.map((tc, i) => (
              <div key={i} className="ca-sample">
                <div><span className="ca-sample-key">Input:</span> <code>{tc.input}</code></div>
                <div><span className="ca-sample-key">Expected Output:</span> <code>{tc.expected_output}</code></div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="ca-editor-panel">
        <div className="ca-editor-toolbar">
          <select
            className="ca-lang-select"
            value={language}
            onChange={e => changeLanguage(e.target.value)}
            disabled={locked}
            aria-label="Programming language"
          >
            {langs.map(l => <option key={l} value={l}>{languageLabel(l)}</option>)}
          </select>
          <button type="button" className="ca-reset-btn" onClick={resetCode} disabled={locked}>
            Reset
          </button>
        </div>

        <div className="ca-editor-body">
          <div className="ca-editor-gutter" ref={gutterRef} aria-hidden="true">
            {Array.from({ length: lineCount }, (_, i) => <span key={i}>{i + 1}</span>)}
          </div>
          <textarea
            ref={textareaRef}
            className="ca-code-editor"
            value={code}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onDrop={handleDrop}
            onScroll={handleScroll}
            spellCheck={false}
            wrap="off"
            disabled={locked}
            aria-label="Code editor"
          />
        </div>

        <div className="ca-console">
          <div className="ca-console-tabs" role="tablist" aria-label="Run output">
            <button
              type="button" role="tab" aria-selected={consoleTab === 'output'}
              className={`ca-console-tab${consoleTab === 'output' ? ' ca-console-tab-active' : ''}`}
              onClick={() => setConsoleTab('output')}
            >
              Output
            </button>
            <button
              type="button" role="tab" aria-selected={consoleTab === 'tests'}
              className={`ca-console-tab${consoleTab === 'tests' ? ' ca-console-tab-active' : ''}`}
              onClick={() => setConsoleTab('tests')}
            >
              Test Results
            </button>
          </div>

          {consoleOpen && (
            <div className="ca-console-body">
              {consoleTab === 'output' ? (
                runStatus === 'running' ? (
                  <p className="ca-console-placeholder">Running your code…</p>
                ) : runStatus === 'error' ? (
                  <div className="ca-submit-error">{runErrorMsg}</div>
                ) : runResult ? (
                  <div className="ca-run-output">
                    <div className="ca-run-meta">
                      {runResult.status && <span>Status: {runResult.status}</span>}
                      {runResult.time && <span>Time: {runResult.time}s</span>}
                      {runResult.memory != null && <span>Memory: {runResult.memory} KB</span>}
                    </div>
                    <div className="ca-run-stream">
                      <div className="ca-run-stream-label">stdin</div>
                      <pre>{runResult.stdin || '(empty)'}</pre>
                    </div>
                    <div className="ca-run-stream">
                      <div className="ca-run-stream-label">stdout</div>
                      <pre>{runResult.stdout || '(no output)'}</pre>
                    </div>
                    {(runResult.stderr || runResult.compile_output) && (
                      <div className="ca-run-stream ca-run-stream-error">
                        <div className="ca-run-stream-label">stderr</div>
                        <pre>{runResult.stderr || runResult.compile_output}</pre>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="ca-console-placeholder">
                    Run code to see its output against the first sample case, before running the
                    full test suite.
                  </p>
                )
              ) : status === 'error' && errorMsg ? (
                <div className="ca-submit-error">{errorMsg}</div>
              ) : result ? (
                <div className="ca-results">
                  <div className="ca-score">
                    Score: <strong>{result.score === null ? '-' : `${result.score}%`}</strong>
                  </div>

                  {result.status === 'execution_error' && (
                    <div className="ca-submit-error">
                      We couldn't run your code just now - this is a problem on our side,
                      not with your solution. Please try submitting again.
                    </div>
                  )}

                  <div className="ca-results-group">
                    <div className="ca-results-group-label">Visible Test Cases</div>
                    {result.results.filter(r => !r.is_hidden).map(r => (
                      <div key={r.test_case_index} className={`ca-result-row ${r.passed ? 'ca-pass' : 'ca-fail'}`}>
                        <span className="ca-result-badge">
                          {r.skipped ? 'SKIPPED' : r.passed ? 'PASS' : 'FAIL'}
                        </span>
                        <div className="ca-result-detail">
                          {r.compile_output ? (
                            <div><strong>Compile error:</strong> <code>{r.compile_output}</code></div>
                          ) : (
                            <>
                              <div><strong>Expected:</strong> <code>{r.expected_output}</code></div>
                              <div><strong>Actual:</strong> <code>{r.actual_output}</code></div>
                              {r.stderr && <div><strong>Stderr:</strong> <code>{r.stderr}</code></div>}
                            </>
                          )}
                          {(r.time_ms != null || r.memory_kb != null) && (
                            <div className="ca-result-meta">
                              {r.time_ms != null && <span>{r.time_ms} ms</span>}
                              {r.memory_kb != null && <span>{r.memory_kb} KB</span>}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {(() => {
                    const hidden = result.results.filter(r => r.is_hidden)
                    if (hidden.length === 0) return null
                    const passedCount = hidden.filter(r => r.passed).length
                    return (
                      <div className="ca-hidden-summary">
                        {passedCount} of {hidden.length} hidden tests passed
                      </div>
                    )
                  })()}
                </div>
              ) : (
                <p className="ca-console-placeholder">Run tests to see results here.</p>
              )}
            </div>
          )}

          <button type="button" className="ca-console-toggle" onClick={() => setConsoleOpen(o => !o)}>
            {consoleOpen ? 'Hide console' : 'Show console'}
          </button>
        </div>

        <div className="ca-editor-actions">
          <button
            type="button"
            className="btn-run-code"
            onClick={runCode}
            disabled={locked || !code.trim() || runStatus === 'running' || !onRun}
          >
            {runStatus === 'running' ? 'Running…' : 'Run code'}
          </button>
          <button
            type="button"
            className="btn-submit-code"
            onClick={runTests}
            disabled={locked || !code.trim()}
          >
            {status === 'submitting' ? 'Running…' : status === 'done' ? 'Submitted' : 'Run tests'}
          </button>
        </div>
      </section>
    </div>
  )
}
