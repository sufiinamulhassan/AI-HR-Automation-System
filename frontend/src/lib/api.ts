import axios from 'axios'
import { API_BASE, API_V1 } from './config'
import { useAuthStore } from '../store/auth.store'

const api = axios.create({ baseURL: API_V1 })

export const systemApi = {
  health: () => axios.get(`${API_BASE}/health`),
}

api.interceptors.request.use(cfg => {
  const token = useAuthStore.getState().token
  if (token) cfg.headers.Authorization = `Bearer ${token}`
  return cfg
})

api.interceptors.response.use(
  r => r,
  err => {
    if (err.response?.status === 401) {
      useAuthStore.getState().logout()
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

export const authApi = {
  login: (email: string, password: string) => api.post('/auth/login', { email, password }),
  verifyOtp: (email: string, otp_code: string) => api.post('/auth/verify-otp', { email, otp_code }),
  token: (username: string, password: string) => {
    const params = new URLSearchParams()
    params.append('username', username)
    params.append('password', password)
    return api.post('/auth/token', params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    })
  },
  me: () => api.get('/auth/me'),
  listUsers: () => api.get('/auth/users'),
  createUser: (d: object) => api.post('/auth/users', d),
  updateUser: (email: string, d: object) => api.patch(`/auth/users/${email}`, d),
  deleteUser: (email: string) => api.delete(`/auth/users/${email}`),
  changePassword: (d: object) => api.post('/auth/change-password', d),
  resetPassword: (d: object) => api.post('/auth/admin/reset-password', d),
  listModels: () => api.get('/auth/models'),
  setDefaultModel: (default_model: string) => api.patch('/auth/models/default', { default_model }),
}

export const jobsApi = {
  list: (params?: { page?: number; limit?: number; search?: string }) =>
    api.get('/jobs', { params }),
  get: (id: string) => api.get(`/jobs/${id}`),
  create: (d: object) => api.post('/jobs', d),
  update: (id: string, d: object) => api.patch(`/jobs/${id}`, d),
  delete: (id: string) => api.delete(`/jobs/${id}`),
  pipeline: (id: string) => api.get(`/jobs/${id}/pipeline`),
  updateStage: (jobId: string, resumeId: string, stage: string) =>
    api.patch(`/jobs/${jobId}/pipeline/${resumeId}`, null, { params: { stage } }),
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

export const resumesApi = {
  upload: (file: File, jobId?: string, modelOverride?: string) => {
    const fd = new FormData()
    fd.append('file', file)
    if (jobId) fd.append('job_id', jobId)
    if (modelOverride) fd.append('model_override', modelOverride)
    return api.post('/resumes/upload', fd)
  },
  list: (params?: {
    page?: number; limit?: number; search?: string;
    domain?: string; seniority?: string; location?: string; skill?: string;
    education_level?: string; certification?: string; notice_period?: string;
    experience_min?: number; experience_max?: number; min_match_score?: number; job_id?: string;
    industry?: string; salary_expectation_min?: number; salary_expectation_max?: number;
    worked_at_company?: string;
  }) => api.get('/resumes', { params }),
  get: (id: string, includeText = false) =>
    api.get(`/resumes/${id}`, { params: { include_text: includeText } }),
  delete: (id: string) => api.delete(`/resumes/${id}`),
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

export const candidatesApi = {
  create: (d: object) => api.post('/candidates', d),
  list: (params?: object) => api.get('/candidates', { params }),
  get: (id: string) => api.get(`/candidates/${id}`),
  regenerateToken: (id: string, resend = false) =>
    api.post(`/candidates/${id}/regenerate-token`, { resend }),
  decision: (id: string, decision: string, notes?: string) =>
    api.post(`/candidates/${id}/decision`, { decision, notes }),
  sendEmail: (id: string, d: { template: string; salary?: string; joining_date?: string; benefits?: string }) =>
    api.post(`/candidates/${id}/send-email`, d),
  listEmails: (id: string) => api.get(`/candidates/${id}/emails`),
  updateNotes: (id: string, notes: string) => api.patch(`/candidates/${id}/notes`, { notes }),
  getTimeline: (id: string) => api.get(`/candidates/${id}/timeline`),
  getProfile: (profileId: string) => api.get(`/candidates/profile/${profileId}`),
  getProfileByEmail: (email: string) => api.get(`/candidates/profile/by-email/${encodeURIComponent(email)}`),
  updateProfileNotes: (profileId: string, notes: string) => api.patch(`/candidates/profile/${profileId}/notes`, { notes }),
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
}

export const analyticsApi = {
  dashboard: () => api.get('/analytics/dashboard'),
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
}

export const webhooksApi = {
  list: () => api.get('/webhooks'),
  create: (d: { url: string; event_types: string[]; is_active?: boolean; format?: 'raw' | 'slack' | 'teams' }) => api.post('/webhooks', d),
  update: (id: string, d: object) => api.patch(`/webhooks/${id}`, d),
  delete: (id: string) => api.delete(`/webhooks/${id}`),
  test: (id: string) => api.post(`/webhooks/${id}/test`),
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
  deleteRole: (roleName: string) => api.delete(`/rbac/roles/${encodeURIComponent(roleName)}`),
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

export const companySettingsApi = {
  get: () => api.get('/company-settings'),
  update: (d: {
    company_name?: string; industry?: string; size?: string
    website?: string; address?: string; primary_contact_email?: string
  }) => api.patch('/company-settings', d),
  integrationsStatus: () => api.get('/company-settings/integrations-status'),
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

export const brandingApi = {
  getPublic: () => api.get('/branding/public'),
  get: () => api.get('/branding'),
  update: (d: { company_logo_url?: string; primary_color?: string; accent_color?: string }) =>
    api.patch('/branding', d),
}

export const notificationSettingsApi = {
  get: () => api.get('/notification-settings'),
  update: (d: { notify_email?: string; events?: Record<string, boolean> }) =>
    api.patch('/notification-settings', d),
}

export const userGuideApi = {
  list: () => api.get('/user-guide'),
  get: (role: string) => api.get(`/user-guide/${role}`),
  publish: (role: string, d: object) => api.put(`/user-guide/${role}`, d),
  reset: (role: string) => api.delete(`/user-guide/${role}`),
}

export default api
