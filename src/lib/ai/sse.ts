/**
 * Server-Sent Events: codificação canônica e parser incremental.
 *
 * O parser aceita pacotes TCP cortados no meio de uma linha, CRLF de proxies e
 * linhas `data:` múltiplas (o padrão junta com "\n"). Comentários (`: ping`) são
 * heartbeats e não viram eventos.
 */

export interface SSEEvent {
  event?: string
  data: string
  id?: string
  retry?: number
}

/** Heartbeat para manter viva a conexão enquanto um modelo local carrega. */
export const SSE_HEARTBEAT = ': ping\n\n'

/** Um evento SSE completo. Objetos são serializados em JSON. */
export function formatSSE(data: unknown, event?: string): string {
  const payload = typeof data === 'string' ? data : JSON.stringify(data)
  const lines = payload.split(/\r?\n/).map(line => `data: ${line}`)
  return `${event ? `event: ${event}\n` : ''}${lines.join('\n')}\n\n`
}

/**
 * Parser incremental. `push` devolve todos os eventos completos do trecho e
 * guarda o resto para o próximo pacote. `flush` processa um último evento sem
 * a linha em branco final (conexão encerrada abruptamente).
 */
export class SSEParser {
  private buffer = ''
  private eventName: string | undefined
  private dataLines: string[] = []
  private lastId: string | undefined
  private retryMs: number | undefined

  push(chunk: string): SSEEvent[] {
    this.buffer += chunk
    // Normaliza CRLF/CR para que a divisão por linha seja sempre a mesma
    this.buffer = this.buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    const events: SSEEvent[] = []
    let index = this.buffer.indexOf('\n')

    while (index >= 0) {
      const line = this.buffer.slice(0, index)
      this.buffer = this.buffer.slice(index + 1)
      const parsed = this.consumeLine(line)
      if (parsed) events.push(parsed)
      index = this.buffer.indexOf('\n')
    }

    return events
  }

  /** Fecha um evento pendente quando o stream termina sem a linha em branco. */
  flush(): SSEEvent[] {
    const events: SSEEvent[] = []
    if (this.buffer.length) {
      const parsed = this.consumeLine(this.buffer)
      this.buffer = ''
      if (parsed) events.push(parsed)
    }
    const pending = this.dispatch()
    if (pending) events.push(pending)
    return events
  }

  private consumeLine(line: string): SSEEvent | null {
    if (line === '') return this.dispatch()
    if (line.startsWith(':')) return null // heartbeat/comentário

    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)

    switch (field) {
      case 'event': this.eventName = value; break
      case 'data': this.dataLines.push(value); break
      case 'id': this.lastId = value; break
      case 'retry': {
        const n = Number(value)
        if (Number.isFinite(n) && n >= 0) this.retryMs = n
        break
      }
      default: break // campos desconhecidos são ignorados, como manda a especificação
    }
    return null
  }

  private dispatch(): SSEEvent | null {
    if (!this.dataLines.length) {
      this.eventName = undefined
      return null
    }
    const event: SSEEvent = {
      data: this.dataLines.join('\n'),
      ...(this.eventName ? { event: this.eventName } : {}),
      ...(this.lastId ? { id: this.lastId } : {}),
      ...(this.retryMs !== undefined ? { retry: this.retryMs } : {}),
    }
    this.eventName = undefined
    this.dataLines = []
    return event
  }
}
