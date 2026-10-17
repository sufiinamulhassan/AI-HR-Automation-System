export const PLATFORM_WINDOWS = [7, 30, 90] as const
export type PlatformWindow = (typeof PLATFORM_WINDOWS)[number]
export const DEFAULT_PLATFORM_WINDOW: PlatformWindow = 30

export type PlatformPeriod = PlatformWindow | { month: string }

export interface UsagePeriod {
  kind: 'month' | 'window'
  from: string
  to: string
}

export type KnownFeatureKey =
  | 'jobs' | 'resumes' | 'candidates' | 'interviews' | 'coding'
  | 'offers' | 'performance' | 'emails' | 'ai'

export type EntityStatus = 'active' | 'suspended'

export interface FeatureDef {
  key: string
  label: string
}

export interface TopFeature {
  key: string
  label: string
  count: number
}

export type PlanFeatures = Record<string, boolean>

export interface ClientPlan {
  tier?: string
  name?: string | null
  max_companies?: number | null
  max_users_per_company?: number | null
  monthly_ai_budget_usd?: number | null
  max_storage_mb?: number | null
  features?: PlanFeatures
  price_monthly_usd?: number | null
  trial_ends_at?: string | null
}

export type SubscriptionStatus = 'none' | 'trialing' | 'active' | 'past_due' | 'canceled'
export type SubscriptionProvider = 'manual' | 'stripe'

export interface Subscription {
  status: SubscriptionStatus
  provider: SubscriptionProvider
  customer_id?: string | null
  subscription_id?: string | null
  current_period_end?: string | null
  cancel_at_period_end?: boolean
}

export interface PlanTier {
  tier: string
  label: string
  plan: ClientPlan
}

export interface PlansCatalog {
  default_tier: string
  tiers: PlanTier[]
  features: FeatureDef[]
}

export interface SubscriptionPatch {
  status: SubscriptionStatus
  trial_ends_at?: string | null
  provider?: SubscriptionProvider
}

export interface UsageTotals {
  users: number
  active_users: number
  jobs: number
  resumes: number
  candidates: number
  interviews: number
  coding: number
  offers: number
  performance: number
  emails: number
  ai_calls: number
  ai_cost_usd: number
  email_cost_usd: number
  total_cost_usd: number
  last_active_at: string | null
}

export interface ClientRow extends UsageTotals {
  client_id: string
  name: string
  slug: string
  status: EntityStatus
  plan: ClientPlan | null
  subscription?: Subscription | null
  storage_mb?: number | null
  storage_limit_mb?: number | null
  contact_name: string | null
  contact_email: string | null
  notes: string | null
  suspended_reason?: string | null
  created_at: string
  companies: number
  top_feature: TopFeature | null
  usage: Record<string, number>
}

export interface CompanyAdmin {
  email: string
  name: string
}

export interface CompanyRow extends UsageTotals {
  company_id: string
  client_id: string
  client_name: string
  name: string
  slug: string
  status: EntityStatus
  plan?: ClientPlan | null
  subscription?: Subscription | null
  storage_mb?: number | null
  storage_limit_mb?: number | null
  suspended_reason?: string | null
  created_at: string
  sso_domains: string[]
  admins: CompanyAdmin[]
}

export interface FeatureUsage extends FeatureDef {
  total: number
  window: number
}

export interface OverviewFeature extends FeatureUsage {
  top_client: { client_id: string; name: string; count: number } | null
}

export interface PlatformTotals {
  clients: number
  companies: number
  active_companies: number
  suspended_companies: number
  users: number
  active_users: number
  jobs: number
  resumes: number
  candidates: number
  interviews: number
  coding: number
  offers: number
  performance: number
  emails: number
  ai_calls: number
  ai_cost_usd: number
  email_cost_usd: number
  total_cost_usd: number
}

export interface TopClient {
  client_id: string
  name: string
  companies: number
  users: number
  active_users: number
  activity: number
  ai_cost_usd: number
  email_cost_usd: number
  total_cost_usd: number
}

export interface GrowthPoint {
  month: string
  clients: number
  companies: number
}

export interface PlatformActivityRow {
  at: string
  action: string
  actor_email: string | null
  resource_type: string | null
  resource_id: string | null
  details: Record<string, unknown> | null
}

export interface PlatformOverview {
  computed_at?: string
  window_days: number
  period?: UsagePeriod
  totals: PlatformTotals
  features: OverviewFeature[]
  top_clients: TopClient[]
  growth: GrowthPoint[]
  recent: PlatformActivityRow[]
}

export interface CostBySource {
  source: string
  cost_usd: number
  calls: number
  unit?: 'emails'
}

export interface ActivityDay {
  date: string
  count: number
}

export interface ClientDetail {
  computed_at?: string
  period?: UsagePeriod
  client: ClientRow
  companies: CompanyRow[]
  features: FeatureUsage[]
  cost_by_source: CostBySource[]
  activity: ActivityDay[]
}

