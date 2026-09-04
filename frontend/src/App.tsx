import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { Component, Suspense, lazy, type ReactNode } from 'react'
import { useAuthStore } from './store/auth.store'
import BrandingProvider from './components/BrandingProvider'

class RouteErrorBoundary extends Component<{ children: ReactNode }, { crashed: boolean; msg: string }> {
  state = { crashed: false, msg: '' }
  static getDerivedStateFromError(e: Error) { return { crashed: true, msg: e.message } }
  render() {
    if (this.state.crashed)
      return (
        <div style={{ padding: '2rem', color: '#ef4444', fontFamily: 'monospace', fontSize: '.85rem' }}>
          <strong>Page error:</strong> {this.state.msg}
          <br /><button style={{ marginTop: '1rem', cursor: 'pointer' }} onClick={() => this.setState({ crashed: false, msg: '' })}>Retry</button>
        </div>
      )
    return this.props.children
  }
}
import Landing from './pages/Landing'
import Login from './pages/Login'
const Interview = lazy(() => import('./pages/interview/InterviewPage'))
import OfferAcceptance from './pages/OfferAcceptance'
import CodingAssessment from './pages/CodingAssessment'
import SsoCallback from './pages/SsoCallback'
import DashboardLayout from './components/layout/DashboardLayout'
import DashboardOverview from './modules/m1-hrbot/pages/DashboardOverview'
import HRBotDashboard from './modules/m1-hrbot/pages/HRBotDashboard'
import ActivityPage from './pages/ActivityPage'
import UsersRolesPage from './pages/admin/UsersRolesPage'
import PlatformSettingsPage from './pages/admin/PlatformSettingsPage'
import OrganizationPage from './pages/admin/OrganizationPage'
import InterviewAutomationPage from './pages/admin/InterviewAutomationPage'
import ApiReferencePage from './pages/ApiReferencePage'
import ProfilePage from './pages/ProfilePage'
const UserGuidePage = lazy(() => import('./pages/guide/UserGuidePage'))

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const token = useAuthStore(s => s.token)
  return token ? <>{children}</> : <Navigate to="/login" replace />
}

function RedirectToTab({ tab }: { tab: string }) {
  const params = new URLSearchParams(useLocation().search)
  params.set('tab', tab)
  return <Navigate to={`/dashboard/interview-automation?${params.toString()}`} replace />
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const user = useAuthStore(s => s.user) as Record<string, string> | null
  if (!user) return <Navigate to="/login" replace />
  if (user.role !== 'admin' && user.role !== 'superadmin') return <Navigate to="/dashboard" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <BrandingProvider>
    <BrowserRouter>
      <RouteErrorBoundary>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/interview/:token" element={
          <Suspense fallback={<div style={{ padding: '3rem', textAlign: 'center', color: '#6b7280' }}>Loading interview…</div>}>
            <Interview />
          </Suspense>
        } />
        <Route path="/offer/:token" element={<OfferAcceptance />} />
        <Route path="/coding/:token" element={<CodingAssessment />} />
        <Route path="/sso-callback" element={<SsoCallback />} />

        <Route path="/dashboard" element={
          <PrivateRoute>
            <DashboardLayout />
          </PrivateRoute>
        }>
          <Route index element={<DashboardOverview />} />
          <Route path="hrbot" element={<HRBotDashboard />} />

          <Route path="activity" element={<ActivityPage />} />

          <Route path="users" element={
            <AdminRoute>
              <UsersRolesPage />
            </AdminRoute>
          } />
          <Route path="roles" element={<Navigate to="/dashboard/users?tab=roles" replace />} />
          <Route path="audit-log" element={<Navigate to="/dashboard/users?tab=audit" replace />} />
          <Route path="settings" element={
            <AdminRoute>
              <PlatformSettingsPage />
            </AdminRoute>
          } />
          <Route path="organization" element={
            <AdminRoute>
              <OrganizationPage />
            </AdminRoute>
          } />
          <Route path="company-settings" element={<Navigate to="/dashboard/organization" replace />} />
          <Route path="branding" element={<Navigate to="/dashboard/organization?tab=branding" replace />} />
          <Route path="departments" element={<Navigate to="/dashboard/organization?tab=departments" replace />} />
          <Route path="interview-automation" element={
            <AdminRoute>
              <InterviewAutomationPage />
            </AdminRoute>
          } />
          <Route path="scenarios" element={<RedirectToTab tab="scenarios" />} />
          <Route path="workflows" element={<RedirectToTab tab="workflows" />} />
          <Route path="coding-questions" element={<RedirectToTab tab="questions" />} />
          <Route path="coding-submissions" element={<RedirectToTab tab="submissions" />} />
          <Route path="webhooks" element={<Navigate to="/dashboard/settings?tab=webhooks" replace />} />
          <Route path="prompt-config" element={<Navigate to="/dashboard/settings?tab=prompts" replace />} />
          <Route path="email-templates" element={<Navigate to="/dashboard/settings?tab=email" replace />} />
          <Route path="api-reference" element={<ApiReferencePage />} />

          <Route path="profile" element={<ProfilePage />} />
          <Route path="guide" element={
            <Suspense fallback={<div style={{ padding: '3rem', textAlign: 'center', color: '#6b7280' }}>Loading guide…</div>}>
              <UserGuidePage />
            </Suspense>
          } />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </RouteErrorBoundary>
    </BrowserRouter>
    </BrandingProvider>
  )
}
