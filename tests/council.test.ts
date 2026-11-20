import { describe, expect, it, beforeEach } from 'vitest'
import { setCouncilLlm, councilCommandRunner, runCouncil, formatCouncil } from '@/lib/ai/council'

const fakeModels = async () => ['groq|llama-a', 'gemini|gemini-b', 'openrouter|or-c']

beforeEach(() => {
  setCouncilLlm(async (model: string, messages: Array<{ role: string; content: string }>) => {
    if (model.includes('or-c')) throw Object.assign(new Error('rate limit'), { status: 429 })
    return { text: `Resposta do especialista ${model}.`, usage: { inputTokens: 100, outputTokens: 40 } } as never
  }, fakeModels)
})

describe('JARVIS AI Council', () => {
  it('consulta todos os modelos, tolera falhas e devolve síntese do juiz', async () => {
    const r = await runCouncil('qual a melhor arquitetura para este app?')
    expect(r.members.length).toBe(3)
    expect(r.members.filter(m => m.ok).length).toBe(2)
    expect(r.synthesis).toContain('Resposta do especialista')
    expect(r.judgeModel).toBeTruthy()
  })

  it('juiz falhou: entrega a resposta mais rápida, sem mentir', async () => {
    setCouncilLlm(async (model: string, messages: Array<{ role: string; content: string }>) => {
      if (messages[0]?.content.includes('árbitro')) throw new Error('juiz indisponível')
      if (model.includes('or-c')) throw Object.assign(new Error('rate limit'), { status: 429 })
      return { text: `Resposta do especialista ${model}.`, usage: { inputTokens: 10, outputTokens: 5 } } as never
    }, fakeModels)
    const r = await runCouncil('pergunta importante')
    expect(r.judgeFailed).toBe(true)
    expect(r.synthesis).toContain('Resposta do especialista')
  })

  it('todos os modelos falharam: avisa honestamente, sem inventar resposta', async () => {
    setCouncilLlm(async () => { throw Object.assign(new Error('429 rate limit'), { status: 429 }) as never }, fakeModels)
    const r = await runCouncil('pergunta"')
    expect(r.synthesis).toContain('Nenhum dos 3 modelos')
    expect(r.members.every(m => !m.ok)).toBe(true)
  })

  it('formatCouncil lista latências reais e respostas individuais', async () => {
    const r = await runCouncil('pergunta')
    const text = formatCouncil(r)
    expect(text).toContain('Conselho do JARVIS')
    expect(text).toContain('Modelos consultados')
    expect(text).toContain('Ver respostas individuais')
  })

  it('o runner reconhece /council e /conselho, e ignora o resto', () => {
    expect(councilCommandRunner('/council qual a melhor arquitetura?')).toBeTypeOf('function')
    expect(councilCommandRunner('/conselho me ajude a decidir')).toBeTypeOf('function')
    expect(councilCommandRunner('/video um gato')).toBeNull()
    expect(councilCommandRunner('bom dia')).toBeNull()
    expect(councilCommandRunner('/council')).toBeTypeOf('function')
  })
})
