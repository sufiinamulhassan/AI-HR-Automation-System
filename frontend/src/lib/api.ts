import axios, { type AxiosResponse } from 'axios'
import { API_BASE, API_V1 } from './config'
import { useAuthStore } from '../store/auth.store'
import { announceSimulated, isSimulatedResponse } from './demoNotice'
import type {
  CareersApplyResult, CareersFilters, CareersJobDetail, CareersJobList, CareersJobParams,
} from './careersTypes'
import type {
  AdminInput, AiOverview, BillingStatement, ClientDetail, ClientList, ClientPatch, ClientRow, CompanyDeleteProgress,
  CompanyDetail, CompanyDomains, CompanyList, CompanyPatch, CompanyRow, EntityStatus, NewClientInput,
  NewCompanyInput, OwnerInput, PlansCatalog, PlatformAuditPage, PlatformHealth, PlatformOverview, PlatformOwner,
  PlatformPeriod, ReadOptions, SubscriptionPatch, UsageMatrix,
} from './platformTypes'
import type {
  ContactInput, ContactRequest, ContactRequestList, ContactRequestPatch, ContactRequestQuery, ContactResult, SitePlans,
} from './siteTypes'

const api = axios.create({ baseURL: API_V1 })

const publicApi = axios.create({ baseURL: API_V1 })

export const systemApi = {
  health: () => axios.get(`${API_BASE}/health`),
  liveCheck: () => api.post('/system/live-check'),
}

api.interceptors.request.use(cfg => {
  const token = useAuthStore.getState().token
  if (token) cfg.headers.Authorization = `Bearer ${token}`
  return cfg
})

const WORKSPACE_BLOCKS: { prefix: string; reason: 'suspended' | 'trial' | 'subscription' }[] = [
  { prefix: 'This workspace is suspended', reason: 'suspended' },
  { prefix: "This workspace's trial has ended", reason: 'trial' },
  { prefix: "This workspace's subscription has ended", reason: 'subscription' },
]

const SIGN_IN_PATHS = ['/auth/login', '/auth/verify-otp', '/auth/token']

api.interceptors.response.use(
  r => {
    if (isSimulatedResponse(r.data)) announceSimulated(r.data.message)
    return r
  },
  err => {
    if (err.response?.status === 401) {
      if (!SIGN_IN_PATHS.includes(err.config?.url)) {
        const token = useAuthStore.getState().token
        if (token && token.startsWith('demo-')) {
          try {
            sessionStorage.setItem('demo-auth-rejected', '1')
          } catch {
            void 0
          }
        }
        useAuthStore.getState().logout()
        window.location.href = '/login'
      }
    } else if (err.response?.status === 403) {
      const detail = err.response?.data?.detail
      const block = typeof detail === 'string' ? WORKSPACE_BLOCKS.find(b => detail.startsWith(b.prefix)) : undefined
      if (useAuthStore.getState().token && block) {
        useAuthStore.getState().logout()
        window.location.href = `/login?blocked=${block.reason}`
      }
    }
    return Promise.reject(err)
  }
)

export const authApi = {
  login: (email: string, password: string) => api.post('/auth/login', { email, password }),
  verifyOtp: (email: string, otp_code: string) => api.post('/auth/verify-otp', { email, otp_code }),
  listModels: () => api.get('/auth/models'),
  setDefaultModel: (default_model: string) => api.patch('/auth/models/default', { default_model }),
  token: (username: string, password: string) => {
    const params = new URLSearchParams()
    params.append('username', username)
    params.append('password', password)
    return api.post('/auth/token', params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    })
  },
  me: () => api.get('/auth/me'),
  updateMe: (d: { name?: string; job_title?: string; timezone?: string }) => api.patch('/auth/me', d),
  setOtp: (enabled: boolean) => api.patch('/auth/me/otp', { enabled }),
  passwordPolicy: () => api.get('/auth/password-policy'),
  myPermissions: () => api.get('/auth/me/permissions'),
  listUsers: (params?: UserListParams) =>
    (params ? api.get('/auth/users', { params }) : api.get('/auth/users')).then(withTotal),
  createUser: (d: object) => api.post<CreateUserResult>('/auth/users', d),
  updateUser: (email: string, d: object) => api.patch(`/auth/users/${email}`, d),
  deleteUser: (email: string) => api.delete(`/auth/users/${email}`),
  changePassword: (d: object) => api.post('/auth/change-password', d),
  adminResetPassword: (d: object) => api.post('/auth/admin/reset-password', d),
  inviteUser: (email: string) => api.post<InviteUserResult>(`/auth/users/${encodeURIComponent(email)}/invite`),
  forgotPassword: (email: string) => publicApi.post<{ message?: string }>('/auth/forgot-password', { email }),
  resetPassword: (token: string, newPassword: string) =>
    publicApi.post<{ message?: string }>('/auth/reset-password', { token, new_password: newPassword }),

  getAvatar: () => api.get('/auth/me/avatar'),
  uploadAvatar: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return api.post('/auth/me/avatar', fd)
  },
  deleteAvatar: () => api.delete('/auth/me/avatar'),

  totpStatus: () => api.get<TotpStatus>('/auth/me/totp'),
  totpSetup: () => api.post<TotpSetup>('/auth/me/totp/setup'),
  totpEnable: (code: string) => api.post<{ recovery_codes: string[] }>('/auth/me/totp/enable', { code }),
  totpDisable: (password: string, code: string) =>
    api.post<{ enabled: boolean }>('/auth/me/totp/disable', { password, code }),
  totpRecoveryCodes: (code: string) =>
    api.post<{ recovery_codes: string[] }>('/auth/me/totp/recovery-codes', { code }),
  resetUserTotp: (email: string) => api.post<{ message?: string }>(`/auth/users/${encodeURIComponent(email)}/totp/reset`),
  signOutEverywhere: () => api.post<{ access_token: string; token_type?: string }>('/auth/me/sign-out-everywhere'),
}

export interface UserListParams {
  limit?: number
  skip?: number
  search?: string
}

export interface TotpStatus {
  enabled: boolean
  pending?: boolean
  recovery_codes_remaining?: number
}

export interface TotpSetup {
  secret: string
  otpauth_uri: string
}

export type WithTotal<T> = AxiosResponse<T> & { total: number }

function withTotal<T>(r: AxiosResponse<T>): WithTotal<T> {
  const raw = r.headers?.['x-total-count']
  const parsed = raw === undefined || raw === null || raw === '' ? NaN : Number(raw)
  const total = Number.isFinite(parsed) && parsed >= 0 ? parsed : Array.isArray(r.data) ? r.data.length : 0
  return Object.assign(r, { total })
}

export interface OidcConfig {
  enabled: boolean
  enforce: boolean
  name?: string
}

export const ssoApi = {
  oidcConfig: (company: string) => publicApi.get<OidcConfig>('/sso/oidc/config', { params: { company } }),
}

