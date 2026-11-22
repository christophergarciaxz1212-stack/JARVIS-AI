import fs from 'fs'
import http from 'http'
import os from 'os'
import path from 'path'
import type { AddressInfo } from 'net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { candidateBases, connectProvider, nameFromUrl, testOrder } from '@/lib/ai/connectProvider'
import { adaptBody, detectQuirk, type Quirk } from '@/lib/ai/compat'

describe('conectar com URL e chave: partes puras', () => {
  it('dá nome sozinho pelo endereço', () => {
    expect(nameFromUrl('https://api.deepseek.com')).toBe('DeepSeek')
    expect(nameFromUrl('https://api.together.xyz/v1')).toBe('Together AI')
    expect(nameFromUrl('https://minha-ia.exemplo.com.br/v1')).toBe('Exemplo')
    expect(nameFromUrl('https://meuprovedor.io')).toBe('Meuprovedor')
    expect(nameFromUrl('http://localhost:8000')).toBe('Servidor local :8000')
    expect(nameFromUrl('https://minhaconta.openai.azure.com/openai/v1')).toBe('Azure OpenAI')
  })
  it('tenta os endereços prováveis; Gemini e Anthropic já saem no formato certo', () => {
    expect(candidateBases('https://api.deepseek.com/chat/completions').map(c => c.base)).toEqual([
      'https://api.deepseek.com', 'https://api.deepseek.com/v1', 'https://api.deepseek.com/openai/v1', 'https://api.deepseek.com/v1',
    ])
    expect(candidateBases('https://generativelanguage.googleapis.com')).toEqual([{ base: 'https://generativelanguage.googleapis.com/v1beta/openai', style: 'openai' }])
    expect(candidateBases('https://api.anthropic.com')).toEqual([{ base: 'https://api.anthropic.com/v1', style: 'anthropic' }])
  })
  it('aprende o teto de saída quando a API recusa max_tokens grande (ex.: Groq allam-2-7b)', () => {
    const quirks = new Set<Quirk>()
    const body = { model: 'allam-2-7b', messages: [], max_tokens: 32768 }
    const err = Object.assign(new Error('400 `max_tokens` must be less than or equal to `4096`, the maximum value for `max_tokens` is less than the `context_window` for this model'), { status: 400 })
    const q = detectQuirk(err, body, quirks)
    expect(q).toBe('max:4096')
    quirks.add(q!)
    expect(adaptBody(body, quirks).max_tokens).toBe(4096)
    // sem número na mensagem: tira o campo
    expect(detectQuirk(Object.assign(new Error('max_tokens is too large for this model'), { status: 400 }), body, new Set())).toBe('drop:max_tokens')
  })
  it('testa primeiro os modelos leves de conversa', () => {
    expect(testOrder(['deepseek-reasoner', 'deepseek-chat'])[0]).toBe('deepseek-chat')
  })
})

