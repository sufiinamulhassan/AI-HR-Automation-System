import type { ResumeFilterParams } from '../../../lib/api'

export type ViewMode = 'all' | 'folders'

export interface FilterOption { value: string; label: string; count?: number }

export interface ResumeFilterOptions {
  businessDomains: FilterOption[]
  skills: FilterOption[]
  seniorities: FilterOption[]
  educationLevels: FilterOption[]
  industries: FilterOption[]
  roles: FilterOption[]
}

export interface ResumeFilterValues {
  search: string
  skills: string[]
  businessDomain: string
  seniority: string
  status: string
  experienceMin: string
  experienceMax: string
  role: string
  educationLevel: string
  industry: string
  salaryMin: string
  salaryMax: string
  workedAt: string
}

export interface FilterChip {
  id: string
  label: string
  clear: Partial<ResumeFilterValues>
}

export interface ResumeNotice { kind: 'ok' | 'error'; text: string }

export const SAVED_SCOPE = 'resumes'
export const SAVED_NAME_MAX = 80
export const SEMANTIC_MIN_CHARS = 2

export const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'processed', label: 'Processed' },
  { value: 'pending', label: 'Processing' },
  { value: 'failed', label: 'Failed' },
]

export const EMPTY_FILTERS: ResumeFilterValues = {
  search: '',
  skills: [],
  businessDomain: '',
  seniority: '',
  status: '',
  experienceMin: '',
  experienceMax: '',
  role: '',
  educationLevel: '',
  industry: '',
  salaryMin: '',
  salaryMax: '',
  workedAt: '',
}

export const EMPTY_OPTIONS: ResumeFilterOptions = {
  businessDomains: [],
  skills: [],
  seniorities: [],
  educationLevels: [],
  industries: [],
  roles: [],
}

const MAX_TEXT = 200
const MAX_SKILLS = 50

const ACRONYMS = new Set(['qa', 'hr', 'ui', 'ux', 'ai', 'ml', 'it'])