export const careersApi = {
  jobs: (params?: CareersJobParams) => publicApi.get<CareersJobList>('/careers/jobs', { params }),
  filters: () => publicApi.get<CareersFilters>('/careers/filters'),
  job: (id: string) => publicApi.get<CareersJobDetail>(`/careers/jobs/${encodeURIComponent(id)}`),
  apply: (id: string, formData: FormData) =>
    publicApi.post<CareersApplyResult>(`/careers/jobs/${encodeURIComponent(id)}/apply`, formData),
}

export const siteApi = {
  plans: () => publicApi.get<SitePlans>('/site/plans'),
  contact: (input: ContactInput) => publicApi.post<ContactResult>('/site/contact', input),
}

export function oidcLoginUrl(company: string): string {
  return `${API_V1}/sso/oidc/login?company=${encodeURIComponent(company)}`
}

export interface CreateUserResult {
  message?: string
  invited?: boolean
  email_sent?: boolean
}

export interface InviteUserResult {
  email_sent: boolean
  purpose?: 'invite' | 'reset'
}

export const securityPoliciesApi = {
  get: () => api.get('/security-policies'),
  update: (d: {
    password_min_length?: number
    password_require_number?: boolean
    password_require_symbol?: boolean
    max_login_attempts_before_lockout?: number
    account_lockout_duration_minutes?: number
    session_timeout_minutes?: number | null
  }) => api.patch('/security-policies', d),
}

export interface ModelTaskOption {
  id: string
  name: string
  provider: 'openai' | 'anthropic' | string
  price_label: string
  available: boolean
}

export type ModelTaskKind = 'chat' | 'embedding' | 'speech' | 'transcription'

export interface ModelTask {
  key: string
  label: string
  group: string
  kind: ModelTaskKind
  model: string
  model_name: string
  price_label: string | null
  override: string | null
  default_model: string
  default_name: string
}

export interface ModelTasksResponse {
  tasks: ModelTask[]
  options: Record<ModelTaskKind, ModelTaskOption[]>
  default_model: string
}

export interface EmbeddingStatus {
  model: string
  platform_default: string
  stale_jobs: number
  stale_resumes: number
  stale_total: number
}

export interface ReindexResult {
  model: string
  processed: number
  failed: number
  remaining: number
  next_cursor: string | null
  done: boolean
}

export const modelTasksApi = {
  list: () => api.get<ModelTasksResponse>('/model-tasks'),
  set: (task: string, model: string | null) => api.put<ModelTask>(`/model-tasks/${encodeURIComponent(task)}`, { model }),
  embeddingStatus: () => api.get<EmbeddingStatus>('/model-tasks/embedding/status'),
  reindex: (cursor?: string | null, limit?: number) =>
    api.post<ReindexResult>('/model-tasks/embedding/reindex', null, { params: { cursor: cursor || undefined, limit } }),
}

export interface EmailDeliveryFailure {
  log_id: string
  to: string | null
  subject: string | null
  kind: 'invite' | 'status' | 'offer' | 'other'
  candidate_id: string | null
  created_at: string | null
  error: string | null
  hint?: string | null
}

export interface EmailDeliveryWarning {
  code: string
  message: string
}

export interface EmailDeliveryHealth {
  configured: boolean
  provider: 'smtp' | 'ses' | null
  from_address: string | null
  host: string | null
  from_name?: string | null
  frontend_url?: string | null
  warnings?: EmailDeliveryWarning[]
  waiting_invites?: number
  last_7d: { sent: number; failed: number; console_only: number }
  recent_failures: EmailDeliveryFailure[]
}

export interface EmailVerifyResult {
  ok: boolean
  provider: 'smtp' | 'ses' | null
  detail: string
}

export interface EmailResendWaitingResult {
  attempted: number
  sent: number
  failed: number
  skipped: number
  remaining: number
}

export interface EmailTestSendResult {
  delivered: boolean
  status: string
  detail: string
}

export interface EmailResendResult {
  attempted: number
  delivered: number
  failed: number
  skipped: number
  results?: { log_id: string; outcome: 'delivered' | 'failed' | 'skipped'; reason: string | null }[]
}

export const emailDeliveryApi = {
  health: () => api.get<EmailDeliveryHealth>('/email-delivery/health'),
  testSend: (to: string) => api.post<EmailTestSendResult>('/email-delivery/test-send', { to }),
  resendFailed: (d: { log_ids: string[] | null; limit?: number }) =>
    api.post<EmailResendResult>('/email-delivery/resend-failed', d),
  verify: () => api.post<EmailVerifyResult>('/email-delivery/verify'),
  resendWaiting: (d: { limit?: number } = {}) =>
    api.post<EmailResendWaitingResult>('/email-delivery/resend-waiting', d),
}

export interface PipelineFit {
  resume_id: string
  candidate_name: string | null
  score: number
  semantic_part: number
  skills_boost: number
  threshold: number
  above_threshold: boolean
  skills: { matched: string[]; missing: string[]; extra: string[]; coverage: number }
  seniority: { candidate: string | null; required: string[]; aligned: boolean | null }
  domain: { candidate: string | null; required: string | null; aligned: boolean | null }
  headline: string
}

export interface PipelineAiOpinion {
  summary: string
  strengths: string[]
  concerns: string[]
  follow_up_questions: string[]
  model: string
}

export interface BulkStageResult {
  updated: number
  skipped: unknown[]
}

export type JobStatusFilter = 'open' | 'closed' | 'all'

export interface JobBrowseParams {
  page?: number
  limit?: number
  search?: string
  status?: JobStatusFilter
}

export interface JobBrowseResult {
  jobs: Record<string, unknown>[]
  total: number
  page: number
  limit: number
  counts: Record<JobStatusFilter, number>
}

export type ComparisonSource = 'ai' | 'interviewer_scorecard'
export type ComparisonRecommendation = 'hire' | 'maybe' | 'reject'

export type ComparisonDimensions = Record<InterviewDimension, number | null>

export interface ComparisonRow {
  rank: number
  candidate_id: string
  resume_id: string
  name?: string | null
  erased?: boolean
  stage: string
  source: ComparisonSource
  final_score: number | null
  dimensions: ComparisonDimensions
  recommendation: ComparisonRecommendation | null
  interviewed_at: string | null
  match_score: number | null
  offer_status: string | null
  secure_token: string
}

export interface JobComparison {
  job_id: string
  title: string
  rows: ComparisonRow[]
  stats: { count: number; average: number | null; highest: number | null }
}

