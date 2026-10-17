import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./components/BrandingProvider', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

const { interviewerScorecardApi } = await import('./lib/api')
const { useAuthStore } = await import('./store/auth.store')
const { default: App } = await import('./App')

beforeEach(() => {
  vi.restoreAllMocks()
  useAuthStore.setState({ token: null, user: null })
})

describe('/interviewer/:token', () => {
  it('opens for a visitor who is not signed in, asks for that token, and stays on the page', async () => {
    const get = vi.spyOn(interviewerScorecardApi, 'get').mockReturnValue(new Promise(() => {}) as never)
    window.history.pushState({}, '', '/interviewer/tok_xyz')
    render(<App />)

    expect(await screen.findByText('Loading scorecard…')).toBeInTheDocument()
    expect(get).toHaveBeenCalledWith('tok_xyz')
    expect(window.location.pathname).toBe('/interviewer/tok_xyz')
  })

  it('also opens for someone who is signed in, and does not drop them into the dashboard', async () => {
    useAuthStore.setState({ token: 'tok', user: { role: 'admin', email: 'a@x.com' } })
    vi.spyOn(interviewerScorecardApi, 'get').mockReturnValue(new Promise(() => {}) as never)
    window.history.pushState({}, '', '/interviewer/tok_abc')
    render(<App />)

    expect(await screen.findByText('Loading scorecard…')).toBeInTheDocument()
    expect(window.location.pathname).toBe('/interviewer/tok_abc')
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })
})
