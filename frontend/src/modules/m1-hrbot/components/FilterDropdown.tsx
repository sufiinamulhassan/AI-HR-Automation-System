import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { fallbackLabel, type FilterOption } from './resumeFilterModel'
import { CheckIcon, ChevronIcon, SearchIcon } from './FilterIcons'
import './FilterDropdown.css'

const MAX_VISIBLE = 200
const EDGE_GAP = 8

function usePopover() {
  const [open, setOpen] = useState(false)
  const [alignEnd, setAlignEnd] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const id = useId()

  const close = useCallback((refocus = false) => {
    setOpen(false)
    setAlignEnd(false)
    if (refocus) buttonRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!open) return
    const outside = (e: Event) => {
      if (!wrapRef.current?.contains(e.target as Node)) close()
    }
    document.addEventListener('mousedown', outside)
    document.addEventListener('focusin', outside)
    return () => {
      document.removeEventListener('mousedown', outside)
      document.removeEventListener('focusin', outside)
    }
  }, [open, close])

  useLayoutEffect(() => {
    if (!open || !wrapRef.current || !panelRef.current) return
    const left = wrapRef.current.getBoundingClientRect().left
    if (left + panelRef.current.offsetWidth > window.innerWidth - EDGE_GAP) setAlignEnd(true)
  }, [open])

  return { open, setOpen, close, alignEnd, wrapRef, buttonRef, panelRef, id }
}

function optionNodes(panel: HTMLElement | null): HTMLElement[] {
  return panel ? Array.from(panel.querySelectorAll<HTMLElement>('[role="option"]')) : []
}

interface TriggerProps {
  label: string
  text: string
  active: boolean
  open: boolean
  disabled: boolean
  title?: string
  controls?: string
  buttonRef: RefObject<HTMLButtonElement>
  onToggle: () => void
}

function Trigger({ label, text, active, open, disabled, title, controls, buttonRef, onToggle }: TriggerProps) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className={`fd-btn${active ? ' fd-btn-active' : ''}${open ? ' fd-btn-open' : ''}`}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={open ? controls : undefined}
      disabled={disabled}
      title={title}
      onClick={onToggle}
    >
      <span className="fd-label">{label}</span>
      {text && <span className="fd-value">{text}</span>}
      <span className="fd-chevron"><ChevronIcon size={12} /></span>
    </button>
  )
}

function unavailableTitle(loading: boolean, empty: boolean): string | undefined {
  if (loading) return 'Loading options'
  return empty ? 'No values yet' : undefined
}

interface SelectProps {
  label: string
  value: string
  options: FilterOption[]
  allLabel: string
  onChange: (value: string) => void
  loading?: boolean
}