export const jobsApi = {
  list: (params?: { page?: number; limit?: number; search?: string }) =>
    api.get('/jobs', { params }),
  browse: (params: JobBrowseParams, signal?: AbortSignal) =>
    api.get<JobBrowseResult>('/jobs', { params, signal }),
  get: (id: string) => api.get(`/jobs/${id}`),
  create: (d: object) => api.post('/jobs', d),
  update: (id: string, d: object) => api.patch(`/jobs/${id}`, d),
  delete: (id: string) => api.delete(`/jobs/${id}`),
  pipeline: (id: string) => api.get(`/jobs/${id}/pipeline`),
  sourcing: (id: string) => api.get(`/jobs/${id}/sourcing`),
  updateStage: (jobId: string, resumeId: string, stage: string) =>
    api.patch(`/jobs/${jobId}/pipeline/${resumeId}`, null, { params: { stage } }),
  pipelineFit: (jobId: string, resumeId: string) =>
    api.get<PipelineFit>(`/jobs/${jobId}/pipeline/${resumeId}/fit`),
  pipelineAiOpinion: (jobId: string, resumeId: string) =>
    api.post<PipelineAiOpinion>(`/jobs/${jobId}/pipeline/${resumeId}/fit/ai-opinion`),
  bulkUpdateStage: (jobId: string, resumeIds: string[], stage: string) =>
    api.post<BulkStageResult>(`/jobs/${jobId}/pipeline/bulk-stage`, { resume_ids: resumeIds, stage }),
  comparison: (jobId: string, params?: { stage?: string; include_rejected?: boolean }) =>
    api.get<JobComparison>(`/jobs/${jobId}/comparison`, { params }),
  rematchAll: (invite = false) => api.post('/jobs/rematch-all', null, { params: { invite } }),
  sources: () => api.get('/jobs/sources'),
  stats: () => api.get('/jobs/stats'),
  importJobs: (d: {
    source: string; query?: string; location?: string; limit?: number
    date_posted?: string; job_type?: string; remote_only?: boolean; deadline_days?: number
  }) => api.post('/jobs/import', d),
  expired: () => api.get('/jobs/expired'),
  purgeExpired: () => api.post('/jobs/purge-expired'),
  getJdSettings: () => api.get('/jobs/jd-settings'),
  setJdSettings: (d: { auto_delete_expired: boolean }) => api.patch('/jobs/jd-settings', d),
}

export interface ResumeFilterParams {
  search?: string
  skill?: string
  business_domain?: string
  seniority?: string
  status?: string
  experience_min?: number
  experience_max?: number
  department?: string
  education_level?: string
  industry?: string
  salary_expectation_min?: number
  salary_expectation_max?: number
  worked_at_company?: string
}

export const resumesApi = {
  upload: (file: File, jobId?: string, modelOverride?: string) => {
    const fd = new FormData()
    fd.append('file', file)
    if (jobId) fd.append('job_id', jobId)
    if (modelOverride) fd.append('model_override', modelOverride)
    return api.post('/resumes/upload', fd)
  },
  list: (params?: ResumeFilterParams & {
    page?: number; limit?: number;
    location?: string; domain?: string; certification?: string; notice_period?: string; min_match_score?: number; job_id?: string;
  }) => api.get('/resumes', { params }),
  options: () => api.get('/resumes/filters/options'),
  domains: (params?: ResumeFilterParams) => api.get('/resumes/domains', { params }),
  semantic: (params: ResumeFilterParams & { q: string; limit?: number }) =>
    api.get('/resumes/search/semantic', { params }),
  get: (id: string, includeText = false) =>
    api.get(`/resumes/${id}`, { params: { include_text: includeText } }),
  download: (id: string) => api.get(`/resumes/${id}/download`, { responseType: 'blob' }),
  delete: (id: string) => api.delete(`/resumes/${id}`),
  bulkDelete: (resumeIds: string[]) =>
    api.post<{ deleted: string[]; in_progress: string[]; not_found: string[] }>(
      '/resumes/bulk-delete', { resume_ids: resumeIds },
    ),
  getVersions: (id: string) => api.get(`/resumes/${id}/versions`),
}

export const intelApi = {
  bulkUpload: (files: File[], modelOverride?: string) => {
    const fd = new FormData()
    files.forEach(f => fd.append('files', f))
    if (modelOverride) fd.append('model_override', modelOverride)
    return api.post('/intel/resumes/upload-bulk', fd)
  },
  batchStatus: (batchId: string) => api.get(`/intel/resumes/batch/${batchId}/status`),
  stats: () => api.get('/intel/resumes/stats'),
  batches: (limit = 25) => api.get('/intel/resumes/batches', { params: { limit } }),
  batchDetail: (batchId: string) => api.get(`/intel/resumes/batch/${batchId}/detail`),
  purgeResumes: (d: { from_date?: string; to_date?: string }) => api.post('/intel/resumes/purge', d),
  deleteBatch: (batchId: string) => api.delete(`/intel/resumes/batch/${batchId}`),
  clearBatches: () => api.post('/intel/resumes/batches/clear'),
  costTotal: () => api.get('/intel/cost/total'),
}

export type ExternalPlatform = 'zoom' | 'meet' | 'teams' | 'other' | 'physical'
export type ExternalStatus = 'scheduled' | 'awaiting_review' | 'no_show' | 'reviewed'
export type ExternalRecommendation = 'strong_hire' | 'hire' | 'hold' | 'no_hire'

export interface PipelineExternalFields {
  interview_mode: 'platform' | 'external'
  external_status: ExternalStatus | null
  external_platform: ExternalPlatform | null
  external_platform_label: string | null
  external_scheduled_at: string | null
  external_join_url: string | null
  external_location?: string | null
  review_submitted: boolean
}

export interface ExternalInterviewInput {
  candidate_id?: string
  job_id?: string
  resume_id?: string
  name?: string
  email?: string
  platform: ExternalPlatform
  platform_label?: string
  join_url?: string
  location?: string
  create_meeting?: boolean
  scheduled_start_at: string
  duration_minutes?: number
  notes?: string
  display_timezone?: string
  send_email?: boolean
}

export type ExternalInterviewUpdate = Partial<
  Omit<ExternalInterviewInput, 'candidate_id' | 'job_id' | 'resume_id' | 'name' | 'email'>
>

export interface ExternalInterviewChange {
  at: string
  by: string
  changes: Record<string, [unknown, unknown]>
}

export interface ExternalInterview {
  platform: ExternalPlatform
  platform_label: string | null
  join_url: string | null
  location?: string | null
  scheduled_start_at: string | null
  duration_minutes: number | null
  notes: string | null
  status: ExternalStatus
  history?: ExternalInterviewChange[]
  [extra: string]: unknown
}

export interface ExternalInterviewResult {
  candidate_id: string
  interview_mode: 'external'
  external_interview: ExternalInterview
  email_sent: boolean
}

export interface ExternalInterviewUpdateResult {
  external_interview: ExternalInterview
  email_sent: boolean
}

export interface ExternalResendResult {
  email_sent: boolean
  sent_to: string
}

