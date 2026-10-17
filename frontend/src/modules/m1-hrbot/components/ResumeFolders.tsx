import { useEffect, useMemo, useState } from 'react'
import { resumesApi, type ResumeFilterParams } from '../../../lib/api'
import { FolderIcon } from './FilterIcons'
import './ResumeFolders.css'

const MAX_ROLES = 3

interface Folder {
  value: string
  label: string
  count: number
  roles: string[]
}

interface Props {
  params: ResumeFilterParams
  reloadKey: number
  hasFilters: boolean
  onOpen: (value: string) => void
}

type Phase = 'loading' | 'ready' | 'error'

function readFolders(data: unknown): Folder[] {
  const list = (data as { folders?: unknown } | null)?.folders
  if (!Array.isArray(list)) return []
  const out: Folder[] = []
  for (const entry of list) {
    const o = (entry ?? {}) as Record<string, unknown>
    if (typeof o.value !== 'string' || !o.value) continue
    const roles = Array.isArray(o.roles)
      ? o.roles.map(r => (typeof r === 'string' ? r : String((r as { value?: unknown })?.value ?? ''))).filter(Boolean)
      : []
    out.push({
      value: o.value,
      label: typeof o.label === 'string' && o.label ? o.label : o.value,
      count: typeof o.count === 'number' && Number.isFinite(o.count) ? o.count : 0,
      roles: roles.slice(0, MAX_ROLES),
    })
  }
  return out
}

export default function ResumeFolders({ params, reloadKey, hasFilters, onOpen }: Props) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [folders, setFolders] = useState<Folder[]>([])
  const [attempt, setAttempt] = useState(0)
  const key = JSON.stringify(params)
  const stable = useMemo(() => JSON.parse(key) as ResumeFilterParams, [key])

  useEffect(() => {
    let current = true
    setPhase('loading')
    resumesApi.domains(stable)
      .then(r => {
        if (!current) return
        setFolders(readFolders(r.data))
        setPhase('ready')
      })
      .catch(() => {
        if (!current) return
        setFolders([])
        setPhase('error')
      })
    return () => { current = false }
  }, [stable, reloadKey, attempt])

  if (phase === 'loading') {
    return (
      <div className="rfo-skeleton" data-density="compact" aria-busy="true">
        <span className="rfo-sr-only">Loading folders</span>
        {Array.from({ length: 6 }, (_, i) => <div key={i} className="rfo-skeleton-tile" aria-hidden="true" />)}
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <div className="rfo-state" role="alert">
        <p>Couldn't load folders.</p>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAttempt(n => n + 1)}>Retry</button>
      </div>
    )
  }

  if (folders.length === 0) {
    return (
      <div className="rfo-state">
        <p>{hasFilters ? 'No folders match these filters' : 'No résumés yet'}</p>
      </div>
    )
  }

  return (
    <ul className="rfo-grid" data-density="compact" aria-label="Domain folders">
      {folders.map(folder => (
        <li key={folder.value} className="rfo-cell">
          <button
            type="button"
            className="rfo-tile"
            aria-label={`Open ${folder.label}: ${folder.count.toLocaleString()} ${folder.count === 1 ? 'résumé' : 'résumés'}`}
            onClick={() => onOpen(folder.value)}
          >
            <span className="rfo-top">
              <span className="rfo-icon"><FolderIcon size={14} /></span>
              <span className="rfo-figure">
                <span className="rfo-count">{folder.count.toLocaleString()}</span>
                <span className="rfo-sub">{folder.count === 1 ? 'résumé' : 'résumés'}</span>
              </span>
            </span>
            <span className="rfo-name">{folder.label}</span>
            {folder.roles.length > 0 && (
              <span className="rfo-roles">
                {folder.roles.map(role => <span key={role} className="rfo-role">{role}</span>)}
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  )
}
