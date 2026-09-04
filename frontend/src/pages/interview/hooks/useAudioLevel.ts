import { useEffect, useRef, useState } from 'react'

export const SILENCE_FLOOR = 0.012

export function useAudioLevel(stream: MediaStream | null, enabled = true) {
  const levelRef = useRef(0)
  const [level, setLevel] = useState(0)
  const [supported, setSupported] = useState(false)

  useEffect(() => {
    if (!stream || !enabled) {
      levelRef.current = 0
      setLevel(0)
      return
    }
    if (stream.getAudioTracks().length === 0) return

    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return

    let ctx: AudioContext
    try {
      ctx = new Ctor()
    } catch {
      return
    }

    let raf = 0
    let source: MediaStreamAudioSourceNode | null = null
    let analyser: AnalyserNode | null = null
    let stopped = false

    try {
      source = ctx.createMediaStreamSource(stream)
      analyser = ctx.createAnalyser()
      analyser.fftSize = 1024
      analyser.smoothingTimeConstant = 0.75
      source.connect(analyser)
    } catch {
      void ctx.close()
      return
    }

    if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
    setSupported(true)

    const buf = new Float32Array(analyser.fftSize)
    let lastBucket = -1

    const tick = () => {
      if (stopped || !analyser) return
      analyser.getFloatTimeDomainData(buf)
      let sum = 0
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
      const rms = Math.sqrt(sum / buf.length)
      levelRef.current = rms

      const bucket = Math.round(Math.min(1, rms * 4) * 20)
      if (bucket !== lastBucket) {
        lastBucket = bucket
        setLevel(rms)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      try { source?.disconnect() } catch {}
      try { analyser?.disconnect() } catch {}
      void ctx.close().catch(() => {})
      levelRef.current = 0
    }
  }, [stream, enabled])

  return { levelRef, level, supported }
}