export interface SendEmailInput {
  template: string
  salary?: string
  joining_date?: string
  benefits?: string
  scheduled_start_at?: string
  duration_minutes?: number
  location?: string
  notes?: string
  display_timezone?: string
}

export type InterviewDimension = 'technical' | 'communication' | 'problem_solving' | 'cultural_fit' | 'confidence'
export type InterviewerRole = 'hr' | 'engineer' | 'hiring_manager' | 'other'

export type ExternalRatings = Record<InterviewDimension, number>

export type StoredRatings = Partial<ExternalRatings> & { culture_fit?: number }

export interface GuideQuestion {
  id: string
  text: string
  dimension: InterviewDimension
  listen_for: string
  source?: 'ai' | 'custom'
}

export interface GuideQuestionInput {
  text: string
  dimension: InterviewDimension
  listen_for?: string
}

export type RejectionReason = 'not_a_fit' | 'salary' | 'withdrew' | 'no_show' | 'position_filled' | 'other'

export interface InterviewGuide {
  questions: GuideQuestion[]
  generated_at: string
  generated_by: string
  model: string | null
  fallback: boolean
}

export interface QuestionMark {
  question_id: string
  rating?: number | null
  notes?: string
}

export interface ExternalReviewInput {
  attended: boolean
  interviewer_name?: string
  interviewer_role?: InterviewerRole
  questions?: QuestionMark[]
  ratings?: ExternalRatings
  recommendation?: ExternalRecommendation
  summary?: string
  strengths?: string
  concerns?: string
  interviewed_at?: string
  note?: string
}

export interface ExternalReviewResult {
  stage: 'completed' | 'interviewing'
  external_status: ExternalStatus
  overall?: number
  final_score?: number
  report_ready?: boolean
}

export interface ExternalReview {
  ratings: StoredRatings | null
  overall: number | null
  recommendation: ExternalRecommendation | null
  summary: string | null
  strengths: string | null
  concerns: string | null
  interviewed_at: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  attended?: boolean
}

export interface ScorecardQuestion {
  question_id: string
  text: string
  dimension: InterviewDimension
  rating: number | null
  notes: string
}

export interface Scorecard {
  scorecard_id: string
  source: 'hr' | 'link'
  submitted_by: string | null
  interviewer_name: string | null
  interviewer_role: InterviewerRole | null
  submitted_at: string | null
  updated_at: string | null
  questions: ScorecardQuestion[]
  ratings: StoredRatings | null
  recommendation: ExternalRecommendation | null
  summary: string | null
  strengths: string | null
  concerns: string | null
}

export interface ExternalReviewDetail {
  external_interview: ExternalInterview
  external_review: ExternalReview | null
  interview_guide: InterviewGuide | null
  scorecards: Scorecard[]
}

export interface DraftSummaryInput {
  questions: QuestionMark[]
  ratings: Partial<ExternalRatings>
  strengths?: string
  concerns?: string
  recommendation?: ExternalRecommendation
}

export interface InterviewerLinkInput {
  interviewer_name?: string
  interviewer_role?: InterviewerRole
  expires_in_days?: number
}

export interface InterviewerLinkCreated {
  link_id: string
  token: string
  url: string
  expires_at: string
}

export interface InterviewerLink {
  link_id: string
  interviewer_name: string | null
  interviewer_role: InterviewerRole | null
  created_at: string
  expires_at: string | null
  revoked: boolean
  submitted: boolean
}

export interface CandidateHighlights {
  seniority: string | null
  domain: string | null
  skills: string[]
}

export interface InterviewerScorecardView {
  candidate_name: string
  job_title: string
  platform_label: string | null
  scheduled_start_at: string | null
  interviewer_name: string | null
  interviewer_role: InterviewerRole | null
  guide: { questions: GuideQuestion[]; fallback?: boolean }
  candidate_highlights: CandidateHighlights | null
  scorecard: Scorecard | null
  locked: boolean
  locked_reason: string | null
  expires_at: string | null
}

export interface InterviewerScorecardInput {
  interviewer_name: string
  interviewer_role: InterviewerRole
  questions: QuestionMark[]
  ratings: ExternalRatings
  recommendation: ExternalRecommendation
  summary: string
  strengths?: string
  concerns?: string
}

export const candidatesApi = {
  create: (d: object) => api.post('/candidates', d),
  list: (params?: object) => api.get('/candidates', { params }),
  get: (id: string) => api.get(`/candidates/${id}`),
  regenerateToken: (id: string, resend = false) =>
    api.post(`/candidates/${id}/regenerate-token`, { resend }),
  resendInvite: (id: string) =>
    api.post<{ message: string; sent_to: string; sent_by: string; resent_count: number }>(
      `/candidates/${id}/resend-invite`,
    ),
  decision: (id: string, decision: string, notes?: string, reason?: RejectionReason) =>
    api.post(`/candidates/${id}/decision`, { decision, notes, ...(reason ? { reason } : {}) }),
  sendEmail: (id: string, d: SendEmailInput) => api.post(`/candidates/${id}/send-email`, d),
  listEmails: (id: string) => api.get(`/candidates/${id}/emails`),
  updateNotes: (id: string, notes: string) => api.patch(`/candidates/${id}/notes`, { notes }),
  getTimeline: (id: string) => api.get(`/candidates/${id}/timeline`),
  getProfile: (profileId: string) => api.get(`/candidates/profile/${profileId}`),
  getProfileByEmail: (email: string) => api.get(`/candidates/profile/by-email/${encodeURIComponent(email)}`),
  updateProfileNotes: (profileId: string, notes: string) => api.patch(`/candidates/profile/${profileId}/notes`, { notes }),

  scheduleExternal: (d: ExternalInterviewInput) =>
    api.post<ExternalInterviewResult>('/candidates/external-interview', d),
  updateExternal: (id: string, d: ExternalInterviewUpdate) =>
    api.patch<ExternalInterviewUpdateResult>(`/candidates/${id}/external-interview`, d),
  resendExternal: (id: string) =>
    api.post<ExternalResendResult>(`/candidates/${id}/external-interview/resend`),
  submitExternalReview: (id: string, d: ExternalReviewInput) =>
    api.post<ExternalReviewResult>(`/candidates/${id}/external-review`, d),
  getExternalReview: (id: string) =>
    api.get<ExternalReviewDetail>(`/candidates/${id}/external-review`),
  draftReviewSummary: (id: string, d: DraftSummaryInput) =>
    api.post<{ summary: string }>(`/candidates/${id}/external-review/draft-summary`, d),

  getInterviewGuide: (id: string) =>
    api.get<InterviewGuide | null>(`/candidates/${id}/interview-guide`),
  generateInterviewGuide: (id: string, regenerate = false) =>
    api.post<InterviewGuide>(`/candidates/${id}/interview-guide`, { regenerate }),
  addGuideQuestion: (id: string, d: GuideQuestionInput) =>
    api.post<InterviewGuide>(`/candidates/${id}/interview-guide/questions`, d),
  removeGuideQuestion: (id: string, questionId: string) =>
    api.delete<InterviewGuide>(`/candidates/${id}/interview-guide/questions/${encodeURIComponent(questionId)}`),
  reorderGuideQuestions: (id: string, ids: string[]) =>
    api.put<InterviewGuide>(`/candidates/${id}/interview-guide/order`, { ids }),

  createInterviewerLink: (id: string, d: InterviewerLinkInput) =>
    api.post<InterviewerLinkCreated>(`/candidates/${id}/interviewer-links`, d),
  listInterviewerLinks: (id: string) =>
    api.get<InterviewerLink[]>(`/candidates/${id}/interviewer-links`),
  revokeInterviewerLink: (id: string, linkId: string) =>
    api.post(`/candidates/${id}/interviewer-links/${linkId}/revoke`),

  erase: (id: string, d: EraseRequest) =>
    api.post<EraseResult>(`/candidates/${encodeURIComponent(id)}/erase`, d),
  eraseByEmail: (d: EraseRequest & { email: string }) =>
    api.post<EraseByEmailResult>('/candidates/erase-by-email', d),
}

