'use client'

import { useEffect, useState } from 'react'
import type { Run, RunEvent } from '@/lib/agents/types'

/**
 * Subscribes to a run's SSE stream (/api/agents/runs/:id/events).
 * Emits the first `snapshot` (run + existing events), then live `event`s and `run` updates.
 */
export function useRunStream(runId: string | undefined, onEnd?: () => void) {
  const [run, setRun] = useState<Run | null>(null)
  const [events, setEvents] = useState<RunEvent[]>([])
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    if (!runId) return
    setRun(null)
    setEvents([])
    setConnected(false)
    const es = new EventSource(`/api/agents/runs/${runId}/events`)
    es.addEventListener('snapshot', e => {
      const d = JSON.parse((e as MessageEvent).data)
      setRun(d.run)
      setEvents(d.events || [])
      setConnected(true)
    })
    es.addEventListener('event', e => {
      const ev = JSON.parse((e as MessageEvent).data) as RunEvent
      setEvents(prev => (prev.some(p => p.id === ev.id) ? prev : [...prev.slice(-700), ev]))
    })
    es.addEventListener('run', e => setRun(JSON.parse((e as MessageEvent).data)))
    es.addEventListener('end', () => { es.close(); setConnected(false); onEnd?.() })
    // A dropped connection reconnects by itself and receives a fresh snapshot; a fatal one (404) is already CLOSED
    es.onerror = () => setConnected(false)
    return () => es.close()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onEnd is intentionally not a dep; re-subscribing on every render would thrash the stream
  }, [runId])

  return { run, events, connected }
}
