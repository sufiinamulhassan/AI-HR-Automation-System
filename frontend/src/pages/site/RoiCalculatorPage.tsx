import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Btn, CornerDots, CtaBand, PageHero, type Crumb } from '../../components/site/kit'
import { breadcrumbLd } from '../../lib/jsonLd'
import { usePageMeta } from '../../lib/usePageMeta'
import {
  ROI_DEFAULTS, calcRoi, formatHours, formatValue, parseAmount,
} from './roi'
import './RoiCalculatorPage.css'

type Field = keyof typeof ROI_DEFAULTS

interface FieldSpec {
  key: Field
  label: string
  help: string
  optional?: boolean
}

const FIELDS: FieldSpec[] = [
  { key: 'roles', label: 'Open roles per month', help: 'How many roles you screen for in a typical month.' },
  { key: 'applicants', label: 'Applications per role', help: 'The average number of resumes each role receives.' },
  { key: 'minutesNow', label: 'Minutes to review one resume today', help: 'Your current time, including notes and shortlisting.' },
  { key: 'minutesAfter', label: 'Minutes per resume with ranking', help: 'Your own estimate of the time to read a ranked, scored candidate.' },
  { key: 'hourlyCost', label: 'Hourly cost of the reviewer', help: 'Optional. Enter it in your own currency to see a value.', optional: true },
]

export default function RoiCalculatorPage() {
  const crumbs: Crumb[] = [{ label: 'Home', to: '/' }, { label: 'ROI calculator' }]

  usePageMeta({
    title: 'ROI calculator',
    description: 'Estimate the screening hours a ranked pipeline could return to your team, using your own numbers. Plain arithmetic, no predictions.',
    jsonLd: [breadcrumbLd(crumbs)],
  })

  const [values, setValues] = useState<Record<Field, string>>({ ...ROI_DEFAULTS })

  const result = useMemo(() => calcRoi({
    roles: parseAmount(values.roles),
    applicants: parseAmount(values.applicants),
    minutesNow: parseAmount(values.minutesNow),
    minutesAfter: parseAmount(values.minutesAfter),
    hourlyCost: parseAmount(values.hourlyCost),
  }), [values])

  const showValue = parseAmount(values.hourlyCost) > 0
  const nowWidth = result.hoursNow > 0 ? 100 : 0
  const afterWidth = result.hoursNow > 0 ? Math.min(100, (result.hoursAfter / result.hoursNow) * 100) : 0

  return (
    <div className="roi-page">
      <PageHero
        eyebrow="ROI calculator"
        title="Estimate the hours"
        accent="a ranked pipeline could return"
        lead="Enter your own numbers. The result is simple arithmetic on your inputs, not a prediction."
      />

      <section className="xv-card-section">
        <div className="xv-card xv-card-padded">
          <CornerDots />
          <div className="xv-shell roi-grid">
            <form className="xv-form roi-form" onSubmit={event => event.preventDefault()} aria-label="Screening time inputs">
              {FIELDS.map(field => (
                <div className="xv-field" key={field.key}>
                  <label className="xv-label" htmlFor={`roi-${field.key}`}>
                    {field.label}{field.optional && <span className="xv-optional"> (optional)</span>}
                  </label>
                  <input
                    id={`roi-${field.key}`}
                    className="xv-input"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={values[field.key]}
                    onChange={event => setValues(prev => ({ ...prev, [field.key]: event.target.value }))}
                    aria-describedby={`roi-${field.key}-help`}
                  />
                  <p className="xv-help" id={`roi-${field.key}-help`}>{field.help}</p>
                </div>
              ))}
              <p className="xv-help">The starting numbers are examples. Replace them with your own.</p>
            </form>

            <aside className="roi-result" aria-live="polite" aria-label="Estimated result">
              <h2 className="roi-result-title">Your estimate</h2>
              <p className="roi-big">
                <span className="roi-big-num">{formatHours(result.hoursSavedMonth)}</span>
                <span className="roi-big-label">hours back each month</span>
              </p>
              <dl className="roi-list">
                <div><dt>Hours back each year</dt><dd>{formatHours(result.hoursSavedYear)}</dd></div>
                <div><dt>Resumes reviewed each month</dt><dd>{formatHours(result.resumesPerMonth)}</dd></div>
                {showValue && (
                  <>
                    <div><dt>Value each month</dt><dd>{formatValue(result.valueSavedMonth)}</dd></div>
                    <div><dt>Value each year</dt><dd>{formatValue(result.valueSavedYear)}</dd></div>
                  </>
                )}
              </dl>

              <div className="roi-bars" aria-hidden="true">
                <div className="roi-bar-row">
                  <span>Today</span>
                  <span className="roi-bar"><span className="roi-bar-fill" style={{ width: `${nowWidth}%` }} /></span>
                  <span>{formatHours(result.hoursNow)} h</span>
                </div>
                <div className="roi-bar-row">
                  <span>With ranking</span>
                  <span className="roi-bar"><span className="roi-bar-fill is-after" style={{ width: `${afterWidth}%` }} /></span>
                  <span>{formatHours(result.hoursAfter)} h</span>
                </div>
              </div>

              {result.hoursNow > 0 && result.hoursSavedMonth === 0 && (
                <p className="roi-warn">With these numbers the ranked review takes as long as today, so no time is returned.</p>
              )}
            </aside>
          </div>
        </div>
      </section>

      <section className="xv-card-section">
        <div className="xv-card xv-card-padded">
          <CornerDots />
          <div className="xv-shell xv-prose roi-notes">
            <h2>What this does not include</h2>
            <ul>
              <li>The cost of a subscription. See the <Link to="/pricing">pricing page</Link> for plans.</li>
              <li>Interview and scheduling time, which this estimate leaves out.</li>
              <li>Any promise of results. Your numbers decide the answer.</li>
            </ul>
          </div>
        </div>
      </section>

      <CtaBand title="Test the numbers on real resumes" text="Talk to us and measure the review time on your own roles.">
        <Btn to="/contact?topic=sales" variant="white">Talk to sales</Btn>
        <Btn to="/pricing" variant="ghost">See pricing</Btn>
      </CtaBand>
    </div>
  )
}
