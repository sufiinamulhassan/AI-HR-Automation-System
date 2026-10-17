import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { adminConfigApi, authApi, rbacApi } from '../../lib/api'
import { usePasswordPolicy } from '../../lib/passwordPolicy'
import { useAuthStore } from '../../store/auth.store'
import '../../styles/admin-tabs.css'
import './UserManagementPage.css'
import './RolesPermissionsPage.css'
import './AuditLogPage.css'
import './UsersRolesPage.css'

interface User {
  email: string
  name: string
  role: string
  is_active: boolean
  otp_required: boolean
  department_id?: string | null
  created_at?: string
  last_login_at?: string
  invite_pending?: boolean
  totp_enabled?: boolean
}

interface Department {
  department_id: string
  name: string
}

interface AuditEntry {
  id?: string
  audit_id?: string
  _id?: string
  actor_email?: string
  actor?: string
  actor_role?: string
  action?: string
  event?: string
  resource_type?: string
  resource_id?: string
  details?: unknown
  metadata?: unknown
  timestamp?: string
  created_at?: string
}

interface AuditFilters {
  actor_email: string
  action: string
  resource_type: string
  resource_id: string
  start_date: string
  end_date: string
}

interface AuditFacets {
  actions: string[]
  resource_types: string[]
  actors: string[]
}

type Tab = 'users' | 'roles' | 'audit'

const AUDIT_LIMIT = 25
const USERS_PAGE = 100
const SEARCH_DELAY_MS = 300
const EMPTY_AUDIT_FILTERS: AuditFilters = { actor_email: '', action: '', resource_type: '', resource_id: '', start_date: '', end_date: '' }

function entryId(e: AuditEntry, idx: number): string { return e.id || e.audit_id || e._id || String(idx) }
function entryActor(e: AuditEntry): string { return e.actor_email || e.actor || '-' }
function entryAction(e: AuditEntry): string { return e.action || e.event || '-' }
function entryTime(e: AuditEntry): string {
  const raw = e.created_at || e.timestamp
  if (!raw) return '-'
  const d = new Date(raw)
  return isNaN(d.getTime()) ? String(raw) : d.toLocaleString('en-GB')
}
function entryDetails(e: AuditEntry): string {
  const raw = e.details ?? e.metadata
  if (raw == null) return ''
  if (typeof raw === 'string') return raw
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const pairs = Object.entries(raw as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    return pairs.join(' · ')
  }
  return JSON.stringify(raw)
}

interface CustomRole {
  role_name: string
  permissions: string[]
  description?: string
  user_count?: number
}

const BUILTIN_ROLE_NAMES = ['standard', 'admin', 'superadmin']
const BUILTIN_LABELS: Record<string, string> = {
  superadmin: 'Super Admin',
  admin: 'HR Admin',
  standard: 'Recruiter',
}
const CATEGORY_LABELS: Record<string, string> = {
  jobs: 'Jobs',
  resumes: 'Resumes',
  intel: 'Bulk Resume Ingestion',
  candidates: 'Candidates',
  interview: 'Interview',
  coding: 'AI Coding Assessment',
  scenarios: 'Scenario Interviews',
  offers: 'Offer Management',
  analytics: 'HR Analytics',
  workflows: 'Workflow Automation',
  webhooks: 'Outbound Webhooks',
  departments: 'Departments',
  designations: 'Designations',
  users: 'User Management',
  rbac: 'Roles & Permissions',
  audit: 'Audit Log',
}

const EMPTY_FORM = { email: '', name: '', role: 'standard', password: '', send_invite: false, is_active: true, otp_required: false, department_id: '' }

const CREATED_NOT_EMAILED = 'The account was created but the email could not be sent'

const PRIVILEGED_ROLES = ['admin', 'superadmin']
const SUPER_ADMIN_ONLY = 'Only a Super Admin can do this'

function titleCase(s: string) {
  return s.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

function permCategory(key: string) {
  const prefix = key.split(':')[0]
  return CATEGORY_LABELS[prefix] || titleCase(prefix)
}

function permActionLabel(key: string) {
  return titleCase(key.split(':')[1] || key)
}

function roleLabel(name: string, custom: CustomRole[]) {
  return BUILTIN_LABELS[name] || custom.find(r => r.role_name === name)?.role_name || name
}

function avatarClass(role: string) {
  if (role === 'superadmin') return 'um-avatar um-avatar-superadmin'
  if (role === 'admin') return 'um-avatar um-avatar-admin'
  if (role === 'standard') return 'um-avatar um-avatar-standard'
  return 'um-avatar um-avatar-custom'
}

function roleBadgeClass(role: string) {
  if (BUILTIN_ROLE_NAMES.includes(role)) return `um-role-badge um-role-${role}`
  return 'um-role-badge um-role-custom'
}

function initialOf(name: string, email: string) {
  return (name || email || '?').charAt(0).toUpperCase()
}

function errorMessage(e: unknown, fallback: string): string {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  if (typeof detail === 'string' && detail.trim()) return detail
  if (Array.isArray(detail) && detail.length) {
    return detail
      .map(d => (d && typeof d === 'object' && 'msg' in d) ? String((d as { msg: unknown }).msg) : String(d))
      .join('; ')
  }
  return fallback
}

const PencilIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" fillOpacity="0.16" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
  </svg>
)

const TrashIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
  </svg>
)

const MailIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" fillOpacity="0.16" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" fill="none" />
  </svg>
)

const LockIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" fillOpacity="0.16" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" fill="none" />
  </svg>
)

const CheckIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
)

function StatIcon({ tone }: { tone: string }) {
  if (tone === 'purple') {
    return (
      <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
      </svg>
    )
  }
  if (tone === 'blue') {
    return (
      <svg width="16" height="16" fill="currentColor" fillOpacity="0.16" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    )
  }
  if (tone === 'green') {
    return (
      <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    )
  }
  return (
    <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a4 4 0 00-5-3.87M9 20H4v-2a4 4 0 015-3.87m6-4a4 4 0 11-8 0 4 4 0 018 0zm6 4a3 3 0 10-6 0" />
    </svg>
  )
}

const SearchIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" fillOpacity="0.16" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" fill="none" />
  </svg>
)

