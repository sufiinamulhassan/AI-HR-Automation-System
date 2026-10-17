import type {
  AiCompanyRow, AiJobRow, AiKey, AiOverview, BillingStatement, ClientDetail, ClientRow, CompanyAi, CompanyDetail, CompanyRow,
  PlansCatalog, PlatformHealth, PlatformOverview, UsageMatrix,
} from '../lib/platformTypes'

export function clientRow(overrides: Partial<ClientRow> = {}): ClientRow {
  return {
    client_id: 'cli_acme',
    name: 'Acme Holdings',
    slug: 'acme-holdings',
    status: 'active',
    plan: { name: 'growth' },
    contact_name: 'Dana Reyes',
    contact_email: 'dana@acme.test',
    notes: null,
    created_at: '2026-01-15T09:00:00Z',
    companies: 2,
    users: 18,
    active_users: 11,
    jobs: 6,
    resumes: 140,
    candidates: 31,
    interviews: 9,
    coding: 2,
    offers: 1,
    performance: 0,
    emails: 80,
    ai_calls: 412,
    ai_cost_usd: 3.2174, email_cost_usd: 0, total_cost_usd: 3.2174,
    last_active_at: null,
    top_feature: { key: 'resumes', label: 'Resumes', count: 140 },
    usage: { jobs: 6, resumes: 140, interviews: 9 },
    ...overrides,
  }
}

export function companyRow(overrides: Partial<CompanyRow> = {}): CompanyRow {
  return {
    company_id: 'cmp_acme',
    client_id: 'cli_acme',
    client_name: 'Acme Holdings',
    name: 'Acme Corp',
    slug: 'acme-corp',
    status: 'active',
    created_at: '2026-01-16T09:00:00Z',
    sso_domains: ['acme.test'],
    users: 12,
    active_users: 8,
    jobs: 4,
    resumes: 100,
    candidates: 20,
    interviews: 6,
    coding: 1,
    offers: 1,
    performance: 0,
    emails: 50,
    ai_calls: 300,
    ai_cost_usd: 2.5, email_cost_usd: 0, total_cost_usd: 2.5,
    last_active_at: null,
    admins: [{ email: 'sam@acme.test', name: 'Sam Lee' }],
    ...overrides,
  }
}

export const OVERVIEW: PlatformOverview = {
  window_days: 30,
  totals: {
    clients: 4, companies: 6, active_companies: 5, suspended_companies: 1,
    users: 63, active_users: 38, jobs: 21, resumes: 900, candidates: 120, interviews: 44,
    coding: 12, offers: 7, performance: 3, emails: 640, ai_calls: 1204, ai_cost_usd: 9.41, email_cost_usd: 0, total_cost_usd: 9.41,
  },
  features: [
    { key: 'jobs', label: 'Jobs', total: 21, window: 8, top_client: { client_id: 'cli_acme', name: 'Acme Holdings', count: 6 } },
    { key: 'resumes', label: 'Resumes', total: 900, window: 310, top_client: { client_id: 'cli_zed', name: 'Zed Staffing', count: 200 } },
    { key: 'coding', label: 'Coding assessments', total: 12, window: 0, top_client: null },
  ],
  top_clients: [
    { client_id: 'cli_acme', name: 'Acme Holdings', companies: 2, users: 18, active_users: 11, activity: 186, ai_cost_usd: 3.2174, email_cost_usd: 0, total_cost_usd: 3.2174 },
    { client_id: 'cli_zed', name: 'Zed Staffing', companies: 1, users: 9, active_users: 4, activity: 93, ai_cost_usd: 1.5, email_cost_usd: 0, total_cost_usd: 1.5 },
  ],
  growth: [
    { month: '2026-08', clients: 2, companies: 3 },
    { month: '2026-09', clients: 3, companies: 5 },
    { month: '2026-10', clients: 4, companies: 6 },
  ],
  recent: [
    { at: '2026-10-08T14:02:11Z', action: 'client_suspend', actor_email: 'owner@hirely.test', resource_type: 'client', resource_id: 'cli_acme', details: { name: 'Acme Holdings' } },
  ],
}

