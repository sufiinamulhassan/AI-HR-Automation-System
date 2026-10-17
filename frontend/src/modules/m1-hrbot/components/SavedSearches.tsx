import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { savedFiltersApi } from '../../../lib/api'
import { BookmarkIcon, ChevronIcon, TrashIcon } from './FilterIcons'
import {
  SAVED_NAME_MAX,
  SAVED_SCOPE,
  apiDetail,
  fromSavedParams,
  hasActiveFilters,
  toParams,
  type ResumeFilterValues,
  type ResumeNotice,
} from './resumeFilterModel'
import './SavedSearches.css'

interface Props {
  filters: ResumeFilterValues
  onApply: (filters: ResumeFilterValues) => void
  onNotice: (notice: ResumeNotice) => void
}

interface SavedItem { id: string; name: string; params: unknown }

function readTemplates(data: unknown): SavedItem[] {
  const list = (data as { templates?: unknown } | null)?.templates
  if (!Array.isArray(list)) return []
  const items: SavedItem[] = []
  for (const entry of list) {
    const o = (entry ?? {}) as Record<string, unknown>
    if (typeof o.template_id === 'string' && typeof o.name === 'string' && o.name.trim()) {
      items.push({ id: o.template_id, name: o.name, params: o.filter_params })
    }
  }
  return items
}

