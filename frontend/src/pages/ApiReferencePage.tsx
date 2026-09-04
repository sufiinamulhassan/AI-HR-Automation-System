import { useState, useMemo } from 'react'
import apiRef from '../api-reference.json'
import { API_BASE } from '../lib/config'
import './ApiReferencePage.css'


interface Endpoint {
  id: string
  method: string
  path: string
  description: string
  auth_required: boolean
  roles_required?: string[]
  path_params?: Record<string, unknown>
  query_params?: Record<string, unknown>
  payload?: unknown
  payload_multipart_form?: unknown
  payload_form_encoded?: unknown
  payload_semantic?: unknown
  payload_company_chain?: unknown
  response?: unknown
  response_no_otp?: unknown
  response_with_otp?: unknown
  client_message_types?: unknown
  server_message_types?: unknown
  content_type?: string
  content_disposition?: string
}


const METHOD_CONFIG: Record<string, { bg: string; color: string; border: string }> = {
  GET:       { bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe' },
  POST:      { bg: '#f0fdf4', color: '#15803d', border: '#bbf7d0' },
  PATCH:     { bg: '#fff7ed', color: '#c2410c', border: '#fed7aa' },
  DELETE:    { bg: '#fef2f2', color: '#dc2626', border: '#fecaca' },
  WEBSOCKET: { bg: '#fdf4ff', color: '#7e22ce', border: '#e9d5ff' },
}

const GROUP_META: Record<string, { label: string; icon: string; color: string }> = {
  system:      { label: 'System',      icon: '🔌', color: '#64748b' },
  auth:        { label: 'Auth',        icon: '🔐', color: '#4778f3' },
  jobs:        { label: 'Jobs',        icon: '💼', color: '#0369a1' },
  resumes:     { label: 'Resumes',     icon: '📄', color: '#059669' },
  candidates:  { label: 'Candidates',  icon: '🧑‍💼', color: '#d97706' },
  interview:   { label: 'Interview',   icon: '🎙️', color: '#dc2626' },
  intel:       { label: 'Intel',       icon: '📊', color: '#0891b2' },
}


function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    })
  }
  return (
    <button className="ar-copy-btn" onClick={copy} title="Copy to clipboard">
      {copied ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
          <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
        </svg>
      )}
      {copied ? 'Copied!' : 'Copy'}
    </button>
  )
}

function JsonBlock({ label, data }: { label: string; data: unknown }) {
  const str = JSON.stringify(data, null, 2)
  return (
    <div className="ar-json-block">
      <div className="ar-json-header">
        <span className="ar-json-label">{label}</span>
        <CopyButton text={str} />
      </div>
      <pre className="ar-json-pre"><code>{str}</code></pre>
    </div>
  )
}

function MethodBadge({ method }: { method: string }) {
  const cfg = METHOD_CONFIG[method] || { bg: '#f1f5f9', color: '#475569', border: '#cbd5e1' }
  return (
    <span
      className="ar-method-badge"
      style={{ background: cfg.bg, color: cfg.color, borderColor: cfg.border }}
    >
      {method}
    </span>
  )
}

