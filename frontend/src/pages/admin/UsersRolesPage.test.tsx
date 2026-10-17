import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const listUsers = vi.fn()
const resetUserTotp = vi.fn()
const createUser = vi.fn()
const updateUser = vi.fn()
const deleteUser = vi.fn()
const resetPassword = vi.fn()
const inviteUser = vi.fn()
const listRoles = vi.fn()
const listPermissions = vi.fn()
const assignUserRole = vi.fn()
const createRole = vi.fn()
const updateRole = vi.fn()
const deleteRole = vi.fn()
const listDepartments = vi.fn()
const passwordPolicy = vi.fn()
const auditLog = vi.fn()

vi.mock('../../lib/api', () => ({
  authApi: {
    listUsers: (...a: unknown[]) => listUsers(...a),
    createUser: (...a: unknown[]) => createUser(...a),
    updateUser: (...a: unknown[]) => updateUser(...a),
    deleteUser: (...a: unknown[]) => deleteUser(...a),
    adminResetPassword: (...a: unknown[]) => resetPassword(...a),
    inviteUser: (...a: unknown[]) => inviteUser(...a),
    resetUserTotp: (...a: unknown[]) => resetUserTotp(...a),
    passwordPolicy: (...a: unknown[]) => passwordPolicy(...a),
  },
  adminConfigApi: {
    listDepartments: (...a: unknown[]) => listDepartments(...a),
  },
  rbacApi: {
    listRoles: (...a: unknown[]) => listRoles(...a),
    listPermissions: (...a: unknown[]) => listPermissions(...a),
    assignUserRole: (...a: unknown[]) => assignUserRole(...a),
    createRole: (...a: unknown[]) => createRole(...a),
    updateRole: (...a: unknown[]) => updateRole(...a),
    deleteRole: (...a: unknown[]) => deleteRole(...a),
    auditLog: (...a: unknown[]) => auditLog(...a),
    auditLogFacets: vi.fn().mockResolvedValue({ data: {} }),
  },
}))

const { default: UsersRolesPage } = await import('./UsersRolesPage')
const { useAuthStore } = await import('../../store/auth.store')

const ME = 'me@x.com'

const USERS = [
  { email: ME, name: 'Me Myself', role: 'admin', is_active: true, otp_required: false },
  { email: 'bob@x.com', name: 'Bob Recruiter', role: 'standard', is_active: true, otp_required: false },
  { email: 'carol@x.com', name: 'Carol Admin', role: 'admin', is_active: true, otp_required: false },
  { email: 'root@x.com', name: 'Root Super', role: 'superadmin', is_active: true, otp_required: false },
  { email: 'qa@x.com', name: 'Quinn Lead', role: 'qa_lead', is_active: true, otp_required: false },
]

function signInAs(role: 'admin' | 'superadmin', email = ME) {
  useAuthStore.setState({ token: 't', user: { role, email } })
}

function httpError(status: number, detail: string) {
  return { response: { status, data: { detail } } }
}

function renderPage(path = '/dashboard/users') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <UsersRolesPage />
    </MemoryRouter>,
  )
}

async function ready() {
  await screen.findByText('Bob Recruiter')
}

const rowOf = (email: string) => screen.getByText(email).closest('tr') as HTMLElement
const modalBox = () => document.querySelector('.um-modal') as HTMLElement
const rolePicker = () => within(modalBox()).getByLabelText(/^Role/)
const statCards = () =>
  Array.from(document.querySelectorAll('.um-stat-card')).map(c => c.textContent)

const DEPARTMENTS = [
  { department_id: 'd1', name: 'Engineering' },
  { department_id: 'd2', name: 'Sales' },
]

async function fillCreateForm(
  user: ReturnType<typeof userEvent.setup>,
  v: { email?: string; name?: string; password?: string } = {},
) {
  await user.type(screen.getByLabelText('Email *'), v.email ?? 'New.Person@Example.COM')
  await user.type(screen.getByLabelText('Full Name *'), v.name ?? 'New Person')
  await user.type(screen.getByLabelText('Password'), v.password ?? 'Str0ngPass!')
}

beforeEach(() => {
  for (const fn of [
    listUsers, resetUserTotp, createUser, updateUser, deleteUser, resetPassword, inviteUser,
    listRoles, listPermissions, assignUserRole, createRole, updateRole, deleteRole,
    listDepartments, passwordPolicy, auditLog,
  ]) fn.mockReset()
  listUsers.mockResolvedValue({ data: USERS })
  resetUserTotp.mockResolvedValue({ data: { message: 'Authenticator reset' } })
  listDepartments.mockResolvedValue({ data: { departments: DEPARTMENTS } })
  passwordPolicy.mockResolvedValue({ data: { min_length: 1 } })
  auditLog.mockResolvedValue({ data: { items: [], total: 0 } })
  deleteRole.mockResolvedValue({ data: { deleted: true, reassigned: 0 } })
  listRoles.mockResolvedValue({
    data: {
      custom_roles: [{ role_name: 'qa_lead', permissions: ['jobs:read'], description: 'QA', user_count: 0 }],
      built_in_defaults: { standard: ['jobs:read'], admin: ['jobs:read', 'jobs:write'], superadmin: ['jobs:read', 'jobs:write'] },
    },
  })
  listPermissions.mockResolvedValue({ data: { permissions: ['jobs:read', 'jobs:write'] } })
  createUser.mockResolvedValue({ data: {} })
  updateUser.mockResolvedValue({ data: {} })
  assignUserRole.mockResolvedValue({ data: {} })
  updateRole.mockResolvedValue({ data: {} })
  signInAs('admin')
})

