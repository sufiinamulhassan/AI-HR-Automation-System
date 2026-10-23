import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/api', () => ({
  performanceApi: { cycles: { list: vi.fn(), listActive: vi.fn() }, myReports: vi.fn() },
  attentionApi: { get: () => Promise.resolve({ data: { generated_at: 'x', items: [] } }), detail: vi.fn() },
  authApi: {
    myPermissions: () => Promise.resolve({ data: { role: 'standard', permissions: [] } }),
    getAvatar: () => Promise.resolve({ data: { configured: false } }),
    me: () => Promise.resolve({ data: {} }),
    listModels: () => Promise.resolve({ data: { models: [], current: '' } }),
  },
}))

const { default: DashboardLayout } = await import('./DashboardLayout')
const { useAuthStore } = await import('../../store/auth.store')

beforeEach(() => {
  useAuthStore.setState({ avatarDataUrl: undefined })
})

describe('DashboardLayout, HRMS nav entry', () => {
  it.each(['standard', 'admin', 'superadmin'])('shows HRMS directly under Résumés for %s', async role => {
    useAuthStore.setState({ token: 'tok', user: { role, email: `${role}@x.com`, name: role } })
    render(
      <MemoryRouter initialEntries={['/dashboard/hrms']}>
        <Routes>
          <Route path="/dashboard" element={<DashboardLayout />}>
            <Route path="hrms" element={<div>HRMS content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    const hrms = await screen.findByRole('link', { name: 'HRMS' })
    expect(hrms).toHaveAttribute('href', '/dashboard/hrms')
    expect(screen.getByRole('link', { name: 'Résumés' }).nextElementSibling).toBe(hrms)
    expect(hrms).toHaveClass('active')
  })
})
