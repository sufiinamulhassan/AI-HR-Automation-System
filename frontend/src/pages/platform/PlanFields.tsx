import { useEffect, useState } from 'react'
import { platformApi } from '../../lib/api'
import type { FeatureDef, PlansCatalog } from '../../lib/platformTypes'
import { FALLBACK_PLAN_FEATURES, fieldsFromTier, type ClientFields, type FormErrors } from './clientForms'
import { Field } from './PlatformUi'

export function usePlansCatalog(): { catalog: PlansCatalog | null; failed: boolean } {
  const [catalog, setCatalog] = useState<PlansCatalog | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let current = true
    async function load() {
      try {
        const r = await platformApi.plans()
        if (current) setCatalog(r.data)
      } catch {
        if (current) setFailed(true)
      }
    }
    void load()
    return () => { current = false }
  }, [])
  return { catalog, failed }
}

export default function PlanFields({ form, errors, onChange }: {
  form: ClientFields
  errors: FormErrors
  onChange: (patch: Partial<ClientFields>) => void
}) {
  const { catalog, failed } = usePlansCatalog()
  const features: FeatureDef[] = catalog && catalog.features.length > 0 ? catalog.features : FALLBACK_PLAN_FEATURES

  const text = (key: 'planName' | 'maxCompanies' | 'maxUsers' | 'aiBudget' | 'maxStorage' | 'price' | 'trialEnds') => ({
    value: form[key],
    onChange: (e: { target: { value: string } }) => onChange({ [key]: e.target.value }),
  })

  function pickTier(id: string) {
    const tier = catalog?.tiers.find(t => t.tier === id)
    if (!tier) onChange({ tier: '' })
    else onChange(fieldsFromTier(tier, features.map(f => f.key)))
  }

  return (
    <fieldset className="pco-fieldset">
      <legend>Plan</legend>
      {catalog && catalog.tiers.length > 0 && (
        <Field label="Tier" hint="Choosing a tier fills in the fields below. You can change any of them.">
          <select className="form-input" value={form.tier} onChange={e => pickTier(e.target.value)}>
            <option value="">Custom</option>
            {catalog.tiers.map(t => <option key={t.tier} value={t.tier}>{t.label}</option>)}
          </select>
        </Field>
      )}
      {failed && <div className="pco-field-error" role="alert">Could not load the plan tiers. Set the limits by hand.</div>}
      <Field label="Plan name" hint="A label for your own reference.">
        <input className="form-input" autoComplete="off" {...text('planName')} />
      </Field>
      <div className="pco-field-row">
        <Field label="Max companies" error={errors.maxCompanies} hint="Blank is unlimited.">
          <input className="form-input" inputMode="numeric" autoComplete="off" {...text('maxCompanies')} />
        </Field>
        <Field label="Max users per company" error={errors.maxUsers} hint="Blank is unlimited.">
          <input className="form-input" inputMode="numeric" autoComplete="off" {...text('maxUsers')} />
        </Field>
      </div>
      <div className="pco-field-row">
        <Field label="Monthly AI budget (USD)" error={errors.aiBudget} hint="Blank is unlimited.">
          <input className="form-input" inputMode="decimal" autoComplete="off" {...text('aiBudget')} />
        </Field>
        <Field label="Max storage per company (MB)" error={errors.maxStorage} hint="Blank is unlimited.">
          <input className="form-input" inputMode="numeric" autoComplete="off" {...text('maxStorage')} />
        </Field>
      </div>
      <div className="pco-field-row">
        <Field label="Monthly price (USD)" error={errors.price}>
          <input className="form-input" inputMode="decimal" autoComplete="off" {...text('price')} />
        </Field>
        <Field label="Trial ends" error={errors.trialEnds} hint="The last day of the trial. Blank is none.">
          <input className="form-input" type="date" {...text('trialEnds')} />
        </Field>
      </div>
      <fieldset className="pco-fieldset pco-features">
        <legend>Features</legend>
        <div className="pco-feature-grid">
          {features.map(f => (
            <label key={f.key} className="pco-check">
              <input
                type="checkbox"
                checked={form.features[f.key] !== false}
                onChange={e => onChange({ features: { ...form.features, [f.key]: e.target.checked } })}
              />
              <span>{f.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </fieldset>
  )
}
