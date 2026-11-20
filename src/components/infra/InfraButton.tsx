'use client'

import { useEffect, useRef } from 'react'
import { toast } from 'sonner'

interface Alerts { open: number; unacknowledged: Array<{ id: string; monitorName: string; cause: string }>; approvals: number }

/**
 * Background watcher for the Infrastructure Core (no button: infrastructure is driven from the chat).
 * New incidents still reach the user as a toast and a desktop notification.
 */
export default function InfraAlerts({ onOpen }: { onOpen: () => void }) {
  const seen = useRef<Set<string> | null>(null)
  const openRef = useRef(onOpen)
  openRef.current = onOpen

  useEffect(() => {
    let stop = false
    const poll = async () => {
      try {
        const res = await fetch('/api/infra?action=alerts', { cache: 'no-store' })
        if (!res.ok) return
        const data = (await res.json()) as Alerts
        if (stop) return
        // First poll only records what already exists: notify only incidents that appear later
        if (seen.current) {
          for (const inc of data.unacknowledged) {
            if (seen.current.has(inc.id)) continue
            toast.error(`Incidente: ${inc.monitorName}`, { description: inc.cause, duration: 15_000, action: { label: 'Ver', onClick: () => openRef.current() } })
            if (typeof Notification !== 'undefined') {
              if (Notification.permission === 'default') Notification.requestPermission().catch(() => {})
              else if (Notification.permission === 'granted') { try { new Notification(`JARVIS — ${inc.monitorName} caiu`, { body: inc.cause }) } catch {} }
            }
          }
        }
        seen.current = new Set(data.unacknowledged.map(i => i.id))
      } catch {}
    }
    poll()
    const t = setInterval(poll, 30_000)
    return () => { stop = true; clearInterval(t) }
  }, [])

  return null
}