export function SelectDropdown({ label, value, options, allLabel, onChange, loading = false }: SelectProps) {
  const pop = usePopover()
  const { open, setOpen, close, wrapRef, buttonRef, panelRef, id, alignEnd } = pop
  const empty = options.length === 0 && !value
  const disabled = loading || empty
  const all: FilterOption[] = useMemo(() => [{ value: '', label: allLabel }, ...options], [allLabel, options])
  const shown = value ? (options.find(o => o.value === value)?.label ?? fallbackLabel(value)) : ''

  useEffect(() => {
    if (!open) return
    const nodes = optionNodes(panelRef.current)
    const target = nodes.find(n => n.getAttribute('aria-selected') === 'true') ?? nodes[0]
    target?.focus()
  }, [open, panelRef])

  function choose(next: string) {
    onChange(next)
    close(true)
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (!open) {
      if (e.target === buttonRef.current && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && !disabled) {
        e.preventDefault()
        setOpen(true)
      }
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close(true)
      return
    }
    if (!panelRef.current?.contains(e.target as Node)) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        optionNodes(panelRef.current)[0]?.focus()
      }
      return
    }
    const nodes = optionNodes(panelRef.current)
    const at = nodes.indexOf(document.activeElement as HTMLElement)
    const go = (i: number) => {
      e.preventDefault()
      nodes[(i + nodes.length) % nodes.length]?.focus()
    }
    if (e.key === 'ArrowDown') go(at + 1)
    else if (e.key === 'ArrowUp') go(at - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(nodes.length - 1)
  }

  return (
    <div className="fd" ref={wrapRef} onKeyDown={onKeyDown}>
      <Trigger
        label={label}
        text={shown}
        active={Boolean(value)}
        open={open}
        disabled={disabled}
        title={unavailableTitle(loading, empty)}
        controls={id}
        buttonRef={buttonRef}
        onToggle={() => (open ? close() : setOpen(true))}
      />
      {open && (
        <div
          ref={panelRef}
          id={id}
          role="listbox"
          aria-label={label}
          className={`fd-panel${alignEnd ? ' fd-panel-end' : ''}`}
        >
          {all.slice(0, MAX_VISIBLE + 1).map(o => (
            <button
              key={o.value || 'all'}
              type="button"
              role="option"
              aria-selected={o.value === value}
              tabIndex={-1}
              className={`fd-opt${o.value === value ? ' fd-opt-selected' : ''}`}
              onClick={() => choose(o.value)}
            >
              <span className="fd-opt-label">{o.label}</span>
              {o.count !== undefined && <span className="fd-count">{o.count}</span>}
              {o.value === value && <CheckIcon size={12} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

interface MultiProps {
  label: string
  values: string[]
  options: FilterOption[]
  hint?: string
  onChange: (next: string[]) => void
  loading?: boolean
}

export function MultiSelectDropdown({ label, values, options, hint, onChange, loading = false }: MultiProps) {
  const pop = usePopover()
  const { open, setOpen, close, wrapRef, buttonRef, panelRef, id, alignEnd } = pop
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const empty = options.length === 0 && values.length === 0
  const disabled = loading || empty
  const picked = useMemo(() => new Set(values.map(v => v.toLowerCase())), [values])

  const merged = useMemo<FilterOption[]>(() => {
    const known = new Set(options.map(o => o.value.toLowerCase()))
    const extra: FilterOption[] = values.filter(v => !known.has(v.toLowerCase())).map(v => ({ value: v, label: v }))
    return [...extra, ...options]
  }, [options, values])

  const needle = query.trim().toLowerCase()
  const visible = needle ? merged.filter(o => o.label.toLowerCase().includes(needle)) : merged
  const typed = query.replace(/,/g, ' ').replace(/\s+/g, ' ').trim()
  const canAdd = visible.length === 0 && typed !== '' && !picked.has(typed.toLowerCase())

  useEffect(() => {
    if (open) inputRef.current?.focus()
    else setQuery('')
  }, [open])

  function toggle(value: string) {
    const key = value.toLowerCase()
    onChange(picked.has(key) ? values.filter(v => v.toLowerCase() !== key) : [...values, value])
  }

  function onInputKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (visible[0]) toggle(visible[0].value)
    else if (canAdd) toggle(typed)
    setQuery('')
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (!open) {
      if (e.target === buttonRef.current && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && !disabled) {
        e.preventDefault()
        setOpen(true)
      }
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close(true)
      return
    }
    const nodes = optionNodes(panelRef.current)
    const at = nodes.indexOf(document.activeElement as HTMLElement)
    if (e.target === inputRef.current) {
      if (e.key === 'ArrowDown' && nodes.length) {
        e.preventDefault()
        nodes[0].focus()
      }
      return
    }
    if (!panelRef.current?.contains(e.target as Node)) return
    if (e.key === 'ArrowDown' && at < nodes.length - 1) {
      e.preventDefault()
      nodes[at + 1].focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (at <= 0) inputRef.current?.focus()
      else nodes[at - 1].focus()
    } else if (e.key === 'Home') {
      e.preventDefault()
      nodes[0]?.focus()
    } else if (e.key === 'End') {
      e.preventDefault()
      nodes[nodes.length - 1]?.focus()
    }
  }

  const listId = `${id}-list`
  const heading = values.length ? `${label} (${values.length})` : label

  return (
    <div className="fd" ref={wrapRef} onKeyDown={onKeyDown}>
      <Trigger
        label={heading}
        text={values.join(', ')}
        active={values.length > 0}
        open={open}
        disabled={disabled}
        title={unavailableTitle(loading, empty)}
        controls={listId}
        buttonRef={buttonRef}
        onToggle={() => (open ? close() : setOpen(true))}
      />
      {open && (
        <div ref={panelRef} className={`fd-panel fd-panel-wide${alignEnd ? ' fd-panel-end' : ''}`}>
          <div className="fd-search">
            <SearchIcon size={14} />
            <input
              ref={inputRef}
              type="text"
              className="fd-search-input"
              placeholder="Type to filter"
              aria-label={`Filter ${label.toLowerCase()} list`}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={onInputKeyDown}
            />
          </div>
          {hint && <p className="fd-hint">{hint}</p>}
          <div id={listId} role="listbox" aria-multiselectable="true" aria-label={label} className="fd-list">
            {visible.slice(0, MAX_VISIBLE).map(o => {
              const on = picked.has(o.value.toLowerCase())
              return (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={on}
                  tabIndex={-1}
                  className={`fd-opt${on ? ' fd-opt-selected' : ''}`}
                  onClick={() => toggle(o.value)}
                >
                  <span className={`fd-check${on ? ' fd-check-on' : ''}`} aria-hidden="true">
                    {on && <CheckIcon size={10} />}
                  </span>
                  <span className="fd-opt-label">{o.label}</span>
                  {o.count !== undefined && <span className="fd-count">{o.count}</span>}
                </button>
              )
            })}
            {canAdd && (
              <button
                type="button"
                role="option"
                aria-selected="false"
                tabIndex={-1}
                className="fd-opt fd-opt-add"
                onClick={() => { toggle(typed); setQuery('') }}
              >
                <span className="fd-opt-label">{`Add "${typed}"`}</span>
              </button>
            )}
          </div>
          {visible.length === 0 && !canAdd && <div className="fd-empty">No matches</div>}
        </div>
      )}
    </div>
  )
}
