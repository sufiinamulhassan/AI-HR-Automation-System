const configured = import.meta.env.VITE_API_BASE_URL as string | undefined
export const API_BASE = (configured ?? (import.meta.env.DEV ? 'http://localhost:8000' : ''))
  .replace(/\/+$/, '')
export const API_V1 = `${API_BASE}/api/v1`

export function reportUrl(token: string): string {
  return `${API_V1}/interview/report/${token}`
}

export function reportPdfUrl(token: string): string {
  return `${API_V1}/interview/report/${token}/pdf`
}

export function resumeDownloadUrl(resumeId: string): string {
  return `${API_V1}/resumes/${resumeId}/download`
}
