import { useParams } from 'react-router-dom'
import BrandLogo from '../components/BrandLogo'
import LegalLinks from '../components/LegalLinks'
import CodingWorkspace from '../components/coding/CodingWorkspace'
import { useCodingSession } from '../components/coding/useCodingSession'
import { useBrand } from '../lib/brand'
import './CodingAssessment.css'

export default function CodingAssessment() {
  const { token } = useParams<{ token: string }>()
  const brand = useBrand()
  const { session, status, errorMsg, result, submit, runStatus, runResult, runErrorMsg, run, flag, autosave } = useCodingSession(token)

  if (status === 'loading') return (
    <div className="ca-page ca-center">
      <div className="ca-spinner" />
      <p>Loading coding assessment…</p>
      <LegalLinks />
    </div>
  )

  if (status === 'error' && !session) return (
    <div className="ca-page ca-center">
      <div className="ca-error-card">
        <div className="ca-error-icon">✕</div>
        <h2>Unable to load assessment</h2>
        <p>{errorMsg || 'This link is invalid or has expired.'}</p>
        <LegalLinks />
      </div>
    </div>
  )

  return (
    <div className="ca-page">
      <header className="ca-header">
        <div className="ca-brand">
          <BrandLogo>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="9" cy="7" r="4" stroke="var(--primary)" strokeWidth="2" />
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="m16 11 2 2 4-4" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </BrandLogo>
          {brand.name}, Coding Assessment
        </div>
        {session && <div className="ca-difficulty">{session.difficulty}</div>}
      </header>

      {session && (
        <CodingWorkspace
          session={session}
          status={status}
          errorMsg={errorMsg}
          result={result}
          onSubmit={submit}
          runStatus={runStatus}
          runResult={runResult}
          runErrorMsg={runErrorMsg}
          onRun={run}
          onIntegrityEvent={flag}
          onAutosave={autosave}
        />
      )}
      <LegalLinks />
    </div>
  )
}
