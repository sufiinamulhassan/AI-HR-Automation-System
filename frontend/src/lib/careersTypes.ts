export interface CareersCompanyRef {
  slug: string
  name: string
  logo_url: string | null
}

export interface CareersCompanyDetail extends CareersCompanyRef {
  website?: string | null
  industry?: string | null
  privacy_url?: string | null
  terms_url?: string | null
}

export interface CareersJobSummary {
  job_id: string
  title: string
  summary: string
  location: string | null
  employment_type: string
  is_remote: boolean
  skills: string[]
  posted_at: string
  deadline_at: string | null
  company: CareersCompanyRef
}

export interface CareersJobDetail extends Omit<CareersJobSummary, 'company'> {
  description: string
  job_grade: string | null
  experience_level: string | null
  industry: string | null
  accepting: boolean
  company: CareersCompanyDetail
}

export interface CareersJobParams {
  q?: string
  company?: string
  location?: string
  type?: string
  remote?: boolean
  page?: number
  limit?: number
}

export interface CareersJobList {
  jobs: CareersJobSummary[]
  total: number
  page: number
  limit: number
  pages: number
}

export interface CareersFilterCompany extends CareersCompanyRef {
  open_jobs: number
}

export interface CareersFilters {
  companies: CareersFilterCompany[]
  locations: string[]
  employment_types: string[]
  remote_jobs: number
  total_open: number
}

export interface CareersApplyResult {
  status: string
  application_id: string
  reference: string
  job_title: string
  company_name: string
}
