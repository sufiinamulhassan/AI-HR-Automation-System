import { useEffect, useState, type ReactNode } from 'react'
import { companySettingsApi } from '../../../lib/api'
import './OrgPanels.css'

const FEATURE_PHRASES: Record<string, string> = {
  coding: 'coding assessments',
  performance: 'performance reviews',
  webhooks: 'webhooks',
  workflows: 'workflow rules',
  custom_smtp: 'a custom mail server',
  oidc_sso: 'single sign-on',
  custom_domain: 'custom domains',
  integrations: 'integrations',
}

export function planSentence(flag: string): string {
  return `Your plan does not include ${FEATURE_PHRASES[flag] ?? flag}.`
}

type Gate = 'loading' | 'on' | 'off'

export function usePlanFeature(flag: string): Gate {
  const [gate, setGate] = useState<Gate>('loading')
  useEffect(() => {
    let current = true
    setGate('loading')
    companySettingsApi.usage()
      .then(r => { if (current) setGate(r.data?.features?.[flag] === false ? 'off' : 'on') })
      .catch(() => { if (current) setGate('on') })
    return () => { current = false }
  }, [flag])
  return gate
}

export function PlanBlocked({ title, sentence }: { title: string; sentence: string }) {
  return (
    <section className="org-section">
      <div className="org-card card plan-blocked">
        <div className="card-header">
          <span className="card-title">{title}</span>
          <span className="badge badge-gray">Not in your plan</span>
        </div>
        <div className="plan-blocked-body" role="status">{sentence}</div>
      </div>
    </section>
  )
}

export default function PlanGate({ flag, title, children }: { flag: string; title: string; children: ReactNode }) {
  const gate = usePlanFeature(flag)
  if (gate === 'loading') {
    return (
      <section className="org-section">
        <div className="org-card card">
          <div className="card-header"><span className="card-title">{title}</span></div>
          <div className="org-loading">Loading…</div>
        </div>
      </section>
    )
  }
  if (gate === 'off') return <PlanBlocked title={title} sentence={planSentence(flag)} />
  return <>{children}</>
}
