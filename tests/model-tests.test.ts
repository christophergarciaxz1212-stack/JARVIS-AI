import { describe, it, expect } from 'vitest'
import { classifyFailure, isHiddenModel, measuredMs, readModelTests, recordModelTest } from '@/lib/ai/modelTests'

describe('model test results', () => {
  it('402 "payment method required" means no free tier for this account (not a passing hiccup)', () => {
    expect(classifyFailure('402 A payment method is required. Add one at https://cloud.sambanova.ai/plans/billing to continue.')).toBe('no-free-quota')
  })

  it('classifies real provider errors', () => {
    expect(classifyFailure('[404 ] This model models/gemini-2.5-flash is no longer available to new users.')).toBe('retired')
    expect(classifyFailure('[429 ] You exceeded your current quota... * Quota exceeded for metric: generate_content_free_tier_requests, limit: 0, model: gemini-pro-latest')).toBe('no-free-quota')
    expect(classifyFailure('403 thinkingmachines/inkling-2-small:free is only available on agentic harnesses.')).toBe('blocked')
    expect(classifyFailure('[503 ] This model is currently experiencing high demand.')).toBe('temporary')
    expect(classifyFailure('429 Provider returned error')).toBe('temporary')
    expect(classifyFailure('The operation was aborted due to timeout')).toBe('temporary')
  })

  it('hides only permanent failures, and keeps latency of working models', () => {
    recordModelTest('gemini|gemini-2.5-flash', { ok: false, error: '[404 ] no longer available to new users' })
    recordModelTest('gemini|gemini-3.7-flash', { ok: false, error: '[503 ] high demand' })
    recordModelTest('groq|openai/gpt-oss-120b', { ok: true, ms: 426.4 })
    const tests = readModelTests()
    expect(isHiddenModel('gemini|gemini-2.5-flash', tests)).toBe(true)
    expect(isHiddenModel('gemini|gemini-3.7-flash', tests)).toBe(false)
    expect(isHiddenModel('groq|openai/gpt-oss-120b', tests)).toBe(false)
    expect(measuredMs('groq|openai/gpt-oss-120b', tests)).toBe(426)
  })

  it('a transient error does not erase a model that worked', () => {
    recordModelTest('groq|openai/gpt-oss-20b', { ok: true, ms: 352 })
    recordModelTest('groq|openai/gpt-oss-20b', { ok: false, error: '429 rate limit reached, retry in 2s' })
    expect(readModelTests()['groq|openai/gpt-oss-20b'].ok).toBe(true)
  })
})

describe('capacidades por função (streaming para o chat, JSON para agentes/roteiro/Hub)', () => {
  const provider = (ids: string[]) => [{ id: 'groq', name: 'Groq', icon: '', envKey: '', baseUrl: '', free: true, status: 'connected' as const, models: ids.map(id => ({ id, name: id, provider: 'groq', providerName: 'Groq', category: 'chat' as const, contextWindow: 131072, maxTokens: 8192, free: true, multimodal: false, toolSupport: true, streaming: true, speed: 'fast' as const, status: 'available' as const })) }]

  it('só marca falta de capacidade quando um teste completo provou; o teste simples preserva o que se sabe', async () => {
    const { lacksCapability } = await import('@/lib/ai/modelTests')
    expect(lacksCapability('groq|nunca-testado', 'json')).toBe(false)
    recordModelTest('groq|sem-json', { ok: true, ms: 300, caps: { stream: true, json: false }, capErrors: { json: 'JSON inválido' } })
    expect(lacksCapability('groq|sem-json', 'json')).toBe(true)
    expect(lacksCapability('groq|sem-json', 'stream')).toBe(false)
    recordModelTest('groq|sem-json', { ok: true, ms: 250 })
    expect(readModelTests()['groq|sem-json'].caps).toEqual({ stream: true, json: false })
  })

  it('a cadeia de fallback de cada função pula modelos sem a capacidade; o padrão precisa das duas', async () => {
    const { fallbackChain, defaultModelFrom } = await import('@/lib/ai/catalog')
    recordModelTest('groq|faz-tudo', { ok: true, ms: 900, caps: { stream: true, json: true } })
    recordModelTest('groq|sem-stream', { ok: true, ms: 100, caps: { stream: false, json: true } })
    recordModelTest('groq|so-texto', { ok: true, ms: 50, caps: { stream: true, json: false } })
    const cat = provider(['groq|sem-stream', 'groq|so-texto', 'groq|faz-tudo'])
    expect(fallbackChain(cat, '', 5, 'json')).toEqual(expect.arrayContaining(['groq|faz-tudo', 'groq|sem-stream']))
    expect(fallbackChain(cat, '', 5, 'json')).not.toContain('groq|so-texto')
    expect(fallbackChain(cat, '', 5)).not.toContain('groq|sem-stream')
    // Escolha do usuário continua em primeiro, mesmo sem a capacidade
    expect(fallbackChain(cat, 'groq|so-texto', 5, 'json')[0]).toBe('groq|so-texto')
    expect(defaultModelFrom(cat)).toBe('groq|faz-tudo')
  })
})

describe('modelos que não conversam ficam fora do catálogo', () => {
  it('tradutor, embeddings, guardas e fala saem; modelos de chat ficam', async () => {
    const { isConversational } = await import('@/lib/ai/catalog')
    for (const id of ['nvidia|nvidia/riva-translate-4b-instruct-v2', 'nvidia|nvidia/nv-embedqa-e5-v5', 'nvidia|nvidia/llama-3.1-nemoguard-8b-content-safety', 'nvidia|nvidia/llama-3.3-nemotron-70b-reward', 'openrouter|openai/whisper-large-v3'])
      expect(isConversational(id), id).toBe(false)
    for (const id of ['groq|openai/gpt-oss-120b', 'nvidia|nvidia/nemotron-3.5-bolt-e4b', 'gemini|gemini-3.5-flash-lite', 'ollama|gemma3:4b', 'opencode|big-pickle'])
      expect(isConversational(id), id).toBe(true)
  })

  it('quem ecoa ou traduz a pergunta do teste é classificado como bloqueado (some do seletor)', () => {
    expect(classifyFailure('O modelo não segue instruções (não é de conversa?): "How much is 7 + 5?"')).toBe('blocked')
  })
})
