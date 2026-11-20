import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * O registro do provedor personalizado e do Anthropic acontece na importação do
 * módulo (lendo o env). Cada teste reimporta o módulo com o env controlado.
 */

const BASE_ENV = { ...process.env }

function cleanEnv() {
  delete process.env.CUSTOM_AI_BASE_URL
  delete process.env.CUSTOM_AI_API_KEY
  delete process.env.CUSTOM_AI_MODEL
  delete process.env.CUSTOM_AI_NAME
  delete process.env.JARVIS_ALLOW_PAID
  delete process.env.ANTHROPIC_API_KEY
}

beforeEach(cleanEnv)
afterEach(() => { process.env = { ...BASE_ENV }; vi.resetModules() })

describe('provedor personalizado (OpenAI-compatible)', () => {
  it('nem aparece quando não configurado', async () => {
    vi.resetModules()
    const { PROVIDER_APIS, chatProviders } = await import('@/lib/ai/providers')
    expect(PROVIDER_APIS.find(p => p.id === 'custom')).toBeUndefined()
    expect(chatProviders().find(p => p.id === 'custom')).toBeUndefined()
  })

  it('aparece quando configurado, como gratuito e sem chave obrigatória', async () => {
    process.env.CUSTOM_AI_BASE_URL = 'http://127.0.0.1:4040/v1/'
    vi.resetModules()
    const { PROVIDER_APIS, chatProviders, ALLOWED_ENV_KEYS } = await import('@/lib/ai/providers')
    const custom = PROVIDER_APIS.find(p => p.id === 'custom')
    expect(custom).toBeTruthy()
    expect(custom?.free).toBe(true)
    expect(custom?.chatBaseUrl).toBe('http://127.0.0.1:4040/v1') // barra final removida
    expect(custom?.mayBeKeyless).toBe(true)
    expect(chatProviders().map(p => p.id)).toContain('custom')
    expect(ALLOWED_ENV_KEYS.has('CUSTOM_AI_API_KEY')).toBe(true)
  })

  it('com CUSTOM_AI_MODEL, lista esse modelo sem consultar /models', async () => {
    process.env.CUSTOM_AI_BASE_URL = 'http://127.0.0.1:4040/v1'
    process.env.CUSTOM_AI_MODEL = 'meu-modelo-local'
    vi.resetModules()
    const { PROVIDER_APIS } = await import('@/lib/ai/providers')
    const custom = PROVIDER_APIS.find(p => p.id === 'custom')!
    const models = await custom.listModels('custom')
    expect(models).toHaveLength(1)
    expect(models[0].id).toBe('custom|meu-modelo-local')
  })
})

describe('Anthropic (pago, removido)', () => {
  it('não está mais registrado em PROVIDER_APIS (removido por inconsistência)', async () => {
    vi.resetModules()
    const { PROVIDER_APIS, chatProviders } = await import('@/lib/ai/providers')
    expect(PROVIDER_APIS.find(p => p.id === 'anthropic')).toBeUndefined()
    expect(chatProviders().map(p => p.id)).not.toContain('anthropic')
  })
})
