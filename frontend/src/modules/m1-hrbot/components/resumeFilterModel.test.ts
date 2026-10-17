import { describe, expect, it } from 'vitest'
import {
  EMPTY_FILTERS,
  EMPTY_OPTIONS,
  STATUS_OPTIONS,
  activeChips,
  extraFilterCount,
  fallbackLabel,
  folderParams,
  fromSavedParams,
  hasActiveFilters,
  leavesFolders,
  normalizeOptions,
  prettify,
  rangeState,
  toNumber,
  toParams,
  type ResumeFilterValues,
} from './resumeFilterModel'

const filled: ResumeFilterValues = {
  search: '  java dev ',
  skills: ['Java', 'Kafka'],
  businessDomain: 'it_software',
  seniority: 'senior',
  status: 'processed',
  experienceMin: '3',
  experienceMax: '8',
  role: 'Java Developer',
  educationLevel: 'master',
  industry: 'fintech',
  salaryMin: '50000',
  salaryMax: '90000',
  workedAt: ' Acme ',
}

describe('prettify and fallbackLabel', () => {
  it('title-cases slugs and keeps known acronyms upper case', () => {
    expect(prettify('software_engineering')).toBe('Software Engineering')
    expect(prettify('qa_testing')).toBe('QA Testing')
    expect(prettify('ui ux design')).toBe('UI UX Design')
  })

  it('knows the wording of the common values and prettifies the rest', () => {
    expect(fallbackLabel('it_software')).toBe('IT & Software')
    expect(fallbackLabel('bachelor')).toBe("Bachelor's Degree")
    expect(fallbackLabel('mid')).toBe('Mid')
    expect(fallbackLabel('retail_ecommerce')).toBe('Retail & E-commerce')
    expect(fallbackLabel('data_engineering')).toBe('Data Engineering')
  })
})

describe('normalizeOptions', () => {
  it('returns empty lists for anything that is not an options payload', () => {
    expect(normalizeOptions(null)).toEqual(EMPTY_OPTIONS)
    expect(normalizeOptions('nope')).toEqual(EMPTY_OPTIONS)
    expect(normalizeOptions({ skills: 'java', seniorities: {} })).toEqual(EMPTY_OPTIONS)
  })

  it('orders seniority as junior, mid, senior, lead, principal, director, unknown values last', () => {
    const out = normalizeOptions({
      seniorities: [
        { value: 'director', count: 1 }, { value: 'intern', count: 4 }, { value: 'senior', count: 9 },
        { value: 'junior', count: 2 }, { value: 'principal', count: 1 }, { value: 'mid', count: 5 }, { value: 'lead', count: 3 },
      ],
    })
    expect(out.seniorities.map(o => o.value)).toEqual(['junior', 'mid', 'senior', 'lead', 'principal', 'director', 'intern'])
    expect(out.seniorities.map(o => o.label)).toEqual(['Junior', 'Mid', 'Senior', 'Lead', 'Principal', 'Director', 'Intern'])
  })

  it('prefers the label the server sends', () => {
    const out = normalizeOptions({ seniorities: [{ value: 'mid', label: 'Mid-level', count: 5 }] })
    expect(out.seniorities).toEqual([{ value: 'mid', label: 'Mid-level', count: 5 }])
  })

  it('sorts domains by headcount, then name, with Other last', () => {
    const out = normalizeOptions({
      business_domains: [
        { value: 'other', count: 50 }, { value: 'marketing', count: 4 }, { value: 'it_software', count: 12 },
        { value: 'legal', count: 4 },
      ],
    })
    expect(out.businessDomains.map(o => o.label)).toEqual(['IT & Software', 'Legal', 'Marketing', 'Other'])
  })

  it('sorts skills by headcount then name, ignoring case', () => {
    const out = normalizeOptions({
      skills: [{ value: 'sql', count: 3 }, { value: 'Python', count: 9 }, { value: 'Go', count: 3 }, { value: 'aws', count: 3 }],
    })
    expect(out.skills.map(o => o.value)).toEqual(['Python', 'aws', 'Go', 'sql'])
  })

  it('lists education and roles alphabetically by value', () => {
    const out = normalizeOptions({
      education_levels: [{ value: 'phd' }, { value: 'master' }, { value: 'high_school' }, { value: 'bachelor' }, { value: 'other' }],
      roles: [{ value: 'Java Developer' }, { value: 'Data Scientist' }, { value: 'backend engineer' }],
    })
    expect(out.educationLevels.map(o => o.value)).toEqual(['bachelor', 'high_school', 'master', 'other', 'phd'])
    expect(out.educationLevels.map(o => o.label)).toEqual([
      "Bachelor's Degree", 'High School', "Master's Degree", 'Other', 'PhD',
    ])
    expect(out.roles.map(o => o.value)).toEqual(['backend engineer', 'Data Scientist', 'Java Developer'])
  })

  it('lists industries in their usual order with their usual wording', () => {
    const out = normalizeOptions({
      industries: [{ value: 'other' }, { value: 'retail_ecommerce' }, { value: 'fintech' }, { value: 'technology' }, { value: 'zoology' }],
    })
    expect(out.industries.map(o => o.label)).toEqual(['Technology', 'Fintech', 'Retail & E-commerce', 'Other', 'Zoology'])
  })

  it('keeps skills as they are', () => {
    const out = normalizeOptions({ skills: ['node.js'] })
    expect(out.skills).toEqual([{ value: 'node.js', label: 'node.js' }])
  })

  it('does not read job family or availability lists', () => {
    const out = normalizeOptions({
      job_families: [{ value: 'software_engineering', count: 2 }],
      availability_statuses: [{ value: 'available', count: 1 }],
    })
    expect(out).toEqual(EMPTY_OPTIONS)
    expect('jobFamilies' in out).toBe(false)
    expect('availability' in out).toBe(false)
  })

  it('does not read a certifications list', () => {
    const out = normalizeOptions({ certifications: [{ value: 'PMP', count: 3 }] })
    expect(out).toEqual(EMPTY_OPTIONS)
    expect('certifications' in out).toBe(false)
  })

  it('drops duplicates, blanks and non-finite counts', () => {
    const out = normalizeOptions({
      roles: [{ value: 'A', count: 'many' }, { value: 'A' }, { value: '  ' }, null, 7, { value: 5, count: 2 }],
    })
    expect(out.roles).toEqual([{ value: '5', label: '5', count: 2 }, { value: 'A', label: 'A' }])
  })
})

