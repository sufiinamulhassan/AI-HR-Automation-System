import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const companyGet = vi.fn()
const companyIntegrations = vi.fn()
const companyUsage = vi.fn()
const brandingGet = vi.fn()
const notifGet = vi.fn()
const listDepartments = vi.fn()
const listDesignations = vi.fn()
const deleteDepartment = vi.fn()
const updateDepartment = vi.fn()
const listJobGrades = vi.fn()
const createJobGrade = vi.fn()
const updateJobGrade = vi.fn()
const deleteJobGrade = vi.fn()
const getLetterheadTemplate = vi.fn()
const uploadLetterheadTemplate = vi.fn()
const companyUpdate = vi.fn()
const brandingUpdate = vi.fn()
const uploadLogo = vi.fn()
const removeLogo = vi.fn()
const notifUpdate = vi.fn()
const notifTest = vi.fn()
const getMail = vi.fn()
const getSso = vi.fn()
const listIntegrations = vi.fn()
const getRetention = vi.fn()

vi.mock('../../lib/api', () => ({
  companySettingsApi: {
    get: (...a: unknown[]) => companyGet(...a),
    update: (...a: unknown[]) => companyUpdate(...a),
    integrationsStatus: (...a: unknown[]) => companyIntegrations(...a),
    usage: (...a: unknown[]) => companyUsage(...a),
    getMail: (...a: unknown[]) => getMail(...a),
    getSso: (...a: unknown[]) => getSso(...a),
    listIntegrations: (...a: unknown[]) => listIntegrations(...a),
    getRetention: (...a: unknown[]) => getRetention(...a),
  },
  candidatesApi: { eraseByEmail: vi.fn() },
  brandingApi: {
    get: (...a: unknown[]) => brandingGet(...a),
    update: (...a: unknown[]) => brandingUpdate(...a),
    uploadLogo: (...a: unknown[]) => uploadLogo(...a),
    removeLogo: (...a: unknown[]) => removeLogo(...a),
  },
  notificationSettingsApi: {
    get: (...a: unknown[]) => notifGet(...a),
    update: (...a: unknown[]) => notifUpdate(...a),
    test: (...a: unknown[]) => notifTest(...a),
  },
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
  jobGradesApi: {
    list: (...a: unknown[]) => listJobGrades(...a),
    create: (...a: unknown[]) => createJobGrade(...a),
    update: (...a: unknown[]) => updateJobGrade(...a),
    delete: (...a: unknown[]) => deleteJobGrade(...a),
  },
  offersApi: {
    getLetterheadTemplate: (...a: unknown[]) => getLetterheadTemplate(...a),
    uploadLetterheadTemplate: (...a: unknown[]) => uploadLetterheadTemplate(...a),
  },
}))

const { default: OrganizationPage } = await import('./OrganizationPage')
const { useAuthStore } = await import('../../store/auth.store')

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

const GRADE = { job_grade_id: 'grade-1', name: 'AVP', description: 'Assistant Vice President' }

const USAGE = {
  plan: { name: 'growth', max_users_per_company: 25, monthly_ai_budget_usd: 50 },
  users: { used: 12, limit: 25 },
  ai: { month: '2026-10', used_usd: 12.5, budget_usd: 50, percent: 25 },
  emails_30d: 340,
}

