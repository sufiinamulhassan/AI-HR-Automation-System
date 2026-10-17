import { useEffect, useState } from 'react'
import { intelApi, jobsApi, systemApi } from '../../../lib/api'
import { API_BASE } from '../../../lib/config'
import ModelTasksSection from './ModelTasksSection'
import '../SystemSettingsPage.css'

interface LiveCheckResult {
  key: string
  label: string
  ok: boolean
  detail: string
  latency_ms: number
}

interface LiveCheck {
  checked_at: string
  results: LiveCheckResult[]
}

function errorDetail(e: unknown, fallback: string): string {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  return typeof detail === 'string' && detail.trim() ? detail : fallback
}

export default function SystemPanel({ showToast }: { showToast: (msg: string) => void }) {
  const [stats, setStats] = useState<Record<string, number>>({})
  const [loadingStats, setLoadingStats] = useState(true)
  const [healthStatus, setHealthStatus] = useState<'loading' | 'ok' | 'error'>('loading')
  const [healthModules, setHealthModules] = useState<string[]>([])
  const [platformVersion, setPlatformVersion] = useState('-')

  const [checking, setChecking] = useState(false)
  const [liveCheck, setLiveCheck] = useState<LiveCheck | null>(null)
  const [liveError, setLiveError] = useState('')

  async function checkHealth() {
    try {
      const r = await systemApi.health()
      setHealthStatus(r.data.status === 'ok' ? 'ok' : 'error')
      setHealthModules(r.data.modules || [])
      const version = r.data.version
      setPlatformVersion(
        typeof version === 'string' && version.trim() ? version.trim()
          : typeof version === 'number' ? String(version)
          : '-',
      )
    } catch {
      setHealthStatus('error')
    }
  }

  async function runLiveCheck() {
    setChecking(true)
    setLiveError('')
    try {
      const r = await systemApi.liveCheck()
      setLiveCheck({ checked_at: r.data.checked_at, results: r.data.results ?? [] })
    } catch (e) {
      const status = (e as { response?: { status?: number } })?.response?.status
      setLiveError(errorDetail(e, status === 429 ? 'Too many checks. Try again shortly.' : 'The live check could not run.'))
    }
    setChecking(false)
  }

  async function loadStats() {
    setLoadingStats(true)
    try {
      const [resumeR, jobsR] = await Promise.allSettled([
        intelApi.stats(),
        jobsApi.stats(),
      ])
      setStats({
        resumes: resumeR.status === 'fulfilled' ? (resumeR.value.data.total || 0) : 0,
        hired:   resumeR.status === 'fulfilled' ? (resumeR.value.data.invite_funnel?.hired || 0) : 0,
        jobs:    jobsR.status === 'fulfilled' ? (jobsR.value.data.total || 0) : 0,
      })
    } catch { }
    setLoadingStats(false)
  }

  useEffect(() => {
    checkHealth()
    loadStats()
  }, [])

  const checkedTime = liveCheck ? new Date(liveCheck.checked_at) : null
  const checkedAt = checkedTime && !Number.isNaN(checkedTime.getTime()) ? checkedTime.toLocaleTimeString() : ''

  const healthColor =
    healthStatus === 'ok' ? '#10b981' :
    healthStatus === 'error' ? '#ef4444' :
    'var(--gray-400)'

  return (
    <>
      <section className="ss-section ps-section">
        <div className="ss-section-title">Platform Overview</div>
        <div className="ss-stats-grid">
          <div className="ss-stat-card">
            <div className="ss-stat-icon ss-icon-blue">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="#2563eb" fillOpacity="0.16" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                <polyline points="14 2 14 8 20 8" fill="none" />
              </svg>
            </div>
            <div className="ss-stat-body">
              <div className="ss-stat-num">{loadingStats ? '…' : stats.resumes ?? 0}</div>
              <div className="ss-stat-label">Processed Resumes</div>
            </div>
          </div>
          <div className="ss-stat-card">
            <div className="ss-stat-icon ss-icon-green">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="#10b981" fillOpacity="0.16" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="7" width="20" height="14" rx="2" />
                <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" fill="none" />
              </svg>
            </div>
            <div className="ss-stat-body">
              <div className="ss-stat-num">{loadingStats ? '…' : stats.jobs ?? 0}</div>
              <div className="ss-stat-label">Job Descriptions</div>
            </div>
          </div>
          <div className="ss-stat-card">
            <div className="ss-stat-icon ss-icon-purple">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="var(--secondary)" fillOpacity="0.16" stroke="var(--secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" fill="none" />
                <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" fill="none" />
                <path d="M4 22h16" fill="none" />
                <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" fill="none" />
                <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" fill="none" />
                <path d="M18 2H6v7a6 6 0 0 0 12 0V2z" />
              </svg>
            </div>
            <div className="ss-stat-body">
              <div className="ss-stat-num">{loadingStats ? '…' : stats.hired ?? 0}</div>
              <div className="ss-stat-label">Candidates Hired</div>
            </div>
          </div>
        </div>
      </section>

      <ModelTasksSection showToast={showToast} />

      <section className="ss-section ps-section">
        <div className="ss-section-title">Environment</div>
        <div className="ss-card card">
          <div className="ss-env-grid">
            <div className="ss-env-row">
              <span className="ss-env-key">Backend Status</span>
              <span className="ss-env-val" style={{ color: healthColor, fontWeight: 600 }}>
                {healthStatus === 'loading' && '…'}
                {healthStatus === 'ok' && '✓ Online'}
                {healthStatus === 'error' && '✗ Offline'}
              </span>
            </div>
            {healthModules.length > 0 && (
              <div className="ss-env-row">
                <span className="ss-env-key">Active Modules</span>
                <span className="ss-env-val">{healthModules.join(', ')}</span>
              </div>
            )}
            <div className="ss-env-row">
              <span className="ss-env-key">API Base URL</span>
              <span className="ss-env-val">{API_BASE || `${window.location.origin} (same origin)`}</span>
            </div>
            <div className="ss-env-row">
              <span className="ss-env-key">API Version</span>
              <span className="ss-env-val">v1</span>
            </div>
            <div className="ss-env-row">
              <span className="ss-env-key">Platform Version</span>
              <span className="ss-env-val">{platformVersion}</span>
            </div>
          </div>
        </div>
      </section>

      <section className="ss-section ps-section">
        <div className="ss-section-title">Live Check</div>
        <div className="ss-card card">
          <div className="ss-live-bar">
            <button className="btn btn-primary btn-sm" onClick={runLiveCheck} disabled={checking}>
              {checking ? 'Checking…' : 'Run live check'}
            </button>
            {checkedAt && !liveError && <span className="ss-live-checked">{checkedAt}</span>}
          </div>
          {liveError && <div className="ss-live-error" role="alert">{liveError}</div>}
          {liveCheck && (
            <ul className="ss-live-list">
              {liveCheck.results.map(r => (
                <li key={r.key} className="ss-live-row">
                  <span className="ss-live-label">{r.label}</span>
                  <span className={`badge ${r.ok ? 'badge-green' : 'badge-red'}`}>{r.ok ? 'OK' : 'Failed'}</span>
                  <span className="ss-live-latency">{r.latency_ms} ms</span>
                  <span className="ss-live-detail">{r.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </>
  )
}
