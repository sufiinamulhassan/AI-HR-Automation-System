import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import RoiCalculatorPage from './RoiCalculatorPage'
import {
  expectHeadingOrder, expectMeta, expectNoEmDash, expectValidInternalLinks, renderPage,
} from './siteTestKit'

function setField(label: RegExp | string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

describe('RoiCalculatorPage', () => {
  it('has a single h1 and ordered headings', () => {
    const { container } = renderPage(<RoiCalculatorPage />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Estimate the hours a ranked pipeline could return')
    expectHeadingOrder(container)
  })

  it('starts with example numbers and shows the estimate for them', () => {
    renderPage(<RoiCalculatorPage />)
    expect(screen.getByLabelText('Open roles per month')).toHaveValue('5')
    expect(screen.getByLabelText('Applications per role')).toHaveValue('100')
    const result = screen.getByRole('complementary', { name: 'Estimated result' })
    expect(within(result).getByText('25')).toBeInTheDocument()
    expect(within(result).getByText('hours back each month')).toBeInTheDocument()
    expect(within(result).getByText('300')).toBeInTheDocument()
    expect(within(result).queryByText('Value each month')).not.toBeInTheDocument()
  })

  it('updates as the numbers change', () => {
    renderPage(<RoiCalculatorPage />)
    setField('Open roles per month', '10')
    const result = screen.getByRole('complementary', { name: 'Estimated result' })
    expect(within(result).getByText('50')).toBeInTheDocument()
    expect(within(result).getByText('600')).toBeInTheDocument()
  })

  it('shows a value only when an hourly cost is entered', () => {
    renderPage(<RoiCalculatorPage />)
    setField(/Hourly cost of the reviewer/, '40')
    const result = screen.getByRole('complementary', { name: 'Estimated result' })
    expect(within(result).getByText('Value each month')).toBeInTheDocument()
    expect(within(result).getByText('1,000')).toBeInTheDocument()
    expect(within(result).getByText('12,000')).toBeInTheDocument()
  })

  it('says so when ranking would not save any time', () => {
    renderPage(<RoiCalculatorPage />)
    setField('Minutes per resume with ranking', '9')
    expect(screen.getByText(/takes as long as today, so no time is returned/)).toBeInTheDocument()
    const result = screen.getByRole('complementary', { name: 'Estimated result' })
    expect(within(result).getByText('hours back each month').previousElementSibling).toHaveTextContent('0')
  })

  it('treats nonsense input as zero instead of breaking', () => {
    renderPage(<RoiCalculatorPage />)
    setField('Applications per role', 'many')
    const result = screen.getByRole('complementary', { name: 'Estimated result' })
    expect(within(result).getAllByText('0').length).toBeGreaterThan(0)
    expect(result.textContent).not.toMatch(/NaN|Infinity/)
  })

  it('describes every input and says what it leaves out', () => {
    const { container } = renderPage(<RoiCalculatorPage />)
    container.querySelectorAll('input').forEach(input => {
      const help = input.getAttribute('aria-describedby')
      expect(help).toBeTruthy()
      expect(document.getElementById(help as string)).not.toBeNull()
    })
    expect(screen.getByRole('heading', { level: 2, name: 'What this does not include' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'pricing page' })).toHaveAttribute('href', '/pricing')
  })

  it('links only to routes that exist, sets metadata and has no em dash', () => {
    const { container } = renderPage(<RoiCalculatorPage />)
    expectValidInternalLinks(container)
    expectMeta('ROI calculator')
    expectNoEmDash(container)
  })
})
