import { afterEach, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { completeOnce, streamAI } from '@/lib/ai/client'
import { readAudit, recordAudit, runModelAudit, setAuditClients } from '@/lib/ai/audit'
import { GET, POST } from '@/app/api/audit/route'

/** Clientes falsos: a auditoria deve usar a mesma forma de chamada do cliente real do chat. */
function fakeClients(replies: { stream?: string; byKeyword: Array<[RegExp, string]>; onCall?: (opts: { json?: boolean; tools?: unknown[] }) => void }) {
  const calls: string[] = []
  const stream = (async (_model: string, _messages: unknown, onChunk: (c: { content: string; done: boolean; model: string }) => void) => {
    calls.push('stream')
    onChunk({ content: replies.stream ?? '13', done: false, model: 'fake' })
    onChunk({ content: '', done: true, model: 'fake' })
  }) as typeof streamAI
  const complete = (async (_model: string, messages: Array<{ role: string; content: string }>, _signal?: AbortSignal, opts?: { json?: boolean; tools?: unknown[] }) => {
    const user = messages.find(m => m.role === 'user')?.content || ''
    calls.push(user)
    replies.onCall?.(opts ?? {})
    const hit = replies.byKeyword.find(([re]) => re.test(user))
    return { text: hit?.[1] ?? '', usage: { inputTokens: 1, outputTokens: 1 } }
  }) as typeof completeOnce
  setAuditClients(complete, stream)
  return calls
}

const CHAT: [RegExp, string] = [/9 \+ 4/, '13']
const REASON: [RegExp, string] = [/maçãs/, 'RESPOSTA: 10']
const CODE: [RegExp, string] = [/soma\(a, b\)/, '```js\nfunction soma(a, b) { return a + b }\n```']
const JSON_PLAN: [RegExp, string] = [/JSON/, '{"servicos":["api","web"],"banco":"postgres","riscos":["sem backup"]}']
const TOOL: [RegExp, string] = [/write_file/, '{"thought":"vou criar","actions":[{"tool":"write_file","args":{"path":"README.md","content":"JARVIS OK"}}]}']
const allReplies: Array<[RegExp, string]> = [CHAT, REASON, CODE, JSON_PLAN, TOOL]

afterEach(() => { setAuditClients(completeOnce, streamAI) })

describe('auditoria real de modelos (N1–N5)', () => {
  it('nível 1 usa streaming e não inventa capacidades que não mediu', async () => {
    const calls = fakeClients({ byKeyword: allReplies })
    const r = await runModelAudit('groq|modelo-falso', 1)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toBe('stream')
    expect(r).toMatchObject({ provider: 'groq', model: 'groq|modelo-falso', ok: true, level: 1, reached: 1 })
    expect(r.capability).toEqual({ stream: true, json: null, reasoning: null, code: null, tools: null })
  })

  it('nível 3 exige código de verdade: texto bonito não conta como código', async () => {
    fakeClients({ byKeyword: [CHAT, REASON, [/soma\(a, b\)/, 'Claro! A função soma usa a + b.'] as [RegExp, string]] })
    const bad = await runModelAudit('groq|modelo-falso', 3)
    expect(bad.ok).toBe(false)
    expect(bad.reached).toBe(2)
    expect(bad.capability.code).toBe(false)
    expect(bad.capability.tools).toBeNull()

    fakeClients({ byKeyword: allReplies })
    const good = await runModelAudit('groq|modelo-falso', 3)
    expect(good.ok).toBe(true)
    expect(good.reached).toBe(3)
    expect(good.capability.code).toBe(true)
  })

  it('nível 4 marca JSON inválido como capacidade false, sem esconder o erro', async () => {
    fakeClients({ byKeyword: [CHAT, REASON, CODE, [/JSON/, 'Aqui: { servicos: [1] }'] as [RegExp, string]] })
    const r = await runModelAudit('groq|modelo-falso', 4)
    expect(r.ok).toBe(false)
    expect(r.reached).toBe(3)
    expect(r.capability.json).toBe(false)
    expect(r.error).toMatch(/JSON/)
  })

  it('nível 5 reconhece chamada de ferramenta nativa convertida pelo cliente', async () => {
    let sawTools = false
    fakeClients({ byKeyword: allReplies, onCall: o => { if (o.tools?.length) sawTools = true } })
    const r = await runModelAudit('groq|modelo-falso', 5)
    expect(sawTools).toBe(true)
    expect(r.ok).toBe(true)
    expect(r.reached).toBe(5)
    expect(r.capability.tools).toBe(true)
  })

  it('erros externos (chave inválida, modelo aposentado, sem plano, conexão) não viram capacidade false', async () => {
    for (const message of [
      '401 invalid api key',
      '404 model no longer available',
      'Compatível com Anthropic: erro 402. Hy4 is not part of the free tier.',
      'Connection error.',
    ]) {
      const failing = (async () => { throw new Error(message) }) as typeof completeOnce
      setAuditClients(failing, failing as unknown as typeof streamAI)
      const r = await runModelAudit('groq|externo', 2)
      expect(r.error).toBeTruthy()
      expect(r.capability.stream).toBeNull()
      expect(r.capability.reasoning).toBeNull()
    }
  })

  it('grava resultados por modelo sem apagar os anteriores', () => {
    const first = { provider: 'groq', model: 'groq|a', ok: true, ms: 10, level: 1 as const, reached: 1 as const, capability: { stream: true, json: null, reasoning: null, code: null, tools: null }, at: Date.now() }
    recordAudit(first)
    recordAudit({ ...first, model: 'groq|b', at: Date.now() + 1 })
    const all = readAudit()
    expect(all.map(r => r.model)).toEqual(expect.arrayContaining(['groq|a', 'groq|b']))
  })
})

describe('API /api/audit', () => {
  it('POST executa a auditoria com os modelos pedidos e devolve o resultado', async () => {
    fakeClients({ byKeyword: allReplies })
    const req = new NextRequest('http://localhost/api/audit', {
      method: 'POST',
      body: JSON.stringify({ models: ['groq|rota-teste'], level: 1 }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.results).toEqual([expect.objectContaining({ model: 'groq|rota-teste', ok: true, reached: 1 })])
    const stored = await GET(new NextRequest('http://localhost/api/audit'))
    expect(await stored.json()).toMatchObject({ results: expect.arrayContaining([expect.objectContaining({ model: 'groq|rota-teste' })]) })
  })

  it('POST rejeita nível inválido antes de chamar qualquer modelo', async () => {
    const req = new NextRequest('http://localhost/api/audit', {
      method: 'POST',
      body: JSON.stringify({ models: ['groq|nunca'], level: 9 }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})
