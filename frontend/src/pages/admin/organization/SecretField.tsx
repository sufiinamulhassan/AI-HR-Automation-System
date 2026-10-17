import { useId, useState } from 'react'
import './OrgPanels.css'

interface Props {
  noun: string
  saved: boolean
  value: string
  onChange: (value: string) => void
  removed: boolean
  onRemovedChange: (removed: boolean) => void
  help?: string
  disabled?: boolean
}

export default function SecretField({ noun, saved, value, onChange, removed, onRemovedChange, help, disabled }: Props) {
  const id = useId()
  const [changing, setChanging] = useState(false)

  if (saved && removed) {
    return (
      <div className="org-field">
        <span className="form-label">{noun}</span>
        <div className="secret-row">
          <span className="badge badge-red">{noun} will be removed</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onRemovedChange(false)} disabled={disabled}>Undo</button>
        </div>
      </div>
    )
  }

  if (saved && !changing) {
    return (
      <div className="org-field">
        <span className="form-label">{noun}</span>
        <div className="secret-row">
          <span className="badge badge-green">{noun} saved</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setChanging(true)} disabled={disabled}>Change</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onRemovedChange(true)} disabled={disabled}>Remove</button>
        </div>
      </div>
    )
  }

  return (
    <div className="org-field">
      <label className="form-label" htmlFor={id}>{noun}</label>
      <div className="secret-row">
        <input
          id={id}
          className="form-input"
          type="password"
          autoComplete="new-password"
          value={value}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
          aria-describedby={help ? `${id}-help` : undefined}
        />
        {saved && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { onChange(''); setChanging(false) }} disabled={disabled}>
            Keep the saved one
          </button>
        )}
      </div>
      {help && <span className="org-hint" id={`${id}-help`}>{help}</span>}
    </div>
  )
}