describe('toNumber and rangeState', () => {
  it('reads only finite numbers of zero or more', () => {
    expect(toNumber('4')).toBe(4)
    expect(toNumber(' 0 ')).toBe(0)
    expect(toNumber('2.5')).toBe(2.5)
    expect(toNumber('')).toBeUndefined()
    expect(toNumber('abc')).toBeUndefined()
    expect(toNumber('-3')).toBeUndefined()
    expect(toNumber('Infinity')).toBeUndefined()
  })

  it('keeps a valid range', () => {
    expect(rangeState('2', '9')).toEqual({ min: 2, max: 9, inverted: false, invalid: false })
    expect(rangeState('', '9')).toEqual({ min: undefined, max: 9, inverted: false, invalid: false })
  })

  it('drops a maximum below the minimum and marks the range invalid', () => {
    expect(rangeState('9', '2')).toEqual({ min: 9, max: undefined, inverted: true, invalid: true })
  })

  it('marks unreadable text invalid without inventing a number', () => {
    expect(rangeState('x', '')).toEqual({ min: undefined, max: undefined, inverted: false, invalid: true })
  })
})

describe('toParams', () => {
  it('is empty when nothing is set', () => {
    expect(toParams(EMPTY_FILTERS)).toEqual({})
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false)
  })

  it('maps every filter to the name the API takes', () => {
    expect(toParams(filled)).toEqual({
      search: 'java dev',
      skill: 'Java,Kafka',
      business_domain: 'it_software',
      seniority: 'senior',
      status: 'processed',
      experience_min: 3,
      experience_max: 8,
      department: 'Java Developer',
      education_level: 'master',
      industry: 'fintech',
      salary_expectation_min: 50000,
      salary_expectation_max: 90000,
      worked_at_company: 'Acme',
    })
  })

  it('ignores numbers that are not numbers and never sends a maximum below the minimum', () => {
    const p = toParams({ ...EMPTY_FILTERS, experienceMin: 'abc', experienceMax: '5', salaryMin: '90', salaryMax: '10' })
    expect(p).toEqual({ experience_max: 5, salary_expectation_min: 90 })
  })

  it('sends a zero minimum', () => {
    expect(toParams({ ...EMPTY_FILTERS, experienceMin: '0' })).toEqual({ experience_min: 0 })
  })

  it('counts the extra filters, with the salary range as one', () => {
    expect(extraFilterCount(EMPTY_FILTERS)).toBe(0)
    expect(extraFilterCount(filled)).toBe(5)
    expect(extraFilterCount({ ...EMPTY_FILTERS, salaryMax: '5' })).toBe(1)
    expect(extraFilterCount({ ...EMPTY_FILTERS, seniority: 'mid', skills: ['Java'] })).toBe(0)
  })
})