describe('as an HR Admin', () => {
  it('creates recruiters only: a fixed Recruiter role instead of a picker', async () => {
    const user = userEvent.setup()
    renderPage()
    await ready()

    await user.click(screen.getByRole('button', { name: '+ Add User' }))

    const modal = within(modalBox())
    expect(modal.queryByLabelText(/^Role/)).not.toBeInTheDocument()
    expect(modal.getByText('Role')).toBeInTheDocument()
    expect(modal.getByText('Recruiter')).toBeInTheDocument()
  })

  it('sends a lower-cased email and the standard role, never a role assignment', async () => {
    const user = userEvent.setup()
    renderPage()
    await ready()

    await user.click(screen.getByRole('button', { name: '+ Add User' }))
    await fillCreateForm(user)
    await user.click(screen.getByRole('button', { name: 'Create User' }))

    await waitFor(() => expect(createUser).toHaveBeenCalledTimes(1))
    expect(createUser).toHaveBeenCalledWith({
      email: 'new.person@example.com',
      name: 'New Person',
      role: 'standard',
      password: 'Str0ngPass!',
      otp_required: false,
    })
    expect(assignUserRole).not.toHaveBeenCalled()
    expect(await screen.findByText('User created')).toBeInTheDocument()
  })

  it('keeps Create User disabled until email and name are filled: the password is optional', async () => {
    const user = userEvent.setup()
    renderPage()
    await ready()

    await user.click(screen.getByRole('button', { name: '+ Add User' }))
    const create = screen.getByRole('button', { name: 'Create User' })
    expect(create).toBeDisabled()

    await user.type(screen.getByLabelText('Email *'), 'a@b.co')
    expect(create).toBeDisabled()
    await user.type(screen.getByLabelText('Full Name *'), 'A B')
    expect(create).toBeEnabled()

    await user.clear(screen.getByLabelText('Full Name *'))
    await user.type(screen.getByLabelText('Full Name *'), '   ')
    expect(create).toBeDisabled()
  })

  it('shows no role picker when editing, and saves the profile without touching the role', async () => {
    const user = userEvent.setup()
    renderPage()
    await ready()

    await user.click(within(rowOf('bob@x.com')).getByRole('button', { name: 'Edit' }))

    expect(within(modalBox()).queryByLabelText(/^Role/)).not.toBeInTheDocument()
    await user.clear(screen.getByLabelText('Full Name *'))
    await user.type(screen.getByLabelText('Full Name *'), 'Robert Recruiter')
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(updateUser).toHaveBeenCalledWith('bob@x.com', {
      name: 'Robert Recruiter', is_active: true, otp_required: false,
    }))
    expect(assignUserRole).not.toHaveBeenCalled()
    expect(await screen.findByText('User updated')).toBeInTheDocument()
  })

  it('cannot edit or reset the password of an admin or superadmin account', async () => {
    renderPage()
    await ready()

    for (const email of ['carol@x.com', 'root@x.com']) {
      const row = within(rowOf(email))
      expect(row.getByRole('button', { name: 'Edit' })).toBeDisabled()
      expect(row.getByRole('button', { name: 'Reset PW' })).toBeDisabled()
    }
    expect(within(rowOf(ME)).getByRole('button', { name: 'Edit' })).toBeDisabled()
    expect(within(rowOf(ME)).getByRole('button', { name: 'Reset PW' })).toBeDisabled()

    for (const email of ['bob@x.com', 'qa@x.com']) {
      const row = within(rowOf(email))
      expect(row.getByRole('button', { name: 'Edit' })).toBeEnabled()
      expect(row.getByRole('button', { name: 'Reset PW' })).toBeEnabled()
    }
  })

  it('opens no modal when a disabled Edit is clicked', async () => {
    const user = userEvent.setup()
    renderPage()
    await ready()

    await user.click(within(rowOf('carol@x.com')).getByRole('button', { name: 'Edit' }))
    expect(modalBox()).toBeNull()
  })

  it('offers no Delete at all', async () => {
    renderPage()
    await ready()

    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })

  it('renders the role controls disabled: New Role, the role icons and the matrix checkboxes', async () => {
    renderPage('/dashboard/users?tab=roles')

    expect(await screen.findByRole('button', { name: '+ New Role' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Edit qa_lead' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Delete qa_lead' })).toBeDisabled()
    const boxes = screen.getAllByRole('checkbox', { name: /for qa_lead$/ })
    expect(boxes).toHaveLength(2)
    for (const box of boxes) expect(box).toBeDisabled()
  })

  it('does not write a permission when its disabled checkbox is clicked', async () => {
    const user = userEvent.setup()
    renderPage('/dashboard/users?tab=roles')

    await user.click(await screen.findByRole('checkbox', { name: 'jobs:write for qa_lead' }))
    expect(updateRole).not.toHaveBeenCalled()
  })
})

describe('as a Super Admin', () => {
  beforeEach(() => signInAs('superadmin', 'root@x.com'))

  it('keeps the full role picker on create, custom roles included', async () => {
    const user = userEvent.setup()
    renderPage()
    await ready()

    await user.click(screen.getByRole('button', { name: '+ Add User' }))

    const labels = within(rolePicker()).getAllByRole('option').map(o => o.textContent)
    expect(labels).toEqual(['Recruiter', 'HR Admin', 'Super Admin', 'qa_lead'])
  })

  it('creates a custom-role user as standard, then assigns the role to the lower-cased email', async () => {
    const user = userEvent.setup()
    renderPage()
    await ready()

    await user.click(screen.getByRole('button', { name: '+ Add User' }))
    await fillCreateForm(user)
    await user.selectOptions(rolePicker(), 'qa_lead')
    await user.click(screen.getByRole('button', { name: 'Create User' }))

    await waitFor(() => expect(assignUserRole).toHaveBeenCalledWith('new.person@example.com', 'qa_lead'))
    expect(createUser).toHaveBeenCalledWith(expect.objectContaining({
      email: 'new.person@example.com', role: 'standard',
    }))
    expect(await screen.findByText('User created')).toBeInTheDocument()
  })

  it('changes another user\'s role through the RBAC endpoint', async () => {
    const user = userEvent.setup()
    renderPage()
    await ready()

    await user.click(within(rowOf('bob@x.com')).getByRole('button', { name: 'Edit' }))
    await user.selectOptions(rolePicker(), 'admin')
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(assignUserRole).toHaveBeenCalledWith('bob@x.com', 'admin'))
    expect(updateUser.mock.calls[0][1]).not.toHaveProperty('role')
  })

  it('cannot delete their own row, but can delete others', async () => {
    renderPage()
    await ready()

    expect(within(rowOf('root@x.com')).getByRole('button', { name: 'Delete' })).toBeDisabled()
    expect(within(rowOf('bob@x.com')).getByRole('button', { name: 'Delete' })).toBeEnabled()
    expect(within(rowOf('carol@x.com')).getByRole('button', { name: 'Delete' })).toBeEnabled()
  })

  it('does not delete anything when the disabled Delete is clicked', async () => {
    const user = userEvent.setup()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderPage()
    await ready()

    await user.click(within(rowOf('root@x.com')).getByRole('button', { name: 'Delete' }))

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(deleteUser).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  it('locks the role and the Active control on their own row, and sends neither', async () => {
    const user = userEvent.setup()
    renderPage()
    await ready()

    await user.click(within(rowOf('root@x.com')).getByRole('button', { name: 'Edit' }))

    expect(rolePicker()).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'Active account' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'Require OTP on login' })).toBeEnabled()

    await user.click(screen.getByRole('checkbox', { name: 'Require OTP on login' }))
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(updateUser).toHaveBeenCalledWith('root@x.com', {
      name: 'Root Super', otp_required: true,
    }))
    expect(assignUserRole).not.toHaveBeenCalled()
  })

  it('matches their own email whatever its case', async () => {
    signInAs('superadmin', 'ROOT@X.COM')
    renderPage()
    await ready()

    expect(within(rowOf('root@x.com')).getByRole('button', { name: 'Delete' })).toBeDisabled()
  })

  it('lets them manage roles: New Role, the icons and the checkboxes are enabled', async () => {
    const user = userEvent.setup()
    renderPage('/dashboard/users?tab=roles')

    expect(await screen.findByRole('button', { name: '+ New Role' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Edit qa_lead' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Delete qa_lead' })).toBeEnabled()

    await user.click(screen.getByRole('checkbox', { name: 'jobs:write for qa_lead' }))
    await waitFor(() => expect(updateRole).toHaveBeenCalledWith('qa_lead', { permissions: ['jobs:read', 'jobs:write'] }))
  })
})

