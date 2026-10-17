import { useId, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { useDialog } from '../modules/m1-hrbot/components/useDialog'
import {
  MAX_ZOOM, MIN_ZOOM, START_CROP, cropToBlob, offsetFor, reach, scaleFor, settle, shareOf, zoomTo, type Crop,
} from '../lib/avatarCrop'
import './AvatarCropDialog.css'

const STEP = 10
const BIG_STEP = 40

interface Props {
  src: string
  type: string
  busy?: boolean
  error?: string
  onSave: (file: File) => void
  onCancel: () => void
}

interface Drag {
  pointer: number
  startX: number
  startY: number
  crop: Crop
}

export default function AvatarCropDialog({ src, type, busy = false, error = '', onSave, onCancel }: Props) {
  const titleId = useId()
  const zoomId = useId()
  const verticalId = useId()
  const horizontalId = useId()
  const imageRef = useRef<HTMLImageElement>(null)
  const drag = useRef<Drag | null>(null)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const [crop, setCrop] = useState<Crop>(START_CROP)
  const [failure, setFailure] = useState('')
  const requestClose = () => { if (!busy) onCancel() }
  const { boxRef, trapTab, onBackdropMouseDown, onBackdropClick } = useDialog(requestClose)

  const mime = type === 'image/jpeg' ? 'image/jpeg' : 'image/png'
  const limit = size ? reach(size.width, size.height, crop.zoom) : { x: 0, y: 0 }
  const scale = size ? scaleFor(size.width, size.height, crop.zoom) : 1
  const ready = size !== null && !busy

  function update(next: Crop) {
    if (size) setCrop(settle(next, size.width, size.height))
  }

  function onLoad() {
    const image = imageRef.current
    if (image && image.naturalWidth > 0 && image.naturalHeight > 0) {
      setSize({ width: image.naturalWidth, height: image.naturalHeight })
      setCrop(START_CROP)
      setFailure('')
    } else {
      setFailure('This photo could not be read. Choose another one.')
    }
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (!ready) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    drag.current = { pointer: e.pointerId, startX: e.clientX, startY: e.clientY, crop }
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const current = drag.current
    if (!current || current.pointer !== e.pointerId) return
    update({ ...current.crop, x: current.crop.x + e.clientX - current.startX, y: current.crop.y + e.clientY - current.startY })
  }

  function endDrag(e: ReactPointerEvent<HTMLDivElement>) {
    if (drag.current?.pointer === e.pointerId) drag.current = null
  }

  function onStageKey(e: KeyboardEvent<HTMLDivElement>) {
    if (!ready) return
    const step = e.shiftKey ? BIG_STEP : STEP
    const moves: Record<string, [number, number]> = {
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
    }
    const move = moves[e.key]
    if (!move) return
    e.preventDefault()
    update({ ...crop, x: crop.x + move[0], y: crop.y + move[1] })
  }

  async function save() {
    const image = imageRef.current
    if (!image || !size || busy) return
    setFailure('')
    try {
      const blob = await cropToBlob(image, crop, mime)
      onSave(new File([blob], `avatar.${mime === 'image/jpeg' ? 'jpg' : 'png'}`, { type: mime }))
    } catch {
      setFailure('The photo could not be prepared. Try another one.')
    }
  }

  const message = error || failure

  return createPortal(
    <div className="modal-overlay" data-testid="avatar-crop-backdrop" onMouseDown={onBackdropMouseDown} onClick={onBackdropClick}>
      <div
        ref={boxRef}
        className="modal-box avc-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={trapTab}
      >
        <div className="modal-header">
          <h2 id={titleId}>Edit your photo</h2>
        </div>
        <div className="avc-body">
          <div
            className="avc-stage"
            tabIndex={0}
            role="group"
            aria-label="Photo position. Drag the photo, or use the arrow keys to move it."
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={onStageKey}
          >
            <img
              ref={imageRef}
              src={src}
              alt="Photo being edited"
              className="avc-img"
              draggable={false}
              onLoad={onLoad}
              style={size ? {
                width: size.width * scale,
                height: size.height * scale,
                transform: `translate(calc(-50% + ${crop.x}px), calc(-50% + ${crop.y}px))`,
              } : { visibility: 'hidden' }}
            />
            <div className="avc-mask" aria-hidden="true" />
          </div>

          <div className="avc-controls">
            <div className="avc-row">
              <label className="avc-label" htmlFor={zoomId}>Zoom</label>
              <input
                id={zoomId}
                type="range"
                min={MIN_ZOOM}
                max={MAX_ZOOM}
                step={0.01}
                value={crop.zoom}
                disabled={!ready}
                onChange={e => { if (size) setCrop(zoomTo(crop, Number(e.target.value), size.width, size.height)) }}
              />
            </div>
            <div className="avc-row">
              <label className="avc-label" htmlFor={verticalId}>Up and down</label>
              <input
                id={verticalId}
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(shareOf(crop.y, limit.y) * 100)}
                disabled={!ready || limit.y === 0}
                onChange={e => update({ ...crop, y: offsetFor(Number(e.target.value) / 100, limit.y) })}
              />
              <div className="avc-ends" aria-hidden="true"><span>Top</span><span>Bottom</span></div>
            </div>
            <div className="avc-row">
              <label className="avc-label" htmlFor={horizontalId}>Left and right</label>
              <input
                id={horizontalId}
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(shareOf(crop.x, limit.x) * 100)}
                disabled={!ready || limit.x === 0}
                onChange={e => update({ ...crop, x: offsetFor(Number(e.target.value) / 100, limit.x) })}
              />
              <div className="avc-ends" aria-hidden="true"><span>Left</span><span>Right</span></div>
            </div>
          </div>

          <p className="avc-hint">Drag the photo to move it. Everyone sees what is inside the circle.</p>
          {message && <div className="avc-error" role="alert">{message}</div>}

          <div className="avc-footer">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCrop(START_CROP)} disabled={!ready}>Reset</button>
            <span className="avc-spacer" />
            <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} disabled={busy}>Cancel</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={!ready}>
              {busy ? 'Saving…' : 'Save photo'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
