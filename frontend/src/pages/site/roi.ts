export interface RoiInputs {
  roles: number
  applicants: number
  minutesNow: number
  minutesAfter: number
  hourlyCost: number
}

export interface RoiResult {
  resumesPerMonth: number
  hoursNow: number
  hoursAfter: number
  hoursSavedMonth: number
  hoursSavedYear: number
  valueSavedMonth: number
  valueSavedYear: number
  shareSaved: number
}

export const ROI_DEFAULTS = {
  roles: '5',
  applicants: '100',
  minutesNow: '5',
  minutesAfter: '2',
  hourlyCost: '',
} as const

export const ROI_LIMIT = 1_000_000

export function parseAmount(text: string): number {
  const value = Number(text.trim().replace(/,/g, ''))
  if (!Number.isFinite(value) || value < 0) return 0
  return Math.min(value, ROI_LIMIT)
}

export function calcRoi(input: RoiInputs): RoiResult {
  const resumesPerMonth = input.roles * input.applicants
  const hoursNow = (resumesPerMonth * input.minutesNow) / 60
  const hoursAfter = (resumesPerMonth * input.minutesAfter) / 60
  const hoursSavedMonth = Math.max(0, hoursNow - hoursAfter)
  const valueSavedMonth = hoursSavedMonth * input.hourlyCost
  return {
    resumesPerMonth,
    hoursNow,
    hoursAfter,
    hoursSavedMonth,
    hoursSavedYear: hoursSavedMonth * 12,
    valueSavedMonth,
    valueSavedYear: valueSavedMonth * 12,
    shareSaved: hoursNow > 0 ? hoursSavedMonth / hoursNow : 0,
  }
}

export function formatHours(value: number): string {
  return new Intl.NumberFormat('en', { maximumFractionDigits: value < 10 ? 1 : 0 }).format(value)
}

export function formatValue(value: number): string {
  return new Intl.NumberFormat('en', { maximumFractionDigits: 0 }).format(value)
}