describe('failures', () => {
  beforeEach(() => signInAs('superadmin', 'root@x.com'))

  it('keeps the create form open and shows the server detail when the create is rejected', async () => {
    const user = userEvent.setup()
    createUser.mockRejectedValue(httpError(409, 'A user with this email already exists'))
    renderPage()
    await ready()

    await user.click(screen.getByRole('button', { name: '+ Add User' }))
    await fillCreateForm(user)
    await user.click(screen.getByRole('button', { name: 'Create User' }))

    expect(await screen.findByText('A user with this email already exists')).toBeInTheDocument()
    expect(modalBox()).not.toBeNull()
    expect(screen.getByLabelText('Email *')).toHaveValue('New.Person@Example.COM')
    expect(screen.queryByText('User created')).not.toBeInTheDocument()
    expect(listUsers).toHaveBeenCalledTimes(1)
  })

  it('says so when the user was created but the role could not be assigned', async () => {
    const user = userEvent.setup()
    assignUserRole.mockRejectedValue(httpError(400, 'Role "qa_lead" no longer exists'))
    renderPage()
    await ready()

    await user.click(screen.getByRole('button', { name: '+ Add User' }))
    await fillCreateForm(user)
    await user.selectOptions(rolePicker(), 'qa_lead')
    await user.click(screen.getByRole('button', { name: 'Create User' }))

    const message = await screen.findByText(/User created, but the role was not assigned\./)
    expect(message).toHaveTextContent('Role "qa_lead" no longer exists')
    expect(modalBox()).toBeNull()
    expect(screen.queryByText('User created')).not.toBeInTheDocument()
    await waitFor(() => expect(listUsers).toHaveBeenCalledTimes(2))
  })

  it('says so when the profile was saved but the role change was rejected', async () => {
    const user = userEvent.setup()
    assignUserRole.mockRejectedValue(httpError(409, 'Cannot demote the last Super Admin'))
    renderPage()
    await ready()

    await user.click(within(rowOf('carol@x.com')).getByRole('button', { name: 'Edit' }))
    await user.selectOptions(rolePicker(), 'standard')
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

    const message = await screen.findByText(/Changes saved, but the role was not changed\./)
    expect(message).toHaveTextContent('Cannot demote the last Super Admin')
    expect(updateUser).toHaveBeenCalledTimes(1)
    expect(modalBox()).toBeNull()
    expect(screen.queryByText('User updated')).not.toBeInTheDocument()
    await waitFor(() => expect(listUsers).toHaveBeenCalledTimes(2))
  })

  it('keeps the edit form open and shows the detail when the profile update itself is rejected', async () => {
    const user = userEvent.setup()
    updateUser.mockRejectedValue(httpError(409, 'The last Super Admin cannot be deactivated'))
    renderPage()
    await ready()

    await user.click(within(rowOf('carol@x.com')).getByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('checkbox', { name: 'Active account' }))
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

    expect(await screen.findByText('The last Super Admin cannot be deactivated')).toBeInTheDocument()
    expect(modalBox()).not.toBeNull()
    expect(assignUserRole).not.toHaveBeenCalled()
    expect(listUsers).toHaveBeenCalledTimes(1)
  })

  it('shows a plain message when a failure carries no string detail', async () => {
    const user = userEvent.setup()
    createUser.mockRejectedValue(new Error('Network Error'))
    renderPage()
    await ready()

    await user.click(screen.getByRole('button', { name: '+ Add User' }))
    await fillCreateForm(user)
    await user.click(screen.getByRole('button', { name: 'Create User' }))

    expect(await screen.findByText('Failed to create user')).toBeInTheDocument()
  })
})

describe('the summary cards count only what the list returned', () => {
  const RECRUITERS = [
    { email: 'bob@x.com', name: 'Bob Recruiter', role: 'standard', is_active: true, otp_required: false },
    { email: 'dave@x.com', name: 'Dave Recruiter', role: 'standard', is_active: false, otp_required: false },
  ]

  it('names the total Recruiters for an HR Admin and drops the counts it cannot know', async () => {
    listUsers.mockResolvedValue({ data: RECRUITERS })
    renderPage()
    await ready()

    expect(statCards()).toEqual(['2Recruiters', '1Active', '1Inactive'])
    expect(screen.queryByText('Super Admins')).not.toBeInTheDocument()
    expect(screen.queryByText('HR Admins')).not.toBeInTheDocument()
    expect(screen.getByText('2 of 2 recruiters')).toBeInTheDocument()
  })

  it('does not call a mixed list Recruiters', async () => {
    renderPage()
    await ready()

    expect(statCards()[0]).toBe(`${USERS.length}Users`)
  })

  it('splits by role for a Super Admin, whose list holds every account', async () => {
    signInAs('superadmin', 'root@x.com')
    renderPage()
    await ready()

    expect(statCards()).toEqual(['5Total Users', '1Super Admins', '2HR Admins', '5Active'])
  })
})

