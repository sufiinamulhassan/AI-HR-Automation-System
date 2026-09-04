import { useEffect, useState } from 'react'
import { authApi, intelApi, jobsApi, systemApi } from '../../../lib/api'
import { API_BASE } from '../../../lib/config'
import { useModelStore } from '../../../store/model.store'
import '../SystemSettingsPage.css'

export default function SystemPanel({ showToast }: { showToast: (msg: string) => void }) {
  const { activeModel, availableModels, setActiveModel, setAvailableModels } = useModelStore()
  const [stats, setStats] = useState<Record<string, number>>({})
  const [loadingModels, setLoadingModels] = useState(true)
  const [loadingStats, setLoadingStats] = useState(true)
  const [saving, setSaving] = useState(false)
  const [healthStatus, setHealthStatus] = useState<'loading' | 'ok' | 'error'>('loading')
  const [healthModules, setHealthModules] = useState<string[]>([])

  async function checkHealth() {
    try {
      const r = await systemApi.health()
      setHealthStatus(r.data.status === 'ok' ? 'ok' : 'error')
      setHealthModules(r.data.modules || [])
    } catch {
      setHealthStatus('error')
    }
  }

  async function loadModels() {
    setLoadingModels(true)
    try {
      const r = await authApi.listModels()
      const models = (r.data.models ?? []).map((m: { id: string; label?: string; name?: string; provider: string }) => ({
        id: m.id,
        label: m.label ?? m.name ?? m.id,
        provider: m.provider ?? '',
      }))
      setAvailableModels(models)
      if (r.data.current) setActiveModel(r.data.current)
    } catch {}
    setLoadingModels(false)
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
    } catch {}
    setLoadingStats(false)
  }

  useEffect(() => {
    checkHealth()
    loadModels()
    loadStats()
  }, [])

  async function handleSetModel(id: string) {
    setSaving(true)
    setActiveModel(id)
    try {
      await authApi.setDefaultModel(id)
      showToast('Default model updated')
    } catch {
      showToast('Failed to update model')
    }
    setSaving(false)
  }

  const currentModel = availableModels.find(m => m.id === activeModel)

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
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
            </div>
            <div className="ss-stat-body">
              <div className="ss-stat-num">{loadingStats ? '…' : stats.resumes ?? 0}</div>
              <div className="ss-stat-label">Processed Resumes</div>
            </div>
          </div>
          <div className="ss-stat-card">
            <div className="ss-stat-icon ss-icon-green">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="7" width="20" height="14" rx="2" />
                <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
              </svg>
            </div>
            <div className="ss-stat-body">
              <div className="ss-stat-num">{loadingStats ? '…' : stats.jobs ?? 0}</div>
              <div className="ss-stat-label">Job Descriptions</div>
            </div>
          </div>
          <div className="ss-stat-card">
            <div className="ss-stat-icon ss-icon-purple">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4778f3" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
                <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
                <path d="M4 22h16" />
                <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
                <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
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

      <section className="ss-section ps-section">
        <div className="ss-section-title">AI Model Configuration</div>
        <div className="ss-card card">
          <div className="card-header">
            <span className="card-title">Default LLM Model</span>
            {currentModel && (
              <span className="badge badge-blue">{currentModel.provider}</span>
            )}
          </div>
          <div className="ss-model-body">
            {loadingModels ? (
              <div className="ss-loading">Loading available models…</div>
            ) : availableModels.length === 0 ? (
              <div className="ss-empty-models">No models available. Check backend connection.</div>
            ) : (
              <div className="ss-model-grid">
                {availableModels.map(m => (
                  <button
                    key={m.id}
                    className={`ss-model-card${activeModel === m.id ? ' selected' : ''}`}
                    onClick={() => handleSetModel(m.id)}
                    disabled={saving}
                  >
                    <div className="ss-model-icon">
                      {m.provider === 'openai' ? (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                        </svg>
                      ) : m.provider === 'anthropic' ? (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4778f3" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <rect width="16" height="12" x="4" y="8" rx="2" />
                          <path d="M12 8V4H8" />
                          <path d="M2 14h2" />
                          <path d="M20 14h2" />
                          <path d="M15 13v2" />
                          <path d="M9 13v2" />
                        </svg>
                      ) : (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1 0-3.12 3 3 0 0 1 0-4.88 2.5 2.5 0 0 1 0-3.12A2.5 2.5 0 0 1 9.5 2z" />
                          <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 0-3.12 3 3 0 0 0 0-4.88 2.5 2.5 0 0 0 0-3.12A2.5 2.5 0 0 0 14.5 2z" />
                        </svg>
                      )}
                    </div>
                    <div className="ss-model-info">
                      <div className="ss-model-name">{m.label}</div>
                      <div className="ss-model-id">{m.id}</div>
                      <div className="ss-model-provider">{m.provider}</div>
                    </div>
                    {activeModel === m.id && (
                      <div className="ss-model-check">✓ Active</div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

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
              <span className="ss-env-val">v3.0</span>
            </div>
            <div className="ss-env-row">
              <span className="ss-env-key">Current Model</span>
              <span className="ss-env-val">{activeModel || '-'}</span>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
