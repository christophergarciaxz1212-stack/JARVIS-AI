'use client'

import { useCallback, useEffect, useState } from 'react'

export interface SpeakRequest { text?: string; preview?: boolean; voice?: string; model?: string; style?: string; provider?: 'gemini' | 'windows' | 'piper' }

type State = { key: string | null; loading: boolean }
let current: { audio: HTMLAudioElement; url: string; key: string } | null = null
let pending: AbortController | null = null
let state: State = { key: null, loading: false }
const listeners = new Set<(s: State) => void>()
const emit = (s: State) => { state = s; listeners.forEach(l => l(s)) }

export function stopSpeech() {
  pending?.abort()
  pending = null
  if (current) { current.audio.pause(); URL.revokeObjectURL(current.url); current = null }
  emit({ key: null, loading: false })
}

/** Plays speech from /api/voice. One voice at a time: starting another stops the previous one. */
export async function playSpeech(key: string, req: SpeakRequest): Promise<{ provider: string; note?: string }> {
  stopSpeech()
  const ctrl = new AbortController()
  pending = ctrl
  emit({ key, loading: true })
  try {
    const res = await fetch('/api/voice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req), signal: ctrl.signal })
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Erro ${res.status}`)
    const blob = await res.blob()
    if (ctrl.signal.aborted) throw new DOMException('cancelado', 'AbortError')
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    current = { audio, url, key }
    pending = null
    audio.onended = () => { if (current?.audio === audio) stopSpeech() }
    await audio.play()
    emit({ key, loading: false })
    return { provider: decodeURIComponent(res.headers.get('x-voice-provider') || ''), note: res.headers.get('x-voice-note') ? decodeURIComponent(res.headers.get('x-voice-note')!) : undefined }
  } catch (e) {
    if (pending === ctrl) pending = null
    if ((e as Error).name !== 'AbortError') emit({ key: null, loading: false })
    throw e
  }
}

/** Which item is speaking/loading right now (for play/stop buttons). */
export function useSpeechState(): State {
  const [s, set] = useState<State>(state)
  useEffect(() => { listeners.add(set); return () => { listeners.delete(set) } }, [])
  return s
}

export function useSpeech() {
  const s = useSpeechState()
  const toggle = useCallback(async (key: string, req: SpeakRequest) => {
    if (s.key === key) { stopSpeech(); return null }
    return playSpeech(key, req)
  }, [s.key])
  return { ...s, toggle, stop: stopSpeech }
}
