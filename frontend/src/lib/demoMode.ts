import { useAuthStore } from '../store/auth.store'

const STAGE_KEY = 'demo-stage-overrides'

export function isDemoSession(): boolean {
  const token = useAuthStore.getState().token
  return !!token && token.startsWith('demo-')
}

function readOverrides(): Record<string, string> {
  try {
    return JSON.parse(sessionStorage.getItem(STAGE_KEY) || '{}')
  } catch {
    return {}
  }
}

function writeOverrides(map: Record<string, string>): void {
  try {
    sessionStorage.setItem(STAGE_KEY, JSON.stringify(map))
  } catch {
    void 0
  }
}

export function setDemoStage(jobId: string, resumeId: string, stage: string): void {
  if (!isDemoSession()) return
  const map = readOverrides()
  map[`${jobId}:${resumeId}`] = stage
  writeOverrides(map)
}

export function applyDemoStages<T extends Record<string, unknown>>(
  jobId: string,
  rows: T[]
): T[] {
  if (!isDemoSession()) return rows
  const map = readOverrides()
  if (!Object.keys(map).length) return rows
  return rows.map(row => {
    const stage = map[`${jobId}:${row.resume_id as string}`]
    return stage ? { ...row, pipeline_stage: stage } : row
  })
}

export function clearDemoStages(): void {
  try {
    sessionStorage.removeItem(STAGE_KEY)
  } catch {
    void 0
  }
}