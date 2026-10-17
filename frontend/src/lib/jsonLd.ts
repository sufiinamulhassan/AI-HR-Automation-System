import { tokenizeInline } from '../components/site/blockModel'
import type { CareersJobDetail } from './careersTypes'
import type { Faq } from './siteContent'

export interface LdCrumb {
  label: string
  to?: string
}

const CONTEXT = 'https://schema.org'

export function plainText(source: string): string {
  return tokenizeInline(source).map(token => token.text).join('')
}

function absolute(path: string): string {
  return `${window.location.origin}${path}`
}

export function breadcrumbLd(crumbs: LdCrumb[]): object {
  return {
    '@context': CONTEXT,
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((crumb, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: crumb.label,
      ...(crumb.to ? { item: absolute(crumb.to) } : {}),
    })),
  }
}

export function faqLd(faqs: Faq[]): object {
  return {
    '@context': CONTEXT,
    '@type': 'FAQPage',
    mainEntity: faqs.map(faq => ({
      '@type': 'Question',
      name: plainText(faq.q),
      acceptedAnswer: { '@type': 'Answer', text: plainText(faq.a) },
    })),
  }
}

const EMPLOYMENT_TYPES: Record<string, string> = {
  'full-time': 'FULL_TIME',
  'part-time': 'PART_TIME',
  contract: 'CONTRACTOR',
  temporary: 'TEMPORARY',
  internship: 'INTERN',
}

export function jobPostingLd(job: CareersJobDetail): object {
  const employmentType = EMPLOYMENT_TYPES[(job.employment_type ?? '').toLowerCase()]
  const place = (job.location ?? '').trim()
  const website = (job.company.website ?? '').trim()
  return {
    '@context': CONTEXT,
    '@type': 'JobPosting',
    title: job.title,
    description: job.description,
    datePosted: job.posted_at,
    ...(job.deadline_at ? { validThrough: job.deadline_at } : {}),
    ...(employmentType ? { employmentType } : {}),
    hiringOrganization: {
      '@type': 'Organization',
      name: job.company.name,
      ...(website.startsWith('https://') ? { sameAs: website } : {}),
    },
    ...(place && !(job.is_remote && place.toLowerCase() === 'remote')
      ? { jobLocation: { '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: place } } }
      : {}),
    ...(job.is_remote ? { jobLocationType: 'TELECOMMUTE' } : {}),
    directApply: true,
  }
}
