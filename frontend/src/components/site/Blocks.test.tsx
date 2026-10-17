import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { Blocks, DataTable, Inline } from './Blocks'
import { h3, note, ol, p, table, ul } from './blockModel'

function view(node: React.ReactNode) {
  return render(<MemoryRouter>{node}</MemoryRouter>)
}

describe('Inline', () => {
  it('renders bold, code, internal and external links', () => {
    view(<Inline text="A **bold** `code` [policy](/privacy) [site](https://example.com) [mail](mailto:a@b.co)" />)
    expect(screen.getByText('bold').tagName).toBe('STRONG')
    expect(screen.getByText('code').tagName).toBe('CODE')
    expect(screen.getByRole('link', { name: 'policy' })).toHaveAttribute('href', '/privacy')
    const site = screen.getByRole('link', { name: 'site' })
    expect(site).toHaveAttribute('href', 'https://example.com')
    expect(site).toHaveAttribute('target', '_blank')
    expect(site).toHaveAttribute('rel', 'noopener noreferrer')
    const mail = screen.getByRole('link', { name: 'mail' })
    expect(mail).toHaveAttribute('href', 'mailto:a@b.co')
    expect(mail).not.toHaveAttribute('target')
  })

  it('shows an unsafe link as plain text', () => {
    view(<Inline text="[danger](javascript:alert)" />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText(/danger/)).toBeInTheDocument()
  })
})

describe('Blocks', () => {
  it('renders every block type', () => {
    const { container } = view(
      <Blocks blocks={[
        p('Paragraph **emphasised**.'),
        h3('Sub heading'),
        ul(['first', 'second']),
        ol(['one', 'two']),
        note('Heads up'),
        table(['Name', 'Value'], [['Alpha', '1'], ['Beta', '2']], 'Numbers'),
      ]}
      />,
    )
    expect(screen.getByText('emphasised').tagName).toBe('STRONG')
    expect(screen.getByRole('heading', { level: 3, name: 'Sub heading' })).toBeInTheDocument()
    expect(container.querySelectorAll('ul > li')).toHaveLength(2)
    expect(container.querySelectorAll('ol > li')).toHaveLength(2)
    expect(container.querySelector('aside.xv-note')).toHaveTextContent('Heads up')
    expect(screen.getByRole('table', { name: 'Numbers' })).toBeInTheDocument()
  })
})

describe('DataTable', () => {
  it('uses column headers and row headers so it reads well with a screen reader', () => {
    view(<DataTable caption="Plans" head={['Feature', 'Starter']} rows={[['Coding', 'Not included']]} />)
    const grid = screen.getByRole('table', { name: 'Plans' })
    expect(within(grid).getAllByRole('columnheader').map(c => c.textContent)).toEqual(['Feature', 'Starter'])
    expect(within(grid).getByRole('rowheader', { name: 'Coding' })).toBeInTheDocument()
    expect(within(grid).getByRole('cell', { name: 'Not included' })).toBeInTheDocument()
  })

  it('can be scrolled with the keyboard when it is wider than the screen', () => {
    view(<DataTable head={['A']} rows={[['b']]} />)
    expect(screen.getByRole('region', { name: 'Table' })).toHaveAttribute('tabindex', '0')
  })
})
