import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { API_V1 } from '../../lib/config'
import {
  ANSWER_BITRATE,
  describeMediaError,
  extensionForMimeType,
  pickAudioMimeType,
  requestInterviewMedia,
  supportedAudioMimeTypes,
} from '../../modules/m1-hrbot/lib/voice'
import {
  enterFullscreen,
  exitFullscreen,
  hasMultipleDisplays,
  isFullscreen,
  watchScreenCapture,
} from '../../modules/m1-hrbot/lib/lockdown'

export interface TranscriptEntry { question: string; answer: string; answered_at: string }
export interface ChatMessage { role: 'agent' | 'candidate' | 'system'; content: string }
interface FollowupResponse { followup: string | null }
export type Status = 'loading' | 'lobby' | 'active' | 'done' | 'terminated' | 'error' | 'scheduled'
export type TurnPhase = 'speaking' | 'ready' | 'recording' | 'transcribing' | 'review' | 'thinking'

export const MAX_VIOLATIONS = 3
const VIOLATION_COALESCE_MS = 1200
const BLUR_CONFIRM_MS = 300
export const MAX_ANSWER_SECONDS = 180
const TRANSCRIBE_TIMEOUT_MS = 90_000

interface SessionOptions {
  autoAdvance?: boolean
}

export function useInterviewSession(token: string | undefined, opts: SessionOptions = {}) {
  const autoAdvanceRef = useRef(Boolean(opts.autoAdvance))
  autoAdvanceRef.current = Boolean(opts.autoAdvance)

  const [status, setStatus]             = useState<Status>('loading')
  const [errorMsg, setErrorMsg]         = useState('')
  const [scheduledMsg, setScheduledMsg] = useState('')
  const [questions, setQuestions]       = useState<string[]>([])
  const [candidateName, setCandidateName] = useState('')
  const [codingAssigned, setCodingAssigned] = useState(false)
  const [durationSecs, setDurationSecs] = useState(0)
  const [startedAt, setStartedAt]       = useState<number | null>(null)
  const [qIndex, setQIndex]             = useState(0)
  const [transcript, setTranscript]     = useState<TranscriptEntry[]>([])
  const [elapsed, setElapsed]           = useState(0)

  const [turnPhase, setTurnPhase]       = useState<TurnPhase>('speaking')
  const [draftAnswer, setDraftAnswer]   = useState('')
  const [recordSecs, setRecordSecs]     = useState(0)
  const [voiceNotice, setVoiceNotice]   = useState('')
  const [readyToken, setReadyToken]     = useState(0)

  const [mediaError, setMediaError]     = useState('')
  const [requestingMedia, setRequestingMedia] = useState(false)
  const [stream, setStream]             = useState<MediaStream | null>(null)

  const [violationCount, setViolationCount] = useState(0)
  const [warningOpen, setWarningOpen]   = useState(false)
  const [fullscreenLost, setFullscreenLost] = useState(false)

  const statusRef     = useRef<Status>('loading')
  const transcriptRef = useRef<TranscriptEntry[]>([])
  const timerRef      = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef  = useRef<number | null>(null)
  const submittedRef  = useRef(false)

  const streamRef       = useRef<MediaStream | null>(null)
  const recorderRef     = useRef<MediaRecorder | null>(null)
  const chunksRef       = useRef<BlobPart[]>([])
  const audioRef        = useRef<HTMLAudioElement | null>(null)
  const audioUrlRef     = useRef<string | null>(null)
  const recordTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null)
  const isPlayingRef    = useRef(false)
  const isRecordingRef  = useRef(false)
  const isUploadingRef  = useRef(false)
  const spokenKeyRef    = useRef<string | null>(null)

  const violationCountRef = useRef(0)
  const lastViolationAtRef = useRef(0)

  function applyStatus(s: Status) {
    statusRef.current = s
    setStatus(s)
    if ((s === 'done' || s === 'terminated' || s === 'error' || s === 'scheduled') && timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  function enterReady(notice = '') {
    setVoiceNotice(notice)
    setTurnPhase('ready')
    setReadyToken(t => t + 1)
  }

  useEffect(() => {
    if (!token) return
    fetch(`${API_V1}/interview/session/${token}`)
      .then(r => {
        if (r.status === 410) return Promise.reject('This interview session has already been completed.')
        if (r.status === 403) return r.json().then(d => Promise.reject({ scheduled: true, detail: d?.detail }))
        if (!r.ok) return r.json().then(d => Promise.reject(d.detail || 'Invalid interview link'))
        return r.json()
      })
      .then(data => {
        const qs: string[] = (data.questions || []).map((q: unknown) =>
          typeof q === 'string' ? q : (q as Record<string, string>).text ?? JSON.stringify(q)
        )
        setQuestions(qs)
        setCandidateName(data.candidate_name || '')
        setCodingAssigned(Boolean(data.coding_assigned))
        setDurationSecs((data.duration_minutes || 30) * 60)
        applyStatus('lobby')
      })
      .catch(err => {
        if (err && typeof err === 'object' && (err as { scheduled?: boolean }).scheduled) {
          setScheduledMsg((err as { detail?: string }).detail || 'This interview is not yet open.')
          applyStatus('scheduled')
          return
        }
        setErrorMsg(typeof err === 'string' ? err : 'Failed to load interview session')
        applyStatus('error')
      })

    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [token])


  const sendFlag = useCallback((event: string) => {
    if (!token) return
    fetch(`${API_V1}/interview/session/${token}/flag`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event }),
    }).catch(() => {})
  }, [token])

  const stopAllMedia = useCallback(() => {
    void exitFullscreen()
    if (recordTimerRef.current) { clearInterval(recordTimerRef.current); recordTimerRef.current = null }
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try { recorderRef.current.stop() } catch {}
    }
    isRecordingRef.current = false
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null }
    isPlayingRef.current = false
    if (audioUrlRef.current) { URL.revokeObjectURL(audioUrlRef.current); audioUrlRef.current = null }
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    setStream(null)
  }, [])

  const doSubmit = useCallback(async (terminationReason?: string) => {
    if (submittedRef.current) return
    submittedRef.current = true
    stopAllMedia()
    applyStatus(terminationReason ? 'terminated' : 'done')
    try {
      await fetch(`${API_V1}/interview/session/${token}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript: transcriptRef.current,
          flags: terminationReason ? [`terminated_tab_switches@${new Date().toISOString()}`] : [],
          termination_reason: terminationReason ?? null,
        }),
      })
    } catch {}
  }, [token, stopAllMedia])

  const registerViolation = useCallback((rawEvent: string) => {
    if (statusRef.current !== 'active') return
    sendFlag(rawEvent)

    const now = Date.now()
    if (now - lastViolationAtRef.current < VIOLATION_COALESCE_MS) return
    lastViolationAtRef.current = now

    const count = violationCountRef.current + 1
    violationCountRef.current = count
    setViolationCount(count)

    if (count >= MAX_VIOLATIONS) {
      sendFlag('terminated_tab_switches')
      setWarningOpen(false)
      doSubmit('max_tab_switches')
    } else {
      setWarningOpen(true)
    }
  }, [sendFlag, doSubmit])

  useEffect(() => {
    const handle = () => {
      if (document.hidden) registerViolation('tab_switch')
    }
    document.addEventListener('visibilitychange', handle)
    return () => document.removeEventListener('visibilitychange', handle)
  }, [registerViolation])

  useEffect(() => {
    const handleBlur = () => {
      if (statusRef.current !== 'active') return
      window.setTimeout(() => {
        if (document.hidden || !document.hasFocus()) registerViolation('window_blur')
      }, BLUR_CONFIRM_MS)
    }
    window.addEventListener('blur', handleBlur)
    return () => window.removeEventListener('blur', handleBlur)
  }, [registerViolation])

  useEffect(() => {
    const handleUnload = (e: BeforeUnloadEvent) => {
      if (statusRef.current !== 'active') return
      const blob = new Blob([JSON.stringify({ event: 'page_unload_attempt' })], { type: 'application/json' })
      navigator.sendBeacon(`${API_V1}/interview/session/${token}/flag`, blob)
      if (isRecordingRef.current || isUploadingRef.current) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handleUnload)
    return () => window.removeEventListener('beforeunload', handleUnload)
  }, [token])

  useEffect(() => {
    const handleOnline  = () => { if (statusRef.current === 'active') sendFlag('connection_restored') }
    const handleOffline = () => { if (statusRef.current === 'active') sendFlag('connection_lost') }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [sendFlag])

  const handleProctoringFlag = useCallback((event: string) => {
    if (statusRef.current !== 'active') return
    sendFlag(event)
  }, [sendFlag])

  useEffect(() => {
    const handle = () => {
      if (statusRef.current !== 'active') return
      const full = isFullscreen()
      setFullscreenLost(!full)
      sendFlag(full ? 'fullscreen_restored' : 'fullscreen_exit')
    }
    document.addEventListener('fullscreenchange', handle)
    return () => document.removeEventListener('fullscreenchange', handle)
  }, [sendFlag])

  useEffect(() => {
    return watchScreenCapture(() => {
      if (statusRef.current === 'active') sendFlag('screen_share_detected')
    })
  }, [sendFlag])

  useEffect(() => stopAllMedia, [stopAllMedia])


  async function grantMediaAndStart() {
    setRequestingMedia(true)
    setMediaError('')
    try {
      const granted = await requestInterviewMedia()
      if (!pickAudioMimeType()) {
        granted.getTracks().forEach(t => t.stop())
        setMediaError('This browser cannot record audio. Please open this interview link in Google Chrome.')
        return
      }
      streamRef.current = granted
      setStream(granted)

      await enterFullscreen()
      if (hasMultipleDisplays() === true) sendFlag('multiple_displays_detected')

      startTimeRef.current = Date.now()
      setStartedAt(startTimeRef.current)
      timerRef.current = setInterval(() => {
        const e = Math.floor((Date.now() - startTimeRef.current!) / 1000)
        setElapsed(e)
        if (e >= durationSecs) doSubmit()
      }, 1000)
      setTurnPhase('speaking')
      applyStatus('active')
    } catch (err) {
      setMediaError(describeMediaError(err))
    } finally {
      setRequestingMedia(false)
    }
  }

  useEffect(() => {
    if (status !== 'active') return
    const question = questions[qIndex]
    if (!question) return
    const key = `${qIndex}:${question}`
    if (spokenKeyRef.current === key) return
    spokenKeyRef.current = key

    let cancelled = false
    setVoiceNotice('')
    setDraftAnswer('')
    setTurnPhase('speaking')

    ;(async () => {
      try {
        const res = await fetch(`${API_V1}/interview/session/${token}/speak`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: question }),
        })
        if (!res.ok) throw new Error(String(res.status))
        const blob = await res.blob()
        if (cancelled) return

        if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current)
        const url = URL.createObjectURL(blob)
        audioUrlRef.current = url
        const audio = new Audio(url)
        audioRef.current = audio
        isPlayingRef.current = true
        audio.onended = () => {
          isPlayingRef.current = false
          if (!cancelled) enterReady()
        }
        audio.onerror = () => {
          isPlayingRef.current = false
          if (!cancelled) enterReady('Audio playback failed - please read the question above.')
        }
        await audio.play()
      } catch {
        if (!cancelled) {
          isPlayingRef.current = false
          enterReady('Could not play the question aloud - please read it above.')
        }
      }
    })()

    return () => { cancelled = true }
  }, [status, qIndex, questions, token])


  function startRecording() {
    if (isPlayingRef.current || isRecordingRef.current) return
    const activeStream = streamRef.current
    if (!activeStream) return
    const mimeTypes = supportedAudioMimeTypes()
    if (mimeTypes.length === 0) return

    const audioOnly = new MediaStream(activeStream.getAudioTracks())

    chunksRef.current = []
    let recordedMimeType = mimeTypes[0]

    function buildRecorder(stream: MediaStream, mimeType: string, options: MediaRecorderOptions): MediaRecorder {
      const r = new MediaRecorder(stream, options)
      recordedMimeType = mimeType
      r.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      r.onstop = () => {
        isRecordingRef.current = false
        if (recordTimerRef.current) { clearInterval(recordTimerRef.current); recordTimerRef.current = null }
        const blob = new Blob(chunksRef.current, { type: recordedMimeType })
        chunksRef.current = []
        if (statusRef.current === 'active') uploadAnswer(blob, extensionForMimeType(recordedMimeType))
      }
      r.start()
      return r
    }

    const attempts: Array<[MediaStream, string, MediaRecorderOptions]> = []
    for (const stream of [audioOnly, activeStream]) {
      for (const mimeType of mimeTypes) {
        attempts.push([stream, mimeType, { mimeType, audioBitsPerSecond: ANSWER_BITRATE }])
        attempts.push([stream, mimeType, { mimeType }])
      }
    }
    attempts.push([audioOnly, mimeTypes[0], {}])
    attempts.push([activeStream, mimeTypes[0], {}])

    let recorder: MediaRecorder | null = null
    for (const [stream, mimeType, options] of attempts) {
      try {
        recorder = buildRecorder(stream, mimeType, options)
        break
      } catch {}
    }
    if (!recorder) {
      recorderRef.current = null
      enterReady('Could not start recording on this device. Please use the record button to try again.')
      return
    }
    recorderRef.current = recorder
    isRecordingRef.current = true
    setRecordSecs(0)
    setTurnPhase('recording')
    recordTimerRef.current = setInterval(() => {
      setRecordSecs(s => {
        const next = s + 1
        if (next >= MAX_ANSWER_SECONDS) stopRecording()
        return next
      })
    }, 1000)
  }

  function stopRecording() {
    if (!isRecordingRef.current) return
    setTurnPhase('transcribing')
    try { recorderRef.current?.stop() } catch {}
  }

  async function uploadAnswer(blob: Blob, ext: string) {
    isUploadingRef.current = true
    setTurnPhase('transcribing')
    try {
      const form = new FormData()
      form.append('file', blob, `answer.${ext}`)
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), TRANSCRIBE_TIMEOUT_MS)
      let res: Response
      try {
        res = await fetch(`${API_V1}/interview/session/${token}/transcribe`, {
          method: 'POST',
          body: form,
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timeoutId)
      }
      if (!res.ok) throw new Error(String(res.status))
      const data = await res.json() as { text: string }
      const text = (data.text || '').trim()
      if (!text) {
        enterReady('We could not hear an answer in that recording. Please record again.')
        return
      }
      setVoiceNotice('')
      if (autoAdvanceRef.current) {
        setDraftAnswer('')
        void advance(text)
        return
      }
      setDraftAnswer(text)
      setTurnPhase('review')
    } catch {
      enterReady('Transcription failed. Please check your connection and record your answer again.')
    } finally {
      isUploadingRef.current = false
    }
  }


  async function advance(text: string) {
    const answeredQuestion = questions[qIndex]
    const entry: TranscriptEntry = {
      question: answeredQuestion,
      answer: text,
      answered_at: new Date().toISOString(),
    }
    transcriptRef.current = [...transcriptRef.current, entry]
    setTranscript(t => [...t, entry])
    setDraftAnswer('')

    let followupQuestion: string | null = null
    if (text) {
      setTurnPhase('thinking')
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 8000)
        const res = await fetch(`${API_V1}/interview/session/${token}/followup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: answeredQuestion, answer: text }),
          signal: controller.signal,
        })
        clearTimeout(timeoutId)
        if (res.ok) {
          const data = await res.json() as FollowupResponse
          if (data && typeof data.followup === 'string' && data.followup.trim()) {
            followupQuestion = data.followup
          }
        }
      } catch {
      }
    }

    if (followupQuestion) {
      const inserted = followupQuestion
      setQuestions(qs => {
        const next = [...qs]
        next.splice(qIndex + 1, 0, inserted)
        return next
      })
      setQIndex(i => i + 1)
      return
    }

    if (qIndex + 1 >= questions.length) {
      doSubmit()
    } else {
      setQIndex(i => i + 1)
    }
  }

  function endInterview() {
    if (turnPhase === 'thinking' || turnPhase === 'transcribing') return
    doSubmit()
  }


  const messages = useMemo<ChatMessage[]>(() => {
    const msgs: ChatMessage[] = []
    transcript.forEach(({ question, answer }) => {
      msgs.push({ role: 'agent', content: question })
      if (answer) msgs.push({ role: 'candidate', content: answer })
      else msgs.push({ role: 'system', content: '(skipped)' })
    })
    if (status === 'active' && turnPhase !== 'thinking' && questions[qIndex] && qIndex >= transcript.length) {
      msgs.push({ role: 'agent', content: questions[qIndex] })
    }
    return msgs
  }, [transcript, qIndex, questions, status, turnPhase])

  function formatRemaining() {
    const rem = Math.max(0, durationSecs - elapsed)
    const m = Math.floor(rem / 60)
    const s = rem % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  function formatRecordTime() {
    const m = Math.floor(recordSecs / 60)
    const s = recordSecs % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  return {
    status, errorMsg, scheduledMsg, candidateName, codingAssigned,
    questions, qIndex, transcript, messages,
    durationSecs, elapsed, startedAt,
    turnPhase, draftAnswer, recordSecs, voiceNotice, readyToken,
    setDraftAnswer, setTurnPhase,
    mediaError, requestingMedia, stream, grantMediaAndStart,
    violationCount, warningOpen, setWarningOpen, fullscreenLost,
    handleProctoringFlag, sendFlag,
    startRecording, stopRecording, advance, endInterview,
    formatRemaining, formatRecordTime,
  }
}

export type InterviewSession = ReturnType<typeof useInterviewSession>
