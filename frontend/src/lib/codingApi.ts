import axios from 'axios'
import { API_V1 } from './config'
import { useAuthStore } from '../store/auth.store'

const api = axios.create({ baseURL: API_V1 })

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

export interface CodingTestCase {
  input: string
  expected_output: string
  is_hidden: boolean
}

export interface CodingQuestion {
  question_id: string
  title: string
  description: string
  language_templates: Record<string, string>
  test_cases: CodingTestCase[]
  job_domain?: string | null
  difficulty: string
  created_by?: string
  created_at?: string
}

export interface CodingQuestionInput {
  title: string
  description: string
  language_templates: Record<string, string>
  test_cases: CodingTestCase[]
  job_domain?: string
  difficulty: string
}

export interface GenerateQuestionParams {
  job_domain: string
  difficulty?: string
  topic_hint?: string
  model_override?: string
}

export interface CodingSubmissionResult {
  test_case_index: number
  passed: boolean
  is_hidden: boolean
  actual_output?: string
  expected_output?: string
}

export interface CodingQualityReview {
  readability_score?: number
  structure_score?: number
  efficiency_score?: number
  idiomatic_score?: number
  problem_solving_score?: number
  overall_quality_score?: number
  strengths?: string[]
  concerns?: string[]
  approach_summary?: string
  feedback_for_recruiter?: string
  feedback_for_candidate?: string
}

export interface CodingComplexity {
  lines_total?: number
  lines_of_code?: number
  comment_lines?: number
  comment_ratio?: number
  cyclomatic_complexity?: number
  max_nesting_depth?: number
  function_count?: number
  longest_line?: number
  complexity_band?: 'low' | 'moderate' | 'high' | 'very_high'
  method?: string
}

export interface CodingPlagiarismMatch {
  submission_id: string
  candidate_id: string
  similarity: number
  containment: number
  score: number
  identical_normalized: boolean
  one_sided: boolean
}

export interface CodingPlagiarism {
  checked_against: number
  max_similarity: number
  max_containment: number
  flagged: boolean
  threshold: number
  comparable: boolean
  matches: CodingPlagiarismMatch[]
  truncated: boolean
}

export interface CodingSubmission {
  submission_id: string
  question_id: string
  candidate_id: string
  language: string
  code?: string
  status: 'queued' | 'completed' | 'error'
  results: CodingSubmissionResult[]
  score: number
  quality?: CodingQualityReview | null
  quality_score?: number | null
  complexity?: CodingComplexity | null
  plagiarism?: CodingPlagiarism | null
  plagiarism_flagged?: boolean
  submitted_at: string
  evaluated_at: string
  candidate_name?: string | null
  candidate_email?: string | null
  question_title?: string | null
  question_difficulty?: string | null
}

export interface ListSubmissionsParams {
  candidate_id?: string
  question_id?: string
  status?: string
  flagged?: boolean
  page?: number
  limit?: number
}

export const codingApi = {
  listQuestions: (params?: { job_domain?: string; difficulty?: string; page?: number; limit?: number }) =>
    api.get('/coding/questions', { params }),
  getQuestion: (id: string) => api.get(`/coding/questions/${id}`),
  createQuestion: (d: CodingQuestionInput) => api.post('/coding/questions', d),
  generateQuestion: (params: GenerateQuestionParams) => api.post('/coding/questions/generate', params),
  updateQuestion: (id: string, d: Partial<CodingQuestionInput>) => api.patch(`/coding/questions/${id}`, d),
  deleteQuestion: (id: string) => api.delete(`/coding/questions/${id}`),
  assignQuestion: (candidateId: string, questionId: string) =>
    api.patch(`/coding/assign/${candidateId}`, { question_id: questionId }),
  getSession: (token: string) => axios.get(`${API_V1}/coding/session/${token}`),
  submitSession: (token: string, d: { language: string; code: string }) =>
    axios.post(`${API_V1}/coding/session/${token}/submit`, d),
  listSubmissions: (params?: ListSubmissionsParams) => api.get('/coding/submissions', { params }),
  listSubmissionsForCandidate: (candidateId: string) => api.get(`/coding/submissions/${candidateId}`),
}

export default codingApi