function EndpointCard({ ep }: { ep: Endpoint }) {
  const [open, setOpen] = useState(false)

  const payloads: Array<{ label: string; data: unknown }> = []
  if (ep.payload !== undefined && ep.payload !== null) payloads.push({ label: 'Request Body (JSON)', data: ep.payload })
  if (ep.payload_multipart_form) payloads.push({ label: 'Request Body (multipart/form-data)', data: ep.payload_multipart_form })
  if (ep.payload_form_encoded)   payloads.push({ label: 'Request Body (form-encoded)', data: ep.payload_form_encoded })
  if (ep.payload_semantic)       payloads.push({ label: 'Request Body - Semantic Search', data: ep.payload_semantic })
  if (ep.payload_company_chain)  payloads.push({ label: 'Request Body - Company Chain Search', data: ep.payload_company_chain })
  if (ep.client_message_types)   payloads.push({ label: 'Client Message Types (WS)', data: ep.client_message_types })

  const responses: Array<{ label: string; data: unknown }> = []
  if (ep.response)           responses.push({ label: 'Response', data: ep.response })
  if (ep.response_no_otp)    responses.push({ label: 'Response (No OTP)', data: ep.response_no_otp })
  if (ep.response_with_otp)  responses.push({ label: 'Response (With OTP)', data: ep.response_with_otp })
  if (ep.server_message_types) responses.push({ label: 'Server Message Types (WS)', data: ep.server_message_types })

  return (
    <div className={`ar-ep-card${open ? ' ar-ep-card--open' : ''}`} id={`ep-${ep.id}`}>
      <button className="ar-ep-header" onClick={() => setOpen(o => !o)}>
        <MethodBadge method={ep.method} />
        <span className="ar-ep-path">{ep.path}</span>
        <span className="ar-ep-desc">{ep.description}</span>

        <div className="ar-ep-badges">
          {ep.auth_required ? (
            <span className="ar-badge ar-badge-auth">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              JWT
            </span>
          ) : (
            <span className="ar-badge ar-badge-public">Public</span>
          )}
          {ep.roles_required?.map(r => (
            <span key={r} className="ar-badge ar-badge-role">{r}</span>
          ))}
        </div>

        <svg
          className={`ar-ep-chevron${open ? ' ar-ep-chevron--up' : ''}`}
          width="16" height="16" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="ar-ep-body">
          <div className="ar-ep-meta-row">
            {ep.path_params && (
              <div className="ar-ep-meta-item">
                <div className="ar-meta-label">Path Params</div>
                <div className="ar-params-list">
                  {Object.entries(ep.path_params).map(([k, v]) => (
                    <div key={k} className="ar-param">
                      <code className="ar-param-key">{`{${k}}`}</code>
                      <span className="ar-param-eg">e.g. <code>{String(v)}</code></span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {ep.query_params && (
              <div className="ar-ep-meta-item">
                <div className="ar-meta-label">Query Params</div>
                <div className="ar-params-list">
                  {Object.entries(ep.query_params).map(([k, v]) => (
                    <div key={k} className="ar-param">
                      <code className="ar-param-key">{k}</code>
                      <span className="ar-param-eg">e.g. <code>{String(v)}</code></span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {payloads.length > 0 && (
            <div className="ar-ep-section">
              {payloads.map(p => <JsonBlock key={p.label} label={p.label} data={p.data} />)}
            </div>
          )}

          {responses.length > 0 && (
            <div className="ar-ep-section">
              {responses.map(r => <JsonBlock key={r.label} label={r.label} data={r.data} />)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function GroupSection({
  groupKey,
  endpoints,
  defaultOpen,
}: {
  groupKey: string
  endpoints: Endpoint[]
  defaultOpen: boolean
}) {
  const [collapsed, setCollapsed] = useState(!defaultOpen)
  const meta = GROUP_META[groupKey] || { label: groupKey, icon: '📁', color: '#64748b' }

  return (
    <div className="ar-group">
      <button className="ar-group-header" onClick={() => setCollapsed(c => !c)}>
        <span className="ar-group-icon" style={{ background: meta.color + '18', color: meta.color }}>
          {meta.icon}
        </span>
        <span className="ar-group-label">{meta.label}</span>
        <span className="ar-group-count">{endpoints.length}</span>
        <svg
          className={`ar-group-chevron${collapsed ? '' : ' ar-group-chevron--up'}`}
          width="15" height="15" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {!collapsed && (
        <div className="ar-group-body">
          {endpoints.map(ep => <EndpointCard key={ep.id} ep={ep} />)}
        </div>
      )}
    </div>
  )
}


export default function ApiReferencePage() {
  const [search, setSearch] = useState('')
  const [filterMethod, setFilterMethod] = useState<string>('ALL')
  const [filterAuth, setFilterAuth] = useState<string>('ALL')

  const endpoints = apiRef.endpoints as Record<string, Endpoint[]>
  const meta = apiRef.meta

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    const result: Record<string, Endpoint[]> = {}

    Object.entries(endpoints).forEach(([group, eps]) => {
      const matched = eps.filter(ep => {
        const matchesSearch =
          !q ||
          ep.path.toLowerCase().includes(q) ||
          ep.description.toLowerCase().includes(q) ||
          ep.method.toLowerCase().includes(q) ||
          ep.id.toLowerCase().includes(q)

        const matchesMethod =
          filterMethod === 'ALL' || ep.method === filterMethod

        const matchesAuth =
          filterAuth === 'ALL' ||
          (filterAuth === 'AUTH' && ep.auth_required) ||
          (filterAuth === 'PUBLIC' && !ep.auth_required)

        return matchesSearch && matchesMethod && matchesAuth
      })
      if (matched.length > 0) result[group] = matched
    })

    return result
  }, [search, filterMethod, filterAuth, endpoints])

  const totalVisible = Object.values(filtered).reduce((s, arr) => s + arr.length, 0)
  const totalAll = Object.values(endpoints).reduce((s, arr) => s + arr.length, 0)

  return (
    <div className="ar-page">
      <div className="page-header">
        <div>
          <div className="page-title">API Reference</div>
          <div className="page-sub">
            {meta.title} - Base URL: <code>{API_BASE || window.location.origin}</code>
          </div>
        </div>
        <div className="ar-header-meta">
          <span className="ar-meta-pill ar-pill-version">v{meta.version}</span>
          <span className="ar-meta-pill ar-pill-auth">{meta.auth}</span>
        </div>
      </div>

      <div className="ar-toolbar">
        <div className="ar-search-wrap">
          <svg className="ar-search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
          </svg>
          <input
            className="ar-search"
            type="text"
            placeholder="Search endpoints, paths, methods…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button className="ar-search-clear" onClick={() => setSearch('')}>✕</button>
          )}
        </div>

        <div className="ar-filters">
          <select
            className="ar-select"
            value={filterMethod}
            onChange={e => setFilterMethod(e.target.value)}
          >
            <option value="ALL">All Methods</option>
            {['GET', 'POST', 'PATCH', 'DELETE', 'WEBSOCKET'].map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>

          <select
            className="ar-select"
            value={filterAuth}
            onChange={e => setFilterAuth(e.target.value)}
          >
            <option value="ALL">All Auth</option>
            <option value="AUTH">Auth Required</option>
            <option value="PUBLIC">Public</option>
          </select>
        </div>

        <div className="ar-count">
          {totalVisible === totalAll
            ? <span>{totalAll} endpoints</span>
            : <span><strong>{totalVisible}</strong> of {totalAll} endpoints</span>
          }
        </div>
      </div>

      <div className="ar-modules-strip">
        {meta.modules.map(m => (
          <span key={m} className="ar-module-tag">{m.replace(/_/g, ' ')}</span>
        ))}
      </div>

      <div className="ar-content">
        {Object.keys(filtered).length === 0 ? (
          <div className="ar-empty">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
            </svg>
            <div>No endpoints match your search</div>
          </div>
        ) : (
          Object.entries(filtered).map(([group, eps], idx) => (
            <GroupSection
              key={group}
              groupKey={group}
              endpoints={eps}
              defaultOpen={idx === 0}
            />
          ))
        )}
      </div>
    </div>
  )
}
