import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { Component, Suspense, lazy, type ReactNode } from 'react'
import { useAuthStore } from './store/auth.store'
import BrandingProvider from './components/BrandingProvider'
import DemoNotice from './components/DemoNotice'
import PlatformRoute from './components/PlatformRoute'
import SiteLayout from './components/site/SiteLayout'

class RouteErrorBoundary extends Component<{ children: ReactNode }, { crashed: boolean }> {
  state = { crashed: false }
  static getDerivedStateFromError() { return { crashed: true } }
  componentDidCatch(error: Error) { console.error('Page crashed:', error) }
  render() {
    if (this.state.crashed)
      return (
        <div role="alert" style={{ padding: '2rem', color: '#b91c1c', fontSize: '.95rem' }}>
          <strong>Something went wrong on this page.</strong>
          <br /><button style={{ marginTop: '1rem', cursor: 'pointer' }} onClick={() => this.setState({ crashed: false })}>Try again</button>
        </div>
      )
    return this.props.children
  }
}

function RoutedBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  return <RouteErrorBoundary key={pathname}>{children}</RouteErrorBoundary>
}
import Landing from './pages/Landing'
import Login from './pages/Login'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
const Interview = lazy(() => import('./pages/interview/InterviewPage'))
import OfferAcceptance from './pages/OfferAcceptance'
import CodingAssessment from './pages/CodingAssessment'
import SsoCallback from './pages/SsoCallback'
import PublicReviewPage from './pages/performance/PublicReviewPage'
import SharedReportPage from './pages/SharedReportPage'
import InterviewerScorecardPage from './pages/interview/InterviewerScorecardPage'
import DashboardLayout from './components/layout/DashboardLayout'
import PlatformLayout from './components/layout/PlatformLayout'
import DashboardOverview from './modules/m1-hrbot/pages/DashboardOverview'
import HRBotDashboard from './modules/m1-hrbot/pages/HRBotDashboard'
import ResumesPage from './modules/m1-hrbot/pages/ResumesPage'
import ActivityPage from './pages/ActivityPage'
import UsersRolesPage from './pages/admin/UsersRolesPage'
import PlatformSettingsPage from './pages/admin/PlatformSettingsPage'
import OrganizationPage from './pages/admin/OrganizationPage'
import InterviewAutomationPage from './pages/admin/InterviewAutomationPage'
import PerformancePage from './pages/performance/PerformancePage'
import ApiReferencePage from './pages/ApiReferencePage'
import ProfilePage from './pages/ProfilePage'
const FeaturesPage = lazy(() => import('./pages/site/FeaturesPage'))
const PricingPage = lazy(() => import('./pages/site/PricingPage'))
const SecurityPage = lazy(() => import('./pages/site/SecurityPage'))
const ResponsibleAiPage = lazy(() => import('./pages/site/ResponsibleAiPage'))
const AboutPage = lazy(() => import('./pages/site/AboutPage'))
const ContactPage = lazy(() => import('./pages/site/ContactPage'))
const FaqPage = lazy(() => import('./pages/site/FaqPage'))
const CandidatesPage = lazy(() => import('./pages/site/CandidatesPage'))
const TrustPage = lazy(() => import('./pages/site/TrustPage'))
const RoiCalculatorPage = lazy(() => import('./pages/site/RoiCalculatorPage'))
const IntegrationsHub = lazy(() => import('./pages/site/IntegrationsSection').then(m => ({ default: m.IntegrationsHub })))
const IntegrationDetail = lazy(() => import('./pages/site/IntegrationsSection').then(m => ({ default: m.IntegrationDetail })))
const CompareHub = lazy(() => import('./pages/site/CompareSection').then(m => ({ default: m.CompareHub })))
const ComparisonDetail = lazy(() => import('./pages/site/CompareSection').then(m => ({ default: m.ComparisonDetail })))
const LegalPage = lazy(() => import('./pages/legal/LegalPage'))
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'))
const CareersLayout = lazy(() => import('./pages/careers/CareersLayout'))
const CareersPage = lazy(() => import('./pages/careers/CareersPage'))
const JobPage = lazy(() => import('./pages/careers/JobPage'))
const UserGuidePage = lazy(() => import('./pages/guide/UserGuidePage'))
const PlatformOverviewPage = lazy(() => import('./pages/platform/PlatformOverviewPage'))
const PlatformClientsPage = lazy(() => import('./pages/platform/PlatformClientsPage'))
const PlatformClientDetailPage = lazy(() => import('./pages/platform/PlatformClientDetailPage'))
const PlatformUsagePage = lazy(() => import('./pages/platform/PlatformUsagePage'))
const PlatformAiPage = lazy(() => import('./pages/platform/PlatformAiPage'))
const PlatformBillingPage = lazy(() => import('./pages/platform/PlatformBillingPage'))
const PlatformCompanyDetailPage = lazy(() => import('./pages/platform/PlatformCompanyDetailPage'))
const PlatformOwnersPage = lazy(() => import('./pages/platform/PlatformOwnersPage'))
const PlatformHealthPage = lazy(() => import('./pages/platform/PlatformHealthPage'))
const PlatformAuditPage = lazy(() => import('./pages/platform/PlatformAuditPage'))
const PlatformInboxPage = lazy(() => import('./pages/platform/PlatformInboxPage'))

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
  const user = useAuthStore(s => s.user)
  if (!user) return <Navigate to="/login" replace />
  if (user.role !== 'admin' && user.role !== 'superadmin') return <Navigate to="/dashboard" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <BrowserRouter>
    <BrandingProvider>
      <DemoNotice />
      <RoutedBoundary>
      <Routes>
        <Route element={<SiteLayout />}>
          <Route path="/" element={<Landing />} />
          <Route path="/features" element={<FeaturesPage />} />
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/security" element={<SecurityPage />} />
          <Route path="/responsible-ai" element={<ResponsibleAiPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/contact" element={<ContactPage />} />
          <Route path="/faq" element={<FaqPage />} />
          <Route path="/candidates" element={<CandidatesPage />} />
          <Route path="/trust" element={<TrustPage />} />
          <Route path="/roi-calculator" element={<RoiCalculatorPage />} />
          <Route path="/integrations" element={<IntegrationsHub />} />
          <Route path="/integrations/:slug" element={<IntegrationDetail />} />
          <Route path="/compare" element={<CompareHub />} />
          <Route path="/compare/:slug" element={<ComparisonDetail />} />
          <Route path="/terms" element={<LegalPage slug="terms" />} />
          <Route path="/privacy" element={<LegalPage slug="privacy" />} />
          <Route path="/candidate-privacy" element={<LegalPage slug="candidate-privacy" />} />
          <Route path="/cookies" element={<LegalPage slug="cookies" />} />
          <Route path="/acceptable-use" element={<LegalPage slug="acceptable-use" />} />
          <Route path="/dpa" element={<LegalPage slug="dpa" />} />
          <Route path="/subprocessors" element={<LegalPage slug="subprocessors" />} />
          <Route path="/accessibility" element={<LegalPage slug="accessibility" />} />
          <Route path="/careers" element={<CareersLayout />}>
            <Route index element={<CareersPage />} />
            <Route path=":jobId" element={<JobPage />} />
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Route>
        <Route path="/login" element={<Login />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/interview/:token" element={
          <Suspense fallback={<div style={{ padding: '3rem', textAlign: 'center', color: '#6b7280' }}>Loading interview…</div>}>
            <Interview />
          </Suspense>
        } />
        <Route path="/offer/:token" element={<OfferAcceptance />} />
        <Route path="/coding/:token" element={<CodingAssessment />} />
        <Route path="/performance-review/:token" element={<PublicReviewPage />} />
        <Route path="/report/shared/:token" element={<SharedReportPage />} />
        <Route path="/interviewer/:token" element={<InterviewerScorecardPage />} />
        <Route path="/sso-callback" element={<SsoCallback />} />

        <Route path="/dashboard" element={
          <PrivateRoute>
            <DashboardLayout />
          </PrivateRoute>
        }>
          <Route index element={<DashboardOverview />} />
          <Route path="hrbot" element={<HRBotDashboard />} />
          <Route path="resumes" element={<ResumesPage />} />

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
          <Route path="prompt-config" element={<Navigate to="/dashboard/settings" replace />} />
          <Route path="email-templates" element={<Navigate to="/dashboard/settings?tab=email" replace />} />
          <Route path="performance" element={<PerformancePage />} />
          <Route path="api-reference" element={<ApiReferencePage />} />

          <Route path="profile" element={<ProfilePage />} />
          <Route path="guide" element={
            <Suspense fallback={<div style={{ padding: '3rem', textAlign: 'center', color: '#6b7280' }}>Loading guide…</div>}>
              <UserGuidePage />
            </Suspense>
          } />
        </Route>

        <Route path="/platform" element={
          <PlatformRoute>
            <PlatformLayout />
          </PlatformRoute>
        }>
          <Route index element={<PlatformOverviewPage />} />
          <Route path="clients" element={<PlatformClientsPage />} />
          <Route path="clients/:clientId" element={<PlatformClientDetailPage />} />
          <Route path="companies/:companyId" element={<PlatformCompanyDetailPage />} />
          <Route path="usage" element={<PlatformUsagePage />} />
          <Route path="ai" element={<PlatformAiPage />} />
          <Route path="billing" element={<PlatformBillingPage />} />
          <Route path="health" element={<PlatformHealthPage />} />
          <Route path="audit" element={<PlatformAuditPage />} />
          <Route path="inbox" element={<PlatformInboxPage />} />
          <Route path="owners" element={<PlatformOwnersPage />} />
          <Route path="*" element={<Navigate to="/platform" replace />} />
        </Route>

      </Routes>
      </RoutedBoundary>
    </BrandingProvider>
    </BrowserRouter>
  )
}
