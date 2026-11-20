import { describe, it, expect, afterEach } from 'vitest'
import { OPENCODE_PROVIDER, OPENCODE_FREE_MODELS, opencodeCliPath, parseNdjson, probeOpencode } from '@/lib/ai/opencodeBridge'
import { splitModelId } from '@/lib/ai/providers'
import { classifyModelError } from '@/lib/ai/client'
import { budgetTier } from '@/lib/ai/freeTier'
import { resolveCapabilities } from '@/lib/ai/capabilities'

const ORIGINAL_CLI = process.env.OPENCODE_CLI

afterEach(() => {
  if (ORIGINAL_CLI === undefined) delete process.env.OPENCODE_CLI
  else process.env.OPENCODE_CLI = ORIGINAL_CLI
})

describe('ponte OpenCode (pool grátis)', () => {
  it('splitModelId separa o provedor opencode dos modelos', () => {
    expect(splitModelId('opencode|big-pickle')).toEqual({ provider: 'opencode', model: 'big-pickle' })
  })

  it('o catálogo grátis é estável e com IDs únicos', () => {
    expect(OPENCODE_FREE_MODELS.length).toBe(12)
    expect(new Set(OPENCODE_FREE_MODELS.map(m => m.id)).size).toBe(OPENCODE_FREE_MODELS.length)
    for (const m of OPENCODE_FREE_MODELS) {
      expect(['chat', 'fast', 'code', 'reasoning', 'vision']).toContain(m.category)
      expect(['fast', 'medium', 'slow']).toContain(m.speed)
    }
    // Os modelos mais valiosos do pool não podem sumir silenciosamente da lista:
    expect(OPENCODE_FREE_MODELS.map(m => m.id)).toEqual(expect.arrayContaining(['big-pickle', 'nemotron-3.5-super-vl-free', 'deepseek-v4.1-flash-free']))
  })

  it('parseNdjson extrai texto e tokens reais de uma sessão típica', () => {
    const ndjson = [
      '{"type":"step_start","part":{"type":"step-start"}}',
      '{"type":"text","part":{"type":"text","text":"Resposta "}}',
      'linha que não é JSON e deve ser ignorada',
      '{"type":"text","part":{"type":"text","text":"final."}}',
      '{"type":"step_finish","part":{"type":"step-finish","reason":"stop","cost":0,"tokens":{"input":3642,"output":9,"reasoning":100}}}',
      '',
    ].join('\n')
    const parsed = parseNdjson(ndjson)
    expect(parsed.text).toBe('Resposta final.')
    expect(parsed.inputTokens).toBe(3642)
    expect(parsed.outputTokens).toBe(9)
    expect(parsed.cost).toBe(0)
    expect(parsed.error).toBeUndefined()
  })

  it('parseNdjson reconhece a cota grátis esgotada com status 429 e retryAfterMs', () => {
    const ndjson = '{"type":"error","error":{"type":"provider.free-limit","message":"Free usage limit reached. Connect a provider or subscribe to OpenCode Go to keep going, or switch models.","status":429,"retryAfterMs":42634000}}'
    const parsed = parseNdjson(ndjson)
    expect(parsed.error).toEqual({
      status: 429,
      message: 'Free usage limit reached. Connect a provider or subscribe to OpenCode Go to keep going, or switch models.',
      retryAfterMs: 42_634_000,
    })
  })

  it('a mensagem de cota esgotada é classificada como rate_limit (agente troca de modelo em vez de repetir)', () => {
    const err = Object.assign(new Error('Free usage limit reached. Connect a provider or subscribe to OpenCode Go to keep going, or switch models.'), {
      status: 429,
      headers: { 'retry-after': '42634' },
    })
    const kind = classifyModelError(err)
    expect(kind.kind).toBe('rate_limit')
    expect(kind.retryAfterMs).toBe(42_634_000)
  })

  it('o provedor é tratado como faixa pequena (16k de entrada), nunca ilimitado', () => {
    expect(budgetTier('opencode|big-pickle')).toBe('small')
  })

  it('as capacidades são de modelo grátis, sem ferramentas nativas (protocolo JARVIS)', () => {
    const caps = resolveCapabilities('opencode|big-pickle')
    expect(caps.free).toBe(true)
    expect(caps.tools).toBe(false)
    expect(caps.json).toBe('prompt')
  })

  it('sem o binário do OpenCode, o provedor aparece como desconectado (nunca como quebrado)', async () => {
    process.env.OPENCODE_CLI = 'C:\\caminho\\que\\nao\\existe\\opencode-cli.exe'
    expect(opencodeCliPath()).toBeNull()
    const probe = await probeOpencode()
    expect(probe.id).toBe(OPENCODE_PROVIDER.id)
    expect(probe.status).toBe('disconnected')
    expect(probe.models).toEqual([])
    expect(probe.free).toBe(true)
  })
})
