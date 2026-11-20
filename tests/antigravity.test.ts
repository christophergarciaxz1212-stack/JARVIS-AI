import { describe, it, expect, afterEach } from 'vitest'
import { ANTIGRAVITY_MODELS, buildPrompt, callAntigravity, parseAgyError, probeAntigravity } from '@/lib/ai/antigravity'
import { splitModelId } from '@/lib/ai/providers'
import { classifyModelError } from '@/lib/ai/client'
import { ModelHealth } from '@/lib/agents/models'

// stderr real do agy 1.5.12 com a cota individual esgotada (medido em 19/11/2026)
const QUOTA_STDERR = [
  'error: Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 139h50m29s.',
  'AGY_ERROR: {"short_error":"RESOURCE_EXHAUSTED (code 429): Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 139h50m29s.","status":"RESOURCE_EXHAUSTED","error_code":429,"code_kind":"http","retryable":true,"error_id":"x"}',
].join('\n')

const ORIGINAL_AGY = process.env.AGY_PATH

afterEach(() => {
  if (ORIGINAL_AGY === undefined) delete process.env.AGY_PATH
  else process.env.AGY_PATH = ORIGINAL_AGY
})

describe('ponte Antigravity (modelos grátis)', () => {
  it('splitModelId separa o provedor antigravity dos modelos', () => {
    expect(splitModelId('antigravity|claude-sonnet-4-6')).toEqual({ provider: 'antigravity', model: 'claude-sonnet-4-6' })
  })

  it('buildPrompt dobra sistema/usuário num único prompt com marcadores', () => {
    const prompt = buildPrompt([
      { role: 'system', content: 'Seja breve' },
      { role: 'user', content: 'oi tudo bem?' },
      { role: 'assistant', content: 'tudo bem' },
      { role: 'user', content: 'e aí?' },
    ])
    expect(prompt).toContain('# Instruções do sistema\nSeja breve')
    expect(prompt).toContain('# Usuário\noi tudo bem?')
    expect(prompt).toContain('# Você (resposta anterior)\ntudo bem')
    expect(prompt).toContain('# Usuário\ne aí?')
    expect(prompt.trim().endsWith('# Sua resposta')).toBe(true)
  })

  it('o catálogo de modelos grátis é estável e todos são marcados como disponíveis para o tier Free', () => {
    expect(ANTIGRAVITY_MODELS.length).toBe(6)
    expect(new Set(ANTIGRAVITY_MODELS.map(m => m.id)).size).toBe(ANTIGRAVITY_MODELS.length)
    expect(ANTIGRAVITY_MODELS.every(m => ['chat', 'fast', 'code', 'reasoning', 'vision'].includes(m.category))).toBe(true)
    // Os três que funcionam sem estourar a cota do tier Free nesta máquina:
    expect(ANTIGRAVITY_MODELS.map(m => m.id)).toEqual(expect.arrayContaining(['claude-sonnet-4-6', 'claude-opus-4-6-thinking', 'gpt-oss-120b-medium']))
  })

  it('sem o binário agy, o provedor aparece como desconectado (nunca como quebrado)', async () => {
    process.env.AGY_PATH = 'C:\\caminho\\que\\nao\\existe\\agy.exe'
    const probe = await probeAntigravity()
    expect(probe.id).toBe('antigravity')
    expect(probe.status).toBe('disconnected')
    expect(probe.models).toEqual([])
    expect(probe.free).toBe(true)
  })

  it('lê a cota esgotada do stderr: status 429 e o prazo real até a cota voltar', () => {
    const parsed = parseAgyError(QUOTA_STDERR)
    expect(parsed?.status).toBe(429)
    expect(parsed?.message).toMatch(/^RESOURCE_EXHAUSTED \(code 429\): Individual quota reached/)
    expect(parsed?.retryAfterMs).toBe(((139 * 60 + 50) * 60 + 29) * 1000)
    // Sem a linha AGY_ERROR, a linha "error:" basta
    expect(parseAgyError('error: Individual quota reached. Resets in 2h.')).toMatchObject({ status: 429, retryAfterMs: 7_200_000 })
    expect(parseAgyError('')).toBeNull()
  })

  it('a cota com prazo longo esfria o modelo até o prazo (no máximo 24 h), não por 5 min', () => {
    const parsed = parseAgyError(QUOTA_STDERR)!
    const err = Object.assign(new Error(parsed.message), { status: parsed.status, headers: { 'retry-after': String(Math.round(parsed.retryAfterMs! / 1000)) } })
    const cls = classifyModelError(err)
    expect(cls.kind).toBe('rate_limit')
    const health = new ModelHealth()
    health.reportFailure('antigravity|gpt-oss-120b-medium', cls.kind, cls.message, cls.retryAfterMs)
    const until = health.snapshot().find(e => e.model === 'antigravity|gpt-oss-120b-medium')!.cooldownUntil
    expect(until - Date.now()).toBeGreaterThan(23 * 3_600_000)
  })

  it('conversa grande demais para a linha de comando do Windows vira erro de contexto (troca de modelo)', async () => {
    process.env.AGY_PATH = process.execPath // existe, mas não deve ser chamado
    const big = [{ role: 'user' as const, content: 'x'.repeat(31_000) }]
    const err = await callAntigravity('gpt-oss-120b-medium', big).catch(e => e as Error)
    expect(String(err)).toMatch(/longa demais/)
    expect(classifyModelError(err).kind).toBe('context')
  })

  it('respeita o cancelamento antes de chamar o CLI', async () => {
    process.env.AGY_PATH = process.execPath
    const ac = new AbortController()
    ac.abort()
    const err = await callAntigravity('gpt-oss-120b-medium', [{ role: 'user', content: 'oi' }], 5_000, ac.signal).then(() => null, (e: Error) => e)
    expect(err?.name).toBe('AbortError')
  })
})

describe('cota do dia esgotada vale para o provedor inteiro', () => {
  it('OpenRouter "free-models-per-day" esfria todos os modelos :free do provedor, e um sucesso libera', () => {
    const health = new ModelHealth()
    health.reportFailure('openrouter|a:free', 'rate_limit', '429 Rate limit exceeded: free-models-per-day. Add 10 credits')
    expect(health.providerCooling('openrouter|b:free')).toBe(true)
    expect(health.state('openrouter|outro:free')).toBe('cooling')
    expect(health.state('groq|openai/gpt-oss-120b')).toBe('ok')
    health.reportSuccess('openrouter|c:free')
    expect(health.providerCooling('openrouter|b:free')).toBe(false)
  })
  it('limite por minuto continua só no modelo que falhou', () => {
    const health = new ModelHealth()
    health.reportFailure('openrouter|a:free', 'rate_limit', '429 Rate limit exceeded: free-models-per-min.')
    expect(health.state('openrouter|b:free')).toBe('ok')
  })
})