export interface EraseRequest {
  reason: string
  include_employment?: boolean
}

export interface EraseResult {
  candidate_id: string
  erased: boolean
  already_erased?: boolean
  erased_at?: string
  counts?: Record<string, number>
  vectors_failed?: number | boolean | unknown[]
  other_applications?: number | unknown[]
}

export interface EraseByEmailResult {
  matched: number
  candidate_ids?: string[]
  erased_at?: string
  counts?: Record<string, number>
  vectors_failed?: number | boolean | unknown[]
}

export const interviewerScorecardApi = {
  get: (token: string) =>
    publicApi.get<InterviewerScorecardView>(`/interviewer-scorecard/${encodeURIComponent(token)}`),
  save: (token: string, d: InterviewerScorecardInput) =>
    publicApi.put<{ saved: boolean }>(`/interviewer-scorecard/${encodeURIComponent(token)}`, d),
}

export const interviewApi = {
  report: (token: string) => api.get(`/interview/report/${token}`),
  reportPdf: (token: string) => api.get(`/interview/report/${token}/pdf`, { responseType: 'blob' }),
  schedule: (
    candidateId: string,
    scheduledStartAt: string | null,
    opts?: { create_meeting?: boolean; meeting_provider?: string | null },
  ) => api.patch(`/interview/${candidateId}/schedule`, {
    scheduled_start_at: scheduledStartAt,
    create_meeting: opts?.create_meeting ?? false,
    meeting_provider: opts?.meeting_provider ?? null,
  }),
  scheduleIcsUrl: (candidateId: string) => `${API_V1}/interview/${candidateId}/schedule.ics`,
  scheduleIcs: (candidateId: string) =>
    api.get(`/interview/${candidateId}/schedule.ics`, { responseType: 'blob' }),

  shares: {
    create: (secureToken: string, expiresInDays: number | null) =>
      api.post(`/interview/report/${secureToken}/share`, { expires_in_days: expiresInDays }),
    list: (secureToken: string) => api.get(`/interview/report/${secureToken}/shares`),
    revoke: (shareId: string) => api.post(`/interview/report/shares/${shareId}/revoke`),
  },
}

export const integrationsApi = {
  status: () => api.get('/integrations/status'),
  hrmsPush: (candidateId: string) => api.post(`/integrations/hrms/push/${candidateId}`),
  hrmsExport: (params?: { job_id?: string; since?: string; limit?: number }) =>
    api.get('/integrations/hrms/export', { params }),
  hrmsLog: (params?: { candidate_id?: string; limit?: number }) =>
    api.get('/integrations/hrms/log', { params }),
}

export const adminConfigApi = {
  listDepartments: () => api.get('/admin/departments'),
  createDepartment: (d: { name: string; description?: string }) => api.post('/admin/departments', d),
  updateDepartment: (id: string, d: object) => api.patch(`/admin/departments/${id}`, d),
  deleteDepartment: (id: string, force = false) =>
    api.delete(`/admin/departments/${id}`, { params: force ? { force: true } : undefined }),
  listDesignations: () => api.get('/admin/designations'),
  createDesignation: (d: { name: string; department?: string; description?: string }) => api.post('/admin/designations', d),
  updateDesignation: (id: string, d: object) => api.patch(`/admin/designations/${id}`, d),
  deleteDesignation: (id: string) => api.delete(`/admin/designations/${id}`),
}

export const jobGradesApi = {
  list: () => api.get('/admin/job-grades'),
  create: (d: { name: string; description?: string }) => api.post('/admin/job-grades', d),
  update: (id: string, d: object) => api.patch(`/admin/job-grades/${id}`, d),
  delete: (id: string) => api.delete(`/admin/job-grades/${id}`),
}

export const scenariosApi = {
  list: (params?: { is_active?: boolean; job_domain?: string }) => api.get('/scenarios', { params }),
  create: (d: { name: string; prompt: string; evaluation_dimensions: string[]; job_domain?: string }) =>
    api.post('/scenarios', d),
  update: (id: string, d: object) => api.patch(`/scenarios/${id}`, d),
  delete: (id: string) => api.delete(`/scenarios/${id}`),
}

export const offersApi = {
  create: (d: { candidate_id: string; salary: string; benefits?: string; joining_date?: string }) =>
    api.post('/offers', d),
  list: (params?: { candidate_id?: string; job_id?: string; status?: string }) =>
    api.get('/offers', { params }),
  approve: (offerId: string) => api.post(`/offers/${offerId}/approve`),
  send: (offerId: string) => api.post(`/offers/${offerId}/send`),
  withdraw: (offerId: string) => api.post(`/offers/${offerId}/withdraw`),
  pdf: (offerId: string) => api.get(`/offers/${offerId}/pdf`, { responseType: 'blob' }),

  draftLetter: (offerId: string, modelOverride?: string) =>
    api.post(`/offers/${offerId}/draft-letter`, modelOverride ? { model_override: modelOverride } : {}),
  approveLetter: (offerId: string) => api.post(`/offers/${offerId}/approve-letter`),

  uploadLetterheadTemplate: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return api.post('/offers/letterhead-template', fd)
  },
  getLetterheadTemplate: () => api.get('/offers/letterhead-template'),

  uploadSignature: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return api.post('/offers/signature', fd)
  },
  getMySignature: () => api.get('/offers/signature/me'),
}

export const analyticsApi = {
  dashboard: () => api.get('/analytics/dashboard'),
}

export type AttentionSeverity = 'info' | 'warn' | 'urgent'

export interface AttentionItem {
  key: string
  label: string
  count: number
  severity: AttentionSeverity
  path: string
  query?: Record<string, string>
}

