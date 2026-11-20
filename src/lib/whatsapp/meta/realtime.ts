type Listener = (event: string, data: unknown) => void

const g = globalThis as unknown as { __jarvisWaMetaListeners?: Set<Listener> }
const listeners = (g.__jarvisWaMetaListeners ||= new Set<Listener>())

export function subscribe(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function broadcast(event: string, data: unknown) {
  for (const fn of listeners) {
    try { fn(event, data) } catch {}
  }
}