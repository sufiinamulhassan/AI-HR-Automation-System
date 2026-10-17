import type {
  AdminInput, ClientPatch, ClientPlan, ClientRow, FeatureDef, NewClientInput, NewCompanyInput, OwnerInput, PlanTier,
} from '../../lib/platformTypes'
import { MIN_PASSWORD_LENGTH, isEmail } from './format'

export interface AdminForm {
  adminName: string
  adminEmail: string
  adminPassword: string
  adminInvite?: boolean
}

export const FALLBACK_PLAN_FEATURES: FeatureDef[] = [
  { key: 'coding', label: 'Coding assessments' },
  { key: 'performance', label: 'Performance reviews' },
  { key: 'webhooks', label: 'Webhooks' },
  { key: 'workflows', label: 'Workflow rules' },
  { key: 'custom_smtp', label: 'Custom SMTP' },
  { key: 'oidc_sso', label: 'Single sign-on' },
  { key: 'custom_domain', label: 'Custom domains' },
  { key: 'integrations', label: 'Integrations' },
]

export interface ClientFields {
  name: string
  planName: string
  maxCompanies: string
  maxUsers: string
  aiBudget: string
  contactName: string
  contactEmail: string
  notes: string
  tier: string
  maxStorage: string
  price: string
  trialEnds: string
  features: Record<string, boolean>
}

export interface NewClientForm extends ClientFields, AdminForm {
  withCompany: boolean
  companyName: string
  companySlug: string
}

export const EMPTY_NEW_CLIENT: NewClientForm = {
  name: '', planName: '', maxCompanies: '', maxUsers: '', aiBudget: '',
  contactName: '', contactEmail: '', notes: '',
  tier: '', maxStorage: '', price: '', trialEnds: '', features: {},
  withCompany: false, companyName: '', companySlug: '',
  adminName: '', adminEmail: '', adminPassword: '', adminInvite: false,
}

export type FormErrors = Record<string, string>

function validateAdmin(f: AdminForm, errors: FormErrors, who = 'administrator', passwordRequired = false) {
  if (!f.adminName.trim()) errors.adminName = `Enter the ${who}'s name.`
  if (!f.adminEmail.trim()) errors.adminEmail = `Enter the ${who}'s email.`
  else if (!isEmail(f.adminEmail)) errors.adminEmail = 'Enter a valid email address.'
  if (passwordRequired) {
    if (!f.adminPassword) errors.adminPassword = 'Enter a password.'
    else if (f.adminPassword.length < MIN_PASSWORD_LENGTH) {
      errors.adminPassword = `Use at least ${MIN_PASSWORD_LENGTH} characters.`
    }
  } else if (!f.adminInvite && f.adminPassword && f.adminPassword.length < MIN_PASSWORD_LENGTH) {
    errors.adminPassword = `Use at least ${MIN_PASSWORD_LENGTH} characters.`
  }
}

function wholeNumber(value: string): boolean {
  return /^\d+$/.test(value.trim()) && Number(value) >= 1
}

const amount = (value: string) => Number(value) >= 0 && Number.isFinite(Number(value))

function isDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

function validateClientFields(f: ClientFields, errors: FormErrors) {
  if (!f.name.trim()) errors.name = 'Enter the client\'s name.'
  if (f.contactEmail.trim() && !isEmail(f.contactEmail)) errors.contactEmail = 'Enter a valid email address.'
  if (f.maxCompanies.trim() && !wholeNumber(f.maxCompanies)) errors.maxCompanies = 'Use a whole number, 1 or more.'
  if (f.maxUsers.trim() && !wholeNumber(f.maxUsers)) errors.maxUsers = 'Use a whole number, 1 or more.'
  if (f.maxStorage.trim() && !wholeNumber(f.maxStorage)) errors.maxStorage = 'Use a whole number, 1 or more.'
  if (f.aiBudget.trim() && !amount(f.aiBudget)) errors.aiBudget = 'Use an amount of 0 or more.'
  if (f.price.trim() && !amount(f.price)) errors.price = 'Use an amount of 0 or more.'
  if (f.trialEnds.trim() && !isDay(f.trialEnds.trim())) errors.trialEnds = 'Use a date such as 2026-11-30.'
}

