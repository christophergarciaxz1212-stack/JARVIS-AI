import http from 'http'
import type { AddressInfo } from 'net'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { completeOnce, streamAI, type StreamChunk } from '@/lib/ai/client'
import { ThinkSplitter, adaptBody, contentParts, detectQuirk, normalizeBaseUrl, quirksOf, resetQuirks, stripThink } from '@/lib/ai/compat'
import { discoverModels, ensureCustomProviders, parseModelList, readCustomProviders, removeCustomProvider, upsertCustomProvider } from '@/lib/ai/customProviders'
import { PROVIDER_APIS } from '@/lib/ai/providers'

// ── Servidor de mentira configurável por teste (HTTP de verdade, nunca a internet) ──────────────
type Handler = (req: http.IncomingMessage, body: Record<string, unknown>, res: http.ServerResponse) => void
let handler: Handler = (_q, _b, res) => { res.writeHead(500); res.end() }
const seen: Array<{ url: string; body: Record<string, unknown>; headers: http.IncomingHttpHeaders }> = []
let server: http.Server
let base = ''

const sse = (res: http.ServerResponse, deltas: object[], finish = 'stop') => {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  for (const d of deltas) res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: d, finish_reason: null }] })}\n\n`)
  res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: {}, finish_reason: finish }] })}\n\n`)
  res.end('data: [DONE]\n\n')
}
const json = (res: http.ServerResponse, status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', c => { raw += c })
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {}
      seen.push({ url: req.url || '', body, headers: req.headers })
      handler(req, body, res)
    })
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  process.env.LMSTUDIO_BASE_URL = `${base}/v1`
})
afterAll(() => { server.close() })
beforeEach(() => { seen.length = 0; resetQuirks() })

const collect = async (model: string, content = 'oi') => {
  const chunks: StreamChunk[] = []
  await streamAI(model, [{ role: 'system', content: 'Seja breve' }, { role: 'user', content }], c => chunks.push(c))
  return { chunks, text: chunks.map(c => c.content).join(''), reasoning: chunks.map(c => c.reasoning || '').join('') }
}

describe('camada de compatibilidade (unidades)', () => {
  it('ThinkSplitter separa <think> mesmo com a marca partida entre pedaços', () => {
    const s = new ThinkSplitter()
    const parts = ['<thi', 'nk>vou som', 'ar</th', 'ink>A resposta', ' é 12']
    let text = ''; let reasoning = ''
    for (const p of parts) { const r = s.push(p); text += r.text; reasoning += r.reasoning }
    const f = s.flush(); text += f.text; reasoning += f.reasoning
    expect(reasoning).toBe('vou somar')
    expect(text).toBe('A resposta é 12')
  })
  it('<think> no meio do texto não é raciocínio', () => {
    expect(stripThink('Use a tag <think> no HTML')).toBe('Use a tag <think> no HTML')
    expect(stripThink('<think>x</think>{"ok":true}')).toBe('{"ok":true}')
  })
  it('content em lista de partes (Magistral) vira texto + raciocínio', () => {
    expect(contentParts([{ type: 'thinking', thinking: [{ type: 'text', text: 'hmm' }] }, { type: 'text', text: 'Oi' }])).toEqual({ text: 'Oi', reasoning: 'hmm' })
  })
  it('detecta o campo recusado e só refaz erros de formato', () => {
    const q = quirksOf('t|m')
    const body = { model: 'm', messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }], stream: true, stream_options: { include_usage: true }, reasoning_effort: 'low', foo: 1 }
    expect(detectQuirk({ status: 400, message: '400 Unrecognized request argument supplied: stream_options' }, body, q)).toBe('no_stream_options')
    expect(detectQuirk({ status: 400, message: "property 'reasoning_effort' is unsupported" }, body, q)).toBe('no_reasoning_effort')
    expect(detectQuirk({ status: 422, message: 'Extra inputs are not permitted: unknown field `foo`' }, body, q)).toBe('drop:foo')
    expect(detectQuirk({ status: 400, message: 'System role not supported for this model' }, body, q)).toBe('no_system_role')
    // Erros que não se resolvem tirando campos seguem para a troca de modelo
    expect(detectQuirk({ status: 401, message: 'invalid api key' }, body, q)).toBeNull()
    expect(detectQuirk({ status: 429, message: 'rate limit stream_options' }, body, q)).toBeNull()
  })
  it('adaptBody aplica o que foi aprendido, inclusive fundir o system no usuário', () => {
    const q = new Set(['no_stream_options', 'no_system_role', 'drop:foo'] as const)
    const out = adaptBody({ model: 'm', stream: true, stream_options: {}, foo: 1, messages: [{ role: 'system', content: 'S' }, { role: 'user', content: 'U' }] }, q as never)
    expect(out.stream_options).toBeUndefined()
    expect(out.foo).toBeUndefined()
    expect(out.messages).toEqual([{ role: 'user', content: '[Instruções]\nS\n\n[Mensagem]\nU' }])
  })
  it('normalizeBaseUrl aceita o endereço como o usuário colar', () => {
    expect(normalizeBaseUrl('https://api.x.com/v1/chat/completions/')).toBe('https://api.x.com/v1')
    expect(normalizeBaseUrl('localhost:8000/v1/models')).toBe('http://localhost:8000/v1')
    expect(normalizeBaseUrl('api.x.com/v1?key=1#a')).toBe('https://api.x.com/v1')
    expect(() => normalizeBaseUrl('ftp://x')).toThrow()
  })
  it('parseModelList entende OpenAI, Ollama, Gemini e lista simples; marca pagos e tira não-conversa', () => {
    expect(parseModelList({ data: [{ id: 'a', context_length: 8000 }, { id: 'b', pricing: { prompt: '0.001', completion: '0' } }, { id: 'text-embedding-3' }] }))
      .toEqual([{ id: 'a', contextWindow: 8000, paid: false, name: undefined }, { id: 'b', paid: true, contextWindow: undefined, name: undefined }])
    expect(parseModelList({ models: [{ name: 'llama3.2:3b' }] }).map(m => m.id)).toEqual(['llama3.2:3b'])
    expect(parseModelList({ models: [{ name: 'models/gemini-x', displayName: 'Gemini X' }] })[0]).toMatchObject({ id: 'gemini-x', name: 'Gemini X' })
    expect(parseModelList(['m1', 'm1', 'm2']).map(m => m.id)).toEqual(['m1', 'm2'])
  })
})