describe('fromSavedParams', () => {
  it('rebuilds the filters from what toParams saved', () => {
    expect(fromSavedParams(toParams(filled))).toEqual({ ...filled, search: 'java dev', workedAt: 'Acme' })
  })

  it('ignores unknown keys and values of the wrong type', () => {
    const out = fromSavedParams({
      search: 42, skill: { a: 1 }, seniority: ['senior'], business_domain: null, hacked: 'yes',
      experience_min: 'lots', experience_max: -2, role: 'ignored', status: 'archived',
    })
    expect(out).toEqual(EMPTY_FILTERS)
  })

  it('accepts a skill list or a comma separated string, once each', () => {
    expect(fromSavedParams({ skill: 'Java, java ,Kafka,,' }).skills).toEqual(['Java', 'Kafka'])
    expect(fromSavedParams({ skill: ['Go', 'go', 7, 'Rust'] }).skills).toEqual(['Go', 'Rust'])
  })

  it('keeps a known status and rejects an unknown one', () => {
    expect(fromSavedParams({ status: 'failed' }).status).toBe('failed')
    expect(fromSavedParams({ status: 'weird' }).status).toBe('')
    expect(STATUS_OPTIONS.map(o => o.value)).toEqual(['', 'processed', 'pending', 'failed'])
  })

  it('reads numbers given as text and drops an inverted maximum', () => {
    const out = fromSavedParams({ experience_min: '4', experience_max: 2, salary_expectation_min: 10, salary_expectation_max: '20' })
    expect(out.experienceMin).toBe('4')
    expect(out.experienceMax).toBe('')
    expect(out.salaryMin).toBe('10')
    expect(out.salaryMax).toBe('20')
  })

  it('ignores certification, job family and availability kept by a search saved before those filters were removed', () => {
    const out = fromSavedParams({
      certification: 'AWS Certified', domain: 'software_engineering', availability_status: 'available', seniority: 'senior',
    })
    expect(out).toEqual({ ...EMPTY_FILTERS, seniority: 'senior' })
    expect(toParams(out)).toEqual({ seniority: 'senior' })
  })

  it('returns empty filters for anything that is not an object', () => {
    expect(fromSavedParams(null)).toEqual(EMPTY_FILTERS)
    expect(fromSavedParams(['a'])).toEqual(EMPTY_FILTERS)
    expect(fromSavedParams('x')).toEqual(EMPTY_FILTERS)
  })

  it('cuts overlong text', () => {
    expect(fromSavedParams({ search: 'a'.repeat(500) }).search).toHaveLength(200)
  })
})

describe('activeChips', () => {
  it('is empty with no filters', () => {
    expect(activeChips(EMPTY_FILTERS, EMPTY_OPTIONS)).toEqual([])
  })

  it('lists one chip per applied filter in the order of the toolbar', () => {
    const options = normalizeOptions({
      business_domains: [{ value: 'it_software', label: 'IT & Software' }],
      seniorities: [{ value: 'senior', label: 'Senior' }],
    })
    expect(activeChips(filled, options).map(c => c.label)).toEqual([
      'Search: java dev',
      'Skill: Java',
      'Skill: Kafka',
      'Domain: IT & Software',
      'Seniority: Senior',
      'Status: Processed',
      'Experience: 3 to 8 yrs',
      'Role: Java Developer',
      "Education: Master's Degree",
      'Industry: Fintech',
      'Salary: 50000 to 90000',
      'Worked at: Acme',
    ])
  })

  it('describes open ended ranges', () => {
    const labels = (f: Partial<ResumeFilterValues>) => activeChips({ ...EMPTY_FILTERS, ...f }, EMPTY_OPTIONS).map(c => c.label)
    expect(labels({ experienceMin: '5' })).toEqual(['Experience: from 5 yrs'])
    expect(labels({ experienceMax: '5' })).toEqual(['Experience: up to 5 yrs'])
    expect(labels({ salaryMin: '70000' })).toEqual(['Salary: from 70000'])
  })

  it('removes one skill at a time and a whole range at once', () => {
    const chips = activeChips(filled, EMPTY_OPTIONS)
    expect(chips.find(c => c.id === 'skill:Java')?.clear).toEqual({ skills: ['Kafka'] })
    expect(chips.find(c => c.id === 'experience')?.clear).toEqual({ experienceMin: '', experienceMax: '' })
    expect(chips.find(c => c.id === 'salary')?.clear).toEqual({ salaryMin: '', salaryMax: '' })
    expect(chips.find(c => c.id === 'domain')?.clear).toEqual({ businessDomain: '' })
  })

  it('does not show a chip for a maximum that is not applied', () => {
    const chips = activeChips({ ...EMPTY_FILTERS, experienceMin: '9', experienceMax: '2' }, EMPTY_OPTIONS)
    expect(chips.map(c => c.label)).toEqual(['Experience: from 9 yrs'])
  })
})

describe('folder helpers', () => {
  it('drops the two filters that the folders are made of', () => {
    expect(folderParams({ search: 'a', business_domain: 'x', department: 'z', status: 'processed' }))
      .toEqual({ search: 'a', status: 'processed' })
  })

  it('knows which changes belong to the list rather than the folders', () => {
    expect(leavesFolders({ businessDomain: 'it_software' })).toBe(true)
    expect(leavesFolders({ role: 'Java Developer' })).toBe(true)
    expect(leavesFolders({ businessDomain: '' })).toBe(false)
    expect(leavesFolders({ seniority: 'mid', skills: ['Java'] })).toBe(false)
  })
})
