import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LEGAL_UPDATED } from '../../lib/site'
import LegalPage from '../../pages/legal/LegalPage'
import { h3, p, table, ul, type LegalDoc } from './blockModel'
import LegalDocument from './LegalDocument'

const DOC: LegalDoc = {
  slug: 'terms',
  title: 'Sample Terms',
  description: 'A short sample document used to test the legal template.',
  intro: 'This introduction explains what the sample is for.',
  related: ['/privacy', '/dpa'],
  sections: [
    { id: 'first-part', title: 'First part', blocks: [p('Some **important** text with a [link](/privacy).'), ul(['One item', 'Another item'])] },
    { id: 'second-part', title: 'Second part', blocks: [h3('A sub heading'), table(['Name', 'Value'], [['Alpha', '1']], 'Sample table')] },
  ],
}

function view(node: React.ReactNode) {
  return render(<MemoryRouter>{node}</MemoryRouter>)
}

afterEach(() => vi.restoreAllMocks())

describe('LegalDocument', () => {
  it('shows the title, introduction and the date it was last updated', () => {
    view(<LegalDocument doc={DOC} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Sample Terms' })).toBeInTheDocument()
    expect(screen.getByText('This introduction explains what the sample is for.')).toBeInTheDocument()
    expect(screen.getByText(`Last updated ${LEGAL_UPDATED.label}`)).toBeInTheDocument()
  })

  it('shows an introduction that uses link markup as plain words, with no links in the hero', () => {
    const doc = { ...DOC, intro: 'Start with the [Candidate Privacy Notice](/candidate-privacy) and **then** read on.' }
    const { container } = view(<LegalDocument doc={doc} />)
    const hero = container.querySelector('.xv-page-hero') as HTMLElement
    expect(hero).toHaveTextContent('Start with the Candidate Privacy Notice and then read on.')
    expect(hero.textContent).not.toMatch(/\]\(|\*\*/)
    expect(hero.querySelectorAll('a, button')).toHaveLength(0)
  })

  it('keeps the print button out of the hero and next to the date', () => {
    const { container } = view(<LegalDocument doc={DOC} />)
    const hero = container.querySelector('.xv-page-hero') as HTMLElement
    expect(within(hero).queryByRole('button')).not.toBeInTheDocument()
    const meta = container.querySelector('.xv-legal-meta') as HTMLElement
    expect(within(meta).getByRole('button', { name: 'Print or save as PDF' })).toBeInTheDocument()
    expect(within(meta).getByText(`Last updated ${LEGAL_UPDATED.label}`)).toBeInTheDocument()
  })

  it('lists every section in a contents list that jumps to it', () => {
    view(<LegalDocument doc={DOC} />)
    const toc = screen.getByRole('navigation', { name: 'On this page' })
    const links = within(toc).getAllByRole('link')
    expect(links.map(a => a.textContent)).toEqual(['First part', 'Second part'])
    expect(links.map(a => a.getAttribute('href'))).toEqual(['#first-part', '#second-part'])
    DOC.sections.forEach(section => expect(document.getElementById(section.id)).not.toBeNull())
  })

  it('names each section by its heading and lets you link to it', () => {
    view(<LegalDocument doc={DOC} />)
    const section = document.getElementById('first-part') as HTMLElement
    expect(section).toHaveAttribute('aria-labelledby', 'first-part-title')
    const heading = within(section).getByRole('heading', { level: 2, name: 'First part' })
    expect(within(heading).getByRole('link')).toHaveAttribute('href', '#first-part')
  })

  it('renders the text, lists and tables of each section', () => {
    view(<LegalDocument doc={DOC} />)
    expect(screen.getByText('important').tagName).toBe('STRONG')
    expect(screen.getByRole('link', { name: 'link' })).toHaveAttribute('href', '/privacy')
    expect(screen.getAllByRole('listitem').some(li => li.textContent === 'One item')).toBe(true)
    expect(screen.getByRole('table', { name: 'Sample table' })).toBeInTheDocument()
  })

  it('offers related documents by their footer names', () => {
    view(<LegalDocument doc={DOC} />)
    const related = screen.getByRole('complementary', { name: 'Related documents' })
    expect(within(related).getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy')
    expect(within(related).getByRole('link', { name: 'Data Processing Addendum' })).toHaveAttribute('href', '/dpa')
  })

  it('prints the page on request', () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    view(<LegalDocument doc={DOC} />)
    fireEvent.click(screen.getByRole('button', { name: 'Print or save as PDF' }))
    expect(print).toHaveBeenCalledTimes(1)
  })

  it('sets the page title and description', () => {
    view(<LegalDocument doc={DOC} />)
    expect(document.title).toBe('Sample Terms | Hirely.ai')
    expect(document.head.querySelector('meta[name="description"]')?.getAttribute('content')).toBe(DOC.description)
  })
})

describe('LegalPage', () => {
  it('shows the document that belongs to the address', () => {
    view(<LegalPage slug="cookies" />)
    expect(screen.getByRole('heading', { level: 1, name: 'Cookie Policy' })).toBeInTheDocument()
  })

  it('shows the not found page for an unknown document', () => {
    view(<LegalPage slug="nothing-here" />)
    expect(screen.getByRole('heading', { level: 1, name: 'This page does not exist' })).toBeInTheDocument()
  })
})
