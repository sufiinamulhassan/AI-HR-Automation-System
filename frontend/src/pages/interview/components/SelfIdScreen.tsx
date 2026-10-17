import { useState } from 'react'
import { API_V1 } from '../../../lib/config'
import './SelfIdScreen.css'

interface Props {
  token: string
  onDone: () => void
}

const GENDER_OPTIONS = ['Female', 'Male', 'Non-binary', 'Other']

export default function SelfIdScreen({ token, onDone }: Props) {
  const [gender, setGender] = useState('')
  const [location, setLocation] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch(`${API_V1}/interview/${token}/demographics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gender: gender.trim() || null,
          location: location.trim() || null,
        }),
      })
      if (!res.ok) throw new Error(String(res.status))
      onDone()
    } catch {
      setError('Something went wrong submitting this. You can try again, or skip.')
      setSubmitting(false)
    }
  }

  return (
    <div className="iv-gate">
      <div className="iv-gate-card iv-selfid">
        <h2>One optional question before you go</h2>
        <p className="iv-selfid-lead">
          This is completely voluntary. It is used only for diversity reporting, is never
          shown to the people reviewing your interview, and will never affect your evaluation
          or hiring decision in any way. Skip it if you'd rather not answer.
        </p>

        <form onSubmit={handleSubmit} className="iv-selfid-form" aria-label="Optional diversity questions">
          <label className="iv-selfid-field">
            Gender
            <select value={gender} onChange={e => setGender(e.target.value)} disabled={submitting}>
              <option value="">Prefer not to say</option>
              {GENDER_OPTIONS.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </label>

          <label className="iv-selfid-field">
            Location
            <input
              type="text"
              value={location}
              onChange={e => setLocation(e.target.value)}
              placeholder="City, Country (optional)"
              disabled={submitting}
            />
          </label>

          {error && <div className="iv-selfid-error">{error}</div>}

          <div className="iv-selfid-actions">
            <button type="button" className="iv-selfid-skip" onClick={onDone} disabled={submitting}>
              Skip / Prefer not to answer
            </button>
            <button type="submit" className="iv-selfid-submit" disabled={submitting}>
              {submitting ? 'Submitting…' : 'Submit'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