export const DETAIL: ClientDetail = {
  client: clientRow(),
  companies: [
    companyRow(),
    companyRow({
      company_id: 'cmp_labs', name: 'Acme Labs', slug: 'acme-labs', status: 'suspended',
      sso_domains: [], admins: [], users: 6, active_users: 3,
    }),
  ],
  features: [
    { key: 'jobs', label: 'Jobs', total: 6, window: 2 },
    { key: 'resumes', label: 'Resumes', total: 140, window: 60 },
  ],
  cost_by_source: [
    { source: 'resume_parse', cost_usd: 2.9, calls: 380 },
    { source: 'interview_eval', cost_usd: 0.3174, calls: 32 },
  ],
  activity: [
    { date: '2026-10-06', count: 4 },
    { date: '2026-10-07', count: 12 },
    { date: '2026-10-08', count: 20 },
  ],
}

export const COMPANY_DETAIL: CompanyDetail = {
  company: companyRow({
    admins: [{ email: 'sam@acme.test', name: 'Sam Lee' }, { email: 'eve@acme.test', name: 'Eve Park' }],
  }),
  features: [
    { key: 'jobs', label: 'Jobs', total: 4, window: 1 },
    { key: 'resumes', label: 'Resumes', total: 100, window: 40 },
  ],
  cost_by_source: [
    { source: 'resume_parse', cost_usd: 2.2, calls: 250 },
    { source: 'interview_eval', cost_usd: 0.3, calls: 20 },
  ],
  activity: [
    { date: '2026-10-06', count: 3 },
    { date: '2026-10-07', count: 9 },
    { date: '2026-10-08', count: 12 },
  ],
}

