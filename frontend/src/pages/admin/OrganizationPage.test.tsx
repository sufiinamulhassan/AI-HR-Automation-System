import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'


const companyGet = vi.fn()
const companyIntegrations = vi.fn()
const brandingGet = vi.fn()
const notifGet = vi.fn()
const listDepartments = vi.fn()
const listDesignations = vi.fn()
const deleteDepartment = vi.fn()
const updateDepartment = vi.fn()

vi.mock('../../lib/api', () => ({
  companySettingsApi: {
    get: (...a: unknown[]) => companyGet(...a),
    update: vi.fn(),
    integrationsStatus: (...a: unknown[]) => companyIntegrations(...a),
  },
  brandingApi: { get: (...a: unknown[]) => brandingGet(...a), update: vi.fn() },
  notificationSettingsApi: { get: (...a: unknown[]) => notifGet(...a), update: vi.fn() },
  adminConfigApi: {
    listDepartments: (...a: unknown[]) => listDepartments(...a),
    listDesignations: (...a: unknown[]) => listDesignations(...a),
    createDepartment: vi.fn(),
    updateDepartment: (...a: unknown[]) => updateDepartment(...a),
    deleteDepartment: (...a: unknown[]) => deleteDepartment(...a),
    createDesignation: vi.fn(),
    updateDesignation: vi.fn(),
    deleteDesignation: vi.fn(),
  },
}))

const { default: OrganizationPage } = await import('./OrganizationPage')

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <OrganizationPage />
    </MemoryRouter>
  )
}

function httpError(status: number, detail: string) {
  return { response: { status, data: { detail } } }
}

const DEPARTMENT = {
  department_id: 'dept-1',
  name: 'Engineering',
  description: 'Builds things',
  usage: { designations: 2, jobs: 1, users: 0, total: 3 },
}

describe('OrganizationPage', () => {
  beforeEach(() => {
    companyGet.mockReset().mockResolvedValue({ data: { company_name: 'Acme Corporation' } })
    companyIntegrations.mockReset().mockResolvedValue({
      data: {
        core: [{ id: 'openai', label: 'OpenAI', configured: true }],
        job_sources: [{ id: 'remotive', label: 'Remotive', requires_key: false, configured: true }],
      },
    })
    brandingGet.mockReset().mockResolvedValue({
      data: { company_logo_url: '', primary_color: '#4778f3', accent_color: '#222022' },
    })
    notifGet.mockReset().mockResolvedValue({
      data: {
        notify_email: 'alerts@example.com',
        events: [{ event: 'offer_declined', label: 'Offer declined', description: 'x', enabled: true }],
      },
    })
    listDepartments.mockReset().mockResolvedValue({ data: { departments: [DEPARTMENT] } })
    listDesignations.mockReset().mockResolvedValue({
      data: { designations: [{ designation_id: 'des-1', name: 'Senior Engineer', department: 'Engineering' }] },
    })
    deleteDepartment.mockReset()
    updateDepartment.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('defaults to the Company Profile tab', async () => {
    renderAt('/dashboard/organization')

    expect(await screen.findByDisplayValue('Acme Corporation')).toBeInTheDocument()
    expect(screen.getByText('Integrations Status')).toBeInTheDocument()
    expect(listDepartments).not.toHaveBeenCalled()
    expect(brandingGet).not.toHaveBeenCalled()
  })

  it.each([
    ['branding', 'Branding / White-Labeling'],
    ['departments', 'Designations'],
  ])('?tab=%s selects that tab - the old routes redirect here', async (tab, expected) => {
    renderAt(`/dashboard/organization?tab=${tab}`)
    expect(await screen.findByText(expected)).toBeInTheDocument()
  })

  it('shows what each department is referenced by', async () => {
    renderAt('/dashboard/organization?tab=departments')

    expect(await screen.findByText('2 designations')).toBeInTheDocument()
    expect(screen.getByText('1 job')).toBeInTheDocument()
  })

  it('offers a forced delete when the backend refuses a referenced department', async () => {
    const user = userEvent.setup()
    deleteDepartment
      .mockRejectedValueOnce(httpError(409, 'Department "Engineering" is still referenced by 2 designations, 1 jobs.'))
      .mockResolvedValueOnce({ data: { message: 'Deleted', designations_detached: 2 } })
    const confirm = vi.fn().mockReturnValue(true)
    vi.stubGlobal('confirm', confirm)

    renderAt('/dashboard/organization?tab=departments')
    await user.click((await screen.findAllByText('Delete'))[0])

    await waitFor(() => expect(deleteDepartment).toHaveBeenCalledTimes(2))
    expect(deleteDepartment.mock.calls[0]).toEqual(['dept-1'])
    expect(deleteDepartment.mock.calls[1]).toEqual(['dept-1', true])
    expect(confirm.mock.calls[1][0]).toContain('still referenced by 2 designations')
    expect(await screen.findByText(/2 designations detached/)).toBeInTheDocument()
  })

  it('does not force a delete the admin declined', async () => {
    const user = userEvent.setup()
    deleteDepartment.mockRejectedValueOnce(httpError(409, 'still referenced'))
    vi.stubGlobal('confirm', vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false))

    renderAt('/dashboard/organization?tab=departments')
    await user.click((await screen.findAllByText('Delete'))[0])

    await waitFor(() => expect(deleteDepartment).toHaveBeenCalledTimes(1))
    expect(deleteDepartment.mock.calls[0]).toEqual(['dept-1'])
  })

  it('reports a non-409 delete failure without offering to force it', async () => {
    const user = userEvent.setup()
    deleteDepartment.mockRejectedValueOnce(httpError(503, 'Database unavailable'))
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))

    renderAt('/dashboard/organization?tab=departments')
    await user.click((await screen.findAllByText('Delete'))[0])

    expect(await screen.findByText('Database unavailable')).toBeInTheDocument()
    expect(deleteDepartment).toHaveBeenCalledTimes(1)
  })

  it('reports the designations a rename re-pointed', async () => {
    const user = userEvent.setup()
    updateDepartment.mockResolvedValue({ data: { message: 'Updated', designations_renamed: 2 } })

    renderAt('/dashboard/organization?tab=departments')
    await user.click((await screen.findAllByText('Edit'))[0])
    await user.click(screen.getByText('Save Changes'))

    expect(await screen.findByText(/2 designations re-pointed/)).toBeInTheDocument()
  })
})
