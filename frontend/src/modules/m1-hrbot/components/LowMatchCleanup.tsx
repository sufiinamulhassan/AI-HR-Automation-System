import { useId, useState } from 'react'
import { jobsApi, type PruneMode, type PruneResult } from '../../../lib/api'
import './LowMatchCleanup.css'

interface Props {
  jobId: string
  currentMinimum?: number | null
  onDone?: () => void
}

type Step =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'preview'; result: PruneResult }
  | { kind: 'removing'; result: PruneResult }
  | { kind: 'done'; result: PruneResult }

const MODES: { value: PruneMode; label: string; hint: string }[] = [
  {
    value: 'job',
    label: 'Remove from this JD only',
    hint: 'The résumé stays in the system and in other JDs. On the Résumés page this JD shows as low score, removed by admin.',
  },
  {
    value: 'system',
    label: 'Delete from the system completely',
    hint: 'The résumé, its file and its place in every JD are deleted. This cannot be undone.',
  },
]

function percent(score: number): number {
  return Math.round(Math.max(0, Math.min(1, score)) * 100)
}

function errorText(err: unknown, fallback: string): string {
  return (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || fallback
}

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`
}

export default function LowMatchCleanup({ jobId, currentMinimum, onDone }: Props) {
  const [minScore, setMinScore] = useState<string>(String(currentMinimum ?? 50))
  const [mode, setMode] = useState<PruneMode>('job')
  const [step, setStep] = useState<Step>({ kind: 'idle' })
  const [error, setError] = useState('')
  const inputId = useId()
  const name = useId()

  const value = Number(minScore)
  const valid = minScore.trim() !== '' && Number.isFinite(value) && value >= 1 && value <= 100

  function reset(next: Partial<{ minScore: string; mode: PruneMode }>) {
    if (next.minScore !== undefined) setMinScore(next.minScore)
    if (next.mode !== undefined) setMode(next.mode)
    setStep({ kind: 'idle' })
    setError('')
  }

  async function preview() {
    if (!valid) return
    setError('')
    setStep({ kind: 'checking' })
    try {
      const r = await jobsApi.pruneLowMatches(jobId, { min_score: value, mode, dry_run: true })
      setStep({ kind: 'preview', result: r.data })
    } catch (err) {
      setError(errorText(err, 'Could not check the pipeline. Please try again.'))
      setStep({ kind: 'idle' })
    }
  }

  async function confirm(result: PruneResult) {
    setError('')
    setStep({ kind: 'removing', result })
    try {
      const r = await jobsApi.pruneLowMatches(jobId, { min_score: result.min_score, mode: result.mode })
      setStep({ kind: 'done', result: r.data })
      onDone?.()
    } catch (err) {
      setError(errorText(err, 'Could not remove the résumés. Please try again.'))
      setStep({ kind: 'preview', result })
    }
  }

  const shown = step.kind === 'preview' || step.kind === 'removing' ? step.result : null
  const busy = step.kind === 'checking' || step.kind === 'removing'

  return (
    <div className="lmc">
      <p className="lmc-lead">
        After sourcing, clear out résumés that scored below a minimum match score for this JD.
        {typeof currentMinimum === 'number' && currentMinimum > 0 && (
          <> Current minimum: <strong>{currentMinimum}</strong>. New matches below it are not added.</>
        )}
      </p>

      <div className="lmc-controls">
        <label className="lmc-field" htmlFor={inputId}>
          <span className="lmc-label">Minimum match score</span>
          <input
            id={inputId}
            className="lmc-input"
            type="number"
            min={1}
            max={100}
            step={1}
            inputMode="numeric"
            value={minScore}
            aria-invalid={!valid}
            onChange={e => reset({ minScore: e.target.value })}
          />
        </label>

        <fieldset className="lmc-modes">
          <legend className="lmc-label">What to do with them</legend>
          {MODES.map(m => (
            <label key={m.value} className={`lmc-mode${mode === m.value ? ' lmc-mode-on' : ''}${m.value === 'system' ? ' lmc-mode-danger' : ''}`}>
              <input type="radio" name={name} value={m.value} checked={mode === m.value} onChange={() => reset({ mode: m.value })} />
              <span className="lmc-mode-text">
                <span className="lmc-mode-label">{m.label}</span>
                <span className="lmc-mode-hint">{m.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </div>

      {!valid && <p className="lmc-error" role="alert">Enter a score from 1 to 100.</p>}
      {error && <p className="lmc-error" role="alert">{error}</p>}

      {(step.kind === 'idle' || step.kind === 'checking' || step.kind === 'done') && (
        <div className="lmc-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={preview} disabled={!valid || busy}>
            {step.kind === 'checking' ? 'Checking...' : `Find résumés below ${valid ? value : '...'}`}
          </button>
          {step.kind === 'done' && (
            <span className="lmc-done" role="status">
              {step.result.mode === 'system'
                ? `Deleted ${plural(step.result.removed, 'résumé', 'résumés')} from the system.`
                : `Removed ${plural(step.result.removed, 'résumé', 'résumés')} from this JD.`}
              {step.result.in_progress.length > 0 && ` ${plural(step.result.in_progress.length, 'résumé is', 'résumés are')} still processing and were kept.`}
            </span>
          )}
        </div>
      )}

      {shown && (
        <div className="lmc-preview" role="region" aria-label="Résumés below the minimum score">
          {shown.matched === 0 ? (
            <p className="lmc-empty">No résumés in this JD scored below {shown.min_score}.</p>
          ) : (
            <>
              <p className="lmc-count">
                {plural(shown.matched, 'résumé', 'résumés')} scored below {shown.min_score}
                {shown.mode === 'system' ? ' and will be deleted from the system.' : ' and will be removed from this JD.'}
              </p>
              <ul className="lmc-list">
                {shown.candidates.map(c => (
                  <li key={c.resume_id} className="lmc-item">
                    <span className="lmc-name">{c.name || 'Unnamed résumé'}</span>
                    <span className="lmc-score">{percent(c.similarity_score)}</span>
                  </li>
                ))}
              </ul>
              {shown.matched > shown.candidates.length && (
                <p className="lmc-more">and {plural(shown.matched - shown.candidates.length, 'more', 'more')}</p>
              )}
            </>
          )}
          {shown.protected > 0 && (
            <p className="lmc-note">{plural(shown.protected, 'hired candidate is', 'hired candidates are')} below the score and will be kept.</p>
          )}
          <div className="lmc-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => reset({})} disabled={busy}>Cancel</button>
            {shown.matched > 0 && (
              <button
                type="button"
                className={shown.mode === 'system' ? 'lmc-btn-danger' : 'btn btn-primary btn-sm'}
                onClick={() => confirm(shown)}
                disabled={busy}
              >
                {step.kind === 'removing'
                  ? 'Removing...'
                  : shown.mode === 'system'
                    ? `Delete ${plural(shown.matched, 'résumé', 'résumés')}`
                    : `Remove ${plural(shown.matched, 'résumé', 'résumés')}`}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