export const AI_KEYS: AiKey[] = [
  {
    id: 'anthropic', label: 'Anthropic', env_var: 'ANTHROPIC_API_KEY', configured: true, mask: '********FAAA', scope: 'platform',
    companies: 2, calls: 310, cost_usd: 1.2468,
    models: [{ kind: 'chat', model: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', calls: 310, cost_usd: 1.2468 }],
  },
  {
    id: 'openai', label: 'OpenAI', env_var: 'OPENAI_API_KEY', configured: true, mask: '********Sv4A', scope: 'platform',
    companies: 1, calls: 92, cost_usd: 0.0404,
    models: [
      { kind: 'chat', model: 'gpt-5-mini', name: 'GPT-5 Mini', calls: 40, cost_usd: 0.04 },
      { kind: 'embedding', model: 'text-embedding-3-small', name: 'Text Embedding 3 Small', calls: 52, cost_usd: 0.0004 },
    ],
  },
]

export function aiJob(overrides: Partial<AiJobRow> = {}): AiJobRow {
  return {
    key: 'interview', label: 'Interview questions, follow-ups and scoring', group: 'Interview', kind: 'chat',
    model: 'claude-haiku-4-5', model_name: 'Claude Haiku 4.5', provider: 'anthropic', key_env: 'ANTHROPIC_API_KEY',
    ready: true, custom: false, default_model: 'claude-haiku-4-5', default_name: 'Claude Haiku 4.5',
    ...overrides,
  }
}

const ACME_JOBS: AiJobRow[] = [
  aiJob({ key: 'interview', model: 'gpt-5-mini', model_name: 'GPT-5 Mini', provider: 'openai', key_env: 'OPENAI_API_KEY', custom: true }),
  aiJob({ key: 'job_description', label: 'Job description parsing', group: 'Hiring' }),
  aiJob({
    key: 'speech', label: 'Interviewer voice (text to speech)', kind: 'speech', model: 'gpt-4o-mini-tts', model_name: 'GPT-4o Mini TTS',
    provider: 'openai', key_env: 'OPENAI_API_KEY', default_model: 'gpt-4o-mini-tts', default_name: 'GPT-4o Mini TTS',
  }),
  aiJob({
    key: 'embedding', label: 'Embeddings for CV and job matching', group: 'Hiring', kind: 'embedding', model: 'text-embedding-3-large',
    model_name: 'Text Embedding 3 Large', provider: 'openai', key_env: 'OPENAI_API_KEY', custom: true,
    default_model: 'text-embedding-3-small', default_name: 'Text Embedding 3 Small',
  }),
]

const ACME_USED: AiCompanyRow['used'] = [
  { kind: 'chat', model: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', provider: 'anthropic', calls: 250, tokens_in: 300000, tokens_out: 90000, cost_usd: 1.1 },
  { kind: 'chat', model: 'gpt-5-mini', name: 'GPT-5 Mini', provider: 'openai', calls: 40, tokens_in: 12000, tokens_out: 8000, cost_usd: 0.04 },
  { kind: 'embedding', model: 'text-embedding-3-small', name: 'Text Embedding 3 Small', provider: 'openai', calls: 52, tokens_in: 20000, tokens_out: null, cost_usd: 0.0004 },
]

export function aiCompanyRow(overrides: Partial<AiCompanyRow> = {}): AiCompanyRow {
  return {
    company_id: 'cmp_acme', name: 'Acme Corp', slug: 'acme', status: 'active', client_id: 'cli_acme', client_name: 'Acme Holdings',
    default_model: 'claude-haiku-4-5', default_name: 'Claude Haiku 4.5', custom_jobs: 2,
    jobs: ACME_JOBS,
    used: ACME_USED,
    providers: { anthropic: { calls: 250, cost_usd: 1.1 }, openai: { calls: 92, cost_usd: 0.0404 } },
    cost_usd: 1.1404,
    ...overrides,
  }
}

export const AI_OVERVIEW: AiOverview = {
  computed_at: '2026-10-12T14:02:00Z',
  period: { kind: 'window', from: '2026-09-13T00:00:00Z', to: '2026-10-12T14:02:00Z' },
  keys: AI_KEYS,
  companies: [
    aiCompanyRow(),
    aiCompanyRow({
      company_id: 'cmp_zed', name: 'Zed Staffing', slug: 'zed', status: 'suspended', client_id: 'cli_zed', client_name: 'Zed Group',
      default_model: 'gpt-4.1-mini', default_name: 'GPT-4.1 Mini', custom_jobs: 0,
      jobs: [aiJob({ key: 'scenario', label: 'Scenario answer scoring', model: 'gpt-4.1-mini', model_name: 'GPT-4.1 Mini', provider: 'openai', key_env: 'OPENAI_API_KEY', ready: false })],
      used: [{ kind: 'chat', model: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', provider: 'anthropic', calls: 60, tokens_in: 70000, tokens_out: 20000, cost_usd: 0.1468 }],
      providers: { anthropic: { calls: 60, cost_usd: 0.1468 }, openai: { calls: 0, cost_usd: 0 } },
      cost_usd: 0.1468,
    }),
    aiCompanyRow({
      company_id: 'cmp_midway', name: 'Midway Labs', slug: 'midway', client_id: 'cli_midway', client_name: 'Midway Group',
      custom_jobs: 5, jobs: [aiJob({ key: 'resume', label: 'CV classification', group: 'Hiring' })],
      used: [], providers: { anthropic: { calls: 0, cost_usd: 0 }, openai: { calls: 0, cost_usd: 0 } }, cost_usd: 0,
    }),
  ],
}

export const COMPANY_AI: CompanyAi = {
  keys: AI_KEYS.map(k => ({ ...k, companies: 1 })),
  default_model: 'claude-haiku-4-5',
  default_name: 'Claude Haiku 4.5',
  jobs: ACME_JOBS,
  used: ACME_USED,
}

export const HEALTH: PlatformHealth = {
  mongo: { ok: true, latency_ms: 12.4 },
  email: { configured: true, provider: 'smtp' },
  pinecone: { configured: false },
  cron: [
    {
      key: 'daily_digest', last_run_at: '2026-10-11T06:00:00Z', status: 'ok', detail: 'Sent 12 digests',
      companies_total: 6, companies_served: 5, companies_failed: 1,
    },
    {
      key: 'purge_expired_jobs', last_run_at: null, status: null, detail: null,
      companies_total: null, companies_served: null, companies_failed: null,
    },
  ],
  failed_emails_24h: [
    { company_id: 'cmp_acme', company_name: 'Acme Corp', client_name: 'Acme Holdings', failed: 4 },
    { company_id: 'cmp_zed', company_name: 'Zed Staffing', client_name: 'Zed Group', failed: 1 },
  ],
}

export const USAGE: UsageMatrix = {
  window_days: 30,
  features: [
    { key: 'jobs', label: 'Jobs' },
    { key: 'resumes', label: 'Resumes' },
    { key: 'interviews', label: 'Interviews' },
  ],
  rows: [
    { client_id: 'cli_acme', name: 'Acme Holdings', status: 'active', counts: { jobs: 6, resumes: 40, interviews: 9 }, top_feature: 'resumes' },
    { client_id: 'cli_zed', name: 'Zed Staffing', status: 'active', counts: { jobs: 3, resumes: 200, interviews: 0 }, top_feature: 'resumes' },
    { client_id: 'cli_mid', name: 'Midway Group', status: 'suspended', counts: { jobs: 12, resumes: 0, interviews: 3 }, top_feature: 'jobs' },
  ],
}

export function httpError(status: number, detail: unknown) {
  return { response: { status, data: { detail } } }
}

const ALL_FEATURES = ['coding', 'performance', 'webhooks', 'workflows', 'custom_smtp', 'oidc_sso', 'custom_domain', 'integrations']
const flags = (on: boolean) => Object.fromEntries(ALL_FEATURES.map(k => [k, on]))

export const PLANS: PlansCatalog = {
  default_tier: 'standard',
  tiers: [
    {
      tier: 'standard', label: 'Standard',
      plan: {
        name: 'standard', max_companies: null, max_users_per_company: null, monthly_ai_budget_usd: null,
        max_storage_mb: null, price_monthly_usd: null, trial_ends_at: null, features: flags(true),
      },
    },
    {
      tier: 'starter', label: 'Starter',
      plan: {
        name: 'starter', max_companies: 1, max_users_per_company: 5, monthly_ai_budget_usd: 10,
        max_storage_mb: 500, price_monthly_usd: 29, trial_ends_at: null, features: flags(false),
      },
    },
    {
      tier: 'growth', label: 'Growth',
      plan: {
        name: 'growth', max_companies: 3, max_users_per_company: 25, monthly_ai_budget_usd: 50,
        max_storage_mb: 5000, price_monthly_usd: 99, trial_ends_at: null,
        features: { ...flags(true), oidc_sso: false, custom_domain: false },
      },
    },
  ],
  features: [
    { key: 'coding', label: 'Coding assessments' },
    { key: 'performance', label: 'Performance reviews' },
    { key: 'webhooks', label: 'Webhooks' },
    { key: 'workflows', label: 'Workflow rules' },
    { key: 'custom_smtp', label: 'Custom SMTP' },
    { key: 'oidc_sso', label: 'OIDC single sign-on' },
    { key: 'custom_domain', label: 'Custom domains' },
    { key: 'integrations', label: 'Integrations' },
  ],
}

export const STATEMENT: BillingStatement = {
  month: '2026-10',
  period: { kind: 'month', from: '2026-10-01T00:00:00Z', to: '2026-11-01T00:00:00Z' },
  generated_at: '2026-11-02T08:00:00Z',
  clients: [
    {
      client_id: 'cli_acme', client_name: 'Acme Holdings', plan: { name: 'growth', price_monthly_usd: 99 }, subscription_status: 'active',
      lines: [
        { company_id: 'cmp_acme', company_name: 'Acme Corp', status: 'active', seats: 12, ai_cost_usd: 2.5, ai_calls: 300, emails_sent: 50, storage_mb: 120.5 },
        { company_id: 'cmp_labs', company_name: 'Acme Labs', status: 'suspended', seats: 6, ai_cost_usd: 0.7174, ai_calls: 112, emails_sent: 30, storage_mb: 20 },
      ],
      totals: { companies: 2, seats: 18, ai_cost_usd: 3.2174, ai_calls: 412, emails_sent: 80, storage_mb: 140.5 },
    },
    {
      client_id: 'cli_zed', client_name: 'Zed Staffing', plan: { name: 'starter', price_monthly_usd: 29 }, subscription_status: 'trialing',
      lines: [
        { company_id: 'cmp_zed', company_name: 'Zed Staffing', status: 'active', seats: 4, ai_cost_usd: 1.5, ai_calls: 90, emails_sent: 10, storage_mb: 12 },
      ],
      totals: { companies: 1, seats: 4, ai_cost_usd: 1.5, ai_calls: 90, emails_sent: 10, storage_mb: 12 },
    },
  ],
  totals: { companies: 3, seats: 22, ai_cost_usd: 4.7174, ai_calls: 502, emails_sent: 90, storage_mb: 152.5, price_monthly_usd: 128 },
}