describe('conectar com URL e chave: servidores de verdade', () => {
  const OLD = process.env.JARVIS_DATA_DIR
  let dir = ''
  let server: http.Server
  let base = ''
  const KEY = 'sk-teste-123'
  const json = (res: http.ServerResponse, code: number, body: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
  const chat = (model: string) => ({ id: 'x', object: 'chat.completion', created: 1, model, choices: [{ index: 0, message: { role: 'assistant', content: '12' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 } })

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jv-conn-'))
    process.env.JARVIS_DATA_DIR = dir
    server = http.createServer((req, res) => {
      let raw = ''
      req.on('data', c => { raw += c })
      req.on('end', () => {
        const url = req.url || ''
        const bearer = req.headers.authorization === `Bearer ${KEY}`
        // 1) "como a DeepSeek": /models e /chat/completions na raiz, chave em Bearer
        if (url.startsWith('/ds/')) {
          if (!bearer) return json(res, 401, { error: { message: 'Authentication Fails' } })
          if (url === '/ds/models') return json(res, 200, { object: 'list', data: [{ id: 'deepseek-chat', object: 'model' }, { id: 'deepseek-reasoner', object: 'model' }] })
          if (url === '/ds/chat/completions') return json(res, 200, chat(JSON.parse(raw).model))
          return json(res, 404, { error: 'not found' })
        }
        // 2) "como o Azure": chave no cabeçalho api-key, rota /openai/v1
        if (url.startsWith('/az/')) {
          if (req.headers['api-key'] !== KEY) return json(res, 401, { error: { message: 'Access denied due to invalid subscription key' } })
          if (url === '/az/openai/v1/models') return json(res, 200, { data: [{ id: 'gpt-4o-mini' }, { id: 'text-embedding-3-small' }] })
          if (url === '/az/openai/v1/chat/completions') return json(res, 200, chat('gpt-4o-mini'))
          return json(res, 404, { error: 'not found' })
        }
        // 3) Formato Anthropic Messages
        if (url.startsWith('/an/')) {
          if (url === '/an/v1/models' && req.headers['x-api-key'] === KEY && req.headers['anthropic-version']) return json(res, 200, { data: [{ id: 'claude-haiku-x', display_name: 'Haiku X' }] })
          if (url === '/an/v1/messages' && req.headers['x-api-key'] === KEY) return json(res, 200, { id: 'm', type: 'message', role: 'assistant', content: [{ type: 'text', text: '12' }], stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 1 } })
          return json(res, req.headers.authorization ? 404 : 401, { error: { message: 'nope' } })
        }
        // 4) API que não lista modelos
        if (url.startsWith('/nolist/')) {
          if (url === '/nolist/v1/chat/completions' && bearer) return json(res, 200, chat('meu-modelo'))
          return json(res, 404, { error: 'not found' })
        }
        json(res, 404, {})
      })
    })
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(() => {
    server.close()
    if (OLD === undefined) delete process.env.JARVIS_DATA_DIR; else process.env.JARVIS_DATA_DIR = OLD
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('"como a DeepSeek": descobre o formato, traz TODOS os modelos e conversa', async () => {
    const r = await connectProvider({ baseUrl: `${base}/ds/chat/completions`, apiKey: KEY })
    expect(r.detected).toMatchObject({ baseUrl: `${base}/ds`, style: 'openai', auth: 'bearer' })
    expect(r.models.map(m => m.id)).toEqual(['deepseek-chat', 'deepseek-reasoner'])
    expect(r.provider.manualModels).toEqual([]) // usa sempre a lista ao vivo da API
    expect(r.test).toMatchObject({ ok: true, model: 'deepseek-chat' })
  })
  it('"como o Azure": acha a rota /openai/v1 e o cabeçalho api-key sozinho', async () => {
    const r = await connectProvider({ baseUrl: `${base}/az`, apiKey: KEY })
    expect(r.detected).toMatchObject({ baseUrl: `${base}/az/openai/v1`, auth: 'api-key' })
    expect(r.models.map(m => m.id)).toEqual(['gpt-4o-mini']) // embeddings não entram
    expect(r.test.ok).toBe(true)
  })
  it('formato Anthropic: detectado e conversa pelo /v1/messages', async () => {
    const r = await connectProvider({ baseUrl: `${base}/an`, apiKey: KEY })
    expect(r.detected.style).toBe('anthropic')
    expect(r.test).toMatchObject({ ok: true, model: 'claude-haiku-x' })
  })
  it('chave errada: avisa que a chave foi recusada', async () => {
    await expect(connectProvider({ baseUrl: `${base}/ds`, apiKey: 'sk-errada' })).rejects.toThrow(/recusou a chave/)
  })
  it('API que não lista modelos: pede o nome de um modelo e conecta com ele', async () => {
    await expect(connectProvider({ baseUrl: `${base}/nolist`, apiKey: KEY })).rejects.toThrow(/informe o nome de um modelo/)
    const r = await connectProvider({ baseUrl: `${base}/nolist/v1`, apiKey: KEY, model: 'meu-modelo' })
    expect(r.provider.manualModels).toEqual(['meu-modelo'])
    expect(r.test).toMatchObject({ ok: true, model: 'meu-modelo' })
  })
  it('conectar o mesmo endereço de novo atualiza, não duplica', async () => {
    const { readCustomProviders } = await import('@/lib/ai/customProviders')
    const before = readCustomProviders().length
    await connectProvider({ baseUrl: `${base}/ds`, apiKey: KEY })
    expect(readCustomProviders().length).toBe(before)
  })
})
