import type { ContactTopic } from './site'

export interface SitePlanFeature {
  key: string
  label: string
  included: boolean
}

export interface SitePlanAllowances {
  positions_per_month: number | null
  resumes_per_position: number | null
  interviews_per_position: number | null
  resumes_kept: number | null
}

export interface SitePlan {
  tier: string
  label: string
  price_monthly_usd: number | null
  max_companies: number | null
  max_users_per_company: number | null
  monthly_ai_budget_usd: number | null
  max_storage_mb: number | null
  allowances?: SitePlanAllowances
  features: SitePlanFeature[]
}

export interface SitePlans {
  plans: SitePlan[]
}

export interface ContactInput {
  name: string
  email: string
  company: string
  topic: ContactTopic
  message: string
  consent: boolean
  website: string
}

export interface ContactResult {
  status: 'received'
  reference: string
}

export type ContactRequestStatus = 'new' | 'in_progress' | 'done' | 'spam'

export interface ContactRequest {
  request_id: string
  name: string
  email: string
  company: string
  topic: ContactTopic
  message: string
  status: ContactRequestStatus
  note: string
  source: string
  created_at: string
  updated_at: string
  handled_by: string | null
}

export interface ContactRequestList {
  items: ContactRequest[]
  total: number
  page: number
  limit: number
  pages: number
  counts: Record<ContactRequestStatus, number>
}

export interface ContactRequestQuery {
  status?: ContactRequestStatus
  topic?: ContactTopic
  q?: string
  page?: number
  limit?: number
}

export interface ContactRequestPatch {
  status?: ContactRequestStatus
  note?: string
}
