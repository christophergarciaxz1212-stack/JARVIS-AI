import { describe, it, expect } from 'vitest'
import { chatProviders, PAID_ENABLED } from '@/lib/ai/providers'
import { rankModels } from '@/lib/ai/catalog'
import { LOCAL_MODELS } from '@/lib/ai/local'
import type { AIModel, Provider } from '@/types'

function model(id: string, provider: string, free: boolean): AIModel {
  return {
    id: `${provider}|${id}`,
    name: id,
    provider,
    providerName: provider,
    category: 'chat',
    contextWindow: 128_000,
    maxTokens: 8192,
    free,
    multimodal: false,
    toolSupport: true,
    streaming: true,
    speed: 'medium',
    status: 'available',
  }
}

function provider(id: string, models: AIModel[]): Provider {
  return { id, name: id, icon: '', envKey: '', free: true, status: 'connected', models }
}

describe('catálogo gratuito', () => {
  it('não expõe provedores pagos enquanto JARVIS_ALLOW_PAID está desligado', () => {
    if (PAID_ENABLED) return
    const ids = chatProviders().map(p => p.id)
    expect(ids).not.toContain('openai')
    expect(ids).not.toContain('anthropic')
    expect(ids).not.toContain('deepseek')
    expect(ids).not.toContain('xai')
    expect(chatProviders().every(p => p.free !== false)).toBe(true)
  })

  it('remove modelo pago do ranking, mesmo se o provedor listar um', () => {
    const ranked = rankModels([
      provider('openrouter', [
        model('pago/modelo', 'openrouter', false),
        model('gratis/modelo:free', 'openrouter', true),
      ]),
    ], 'chat')
    expect(ranked.map(m => m.id)).toEqual(['openrouter|gratis/modelo:free'])
  })

  it('prefere um modelo local pequeno a um 8B em tarefa rápida', () => {
    const ranked = rankModels([
      provider('ollama', [
        model('deepseek-r1:8b', 'ollama', true),
        model('llama3.2:3b', 'ollama', true),
      ]),
    ], 'fast')
    const ids = ranked.map(m => m.id)
    expect(ids.indexOf('ollama|llama3.2:3b')).toBeLessThan(ids.indexOf('ollama|deepseek-r1:8b'))
  })

  it('catálogo local cobre código e modelos que cabem em 6 GB', () => {
    const ids = LOCAL_MODELS.map(m => m.id)
    expect(ids).toContain('qwen2.5-coder:7b')
    expect(ids).toContain('llama3.2:3b')
    expect(LOCAL_MODELS.every(m => m.recommendedVramGB <= 6)).toBe(true)
  })
})
