import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { Btn, CtaBand, FaqList, InfoCard, PageHero, StatsRow, Steps } from './kit'

function view(node: React.ReactNode) {
  return render(<MemoryRouter>{node}</MemoryRouter>)
}

describe('Btn', () => {
  it('renders a router link, a plain link or a button', () => {
    view(
      <>
        <Btn to="/pricing">Book</Btn>
        <Btn href="mailto:a@b.test">Mail</Btn>
        <Btn onClick={() => {}}>Click</Btn>
      </>,
    )
    expect(screen.getByRole('link', { name: 'Book' })).toHaveAttribute('href', '/pricing')
    expect(screen.getByRole('link', { name: 'Mail' })).not.toHaveAttribute('target')
    expect(screen.getByRole('button', { name: 'Click' })).toHaveAttribute('type', 'button')
  })

  it('opens secure outside addresses in a new tab without leaking the opener', () => {
    view(<Btn href="https://example.test/cal">Pick a time</Btn>)
    const link = screen.getByRole('link', { name: 'Pick a time' })
    expect(link).toHaveAttribute('target', '_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
    expect(link.getAttribute('rel')).toContain('noreferrer')
  })
})

describe('PageHero', () => {
  it('puts the accent on its own line inside the one h1', () => {
    view(<PageHero eyebrow="Features" title="Every step," accent="in one pipeline" lead="Lead text." />)
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1).toHaveTextContent('Every step, in one pipeline')
    expect(h1.querySelector('.xv-page-accent')).toHaveTextContent('in one pipeline')
    expect(screen.getByText('Lead text.')).toBeInTheDocument()
    expect(screen.getByText('Features')).toBeInTheDocument()
  })

  it('shows only the eyebrow, the title and the lead, with no buttons, links or breadcrumbs', () => {
    const { container } = view(<PageHero eyebrow="A" title="Title" lead="Lead." />)
    expect(container.querySelectorAll('a, button')).toHaveLength(0)
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(container.querySelector('.xv-page-actions')).toBeNull()
  })

  it('hides the decorative shapes from assistive technology', () => {
    const { container } = view(<PageHero eyebrow="A" title="Title" />)
    expect(container.querySelectorAll('img').length).toBeGreaterThan(0)
    container.querySelectorAll('img').forEach(img => {
      expect(img).toHaveAttribute('aria-hidden', 'true')
      expect(img).toHaveAttribute('alt', '')
    })
  })

  it('leaves the lead out when none is given', () => {
    const { container } = view(<PageHero eyebrow="A" title="Title" />)
    expect(container.querySelector('.xv-page-lead')).toBeNull()
  })
})