function PermCheckbox({ checked, disabled, onChange, label }: { checked: boolean; disabled?: boolean; onChange?: () => void; label: string }) {
  return (
    <label className={`rp-check${disabled ? ' rp-check-disabled' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={onChange} aria-label={label} />
      <span className="rp-check-box"><CheckIcon /></span>
    </label>
  )
}

function MatrixSkeleton() {
  return (
    <div className="rp-skeleton" aria-hidden="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <div className="rp-skeleton-row" key={i}>
          <div className="rp-skeleton-bar" style={{ width: `${58 - i * 4}%` }} />
          {Array.from({ length: 4 }).map((_, j) => <div className="rp-skeleton-chip" key={j} />)}
        </div>
      ))}
    </div>
  )
}

export default function UsersRolesPage() {
  const currentUser = useAuthStore(s => s.user) as Record<string, string> | null
  const isSuperAdmin = currentUser?.role === 'superadmin'
  const currentEmail = (currentUser?.email ?? '').trim().toLowerCase()
  const isSelf = (u: User) => !!currentEmail && u.email.trim().toLowerCase() === currentEmail
  const canManageAccount = (u: User) => isSuperAdmin || !PRIVILEGED_ROLES.includes(u.role)

  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const tab: Tab = tabParam === 'roles' || tabParam === 'audit' ? tabParam : 'users'
  function setTab(next: Tab) {
    setSearchParams(next === 'users' ? {} : { tab: next }, { replace: true })
  }

  const [users, setUsers] = useState<User[]>([])
  const [customRoles, setCustomRoles] = useState<CustomRole[]>([])
  const [builtinPerms, setBuiltinPerms] = useState<Record<string, string[]>>({})
  const [permissions, setPermissions] = useState<string[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [loading, setLoading] = useState(true)
  const [usersError, setUsersError] = useState('')
  const [toast, setToast] = useState('')
  const [toastWarn, setToastWarn] = useState(false)
  const { hint: passwordHint } = usePasswordPolicy()

  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [total, setTotal] = useState(0)
  const [moreBusy, setMoreBusy] = useState(false)
  const [exhausted, setExhausted] = useState(false)
  const [searching, setSearching] = useState(false)
  const usersSeq = useRef(0)
  const [resettingTotp, setResettingTotp] = useState<string | null>(null)
  const [modal, setModal] = useState<'create' | 'edit' | 'reset' | null>(null)
  const [selected, setSelected] = useState<User | null>(null)
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [resetEmail, setResetEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [inviting, setInviting] = useState<string | null>(null)

  const [permSearch, setPermSearch] = useState('')
  const [pendingCell, setPendingCell] = useState<string | null>(null)
  const [roleModal, setRoleModal] = useState<'create' | 'edit' | null>(null)
  const [roleSelected, setRoleSelected] = useState<CustomRole | null>(null)
  const [roleForm, setRoleForm] = useState({ name: '', description: '' })
  const [roleToDelete, setRoleToDelete] = useState<CustomRole | null>(null)
  const [deleteHolders, setDeleteHolders] = useState(0)
  const [reassignTo, setReassignTo] = useState('')
  const [deleteError, setDeleteError] = useState('')

  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([])
  const [auditTotal, setAuditTotal] = useState(0)
  const [auditPage, setAuditPage] = useState(1)
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditErrored, setAuditErrored] = useState(false)
  const [auditLoaded, setAuditLoaded] = useState(false)
  const [auditFacets, setAuditFacets] = useState<AuditFacets>({ actions: [], resource_types: [], actors: [] })
  const [auditDraft, setAuditDraft] = useState<AuditFilters>({ ...EMPTY_AUDIT_FILTERS })
  const [auditApplied, setAuditApplied] = useState<AuditFilters>({ ...EMPTY_AUDIT_FILTERS })

  useEffect(() => { load() }, [])

  useEffect(() => {
    if (tab !== 'audit') return
    loadAudit()
  }, [tab, auditPage, auditApplied])

  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), SEARCH_DELAY_MS)
    return () => clearTimeout(t)
  }, [search])

  const searchedOnce = useRef(false)
  useEffect(() => {
    if (!searchedOnce.current) { searchedOnce.current = true; return }
    void searchUsers()
  }, [query])

  useEffect(() => {
    if (tab !== 'audit' || auditFacets.actions.length || auditFacets.resource_types.length) return
    rbacApi.auditLogFacets()
      .then(r => {
        const d = r.data as Partial<AuditFacets>
        setAuditFacets({
          actions: Array.isArray(d?.actions) ? d.actions : [],
          resource_types: Array.isArray(d?.resource_types) ? d.resource_types : [],
          actors: Array.isArray(d?.actors) ? d.actors : [],
        })
      })
      .catch(() => { })
  }, [tab])

  async function load() {
    setLoading(true)
    setUsersError('')
    await Promise.all([
      readFirstPage().catch((e: unknown) => {
        setUsersError(errorMessage(e, 'Could not load users.'))
        setUsers([])
        setTotal(0)
      }),

      adminConfigApi.listDepartments().then(r => {
        const list = (r.data as { departments?: Department[] })?.departments
        setDepartments(Array.isArray(list) ? list : [])
      }).catch(() => setDepartments([])),

      rbacApi.listRoles().then(r => {
        const data = r.data as { custom_roles?: CustomRole[]; built_in_defaults?: Record<string, string[]> }
        const list = Array.isArray(data?.custom_roles) ? data.custom_roles : []
        setCustomRoles(list.map(x => ({ ...x, permissions: x.permissions ?? [] })))
        setBuiltinPerms(data?.built_in_defaults ?? {})
      }).catch(() => { setCustomRoles([]); setBuiltinPerms({}) }),

      rbacApi.listPermissions().then(r => {
        const data = r.data as { permissions?: string[] }
        setPermissions(Array.isArray(data?.permissions) ? data.permissions : [])
      }).catch(() => setPermissions([])),
    ])
    setLoading(false)
  }

  async function readFirstPage() {
    const seq = ++usersSeq.current
    const r = await authApi.listUsers({ limit: USERS_PAGE, skip: 0, ...(query ? { search: query } : {}) })
    if (seq !== usersSeq.current) return
    const list: User[] = Array.isArray(r.data) ? r.data : []
    setUsers(list)
    setTotal(typeof r.total === 'number' ? r.total : list.length)
    setExhausted(false)
  }

  async function searchUsers() {
    setSearching(true)
    setUsersError('')
    try {
      await readFirstPage()
    } catch (e: unknown) {
      setUsersError(errorMessage(e, 'Could not load users.'))
      setUsers([])
      setTotal(0)
    }
    setSearching(false)
  }

  async function loadMore() {
    setMoreBusy(true)
    const seq = usersSeq.current
    try {
      const r = await authApi.listUsers({ limit: USERS_PAGE, skip: users.length, ...(query ? { search: query } : {}) })
      if (seq !== usersSeq.current) { setMoreBusy(false); return }
      const next: User[] = Array.isArray(r.data) ? r.data : []
      const known = new Set(users.map(u => u.email))
      const added = next.filter(u => !known.has(u.email))
      setUsers(prev => [...prev, ...added])
      if (typeof r.total === 'number') setTotal(r.total)
      if (added.length === 0) setExhausted(true)
    } catch (e: unknown) {
      showToast(errorMessage(e, 'Could not load more users'))
    }
    setMoreBusy(false)
  }

  async function loadAudit() {
    setAuditLoading(true)
    setAuditErrored(false)
    try {
      const params: Record<string, string | number> = { page: auditPage, limit: AUDIT_LIMIT }
      if (auditApplied.actor_email) params.actor_email = auditApplied.actor_email
      if (auditApplied.action) params.action = auditApplied.action
      if (auditApplied.resource_type) params.resource_type = auditApplied.resource_type
      if (auditApplied.resource_id) params.resource_id = auditApplied.resource_id
      if (auditApplied.start_date) params.start_date = auditApplied.start_date
      if (auditApplied.end_date) params.end_date = auditApplied.end_date

      const r = await rbacApi.auditLog(params)
      const data = r.data as Record<string, unknown>
      const list = ([data?.items, data?.logs, data?.results, data?.entries, data?.audit_log]
        .find(Array.isArray) ?? (Array.isArray(data) ? data : [])) as AuditEntry[]
      setAuditEntries(list)
      setAuditTotal(typeof data?.total === 'number' ? data.total : list.length)
    } catch {
      setAuditEntries([])
      setAuditTotal(0)
      setAuditErrored(true)
    }
    setAuditLoaded(true)
    setAuditLoading(false)
  }

  function applyAuditFilters() {
    setAuditPage(1)
    setAuditApplied({
      actor_email: auditDraft.actor_email.trim(),
      action: auditDraft.action.trim(),
      resource_type: auditDraft.resource_type.trim(),
      resource_id: auditDraft.resource_id.trim(),
      start_date: auditDraft.start_date,
      end_date: auditDraft.end_date,
    })
  }

  function clearAuditFilters() {
    setAuditDraft({ ...EMPTY_AUDIT_FILTERS })
    setAuditPage(1)
    setAuditApplied({ ...EMPTY_AUDIT_FILTERS })
  }

  function showToast(msg: string, ms = 3000, warn = false) {
    setToast(msg)
    setToastWarn(warn)
    setTimeout(() => setToast(''), ms)
  }

  const overridable = customRoles.filter(r => !BUILTIN_ROLE_NAMES.includes(r.role_name))
  function builtinPermsFor(name: string): string[] {
    const override = customRoles.find(r => r.role_name === name)
    return override ? override.permissions : (builtinPerms[name] ?? [])
  }

  const allRoleOptions = useMemo(() => {
    const opts = BUILTIN_ROLE_NAMES.map(n => ({ value: n, label: BUILTIN_LABELS[n] }))
    for (const r of customRoles) {
      if (!BUILTIN_ROLE_NAMES.includes(r.role_name)) opts.push({ value: r.role_name, label: r.role_name })
    }
    return opts
  }, [customRoles])

  function openCreate() {
    setForm({ ...EMPTY_FORM })
    setSelected(null)
    setModal('create')
  }

  function openEdit(u: User) {
    setSelected(u)
    setForm({
      email: u.email, name: u.name, role: u.role, password: '', send_invite: false, is_active: u.is_active,
      otp_required: u.otp_required, department_id: u.department_id ?? '',
    })
    setModal('edit')
  }

  function openReset(u: User) {
    setSelected(u)
    setResetEmail(u.email)
    setNewPassword('')
    setModal('reset')
  }

  async function handleCreate() {
    if (!createReady) return
    setSaving(true)
    const email = form.email.trim().toLowerCase()
    const role = isSuperAdmin ? form.role : 'standard'
    const isCustomRole = !BUILTIN_ROLE_NAMES.includes(role)
    const invite = form.send_invite || form.password === ''
    let created = false
    try {
      const r = await authApi.createUser({
        email,
        name: form.name.trim(),
        role: isCustomRole ? 'standard' : role,
        ...(invite ? { send_invite: true } : { password: form.password }),
        otp_required: form.otp_required,
        ...(canSetDepartment && form.department_id ? { department_id: form.department_id } : {}),
      })
      created = true
      if (isCustomRole) await rbacApi.assignUserRole(email, role)
      const invited = typeof r.data?.invited === 'boolean' ? r.data.invited : invite
      if (!invited) showToast('User created')
      else if (r.data?.email_sent === true) showToast(`User created, invitation sent to ${email}`)
      else showToast(CREATED_NOT_EMAILED, 7000, true)
      setModal(null); load()
    } catch (e: unknown) {
      if (created) {
        showToast(
          `User created, but the role was not assigned. ${errorMessage(e, 'The role could not be assigned.')}`,
          6000,
        )
        setModal(null); load()
      } else {
        showToast(errorMessage(e, 'Failed to create user'))
      }
    }
    setSaving(false)
  }

  async function handleEdit() {
    if (!selected || !form.name.trim()) return
    setSaving(true)
    const email = selected.email.trim().toLowerCase()
    const self = isSelf(selected)
    let profileSaved = false
    try {
      const departmentChanged = canSetDepartment && (form.department_id || null) !== (selected.department_id ?? null)
      await authApi.updateUser(email, {
        name: form.name.trim(),
        ...(self ? {} : { is_active: form.is_active }),
        otp_required: form.otp_required,
        ...(departmentChanged ? { department_id: form.department_id || null } : {}),
      })
      profileSaved = true
      if (isSuperAdmin && !self && form.role !== selected.role) {
        await rbacApi.assignUserRole(email, form.role)
      }
      showToast('User updated')
      setModal(null); load()
    } catch (e: unknown) {
      if (profileSaved) {
        showToast(
          `Changes saved, but the role was not changed. ${errorMessage(e, 'The role could not be changed.')}`,
          6000,
        )
        setModal(null); load()
      } else {
        showToast(errorMessage(e, 'Failed to update user'))
      }
    }
    setSaving(false)
  }

  async function handleDelete(email: string) {
    if (!confirm(`Delete user ${email}? This cannot be undone.`)) return
    try {
      await authApi.deleteUser(email)
      showToast('User deleted')
      load()
    } catch (e: unknown) {
      showToast(errorMessage(e, 'Failed to delete user'))
    }
  }

  async function handleResetPassword() {
    if (!newPassword.trim()) return
    setSaving(true)
    try {
      await authApi.adminResetPassword({ email: resetEmail, new_password: newPassword })
      showToast('Password reset successfully')
      setModal(null)
    } catch (e: unknown) {
      showToast(errorMessage(e, 'Failed to reset password'))
    }
    setSaving(false)
  }

  async function handleResetTotp(u: User) {
    if (!confirm(`Reset the authenticator for ${u.email}? They will have to set it up again.`)) return
    setResettingTotp(u.email)
    try {
      await authApi.resetUserTotp(u.email)
      setUsers(prev => prev.map(x => (x.email === u.email ? { ...x, totp_enabled: false } : x)))
      showToast(`Authenticator reset for ${u.email}`)
    } catch (e: unknown) {
      showToast(errorMessage(e, 'Failed to reset the authenticator'))
    }
    setResettingTotp(null)
  }

  async function handleInvite(u: User) {
    setInviting(u.email)
    try {
      const r = await authApi.inviteUser(u.email)
      if (r.data?.email_sent !== true) showToast('The invitation email could not be sent', 7000, true)
      else showToast(r.data.purpose === 'reset' ? `Password link sent to ${u.email}` : `Invitation sent to ${u.email}`)
    } catch (e: unknown) {
      const tooMany = (e as { response?: { status?: number } })?.response?.status === 429
      showToast(errorMessage(e, tooMany ? 'Too many invitations for this user. Try again later.' : 'Failed to send the invitation'))
    }
    setInviting(null)
  }

  function openCreateRole() {
    setRoleForm({ name: '', description: '' })
    setRoleSelected(null)
    setRoleModal('create')
  }

  function openEditRole(r: CustomRole) {
    setRoleSelected(r)
    setRoleForm({ name: r.role_name, description: r.description || '' })
    setRoleModal('edit')
  }

  async function saveRole() {
    if (!isSuperAdmin) return
    setSaving(true)
    try {
      if (roleModal === 'create') {
        await rbacApi.createRole({ name: roleForm.name.trim(), permissions: [], description: roleForm.description.trim() || undefined })
        showToast('Role created')
      } else if (roleSelected) {
        await rbacApi.updateRole(roleSelected.role_name, { description: roleForm.description.trim() || undefined })
        showToast('Role updated')
      }
      setRoleModal(null)
      load()
    } catch (e: unknown) {
      showToast(errorMessage(e, 'Failed to save role'))
    }
    setSaving(false)
  }

  function openDeleteRole(r: CustomRole) {
    if (!isSuperAdmin) return
    setRoleToDelete(r)
    setDeleteHolders(r.user_count ?? 0)
    setReassignTo('')
    setDeleteError('')
  }

  async function confirmDeleteRole() {
    if (!roleToDelete || !isSuperAdmin) return
    setSaving(true)
    setDeleteError('')
    try {
      const r = await rbacApi.deleteRole(roleToDelete.role_name, deleteHolders > 0 ? reassignTo : undefined)
      const moved = Number((r.data as { reassigned?: number } | undefined)?.reassigned ?? 0)
      showToast(moved > 0 ? `Role deleted, ${moved} user${moved === 1 ? '' : 's'} moved` : 'Role deleted')
      setRoleToDelete(null)
      load()
    } catch (e: unknown) {
      const res = (e as { response?: { status?: number; data?: { users_holding?: unknown } } })?.response
      const holding = res?.data?.users_holding
      if (res?.status === 409 && typeof holding === 'number' && holding > 0) {
        setDeleteHolders(holding)
        setReassignTo('')
      } else {
        setDeleteError(errorMessage(e, 'Failed to delete role'))
      }
    }
    setSaving(false)
  }

  async function togglePermission(role: CustomRole, permission: string) {
    if (!isSuperAdmin) return
    const cellId = `${role.role_name}:${permission}`
    const previous = role.permissions
    const has = previous.includes(permission)
    const next = has ? previous.filter(p => p !== permission) : [...previous, permission]

    setCustomRoles(prev => prev.map(r => r.role_name === role.role_name ? { ...r, permissions: next } : r))
    setPendingCell(cellId)
    try {
      await rbacApi.updateRole(role.role_name, { permissions: next })
    } catch (e: unknown) {
      setCustomRoles(prev => prev.map(r => r.role_name === role.role_name ? { ...r, permissions: previous } : r))
      showToast(errorMessage(e, 'Failed to update permission'))
    }
    setPendingCell(null)
  }

  const createReady = !!form.email.trim() && !!form.name.trim()

  const formRole = modal === 'create' ? (isSuperAdmin ? form.role : 'standard') : (selected?.role ?? 'standard')
  const canSetDepartment = isSuperAdmin || formRole === 'standard'
  const departmentName = (id?: string | null) => departments.find(d => d.department_id === id)?.name

  const recruiterOnly = !isSuperAdmin && users.every(u => u.role === 'standard')
  const activeCount = users.filter(u => u.is_active).length
  const statCards: { key: string; label: string; count: number; tone: string }[] = isSuperAdmin
    ? [
        { key: 'total', label: 'Total Users', count: total, tone: 'total' },
        { key: 'superadmin', label: 'Super Admins', count: users.filter(u => u.role === 'superadmin').length, tone: 'purple' },
        { key: 'admin', label: 'HR Admins', count: users.filter(u => u.role === 'admin').length, tone: 'blue' },
        { key: 'active', label: 'Active', count: activeCount, tone: 'green' },
      ]
    : [
        { key: 'total', label: recruiterOnly ? 'Recruiters' : 'Users', count: total, tone: 'total' },
        { key: 'active', label: 'Active', count: activeCount, tone: 'green' },
        { key: 'inactive', label: 'Inactive', count: users.length - activeCount, tone: 'blue' },
      ]
  const userNoun = recruiterOnly ? 'recruiter' : 'user'

  const hasMore = !exhausted && total > users.length

  const grouped = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const p of permissions) {
      const cat = permCategory(p)
      if (!map.has(cat)) map.set(cat, [])
      map.get(cat)!.push(p)
    }
    return Array.from(map.entries())
  }, [permissions])

  const permQ = permSearch.trim().toLowerCase()
  const filteredGrouped = useMemo(() => {
    if (!permQ) return grouped
    return grouped
      .map(([cat, perms]) => [cat, perms.filter(p => p.toLowerCase().includes(permQ) || cat.toLowerCase().includes(permQ))] as [string, string[]])
      .filter(([, perms]) => perms.length > 0)
  }, [grouped, permQ])

  const totalMatrixCols = 1 + BUILTIN_ROLE_NAMES.length + Math.max(overridable.length, 1)

  const auditTotalPages = Math.max(1, Math.ceil(auditTotal / AUDIT_LIMIT))
  const hasAuditFilters = Object.values(auditApplied).some(Boolean)

  return (
    <div className="um-page ur-page">
      {toast && <div className={`um-toast${toastWarn ? ' um-toast-warn' : ''}`} role={toastWarn ? 'alert' : undefined}>{toast}</div>}

      <div className="page-header">
        <div>
          <div className="page-title">Users &amp; Roles</div>
        </div>
        {tab === 'users' && <button className="btn btn-primary" onClick={openCreate}>+ Add User</button>}
        {tab === 'roles' && (
          <button
            className="btn btn-primary"
            onClick={openCreateRole}
            disabled={!isSuperAdmin}
            title={isSuperAdmin ? undefined : SUPER_ADMIN_ONLY}
          >
            + New Role
          </button>
        )}
        {tab === 'audit' && (
          <button className="btn btn-ghost" onClick={loadAudit} disabled={auditLoading}>
            {auditLoading ? 'Refreshing…' : '↻ Refresh'}
          </button>
        )}
      </div>

      <div className="adm-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === 'users'}
          className={`adm-tab${tab === 'users' ? ' adm-tab-active' : ''}`}
          onClick={() => setTab('users')}
        >
          Users
          {!loading && !usersError && <span className="adm-tab-count">{total}</span>}
        </button>
        <button
          role="tab"
          aria-selected={tab === 'roles'}
          className={`adm-tab${tab === 'roles' ? ' adm-tab-active' : ''}`}
          onClick={() => setTab('roles')}
        >
          Roles &amp; Permissions
          {!loading && <span className="adm-tab-count">{overridable.length}</span>}
        </button>
        <button
          role="tab"
          aria-selected={tab === 'audit'}
          className={`adm-tab${tab === 'audit' ? ' adm-tab-active' : ''}`}
          onClick={() => setTab('audit')}
        >
          Audit Log
          {auditLoaded && !auditErrored && <span className="adm-tab-count">{auditTotal}</span>}
        </button>
      </div>

      {tab === 'users' && (
        <>
          {!usersError && (
            <div className={`um-stats${statCards.length === 3 ? ' um-stats-3' : ''}`}>
              {statCards.map(card => (
                <div key={card.key} className={`um-stat-card um-stat-${card.tone}`}>
                  <div className="um-stat-icon"><StatIcon tone={card.tone} /></div>
                  <span className="um-stat-num">{card.count}</span>
                  <span className="um-stat-label">{card.label}</span>
                </div>
              ))}
            </div>
          )}

          <div className="um-toolbar">
            <div className="um-search-wrap">
              <span className="um-search-icon"><SearchIcon /></span>
              <input
                className="um-search"
                type="text"
                placeholder="Search by name or email…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            {!loading && !usersError && (
              <span className="um-count">
                {users.length} of {total} {userNoun}{total !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          <div className="um-table-wrap card" aria-busy={searching || undefined}>
            {loading ? (
              <div className="um-loading">Loading users…</div>
            ) : usersError ? (
              <div className="um-notice um-notice-error" role="alert">
                <span>{usersError}</span>
                <button className="btn btn-ghost btn-sm" onClick={load}>Retry</button>
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Role</th>
                    <th>Department</th>
                    <th>Status</th>
                    <th>OTP</th>
                    <th>Last Login</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="um-empty">
                        {query ? `No users match "${query}"` : 'No users found.'}
                      </td>
                    </tr>
                  ) : users.map(u => (
                    <tr key={u.email}>
                      <td data-label="User">
                        <div className="um-user-cell">
                          <div className={avatarClass(u.role)}>{initialOf(u.name, u.email)}</div>
                          <div>
                            <div className="um-user-name">{u.name}</div>
                            <div className="um-user-email">{u.email}</div>
                          </div>
                        </div>
                      </td>
                      <td data-label="Role">
                        <span className={roleBadgeClass(u.role)}>{roleLabel(u.role, overridable)}</span>
                      </td>
                      <td className="um-department" data-label="Department">{departmentName(u.department_id) || '-'}</td>
                      <td data-label="Status">
                        <span className={`badge ${u.is_active ? 'badge-green' : 'badge-red'}`}>
                          {u.is_active ? 'Active' : 'Inactive'}
                        </span>
                        {u.invite_pending && <span className="badge badge-blue um-invited">Invited</span>}
                      </td>
                      <td data-label="OTP">
                        <span className={`badge ${u.otp_required ? 'badge-blue' : 'badge-gray'}`}>
                          {u.otp_required ? 'On' : 'Off'}
                        </span>
                        {u.totp_enabled && <span className="badge badge-green um-2fa">2FA</span>}
                      </td>
                      <td className="um-last-login" data-label="Last Login">
                        {u.last_login_at ? new Date(u.last_login_at).toLocaleDateString('en-GB') : '-'}
                      </td>
                      <td data-label="Actions">
                        <div className="um-actions">
                          <button
                            className="um-action-btn um-action-edit"
                            onClick={() => openEdit(u)}
                            disabled={!canManageAccount(u)}
                            title={canManageAccount(u) ? undefined : SUPER_ADMIN_ONLY}
                          >
                            <PencilIcon /> Edit
                          </button>
                          <button
                            className="um-action-btn um-action-reset"
                            onClick={() => openReset(u)}
                            disabled={!canManageAccount(u)}
                            title={canManageAccount(u) ? undefined : SUPER_ADMIN_ONLY}
                          >
                            <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a4 4 0 010 5.657M9 12H3m0 0l3-3m-3 3l3 3" />
                            </svg>
                            Reset PW
                          </button>
                          {u.totp_enabled && (
                            <button
                              className="um-action-btn um-action-totp"
                              onClick={() => handleResetTotp(u)}
                              disabled={!canManageAccount(u) || resettingTotp === u.email}
                              title={canManageAccount(u) ? undefined : SUPER_ADMIN_ONLY}
                            >
                              Reset authenticator
                            </button>
                          )}
                          {u.invite_pending && (
                            <button
                              className="um-action-btn um-action-invite"
                              onClick={() => handleInvite(u)}
                              disabled={!canManageAccount(u) || isSelf(u) || inviting === u.email}
                              title={canManageAccount(u) ? undefined : SUPER_ADMIN_ONLY}
                            >
                              <MailIcon /> Resend invitation
                            </button>
                          )}
                          {isSuperAdmin && (
                            <button
                              className="um-action-btn um-action-delete"
                              onClick={() => handleDelete(u.email)}
                              disabled={isSelf(u)}
                              title={isSelf(u) ? 'You cannot delete your own account' : undefined}
                            >
                              <TrashIcon /> Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {!loading && !usersError && hasMore && (
              <div className="um-more">
                <button type="button" className="btn btn-ghost btn-sm" onClick={loadMore} disabled={moreBusy}>
                  {moreBusy ? 'Loading…' : 'Load more'}
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {tab === 'roles' && (
        <section className="rp-section card">
          <div className="card-header rp-matrix-header">
            <div>
              <span className="card-title">Permission Matrix</span>
              {!loading && permissions.length > 0 && (
                <div className="rp-matrix-meta">
                  {permissions.length} permission{permissions.length === 1 ? '' : 's'} · {grouped.length} categor{grouped.length === 1 ? 'y' : 'ies'} · {overridable.length} custom role{overridable.length === 1 ? '' : 's'}
                </div>
              )}
            </div>
            {!loading && permissions.length > 0 && (
              <label className="rp-search">
                <SearchIcon />
                <input
                  className="rp-search-input"
                  placeholder="Filter permissions…"
                  value={permSearch}
                  onChange={e => setPermSearch(e.target.value)}
                  aria-label="Filter permissions"
                />
              </label>
            )}
          </div>
          {loading ? (
            <MatrixSkeleton />
          ) : permissions.length === 0 ? (
            <div className="rp-empty">No permission catalog returned yet.</div>
          ) : filteredGrouped.length === 0 ? (
            <div className="rp-empty">
              No permissions match &ldquo;{permSearch}&rdquo;.
              <button className="btn btn-ghost btn-sm" onClick={() => setPermSearch('')}>Clear filter</button>
            </div>
          ) : (
            <div className="rp-matrix-wrap">
              <table className="rp-matrix">
                <thead>
                  <tr>
                    <th className="rp-matrix-permcol">Permission</th>
                    {BUILTIN_ROLE_NAMES.map(name => (
                      <th key={name} className="rp-matrix-rolecol rp-matrix-builtin">
                        <div className="rp-matrix-role-head">
                          <span className="rp-matrix-role-name">{BUILTIN_LABELS[name]}</span>
                          <span className="rp-lock-icon" title="Built-in role, permissions are fixed"><LockIcon /></span>
                        </div>
                      </th>
                    ))}
                    {overridable.length > 0 ? overridable.map(r => (
                      <th key={r.role_name} className="rp-matrix-rolecol">
                        <div className="rp-matrix-role-head">
                          <span className="rp-matrix-role-name" title={r.description ? `${r.role_name}, ${r.description}` : r.role_name}>{r.role_name}</span>
                          {typeof r.user_count === 'number' && (
                            <span className="rp-role-count">{r.user_count} user{r.user_count === 1 ? '' : 's'}</span>
                          )}
                          <div className="rp-matrix-role-actions">
                            <button className="rp-icon-btn" title={isSuperAdmin ? 'Edit description' : SUPER_ADMIN_ONLY} aria-label={`Edit ${r.role_name}`} disabled={!isSuperAdmin} onClick={() => openEditRole(r)}><PencilIcon /></button>
                            <button className="rp-icon-btn rp-icon-btn-danger" title={isSuperAdmin ? 'Delete role' : SUPER_ADMIN_ONLY} aria-label={`Delete ${r.role_name}`} disabled={!isSuperAdmin} onClick={() => openDeleteRole(r)}><TrashIcon /></button>
                          </div>
                        </div>
                      </th>
                    )) : (
                      <th className="rp-matrix-rolecol rp-matrix-empty-col">
                        <button
                          className="rp-empty-role-cta"
                          onClick={openCreateRole}
                          disabled={!isSuperAdmin}
                          title={isSuperAdmin ? undefined : SUPER_ADMIN_ONLY}
                        >
                          + Add a custom role
                        </button>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {filteredGrouped.map(([category, perms]) => (
                    <Fragment key={category}>
                      <tr className="rp-category-row">
                        <td colSpan={totalMatrixCols}>{category}</td>
                      </tr>
                      {perms.map(key => (
                        <tr key={key}>
                          <td className="rp-perm-name">
                            {permActionLabel(key)}
                            <div className="rp-perm-desc">{key}</div>
                          </td>
                          {BUILTIN_ROLE_NAMES.map(name => (
                            <td key={name} className="rp-matrix-cell rp-matrix-cell-builtin">
                              <PermCheckbox
                                checked={builtinPermsFor(name).includes(key)}
                                disabled
                                label={`${key}, ${BUILTIN_LABELS[name]} (built-in, read-only)`}
                              />
                            </td>
                          ))}
                          {overridable.length > 0 ? overridable.map(r => {
                            const cellId = `${r.role_name}:${key}`
                            return (
                              <td key={r.role_name} className="rp-matrix-cell">
                                <PermCheckbox
                                  checked={r.permissions.includes(key)}
                                  disabled={!isSuperAdmin || pendingCell === cellId}
                                  onChange={() => togglePermission(r, key)}
                                  label={`${key} for ${r.role_name}`}
                                />
                              </td>
                            )
                          }) : (
                            <td className="rp-matrix-cell rp-matrix-empty-col">-</td>
                          )}
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {tab === 'audit' && (
        <section className="al-section card">
          <div className="al-filters">
            <label className="al-field">
              <span className="form-label">Actor Email</span>
              <input
                className="form-input"
                list="ur-audit-actors"
                value={auditDraft.actor_email}
                onChange={e => setAuditDraft(f => ({ ...f, actor_email: e.target.value }))}
                placeholder="user@company.com"
              />
              <datalist id="ur-audit-actors">
                {auditFacets.actors.map(a => <option key={a} value={a} />)}
              </datalist>
            </label>
            <label className="al-field">
              <span className="form-label">Action</span>
              <input
                className="form-input"
                list="ur-audit-actions"
                value={auditDraft.action}
                onChange={e => setAuditDraft(f => ({ ...f, action: e.target.value }))}
                placeholder="e.g. role_update"
              />
              <datalist id="ur-audit-actions">
                {auditFacets.actions.map(a => <option key={a} value={a} />)}
              </datalist>
            </label>
            <label className="al-field">
              <span className="form-label">Resource Type</span>
              <select
                className="form-input"
                value={auditDraft.resource_type}
                onChange={e => setAuditDraft(f => ({ ...f, resource_type: e.target.value }))}
              >
                <option value="">All resources</option>
                {auditFacets.resource_types.map(t => <option key={t} value={t}>{t}</option>)}
                {auditDraft.resource_type && !auditFacets.resource_types.includes(auditDraft.resource_type) && (
                  <option value={auditDraft.resource_type}>{auditDraft.resource_type}</option>
                )}
              </select>
            </label>
            <label className="al-field">
              <span className="form-label">Resource ID</span>
              <input
                className="form-input"
                value={auditDraft.resource_id}
                onChange={e => setAuditDraft(f => ({ ...f, resource_id: e.target.value }))}
                placeholder="Exact ID"
              />
            </label>
            <label className="al-field">
              <span className="form-label">From</span>
              <input className="form-input" type="date" value={auditDraft.start_date}
                onChange={e => setAuditDraft(f => ({ ...f, start_date: e.target.value }))} />
            </label>
            <label className="al-field">
              <span className="form-label">To</span>
              <input className="form-input" type="date" value={auditDraft.end_date}
                onChange={e => setAuditDraft(f => ({ ...f, end_date: e.target.value }))} />
            </label>
            <div className="al-filter-actions">
              <button className="btn btn-primary btn-sm" onClick={applyAuditFilters}>Apply</button>
              {hasAuditFilters && <button className="btn btn-ghost btn-sm" onClick={clearAuditFilters}>Clear</button>}
            </div>
          </div>

          {auditLoading ? (
            <div className="al-loading">Loading…</div>
          ) : auditErrored ? (
            <div className="al-notice">Could not load the audit log. The endpoint may not be available yet.</div>
          ) : (
            <div className="al-table-wrap">
              <table className="al-table">
                <thead>
                  <tr>
                    <th>Date/Time</th>
                    <th>Actor</th>
                    <th>Action</th>
                    <th>Resource Type</th>
                    <th>Resource ID</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {auditEntries.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="al-empty">
                        {hasAuditFilters ? 'No audit entries match these filters.' : 'No audit entries yet.'}
                      </td>
                    </tr>
                  ) : auditEntries.map((e, idx) => (
                    <tr key={entryId(e, idx)}>
                      <td className="al-time" data-label="Date/Time">{entryTime(e)}</td>
                      <td className="al-actor" data-label="Actor">{entryActor(e)}</td>
                      <td data-label="Action"><span className="badge badge-blue">{entryAction(e)}</span></td>
                      <td data-label="Resource Type">{e.resource_type || '-'}</td>
                      <td className="al-resource-id" data-label="Resource ID">{e.resource_id || '-'}</td>
                      <td className="al-details truncate" data-label="Details" title={entryDetails(e)}>{entryDetails(e) || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!auditLoading && !auditErrored && auditTotalPages > 1 && (
            <div className="al-pagination">
              <button disabled={auditPage === 1} onClick={() => setAuditPage(p => p - 1)} className="al-page-btn">← Prev</button>
              <span className="al-page-info">Page {auditPage} of {auditTotalPages}</span>
              <button disabled={auditPage === auditTotalPages} onClick={() => setAuditPage(p => p + 1)} className="al-page-btn">Next →</button>
            </div>
          )}
        </section>
      )}

      {(modal === 'create' || modal === 'edit') && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal-box um-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{modal === 'create' ? 'Create New User' : `Edit, ${selected?.name}`}</h2>
              <button className="modal-close" onClick={() => setModal(null)}>✕</button>
            </div>
            <div className="um-form">
              {modal === 'create' && (
                <label className="um-field">
                  <span className="form-label">Email *</span>
                  <input className="form-input" type="email" value={form.email}
                    onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    placeholder="user@company.com" />
                </label>
              )}
              <label className="um-field">
                <span className="form-label">Full Name *</span>
                <input className="form-input" value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Jane Smith" />
              </label>
              {isSuperAdmin ? (
                <label className="um-field">
                  <span className="form-label">Role</span>
                  <select className="form-input" value={form.role}
                    disabled={modal === 'edit' && !!selected && isSelf(selected)}
                    onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                    {allRoleOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <span className="adm-field-hint">
                    This is the only place a user&rsquo;s role is assigned.
                    {' '}Permissions for each role are set on the{' '}
                    <button type="button" className="adm-link" onClick={() => { setModal(null); setTab('roles') }}>
                      Roles &amp; Permissions
                    </button>{' '}tab.
                  </span>
                </label>
              ) : modal === 'create' && (
                <div className="um-field">
                  <span className="form-label">Role</span>
                  <span className={roleBadgeClass('standard')}>{BUILTIN_LABELS.standard}</span>
                </div>
              )}
              <label className="um-field">
                <span className="form-label">Department</span>
                <select className="form-input" value={form.department_id}
                  disabled={!canSetDepartment}
                  title={canSetDepartment ? undefined : SUPER_ADMIN_ONLY}
                  onChange={e => setForm(f => ({ ...f, department_id: e.target.value }))}>
                  <option value="">No department</option>
                  {departments.map(d => <option key={d.department_id} value={d.department_id}>{d.name}</option>)}
                </select>
              </label>
              {modal === 'create' && !form.send_invite && (
                <div className="um-field">
                  <label className="form-label" htmlFor="um-create-password">Password</label>
                  <input id="um-create-password" className="form-input" type="password" value={form.password}
                    onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                    aria-describedby={passwordHint ? 'um-create-password-hint' : undefined}
                    placeholder="Leave blank to send an invitation" />
                  {passwordHint && <span className="adm-field-hint" id="um-create-password-hint">{passwordHint}</span>}
                </div>
              )}
              <div className="um-toggles">
                {modal === 'create' && (
                  <label className="um-toggle">
                    <input type="checkbox" checked={form.send_invite}
                      onChange={e => setForm(f => ({ ...f, send_invite: e.target.checked }))} />
                    <span>Send an invitation email instead</span>
                  </label>
                )}
                {modal === 'edit' && (
                  <label className="um-toggle">
                    <input type="checkbox" checked={form.is_active}
                      disabled={!!selected && isSelf(selected)}
                      onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />
                    <span>Active account</span>
                  </label>
                )}
                <label className="um-toggle">
                  <input type="checkbox" checked={form.otp_required}
                    onChange={e => setForm(f => ({ ...f, otp_required: e.target.checked }))} />
                  <span>Require OTP on login</span>
                </label>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setModal(null)}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={modal === 'create' ? handleCreate : handleEdit}
                disabled={saving || (modal === 'create' ? !createReady : !form.name.trim())}
              >
                {saving ? 'Saving…' : modal === 'create' ? 'Create User' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {modal === 'reset' && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal-box um-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Reset Password, {selected?.name}</h2>
              <button className="modal-close" onClick={() => setModal(null)}>✕</button>
            </div>
            <div className="um-form">
              <div className="um-field">
                <label className="form-label" htmlFor="um-reset-password">New Password</label>
                <input id="um-reset-password" className="form-input" type="password" value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  aria-describedby={passwordHint ? 'um-reset-password-hint' : undefined}
                  placeholder="Enter new password" autoFocus />
                {passwordHint && <span className="adm-field-hint" id="um-reset-password-hint">{passwordHint}</span>}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleResetPassword} disabled={saving || !newPassword.trim()}>
                {saving ? 'Resetting…' : 'Reset Password'}
              </button>
            </div>
          </div>
        </div>
      )}

      {roleModal && (
        <div className="modal-overlay" onClick={() => setRoleModal(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{roleModal === 'create' ? 'New Role' : `Edit, ${roleSelected?.role_name ?? ''}`}</h2>
              <button className="modal-close" onClick={() => setRoleModal(null)}>✕</button>
            </div>
            <div className="rp-form">
              <label className="rp-field">
                <span className="form-label">Name{roleModal === 'create' ? ' *' : ''}</span>
                <input className="form-input" value={roleForm.name}
                  disabled={roleModal === 'edit'}
                  onChange={e => setRoleForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. hiring_manager" />
                {roleModal === 'edit' && (
                  <span className="adm-field-hint">A role cannot be renamed after creation.</span>
                )}
              </label>
              <label className="rp-field">
                <span className="form-label">Description</span>
                <input className="form-input" value={roleForm.description}
                  onChange={e => setRoleForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Optional" />
              </label>
              {roleModal === 'create' && (
                <div className="rp-hint">The role is created with no permissions. Toggle its checkboxes in the matrix afterward.</div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setRoleModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveRole} disabled={saving || !roleForm.name.trim()}>
                {saving ? 'Saving…' : roleModal === 'create' ? 'Create' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {roleToDelete && (
        <div className="modal-overlay" onClick={() => setRoleToDelete(null)}>
          <div className="modal-box" role="dialog" aria-label={`Delete ${roleToDelete.role_name}`} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Delete, {roleToDelete.role_name}</h2>
              <button className="modal-close" onClick={() => setRoleToDelete(null)}>✕</button>
            </div>
            <div className="rp-form">
              <p className="rp-delete-sentence">Delete the role &ldquo;{roleToDelete.role_name}&rdquo;? This cannot be undone.</p>
              {deleteHolders > 0 && (
                <label className="rp-field">
                  <span className="form-label">
                    {deleteHolders} user{deleteHolders === 1 ? '' : 's'} hold{deleteHolders === 1 ? 's' : ''} this role. Move them to *
                  </span>
                  <select className="form-input" value={reassignTo} onChange={e => setReassignTo(e.target.value)}>
                    <option value="">Select a role</option>
                    {allRoleOptions
                      .filter(o => o.value !== roleToDelete.role_name)
                      .map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
              )}
              {deleteError && <div className="rp-delete-error" role="alert">{deleteError}</div>}
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setRoleToDelete(null)}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={confirmDeleteRole}
                disabled={saving || (deleteHolders > 0 && !reassignTo)}
              >
                {saving ? 'Deleting…' : 'Delete Role'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