describe('OrganizationPage', () => {
  beforeEach(() => {
    companyGet.mockReset().mockResolvedValue({ data: { company_name: 'Acme Corporation' } })
    companyUsage.mockReset().mockResolvedValue({ data: USAGE })
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
    listJobGrades.mockReset().mockResolvedValue({ data: { job_grades: [GRADE] } })
    createJobGrade.mockReset().mockResolvedValue({ data: {} })
    updateJobGrade.mockReset().mockResolvedValue({ data: {} })
    deleteJobGrade.mockReset().mockResolvedValue({ data: {} })
    getLetterheadTemplate.mockReset().mockResolvedValue({
      data: { filename: null, header_text: '', footer_text: '', has_logo: false, body_paragraph_count: 0 },
    })
    uploadLetterheadTemplate.mockReset()
    companyUpdate.mockReset().mockResolvedValue({ data: { company_name: 'Acme Corporation' } })
    brandingUpdate.mockReset().mockResolvedValue({ data: {} })
    uploadLogo.mockReset()
    removeLogo.mockReset()
    notifUpdate.mockReset().mockResolvedValue({ data: { notify_email: 'alerts@example.com', events: [] } })
    notifTest.mockReset().mockResolvedValue({ data: { sent: true, to: 'alerts@example.com', detail: 'Delivered by SMTP' } })
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
  ])('?tab=%s selects that tab, the old routes redirect here', async (tab, expected) => {
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

  describe('job grades', () => {
    it('lists job grades alongside departments and designations', async () => {
      renderAt('/dashboard/organization?tab=departments')

      expect(await screen.findByText('Job Grades')).toBeInTheDocument()
      expect(await screen.findByText('AVP')).toBeInTheDocument()
      expect(screen.getByText('Assistant Vice President')).toBeInTheDocument()
    })

    it('does not break the departments/designations lists when the grades endpoint is unavailable', async () => {
      listJobGrades.mockReset().mockRejectedValue({ response: { status: 404 } })

      renderAt('/dashboard/organization?tab=departments')

      expect(await screen.findByText('2 designations')).toBeInTheDocument()
      expect(screen.getByText('Senior Engineer')).toBeInTheDocument()
      expect(await screen.findByText('No job grades yet.')).toBeInTheDocument()
    })

    it('creates a job grade', async () => {
      const user = userEvent.setup()
      renderAt('/dashboard/organization?tab=departments')

      await user.click(await screen.findByText('+ Add Job Grade'))
      await user.type(screen.getByPlaceholderText(/grade 5, avp, vp/i), 'Grade 7')
      await user.click(screen.getByText('Create'))

      await waitFor(() => expect(createJobGrade).toHaveBeenCalledWith({ name: 'Grade 7', description: undefined }))
      expect(await screen.findByText('Job grade created')).toBeInTheDocument()
    })

    it('deletes a job grade', async () => {
      const user = userEvent.setup()
      vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))

      renderAt('/dashboard/organization?tab=departments')

      const deleteButtons = await screen.findAllByText('Delete')
      expect(deleteButtons).toHaveLength(3)
      await user.click(deleteButtons[2])

      await waitFor(() => expect(deleteJobGrade).toHaveBeenCalledWith('grade-1'))
      expect(await screen.findByText('Job grade deleted')).toBeInTheDocument()
    })
  })

  describe('offer letterhead template', () => {
    function fileInput() {
      return document.querySelector('input[type="file"][accept=".docx"]') as HTMLInputElement
    }

    it('shows "no template uploaded" until one exists', async () => {
      renderAt('/dashboard/organization?tab=branding')

      expect(await screen.findByText(/No template uploaded yet/)).toBeInTheDocument()
      expect(screen.queryByText('Active')).not.toBeInTheDocument()
    })

    it('uploads a letterhead docx template and shows the parsed-back summary', async () => {
      const user = userEvent.setup({ applyAccept: false })
      uploadLetterheadTemplate.mockResolvedValue({
        data: {
          filename: 'offer-template.docx', header_text: 'Acme Corp HQ',
          footer_text: 'Confidential', has_logo: true, body_paragraph_count: 3,
        },
      })

      renderAt('/dashboard/organization?tab=branding')
      await screen.findByText(/No template uploaded yet/)

      const file = new File(['docx-bytes'], 'offer-template.docx', {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      })
      await user.upload(fileInput(), file)

      await waitFor(() => expect(uploadLetterheadTemplate).toHaveBeenCalledWith(file))
      expect(await screen.findByText('offer-template.docx')).toBeInTheDocument()
      expect(screen.getByText('Logo found')).toBeInTheDocument()
      expect(screen.getByText('3 paragraphs')).toBeInTheDocument()
      expect(screen.getByText('Acme Corp HQ')).toBeInTheDocument()
      expect(screen.getByText('Confidential')).toBeInTheDocument()
      expect(await screen.findByText('Letterhead template uploaded')).toBeInTheDocument()
      expect(screen.getByText('Active')).toBeInTheDocument()
    })

    it('rejects a non-.docx file client-side without calling the upload endpoint', async () => {
      const user = userEvent.setup({ applyAccept: false })
      renderAt('/dashboard/organization?tab=branding')
      await screen.findByText(/No template uploaded yet/)

      const file = new File(['pdf-bytes'], 'template.pdf', { type: 'application/pdf' })
      await user.upload(fileInput(), file)

      expect(await screen.findByText(/Only \.docx files are supported/)).toBeInTheDocument()
      expect(uploadLetterheadTemplate).not.toHaveBeenCalled()
    })

    it('surfaces a failed upload with the backend detail message', async () => {
      const user = userEvent.setup({ applyAccept: false })
      uploadLetterheadTemplate.mockRejectedValue(httpError(400, 'Could not read DOCX file: bad zip'))

      renderAt('/dashboard/organization?tab=branding')
      await screen.findByText(/No template uploaded yet/)

      const file = new File(['not really a docx'], 'template.docx', {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      })
      await user.upload(fileInput(), file)

      expect(await screen.findByText('Could not read DOCX file: bad zip')).toBeInTheDocument()
      expect(screen.queryByText('Active')).not.toBeInTheDocument()
    })

    it('shows a permission notice instead of the upload control when blocked', async () => {
      getLetterheadTemplate.mockReset().mockRejectedValue(httpError(403, 'Forbidden'))

      renderAt('/dashboard/organization?tab=branding')

      expect(await screen.findByText(/requires the "offers:manage_letterhead" permission/)).toBeInTheDocument()
      expect(screen.queryByText('Upload .docx Template')).not.toBeInTheDocument()
    })
  })

  describe('when a settings read fails', () => {
    it('company: shows the error with Retry, no fields, and Save disabled', async () => {
      companyGet.mockReset().mockRejectedValue(httpError(500, 'Settings store unavailable'))
      renderAt('/dashboard/organization')

      expect(await screen.findByText('Settings store unavailable')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled()
      expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled()
      expect(screen.queryByPlaceholderText('Acme Corporation')).not.toBeInTheDocument()
      expect(companyUpdate).not.toHaveBeenCalled()
    })

    it('company: falls back to a plain message, then loads the stored values after Retry', async () => {
      const user = userEvent.setup()
      companyGet.mockReset()
        .mockRejectedValueOnce(new Error('Network Error'))
        .mockResolvedValue({ data: { company_name: 'Acme Corporation' } })
      renderAt('/dashboard/organization')

      expect(await screen.findByText('Could not load the company settings.')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Retry' }))

      expect(await screen.findByDisplayValue('Acme Corporation')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Save Changes' })).toBeEnabled()
      expect(screen.queryByText('Could not load the company settings.')).not.toBeInTheDocument()
    })

    it('branding: shows the error with Retry, no colour fields, and Save and Reset disabled', async () => {
      brandingGet.mockReset().mockRejectedValue(httpError(503, 'Branding unavailable'))
      renderAt('/dashboard/organization?tab=branding')

      expect(await screen.findByText('Branding unavailable')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Save Branding' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Reset to Defaults' })).toBeDisabled()
      expect(screen.queryByPlaceholderText('#4778f3')).not.toBeInTheDocument()
      expect(brandingUpdate).not.toHaveBeenCalled()
      expect(await screen.findByDisplayValue('alerts@example.com')).toBeInTheDocument()
    })

    it('branding: recovers on Retry', async () => {
      const user = userEvent.setup()
      brandingGet.mockReset()
        .mockRejectedValueOnce(httpError(503, 'Branding unavailable'))
        .mockResolvedValue({ data: { company_logo_url: '', primary_color: '#112233', accent_color: '#222022' } })
      renderAt('/dashboard/organization?tab=branding')

      await user.click(await screen.findByRole('button', { name: 'Retry' }))

      expect(await screen.findByPlaceholderText('#4778f3')).toHaveValue('#112233')
      expect(screen.getByRole('button', { name: 'Save Branding' })).toBeEnabled()
    })

    it('notifications: shows the error with Retry, no address field, and Save and Send test disabled', async () => {
      notifGet.mockReset().mockRejectedValue(httpError(500, 'Notification settings unavailable'))
      renderAt('/dashboard/organization?tab=branding')

      expect(await screen.findByText('Notification settings unavailable')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Save Notification Settings' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Send test notification' })).toBeDisabled()
      expect(screen.queryByPlaceholderText('alerts@example.com')).not.toBeInTheDocument()
      expect(notifUpdate).not.toHaveBeenCalled()
      expect(await screen.findByPlaceholderText('#4778f3')).toHaveValue('#4778f3')
    })

    it('notifications: recovers on Retry', async () => {
      const user = userEvent.setup()
      notifGet.mockReset()
        .mockRejectedValueOnce(httpError(500, 'Notification settings unavailable'))
        .mockResolvedValue({ data: { notify_email: 'ops@example.com', events: [] } })
      renderAt('/dashboard/organization?tab=branding')

      await user.click(await screen.findByRole('button', { name: 'Retry' }))

      expect(await screen.findByDisplayValue('ops@example.com')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Save Notification Settings' })).toBeEnabled()
    })
  })

  describe('company logo', () => {
    const png = (name = 'logo.png', type = 'image/png', size = 2048) => {
      const file = new File(['x'.repeat(8)], name, { type })
      Object.defineProperty(file, 'size', { value: size })
      return file
    }
    const fileInput = () => screen.getByLabelText('Logo file') as HTMLInputElement
    const UPLOADED = '/api/v1/branding/logo/cmp_a?v=abc123def456'

    it('uploads a file, shows it in the preview and leaves the other fields as they were typed', async () => {
      const user = userEvent.setup()
      uploadLogo.mockResolvedValue({ data: { company_logo_url: UPLOADED } })
      renderAt('/dashboard/organization?tab=branding')
      await screen.findByRole('button', { name: 'Upload logo' })
      await user.clear(screen.getByPlaceholderText('#4778f3'))
      await user.type(screen.getByPlaceholderText('#4778f3'), '#112233')

      await user.upload(fileInput(), png())

      await waitFor(() => expect(uploadLogo).toHaveBeenCalledTimes(1))
      expect(uploadLogo.mock.calls[0][0].name).toBe('logo.png')
      const preview = await screen.findByAltText('Logo preview')
      expect(preview.getAttribute('src')).toMatch(/\/api\/v1\/branding\/logo\/cmp_a\?v=abc123def456$/)
      expect(screen.getByPlaceholderText('#4778f3')).toHaveValue('#112233')
      expect(screen.getByRole('button', { name: 'Remove logo' })).toBeInTheDocument()
    })

    it('accepts a JPEG chosen by its extension alone', async () => {
      const user = userEvent.setup({ applyAccept: false })
      uploadLogo.mockResolvedValue({ data: { company_logo_url: UPLOADED } })
      renderAt('/dashboard/organization?tab=branding')
      await screen.findByRole('button', { name: 'Upload logo' })
      await user.upload(fileInput(), png('brand.JPG', ''))
      await waitFor(() => expect(uploadLogo).toHaveBeenCalledTimes(1))
    })

    it.each([
      ['an SVG', png('logo.svg', 'image/svg+xml'), 'The logo must be a PNG or JPEG image'],
      ['a PDF', png('logo.pdf', 'application/pdf'), 'The logo must be a PNG or JPEG image'],
      ['a file over 1 MB', png('big.png', 'image/png', 1_000_001), 'The logo is larger than 1 MB. Use a smaller image'],
    ])('refuses %s before sending anything', async (_label, file, message) => {
      const user = userEvent.setup({ applyAccept: false })
      renderAt('/dashboard/organization?tab=branding')
      await screen.findByRole('button', { name: 'Upload logo' })
      await user.upload(fileInput(), file)
      expect(await screen.findByText(message)).toBeInTheDocument()
      expect(uploadLogo).not.toHaveBeenCalled()
    })

    it("shows the server's reason when the upload is refused, and keeps the logo it had", async () => {
      const user = userEvent.setup()
      brandingGet.mockResolvedValue({ data: { company_logo_url: UPLOADED, primary_color: '#4778f3', accent_color: '#222022' } })
      uploadLogo.mockRejectedValue({ response: { status: 413, data: { detail: 'The logo is larger than 1 MB. Use a smaller image.' } } })
      renderAt('/dashboard/organization?tab=branding')
      await screen.findByRole('button', { name: 'Remove logo' })
      await user.upload(fileInput(), png())
      expect(await screen.findByText('The logo is larger than 1 MB. Use a smaller image.')).toBeInTheDocument()
      expect(screen.getByAltText('Logo preview').getAttribute('src')).toMatch(/abc123def456$/)
    })

    it('shows an uploaded logo as the logo, with the link field empty and saying so', async () => {
      brandingGet.mockResolvedValue({ data: { company_logo_url: UPLOADED, primary_color: '#4778f3', accent_color: '#222022' } })
      renderAt('/dashboard/organization?tab=branding')
      const link = await screen.findByPlaceholderText('Using the uploaded logo')
      expect(link).toHaveValue('')
      expect(screen.getByAltText('Logo preview')).toBeInTheDocument()
    })

    it('removes the logo', async () => {
      const user = userEvent.setup()
      brandingGet.mockResolvedValue({ data: { company_logo_url: UPLOADED, primary_color: '#4778f3', accent_color: '#222022' } })
      removeLogo.mockResolvedValue({ data: { company_logo_url: '' } })
      renderAt('/dashboard/organization?tab=branding')
      await user.click(await screen.findByRole('button', { name: 'Remove logo' }))
      await waitFor(() => expect(removeLogo).toHaveBeenCalledTimes(1))
      expect(await screen.findByText('Logo removed')).toBeInTheDocument()
      expect(screen.queryByAltText('Logo preview')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Remove logo' })).not.toBeInTheDocument()
    })

    it('offers Remove logo only when there is a logo', async () => {
      renderAt('/dashboard/organization?tab=branding')
      await screen.findByRole('button', { name: 'Upload logo' })
      expect(screen.queryByRole('button', { name: 'Remove logo' })).not.toBeInTheDocument()
    })

    it('saves an uploaded logo back as the same path, so saving the colours keeps the file', async () => {
      const user = userEvent.setup()
      brandingGet.mockResolvedValue({ data: { company_logo_url: UPLOADED, primary_color: '#4778f3', accent_color: '#222022' } })
      renderAt('/dashboard/organization?tab=branding')
      await user.click(await screen.findByRole('button', { name: 'Save Branding' }))
      await waitFor(() => expect(brandingUpdate).toHaveBeenCalledTimes(1))
      expect(brandingUpdate.mock.calls[0][0]).toMatchObject({ company_logo_url: UPLOADED })
    })

    it('replaces an uploaded logo with a link typed into the link field', async () => {
      const user = userEvent.setup()
      brandingGet.mockResolvedValue({ data: { company_logo_url: UPLOADED, primary_color: '#4778f3', accent_color: '#222022' } })
      renderAt('/dashboard/organization?tab=branding')
      await user.type(await screen.findByPlaceholderText('Using the uploaded logo'), 'https://cdn.example.com/logo.png')
      await user.click(screen.getByRole('button', { name: 'Save Branding' }))
      await waitFor(() => expect(brandingUpdate).toHaveBeenCalledTimes(1))
      expect(brandingUpdate.mock.calls[0][0]).toMatchObject({ company_logo_url: 'https://cdn.example.com/logo.png' })
    })
  })

  describe('Reset to Defaults', () => {
    beforeEach(() => {
      brandingGet.mockReset().mockResolvedValue({
        data: { company_logo_url: 'https://x.test/logo.png', primary_color: '#112233', accent_color: '#445566' },
      })
    })

    it('asks first, with one sentence, and changes nothing when declined', async () => {
      const user = userEvent.setup()
      const confirm = vi.fn().mockReturnValue(false)
      vi.stubGlobal('confirm', confirm)
      renderAt('/dashboard/organization?tab=branding')

      await user.click(await screen.findByRole('button', { name: 'Reset to Defaults' }))

      expect(confirm).toHaveBeenCalledTimes(1)
      expect(confirm).toHaveBeenCalledWith('Reset branding to the defaults?')
      expect(screen.getByPlaceholderText('#4778f3')).toHaveValue('#112233')
      expect(screen.getByDisplayValue('https://x.test/logo.png')).toBeInTheDocument()
    })

    it('restores the defaults once confirmed, without saving them', async () => {
      const user = userEvent.setup()
      vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))
      renderAt('/dashboard/organization?tab=branding')

      await user.click(await screen.findByRole('button', { name: 'Reset to Defaults' }))

      expect(screen.getByPlaceholderText('#4778f3')).toHaveValue('#4778f3')
      expect(screen.getByPlaceholderText('#222022')).toHaveValue('#222022')
      expect(screen.queryByDisplayValue('https://x.test/logo.png')).not.toBeInTheDocument()
      expect(brandingUpdate).not.toHaveBeenCalled()
    })
  })

  describe('integrations status', () => {
    const badgeOf = (label: string) =>
      (screen.getByText(label).closest('.org-status-row') as HTMLElement).querySelector('.badge')

    it('shows only the sandbox in use as configured', async () => {
      companyIntegrations.mockReset().mockResolvedValue({
        data: {
          core: [
            { id: 'judge0', label: 'Judge0 (Coding Assessment)', configured: true, active: false },
            { id: 'piston', label: 'Piston (Coding Assessment)', configured: true, active: true },
          ],
          job_sources: [],
        },
      })
      renderAt('/dashboard/organization')

      await screen.findByText('Piston (Coding Assessment)')
      expect(badgeOf('Piston (Coding Assessment)')).toHaveTextContent('Configured')
      expect(badgeOf('Judge0 (Coding Assessment)')).toHaveTextContent('Not in use')
      expect(badgeOf('Judge0 (Coding Assessment)')).not.toHaveTextContent(/^Configured$/)
    })

    it('shows the engine in use as not configured when it has no URL', async () => {
      companyIntegrations.mockReset().mockResolvedValue({
        data: {
          core: [{ id: 'piston', label: 'Piston (Coding Assessment)', configured: false, active: true }],
          job_sources: [],
        },
      })
      renderAt('/dashboard/organization')

      await screen.findByText('Piston (Coding Assessment)')
      expect(badgeOf('Piston (Coding Assessment)')).toHaveTextContent('Not Configured')
    })

    it('draws entries and groups it has never heard of, with nothing hard-coded', async () => {
      companyIntegrations.mockReset().mockResolvedValue({
        data: {
          core: [
            { id: 'anthropic', label: 'Anthropic', configured: true },
            { id: 'aws_ses', label: 'Amazon SES', configured: false },
          ],
          job_sources: [{ id: 'remotive', label: 'Remotive', requires_key: false, configured: true }],
          meetings: [
            { id: 'zoom', label: 'Zoom', configured: true },
            { id: 'teams', label: 'Microsoft Teams', configured: false },
          ],
          hrms: [{ id: 'hrms_webhook', label: 'HRMS', configured: true }],
        },
      })
      renderAt('/dashboard/organization')

      await screen.findByText('Anthropic')
      expect(badgeOf('Anthropic')).toHaveTextContent('Configured')
      expect(badgeOf('Amazon SES')).toHaveTextContent('Not Configured')
      expect(screen.getByText('Meetings')).toBeInTheDocument()
      expect(badgeOf('Zoom')).toHaveTextContent('Configured')
      expect(badgeOf('Microsoft Teams')).toHaveTextContent('Not Configured')
      expect(screen.getByText('Hrms')).toBeInTheDocument()
      expect(badgeOf('HRMS')).toHaveTextContent('Configured')
      expect(screen.getByText('Core Services')).toBeInTheDocument()
      expect(screen.getByText('Job Board Sources')).toBeInTheDocument()
      expect(screen.getByText('Free')).toBeInTheDocument()
    })

    it('does not crash on a payload with a missing group', async () => {
      companyIntegrations.mockReset().mockResolvedValue({ data: { core: [{ id: 'openai', label: 'OpenAI', configured: true }] } })
      renderAt('/dashboard/organization')

      expect(await screen.findByText('OpenAI')).toBeInTheDocument()
      expect(screen.queryByText('Job Board Sources')).not.toBeInTheDocument()
    })

    it('says so, with Retry, when the status cannot be read', async () => {
      const user = userEvent.setup()
      companyIntegrations.mockReset()
        .mockRejectedValueOnce(httpError(500, 'x'))
        .mockResolvedValue({ data: { core: [{ id: 'openai', label: 'OpenAI', configured: true }], job_sources: [] } })
      renderAt('/dashboard/organization')

      expect(await screen.findByText('Could not load integrations status.')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Retry' }))
      expect(await screen.findByText('OpenAI')).toBeInTheDocument()
    })
  })

  describe('test notification', () => {
    it('no longer says notifications are not wired up', async () => {
      renderAt('/dashboard/organization?tab=branding')
      await screen.findByDisplayValue('alerts@example.com')

      expect(screen.queryByText(/does not yet send any emails/)).not.toBeInTheDocument()
      expect(screen.queryByText(/follow-up/)).not.toBeInTheDocument()
    })

    it('sends one and shows it was sent, to whom, and the detail', async () => {
      const user = userEvent.setup()
      renderAt('/dashboard/organization?tab=branding')

      await user.click(await screen.findByRole('button', { name: 'Send test notification' }))

      await waitFor(() => expect(notifTest).toHaveBeenCalledTimes(1))
      const result = await screen.findByRole('status')
      expect(result).toHaveTextContent('Sent')
      expect(result).toHaveTextContent('alerts@example.com: Delivered by SMTP')
    })

    it('shows a failed send with the server\'s reason', async () => {
      const user = userEvent.setup()
      notifTest.mockResolvedValue({ data: { sent: false, to: null, detail: 'No mail server is configured' } })
      renderAt('/dashboard/organization?tab=branding')

      await user.click(await screen.findByRole('button', { name: 'Send test notification' }))

      const result = await screen.findByRole('status')
      expect(result).toHaveTextContent('Failed')
      expect(result).toHaveTextContent('No mail server is configured')
      expect(result).not.toHaveTextContent('null')
    })

    it('shows a failed request with the server\'s detail', async () => {
      const user = userEvent.setup()
      notifTest.mockRejectedValue(httpError(429, 'Too many test messages, try again later'))
      renderAt('/dashboard/organization?tab=branding')

      await user.click(await screen.findByRole('button', { name: 'Send test notification' }))

      const result = await screen.findByRole('status')
      expect(result).toHaveTextContent('Failed')
      expect(result).toHaveTextContent('Too many test messages, try again later')
    })

    it('waits for the typed address to be saved, since the test goes to the saved one', async () => {
      const user = userEvent.setup()
      notifUpdate.mockResolvedValue({ data: { notify_email: 'other@example.com', events: [] } })
      renderAt('/dashboard/organization?tab=branding')

      const email = await screen.findByDisplayValue('alerts@example.com')
      const test = screen.getByRole('button', { name: 'Send test notification' })
      expect(test).toBeEnabled()
      await user.clear(email)
      await user.type(email, 'other@example.com')
      expect(test).toBeDisabled()

      await user.click(screen.getByRole('button', { name: 'Save Notification Settings' }))
      await waitFor(() => expect(notifUpdate).toHaveBeenCalledTimes(1))
      await waitFor(() => expect(test).toBeEnabled())
    })
  })
})