describe('InfoCard', () => {
  it('shows an icon, tag, text and a list', () => {
    const { container } = view(<InfoCard icon="shield" tag="Security" title="Safe" items={['One', 'Two **bold**']}>Body text.</InfoCard>)
    expect(container.querySelector('.xv-info-icon svg')).not.toBeNull()
    expect(screen.getByText('Security')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'Safe' })).toBeInTheDocument()
    expect(screen.getByText('bold', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('has no icon block when none is given', () => {
    const { container } = view(<InfoCard title="Plain" />)
    expect(container.querySelector('.xv-info-icon')).toBeNull()
  })
})

describe('StatsRow and Steps', () => {
  it('lists each fact with its label', () => {
    view(<StatsRow stats={[{ value: '7', label: 'Stages' }, { value: '500', label: 'Resumes' }]} />)
    expect(screen.getByText('7')).toBeInTheDocument()
    expect(screen.getByText('Resumes')).toBeInTheDocument()
  })

  it('numbers the steps in order', () => {
    view(<Steps steps={[{ title: 'First', description: 'Do **this**.' }, { title: 'Second', description: 'Then that.' }]} />)
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('01')
    expect(items[1]).toHaveTextContent('02')
    expect(screen.getByRole('heading', { level: 3, name: 'First' })).toBeInTheDocument()
    expect(screen.getByText('this', { selector: 'strong' })).toBeInTheDocument()
  })
})

describe('CtaBand', () => {
  it('shows the title, optional text and the buttons', () => {
    view(<CtaBand title="Ready?" text="Start now."><Btn to="/pricing">Book</Btn></CtaBand>)
    expect(screen.getByRole('heading', { level: 2, name: 'Ready?' })).toBeInTheDocument()
    expect(screen.getByText('Start now.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Book' })).toHaveAttribute('href', '/pricing')
  })

  it('leaves the text out when none is given', () => {
    const { container } = view(<CtaBand title="Ready?"><Btn to="/pricing">Book</Btn></CtaBand>)
    expect(container.querySelector('.xv-cta-text')).toBeNull()
  })
})

const FAQS = [
  { q: 'First question?', a: 'First answer with a [link](/pricing).' },
  { q: 'Second question?', a: 'Second answer.' },
  { q: 'Third question?', a: 'Third answer.' },
]

const toggle = (name: string) => screen.getByRole('button', { name })

describe('FaqList', () => {
  it('shows each question as a button and opens the first one', () => {
    view(<FaqList items={FAQS} />)
    expect(screen.getAllByRole('button')).toHaveLength(3)
    expect(toggle('First question?')).toHaveAttribute('aria-expanded', 'true')
    expect(toggle('Second question?')).toHaveAttribute('aria-expanded', 'false')
    expect(toggle('Third question?')).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens one answer at a time', () => {
    view(<FaqList items={FAQS} />)
    fireEvent.click(toggle('Second question?'))
    expect(toggle('Second question?')).toHaveAttribute('aria-expanded', 'true')
    expect(toggle('First question?')).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle('Third question?'))
    expect(toggle('Third question?')).toHaveAttribute('aria-expanded', 'true')
    expect(toggle('Second question?')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getAllByRole('button').filter(button => button.getAttribute('aria-expanded') === 'true')).toHaveLength(1)
  })

  it('closes the open answer when its question is pressed again', () => {
    view(<FaqList items={FAQS} />)
    fireEvent.click(toggle('First question?'))
    expect(screen.getAllByRole('button').every(button => button.getAttribute('aria-expanded') === 'false')).toBe(true)
  })

  it('can start with every answer closed', () => {
    view(<FaqList items={FAQS} defaultOpen={-1} />)
    expect(screen.getAllByRole('button').every(button => button.getAttribute('aria-expanded') === 'false')).toBe(true)
  })

  it('links each button to a labelled answer panel and makes closed panels inert', () => {
    const { container } = view(<FaqList items={FAQS} />)
    FAQS.forEach(item => {
      const button = toggle(item.q)
      const panel = document.getElementById(button.getAttribute('aria-controls') as string) as HTMLElement
      expect(panel).not.toBeNull()
      expect(panel).toHaveAttribute('role', 'region')
      expect(panel).toHaveAttribute('aria-labelledby', button.id)
      const open = button.getAttribute('aria-expanded') === 'true'
      expect(panel.hasAttribute('inert')).toBe(!open)
    })
    expect(container.querySelectorAll('h3')).toHaveLength(3)
  })

  it('shows the answer with its inline markup as a real link', () => {
    view(<FaqList items={FAQS} />)
    const panel = document.getElementById(toggle('First question?').getAttribute('aria-controls') as string) as HTMLElement
    expect(within(panel).getByRole('link', { name: 'link' })).toHaveAttribute('href', '/pricing')
  })

  it('keeps separate lists independent of each other', () => {
    view(<><FaqList items={FAQS} /><FaqList items={[{ q: 'Other question?', a: 'Other answer.' }]} /></>)
    fireEvent.click(toggle('Second question?'))
    expect(toggle('Other question?')).toHaveAttribute('aria-expanded', 'true')
    expect(toggle('Second question?')).toHaveAttribute('aria-expanded', 'true')
  })
})
