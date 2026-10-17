import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { announceSimulated } from '../lib/demoNotice'
import DemoNotice from './DemoNotice'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function announce(message: string) {
  act(() => announceSimulated(message))
}

describe('DemoNotice', () => {
  it('keeps a polite live region on the page and shows nothing until there is something to say', () => {
    render(<DemoNotice />)
    const region = screen.getByRole('status')
    expect(region).toHaveAttribute('aria-live', 'polite')
    expect(region).toBeEmptyDOMElement()
  })

  it('shows the message the server sent', () => {
    render(<DemoNotice />)
    announce('Demo mode: this action was simulated and nothing was changed.')
    expect(screen.getByRole('status')).toHaveTextContent('Demo mode: this action was simulated and nothing was changed.')
  })

  it('goes away by itself after a few seconds', () => {
    render(<DemoNotice />)
    announce('Nothing was changed')
    act(() => { vi.advanceTimersByTime(4900) })
    expect(screen.getByText('Nothing was changed')).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(200) })
    expect(screen.queryByText('Nothing was changed')).not.toBeInTheDocument()
  })

  it('starts the wait again when another change is refused', () => {
    render(<DemoNotice />)
    announce('First')
    act(() => { vi.advanceTimersByTime(4000) })
    announce('Second')
    act(() => { vi.advanceTimersByTime(4000) })
    expect(screen.getByText('Second')).toBeInTheDocument()
    expect(screen.queryByText('First')).not.toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(1100) })
    expect(screen.queryByText('Second')).not.toBeInTheDocument()
  })

  it('can be dismissed with its button', () => {
    render(<DemoNotice />)
    announce('Nothing was changed')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText('Nothing was changed')).not.toBeInTheDocument()
  })

  it('ignores an event with no message', () => {
    render(<DemoNotice />)
    act(() => { window.dispatchEvent(new CustomEvent('hirely:demo-notice', { detail: '' })) })
    act(() => { window.dispatchEvent(new CustomEvent('hirely:demo-notice')) })
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('stops listening when it leaves the page', () => {
    const { unmount } = render(<DemoNotice />)
    unmount()
    expect(() => announce('Late')).not.toThrow()
    expect(screen.queryByText('Late')).not.toBeInTheDocument()
  })
})