export default function SavedSearches({ filters, onApply, onNotice }: Props) {
  const [items, setItems] = useState<SavedItem[]>([])
  const [loadFailed, setLoadFailed] = useState(false)
  const [open, setOpen] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [dialog, setDialog] = useState(false)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [alignEnd, setAlignEnd] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const saveRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelId = useId()
  const titleId = useId()
  const inputId = useId()
  const errorId = useId()

  const load = useCallback(async () => {
    try {
      const r = await savedFiltersApi.list(SAVED_SCOPE)
      setItems(readTemplates(r.data))
      setLoadFailed(false)
    } catch {
      setLoadFailed(true)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!open) return
    const outside = (e: Event) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', outside)
    document.addEventListener('focusin', outside)
    return () => {
      document.removeEventListener('mousedown', outside)
      document.removeEventListener('focusin', outside)
    }
  }, [open])

  useEffect(() => {
    if (!open) {
      setConfirmId(null)
      setAlignEnd(false)
    }
  }, [open])

  useLayoutEffect(() => {
    if (!open || !wrapRef.current || !panelRef.current) return
    const left = wrapRef.current.getBoundingClientRect().left
    if (left + panelRef.current.offsetWidth > window.innerWidth - 8) setAlignEnd(true)
  }, [open, items.length, loadFailed])

  const closeDialog = useCallback(() => {
    setDialog(false)
    saveRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!dialog) return
    inputRef.current?.focus()
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) closeDialog()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dialog, saving, closeDialog])

  function onWrapKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape' && open) {
      e.preventDefault()
      setOpen(false)
      triggerRef.current?.focus()
    }
  }

  function apply(item: SavedItem) {
    onApply(fromSavedParams(item.params))
    setOpen(false)
  }

  async function remove(item: SavedItem) {
    setBusyId(item.id)
    try {
      await savedFiltersApi.delete(item.id)
      setItems(prev => prev.filter(i => i.id !== item.id))
      onNotice({ kind: 'ok', text: `Deleted saved search "${item.name}".` })
    } catch (e) {
      onNotice({ kind: 'error', text: apiDetail(e, 'Could not delete this saved search.') })
    } finally {
      setConfirmId(null)
      setBusyId(null)
    }
  }

  function openDialog() {
    setName('')
    setFormError('')
    setOpen(false)
    setDialog(true)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setFormError('Enter a name for this search.')
      inputRef.current?.focus()
      return
    }
    if (trimmed.length > SAVED_NAME_MAX) {
      setFormError(`Use ${SAVED_NAME_MAX} characters or fewer.`)
      inputRef.current?.focus()
      return
    }
    setSaving(true)
    setFormError('')
    try {
      await savedFiltersApi.create({ name: trimmed, filter_params: toParams(filters), scope: SAVED_SCOPE })
      setDialog(false)
      saveRef.current?.focus()
      onNotice({ kind: 'ok', text: `Saved search "${trimmed}".` })
      await load()
    } catch (err) {
      setFormError(apiDetail(err, 'Could not save this search. Please try again.'))
    } finally {
      setSaving(false)
    }
  }

  function trapTab(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Tab' || !dialogRef.current) return
    const nodes = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('input, button:not(:disabled)'))
    if (!nodes.length) return
    const first = nodes[0]
    const last = nodes[nodes.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  const count = items.length

  return (
    <>
      <div className="ss" ref={wrapRef} onKeyDown={onWrapKeyDown}>
        <button
          ref={triggerRef}
          type="button"
          className={`rf-pill ss-trigger${open ? ' rf-pill-on' : ''}`}
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          onClick={() => setOpen(o => !o)}
        >
          <BookmarkIcon size={14} />
          <span>{count > 0 ? `Saved Searches (${count})` : 'Saved Searches'}</span>
          <span className={`ss-chevron${open ? ' ss-chevron-open' : ''}`}><ChevronIcon size={12} /></span>
        </button>
        {open && (
          <div ref={panelRef} id={panelId} className={`ss-panel${alignEnd ? ' ss-panel-end' : ''}`}>
            {loadFailed ? (
              <div className="ss-empty">
                <span>Couldn't load saved searches.</span>
                <button type="button" className="ss-retry" onClick={load}>Retry</button>
              </div>
            ) : count === 0 ? (
              <div className="ss-empty">No saved searches yet</div>
            ) : (
              <ul className="ss-list" aria-label="Saved searches">
                {items.map(item => (
                  <li key={item.id} className="ss-item">
                    {confirmId === item.id ? (
                      <div className="ss-confirm" role="group" aria-label={`Delete ${item.name}?`}>
                        <span className="ss-confirm-text">{`Delete "${item.name}"?`}</span>
                        <button
                          type="button"
                          className="ss-confirm-yes"
                          disabled={busyId === item.id}
                          onClick={() => remove(item)}
                        >
                          Delete
                        </button>
                        <button type="button" className="ss-confirm-no" onClick={() => setConfirmId(null)}>Keep</button>
                      </div>
                    ) : (
                      <>
                        <button type="button" className="ss-apply" title={item.name} onClick={() => apply(item)}>
                          {item.name}
                        </button>
                        <button
                          type="button"
                          className="ss-del"
                          aria-label={`Delete saved search ${item.name}`}
                          onClick={() => setConfirmId(item.id)}
                        >
                          <TrashIcon size={14} />
                        </button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <button
        ref={saveRef}
        type="button"
        className="rf-pill ss-save"
        title="Save the filters currently applied as a reusable search"
        onClick={openDialog}
      >
        <BookmarkIcon size={14} />
        <span>Save this search</span>
      </button>

      {dialog && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget && !saving) closeDialog() }}>
          <div
            ref={dialogRef}
            className="modal-box ss-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onKeyDown={trapTab}
          >
            <form onSubmit={submit} noValidate>
              <div className="modal-header">
                <h2 id={titleId}>Save this search</h2>
              </div>
              <div className="ss-dialog-body">
                <p>Saves the filters currently applied, so you can reapply them later from Saved Searches.</p>
                {!hasActiveFilters(filters) && (
                  <p className="ss-hint">No filters are applied right now, so this will save an empty search.</p>
                )}
                <label htmlFor={inputId} className="form-label">Name</label>
                <input
                  id={inputId}
                  ref={inputRef}
                  type="text"
                  className="form-input"
                  maxLength={SAVED_NAME_MAX}
                  placeholder="e.g. Senior Java engineers"
                  value={name}
                  aria-invalid={Boolean(formError)}
                  aria-describedby={formError ? errorId : undefined}
                  disabled={saving}
                  onChange={e => { setName(e.target.value); if (formError) setFormError('') }}
                />
                <div className="ss-count" aria-hidden="true">{name.length}/{SAVED_NAME_MAX}</div>
                {formError && <p id={errorId} className="ss-error" role="alert">{formError}</p>}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-ghost btn-sm" onClick={closeDialog} disabled={saving}>Cancel</button>
                <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
