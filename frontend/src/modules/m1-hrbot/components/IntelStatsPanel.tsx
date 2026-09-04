import './IntelStatsPanel.css'

export interface IntelStats {
  total?: number
  by_domain?: Record<string, number>
  by_seniority?: Record<string, number>
  invite_funnel?: {
    auto_invited?: number
    manually_invited?: number
    interviewed?: number
    hired?: number
  }
}

interface Props {
  stats: IntelStats
  loading?: boolean
  onBulkUpload: () => void
  onCreateJob: () => void
}

export default function IntelStatsPanel({ stats, loading, onBulkUpload, onCreateJob }: Props) {
  const funnel = stats.invite_funnel ?? {}
  const domains = Object.entries(stats.by_domain ?? {}).sort(([, a], [, b]) => b - a)
  const seniorities = Object.entries(stats.by_seniority ?? {}).sort(([, a], [, b]) => b - a)
  const maxDomain = domains.length ? Math.max(...domains.map(([, v]) => v)) : 1
  const maxSeniority = seniorities.length ? Math.max(...seniorities.map(([, v]) => v)) : 1

  const FUNNEL: [string, number | undefined, string][] = [
    ['Total Resumes',     stats.total,              'total'],
    ['Auto-Invited',      funnel.auto_invited,       'auto'],
    ['Manually Invited',  funnel.manually_invited,   'manual'],
    ['Interviewed',       funnel.interviewed,        'interviewed'],
    ['Hired',             funnel.hired,              'hired'],
  ]

  return (
    <div className="intel-panel">
      <div className="intel-header">
        <div>
          <h2 className="intel-title">Resume Intelligence</h2>
          <p className="intel-subtitle">
            Pool statistics · Auto-invite funnel · Domain &amp; seniority breakdown
          </p>
        </div>
        <div className="intel-header-actions">
          <button className="btn-ghost intel-action-btn" onClick={onCreateJob}>+ New JD</button>
          <button className="btn-primary intel-action-btn" onClick={onBulkUpload}>Bulk Upload</button>
        </div>
      </div>

      {loading ? (
        <div className="intel-loading">Loading statistics…</div>
      ) : (
        <>
          <div className="intel-funnel">
            {FUNNEL.map(([label, value, key], i) => (
              <>
                <div key={key} className={`intel-funnel-tile intel-tile-${key}`}>
                  <div className="intel-tile-val">{(value ?? 0).toLocaleString()}</div>
                  <div className="intel-tile-label">{label}</div>
                </div>
                {i < FUNNEL.length - 1 && (
                  <div key={`sep-${i}`} className="intel-funnel-sep">→</div>
                )}
              </>
            ))}
          </div>

          {(domains.length > 0 || seniorities.length > 0) && (
            <div className="intel-charts">

              {domains.length > 0 && (
                <div className="intel-chart-card">
                  <h4 className="intel-chart-title">By Domain</h4>
                  <div className="intel-bars">
                    {domains.map(([domain, count]) => (
                      <div key={domain} className="intel-bar-row">
                        <div className="intel-bar-label" title={domain}>{domain}</div>
                        <div className="intel-bar-track">
                          <div
                            className="intel-bar-fill"
                            style={{ width: `${(count / maxDomain) * 100}%` }}
                          />
                        </div>
                        <div className="intel-bar-count">{count}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {seniorities.length > 0 && (
                <div className="intel-chart-card">
                  <h4 className="intel-chart-title">By Seniority</h4>
                  <div className="intel-seniority-grid">
                    {seniorities.map(([level, count]) => (
                      <div key={level} className={`intel-sen-tile intel-sen-${level}`}>
                        <div className="intel-sen-count">{count}</div>
                        <div className="intel-sen-bar-wrap">
                          <div
                            className="intel-sen-bar"
                            style={{ height: `${Math.max(4, (count / maxSeniority) * 56)}px` }}
                          />
                        </div>
                        <div className="intel-sen-label">{level}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {!stats.total && (
            <div className="intel-empty">
              <p>No resume data yet. Upload resumes to see pool statistics.</p>
              <button className="btn-primary" onClick={onBulkUpload}>Upload Resumes</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
