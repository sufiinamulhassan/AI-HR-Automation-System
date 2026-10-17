import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import CameraConsentScreen from './CameraConsentScreen'

describe('CameraConsentScreen', () => {
  it('states plainly that analysis is local, video is never uploaded, and the choice is real', () => {
    render(<CameraConsentScreen onEnable={vi.fn()} onDecline={vi.fn()} />)

    expect(screen.getByText(/locally, in your browser/i)).toBeInTheDocument()
    expect(screen.getByText(/never uploaded, recorded, or stored/i)).toBeInTheDocument()
    expect(screen.getByText(/proceeds normally either way/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /continue without monitoring/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /enable camera monitoring/i })).toBeInTheDocument()
  })

  it('calls onDecline, and only onDecline, when the candidate opts out', async () => {
    const user = userEvent.setup()
    const onEnable = vi.fn()
    const onDecline = vi.fn()
    render(<CameraConsentScreen onEnable={onEnable} onDecline={onDecline} />)

    await user.click(screen.getByRole('button', { name: /continue without monitoring/i }))

    expect(onDecline).toHaveBeenCalledTimes(1)
    expect(onEnable).not.toHaveBeenCalled()
  })

  it('calls onEnable, and only onEnable, when the candidate opts in', async () => {
    const user = userEvent.setup()
    const onEnable = vi.fn()
    const onDecline = vi.fn()
    render(<CameraConsentScreen onEnable={onEnable} onDecline={onDecline} />)

    await user.click(screen.getByRole('button', { name: /enable camera monitoring/i }))

    expect(onEnable).toHaveBeenCalledTimes(1)
    expect(onDecline).not.toHaveBeenCalled()
  })

  it('makes no network call of its own either way', async () => {
    vi.stubGlobal('fetch', vi.fn())
    const user = userEvent.setup()
    render(<CameraConsentScreen onEnable={vi.fn()} onDecline={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /continue without monitoring/i }))

    expect(fetch).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
