import { useCallback, useEffect, useRef, useState } from 'react'

interface SpeechAlternative { transcript: string }
interface SpeechResult { readonly length: number; isFinal: boolean; [i: number]: SpeechAlternative }
interface SpeechResultList { readonly length: number; [i: number]: SpeechResult }
interface SpeechEvent { resultIndex: number; results: SpeechResultList }
interface SpeechErrorEvent { error: string }
interface SpeechRecognitionLike {
  continuous: boolean
  interimResults: boolean
  lang: string
  start(): void
  stop(): void
  abort(): void
  onresult: ((e: SpeechEvent) => void) | null
  onerror: ((e: SpeechErrorEvent) => void) | null
  onend: (() => void) | null
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike

function getCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

const MAX_RESTARTS = 40

export function useLiveCaptions(active: boolean) {
  const [text, setText] = useState('')
  const [supported] = useState(() => getCtor() !== null)

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const finalRef = useRef('')
  const activeRef = useRef(false)
  const disabledRef = useRef(false)
  const restartsRef = useRef(0)

  const reset = useCallback(() => {
    finalRef.current = ''
    setText('')
  }, [])

  useEffect(() => {
    activeRef.current = active
    if (!active) {
      const rec = recognitionRef.current
      recognitionRef.current = null
      if (rec) {
        rec.onresult = null
        rec.onerror = null
        rec.onend = null
        try { rec.abort() } catch {}
      }
      return
    }

    if (disabledRef.current) return
    const Ctor = getCtor()
    if (!Ctor) return

    finalRef.current = ''
    setText('')
    restartsRef.current = 0

    let rec: SpeechRecognitionLike
    try {
      rec = new Ctor()
    } catch {
      disabledRef.current = true
      return
    }
    rec.continuous = true
    rec.interimResults = true
    rec.lang = 'en-US'

    rec.onresult = (e: SpeechEvent) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i]
        const chunk = result[0]?.transcript ?? ''
        if (result.isFinal) finalRef.current += chunk
        else interim += chunk
      }
      setText((finalRef.current + interim).trimStart())
    }

    rec.onerror = (e: SpeechErrorEvent) => {
      if (e.error === 'not-allowed' || e.error === 'audio-capture' || e.error === 'service-not-allowed') {
        disabledRef.current = true
      }
    }

    rec.onend = () => {
      if (!activeRef.current || disabledRef.current) return
      if (restartsRef.current >= MAX_RESTARTS) return
      restartsRef.current += 1
      try { rec.start() } catch {}
    }

    try {
      rec.start()
      recognitionRef.current = rec
    } catch {
      disabledRef.current = true
    }

    return () => {
      activeRef.current = false
      recognitionRef.current = null
      rec.onresult = null
      rec.onerror = null
      rec.onend = null
      try { rec.abort() } catch {}
    }
  }, [active])

  useEffect(() => () => {
    const rec = recognitionRef.current
    if (!rec) return
    rec.onresult = null
    rec.onerror = null
    rec.onend = null
    try { rec.abort() } catch {}
  }, [])

  return { text, supported, reset }
}
