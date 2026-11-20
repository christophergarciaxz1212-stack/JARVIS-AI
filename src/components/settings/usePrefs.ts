'use client'

import { useCallback, useEffect, useState } from 'react'
import type { Prefs } from '@/lib/prefs'

export type { Prefs }

let cache: Prefs | null = null
const EVENT = 'jarvis:prefs'

export async function loadPrefs(): Promise<Prefs> {
  const d = await fetch('/api/prefs', { cache: 'no-store' }).then(r => r.json())
  cache = d.prefs
  return d.prefs
}

export async function savePrefs(patch: Partial<Prefs> | { reset: true }): Promise<Prefs> {
  const body = 'reset' in patch ? { reset: true } : { prefs: patch }
  const d = await fetch('/api/prefs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json())
  if (!d.prefs) throw new Error(d.error || 'Não foi possível salvar as configurações')
  cache = d.prefs
  window.dispatchEvent(new CustomEvent(EVENT, { detail: d.prefs }))
  // The desktop shell (tray, start with Windows) applies its options as soon as they change
  if ('reset' in patch || 'desktop' in patch) window.electron?.desktopPrefsChanged?.().catch(() => {})
  return d.prefs
}

/** Preferences shared by every component; updates everywhere as soon as they are saved. */
export function usePrefs(): [Prefs | null, (patch: Partial<Prefs>) => Promise<void>] {
  const [prefs, setPrefs] = useState<Prefs | null>(cache)
  useEffect(() => {
    if (!cache) loadPrefs().then(setPrefs).catch(() => {})
    const on = (e: Event) => setPrefs((e as CustomEvent<Prefs>).detail)
    window.addEventListener(EVENT, on)
    return () => window.removeEventListener(EVENT, on)
  }, [])
  const update = useCallback(async (patch: Partial<Prefs>) => { setPrefs(await savePrefs(patch)) }, [])
  return [prefs, update]
}
