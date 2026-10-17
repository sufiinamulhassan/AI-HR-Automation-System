import { useEffect, useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { companySettingsApi, type OnboardingState } from '../../../lib/api'
import './OnboardingCard.css'

const STEP_LINKS: Record<string, string> = {
  profile: '/dashboard/organization',
  branding: '/dashboard/organization?tab=branding',
  users: '/dashboard/users',
  job: '/dashboard/hrbot',
  resume: '/dashboard/resumes',
}

type Steps = OnboardingState['steps']

const CheckIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="20 6 9 17 4 12" />
  </svg>
)

export default function OnboardingCard() {
  const titleId = useId()
  const [steps, setSteps] = useState<Steps | null>(null)
  const [dismissing, setDismissing] = useState(false)
  const [dismissFailed, setDismissFailed] = useState(false)

  useEffect(() => {
    let current = true
    companySettingsApi.onboarding()
      .then(r => {
        if (!current) return
        const { steps: all = [], dismissed = false } = r.data ?? {}
        setSteps(dismissed || all.length === 0 || all.every(s => s.done) ? null : all)
      })
      .catch(() => { if (current) setSteps(null) })
    return () => { current = false }
  }, [])

  async function dismiss() {
    setDismissing(true)
    setDismissFailed(false)
    try {
      await companySettingsApi.dismissOnboarding()
      setSteps(null)
    } catch {
      setDismissFailed(true)
    }
    setDismissing(false)
  }

  if (!steps) return null
  const doneCount = steps.filter(s => s.done).length

  return (
    <section className="dv-card ob-card" aria-labelledby={titleId}>
      <div className="dv-card-head">
        <h3 className="dv-card-title" id={titleId}>Get started</h3>
        <span className="ob-head-end">
          <span className="dv-pill">{doneCount} of {steps.length}</span>
          <button type="button" className="ob-dismiss" onClick={dismiss} disabled={dismissing}>
            {dismissing ? 'Dismissing…' : 'Dismiss'}
          </button>
        </span>
      </div>

      <ul className="ob-list">
        {steps.map(step => {
          const to = STEP_LINKS[step.key]
          const label = to ? <Link to={to} className="ob-link">{step.label}</Link> : <span className="ob-link">{step.label}</span>
          return (
            <li key={step.key} className={`ob-row${step.done ? ' ob-row-done' : ''}`}>
              <span className="ob-check" aria-hidden="true">{step.done && <CheckIcon />}</span>
              {label}
              <span className="ob-sr">{step.done ? 'Done' : 'To do'}</span>
            </li>
          )
        })}
      </ul>

      {dismissFailed && <span className="ob-error" role="alert">Could not dismiss. Try again.</span>}
    </section>
  )
}
