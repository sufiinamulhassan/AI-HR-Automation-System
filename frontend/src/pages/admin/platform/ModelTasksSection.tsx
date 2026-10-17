import { useEffect, useRef, useState } from 'react'
import {
  modelTasksApi,
  type EmbeddingStatus,
  type ModelTask,
  type ModelTaskOption,
  type ModelTasksResponse,
  type ReindexResult,
} from '../../../lib/api'
import './ModelTasksSection.css'

const PROVIDER_LABELS: Record<string, string> = { anthropic: 'Anthropic', openai: 'OpenAI' }
const GROUP_ORDER = ['Interview', 'Hiring', 'Coding']

function errorDetail(e: unknown, fallback: string): string {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  return typeof detail === 'string' && detail.trim() ? detail : fallback
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

function byProvider(options: ModelTaskOption[]): [string, ModelTaskOption[]][] {
  const blocks = new Map<string, ModelTaskOption[]>()
  for (const o of options) blocks.set(o.provider, [...(blocks.get(o.provider) ?? []), o])
  return [...blocks.entries()]
}

interface Progress { done: number; failed: number; total: number }

export default function ModelTasksSection({ showToast }: { showToast: (msg: string) => void }) {
  const [data, setData] = useState<ModelTasksResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [savingKey, setSavingKey] = useState('')
  const [status, setStatus] = useState<EmbeddingStatus | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)
  const gone = useRef(false)

  useEffect(() => {
    gone.current = false
    load()
    return () => { gone.current = true }
  }, [])

  async function load() {
    setLoading(true)
    setLoadError('')
    const [list, embedding] = await Promise.allSettled([modelTasksApi.list(), modelTasksApi.embeddingStatus()])
    if (list.status === 'rejected') {
      setLoadError(errorDetail(list.reason, 'Could not load the models.'))
    } else {
      setData(list.value.data)
    }
    if (embedding.status === 'fulfilled') setStatus(embedding.value.data)
    setLoading(false)
  }

  async function refreshStatus() {
    try {
      const r = await modelTasksApi.embeddingStatus()
      if (!gone.current) setStatus(r.data)
    } catch { }
  }

  async function choose(task: ModelTask, value: string) {
    setSavingKey(task.key)
    try {
      const r = await modelTasksApi.set(task.key, value || null)
      setData(d => d && { ...d, tasks: d.tasks.map(t => (t.key === task.key ? r.data : t)) })
      showToast(value ? `${task.label}: ${r.data.model_name}` : `${task.label}: back to the default`)
      if (task.kind === 'embedding') await refreshStatus()
    } catch (e) {
      showToast(errorDetail(e, 'Could not change the model.'))
    }
    setSavingKey('')
  }

  async function reembed() {
    if (!status || progress) return
    const total = status.stale_total
    let done = 0
    let failed = 0
    let cursor: string | null = null
    setProgress({ done, failed, total })
    try {
      for (let calls = 0; calls < 1000 && !gone.current; calls++) {
        const r: ReindexResult = (await modelTasksApi.reindex(cursor)).data
        done += r.processed
        failed += r.failed
        setProgress({ done, failed, total })
        if (r.done || !r.next_cursor) break
        cursor = r.next_cursor
      }
      showToast(failed ? `Re-embedded ${done}, ${failed} could not be re-embedded` : `Re-embedded ${plural(done, 'document')}`)
    } catch (e) {
      showToast(errorDetail(e, 'Re-embedding stopped.'))
    }
    setProgress(null)
    await refreshStatus()
  }

  return (
    <section className="ss-section ps-section mt-section">
      <div className="ss-section-title">Models by Job</div>
      <div className="ss-card card">
        {loading ? (
          <div className="mt-note">Loading the models…</div>
        ) : loadError || !data ? (
          <div className="mt-error" role="alert">
            <span>{loadError || 'Could not load the models.'}</span>
            <button className="btn btn-secondary btn-sm" onClick={load}>Retry</button>
          </div>
        ) : (
          <>
            {GROUP_ORDER.filter(g => data.tasks.some(t => t.group === g)).map(group => (
              <div className="mt-group" key={group}>
                <div className="mt-group-title">{group}</div>
                {data.tasks.filter(t => t.group === group).map(task => (
                  <TaskRow
                    key={task.key}
                    task={task}
                    options={data.options[task.kind] ?? []}
                    busy={savingKey === task.key}
                    onChoose={value => choose(task, value)}
                  />
                ))}
                {group === 'Hiring' && status && (status.stale_total > 0 || progress) && (
                  <div className="mt-reembed" role="status">
                    <span className="mt-reembed-text">
                      {progress
                        ? `Re-embedding ${progress.done + progress.failed} of ${progress.total}`
                        : `${plural(status.stale_total, 'document')} with no embedding from the model in use ` +
                          `(${plural(status.stale_jobs, 'job')}, ${plural(status.stale_resumes, 'CV')}) do not match until re-embedded`}
                    </span>
                    <button className="btn btn-primary btn-sm" onClick={reembed} disabled={!!progress}>
                      {progress ? 'Re-embedding…' : 'Re-embed now'}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </section>
  )
}

function TaskRow({ task, options, busy, onChoose }: {
  task: ModelTask
  options: ModelTaskOption[]
  busy: boolean
  onChoose: (value: string) => void
}) {
  const listed = task.override === null || options.some(o => o.id === task.override)
  return (
    <div className="mt-row">
      <label className="mt-label" htmlFor={`mt-${task.key}`}>{task.label}</label>
      <select
        id={`mt-${task.key}`}
        className="mt-select"
        value={task.override ?? ''}
        disabled={busy}
        onChange={e => onChoose(e.target.value)}
      >
        <option value="">{`Default (${task.default_name})`}</option>
        {!listed && task.override && <option value={task.override}>{task.model_name}</option>}
        {byProvider(options).map(([provider, models]) => (
          <optgroup key={provider} label={PROVIDER_LABELS[provider] ?? provider}>
            {models.map(o => (
              <option key={o.id} value={o.id} disabled={!o.available}>
                {o.available ? o.name : `${o.name} (not set up)`}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <span className="mt-price">{task.price_label ?? '-'}</span>
    </div>
  )
}
