import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Btn, CtaBand, FaqList, PageHero, Reveal, Section } from '../../components/site/kit'
import { siteApi } from '../../lib/api'
import type { SitePlan } from '../../lib/siteTypes'
import { usePageMeta } from '../../lib/usePageMeta'
import {
  addedFeatures, compareGroups, ctaLabel, formatPrice, highlightsOf, HRMS_FEATURES, perPosition, POPULAR_TIER, SERVICES, taglineOf,
  type CompareCell,
} from './pricingFormat'
import './PricingPage.css'

const FAQ = [
  {
    q: 'What is a company, and what is a client?',
    a: 'A client is the organisation that buys a plan. A company is a separate workspace inside that client, with its own users, jobs, candidates and settings. A plan sets how many companies a client can have.',
  },
  {
    q: 'What is a position?',
    a: 'A position is one job description created in Hirely.ai, with applications coming in from your careers page. Each plan sets how many positions you can open a month, how many resumes each one can take, and how many 25 minute AI voice interviews it includes, each with a coding test and a scored report.',
  },
  {
    q: 'Is the HRMS part of every plan?',
    a: 'Yes. Every plan, from Starter up, includes the built-in HRMS: employee records, leave requests and balances, attendance, a holiday calendar and people insights. Sending hires to an outside HR system is the separate HRMS sync, which starts on Growth.',
  },
  {
    q: 'How does Enterprise pricing work?',
    a: 'Enterprise is pay as you go, with unlimited positions and the resumes and interviews agreed with you. [Tell us how you hire](/contact?topic=sales) and we will send a quote.',
  },
  {
    q: 'What happens when we reach a plan limit or run out of storage?',
    a: 'When a monthly allowance is used up, new work of that kind pauses until the next month or until you move to a bigger plan. When storage is full, new uploads are refused until you free space or the limit is raised. Nothing already stored is deleted.',
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

function Check({ on }: { on: boolean }) {
  return (
    <span className={`xv-plan-mark${on ? '' : ' is-off'}`} aria-hidden="true">{on ? '✓' : '–'}</span>
  )
}

function PlanCard({ plan, previous }: { plan: SitePlan; previous?: SitePlan }) {
  const popular = plan.tier === POPULAR_TIER
  const custom = plan.price_monthly_usd === null
  const each = custom ? 'Pay as you go' : perPosition(plan)
  const added = previous ? addedFeatures(plan, previous) : []
  return (
    <Reveal as="article" className={`xv-plan${popular ? ' is-popular' : ''}`}>
      <div className="xv-plan-head">
        <h3 className="xv-plan-name">{plan.label}</h3>
        {popular && <span className="xv-plan-badge">Most popular</span>}
      </div>
      <p className="xv-plan-tagline">{taglineOf(plan)}</p>
      <div>
        <p className="xv-plan-price">
          <span className="xv-plan-amount">{formatPrice(plan.price_monthly_usd)}</span>
          <span className="xv-plan-unit">{custom ? ' quote' : ' per month'}</span>
        </p>
        {each && <p className="xv-plan-each">{each}</p>}
      </div>
      <Btn to="/contact?topic=sales" variant={popular ? 'primary' : 'outline'}>{ctaLabel(plan)}</Btn>
      <ul className="xv-plan-highlights">
        {highlightsOf(plan).map(item => <li key={item}>{item}</li>)}
      </ul>
      <div className="xv-plan-group">
        <p className="xv-plan-group-title">{previous ? `Everything in ${previous.label}, plus` : 'Included in every plan'}</p>
        <ul className="xv-plan-features">
          {(previous ? added : SERVICES).map(item => (
            <li key={item} className="is-included">
              <Check on />
              <span>{item}</span>
            </li>
          ))}
        </ul>
        {!previous && (
          <>
            <p className="xv-plan-group-title">HRMS in every plan</p>
            <ul className="xv-plan-features">
              {HRMS_FEATURES.map(item => (
                <li key={item} className="is-included">
                  <Check on />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Reveal>
  )
}

function CompareValue({ value }: { value: CompareCell }) {
  if (typeof value === 'string') return <>{value}</>
  return (
    <>
      <Check on={value} />
      <span className="xv-sr-only">{value ? 'Included' : 'Not included'}</span>
    </>
  )
}

function ComparePlans({ plans }: { plans: SitePlan[] }) {
  const groups = compareGroups(plans)
  return (
    <div className="xv-compare-wrap" tabIndex={0} role="region" aria-label="Compare plans">
      <table className="xv-compare">
        <caption className="xv-sr-only">Compare plans</caption>
        <thead>
          <tr>
            <th scope="col" className="xv-compare-corner">Plan</th>
            {plans.map(plan => (
              <th key={plan.tier} scope="col" className={plan.tier === POPULAR_TIER ? 'is-popular' : undefined}>
                <span className="xv-compare-plan">{plan.label}</span>
                <span className="xv-compare-price">
                  {plan.price_monthly_usd === null ? 'Custom quote' : `${formatPrice(plan.price_monthly_usd)} a month`}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        {groups.map(group => (
          <tbody key={group.title}>
            <tr className="xv-compare-group">
              <th scope="colgroup" colSpan={plans.length + 1}>{group.title}</th>
            </tr>
            {group.rows.map(r => (
              <tr key={r.label}>
                <th scope="row">{r.label}</th>
                {r.values.map((value, i) => (
                  <td key={plans[i].tier} className={plans[i].tier === POPULAR_TIER ? 'is-popular' : undefined}>
                    <CompareValue value={value} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  )
}

function PlanSkeleton() {
  return (
    <div className="xv-plan-grid" aria-hidden="true">
      {[0, 1, 2, 3].map(i => <div key={i} className="xv-plan xv-plan-skeleton" />)}
    </div>
  )
}

export default function PricingPage() {
  usePageMeta({
    title: 'Pricing',
    description: 'Hirely.ai plans with the positions, resumes, AI interviews, companies and users each one includes.',
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

  return (
    <>
      <PageHero
        eyebrow="Pricing"
        title="Plans that grow with your hiring"
        lead="Every plan includes the full hiring pipeline: resume matching, voice interviews, coding tests and scored reports. Plans differ in size and in the extras you can switch on."
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
              {plans.map((plan, i) => <PlanCard key={plan.tier} plan={plan} previous={plans[i - 1]} />)}
            </div>
          )}
        </div>
        <p className="xv-plan-note">
          Prices are per client, in US dollars, per month, billed monthly in advance, and exclude taxes. Need more than the largest plan?{' '}
          <Link to="/contact?topic=sales">We can set custom limits.</Link>
        </p>
      </Section>

      {state === 'ready' && plans.length > 0 && (
        <Section id="compare" eyebrow="Compare" title={<>Every plan, <span className="xv-accent">side by side</span></>}>
          <ComparePlans plans={plans} />
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