export interface AttentionSummary {
  generated_at: string
  items: AttentionItem[]
}

export interface AttentionCandidate {
  candidate_id: string
  job_id: string
  job_title: string
  name?: string | null
  erased?: boolean
  stage: string
  detail: string | null
  due_at: string | null
}

export interface AttentionDetail {
  key: string
  label: string
  total: number
  items: AttentionCandidate[]
}

export const attentionApi = {
  get: () => api.get<AttentionSummary>('/attention'),
  detail: (key: string) => api.get<AttentionDetail>(`/attention/${encodeURIComponent(key)}`),
}

export const workflowsApi = {
  list: (params?: { trigger_type?: string; is_active?: boolean }) => api.get('/workflows', { params }),
  create: (d: {
    name: string; trigger_type: string
    conditions: { field: string; operator: string; value: string }[]
    action_type: string; action_params: object
  }) => api.post('/workflows', d),
  update: (id: string, d: object) => api.patch(`/workflows/${id}`, d),
  delete: (id: string) => api.delete(`/workflows/${id}`),
  test: (id: string, context: object) => api.post(`/workflows/${id}/test`, { context }),
  runReminders: (reminder_after_hours?: number) =>
    api.post('/workflows/run-reminders', { reminder_after_hours }),
  triggers: () => api.get('/workflows/triggers'),
}

export const cronApi = {
  status: () => api.get('/cron/status'),
}

export const webhooksApi = {
  list: () => api.get('/webhooks'),
  create: (d: {
    url: string; event_types: string[]; is_active?: boolean; format?: 'raw' | 'slack' | 'teams'
    secret?: string
  }) => api.post('/webhooks', d),
  update: (id: string, d: object) => api.patch(`/webhooks/${id}`, d),
  delete: (id: string) => api.delete(`/webhooks/${id}`),
  test: (id: string) => api.post(`/webhooks/${id}/test`),
  eventTypes: () => api.get('/webhooks/event-types'),
  deliveries: (id: string, limit = 50) => api.get(`/webhooks/${id}/deliveries`, { params: { limit } }),
}

export const rbacApi = {
  listPermissions: () => api.get('/rbac/permissions'),
  listRoles: () => api.get('/rbac/roles'),
  createRole: (d: { name: string; permissions?: string[]; description?: string }) =>
    api.post('/rbac/roles', {
      role_name: d.name,
      permissions: d.permissions ?? [],
      description: d.description,
    }),
  updateRole: (roleName: string, d: { permissions?: string[]; description?: string }) =>
    api.patch(`/rbac/roles/${encodeURIComponent(roleName)}`, d),
  deleteRole: (roleName: string, reassignTo?: string) =>
    api.delete(`/rbac/roles/${encodeURIComponent(roleName)}`, {
      params: reassignTo ? { reassign_to: reassignTo } : undefined,
    }),
  assignUserRole: (email: string, role: string) =>
    api.patch(`/rbac/users/${encodeURIComponent(email)}/role`, { role_name: role }),
  auditLog: (params?: {
    page?: number; limit?: number; actor_email?: string; action?: string
    resource_type?: string; resource_id?: string; start_date?: string; end_date?: string
  }) => api.get('/rbac/audit-log', { params }),
  auditLogFacets: () => api.get('/rbac/audit-log/facets'),
}

export const savedFiltersApi = {
  list: (scope?: string) => api.get('/saved-filters', { params: scope ? { scope } : undefined }),
  create: (d: { name: string; filter_params: object; scope?: string }) => api.post('/saved-filters', d),
  get: (id: string) => api.get(`/saved-filters/${id}`),
  update: (id: string, d: { name?: string; filter_params?: object }) => api.patch(`/saved-filters/${id}`, d),
  delete: (id: string) => api.delete(`/saved-filters/${id}`),
}

export type CompanyPlanFeatures = Record<string, boolean>

export interface CompanyUsage {
  plan: { name?: string | null; max_users_per_company: number | null; monthly_ai_budget_usd: number | null }
  users: { used: number; limit: number | null }
  ai: { month: string; used_usd: number; budget_usd: number | null; percent: number | null }
  emails_30d?: number
  storage?: { used_mb: number; limit_mb: number | null }
  features?: CompanyPlanFeatures
  subscription?: {
    status: 'none' | 'trialing' | 'active' | 'past_due' | 'canceled'
    trial_ends_at?: string | null
    current_period_end?: string | null
    cancel_at_period_end?: boolean
  }
}

export interface CompanyMail {
  mode: 'platform' | 'smtp'
  from_name: string
  from_address: string
  reply_to: string
  host: string
  port: number | null
  username: string
  use_tls: boolean
  has_password: boolean
  complete: boolean
  updated_at?: string | null
  updated_by?: string | null
}

export interface CompanyMailInput {
  mode?: 'platform' | 'smtp'
  from_name?: string
  from_address?: string
  reply_to?: string
  host?: string
  port?: number | null
  username?: string
  use_tls?: boolean
  password?: string
  clear_password?: boolean
}

export interface CheckResult {
  ok: boolean
  detail: string
}

export interface MailTestResult {
  delivered: boolean
  via: 'company' | 'platform'
  detail: string
}

export interface CompanySso {
  enabled: boolean
  issuer: string
  client_id: string
  has_client_secret: boolean
  scopes: string
  enforce: boolean
  redirect_uri: string
  sso_domains: string[]
}

export interface CompanySsoInput {
  enabled?: boolean
  issuer?: string
  client_id?: string
  client_secret?: string
  scopes?: string
  enforce?: boolean
}

export type IntegrationName = 'hrms' | 'zoom' | 'teams'

export type IntegrationSource = 'company' | 'platform' | null

interface IntegrationBase {
  configured: boolean
  source: IntegrationSource
  updated_at?: string | null
  updated_by?: string | null
}

export interface HrmsIntegration extends IntegrationBase {
  name?: 'hrms'
  url: string
  auth_header: string
  auto_push_on_hire: boolean
  has_auth_token: boolean
}

export interface ZoomIntegration extends IntegrationBase {
  name?: 'zoom'
  account_id: string
  client_id: string
  has_client_secret: boolean
}

export interface TeamsIntegration extends IntegrationBase {
  name?: 'teams'
  tenant_id: string
  client_id: string
  organizer: string
  has_client_secret: boolean
}

export interface CompanyIntegrations {
  hrms: HrmsIntegration
  zoom: ZoomIntegration
  teams: TeamsIntegration
}

export type IntegrationInput = Record<string, string | boolean | undefined> & { clear_secret?: boolean }

export interface CompanyRetention {
  candidate_days: number | null
  resume_days: number | null
  updated_at?: string | null
  updated_by?: string | null
  last_purge?: { at: string; candidates_erased: number; resumes_erased: number } | null
}

export type OnboardingStepKey = 'profile' | 'branding' | 'users' | 'job' | 'resume'