describe('departments', () => {
  const RECRUITERS = [
    { email: 'bob@x.com', name: 'Bob Recruiter', role: 'standard', is_active: true, otp_required: false, department_id: 'd1' },
    { email: 'dave@x.com', name: 'Dave Recruiter', role: 'standard', is_active: true, otp_required: false, department_id: null },
  ]

  beforeEach(() => listUsers.mockResolvedValue({ data: RECRUITERS }))

  it('shows each person\'s department in the table, and a dash for none', async () => {
    renderPage()
    await ready()

    expect(within(rowOf('bob@x.com')).getByText('Engineering')).toBeInTheDocument()
    const none = within(rowOf('dave@x.com')).getAllByRole('cell')[2]
    expect(none).toHaveTextContent('-')
  })

  it('lets an HR Admin place a new recruiter in a department', async () => {
    const user = userEvent.setup()
    renderPage()
    await ready()

    await user.click(screen.getByRole('button', { name: '+ Add User' }))
    await fillCreateForm(user)
    await user.selectOptions(within(modalBox()).getByLabelText('Department'), 'd2')
    await user.click(screen.getByRole('button', { name: 'Create User' }))

    await waitFor(() => expect(createUser).toHaveBeenCalledTimes(1))
    expect(createUser).toHaveBeenCalledWith(expect.objectContaining({ role: 'standard', department_id: 'd2' }))
  })

  it('offers the departments the server lists, and none by default', async () => {
    const user = userEvent.setup()
    renderPage()
    await ready()

    await user.click(screen.getByRole('button', { name: '+ Add User' }))
    const select = within(modalBox()).getByLabelText('Department')
    expect(select).toHaveValue('')
    expect(within(select).getAllByRole('option').map(o => o.textContent)).toEqual(['No department', 'Engineering', 'Sales'])
  })

  it('moves a recruiter to another department and sends nothing else new', async () => {
    const user = userEvent.setup()
    renderPage()
    await ready()

    await user.click(within(rowOf('bob@x.com')).getByRole('button', { name: 'Edit' }))
    expect(within(modalBox()).getByLabelText('Department')).toHaveValue('d1')
    await user.selectOptions(within(modalBox()).getByLabelText('Department'), 'd2')
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(updateUser).toHaveBeenCalledWith('bob@x.com', {
      name: 'Bob Recruiter', is_active: true, otp_required: false, department_id: 'd2',
    }))
  })

  it('clears a department with null', async () => {
    const user = userEvent.setup()
    renderPage()
    await ready()

    await user.click(within(rowOf('bob@x.com')).getByRole('button', { name: 'Edit' }))
    await user.selectOptions(within(modalBox()).getByLabelText('Department'), '')
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(updateUser).toHaveBeenCalledWith('bob@x.com', expect.objectContaining({ department_id: null })))
  })

  it('does not rewrite the department on an edit that leaves it alone', async () => {
    const user = userEvent.setup()
    renderPage()
    await ready()

    await user.click(within(rowOf('bob@x.com')).getByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(updateUser).toHaveBeenCalledTimes(1))
    expect(updateUser.mock.calls[0][1]).not.toHaveProperty('department_id')
  })

  it('leaves an HR Admin unable to place an account that is not a recruiter', async () => {
    const user = userEvent.setup()
    listUsers.mockResolvedValue({ data: USERS })
    renderPage()
    await ready()

    await user.click(within(rowOf('qa@x.com')).getByRole('button', { name: 'Edit' }))
    expect(within(modalBox()).getByLabelText('Department')).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(updateUser).toHaveBeenCalledTimes(1))
    expect(updateUser.mock.calls[0][1]).not.toHaveProperty('department_id')
  })

  it('lets a Super Admin place any account', async () => {
    const user = userEvent.setup()
    signInAs('superadmin', 'root@x.com')
    listUsers.mockResolvedValue({ data: USERS })
    renderPage()
    await ready()

    await user.click(within(rowOf('carol@x.com')).getByRole('button', { name: 'Edit' }))
    expect(within(modalBox()).getByLabelText('Department')).toBeEnabled()
  })

  it('still lists users when the departments cannot be read', async () => {
    const user = userEvent.setup()
    listDepartments.mockRejectedValue(httpError(500, 'boom'))
    renderPage()
    await ready()

    expect(within(rowOf('bob@x.com')).getAllByRole('cell')[2]).toHaveTextContent('-')
    await user.click(screen.getByRole('button', { name: '+ Add User' }))
    expect(within(within(modalBox()).getByLabelText('Department')).getAllByRole('option')).toHaveLength(1)
  })
})