describe('streaming com servidores "quase" OpenAI', () => {
  it('servidor que recusa stream_options: refaz sem o campo e lembra para a próxima', async () => {
    handler = (_q, body, res) => (body.stream_options ? json(res, 400, { error: { message: 'Unrecognized request argument supplied: stream_options' } }) : sse(res, [{ content: 'Olá' }]))
    // lmstudio não manda stream_options; um provedor cadastrado manda
    upsertCustomProvider({ name: 'Estrito', baseUrl: `${base}/v1`, apiKey: '' })
    const id = readCustomProviders()[0].id
    const first = await collect(`${id}|m`)
    expect(first.text).toBe('Olá')
    expect(seen.filter(s => s.url.includes('chat/completions'))).toHaveLength(2)
    seen.length = 0
    await collect(`${id}|m`)
    expect(seen.filter(s => s.url.includes('chat/completions'))).toHaveLength(1)
    removeCustomProvider(id)
  })
  it('modelo sem suporte a "system" recebe as instruções na mensagem do usuário', async () => {
    handler = (_q, body, res) => ((body.messages as Array<{ role: string }>).some(m => m.role === 'system')
      ? json(res, 400, { error: { message: 'System role not supported' } })
      : sse(res, [{ content: 'ok' }]))
    const r = await collect('lmstudio|gemma')
    expect(r.text).toBe('ok')
    const last = seen[seen.length - 1].body.messages as Array<{ role: string; content: string }>
    expect(last).toHaveLength(1)
    expect(last[0].content).toContain('Seja breve')
  })
  it('<think> no texto vira raciocínio, e a resposta sai limpa', async () => {
    handler = (_q, _b, res) => sse(res, [{ content: '<think>pensando' }, { content: ' muito</think>' }, { content: '12' }])
    const r = await collect('lmstudio|r1')
    expect(r.text).toBe('12')
    expect(r.reasoning).toBe('pensando muito')
  })
  it('resposta vazia vira erro (o chat troca de modelo) em vez de mensagem em branco', async () => {
    handler = (_q, _b, res) => sse(res, [], 'content_filter')
    await expect(collect('lmstudio|vazio')).rejects.toThrow(/filtro de conteúdo/)
  })
  it('servidor sem streaming: usa a resposta completa', async () => {
    handler = (_q, body, res) => (body.stream
      ? json(res, 400, { error: { message: 'Streaming is not supported by this server' } })
      : json(res, 200, { id: 'x', object: 'chat.completion', created: 1, model: 'm', choices: [{ index: 0, message: { role: 'assistant', content: 'completo' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 1 } }))
    const r = await collect('lmstudio|sem-stream')
    expect(r.text).toBe('completo')
    expect(r.chunks.find(c => c.done)?.usage).toMatchObject({ inputTokens: 3, outputTokens: 1 })
  })
  it('completeOnce também contorna campos recusados e limpa <think> do JSON', async () => {
    handler = (_q, body, res) => (body.reasoning_effort
      ? json(res, 400, { error: { message: "property 'reasoning_effort' is unsupported" } })
      : json(res, 200, { id: 'x', object: 'chat.completion', created: 1, model: 'm', choices: [{ index: 0, message: { role: 'assistant', content: '<think>hmm</think>{"ok":true}' }, finish_reason: 'stop' }] }))
    const r = await completeOnce('lmstudio|gpt-oss-20b', [{ role: 'user', content: 'json' }])
    expect(r.text).toBe('{"ok":true}')
  })
})

describe('provedores cadastrados pelo usuário', () => {
  it('descobre os modelos tentando /v1/models quando a base não tem versão', async () => {
    handler = (req, _b, res) => (req.url === '/v1/models' ? json(res, 200, { data: [{ id: 'llama-local' }, { id: 'whisper-1' }] }) : json(res, 404, { error: 'not found' }))
    const r = await discoverModels(base, 'openai', '')
    expect(r.baseUrl).toBe(`${base}/v1`)
    expect(r.models.map(m => m.id)).toEqual(['llama-local'])
  })
  it('chave recusada é informada com clareza', async () => {
    handler = (_q, _b, res) => json(res, 401, { error: { message: 'bad key' } })
    await expect(discoverModels(`${base}/v1`, 'openai', 'x')).rejects.toThrow(/Chave inválida/)
  })
  it('cadastrar registra no catálogo; a chave não aparece no arquivo de definição; remover tira tudo', async () => {
    handler = (_q, _b, res) => json(res, 200, { data: [{ id: 'free-a' }, { id: 'paid-b', pricing: { prompt: '0.5', completion: '1' } }] })
    const cp = upsertCustomProvider({ name: 'Meu Gateway', baseUrl: `${base}/v1/chat/completions`, apiKey: 'sk-teste-1234' })
    expect(cp.baseUrl).toBe(`${base}/v1`)
    expect(JSON.stringify(readCustomProviders())).not.toContain('sk-teste-1234')
    ensureCustomProviders()
    const api = PROVIDER_APIS.find(p => p.id === cp.id)!
    const models = await api.listModels('sk-teste-1234')
    // Pagos ficam fora por padrão (só modelos gratuitos)
    expect(models.map(m => m.id)).toEqual([`${cp.id}|free-a`])
    expect(seen[seen.length - 1].headers.authorization).toBe('Bearer sk-teste-1234')
    removeCustomProvider(cp.id)
    expect(PROVIDER_APIS.some(p => p.id === cp.id)).toBe(false)
    expect(process.env[`CUSTOMP_${cp.id.replace(/-/g, '_').toUpperCase()}_KEY`]).toBeUndefined()
  })
  it('formato Anthropic: streaming de verdade, com quebras de linha preservadas', async () => {
    handler = (req, _b, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      const ev = (o: object) => res.write(`event: x\ndata: ${JSON.stringify(o)}\n\n`)
      ev({ type: 'message_start', message: { usage: { input_tokens: 5, output_tokens: 0 } } })
      ev({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hm' } })
      ev({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'linha 1\n' } })
      ev({ type: 'content_block_delta', delta: { type: 'text_delta', text: '- item' } })
      ev({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 4 } })
      res.end()
    }
    const cp = upsertCustomProvider({ name: 'Claude Gateway', baseUrl: base, style: 'anthropic', apiKey: 'k-anthropic' })
    const r = await collect(`${cp.id}|claude-x`)
    expect(r.chunks.filter(c => c.content).map(c => c.content)).toEqual(['linha 1\n', '- item'])
    expect(r.reasoning).toBe('hm')
    expect(seen[seen.length - 1].url).toBe('/v1/messages')
    expect(seen[seen.length - 1].headers['x-api-key']).toBe('k-anthropic')
    expect(seen[seen.length - 1].body.system).toBe('Seja breve')
    expect(r.chunks.find(c => c.done)?.usage).toEqual({ inputTokens: 5, outputTokens: 4 })
    removeCustomProvider(cp.id)
  })
})