export function validateNewClient(f: NewClientForm): FormErrors {
  const errors: FormErrors = {}
  validateClientFields(f, errors)
  if (f.withCompany) validateAdmin(f, errors)
  return errors
}

function sendsPassword(f: AdminForm): boolean {
  return !f.adminInvite && f.adminPassword !== ''
}

function adminInput(f: AdminForm): AdminInput {
  return {
    name: f.adminName.trim(),
    email: f.adminEmail.trim(),
    ...(sendsPassword(f) ? { password: f.adminPassword } : {}),
  }
}

function newLimit(value: string, tier: string): number | null | undefined {
  if (value.trim()) return Number(value)
  return tier ? null : undefined
}

export function buildNewClientInput(f: NewClientForm): NewClientInput {
  const plan: ClientPlan = {}
  if (f.tier) plan.tier = f.tier
  if (f.planName.trim()) plan.name = f.planName.trim()
  const limits: [keyof ClientPlan, string][] = [
    ['max_companies', f.maxCompanies], ['max_users_per_company', f.maxUsers],
    ['monthly_ai_budget_usd', f.aiBudget], ['max_storage_mb', f.maxStorage], ['price_monthly_usd', f.price],
  ]
  for (const [key, value] of limits) {
    const n = newLimit(value, f.tier)
    if (n !== undefined) (plan as Record<string, unknown>)[key] = n
  }
  if (f.trialEnds.trim()) plan.trial_ends_at = f.trialEnds.trim()
  else if (f.tier) plan.trial_ends_at = null
  if (Object.keys(f.features).length > 0 && (f.tier || Object.values(f.features).includes(false))) {
    plan.features = { ...f.features }
  }

  const body: NewClientInput = { name: f.name.trim() }
  if (Object.keys(plan).length > 0) body.plan = plan
  if (f.contactName.trim()) body.contact_name = f.contactName.trim()
  if (f.contactEmail.trim()) body.contact_email = f.contactEmail.trim()
  if (f.notes.trim()) body.notes = f.notes.trim()
  if (f.withCompany) {
    body.company = {
      name: f.companyName.trim() || f.name.trim(),
      ...(f.companySlug.trim() ? { slug: f.companySlug.trim() } : {}),
      admin: adminInput(f),
    }
  }
  return body
}

const text = (value: string | null | undefined) => value ?? ''
const limit = (value: number | null | undefined) => (value === null || value === undefined ? '' : String(value))

export function clientFieldsFrom(c: ClientRow): ClientFields {
  return {
    name: c.name,
    planName: text(c.plan?.name),
    maxCompanies: limit(c.plan?.max_companies),
    maxUsers: limit(c.plan?.max_users_per_company),
    aiBudget: limit(c.plan?.monthly_ai_budget_usd),
    contactName: text(c.contact_name),
    contactEmail: text(c.contact_email),
    notes: text(c.notes),
    tier: '',
    maxStorage: limit(c.plan?.max_storage_mb),
    price: limit(c.plan?.price_monthly_usd),
    trialEnds: dayOf(c.plan?.trial_ends_at),
    features: { ...(c.plan?.features ?? {}) },
  }
}

function dayOf(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : ''
}

export function completeFeatures(features: Record<string, boolean> | undefined, keys: string[]): Record<string, boolean> {
  return Object.fromEntries(keys.map(k => [k, features?.[k] !== false]))
}

export function fieldsFromTier(tier: PlanTier, featureKeys: string[]): Partial<ClientFields> {
  const plan = tier.plan
  return {
    tier: tier.tier,
    planName: text(plan.name),
    maxCompanies: limit(plan.max_companies),
    maxUsers: limit(plan.max_users_per_company),
    aiBudget: limit(plan.monthly_ai_budget_usd),
    maxStorage: limit(plan.max_storage_mb),
    price: limit(plan.price_monthly_usd),
    features: completeFeatures(plan.features, featureKeys),
  }
}

export function validateClientEdit(f: ClientFields): FormErrors {
  const errors: FormErrors = {}
  validateClientFields(f, errors)
  return errors
}

