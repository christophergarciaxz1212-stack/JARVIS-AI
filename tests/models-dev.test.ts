import { describe, it, expect } from 'vitest'
import { findRawInCatalog, enrichmentFromRaw, lookupModelsDev, type ModelsDevCatalog } from '@/lib/ai/models-dev'

const CATALOG: ModelsDevCatalog = {
  google: {
    models: {
      'gemini-2.5-pro': {
        name: 'Gemini 2.5 Pro',
        description: 'Modelo de raciocínio do Google',
        attachment: true,
        reasoning: true,
        tool_call: true,
        release_date: '2025-06-17',
        limit: { context: 1048576, output: 65536 },
        modalities: { input: ['text', 'image'], output: ['text'] },
      },
    },
  },
  openrouter: {
    models: {
      'meta-llama/llama-3.3-70b-instruct:free': {
        name: 'Llama 3.3 70B',
        attachment: false,
        reasoning: false,
        tool_call: true,
        open_weights: true,
        limit: { context: 131072, output: 32768 },
      },
      'qwen/qwen3-coder:free': {
        name: 'Qwen3 Coder',
        tool_call: true,
        limit: { context: 262144, output: 65536 },
      },
    },
  },
}

describe('models.dev catalog lookup', () => {
  it('finds models by exact id', () => {
    const raw = findRawInCatalog(CATALOG, 'google', 'gemini-2.5-pro')
    expect(raw?.limit?.context).toBe(1048576)
  })

  it('falls back from "x:free" to "x" and matches case-insensitively', () => {
    expect(findRawInCatalog(CATALOG, 'openrouter', 'meta-llama/llama-3.3-70b-instruct')?.open_weights).toBe(true)
    expect(findRawInCatalog(CATALOG, 'openrouter', 'META-LLAMA/LLAMA-3.3-70B-INSTRUCT:FREE')?.tool_call).toBe(true)
    expect(findRawInCatalog(CATALOG, 'openrouter', 'inexistente/modelo')).toBeNull()
    expect(findRawInCatalog(null, 'google', 'gemini-2.5-pro')).toBeNull()
  })

  it('extracts the facts the JARVIS ranking and UI use', () => {
    const enr = enrichmentFromRaw(findRawInCatalog(CATALOG, 'google', 'gemini-2.5-pro'))
    expect(enr).toMatchObject({
      contextWindow: 1048576,
      maxTokens: 65536,
      reasoning: true,
      toolSupport: true,
      multimodal: true,
      description: 'Modelo de raciocínio do Google',
      releaseDate: '2025-06-17',
    })
  })

  it('returns null enrichment for an unknown model instead of guessing', () => {
    expect(enrichmentFromRaw(null)).toBeNull()
    expect(enrichmentFromRaw({})).toBeNull()
  })

  it('lookupModelsDev tolerates providers without a models.dev mapping', () => {
    expect(lookupModelsDev('ollama', 'llama3.2:3b')).toEqual({ raw: null, enrichment: null })
  })
})
