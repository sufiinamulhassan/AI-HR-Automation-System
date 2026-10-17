import { describe, expect, it } from 'vitest'
import type { CareersJobDetail } from './careersTypes'
import { breadcrumbLd, faqLd, jobPostingLd, plainText } from './jsonLd'

function makeJob(patch: Partial<CareersJobDetail> = {}): CareersJobDetail {
  return {
    job_id: 'j1',
    title: 'Data Engineer',
    summary: 'Build pipelines.',
    location: 'Lahore',
    employment_type: 'full-time',
    is_remote: false,
    skills: ['SQL'],
    posted_at: '2026-10-01T00:00:00Z',
    deadline_at: null,
    description: 'Own the data platform.',
    job_grade: null,
    experience_level: null,
    industry: null,
    accepting: true,
    company: { slug: 'acme', name: 'Acme', logo_url: null, website: null, industry: null },
    ...patch,
  }
}

describe('plainText', () => {
  it('removes bold, code and link markup but keeps the words', () => {
    expect(plainText('Use **bold**, `code` and [a link](/pricing) here.')).toBe('Use bold, code and a link here.')
  })
})

describe('breadcrumbLd', () => {
  it('numbers the trail and gives absolute addresses to linked steps only', () => {
    const data = breadcrumbLd([{ label: 'Home', to: '/' }, { label: 'Insights', to: '/insights' }, { label: 'A guide' }]) as {
      '@type': string
      itemListElement: { position: number; name: string; item?: string }[]
    }
    expect(data['@type']).toBe('BreadcrumbList')
    expect(data.itemListElement.map(item => item.position)).toEqual([1, 2, 3])
    expect(data.itemListElement[1].item).toBe(`${window.location.origin}/insights`)
    expect(data.itemListElement[2].item).toBeUndefined()
  })
})

describe('faqLd', () => {
  it('turns questions and answers into plain text', () => {
    const data = faqLd([{ q: 'What is **it**?', a: 'See [pricing](/pricing).' }]) as {
      '@type': string
      mainEntity: { name: string; acceptedAnswer: { text: string } }[]
    }
    expect(data['@type']).toBe('FAQPage')
    expect(data.mainEntity[0].name).toBe('What is it?')
    expect(data.mainEntity[0].acceptedAnswer.text).toBe('See pricing.')
  })
})

describe('jobPostingLd', () => {
  it('describes an on-site full time job', () => {
    const data = jobPostingLd(makeJob()) as Record<string, unknown>
    expect(data['@type']).toBe('JobPosting')
    expect(data.employmentType).toBe('FULL_TIME')
    expect(data.jobLocation).toEqual({ '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: 'Lahore' } })
    expect(data.jobLocationType).toBeUndefined()
    expect(data.validThrough).toBeUndefined()
    expect(data.directApply).toBe(true)
  })

  it('marks remote jobs and skips a location that only says remote', () => {
    const data = jobPostingLd(makeJob({ is_remote: true, location: 'Remote' })) as Record<string, unknown>
    expect(data.jobLocationType).toBe('TELECOMMUTE')
    expect(data.jobLocation).toBeUndefined()
  })

  it('maps employment types, keeps a closing date and only trusts https company sites', () => {
    const contract = jobPostingLd(makeJob({ employment_type: 'Contract', deadline_at: '2026-12-01T00:00:00Z' })) as Record<string, unknown>
    expect(contract.employmentType).toBe('CONTRACTOR')
    expect(contract.validThrough).toBe('2026-12-01T00:00:00Z')

    const secure = jobPostingLd(makeJob({ company: { slug: 'a', name: 'A', logo_url: null, website: 'https://a.test' } })) as { hiringOrganization: { sameAs?: string } }
    expect(secure.hiringOrganization.sameAs).toBe('https://a.test')
    const plain = jobPostingLd(makeJob({ company: { slug: 'a', name: 'A', logo_url: null, website: 'http://a.test' } })) as { hiringOrganization: { sameAs?: string } }
    expect(plain.hiringOrganization.sameAs).toBeUndefined()
  })

  it('leaves out an employment type it does not know', () => {
    const data = jobPostingLd(makeJob({ employment_type: 'volunteer' })) as Record<string, unknown>
    expect(data.employmentType).toBeUndefined()
  })
})