export interface OnboardingState {
  steps: { key: OnboardingStepKey | string; label: string; done: boolean }[]
  dismissed: boolean
}

export const companySettingsApi = {
  get: () => api.get('/company-settings'),
  update: (d: {
    company_name?: string; industry?: string; size?: string
    website?: string; address?: string; primary_contact_email?: string
    terms_url?: string; privacy_url?: string
  }) => api.patch('/company-settings', d),
  integrationsStatus: () => api.get('/company-settings/integrations-status'),
  usage: () => api.get<CompanyUsage>('/company-settings/usage'),
  onboarding: () => api.get<OnboardingState>('/company-settings/onboarding'),
  dismissOnboarding: () => api.post<{ dismissed: boolean }>('/company-settings/onboarding/dismiss'),

  getMail: () => api.get<CompanyMail>('/company-settings/mail'),
  updateMail: (d: CompanyMailInput) => api.put<CompanyMail>('/company-settings/mail', d),
  verifyMail: () => api.post<CheckResult>('/company-settings/mail/verify'),
  testMail: (to: string) => api.post<MailTestResult>('/company-settings/mail/test-send', { to }),

  getSso: () => api.get<CompanySso>('/company-settings/sso'),
  updateSso: (d: CompanySsoInput) => api.put<CompanySso>('/company-settings/sso', d),
  testSso: (issuer?: string) => api.post<CheckResult>('/company-settings/sso/test', issuer ? { issuer } : {}),

  listIntegrations: () => api.get<{ integrations: CompanyIntegrations }>('/company-settings/integrations'),
  updateIntegration: <N extends IntegrationName>(name: N, d: IntegrationInput) =>
    api.put<CompanyIntegrations[N]>(`/company-settings/integrations/${name}`, d),

  getRetention: () => api.get<CompanyRetention>('/company-settings/retention'),
  updateRetention: (d: { candidate_days?: number | null; resume_days?: number | null }) =>
    api.patch<CompanyRetention>('/company-settings/retention', d),
}

export const promptConfigApi = {
  list: () => api.get('/prompt-config'),
  get: (key: string) => api.get(`/prompt-config/${key}`),
  update: (key: string, d: { system_prompt: string; user_prompt_template: string; description?: string }) =>
    api.patch(`/prompt-config/${key}`, d),
  reset: (key: string) => api.delete(`/prompt-config/${key}`),
}

export const emailTemplatesApi = {
  list: () => api.get('/email-templates'),
  get: (key: string) => api.get(`/email-templates/${key}`),
  upsert: (key: string, d: { subject_template?: string; html_body_template?: string; text_body_template?: string; description?: string }) =>
    api.put(`/email-templates/${key}`, d),
  reset: (key: string) => api.delete(`/email-templates/${key}`),
}

export type PublicBrandingKind = 'candidate' | 'offer' | 'review' | 'share' | 'interviewer'

export type PublicBrandingContext =
  | { company: string }
  | { kind: PublicBrandingKind; token: string }

export interface PublicBranding {
  company_logo_url?: string
  primary_color?: string
  accent_color?: string
  company_name?: string
  company_slug?: string
  terms_url?: string
  privacy_url?: string
}

export const brandingApi = {
  getPublic: (context?: PublicBrandingContext) =>
    api.get<PublicBranding>('/branding/public', context ? { params: context } : undefined),
  get: () => api.get('/branding'),
  update: (d: {
    company_logo_url?: string
    primary_color?: string
    accent_color?: string
    letterhead_header_text?: string
    letterhead_footer_text?: string
  }) => api.patch('/branding', d),
  uploadLogo: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return api.post('/branding/logo', fd)
  },
  removeLogo: () => api.delete('/branding/logo'),
}

export const notificationSettingsApi = {
  get: () => api.get('/notification-settings'),
  update: (d: { notify_email?: string; events?: Record<string, boolean> }) =>
    api.patch('/notification-settings', d),
  test: () => api.post<{ sent: boolean; to: string | null; detail: string }>('/notification-settings/test'),
}

export const performanceApi = {
  ratingConfig: () => api.get('/performance/rating-config'),
  ratingDimensions: {
    create: (d: { name: string; description?: string }) => api.post('/performance/rating-dimensions', d),
    update: (dimensionId: string, d: { name?: string; description?: string }) =>
      api.patch(`/performance/rating-dimensions/${dimensionId}`, d),
    delete: (dimensionId: string) => api.delete(`/performance/rating-dimensions/${dimensionId}`),
  },
  ratingScale: {
    update: (d: { scale_min: number; scale_max: number }) => api.patch('/performance/rating-scale', d),
  },
  cycles: {
    list: (status?: string) => api.get('/performance/cycles', { params: status ? { status } : undefined }),
    listActive: () => api.get('/performance/cycles/active'),
    get: (cycleId: string) => api.get(`/performance/cycles/${cycleId}`),
    create: (d: {
      name: string; period_start: string; period_end: string
      scope: { type: string; value?: string | null }; review_types: string[]
    }) => api.post('/performance/cycles', d),
    update: (cycleId: string, d: object) => api.patch(`/performance/cycles/${cycleId}`, d),
    close: (cycleId: string) => api.post(`/performance/cycles/${cycleId}/close`),
    coverage: (cycleId: string) => api.get(`/performance/cycles/${cycleId}/coverage`),
  },
  employees: {
    list: (params?: { department?: string; job_grade?: string; manager_id?: string }) =>
      api.get('/performance/employees', { params }),
    get: (employeeId: string) => api.get(`/performance/employees/${employeeId}`),
    setManager: (employeeId: string, manager_id: string | null) =>
      api.patch(`/performance/employees/${employeeId}/manager`, { manager_id }),
    listGoals: (employeeId: string) => api.get(`/performance/employees/${employeeId}/goals`),
    createGoal: (employeeId: string, d: { title: string; description?: string; due_date?: string; parent_goal_id?: string }) =>
      api.post(`/performance/employees/${employeeId}/goals`, d),
  },
  goals: {
    update: (goalId: string, d: object) => api.patch(`/performance/goals/${goalId}`, d),
  },
  reviews: {
    assign: (d: { cycle_id: string; employee_id: string; reviewer_type: 'self' | 'peer'; reviewer_employee_id?: string }) =>
      api.post('/performance/reviews/assign', d),
    list: (params?: { cycle_id?: string; employee_id?: string; reviewer_type?: string; status?: string }) =>
      api.get('/performance/reviews', { params }),
    get: (reviewId: string) => api.get(`/performance/reviews/${reviewId}`),
  },
  myReports: () => api.get('/performance/my-reports'),
  managerSubmit: (d: {
    cycle_id: string; employee_id: string; reviewer_type: 'manager' | 'skip_level'
    ratings: Record<string, number>; comments?: string
  }) => api.post('/performance/reviews/manager-submit', d),
  reviewsMine: () => api.get('/performance/reviews/mine'),
}

