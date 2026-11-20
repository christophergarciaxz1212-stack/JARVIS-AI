import { describe, expect, it } from 'vitest'
import { capabilityLabels, jsonInstruction, resolveCapabilities, supports } from '@/lib/ai/capabilities'

describe('capacidades por modelo', () => {
  it('reconhece Gemini com visão, ferramentas e contexto longo', () => {
    const caps = resolveCapabilities('gemini|gemini-2.5-flash-lite')
    expect(caps.provider).toBe('gemini')
    expect(caps.tools).toBe(true)
    expect(caps.vision).toBe(true)
    expect(caps.json).toBe('native')
    expect(caps.contextWindow).toBe(1_048_576)
    expect(supports(caps, 'longContext')).toBe(true)
  })

  it('não anuncia ferramentas para modelos locais que não as suportam', () => {
    const gemma = resolveCapabilities('ollama|gemma3:4b')
    expect(gemma.local).toBe(true)
    expect(gemma.vision).toBe(true)
    expect(gemma.tools).toBe(false)

    const r1 = resolveCapabilities('ollama|deepseek-r1:8b')
    expect(r1.reasoning).toBe(true)
    expect(r1.tools).toBe(false)
  })

  it('mantém o contexto efetivo dos modelos locais dentro do num_ctx', () => {
    const coder = resolveCapabilities('ollama|qwen2.5-coder:7b')
    expect(coder.contextWindow).toBe(32_768)
    expect(coder.maxOutputTokens).toBe(4096)
    expect(capabilityLabels(coder)).toContain('local')
  })

  it('só considera gratuitas as rotas ":free" do OpenRouter', () => {
    expect(resolveCapabilities('openrouter|deepseek/deepseek-r1:free').free).toBe(true)
    expect(resolveCapabilities('openrouter|openai/gpt-4o').free).toBe(false)
  })

  it('aceita capacidades declaradas pelo catálogo por cima da inferência', () => {
    const caps = resolveCapabilities('groq|llama-3.3-70b', { contextWindow: 65_536, vision: true })
    expect(caps.contextWindow).toBe(65_536)
    expect(caps.vision).toBe(true)
  })

  it('usa instrução textual quando o provedor não tem JSON nativo', () => {
    const caps = resolveCapabilities('sambanova|Meta-Llama-3.3-70B-Instruct')
    expect(caps.json).toBe('prompt')
    expect(jsonInstruction(caps)).toMatch(/JSON válido/)
    expect(jsonInstruction(resolveCapabilities('groq|llama-3.3-70b'))).toBeNull()
  })
})