describe('the password rules', () => {
  it('come from the server policy, in the create form', async () => {
    const user = userEvent.setup()
    passwordPolicy.mockResolvedValue({ data: { min_length: 10, require_digit: true } })
    renderPage()
    await ready()

    await user.click(screen.getByRole('button', { name: '+ Add User' }))

    expect(await within(modalBox()).findByText('At least 10 characters, with a number')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toHaveAccessibleDescription('At least 10 characters, with a number')
    expect(screen.queryByPlaceholderText('Min 8 characters')).not.toBeInTheDocument()
  })

  it('come from the server policy, in the reset form', async () => {
    const user = userEvent.setup()
    passwordPolicy.mockResolvedValue({ data: { min_length: 14 } })
    renderPage()
    await ready()

    await user.click(within(rowOf('bob@x.com')).getByRole('button', { name: 'Reset PW' }))

    expect(await within(modalBox()).findByText('At least 14 characters')).toBeInTheDocument()
  })

  it('show no rule line when the policy asks for nothing or cannot be read', async () => {
    const user = userEvent.setup()
    passwordPolicy.mockRejectedValue(httpError(500, 'boom'))
    renderPage()
    await ready()

    await user.click(screen.getByRole('button', { name: '+ Add User' }))

    expect(document.querySelector('#um-create-password-hint')).toBeNull()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
  })
})

describe('when the user list cannot be read', () => {
  it('shows an error with Retry, not an empty table or the summary cards', async () => {
    const user = userEvent.setup()
    signInAs('superadmin', 'root@x.com')
    listUsers.mockRejectedValueOnce(httpError(500, 'Database unavailable'))
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('Database unavailable')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(document.querySelector('.um-stat-card')).toBeNull()
    expect(screen.queryByText(/No users found/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await ready()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not claim the list needs a Super Admin', async () => {
    listUsers.mockRejectedValue(httpError(403, 'Forbidden'))
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('Forbidden')
    expect(screen.queryByText(/requires Super Admin/i)).not.toBeInTheDocument()
  })

  it('falls back to a plain message when the failure has no detail', async () => {
    listUsers.mockRejectedValue(new Error('Network Error'))
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load users.')
  })
})

describe('deleting a role', () => {
  beforeEach(() => signInAs('superadmin', 'root@x.com'))

  const withUsers = (n?: number) => listRoles.mockResolvedValue({
    data: {
      custom_roles: [{ role_name: 'qa_lead', permissions: ['jobs:read'], description: 'QA', ...(n === undefined ? {} : { user_count: n }) }],
      built_in_defaults: { standard: ['jobs:read'], admin: ['jobs:read'], superadmin: ['jobs:read'] },
    },
  })
  const openDelete = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(await screen.findByRole('button', { name: 'Delete qa_lead' }))
    return within(screen.getByRole('dialog', { name: 'Delete qa_lead' }))
  }

  it('shows how many users hold each role', async () => {
    withUsers(3)
    renderPage('/dashboard/users?tab=roles')

    expect(await screen.findByText('3 users')).toBeInTheDocument()
  })

  it('says 1 user in the singular, and shows nothing when the server sends no count', async () => {
    withUsers(1)
    const { unmount } = renderPage('/dashboard/users?tab=roles')
    expect(await screen.findByText('1 user')).toBeInTheDocument()
    unmount()

    withUsers()
    renderPage('/dashboard/users?tab=roles')
    await screen.findByRole('button', { name: 'Delete qa_lead' })
    expect(screen.queryByText(/\d+ users?$/)).not.toBeInTheDocument()
  })

  it('deletes a role nobody holds after one confirmation, with no reassignment', async () => {
    const user = userEvent.setup()
    withUsers(0)
    renderPage('/dashboard/users?tab=roles')

    const dialog = await openDelete(user)
    expect(dialog.queryByRole('combobox')).not.toBeInTheDocument()
    await user.click(dialog.getByRole('button', { name: 'Delete Role' }))

    await waitFor(() => expect(deleteRole).toHaveBeenCalledWith('qa_lead', undefined))
    expect(await screen.findByText('Role deleted')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Delete qa_lead' })).not.toBeInTheDocument()
  })

  it('makes the person pick where the holders go before the button enables', async () => {
    const user = userEvent.setup()
    withUsers(3)
    deleteRole.mockResolvedValue({ data: { deleted: true, reassigned: 3 } })
    renderPage('/dashboard/users?tab=roles')

    const dialog = await openDelete(user)
    const choose = dialog.getByLabelText(/3 users hold this role\. Move them to/)
    const del = dialog.getByRole('button', { name: 'Delete Role' })
    expect(del).toBeDisabled()
    expect(within(choose).getAllByRole('option').map(o => o.textContent))
      .toEqual(['Select a role', 'Recruiter', 'HR Admin', 'Super Admin'])

    await user.selectOptions(choose, 'standard')
    expect(del).toBeEnabled()
    await user.click(del)

    await waitFor(() => expect(deleteRole).toHaveBeenCalledWith('qa_lead', 'standard'))
    expect(await screen.findByText('Role deleted, 3 users moved')).toBeInTheDocument()
  })

  it('uses the singular for one holder', async () => {
    const user = userEvent.setup()
    withUsers(1)
    renderPage('/dashboard/users?tab=roles')

    const dialog = await openDelete(user)
    expect(dialog.getByLabelText(/1 user holds this role\. Move them to/)).toBeInTheDocument()
  })

  it('learns the holders from the 409 when the count was missing, and then waits for a role', async () => {
    const user = userEvent.setup()
    withUsers()
    deleteRole.mockRejectedValueOnce({
      response: { status: 409, data: { detail: '2 users hold this role', users_holding: 2 } },
    })
    renderPage('/dashboard/users?tab=roles')

    const dialog = await openDelete(user)
    await user.click(dialog.getByRole('button', { name: 'Delete Role' }))

    const choose = await dialog.findByLabelText(/2 users hold this role\. Move them to/)
    expect(dialog.getByRole('button', { name: 'Delete Role' })).toBeDisabled()
    expect(deleteRole).toHaveBeenCalledTimes(1)

    deleteRole.mockResolvedValueOnce({ data: { deleted: true, reassigned: 2 } })
    await user.selectOptions(choose, 'admin')
    await user.click(dialog.getByRole('button', { name: 'Delete Role' }))

    await waitFor(() => expect(deleteRole).toHaveBeenLastCalledWith('qa_lead', 'admin'))
    expect(await screen.findByText('Role deleted, 2 users moved')).toBeInTheDocument()
  })

  it('keeps the dialog open and says why when the delete fails for another reason', async () => {
    const user = userEvent.setup()
    withUsers(0)
    deleteRole.mockRejectedValue(httpError(400, 'Built-in roles cannot be deleted'))
    renderPage('/dashboard/users?tab=roles')

    const dialog = await openDelete(user)
    await user.click(dialog.getByRole('button', { name: 'Delete Role' }))

    expect(await dialog.findByRole('alert')).toHaveTextContent('Built-in roles cannot be deleted')
    expect(screen.queryByText('Role deleted')).not.toBeInTheDocument()
  })

  it('deletes nothing on Cancel', async () => {
    const user = userEvent.setup()
    withUsers(0)
    renderPage('/dashboard/users?tab=roles')

    const dialog = await openDelete(user)
    await user.click(dialog.getByRole('button', { name: 'Cancel' }))

    expect(deleteRole).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: 'Delete qa_lead' })).not.toBeInTheDocument()
  })
})

describe('the audit log', () => {
  it('filters by resource id', async () => {
    const user = userEvent.setup()
    renderPage('/dashboard/users?tab=audit')
    await waitFor(() => expect(auditLog).toHaveBeenCalledTimes(1))
    expect(auditLog.mock.calls[0][0]).not.toHaveProperty('resource_id')

    await user.type(screen.getByLabelText('Resource ID'), '  64f1c0ffee  ')
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    await waitFor(() => expect(auditLog).toHaveBeenCalledTimes(2))
    expect(auditLog.mock.calls[1][0]).toEqual(expect.objectContaining({ page: 1, resource_id: '64f1c0ffee' }))
  })

  it('clears the resource id with the other filters', async () => {
    const user = userEvent.setup()
    renderPage('/dashboard/users?tab=audit')
    await waitFor(() => expect(auditLog).toHaveBeenCalledTimes(1))

    await user.type(screen.getByLabelText('Resource ID'), 'abc')
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(auditLog).toHaveBeenCalledTimes(2))

    await user.click(screen.getByRole('button', { name: 'Clear' }))
    await waitFor(() => expect(auditLog).toHaveBeenCalledTimes(3))
    expect(auditLog.mock.calls[2][0]).not.toHaveProperty('resource_id')
    expect(screen.getByLabelText('Resource ID')).toHaveValue('')
  })
})