export function prettify(value: string): string {
  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map(w => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
}

type LabelMap = Record<string, string>

const BUSINESS_DOMAIN_LABELS: LabelMap = {
  it_software: 'IT & Software',
  data_ai: 'Data & AI',
  erp_enterprise_apps: 'ERP & Enterprise Apps',
  banking_financial_services: 'Banking & Financial Services',
  finance_accounting: 'Finance & Accounting',
  marketing: 'Marketing',
  sales_business_development: 'Sales & Business Development',
  human_resources: 'Human Resources',
  operations_supply_chain: 'Operations & Supply Chain',
  healthcare_life_sciences: 'Healthcare & Life Sciences',
  engineering_manufacturing: 'Engineering & Manufacturing',
  customer_support: 'Customer Support',
  legal: 'Legal',
  design_creative: 'Design & Creative',
  education: 'Education',
  other: 'Other',
}

const SENIORITY_LABELS: LabelMap = {
  junior: 'Junior',
  mid: 'Mid',
  senior: 'Senior',
  lead: 'Lead',
  principal: 'Principal',
  director: 'Director',
}

const INDUSTRY_LABELS: LabelMap = {
  technology: 'Technology',
  healthcare: 'Healthcare',
  fintech: 'Fintech',
  banking_finance: 'Banking & Finance',
  retail_ecommerce: 'Retail & E-commerce',
  manufacturing: 'Manufacturing',
  education: 'Education',
  government_public_sector: 'Government & Public Sector',
  telecom: 'Telecom',
  media_entertainment: 'Media & Entertainment',
  energy_utilities: 'Energy & Utilities',
  real_estate: 'Real Estate',
  logistics_supply_chain: 'Logistics & Supply Chain',
  hospitality_travel: 'Hospitality & Travel',
  nonprofit: 'Nonprofit',
  other: 'Other',
}

const EDUCATION_LABELS: LabelMap = {
  high_school: 'High School',
  bachelor: "Bachelor's Degree",
  master: "Master's Degree",
  phd: 'PhD',
  bootcamp: 'Bootcamp',
  other: 'Other',
}

const KNOWN_LABELS: LabelMap = { ...BUSINESS_DOMAIN_LABELS, ...INDUSTRY_LABELS, ...SENIORITY_LABELS, ...EDUCATION_LABELS }

export function fallbackLabel(value: string): string {
  return KNOWN_LABELS[value.toLowerCase()] ?? prettify(value)
}

const SENIORITY_ORDER = Object.keys(SENIORITY_LABELS)
const INDUSTRY_ORDER = Object.keys(INDUSTRY_LABELS)

function before(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function byLabel(a: FilterOption, b: FilterOption): number {
  return before(a.label.toLowerCase(), b.label.toLowerCase())
}

function byValue(a: FilterOption, b: FilterOption): number {
  return before(a.value.toLowerCase(), b.value.toLowerCase())
}

function byCount(a: FilterOption, b: FilterOption): number {
  return (b.count ?? 0) - (a.count ?? 0)
}

function inOrder(order: string[]) {
  const rank = (o: FilterOption) => {
    const at = order.indexOf(o.value.toLowerCase())
    return at < 0 ? order.length : at
  }
  return (a: FilterOption, b: FilterOption) => rank(a) - rank(b) || byLabel(a, b)
}

function otherLast(a: FilterOption, b: FilterOption): number {
  return Number(a.value === 'other') - Number(b.value === 'other')
}

function toOptions(raw: unknown, slugs: boolean, labels: LabelMap, order: (a: FilterOption, b: FilterOption) => number): FilterOption[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: FilterOption[] = []
  for (const item of raw) {
    let value = ''
    let label = ''
    let count: number | undefined
    if (typeof item === 'string') {
      value = item.trim()
    } else if (item && typeof item === 'object') {
      const o = item as Record<string, unknown>
      value = typeof o.value === 'string' ? o.value.trim() : typeof o.value === 'number' ? String(o.value) : ''
      label = typeof o.label === 'string' ? o.label.trim() : ''
      if (typeof o.count === 'number' && Number.isFinite(o.count)) count = o.count
    }
    if (!value || seen.has(value)) continue
    seen.add(value)
    const fallback = labels[value.toLowerCase()] ?? (slugs ? prettify(value) : value)
    out.push({ value, label: label || fallback, ...(count !== undefined ? { count } : {}) })
  }
  return out.sort(order)
}

export function normalizeOptions(data: unknown): ResumeFilterOptions {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  return {
    businessDomains: toOptions(d.business_domains, true, BUSINESS_DOMAIN_LABELS,
      (a, b) => otherLast(a, b) || byCount(a, b) || byLabel(a, b)),
    skills: toOptions(d.skills, false, {}, (a, b) => byCount(a, b) || byLabel(a, b)),
    seniorities: toOptions(d.seniorities, true, SENIORITY_LABELS, inOrder(SENIORITY_ORDER)),
    educationLevels: toOptions(d.education_levels, true, EDUCATION_LABELS, byValue),
    industries: toOptions(d.industries, true, INDUSTRY_LABELS, inOrder(INDUSTRY_ORDER)),
    roles: toOptions(d.roles, false, {}, byValue),
  }
}

export function toNumber(raw: string): number | undefined {
  const text = raw.trim()
  if (!text) return undefined
  const n = Number(text)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

export interface RangeState { min?: number; max?: number; inverted: boolean; invalid: boolean }

export function rangeState(minRaw: string, maxRaw: string): RangeState {
  const min = toNumber(minRaw)
  const max = toNumber(maxRaw)
  const inverted = min !== undefined && max !== undefined && max < min
  const unreadable = (minRaw.trim() !== '' && min === undefined) || (maxRaw.trim() !== '' && max === undefined)
  return { min, max: inverted ? undefined : max, inverted, invalid: inverted || unreadable }
}

export function toParams(f: ResumeFilterValues): ResumeFilterParams {
  const p: ResumeFilterParams = {}
  const search = f.search.trim()
  if (search) p.search = search
  if (f.skills.length) p.skill = f.skills.join(',')
  if (f.businessDomain) p.business_domain = f.businessDomain
  if (f.seniority) p.seniority = f.seniority
  if (f.status) p.status = f.status
  const experience = rangeState(f.experienceMin, f.experienceMax)
  if (experience.min !== undefined) p.experience_min = experience.min
  if (experience.max !== undefined) p.experience_max = experience.max
  if (f.role) p.department = f.role
  if (f.educationLevel) p.education_level = f.educationLevel
  if (f.industry) p.industry = f.industry
  const salary = rangeState(f.salaryMin, f.salaryMax)
  if (salary.min !== undefined) p.salary_expectation_min = salary.min
  if (salary.max !== undefined) p.salary_expectation_max = salary.max
  const workedAt = f.workedAt.trim()
  if (workedAt) p.worked_at_company = workedAt
  return p
}

export function hasActiveFilters(f: ResumeFilterValues): boolean {
  return Object.keys(toParams(f)).length > 0
}

export function extraFilterCount(f: ResumeFilterValues): number {
  const p = toParams(f)
  const salary = p.salary_expectation_min !== undefined || p.salary_expectation_max !== undefined
  return [
    p.department, p.education_level, p.industry,
    salary ? 'salary' : '', p.worked_at_company,
  ].filter(Boolean).length
}

function labelOf(list: FilterOption[], value: string): string {
  return list.find(o => o.value === value)?.label ?? fallbackLabel(value)
}

function rangeText(min: number | undefined, max: number | undefined, unit: string): string {
  if (min !== undefined && max !== undefined) return `${min} to ${max}${unit}`
  if (min !== undefined) return `from ${min}${unit}`
  return `up to ${max}${unit}`
}

export function activeChips(f: ResumeFilterValues, options: ResumeFilterOptions): FilterChip[] {
  const p = toParams(f)
  const chips: FilterChip[] = []
  if (p.search) chips.push({ id: 'search', label: `Search: ${p.search}`, clear: { search: '' } })
  for (const skill of f.skills) {
    chips.push({ id: `skill:${skill}`, label: `Skill: ${skill}`, clear: { skills: f.skills.filter(s => s !== skill) } })
  }
  if (f.businessDomain) {
    chips.push({ id: 'domain', label: `Domain: ${labelOf(options.businessDomains, f.businessDomain)}`, clear: { businessDomain: '' } })
  }
  if (f.seniority) {
    chips.push({ id: 'seniority', label: `Seniority: ${labelOf(options.seniorities, f.seniority)}`, clear: { seniority: '' } })
  }
  if (f.status) {
    chips.push({ id: 'status', label: `Status: ${labelOf(STATUS_OPTIONS, f.status)}`, clear: { status: '' } })
  }
  if (p.experience_min !== undefined || p.experience_max !== undefined) {
    chips.push({
      id: 'experience',
      label: `Experience: ${rangeText(p.experience_min, p.experience_max, ' yrs')}`,
      clear: { experienceMin: '', experienceMax: '' },
    })
  }
  if (f.role) chips.push({ id: 'role', label: `Role: ${f.role}`, clear: { role: '' } })
  if (f.educationLevel) {
    chips.push({ id: 'education', label: `Education: ${labelOf(options.educationLevels, f.educationLevel)}`, clear: { educationLevel: '' } })
  }
  if (f.industry) {
    chips.push({ id: 'industry', label: `Industry: ${labelOf(options.industries, f.industry)}`, clear: { industry: '' } })
  }
  if (p.salary_expectation_min !== undefined || p.salary_expectation_max !== undefined) {
    chips.push({
      id: 'salary',
      label: `Salary: ${rangeText(p.salary_expectation_min, p.salary_expectation_max, '')}`,
      clear: { salaryMin: '', salaryMax: '' },
    })
  }
  if (p.worked_at_company) chips.push({ id: 'worked', label: `Worked at: ${p.worked_at_company}`, clear: { workedAt: '' } })
  return chips
}

function savedText(v: unknown): string {
  return typeof v === 'string' ? v.trim().slice(0, MAX_TEXT) : ''
}

function savedNumber(v: unknown): string {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? String(v) : ''
  if (typeof v === 'string') {
    const n = toNumber(v)
    return n === undefined ? '' : String(n)
  }
  return ''
}

function savedSkills(v: unknown): string[] {
  const parts = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of parts) {
    const skill = savedText(part)
    const key = skill.toLowerCase()
    if (!skill || seen.has(key)) continue
    seen.add(key)
    out.push(skill)
    if (out.length >= MAX_SKILLS) break
  }
  return out
}

function savedRange(minRaw: unknown, maxRaw: unknown): [string, string] {
  const min = savedNumber(minRaw)
  const max = savedNumber(maxRaw)
  if (min && max && Number(max) < Number(min)) return [min, '']
  return [min, max]
}

export function fromSavedParams(raw: unknown): ResumeFilterValues {
  const p = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>
  const status = savedText(p.status)
  const [experienceMin, experienceMax] = savedRange(p.experience_min, p.experience_max)
  const [salaryMin, salaryMax] = savedRange(p.salary_expectation_min, p.salary_expectation_max)
  return {
    search: savedText(p.search),
    skills: savedSkills(p.skill),
    businessDomain: savedText(p.business_domain),
    seniority: savedText(p.seniority),
    status: STATUS_OPTIONS.some(o => o.value === status) ? status : '',
    experienceMin,
    experienceMax,
    role: savedText(p.department),
    educationLevel: savedText(p.education_level),
    industry: savedText(p.industry),
    salaryMin,
    salaryMax,
    workedAt: savedText(p.worked_at_company),
  }
}

export function leavesFolders(patch: Partial<ResumeFilterValues>): boolean {
  return Boolean(patch.businessDomain || patch.role)
}

export function folderParams(params: ResumeFilterParams): ResumeFilterParams {
  const { business_domain: _domain, department: _role, ...rest } = params
  return rest
}

export function apiDetail(e: unknown, fallback: string): string {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  return typeof detail === 'string' && detail ? detail : fallback
}