export const userGuideApi = {
  list: () => api.get('/user-guide'),
  get: (role: string) => api.get(`/user-guide/${role}`),
  publish: (role: string, d: object) => api.put(`/user-guide/${role}`, d),
  reset: (role: string) => api.delete(`/user-guide/${role}`),
}

const enc = encodeURIComponent

function periodParams(period?: PlatformPeriod) {
  if (period === undefined) return undefined
  return typeof period === 'number' ? { window: period } : { month: period.month }
}

function withRefresh<P extends object>(params: P | undefined, opts?: ReadOptions): P | (P & { refresh: 1 }) | { refresh: 1 } | undefined {
  return opts?.refresh ? { ...params, refresh: 1 as const } : params
}

function getForPeriod<T>(url: string, period?: PlatformPeriod, opts?: ReadOptions) {
  return period === undefined && !opts?.refresh
    ? api.get<T>(url)
    : api.get<T>(url, { params: withRefresh(periodParams(period), opts) })
}

export const platformApi = {
  overview: (period?: PlatformPeriod, opts?: ReadOptions) =>
    api.get<PlatformOverview>('/platform/overview', { params: withRefresh(periodParams(period), opts) }),
  usage: (period?: PlatformPeriod, opts?: ReadOptions) =>
    api.get<UsageMatrix>('/platform/usage', { params: withRefresh(periodParams(period), opts) }),
  ai: (period?: PlatformPeriod, opts?: ReadOptions) =>
    api.get<AiOverview>('/platform/ai', { params: withRefresh(periodParams(period), opts) }),
  health: () => api.get<PlatformHealth>('/platform/health'),
  audit: (params?: { limit?: number; before?: string }) =>
    api.get<PlatformAuditPage>('/platform/audit', { params }),
  contactRequests: (params?: ContactRequestQuery) =>
    api.get<ContactRequestList>('/platform/contact-requests', { params }),
  updateContactRequest: (requestId: string, d: ContactRequestPatch) =>
    api.patch<ContactRequest>(`/platform/contact-requests/${enc(requestId)}`, d),
  deleteContactRequest: (requestId: string) =>
    api.delete<{ status: 'deleted' }>(`/platform/contact-requests/${enc(requestId)}`),

  listClients: (params?: { search?: string; status?: EntityStatus }, opts?: ReadOptions) =>
    api.get<ClientList>('/platform/clients', { params: withRefresh(params, opts) }),
  createClient: (d: NewClientInput) =>
    api.post<{ client: ClientRow; company: CompanyRow | null; email_sent?: boolean }>('/platform/clients', d),
  getClient: (clientId: string, period?: PlatformPeriod, opts?: ReadOptions) =>
    getForPeriod<ClientDetail>(`/platform/clients/${enc(clientId)}`, period, opts),
  updateClient: (clientId: string, d: ClientPatch) =>
    api.patch<{ client: ClientRow }>(`/platform/clients/${enc(clientId)}`, d),
  suspendClient: (clientId: string, reason?: string) =>
    api.post<{ client: ClientRow }>(`/platform/clients/${enc(clientId)}/suspend`, reason ? { reason } : {}),
  activateClient: (clientId: string) =>
    api.post<{ client: ClientRow }>(`/platform/clients/${enc(clientId)}/activate`),
  deleteClient: (clientId: string, confirmSlug: string) =>
    api.delete(`/platform/clients/${enc(clientId)}`, { data: { confirm_slug: confirmSlug } }),
  createCompany: (clientId: string, d: NewCompanyInput) =>
    api.post<{ company: CompanyRow; email_sent?: boolean }>(`/platform/clients/${enc(clientId)}/companies`, d),

  listCompanies: (params?: { client_id?: string; search?: string; status?: EntityStatus }, opts?: ReadOptions) =>
    api.get<CompanyList>('/platform/companies', { params: withRefresh(params, opts) }),
  getCompany: (companyId: string, period?: PlatformPeriod, opts?: ReadOptions) =>
    getForPeriod<CompanyDetail>(`/platform/companies/${enc(companyId)}`, period, opts),
  updateCompany: (companyId: string, d: CompanyPatch) =>
    api.patch<{ company: CompanyRow }>(`/platform/companies/${enc(companyId)}`, d),
  suspendCompany: (companyId: string, reason?: string) =>
    api.post<{ company: CompanyRow }>(`/platform/companies/${enc(companyId)}/suspend`, reason ? { reason } : {}),
  activateCompany: (companyId: string) =>
    api.post<{ company: CompanyRow }>(`/platform/companies/${enc(companyId)}/activate`),
  deleteCompany: (companyId: string, confirmSlug: string) =>
    api.delete<CompanyDeleteProgress>(`/platform/companies/${enc(companyId)}`, { data: { confirm_slug: confirmSlug } }),
  addAdmin: (companyId: string, d: AdminInput) =>
    api.post<{ admin: { email: string; name: string }; email_sent?: boolean }>(`/platform/companies/${enc(companyId)}/admins`, d),
  resetAdminPassword: (companyId: string, email: string, newPassword: string) =>
    api.post(`/platform/companies/${enc(companyId)}/admins/${enc(email)}/reset-password`, { new_password: newPassword }),

  listOwners: () => api.get<{ owners: PlatformOwner[] }>('/platform/owners'),
  createOwner: (d: OwnerInput) => api.post<{ owner?: PlatformOwner }>('/platform/owners', d),
  setOwnerActive: (email: string, isActive: boolean) =>
    api.patch(`/platform/owners/${enc(email)}`, { is_active: isActive }),

  plans: () => api.get<PlansCatalog>('/platform/plans'),
  setSubscription: (clientId: string, d: SubscriptionPatch) =>
    api.patch<{ client: ClientRow }>(`/platform/clients/${enc(clientId)}/subscription`, d),
  startCheckout: (clientId: string, tier?: string) =>
    api.post<{ url: string }>(`/platform/clients/${enc(clientId)}/billing/checkout`, tier ? { tier } : {}),
  openBillingPortal: (clientId: string) =>
    api.post<{ url: string }>(`/platform/clients/${enc(clientId)}/billing/portal`),
  billingStatement: (params: { month: string; client_id?: string }) =>
    api.get<BillingStatement>('/platform/billing/statement', { params: { ...params, format: 'json' } }),
  billingStatementCsv: (params: { month: string; client_id?: string }) =>
    api.get<Blob>('/platform/billing/statement', { params: { ...params, format: 'csv' }, responseType: 'blob' }),

  getDomains: (companyId: string) => api.get<CompanyDomains>(`/platform/companies/${enc(companyId)}/domains`),
  setDomains: (companyId: string, domains: string[]) =>
    api.put<CompanyDomains>(`/platform/companies/${enc(companyId)}/domains`, { domains }),
}

export default api
