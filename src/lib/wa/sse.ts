/**
 * JARVIS — Barramento de eventos em tempo real (server-sent events).
 * globalThis para sobreviver ao ciclo de vida das rotas. Um consumidor por
 * navegador/aba; o Centro do WhatsApp assina /api/whatsapp/sse.
 */
type Listener = (payload: unknown) => void

const g = globalThis as unknown as { __jarvisWaBus?: Set<Listener> }
const bus = (): Set<Listener> => (g.__jarvisWaBus ||= new Set())

export function publishWa(payload: unknown) {
  for (const fn of [...bus()]) {
    try { fn(payload) } catch {}
  }
}

export function subscribeWa(fn: Listener): () => void {
  bus().add(fn)
  return () => { bus().delete(fn) }
}
