/** Eventos de andamento enviados pela rota de chat antes do primeiro token. */
export type StreamPhase = 'connecting' | 'retry' | 'fallback' | 'streaming'

export interface StreamStatus {
  phase: StreamPhase
  model?: string
  from?: string
  attempt?: number
  delayMs?: number
  reason?: string
  message?: string
}

/** Nome curto e legível de um id "provedor|modelo". */
export function shortModelName(id?: string): string {
  if (!id) return 'modelo'
  return id.slice(id.indexOf('|') + 1).split('/').pop()!.replace(/:free$/, '')
}
