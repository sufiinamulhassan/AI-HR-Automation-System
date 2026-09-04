import { useEffect, useRef } from 'react'
import './Whiteboard.css'

interface Props {
  prompt?: string
}

export default function Whiteboard({ prompt }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawingRef = useRef(false)
  const lastRef = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return

    const resize = () => {
      const { width, height } = wrap.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.max(1, Math.round(width * dpr))
      canvas.height = Math.max(1, Math.round(height * dpr))
      canvas.getContext('2d')?.scale(dpr, dpr)
    }

    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(wrap)
    return () => observer.disconnect()
  }, [])

  function pointerPos(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    drawingRef.current = true
    lastRef.current = pointerPos(e)
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return
    const ctx = canvasRef.current?.getContext('2d')
    const last = lastRef.current
    if (!ctx || !last) return
    const pos = pointerPos(e)
    ctx.strokeStyle = '#1f2937'
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(last.x, last.y)
    ctx.lineTo(pos.x, pos.y)
    ctx.stroke()
    lastRef.current = pos
  }

  function stopDrawing() {
    drawingRef.current = false
    lastRef.current = null
  }

  function clear() {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
  }

  return (
    <aside className="rail rail-whiteboard">
      <section className="rail-section">
        <h2 className="rail-title">
          Whiteboard
          <button type="button" className="rail-whiteboard-clear" onClick={clear}>Clear</button>
        </h2>
        {prompt && <p className="rail-hint">Sketch out your answer to: {prompt}</p>}
      </section>

      <div className="rail-whiteboard-canvas-wrap" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          className="rail-whiteboard-canvas"
          aria-label="Drawing scratchpad"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={stopDrawing}
          onPointerLeave={stopDrawing}
        />
      </div>
    </aside>
  )
}