export function buildClientPatch(c: ClientRow, f: ClientFields): ClientPatch {
  const patch: ClientPatch = {}
  if (f.name.trim() !== c.name) patch.name = f.name.trim()

  const plan: ClientPlan = {
    name: f.planName.trim() || null,
    max_companies: f.maxCompanies.trim() ? Number(f.maxCompanies) : null,
    max_users_per_company: f.maxUsers.trim() ? Number(f.maxUsers) : null,
    monthly_ai_budget_usd: f.aiBudget.trim() ? Number(f.aiBudget) : null,
  }
  const before = c.plan ?? {}
  let planChanged =
    plan.name !== (before.name || null) ||
    plan.max_companies !== (before.max_companies ?? null) ||
    plan.max_users_per_company !== (before.max_users_per_company ?? null) ||
    plan.monthly_ai_budget_usd !== (before.monthly_ai_budget_usd ?? null)

  const storage = f.maxStorage.trim() ? Number(f.maxStorage) : null
  if (storage !== (before.max_storage_mb ?? null)) planChanged = true
  if (storage !== null || before.max_storage_mb != null) plan.max_storage_mb = storage

  const price = f.price.trim() ? Number(f.price) : null
  if (price !== (before.price_monthly_usd ?? null)) planChanged = true
  if (price !== null || before.price_monthly_usd != null) plan.price_monthly_usd = price

  const trial = f.trialEnds.trim() || null
  const trialBefore = dayOf(before.trial_ends_at) || null
  if (trial !== trialBefore) planChanged = true
  if (trial !== null || before.trial_ends_at != null) plan.trial_ends_at = trial === trialBefore ? (before.trial_ends_at ?? null) : trial

  const keys = [...new Set([...Object.keys(f.features), ...Object.keys(before.features ?? {})])]
  if (keys.some(k => (f.features[k] !== false) !== (before.features?.[k] !== false))) planChanged = true
  if (keys.length > 0) plan.features = completeFeatures(f.features, keys)

  if (f.tier) {
    plan.tier = f.tier
    planChanged = true
  }
  if (planChanged) patch.plan = plan

  if (f.contactName.trim() !== text(c.contact_name)) patch.contact_name = f.contactName.trim()
  if (f.contactEmail.trim() !== text(c.contact_email)) patch.contact_email = f.contactEmail.trim()
  if (f.notes.trim() !== text(c.notes)) patch.notes = f.notes.trim()
  return patch
}

export interface NewCompanyForm extends AdminForm {
  name: string
  slug: string
}

export const EMPTY_NEW_COMPANY: NewCompanyForm = {
  name: '', slug: '', adminName: '', adminEmail: '', adminPassword: '', adminInvite: false,
}

export function validateNewCompany(f: NewCompanyForm): FormErrors {
  const errors: FormErrors = {}
  if (!f.name.trim()) errors.name = 'Enter the company\'s name.'
  validateAdmin(f, errors)
  return errors
}

export function buildNewCompanyInput(f: NewCompanyForm): NewCompanyInput {
  return {
    name: f.name.trim(),
    ...(f.slug.trim() ? { slug: f.slug.trim() } : {}),
    admin: adminInput(f),
  }
}

export function validateAdminForm(f: AdminForm, who = 'administrator', passwordRequired = false): FormErrors {
  const errors: FormErrors = {}
  validateAdmin(f, errors, who, passwordRequired)
  return errors
}

export function buildAdminInput(f: AdminForm): AdminInput {
  return adminInput(f)
}

export function buildOwnerInput(f: AdminForm): OwnerInput {
  return { name: f.adminName.trim(), email: f.adminEmail.trim(), password: f.adminPassword }
}

export function validatePassword(password: string): string {
  if (!password) return 'Enter a password.'
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`
  return ''
}

export const MAX_REASON_LENGTH = 500

export function validateReason(reason: string): string {
  const trimmed = reason.trim()
  if (!trimmed) return 'Enter a reason.'
  if (trimmed.length > MAX_REASON_LENGTH) return `Use at most ${MAX_REASON_LENGTH} characters.`
  return ''
}

const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

export function parseDomains(text: string): string[] {
  const seen = new Set<string>()
  for (const part of text.split(/[\s,;]+/)) {
    const domain = part.trim().toLowerCase().replace(/^@/, '')
    if (domain) seen.add(domain)
  }
  return [...seen]
}

export function firstBadDomain(domains: string[]): string | null {
  return domains.find(d => !DOMAIN_RE.test(d)) ?? null
}
