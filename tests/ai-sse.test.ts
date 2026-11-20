import { describe, expect, it } from 'vitest'
import { formatSSE, SSE_HEARTBEAT, SSEParser } from '@/lib/ai/sse'

describe('SSE', () => {
  it('codifica objetos e eventos nomeados no formato do padrão', () => {
    expect(formatSSE({ type: 'chunk', content: 'oi' })).toBe('data: {"type":"chunk","content":"oi"}\n\n')
    expect(formatSSE('linha', 'status')).toBe('event: status\ndata: linha\n\n')
  })

  it('junta data em múltiplas linhas com quebra de linha', () => {
    const out = formatSSE('a\nb')
    expect(out).toBe('data: a\ndata: b\n\n')
    const parser = new SSEParser()
    expect(parser.push(out)[0].data).toBe('a\nb')
  })

  it('remonta eventos cortados entre pacotes', () => {
    const parser = new SSEParser()
    expect(parser.push('data: {"type":"chu')).toEqual([])
    const events = parser.push('nk","content":"ok"}\n\n')
    expect(events).toHaveLength(1)
    expect(JSON.parse(events[0].data)).toEqual({ type: 'chunk', content: 'ok' })
  })

  it('aceita CRLF de proxies e ignora heartbeats', () => {
    const parser = new SSEParser()
    const events = parser.push(`${SSE_HEARTBEAT}data: um\r\ndata: dois\r\n\r\ndata: três\n\n`)
    expect(events.map(e => e.data)).toEqual(['um\ndois', 'três'])
  })

  it('processa um último evento sem linha em branco final', () => {
    const parser = new SSEParser()
    expect(parser.push('data: {"type":"done"}')).toEqual([])
    const events = parser.flush()
    expect(events).toHaveLength(1)
    expect(events[0].data).toBe('{"type":"done"}')
  })

  it('leva id, retry e event para o evento emitido', () => {
    const parser = new SSEParser()
    const [event] = parser.push('event: model\nid: 7\nretry: 1200\ndata: x\n\n')
    expect(event).toMatchObject({ event: 'model', id: '7', retry: 1200, data: 'x' })
  })
})