describe('OrganizationPage: plan and usage', () => {
  beforeEach(() => {
    companyGet.mockReset().mockResolvedValue({ data: { company_name: 'Acme Corporation' } })
    companyIntegrations.mockReset().mockResolvedValue({ data: {} })
    companyUsage.mockReset().mockResolvedValue({ data: USAGE })
    brandingGet.mockReset().mockResolvedValue({
      data: { company_logo_url: '', primary_color: '#4778f3', accent_color: '#222022' },
    })
    notifGet.mockReset().mockResolvedValue({ data: { notify_email: '', events: [] } })
    getLetterheadTemplate.mockReset().mockResolvedValue({
      data: { filename: null, header_text: '', footer_text: '', has_logo: false, body_paragraph_count: 0 },
    })
  })

  const usage = (over: Record<string, unknown>) => ({ data: { ...USAGE, ...over } })
  const card = async () => (await screen.findByText('Plan and usage')).closest('.org-card') as HTMLElement
  const meter = (name: string) => screen.getByRole('progressbar', { name })

  it('sits at the top of the Company tab, above the profile', async () => {
    renderAt('/dashboard/organization')
    const titles = (await screen.findAllByText(/^(Plan and usage|Company Profile|Integrations Status)$/, { selector: '.card-title' })).map(t => t.textContent)
    expect(titles).toEqual(['Plan and usage', 'Company Profile', 'Integrations Status'])
    expect(companyUsage).toHaveBeenCalledTimes(1)
  })

  it('shows the plan, the users against their limit and this month\'s AI spend against the budget', async () => {
    renderAt('/dashboard/organization')
    const c = within(await card())

    expect(c.getByText('growth')).toBeInTheDocument()
    expect(c.getByText('Users').parentElement).toHaveTextContent('12 of 25')
    expect(c.getByText('AI spend, October 2026').parentElement).toHaveTextContent('$12.50 of $50.00')
    expect(c.getByText('Emails, last 30 days').parentElement).toHaveTextContent('340')
    expect(meter('Users used')).toHaveAttribute('aria-valuenow', '48')
    expect(meter('AI budget used')).toHaveAttribute('aria-valuenow', '25')
  })

  it('says Unlimited, with no bar, where the plan sets no limit', async () => {
    companyUsage.mockResolvedValue(usage({
      users: { used: 7, limit: null },
      ai: { month: '2026-10', used_usd: 0.0024, budget_usd: null, percent: null },
    }))
    renderAt('/dashboard/organization')
    const c = within(await card())

    expect(c.getByText('Users').parentElement).toHaveTextContent('7 Unlimited')
    expect(c.getByText('AI spend, October 2026').parentElement).toHaveTextContent('$0.0024 Unlimited')
    expect(c.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('keeps a plain bar below 80 percent', async () => {
    companyUsage.mockResolvedValue(usage({ ai: { month: '2026-10', used_usd: 39.5, budget_usd: 50, percent: 79 } }))
    renderAt('/dashboard/organization')
    await card()

    expect(meter('AI budget used')).toHaveClass('org-meter-ok')
    expect(meter('AI budget used')).not.toHaveClass('org-meter-warning')
  })

  it('turns to a warning at 80 percent', async () => {
    companyUsage.mockResolvedValue(usage({ ai: { month: '2026-10', used_usd: 40, budget_usd: 50, percent: 80 } }))
    renderAt('/dashboard/organization')
    await card()

    expect(meter('AI budget used')).toHaveClass('org-meter-warning')
    expect(meter('AI budget used')).toHaveAttribute('aria-valuenow', '80')
  })

  it('turns to an error at 100 percent, and the bar stops at full', async () => {
    companyUsage.mockResolvedValue(usage({ ai: { month: '2026-10', used_usd: 60, budget_usd: 50, percent: 120 } }))
    renderAt('/dashboard/organization')
    await card()

    const bar = meter('AI budget used')
    expect(bar).toHaveClass('org-meter-error')
    expect(bar).toHaveAttribute('aria-valuenow', '100')
    expect(bar).toHaveAttribute('aria-valuetext', '120%')
    expect((bar.firstElementChild as HTMLElement).style.width).toBe('100%')
  })

  it('applies the same thresholds to the seats', async () => {
    companyUsage.mockResolvedValue(usage({ users: { used: 20, limit: 25 } }))
    renderAt('/dashboard/organization')
    await card()
    expect(meter('Users used')).toHaveClass('org-meter-warning')
  })

  it('shows a full seat count as an error', async () => {
    companyUsage.mockResolvedValue(usage({ users: { used: 25, limit: 25 } }))
    renderAt('/dashboard/organization')
    await card()
    expect(meter('Users used')).toHaveClass('org-meter-error')
  })

  it('works the share out itself when the server sends none', async () => {
    companyUsage.mockResolvedValue(usage({ ai: { month: '2026-10', used_usd: 45, budget_usd: 50, percent: null } }))
    renderAt('/dashboard/organization')
    await card()
    expect(meter('AI budget used')).toHaveAttribute('aria-valuenow', '90')
    expect(meter('AI budget used')).toHaveClass('org-meter-warning')
  })

  it('treats a budget of nothing as used up', async () => {
    companyUsage.mockResolvedValue(usage({ ai: { month: '2026-10', used_usd: 0, budget_usd: 0, percent: null } }))
    renderAt('/dashboard/organization')
    await card()
    expect(meter('AI budget used')).toHaveClass('org-meter-error')
  })

  it('leaves the email line out when the server does not count them', async () => {
    companyUsage.mockResolvedValue({ data: { ...USAGE, emails_30d: undefined } })
    renderAt('/dashboard/organization')
    const c = within(await card())
    expect(c.queryByText('Emails, last 30 days')).not.toBeInTheDocument()
  })

  it('shows an error with Retry, and the rest of the tab still works', async () => {
    const user = userEvent.setup()
    companyUsage.mockRejectedValueOnce(httpError(500, 'Usage unavailable'))
    renderAt('/dashboard/organization')
    const c = within(await card())

    expect(await c.findByRole('alert')).toHaveTextContent('Could not load plan and usage.')
    expect(await screen.findByDisplayValue('Acme Corporation')).toBeInTheDocument()

    await user.click(c.getByRole('button', { name: 'Retry' }))
    expect(await c.findByText('12 of 25')).toBeInTheDocument()
    expect(companyUsage).toHaveBeenCalledTimes(2)
  })

  it('is not read on the other tabs', async () => {
    renderAt('/dashboard/organization?tab=branding')
    await screen.findByText('Branding & Notifications', { selector: '.adm-tab' })
    expect(companyUsage).not.toHaveBeenCalled()
    expect(screen.queryByText('Plan and usage')).not.toBeInTheDocument()
  })

  it('shows titles, labels and numbers only', async () => {
    renderAt('/dashboard/organization')
    const c = await card()
    expect(c.querySelector('p')).toBeNull()
    expect(c.querySelector('[class*="-sub"]')).toBeNull()
    expect(c.querySelector('[class*="-note"]')).toBeNull()
  })
})

describe('OrganizationPage: tabs by role', () => {
  beforeEach(() => {
    companyGet.mockReset().mockResolvedValue({ data: { company_name: 'Acme Corporation' } })
    companyIntegrations.mockReset().mockResolvedValue({ data: {} })
    companyUsage.mockReset().mockResolvedValue({ data: { ...USAGE, features: { custom_smtp: true, oidc_sso: true, integrations: true } } })
    getMail.mockReset().mockResolvedValue({
      data: {
        mode: 'platform', from_name: '', from_address: '', reply_to: '', host: '', port: null, username: '',
        use_tls: true, has_password: false, complete: false,
      },
    })
    getSso.mockReset().mockResolvedValue({
      data: {
        enabled: false, issuer: '', client_id: '', has_client_secret: false, scopes: 'openid email profile', enforce: false,
        redirect_uri: 'https://app.test/api/v1/sso/oidc/callback', sso_domains: [],
      },
    })
    listIntegrations.mockReset().mockResolvedValue({
      data: {
        integrations: {
          hrms: { url: '', auth_header: '', auto_push_on_hire: false, has_auth_token: false, configured: false, source: null },
          zoom: { account_id: '', client_id: '', has_client_secret: false, configured: false, source: null },
          teams: { tenant_id: '', client_id: '', organizer: '', has_client_secret: false, configured: false, source: null },
        },
      },
    })
    getRetention.mockReset().mockResolvedValue({ data: { candidate_days: null, resume_days: null, last_purge: null } })
    useAuthStore.setState({ token: 't', user: { role: 'superadmin', email: 'root@x.com' } })
  })

  afterEach(() => { useAuthStore.setState({ token: null, user: null }) })

  const tabNames = () => screen.getAllByRole('tab').map(t => t.textContent)

  it('lists the four company-wide tabs after the three it had, for a Super Admin', async () => {
    renderAt('/dashboard/organization')
    await screen.findByDisplayValue('Acme Corporation')
    expect(tabNames()).toEqual([
      'Company Profile', 'Branding & Notifications', 'Departments, Designations & Grades',
      'Email', 'Sign-in', 'Integrations', 'Data',
    ])
  })

  it('hides those four tabs from an HR Admin', async () => {
    useAuthStore.setState({ token: 't', user: { role: 'admin', email: 'hr@x.com' } })
    renderAt('/dashboard/organization')
    await screen.findByDisplayValue('Acme Corporation')
    expect(tabNames()).toEqual(['Company Profile', 'Branding & Notifications', 'Departments, Designations & Grades'])
  })

  it.each(['email', 'signin', 'integrations', 'data'])('opens the Company Profile instead of ?tab=%s for an HR Admin, and reads nothing for it', async tab => {
    useAuthStore.setState({ token: 't', user: { role: 'admin', email: 'hr@x.com' } })
    renderAt(`/dashboard/organization?tab=${tab}`)
    expect(await screen.findByDisplayValue('Acme Corporation')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Company Profile' })).toHaveAttribute('aria-selected', 'true')
    expect(getMail).not.toHaveBeenCalled()
    expect(getSso).not.toHaveBeenCalled()
    expect(listIntegrations).not.toHaveBeenCalled()
    expect(getRetention).not.toHaveBeenCalled()
  })

  it.each([
    ['email', 'Send email through'],
    ['signin', 'Enable single sign-on'],
    ['integrations', 'Microsoft Teams'],
    ['data', 'Erase a person by email'],
  ])('?tab=%s opens that tab for a Super Admin', async (tab, expected) => {
    renderAt(`/dashboard/organization?tab=${tab}`)
    expect(await screen.findByText(expected)).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: TAB_NAMES[tab] })).toHaveAttribute('aria-selected', 'true')
  })

  it('switches to a new tab with a click, and the tab it left stops reading', async () => {
    const user = userEvent.setup()
    renderAt('/dashboard/organization')
    await screen.findByDisplayValue('Acme Corporation')
    await user.click(screen.getByRole('tab', { name: 'Email' }))
    expect(await screen.findByText('Send email through')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('Acme Corporation')).not.toBeInTheDocument()
  })

  it('shows a gated tab collapsed with the plan sentence when the plan lacks it', async () => {
    companyUsage.mockResolvedValue({ data: { ...USAGE, features: { custom_smtp: false, oidc_sso: false, integrations: false } } })
    renderAt('/dashboard/organization?tab=email')
    expect(await screen.findByText('Your plan does not include a custom mail server.')).toBeInTheDocument()
    expect(getMail).not.toHaveBeenCalled()
  })

  it('never gates the Data tab on the plan', async () => {
    companyUsage.mockResolvedValue({ data: { ...USAGE, features: { custom_smtp: false, oidc_sso: false, integrations: false } } })
    renderAt('/dashboard/organization?tab=data')
    expect(await screen.findByText('Erase a person by email')).toBeInTheDocument()
    expect(screen.queryByText(/Your plan does not include/)).not.toBeInTheDocument()
  })
})

const TAB_NAMES: Record<string, string> = { email: 'Email', signin: 'Sign-in', integrations: 'Integrations', data: 'Data' }

describe('OrganizationPage: legal links and the rest of the plan card', () => {
  beforeEach(() => {
    companyGet.mockReset().mockResolvedValue({
      data: { company_name: 'Acme Corporation', terms_url: 'https://acme.test/terms', privacy_url: '' },
    })
    companyIntegrations.mockReset().mockResolvedValue({ data: {} })
    companyUsage.mockReset().mockResolvedValue({ data: USAGE })
    companyUpdate.mockReset().mockResolvedValue({ data: { company_name: 'Acme Corporation' } })
    useAuthStore.setState({ token: null, user: null })
  })

  const usage = (over: Record<string, unknown>) => ({ data: { ...USAGE, ...over } })
  const card = async () => (await screen.findByText('Plan and usage')).closest('.org-card') as HTMLElement
  const meter = (name: string) => screen.getByRole('progressbar', { name })

  it('shows the saved Terms and Privacy links in two fields with the https rule as help', async () => {
    renderAt('/dashboard/organization')
    expect(await screen.findByLabelText('Terms link')).toHaveValue('https://acme.test/terms')
    expect(screen.getByLabelText('Privacy link')).toHaveValue('')
    expect(screen.getAllByText(/Must start with https:\/\//)).toHaveLength(2)
  })

  it('sends both links with the rest of the profile, a blank one included so it clears', async () => {
    const user = userEvent.setup()
    renderAt('/dashboard/organization')
    await user.type(await screen.findByLabelText('Privacy link'), 'https://acme.test/privacy')
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(companyUpdate).toHaveBeenCalledTimes(1))
    expect(companyUpdate).toHaveBeenCalledWith(expect.objectContaining({
      company_name: 'Acme Corporation', terms_url: 'https://acme.test/terms', privacy_url: 'https://acme.test/privacy',
    }))
  })

  it('clears a link by sending it blank', async () => {
    const user = userEvent.setup()
    renderAt('/dashboard/organization')
    await user.clear(await screen.findByLabelText('Terms link'))
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(companyUpdate).toHaveBeenCalledWith(expect.objectContaining({ terms_url: '', privacy_url: '' })))
  })

  it.each(['http://acme.test/terms', 'acme.test/terms', 'javascript:alert(1)'])('refuses %s before asking the server, naming the rule', async value => {
    const user = userEvent.setup()
    renderAt('/dashboard/organization')
    const field = await screen.findByLabelText('Terms link')
    await user.clear(field)
    await user.type(field, value)
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/The terms link must (start with|be a full address starting with) https:\/\//)
    expect(companyUpdate).not.toHaveBeenCalled()
  })

  it('shows the server 400 under the fields and in a toast', async () => {
    const user = userEvent.setup()
    companyUpdate.mockRejectedValue(httpError(400, 'Terms link must be an https address.'))
    renderAt('/dashboard/organization')
    await user.type(await screen.findByLabelText('Privacy link'), 'https://acme.test/privacy')
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

    const alerts = await screen.findAllByText('Terms link must be an https address.')
    expect(alerts.length).toBeGreaterThanOrEqual(2)
    expect(screen.getByLabelText('Privacy link')).toHaveValue('https://acme.test/privacy')
  })

  it('shows storage against its limit with the same bar and thresholds', async () => {
    companyUsage.mockResolvedValue(usage({ storage: { used_mb: 1200.4, limit_mb: 2000 } }))
    renderAt('/dashboard/organization')
    const c = within(await card())
    expect(c.getByText('Storage').parentElement).toHaveTextContent('1,200.4 MB of 2,000 MB')
    expect(meter('Storage used')).toHaveAttribute('aria-valuenow', '60')
    expect(meter('Storage used')).toHaveClass('org-meter-ok')
  })

  it('turns the storage bar to a warning at 80 percent and an error at 100', async () => {
    companyUsage.mockResolvedValue(usage({ storage: { used_mb: 1600, limit_mb: 2000 } }))
    const { unmount } = renderAt('/dashboard/organization')
    await card()
    expect(meter('Storage used')).toHaveClass('org-meter-warning')
    unmount()

    companyUsage.mockResolvedValue(usage({ storage: { used_mb: 2000, limit_mb: 2000 } }))
    renderAt('/dashboard/organization')
    await card()
    expect(meter('Storage used')).toHaveClass('org-meter-error')
  })

  it('says Unlimited, with no bar, where storage has no limit', async () => {
    companyUsage.mockResolvedValue(usage({ storage: { used_mb: 12.5, limit_mb: null } }))
    renderAt('/dashboard/organization')
    const c = within(await card())
    expect(c.getByText('Storage').parentElement).toHaveTextContent('12.5 MB Unlimited')
    expect(c.queryByRole('progressbar', { name: 'Storage used' })).not.toBeInTheDocument()
  })

  it('leaves the storage line out when the server does not send it', async () => {
    renderAt('/dashboard/organization')
    const c = within(await card())
    expect(c.queryByText('Storage')).not.toBeInTheDocument()
  })

  it('shows the subscription state beside the plan name', async () => {
    companyUsage.mockResolvedValue(usage({ subscription: { status: 'active', trial_ends_at: null } }))
    renderAt('/dashboard/organization')
    const c = within(await card())
    expect(c.getByText('Active')).toBeInTheDocument()
    expect(c.getByText('growth')).toBeInTheDocument()
    expect(c.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows a banner with the trial end date and the days left while trialing', async () => {
    const ends = new Date(Date.now() + 12 * 86_400_000).toISOString()
    companyUsage.mockResolvedValue(usage({ subscription: { status: 'trialing', trial_ends_at: ends } }))
    renderAt('/dashboard/organization')
    const c = within(await card())
    expect(c.getByText('Trial')).toBeInTheDocument()
    expect(c.getByRole('status')).toHaveTextContent(/Your trial ends on .*, in 12 days\./)
  })

  it('raises the trial banner to an alert in the last three days', async () => {
    const ends = new Date(Date.now() + 2 * 86_400_000 - 3_600_000).toISOString()
    companyUsage.mockResolvedValue(usage({ subscription: { status: 'trialing', trial_ends_at: ends } }))
    renderAt('/dashboard/organization')
    const c = within(await card())
    expect(c.getByRole('alert')).toHaveTextContent(/in 2 days\./)
    expect(c.getByRole('alert')).toHaveClass('org-banner-warning')
  })

  it('says a trial without an end date is a trial', async () => {
    companyUsage.mockResolvedValue(usage({ subscription: { status: 'trialing', trial_ends_at: null } }))
    renderAt('/dashboard/organization')
    expect(within(await card()).getByRole('status')).toHaveTextContent('Your workspace is on a trial.')
  })

  it('shows a past due notice as an alert', async () => {
    companyUsage.mockResolvedValue(usage({ subscription: { status: 'past_due', trial_ends_at: null } }))
    renderAt('/dashboard/organization')
    const c = within(await card())
    expect(c.getByText('Past due')).toBeInTheDocument()
    expect(c.getByRole('alert')).toHaveTextContent('Your subscription is past due.')
  })
})
