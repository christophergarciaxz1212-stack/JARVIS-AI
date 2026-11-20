import http from 'http'
import type { AddressInfo } from 'net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { streamAI, type StreamChunk } from '@/lib/ai/client'

// Servidor local no formato OpenAI (o mesmo caminho de Groq, OpenRouter, NVIDIA, LM Studio…):
// o SDK da OpenAI usa o próprio fetch, então a resposta vem de um HTTP de verdade, nunca da internet.
const chunk = (delta: object, finish: string | null = null) => `data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
let server: http.Server
const OLD = process.env.LMSTUDIO_BASE_URL

beforeAll(async () => {
  server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write(chunk({ reasoning: 'pensando…' }))
    for (const d of ['DNS', ' é o', ' sistema de nomes.']) res.write(chunk({ content: d }))
    res.write(chunk({}, 'stop'))
    res.end('data: [DONE]\n\n')
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  process.env.LMSTUDIO_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
})
afterAll(() => { server.close(); if (OLD === undefined) delete process.env.LMSTUDIO_BASE_URL; else process.env.LMSTUDIO_BASE_URL = OLD })

describe('streaming de provedores OpenAI-compatíveis', () => {
  it('cada pedaço sai na hora e o fim não repete o texto (antes: 1ª palavra duplicada e sem streaming)', async () => {
    const chunks: StreamChunk[] = []
    await streamAI('lmstudio|qualquer', [{ role: 'user', content: 'O que é DNS?' }], c => chunks.push(c))
    expect(chunks.filter(c => !c.done && c.content).map(c => c.content)).toEqual(['DNS', ' é o', ' sistema de nomes.'])
    expect(chunks.find(c => c.reasoning)?.reasoning).toBe('pensando…')
    const done = chunks.filter(c => c.done)
    expect(done).toHaveLength(1)
    expect(done[0].content).toBe('')
    // O que o chat monta somando todos os pedaços
    expect(chunks.map(c => c.content).join('')).toBe('DNS é o sistema de nomes.')
  })
})
