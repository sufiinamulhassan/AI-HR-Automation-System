import { useEffect, useState } from 'react'
import './RatingForm.css'

export interface RatingDimension {
  dimension_id: string
  name: string
  description?: string | null
}

export interface RatingConfig {
  scale_min: number
  scale_max: number
  dimensions: RatingDimension[]
}

interface RatingFormProps {
  config: RatingConfig
  initialRatings?: Record<string, number> | null
  initialComments?: string | null
  readOnly?: boolean
  submitting?: boolean
  submitLabel?: string
  error?: string
  onSubmit?: (ratings: Record<string, number>, comments: string) => void
}

export default function RatingForm({
  config, initialRatings, initialComments, readOnly, submitting, submitLabel = 'Submit Review', error, onSubmit,
}: RatingFormProps) {
  const [ratings, setRatings] = useState<Record<string, number>>({ ...(initialRatings || {}) })
  const [comments, setComments] = useState(initialComments || '')

  useEffect(() => {
    setRatings({ ...(initialRatings || {}) })
    setComments(initialComments || '')
  }, [initialRatings, initialComments])

  const scaleOptions: number[] = []
  for (let v = config.scale_min; v <= config.scale_max; v++) scaleOptions.push(v)

  const dimensions = config.dimensions || []
  const allRated = dimensions.length > 0 && dimensions.every(d => typeof ratings[d.name] === 'number')

  if (readOnly) {
    return (
      <div className="rf-readonly">
        {dimensions.length === 0 ? (
          <p className="rf-empty">No rating dimensions were configured for this review.</p>
        ) : dimensions.map(d => (
          <div key={d.dimension_id} className="rf-readonly-row">
            <span className="rf-dim-name">{d.name}</span>
            <span className="rf-readonly-score">
              {typeof ratings[d.name] === 'number' ? ratings[d.name] : '-'} / {config.scale_max}
            </span>
          </div>
        ))}
        <div className="rf-readonly-comments">
          <span className="form-label">Comments</span>
          <p>{comments || 'No comments left.'}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="rf-form">
      {dimensions.length === 0 && (
        <p className="rf-empty">No rating dimensions have been configured yet: nothing to rate.</p>
      )}
      {dimensions.map(d => (
        <label key={d.dimension_id} className="rf-field">
          <span className="form-label">{d.name}</span>
          {d.description && <span className="rf-dim-desc">{d.description}</span>}
          <select
            className="form-input"
            aria-label={d.name}
            value={ratings[d.name] ?? ''}
            disabled={submitting}
            onChange={e => setRatings(r => ({ ...r, [d.name]: Number(e.target.value) }))}
          >
            <option value="" disabled>Select a score ({config.scale_min}–{config.scale_max})</option>
            {scaleOptions.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
      ))}
      <label className="rf-field">
        <span className="form-label">Comments</span>
        <textarea
          className="form-input rf-comments"
          rows={4}
          value={comments}
          disabled={submitting}
          onChange={e => setComments(e.target.value)}
          placeholder="Optional comments"
        />
      </label>
      {error && <div className="rf-error">{error}</div>}
      <div className="rf-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={submitting || !allRated}
          onClick={() => onSubmit?.(ratings, comments.trim())}
        >
          {submitting ? 'Submitting…' : submitLabel}
        </button>
      </div>
    </div>
  )
}