describe('invitations', () => {
  const NOT_EMAILED = 'The account was created but the email could not be sent'

  async function startCreate(user: ReturnType<typeof userEvent.setup>, email = 'New.Person@Example.COM') {
    await user.click(screen.getByRole('button', { name: '+ Add User' }))
    await user.type(screen.getByLabelText('Email *'), email)
    await user.type(screen.getByLabelText('Full Name *'), 'New Person')
  }

  it('hides the password and sends an invitation request instead when the choice is ticked', async () => {
    const user = userEvent.setup()
    createUser.mockResolvedValue({ data: { message: 'User created', invited: true, email_sent: true } })
    renderPage()
    await ready()

    await startCreate(user)
    await user.click(screen.getByRole('checkbox', { name: 'Send an invitation email instead' }))
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Create User' }))

    await waitFor(() => expect(createUser).toHaveBeenCalledTimes(1))
    expect(createUser).toHaveBeenCalledWith({
      email: 'new.person@example.com', name: 'New Person', role: 'standard', send_invite: true, otp_required: false,
    })
    expect(await screen.findByText('User created, invitation sent to new.person@example.com')).toBeInTheDocument()
    expect(modalBox()).toBeNull()
  })

  it('invites when the password is simply left blank', async () => {
    const user = userEvent.setup()
    createUser.mockResolvedValue({ data: { invited: true, email_sent: true } })
    renderPage()
    await ready()

    await startCreate(user)
    await user.click(screen.getByRole('button', { name: 'Create User' }))

    await waitFor(() => expect(createUser).toHaveBeenCalledTimes(1))
    const body = createUser.mock.calls[0][0]
    expect(body).toMatchObject({ send_invite: true })
    expect(body).not.toHaveProperty('password')
  })

  it('does not send a password that was typed before the invitation was chosen', async () => {
    const user = userEvent.setup()
    createUser.mockResolvedValue({ data: { invited: true, email_sent: true } })
    renderPage()
    await ready()

    await startCreate(user)
    await user.type(screen.getByLabelText('Password'), 'Str0ngPass!')
    await user.click(screen.getByRole('checkbox', { name: 'Send an invitation email instead' }))
    await user.click(screen.getByRole('button', { name: 'Create User' }))

    await waitFor(() => expect(createUser).toHaveBeenCalledTimes(1))
    expect(createUser.mock.calls[0][0]).not.toHaveProperty('password')
  })

  it('brings the password field back when the choice is unticked', async () => {
    const user = userEvent.setup()
    renderPage()
    await ready()

    await startCreate(user)
    const choice = screen.getByRole('checkbox', { name: 'Send an invitation email instead' })
    await user.click(choice)
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
    await user.click(choice)
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
  })

  it('warns, and does not claim an email was sent, when the invitation did not leave', async () => {
    const user = userEvent.setup()
    createUser.mockResolvedValue({ data: { message: 'User created', invited: true, email_sent: false } })
    renderPage()
    await ready()

    await startCreate(user)
    await user.click(screen.getByRole('checkbox', { name: 'Send an invitation email instead' }))
    await user.click(screen.getByRole('button', { name: 'Create User' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(NOT_EMAILED)
    expect(screen.queryByText(/invitation sent/i)).not.toBeInTheDocument()
    expect(screen.queryByText('User created')).not.toBeInTheDocument()
    expect(modalBox()).toBeNull()
    await waitFor(() => expect(listUsers).toHaveBeenCalledTimes(2))
  })

  it('does not take a missing email_sent for a sent email', async () => {
    const user = userEvent.setup()
    createUser.mockResolvedValue({ data: { invited: true } })
    renderPage()
    await ready()

    await startCreate(user)
    await user.click(screen.getByRole('button', { name: 'Create User' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(NOT_EMAILED)
  })

  it('does not warn about an email when a password was given: no mail is involved', async () => {
    const user = userEvent.setup()
    createUser.mockResolvedValue({ data: { message: 'User created', invited: false, email_sent: false } })
    renderPage()
    await ready()

    await startCreate(user)
    await user.type(screen.getByLabelText('Password'), 'Str0ngPass!')
    await user.click(screen.getByRole('button', { name: 'Create User' }))

    expect(await screen.findByText('User created')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(createUser.mock.calls[0][0]).toMatchObject({ password: 'Str0ngPass!' })
    expect(createUser.mock.calls[0][0]).not.toHaveProperty('send_invite')
  })

  it('assigns a custom role to an invited account just the same', async () => {
    const user = userEvent.setup()
    signInAs('superadmin', 'root@x.com')
    createUser.mockResolvedValue({ data: { invited: true, email_sent: true } })
    renderPage()
    await ready()

    await startCreate(user)
    await user.selectOptions(rolePicker(), 'qa_lead')
    await user.click(screen.getByRole('checkbox', { name: 'Send an invitation email instead' }))
    await user.click(screen.getByRole('button', { name: 'Create User' }))

    await waitFor(() => expect(assignUserRole).toHaveBeenCalledWith('new.person@example.com', 'qa_lead'))
    expect(createUser).toHaveBeenCalledWith(expect.objectContaining({ role: 'standard', send_invite: true }))
  })

  it('offers the invitation choice on the create form only, not when editing', async () => {
    const user = userEvent.setup()
    renderPage()
    await ready()

    await user.click(within(rowOf('bob@x.com')).getByRole('button', { name: 'Edit' }))
    expect(screen.queryByRole('checkbox', { name: 'Send an invitation email instead' })).not.toBeInTheDocument()
  })
})

describe('invited accounts', () => {
  const PENDING = USERS.map(u => (u.email === 'bob@x.com' || u.email === 'carol@x.com' ? { ...u, invite_pending: true } : u))

  beforeEach(() => {
    listUsers.mockResolvedValue({ data: PENDING })
    inviteUser.mockResolvedValue({ data: { email_sent: true, purpose: 'invite' } })
  })

  it('marks an account whose invitation has not been used, and no other', async () => {
    renderPage()
    await ready()

    expect(within(rowOf('bob@x.com')).getByText('Invited')).toBeInTheDocument()
    expect(within(rowOf('qa@x.com')).queryByText('Invited')).not.toBeInTheDocument()
    expect(within(rowOf('bob@x.com')).getByText('Active')).toBeInTheDocument()
  })

  it('offers Resend invitation on those accounts only', async () => {
    renderPage()
    await ready()

    expect(within(rowOf('bob@x.com')).getByRole('button', { name: 'Resend invitation' })).toBeEnabled()
    expect(within(rowOf('qa@x.com')).queryByRole('button', { name: 'Resend invitation' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Resend invitation' })).toHaveLength(2)
  })

  it('leaves it disabled for an HR Admin on an admin account, as for Edit and Reset PW', async () => {
    renderPage()
    await ready()
    expect(within(rowOf('carol@x.com')).getByRole('button', { name: 'Resend invitation' })).toBeDisabled()
  })

  it('lets a Super Admin resend to an admin account', async () => {
    signInAs('superadmin', 'root@x.com')
    renderPage()
    await ready()
    expect(within(rowOf('carol@x.com')).getByRole('button', { name: 'Resend invitation' })).toBeEnabled()
  })

  it('sends it again, for that account, and says it was sent', async () => {
    const user = userEvent.setup()
    renderPage()
    await ready()

    await user.click(within(rowOf('bob@x.com')).getByRole('button', { name: 'Resend invitation' }))

    expect(inviteUser).toHaveBeenCalledWith('bob@x.com')
    expect(await screen.findByText('Invitation sent to bob@x.com')).toBeInTheDocument()
  })

  it('says a password link went out when the server sent one instead of an invitation', async () => {
    const user = userEvent.setup()
    inviteUser.mockResolvedValue({ data: { email_sent: true, purpose: 'reset' } })
    renderPage()
    await ready()

    await user.click(within(rowOf('bob@x.com')).getByRole('button', { name: 'Resend invitation' }))
    expect(await screen.findByText('Password link sent to bob@x.com')).toBeInTheDocument()
  })

  it('warns when the email did not leave', async () => {
    const user = userEvent.setup()
    inviteUser.mockResolvedValue({ data: { email_sent: false, purpose: 'invite' } })
    renderPage()
    await ready()

    await user.click(within(rowOf('bob@x.com')).getByRole('button', { name: 'Resend invitation' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The invitation email could not be sent')
    expect(screen.queryByText(/Invitation sent/)).not.toBeInTheDocument()
  })

  it('says to wait when the server limits how often one person is invited', async () => {
    const user = userEvent.setup()
    inviteUser.mockRejectedValue({ response: { status: 429, data: {} } })
    renderPage()
    await ready()

    await user.click(within(rowOf('bob@x.com')).getByRole('button', { name: 'Resend invitation' }))
    expect(await screen.findByText('Too many invitations for this user. Try again later.')).toBeInTheDocument()
  })

  it('shows the server message for any other refusal', async () => {
    const user = userEvent.setup()
    inviteUser.mockRejectedValue(httpError(404, 'User not found'))
    renderPage()
    await ready()

    await user.click(within(rowOf('bob@x.com')).getByRole('button', { name: 'Resend invitation' }))
    expect(await screen.findByText('User not found')).toBeInTheDocument()
  })

  it('leaves it disabled on the signed-in account itself', async () => {
    listUsers.mockResolvedValue({ data: USERS.map(u => (u.email === ME ? { ...u, invite_pending: true } : u)) })
    renderPage()
    await ready()
    expect(within(rowOf(ME)).getByRole('button', { name: 'Resend invitation' })).toBeDisabled()
  })
})

describe('paging the user list', () => {
  const PAGE_ONE = USERS.slice(0, 3)
  const PAGE_TWO = [
    { email: 'erin@x.com', name: 'Erin Recruiter', role: 'standard', is_active: true, otp_required: false },
    { email: 'finn@x.com', name: 'Finn Recruiter', role: 'standard', is_active: false, otp_required: false },
  ]

  it('asks for the first hundred and nothing else on the first read', async () => {
    renderPage()
    await ready()
    expect(listUsers).toHaveBeenCalledTimes(1)
    expect(listUsers).toHaveBeenCalledWith({ limit: 100, skip: 0 })
  })

  it('offers no Load more when everything came back', async () => {
    listUsers.mockResolvedValue({ data: USERS, total: USERS.length })
    renderPage()
    await ready()
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
  })

  it('offers Load more while the server holds more, and counts what is read of the total', async () => {
    listUsers.mockResolvedValue({ data: PAGE_ONE, total: 5 })
    renderPage()
    await ready()

    expect(screen.getByRole('button', { name: 'Load more' })).toBeInTheDocument()
    expect(document.querySelector('.um-count')).toHaveTextContent('3 of 5 users')
    expect(statCards()[0]).toContain('5')
  })

  it('reads the next page from where this one ends, adds it below, and drops the button when all are read', async () => {
    const user = userEvent.setup()
    listUsers.mockResolvedValueOnce({ data: PAGE_ONE, total: 5 }).mockResolvedValueOnce({ data: PAGE_TWO, total: 5 })
    renderPage()
    await ready()

    await user.click(screen.getByRole('button', { name: 'Load more' }))

    expect(await screen.findByText('Erin Recruiter')).toBeInTheDocument()
    expect(listUsers).toHaveBeenLastCalledWith({ limit: 100, skip: 3 })
    expect(screen.getByText('Bob Recruiter')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
    expect(document.querySelector('.um-count')).toHaveTextContent('5 of 5 users')
  })

  it('does not list an account twice if two pages both carry it', async () => {
    const user = userEvent.setup()
    listUsers.mockResolvedValueOnce({ data: PAGE_ONE, total: 6 }).mockResolvedValueOnce({ data: [PAGE_ONE[1], ...PAGE_TWO], total: 6 })
    renderPage()
    await ready()
    await user.click(screen.getByRole('button', { name: 'Load more' }))
    await screen.findByText('Erin Recruiter')
    expect(screen.getAllByText('bob@x.com')).toHaveLength(1)
  })

  it('stops offering Load more when a page adds nobody, however big the count says the list is', async () => {
    const user = userEvent.setup()
    listUsers.mockResolvedValueOnce({ data: PAGE_ONE, total: 50 }).mockResolvedValueOnce({ data: [], total: 50 })
    renderPage()
    await ready()
    await user.click(screen.getByRole('button', { name: 'Load more' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument())
  })

  it('says so, and keeps the button, when a page cannot be read', async () => {
    const user = userEvent.setup()
    listUsers.mockResolvedValueOnce({ data: PAGE_ONE, total: 5 }).mockRejectedValueOnce(httpError(500, 'Database unavailable'))
    renderPage()
    await ready()
    await user.click(screen.getByRole('button', { name: 'Load more' }))

    expect(await screen.findByText('Database unavailable')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Load more' })).toBeEnabled()
    expect(screen.getByText('Bob Recruiter')).toBeInTheDocument()
  })

  it('reads the list again from the first page after a change', async () => {
    const user = userEvent.setup()
    listUsers.mockResolvedValueOnce({ data: PAGE_ONE, total: 5 })
    renderPage()
    await ready()
    await user.click(within(rowOf('bob@x.com')).getByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(listUsers).toHaveBeenCalledTimes(2))
    expect(listUsers).toHaveBeenLastCalledWith({ limit: 100, skip: 0 })
  })
})

describe('searching the user list', () => {
  const searchBox = () => screen.getByPlaceholderText('Search by name or email…')

  it('asks the server to match what was typed, after a pause, from the first page', async () => {
    const user = userEvent.setup()
    renderPage()
    await ready()
    listUsers.mockResolvedValue({ data: [USERS[1]], total: 1 })

    await user.type(searchBox(), 'bob')
    expect(listUsers).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(listUsers).toHaveBeenCalledTimes(2))
    expect(listUsers).toHaveBeenLastCalledWith({ limit: 100, skip: 0, search: 'bob' })
  })

  it('shows what came back, without filtering it again on this side', async () => {
    const user = userEvent.setup()
    renderPage()
    await ready()
    listUsers.mockResolvedValue({ data: [USERS[2], USERS[3]], total: 2 })

    await user.type(searchBox(), 'admin')
    await waitFor(() => expect(screen.queryByText('Bob Recruiter')).not.toBeInTheDocument())
    expect(screen.getByText('Carol Admin')).toBeInTheDocument()
    expect(screen.getByText('Root Super')).toBeInTheDocument()
  })

  it('says nothing matched, with what was searched for', async () => {
    const user = userEvent.setup()
    renderPage()
    await ready()
    listUsers.mockResolvedValue({ data: [], total: 0 })

    await user.type(searchBox(), 'zzz')
    expect(await screen.findByText('No users match "zzz"')).toBeInTheDocument()
  })

  it('carries the search into Load more', async () => {
    const user = userEvent.setup()
    renderPage()
    await ready()
    listUsers.mockResolvedValueOnce({ data: USERS.slice(0, 2), total: 4 })
    await user.type(searchBox(), 'x')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Load more' })).toBeInTheDocument())

    listUsers.mockResolvedValueOnce({ data: USERS.slice(2, 4), total: 4 })
    await user.click(screen.getByRole('button', { name: 'Load more' }))
    await waitFor(() => expect(listUsers).toHaveBeenLastCalledWith({ limit: 100, skip: 2, search: 'x' }))
  })

  it('goes back to the whole list when the box is emptied, with no search in the request', async () => {
    const user = userEvent.setup()
    renderPage()
    await ready()
    listUsers.mockResolvedValue({ data: [USERS[1]], total: 1 })
    await user.type(searchBox(), 'bob')
    await waitFor(() => expect(listUsers).toHaveBeenCalledTimes(2))

    listUsers.mockResolvedValue({ data: USERS, total: USERS.length })
    await user.clear(searchBox())
    await waitFor(() => expect(listUsers).toHaveBeenCalledTimes(3))
    expect(listUsers).toHaveBeenLastCalledWith({ limit: 100, skip: 0 })
  })

  it('shows the error, with Retry, when a search cannot be read', async () => {
    const user = userEvent.setup()
    renderPage()
    await ready()
    listUsers.mockRejectedValue(httpError(500, 'Search is down'))
    await user.type(searchBox(), 'bob')
    expect(await screen.findByText('Search is down')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })
})

describe('two-step verification on the list', () => {
  const WITH_2FA = [
    { email: ME, name: 'Me Myself', role: 'admin', is_active: true, otp_required: false, totp_enabled: false },
    { email: 'bob@x.com', name: 'Bob Recruiter', role: 'standard', is_active: true, otp_required: false, totp_enabled: true },
    { email: 'carol@x.com', name: 'Carol Admin', role: 'admin', is_active: true, otp_required: false, totp_enabled: true },
    { email: 'dave@x.com', name: 'Dave Recruiter', role: 'standard', is_active: true, otp_required: false },
  ]

  beforeEach(() => listUsers.mockResolvedValue({ data: WITH_2FA }))

  it('marks the rows that have an authenticator with a 2FA chip, and no other', async () => {
    renderPage()
    await ready()
    expect(within(rowOf('bob@x.com')).getByText('2FA')).toBeInTheDocument()
    expect(within(rowOf('carol@x.com')).getByText('2FA')).toBeInTheDocument()
    expect(within(rowOf('dave@x.com')).queryByText('2FA')).not.toBeInTheDocument()
    expect(within(rowOf(ME)).queryByText('2FA')).not.toBeInTheDocument()
  })

  it('offers Reset authenticator on those rows only', async () => {
    renderPage()
    await ready()
    expect(within(rowOf('bob@x.com')).getByRole('button', { name: 'Reset authenticator' })).toBeInTheDocument()
    expect(within(rowOf('dave@x.com')).queryByRole('button', { name: 'Reset authenticator' })).not.toBeInTheDocument()
  })

  it('resets after a confirmation, clears the chip and says so', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderPage()
    await ready()

    await user.click(within(rowOf('bob@x.com')).getByRole('button', { name: 'Reset authenticator' }))

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('bob@x.com'))
    expect(await screen.findByText('Authenticator reset for bob@x.com')).toBeInTheDocument()
    expect(resetUserTotp).toHaveBeenCalledWith('bob@x.com')
    expect(within(rowOf('bob@x.com')).queryByText('2FA')).not.toBeInTheDocument()
    expect(within(rowOf('bob@x.com')).queryByRole('button', { name: 'Reset authenticator' })).not.toBeInTheDocument()
    confirm.mockRestore()
  })

  it('does nothing when the confirmation is declined', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderPage()
    await ready()
    await user.click(within(rowOf('bob@x.com')).getByRole('button', { name: 'Reset authenticator' }))
    expect(resetUserTotp).not.toHaveBeenCalled()
    expect(within(rowOf('bob@x.com')).getByText('2FA')).toBeInTheDocument()
    confirm.mockRestore()
  })

  it('keeps the chip and shows the server sentence when the reset is refused', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    resetUserTotp.mockRejectedValue(httpError(403, 'Only a Super Admin can do this'))
    renderPage()
    await ready()
    await user.click(within(rowOf('bob@x.com')).getByRole('button', { name: 'Reset authenticator' }))
    expect(await screen.findByText('Only a Super Admin can do this')).toBeInTheDocument()
    expect(within(rowOf('bob@x.com')).getByText('2FA')).toBeInTheDocument()
    confirm.mockRestore()
  })

  it('leaves an HR Admin out of resetting an administrator, as with a password reset', async () => {
    renderPage()
    await ready()
    expect(within(rowOf('carol@x.com')).getByRole('button', { name: 'Reset authenticator' })).toBeDisabled()
    expect(within(rowOf('bob@x.com')).getByRole('button', { name: 'Reset authenticator' })).toBeEnabled()
  })

  it('lets a Super Admin reset an administrator too', async () => {
    signInAs('superadmin')
    renderPage()
    await ready()
    expect(within(rowOf('carol@x.com')).getByRole('button', { name: 'Reset authenticator' })).toBeEnabled()
  })
})
