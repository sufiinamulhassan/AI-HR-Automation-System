import { useRef, useState } from 'react'
import '../../CodingAssessment.css'

interface Props {
  onIntegrityEvent?: (event: string) => void
}

const LANGUAGES = ['python', 'javascript', 'java', 'c']

export default function FreeformCodeEditor({ onIntegrityEvent }: Props) {
  const [language, setLanguage] = useState(LANGUAGES[0])
  const [code, setCode] = useState('')
  const [consoleOpen, setConsoleOpen] = useState(true)
  const codeByLangRef = useRef<Record<string, string>>({})
  const gutterRef = useRef<HTMLDivElement>(null)

  function changeLanguage(lang: string) {
    codeByLangRef.current[language] = code
    setLanguage(lang)
    setCode(codeByLangRef.current[lang] ?? '')
  }

  function resetCode() {
    codeByLangRef.current[language] = ''
    setCode('')
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
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

  function handleScroll(e: React.UIEvent<HTMLTextAreaElement>) {
    if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop
  }

  const lineCount = Math.max(1, code.split('\n').length)

  return (
    <section className="ca-editor-panel">
      <div className="ca-editor-toolbar">
        <select
          className="ca-lang-select"
          value={language}
          onChange={e => changeLanguage(e.target.value)}
          aria-label="Programming language"
        >
          {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
        <button type="button" className="ca-reset-btn" onClick={resetCode}>
          Reset
        </button>
      </div>

      <div className="ca-editor-body">
        <div className="ca-editor-gutter" ref={gutterRef} aria-hidden="true">
          {Array.from({ length: lineCount }, (_, i) => <span key={i}>{i + 1}</span>)}
        </div>
        <textarea
          className="ca-code-editor"
          value={code}
          onChange={e => setCode(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onDrop={handleDrop}
          onScroll={handleScroll}
          spellCheck={false}
          wrap="off"
          placeholder="Write code here while you talk through your answer…"
          aria-label="Code editor"
        />
      </div>

      <div className="ca-console">
        {consoleOpen && (
          <div className="ca-console-body">
            <p className="ca-console-placeholder">
              This question isn't part of a graded coding assessment, so there's nothing to run
              or submit here - it's a scratchpad only.
            </p>
          </div>
        )}
        <button type="button" className="ca-console-toggle" onClick={() => setConsoleOpen(o => !o)}>
          {consoleOpen ? 'Hide console' : 'Show console'}
        </button>
      </div>

      <div className="ca-editor-actions">
        <button
          type="button" className="btn-run-code" disabled
          title="Not available - this question has no graded test cases"
        >
          Run code
        </button>
        <button
          type="button" className="btn-submit-code" disabled
          title="Not available - this question has no graded test cases"
        >
          Run tests
        </button>
      </div>
    </section>
  )
}
