import { describe, it, expect, vi, afterEach } from 'vitest'

const SSE = [
  'data: {"type":"message_start","message":{"usage":{"input_tokens":42}}}',
  '',
  'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Olá"}}',
  '',
  'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":", mundo"}}',
  '',
  'data: {"type":"message_delta","usage":{"output_tokens":7}}',
  '',
  'data: {"type":"message_stop"}',
  '',
].join('\n')

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.JARVIS_ALLOW_PAID
  delete process.env.ANTHROPIC_API_KEY
  vi.resetModules()
})

describe('streamAI — Anthropic Messages API (SSE)', () => {
  it('faz o parse do SSE e reporta uso real de tokens', async () => {
    process.env.JARVIS_ALLOW_PAID = '1'
    process.env.ANTHROPIC_API_KEY = 'test-key'
    vi.resetModules()

    vi.stubGlobal('fetch', vi.fn(async () => new Response(SSE, { status: 200, headers: { 'content-type': 'text/event-stream' } })))

    const { streamAI } = await import('@/lib/ai/client')
    let text = ''
    let usage: { inputTokens: number; outputTokens: number } | undefined
    await streamAI('anthropic|claude-haiku-4-5', [{ role: 'user', content: 'oi' }], c => {
      if (c.content) text += c.content
      if (c.done) usage = c.usage
    })
    expect(text).toBe('Olá, mundo')
    expect(usage).toEqual({ inputTokens: 42, outputTokens: 7 })
  })

  it('401 vira erro de credencial claro', async () => {
    process.env.JARVIS_ALLOW_PAID = '1'
    process.env.ANTHROPIC_API_KEY = 'bad-key'
    vi.resetModules()

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'invalid x-api-key' } }), { status: 401 })))

    const { streamAI } = await import('@/lib/ai/client')
    await expect(streamAI('anthropic|claude-haiku-4-5', [{ role: 'user', content: 'oi' }], () => {}))
      .rejects.toThrow(/inválida/i)
  })

  it('provedor anthropic removido: streamAI falha', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key'
    // Anthropic foi removido de PROVIDER_APIS (provedor inconsistente)
    vi.resetModules()
    const { streamAI } = await import('@/lib/ai/client')
    await expect(streamAI('anthropic|claude-haiku-4-5', [{ role: 'user', content: 'oi' }], () => {}))
      .rejects.toThrow(/inválida|provedor|não suportado/i)
  })
})
