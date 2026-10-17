import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { DataTable } from '../../components/site/Blocks'
import { Btn, CtaBand, FaqList, PageHero, Reveal, Section } from '../../components/site/kit'
import { siteApi } from '../../lib/api'
import type { SitePlan } from '../../lib/siteTypes'
import { usePageMeta } from '../../lib/usePageMeta'
import { featuresTable, formatPrice, limitsOf, limitsTable } from './pricingFormat'
import './PricingPage.css'

const FAQ = [
  {
    q: 'What is a company, and what is a client?',
    a: 'A client is the organisation that buys a plan. A company is a separate workspace inside that client, with its own users, jobs, candidates and settings. A plan sets how many companies a client can have.',
  },
  {
    q: 'What does the AI usage limit cover?',
    a: 'It is a monthly cap on what the AI work in your account may cost: reading and scoring resumes, generating interview questions, speech, scoring and reports. You can see usage as it builds up.',
  },
  {
    q: 'What happens when we reach the AI limit or run out of storage?',
    a: 'When the monthly AI limit is used up, new AI actions pause until the next month or until the limit is raised. When storage is full, new uploads are refused until you free space or the limit is raised. Nothing already stored is deleted.',
  },
  {
    q: 'Can we change plan or get different limits?',
    a: 'Yes. Plans and limits can be changed for a client at any time. [Tell us what you need](/contact?topic=sales) and we will set it up.',
  },
  {
    q: 'Do you offer a trial?',
    a: 'Trials can be arranged. [Ask about a trial](/contact?topic=sales) and say how many people would use it.',
  },
  {
    q: 'How do we pay?',
    a: 'We set up billing with you when your account is created. [Contact us](/contact?topic=sales) with any question about invoices or payment.',
  },
]

function PlanCard({ plan }: { plan: SitePlan }) {
  return (
    <Reveal as="article" className="xv-plan">
      <h3 className="xv-plan-name">{plan.label}</h3>
      <p className="xv-plan-price">
        <span className="xv-plan-amount">{formatPrice(plan.price_monthly_usd)}</span>
        {plan.price_monthly_usd !== null && <span className="xv-plan-unit"> per month</span>}
      </p>
      <dl className="xv-plan-limits">
        {limitsOf(plan).map(limit => (
          <div key={limit.label}>
            <dt>{limit.label}</dt>
            <dd>{limit.value}</dd>
          </div>
        ))}
      </dl>
      <ul className="xv-plan-features">
        {plan.features.map(feature => (
          <li key={feature.key} className={feature.included ? 'is-included' : 'is-excluded'}>
            <span className="xv-plan-mark" aria-hidden="true">{feature.included ? '✓' : '–'}</span>
            <span>
              {feature.label}
              <span className="xv-sr-only">{feature.included ? ' (included)' : ' (not included)'}</span>
            </span>
          </li>
        ))}
      </ul>
      <Btn to="/contact?topic=sales" variant="primary">Talk to us about {plan.label}</Btn>
    </Reveal>
  )
}

function PlanSkeleton() {
  return (
    <div className="xv-plan-grid" aria-hidden="true">
      {[0, 1, 2].map(i => <div key={i} className="xv-plan xv-plan-skeleton" />)}
    </div>
  )
}

export default function PricingPage() {
  usePageMeta({
    title: 'Pricing',
    description: 'Hirely.ai plans with the number of companies, users, AI usage and storage each one includes.',
  })

  const [plans, setPlans] = useState<SitePlan[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  const load = useCallback(() => {
    let cancelled = false
    setState('loading')
    siteApi.plans()
      .then(r => {
        if (cancelled) return
        setPlans(r.data.plans ?? [])
        setState('ready')
      })
      .catch(() => {
        if (!cancelled) setState('error')
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => load(), [load])

  const limits = limitsTable(plans)
  const features = featuresTable(plans)

  return (
    <>
      <PageHero
        eyebrow="Pricing"
        title="Plans that grow with your hiring"
        lead="Every plan includes the full hiring pipeline: job descriptions, resume matching, voice interviews and scored reports. Plans differ in size and in the extras you can switch on."
      />

      <Section id="plans" eyebrow="Plans" title={<>Pick a size, <span className="xv-accent">change it later</span></>}>
        <div aria-busy={state === 'loading'}>
          {state === 'loading' && <PlanSkeleton />}

          {state === 'error' && (
            <div className="xv-plan-error" role="alert">
              <p>We could not load the plans right now.</p>
              <div className="xv-plan-error-actions">
                <button type="button" className="xv-btn xv-btn-primary xv-btn-sm" onClick={() => load()}>Try again</button>
                <Link to="/contact?topic=sales" className="xv-btn xv-btn-outline xv-btn-sm">Ask us for pricing</Link>
              </div>
            </div>
          )}

          {state === 'ready' && plans.length === 0 && (
            <div className="xv-plan-error">
              <p>Plans are set up with our team. <Link to="/contact?topic=sales">Ask us for pricing</Link>.</p>
            </div>
          )}

          {state === 'ready' && plans.length > 0 && (
            <div className="xv-plan-grid">
              {plans.map(plan => <PlanCard key={plan.tier} plan={plan} />)}
            </div>
          )}
        </div>
        <p className="xv-plan-note">
          Prices are per client, in US dollars, per month. Need more than the largest plan?{' '}
          <Link to="/contact?topic=sales">We can set custom limits.</Link>
        </p>
      </Section>

      {state === 'ready' && plans.length > 0 && (
        <Section id="compare" eyebrow="Compare" title={<>Every limit and feature, <span className="xv-accent">side by side</span></>}>
          <div className="xv-plan-tables">
            <DataTable caption="Plan limits" head={limits.head} rows={limits.rows} />
            <DataTable caption="Features by plan" head={features.head} rows={features.rows} />
          </div>
        </Section>
      )}

      <Section id="faq" eyebrow="Questions" title="Pricing questions, answered" center>
        <FaqList items={FAQ} />
      </Section>

      <CtaBand title="See it with your own roles" text="Tell us how you hire today and we will recommend a plan.">
        <Btn to="/contact?topic=sales" variant="white" size="lg">Talk to sales</Btn>
        <Btn to="/features" variant="ghost" size="lg">Explore features</Btn>
      </CtaBand>
    </>
  )
}