export interface AiKeyModel {
  kind: AiJobKind
  model: string | null
  name: string
  calls: number
  cost_usd: number
}

export interface AiKey {
  id: string
  label: string
  env_var: string
  configured: boolean
  mask: string | null
  scope: 'platform'
  companies: number
  calls: number
  cost_usd: number
  models: AiKeyModel[]
}

export type AiJobKind = 'chat' | 'embedding' | 'speech' | 'transcription'

export interface AiJobRow {
  key: string
  label: string
  group: string
  kind: AiJobKind
  model: string
  model_name: string
  provider: string
  key_env: string | null
  ready: boolean
  custom: boolean
  default_model: string
  default_name: string
}

export interface AiUsedRow {
  kind: AiJobKind
  model: string | null
  name: string
  provider: string
  calls: number
  tokens_in: number | null
  tokens_out: number | null
  cost_usd: number
}

export interface AiProviderSpend {
  calls: number
  cost_usd: number
}

export interface AiCompanyRow {
  company_id: string
  name: string
  slug: string
  status: EntityStatus
  client_id: string | null
  client_name: string
  default_model: string
  default_name: string
  custom_jobs: number
  jobs: AiJobRow[]
  used: AiUsedRow[]
  providers: Record<string, AiProviderSpend>
  cost_usd: number
}

export interface AiOverview {
  computed_at?: string
  period?: UsagePeriod
  keys: AiKey[]
  companies: AiCompanyRow[]
}

export interface CompanyAi {
  keys: AiKey[]
  default_model: string
  default_name: string
  jobs: AiJobRow[]
  used: AiUsedRow[]
}

export interface CompanyDetail {
  computed_at?: string
  period?: UsagePeriod
  company: CompanyRow
  features: FeatureUsage[]
  cost_by_source: CostBySource[]
  activity: ActivityDay[]
  ai?: CompanyAi
}

export interface UsageMatrixRow {
  client_id: string
  name: string
  status: EntityStatus
  counts: Record<string, number>
  top_feature: string | null
}

export interface UsageMatrix {
  computed_at?: string
  window_days: number
  period?: UsagePeriod
  features: FeatureDef[]
  rows: UsageMatrixRow[]
}

export interface PlatformOwner {
  email: string
  name: string
  is_active: boolean
  last_login_at: string | null
  company_name: string | null
  otp_required?: boolean
  otp_enforced?: boolean
}

export interface AdminInput {
  name: string
  email: string
  password?: string
}

export interface OwnerInput {
  name: string
  email: string
  password: string
}

export interface NewClientInput {
  name: string
  slug?: string
  plan?: ClientPlan
  contact_name?: string
  contact_email?: string
  notes?: string
  company?: { name: string; slug?: string; admin: AdminInput }
}

export interface ClientPatch {
  name?: string
  plan?: ClientPlan
  contact_name?: string
  contact_email?: string
  notes?: string
}

export interface NewCompanyInput {
  name: string
  slug?: string
  admin: AdminInput
}

export interface CompanyPatch {
  name?: string
  sso_domains?: string[]
}

export interface CompanyDeleteProgress {
  complete: boolean
  deleted: Record<string, number>
  remaining?: number
}

export interface HealthCronJob {
  key: string
  last_run_at: string | null
  status: string | null
  detail: string | null
  companies_total: number | null
  companies_served: number | null
  companies_failed: number | null
}

export interface FailedEmailRow {
  company_id: string
  company_name: string
  client_name: string
  failed: number
}

export interface PlatformHealth {
  mongo: { ok: boolean; latency_ms: number | null }
  email: { configured: boolean; provider: string | null }
  pinecone: { configured: boolean }
  cron: HealthCronJob[]
  failed_emails_24h: FailedEmailRow[]
}

export interface PlatformAuditPage {
  entries: PlatformActivityRow[]
  next_before: string | null
}

export interface ClientList {
  clients: ClientRow[]
  computed_at?: string
}

export interface CompanyList {
  companies: CompanyRow[]
  computed_at?: string
}

export interface ReadOptions {
  refresh?: boolean
}

export interface CompanyDomains {
  company_id: string
  domains: string[]
  plan_allows?: boolean
}

export interface BillingTotals {
  companies: number
  seats: number
  ai_cost_usd: number
  ai_calls: number
  emails_sent: number
  storage_mb: number
}

export interface BillingLine {
  company_id: string
  company_name: string
  status: string
  seats: number
  ai_cost_usd: number
  ai_calls: number
  emails_sent: number
  storage_mb: number
}

export interface BillingClientStatement {
  client_id: string
  client_name: string
  plan: { name?: string | null; price_monthly_usd?: number | null }
  subscription_status: SubscriptionStatus | string
  lines: BillingLine[]
  totals: BillingTotals
}

export interface BillingStatement {
  month: string
  period?: UsagePeriod
  generated_at?: string
  clients: BillingClientStatement[]
  totals: BillingTotals & { price_monthly_usd: number }
}
