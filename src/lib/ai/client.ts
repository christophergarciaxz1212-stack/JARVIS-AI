import { GoogleGenerativeAI } from '@google/generative-ai'
import OpenAI from 'openai'
import { PROVIDER_APIS, PAID_ENABLED, modelLimits, splitModelId } from './providers'
import { budgetTier } from './freeTier'
import { callAntigravity } from './antigravity'
import { callOpencode } from './opencodeBridge'
import { jsonInstruction, resolveCapabilities } from './capabilities'
import { ThinkSplitter, adaptBody, contentParts, detectQuirk, emptyAnswerError, quirksOf, stripThink } from './compat'
import { ensureCustomProviders } from './customProviders'
import type { Usage } from '../agents/types'

export interface StreamChunk {
  content: string
  /** Thinking of a reasoning model (Ollama "thinking", OpenAI-compatible "reasoning"), sent before the answer. */
  reasoning?: string
  done: boolean
  model?: string
  tokens?: number
  /** Present on the final (done) chunk. */
  usage?: Usage
}

type Message = { role: 'user' | 'assistant' | 'system'; content: string }

function missingKey(providerName: string) {
  return new Error(`Chave do ${providerName} não configurada. Clique no botão 🔑 Chaves de API para adicionar.`)
}

function paidDisabled(providerName: string) {
  return new Error(`${providerName} é um provedor pago e está desativado neste JARVIS. Use um modelo gratuito ou local.`)
}

/** Blocks paid providers on every path, including SDKs that never reach the OpenAI-compatible branch. */
function assertProviderAllowed(provider: string) {
  const api = PROVIDER_APIS.find(p => p.id === provider)
  if (api && api.free === false && !PAID_ENABLED) throw paidDisabled(api.name)
}

// ── Ollama: contexto explícito, sem recarregar o modelo a cada mensagem ──────
// O padrão do Ollama (2048/4096 tokens) corta o prompt dos agentes em silêncio.
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS) || 10 * 60_000

function ollamaNumCtx(modelId: string) {
  const explicit = Number(process.env.OLLAMA_NUM_CTX)
  if (explicit > 0) return explicit
  const billions = Number((modelId.match(/(\d+(?:\.\d+)?)\s*b\b/i) || [])[1] || 7)
  // 8k já cobre o prompt dos agentes; contexto maior só aumenta o KV cache e tira o modelo da GPU
  if (billions <= 9) return 8192
  return 4096
}

function withTimeout(signal: AbortSignal | undefined, ms = OLLAMA_TIMEOUT_MS) {
  const timeout = AbortSignal.timeout(ms)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

function ollamaPayload(modelId: string, messages: Message[], stream: boolean, opts: { json?: boolean } = {}) {
  return {
    model: modelId,
    messages,
    stream,
    // Mantém o modelo carregado entre os passos do agente em vez de recarregar a cada chamada
    keep_alive: process.env.OLLAMA_KEEP_ALIVE || '30m',
    options: {
      num_ctx: ollamaNumCtx(modelId),
      temperature: opts.json ? 0.2 : 0.7,
    },
    ...(opts.json ? { format: 'json' } : {}),
  }
}

/**
 * Gemini, DeepSeek reasoner and Mistral reject empty turns, a history that starts with the
 * assistant or two turns in a row from the same role. Those appear after a failed answer or
 * when old turns are trimmed, so they are cleaned up for every provider.
 */
export function normalizeTurns(messages: Message[]): Message[] {
  const out: Message[] = []
  for (const m of messages) {
    if (!m.content.trim()) continue
    if (m.role === 'assistant' && !out.some(x => x.role !== 'system')) continue
    const last = out[out.length - 1]
    if (last && last.role === m.role) out[out.length - 1] = { ...last, content: `${last.content}\n\n${m.content}` }
    else out.push(m)
  }
  return out
}

/** ~4 characters per token; only used when the provider doesn't report usage. */
function estimateUsage(messages: Message[], output: string): Usage {
  const input = messages.reduce((n, m) => n + m.content.length, 0)
  return { inputTokens: Math.ceil(input / 4), outputTokens: Math.ceil(output.length / 4), estimated: true }
}

async function callGemini(
  modelId: string,
  messages: Message[],
  onChunk: (c: StreamChunk) => void,
  signal?: AbortSignal,
) {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw missingKey('Google Gemini')

  const genAI = new GoogleGenerativeAI(apiKey)
  // Saída máxima do modelo (o padrão do SDK deixa a resposta curta em textos/código longos)
  const model = genAI.getGenerativeModel({ model: modelId, generationConfig: { maxOutputTokens: outputBudget('gemini', modelId) } })

  const systemMsg = messages.find(m => m.role === 'system')
  const chatMsgs = messages.filter(m => m.role !== 'system')

  const history = chatMsgs.slice(0, -1).map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }))

  const lastMsg = chatMsgs[chatMsgs.length - 1]

  const chat = model.startChat({
    history,
    systemInstruction: systemMsg ? { role: 'system', parts: [{ text: systemMsg.content }] } : undefined,
  })

  const result = await chat.sendMessageStream(lastMsg.content, { signal })

  let output = ''

  for await (const chunk of result.stream) {
    if (signal?.aborted) break
    // Streams every piece; the `done` chunk below carries no text (the chat appends all chunks)
    const text = chunk.text()
    if (text) {
      output += text
      onChunk({ content: text, done: false, model: modelId })
    }
  }

  let metaUsage: Usage = estimateUsage(messages, output)
  try {
    const meta = (await result.response).usageMetadata
    if (meta) metaUsage = { inputTokens: meta.promptTokenCount || 0, outputTokens: meta.candidatesTokenCount || 0 }
  } catch {}

  onChunk({ content: '', done: true, model: modelId, usage: metaUsage })
}

// ── Anthropic Messages API (SSE nativo, sem SDK) ─────────────────────────────
// O Claude não é OpenAI-compatible, mas a API de /v1/messages tem streaming SSE
// simples: message_start traz o uso de entrada; content_block_delta traz o texto;
// message_delta traz o uso de saída acumulado; message_stop encerra.
const ANTHROPIC_BASE = 'https://api.anthropic.com/v1'

/** Endpoint /messages a partir da base (com ou sem /v1). */
function anthropicUrl(base: string) {
  const b = base.replace(/\/+$/, '')
  return /\/v\d+$/.test(b) ? `${b}/messages` : `${b}/v1/messages`
}

function anthropicHeaders(apiKey: string, stream: boolean): Record<string, string> {
  return {
    'x-api-key': apiKey,
    // Gateways compatíveis às vezes leem a chave do Authorization
    Authorization: `Bearer ${apiKey}`,
    'anthropic-version': '2023-06-01',
    'Content-Type': 'application/json',
    ...(stream ? { accept: 'text/event-stream' } : {}),
  }
}

async function anthropicError(res: Response, label = 'Anthropic') {
  let detail = res.statusText
  try {
    const body = await res.json() as { error?: { message?: string } | string; message?: string }
    detail = (typeof body?.error === 'string' ? body.error : body?.error?.message) || body?.message || detail
  } catch {}
  const err = Object.assign(new Error(
    res.status === 401 || res.status === 403 ? `${label}: chave inválida ou sem permissão (${res.status}): ${detail}`
      : res.status === 429 ? `${label}: limite de taxa (429). ${detail}`
        : `${label}: erro ${res.status}. ${detail}`,
  ), { status: res.status, headers: { 'retry-after': res.headers.get('retry-after') || '' } })
  return err
}

function anthropicPayload(modelId: string, messages: Message[], stream: boolean) {
  const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n')
  return {
    model: modelId,
    max_tokens: Math.max(8192, Math.min(32_000, modelLimits(`anthropic|${modelId}`)?.maxTokens || 8192)),
    ...(system ? { system } : {}),
    stream,
    messages: messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role, content: m.content })),
  }
}

/**
 * Anthropic Messages (Claude e gateways compatíveis), com streaming de verdade: cada pedaço de
 * texto e de raciocínio sai na hora. (A versão anterior juntava tudo, mandava só no fim e trocava
 * cada quebra de linha por espaço — listas, código e parágrafos chegavam colados.)
 */
async function callAnthropic(
  modelId: string,
  messages: Message[],
  onChunk: (c: StreamChunk) => void,
  signal?: AbortSignal,
  conn: { baseUrl: string; apiKey: string; label: string } | null = null,
) {
  const apiKey = conn?.apiKey || process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw missingKey('Anthropic (Claude)')
  const label = conn?.label || 'Anthropic'

  const res = await fetch(anthropicUrl(conn?.baseUrl || ANTHROPIC_BASE), {
    method: 'POST',
    headers: anthropicHeaders(apiKey, true),
    body: JSON.stringify(anthropicPayload(modelId, messages, true)),
    signal,
  })
  if (!res.ok) throw await anthropicError(res, label)
  if (!res.body) throw new Error(`${label}: resposta sem corpo`)

  // Gateway que ignora "stream": devolve o JSON completo
  if (!/event-stream/i.test(res.headers.get('content-type') || '')) {
    const d = await res.json() as { content?: Array<{ type: string; text?: string; thinking?: string }>; usage?: { input_tokens?: number; output_tokens?: number }; stop_reason?: string }
    const text = (d.content || []).filter(c => c.type === 'text').map(c => c.text || '').join('')
    const thought = (d.content || []).filter(c => c.type === 'thinking').map(c => c.thinking || '').join('')
    if (thought) onChunk({ content: '', reasoning: thought, done: false, model: modelId })
    if (!text) throw emptyAnswerError(d.stop_reason, modelId)
    onChunk({ content: text, done: false, model: modelId })
    onChunk({ content: '', done: true, model: modelId, usage: d.usage ? { inputTokens: d.usage.input_tokens || 0, outputTokens: d.usage.output_tokens || 0 } : estimateUsage(messages, text) })
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let output = ''
  let thought = ''
  let stopReason = ''
  let inputTokens = 0
  let outputTokens = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (signal?.aborted) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line.startsWith('data:')) continue
      let json: {
        type?: string
        message?: { usage?: { input_tokens?: number; output_tokens?: number } }
        delta?: { type?: string; text?: string; thinking?: string; stop_reason?: string }
        usage?: { input_tokens?: number; output_tokens?: number }
        error?: { message?: string }
      }
      try { json = JSON.parse(line.slice(5).trim()) } catch { continue }

      if (json.type === 'message_start') {
        inputTokens = json.message?.usage?.input_tokens || 0
        outputTokens = json.message?.usage?.output_tokens || 0
      } else if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta' && json.delta.text) {
        output += json.delta.text
        onChunk({ content: json.delta.text, done: false, model: modelId })
      } else if (json.type === 'content_block_delta' && json.delta?.type === 'thinking_delta' && json.delta.thinking) {
        thought += json.delta.thinking
        onChunk({ content: '', reasoning: json.delta.thinking, done: false, model: modelId })
      } else if (json.type === 'message_delta') {
        if (typeof json.usage?.output_tokens === 'number') outputTokens = json.usage.output_tokens
        if (typeof json.usage?.input_tokens === 'number' && json.usage.input_tokens) inputTokens = json.usage.input_tokens
        if (json.delta?.stop_reason) stopReason = json.delta.stop_reason
      } else if (json.type === 'error') {
        throw new Error(`${label}: ${json.error?.message || 'erro no stream'}`)
      }
    }
  }
  if (!output && !thought && !signal?.aborted) throw emptyAnswerError(stopReason, modelId)
  onChunk({ content: '', done: true, model: modelId, usage: inputTokens + outputTokens
    ? { inputTokens, outputTokens }
    : estimateUsage(messages, output) })
}

async function completeAnthropic(modelId: string, messages: Message[], signal: AbortSignal | undefined, conn: { baseUrl: string; apiKey: string; label: string }) {
  const res = await fetch(anthropicUrl(conn.baseUrl), {
    method: 'POST',
    headers: anthropicHeaders(conn.apiKey, false),
    body: JSON.stringify(anthropicPayload(modelId, messages, false)),
    signal,
  })
  if (!res.ok) throw await anthropicError(res, conn.label)
  const d = await res.json() as { content?: Array<{ type: string; text?: string }>; usage?: { input_tokens?: number; output_tokens?: number }; stop_reason?: string }
  const text = (d.content || []).filter(c => c.type === 'text' || c.text).map(c => c.text || '').join('')
  if (!text) throw emptyAnswerError(d.stop_reason, modelId)
  return {
    text: stripThink(text),
    usage: d.usage ? { inputTokens: d.usage.input_tokens || 0, outputTokens: d.usage.output_tokens || 0 } : estimateUsage(messages, text),
  }
}

// Providers known to accept stream_options.include_usage; strict APIs (e.g. Mistral) reject unknown fields.
// Custom providers try it too: a refusal teaches the quirk (compat.ts) and the request is retried without it.
const USAGE_IN_STREAM = new Set(['openrouter', 'groq', 'custom'])
const isCustom = (providerId: string) => !!PROVIDER_APIS.find(p => p.id === providerId)?.custom
const MAX_COMPAT_RETRIES = 4

async function callOpenAICompatible(
  providerId: string,
  baseUrl: string,
  apiKey: string,
  modelId: string,
  messages: Message[],
  onChunk: (c: StreamChunk) => void,
  signal?: AbortSignal,
  extraHeaders?: Record<string, string>,
) {
  const client = new OpenAI({ apiKey, baseURL: baseUrl, defaultHeaders: extraHeaders, maxRetries: 0 })
  const quirks = quirksOf(`${providerId}|${modelId}`)

  const base: Record<string, unknown> = {
    model: modelId,
    messages,
    stream: true,
    // Extrai o máximo: pede a saída máxima que o modelo (e a cota grátis) aguenta, em vez do padrão
    // baixo de muitos provedores (NVIDIA ~1k, alguns 4k), que cortava respostas longas e código
    max_tokens: outputBudget(providerId, modelId),
  }
  // gpt-oss "pensa" antes de responder: esforço médio no chat (melhor resposta, ainda rápido)
  if (/gpt-oss/.test(modelId)) base.reasoning_effort = 'medium'
  if (USAGE_IN_STREAM.has(providerId) || isCustom(providerId)) base.stream_options = { include_usage: true }
  if (providerId === 'openrouter') base.usage = { include: true }

  let emitted = false
  const emit = (c: StreamChunk) => { if (!c.done) emitted = true; onChunk(c) }

  // Resposta cortada pelo limite (finish_reason "length"): pede a continuação, até 2 vezes, e junta tudo
  let total = ''
  let usage: Usage | undefined
  for (let part = 0; part < 3; part++) {
    const msgs: Message[] = part === 0 ? messages : [...messages, { role: 'assistant', content: total }, { role: 'user', content: CONTINUE_PROMPT }]
    let r: PartResult | null = null
    for (let attempt = 0; !r; attempt++) {
      const body = adaptBody({ ...base, messages: msgs }, quirks)
      try {
        if (body.stream === false) r = await openAIOnce(client, body, modelId, msgs, emit, signal)
        else {
          const stream = await client.chat.completions.create(body as unknown as OpenAI.Chat.ChatCompletionCreateParamsStreaming, { signal })
          r = await consumeOpenAIStream(stream, modelId, msgs, emit, signal)
        }
      } catch (e) {
        // Continuação que falhou: fica com o que já veio (a resposta não some)
        if (part > 0 && total) { r = { output: '', finish: 'error' }; break }
        // Só refaz quando nada saiu ainda e o erro é um campo/forma que este servidor não aceita
        if (signal?.aborted || emitted || attempt >= MAX_COMPAT_RETRIES) throw e
        const quirk = detectQuirk(e, body, quirks)
        if (!quirk) throw e
        quirks.add(quirk)
      }
    }
    total += r.output
    if (r.usage) usage = { inputTokens: (usage?.inputTokens || 0) + r.usage.inputTokens, outputTokens: (usage?.outputTokens || 0) + r.usage.outputTokens, ...(r.usage.cost !== undefined || usage?.cost !== undefined ? { cost: (usage?.cost || 0) + (r.usage.cost || 0) } : {}) }
    if (r.finish !== 'length' || !r.output || signal?.aborted) break
  }
  onChunk({ content: '', done: true, model: modelId, usage: usage || estimateUsage(messages, total) })
}

const CONTINUE_PROMPT = 'Continue exatamente de onde parou (a resposta foi cortada pelo limite de tamanho). Não repita nada do que já escreveu, não comente que está continuando: só o resto do texto/código.'

type PartResult = { output: string; finish: string | null; usage?: Usage }

/**
 * Saída máxima pedida a um modelo: o limite real dele (lista do provedor/models.dev ou capacidades
 * conhecidas), contido pela cota gratuita (no Groq free, max_tokens alto consome a cota por minuto).
 */
export function outputBudget(providerId: string, modelId: string): number {
  const id = `${providerId}|${modelId}`
  const known = modelLimits(id)?.maxTokens || resolveCapabilities(id).maxOutputTokens || 8192
  const tier = budgetTier(id)
  const cap = tier === 'tiny' ? 4096 : tier === 'small' ? 8192 : 32_768
  return Math.max(1024, Math.min(known, cap))
}

async function consumeOpenAIStream(
  stream: AsyncIterable<OpenAI.Chat.ChatCompletionChunk>,
  modelId: string,
  messages: Message[],
  onChunk: (c: StreamChunk) => void,
  signal?: AbortSignal,
) {
  let output = ''
  let thoughtSeen = false
  let finish: string | null = null
  let usage: Usage | undefined
  const think = new ThinkSplitter()
  const sendText = (t: { text: string; reasoning: string }) => {
    if (t.reasoning) { thoughtSeen = true; onChunk({ content: '', reasoning: t.reasoning, done: false, model: modelId }) }
    if (t.text) { output += t.text; onChunk({ content: t.text, done: false, model: modelId }) }
  }

  for await (const chunk of stream) {
    if (signal?.aborted) break
    const choice = chunk.choices?.[0]
    const delta = choice?.delta as (OpenAI.Chat.ChatCompletionChunk.Choice.Delta & { reasoning?: unknown; reasoning_content?: unknown; content?: unknown }) | undefined

    // Every piece goes out as it arrives (real streaming). The `done` chunk carries NO text: the chat
    // appends every chunk's content, so repeating the output there duplicated the answer.
    // `content` may be a string or a list of parts (Mistral Magistral: thinking + text parts).
    const parts = contentParts(delta?.content)
    if (parts.reasoning) sendText({ text: '', reasoning: parts.reasoning })
    // <think>…</think> inline (R1 distills, QwQ) becomes reasoning instead of answer text
    if (parts.text) sendText(think.push(parts.text))

    // Reasoning models (gpt-oss, qwen3, R1…) stream their thinking in a separate field before the answer
    const thought = delta?.reasoning ?? delta?.reasoning_content
    if (typeof thought === 'string' && thought) sendText({ text: '', reasoning: thought })

    if (choice?.finish_reason) finish = choice.finish_reason

    const raw = chunk as unknown as { usage?: Record<string, number>; x_groq?: { usage?: Record<string, number> } }
    const u = raw.usage || raw.x_groq?.usage
    if (u && (u.prompt_tokens || u.completion_tokens)) {
      usage = {
        inputTokens: u.prompt_tokens || 0,
        outputTokens: u.completion_tokens || 0,
        ...(typeof u.cost === 'number' ? { cost: u.cost } : {}),
      }
    }
  }
  sendText(think.flush())
  // A silent, empty answer must surface as an error so the chat moves to the next model
  if (!output && !thoughtSeen && !signal?.aborted) throw emptyAnswerError(finish, modelId)
  // O "done" é enviado por quem chamou, depois de eventuais continuações
  return { output, finish, usage: usage || estimateUsage(messages, output) } as PartResult
}

/** Servidor sem streaming: uma chamada completa, entregue como pedaços (mesmo contrato do stream). */
async function openAIOnce(
  client: OpenAI,
  body: Record<string, unknown>,
  modelId: string,
  messages: Message[],
  onChunk: (c: StreamChunk) => void,
  signal?: AbortSignal,
): Promise<PartResult> {
  const res = await client.chat.completions.create({ ...body, stream: false } as unknown as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming, { signal })
  const choice = res.choices?.[0]
  const msg = choice?.message as (OpenAI.Chat.ChatCompletionMessage & { reasoning?: unknown; reasoning_content?: unknown; content?: unknown }) | undefined
  const parts = contentParts(msg?.content)
  const think = new ThinkSplitter()
  const a = think.push(parts.text)
  const b = think.flush()
  const text = a.text + b.text
  const reasoning = [typeof msg?.reasoning_content === 'string' ? msg.reasoning_content : typeof msg?.reasoning === 'string' ? msg.reasoning : '', parts.reasoning, a.reasoning, b.reasoning].filter(Boolean).join('\n')
  if (reasoning) onChunk({ content: '', reasoning, done: false, model: modelId })
  if (!text && !reasoning) throw emptyAnswerError(choice?.finish_reason, modelId)
  if (text) onChunk({ content: text, done: false, model: modelId })
  const u = res.usage
  return { output: text, finish: choice?.finish_reason || null, usage: u ? { inputTokens: u.prompt_tokens || 0, outputTokens: u.completion_tokens || 0 } : estimateUsage(messages, text) }
}

async function callOllama(
  modelId: string,
  messages: Message[],
  onChunk: (c: StreamChunk) => void,
  signal?: AbortSignal,
) {
  const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
  let response: Response
  try {
    response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: withTimeout(signal),
      body: JSON.stringify(ollamaPayload(modelId, messages, true)),
    })
  } catch (e) {
    if (signal?.aborted) throw e
    throw new Error('Ollama não está rodando neste computador. Escolha outro modelo ou instale o Ollama (ollama.com).')
  }

  if (!response.ok) throw new Error(`Ollama: modelo "${modelId}" indisponível (${response.status}). Rode: ollama pull ${modelId}`)
  if (!response.body) throw new Error('No response body')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let output = ''
  let finished = false

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines.filter(Boolean)) {
      try {
        const parsed = JSON.parse(line)
        const content = parsed.message?.content
        if (content) { output += content; onChunk({ content, done: false, model: modelId }) }
        // Local reasoning models (qwen3, deepseek-r1) think for a long time on this GPU: stream it too
        const thinking = parsed.message?.thinking
        if (typeof thinking === 'string' && thinking) onChunk({ content: '', reasoning: thinking, done: false, model: modelId })
        if (parsed.done) {
          finished = true
          const usage: Usage = parsed.eval_count
            ? { inputTokens: parsed.prompt_eval_count || 0, outputTokens: parsed.eval_count || 0, cost: 0 }
            : estimateUsage(messages, output)
          onChunk({ content: '', done: true, model: modelId, usage })
        }
      } catch {}
    }
  }
  if (!finished) onChunk({ content: '', done: true, model: modelId, usage: estimateUsage(messages, output) })
}

/**
 * Antigravity (agy CLI) não faz streaming: a resposta chega inteira. Emite um chunk com o
 * texto e fecha com done+usage estimado. A cota grátis é compartilhada com a IDE do usuário.
 */
async function callAntigravityBridge(
  modelId: string,
  messages: Message[],
  onChunk: (c: StreamChunk) => void,
  signal?: AbortSignal,
) {
  if (signal?.aborted) throw Object.assign(new Error('Cancelado'), { name: 'AbortError' })
  const text = await callAntigravity(modelId, messages, 180_000, signal)
  if (signal?.aborted) throw Object.assign(new Error('Cancelado'), { name: 'AbortError' })
  onChunk({ content: text, done: false, model: modelId })
  onChunk({ content: '', done: true, model: modelId, usage: estimateUsage(messages, text) })
}

/** Ponte OpenCode: mesmo padrão do Antigravity, mas com uso real reportado pelo CLI. */
async function callOpencodeBridge(
  modelId: string,
  messages: Message[],
  onChunk: (c: StreamChunk) => void,
  signal?: AbortSignal,
) {
  if (signal?.aborted) throw Object.assign(new Error('Cancelado'), { name: 'AbortError' })
  const { text, usage } = await callOpencode(modelId, messages, 180_000, signal)
  if (signal?.aborted) throw Object.assign(new Error('Cancelado'), { name: 'AbortError' })
  onChunk({ content: text, done: false, model: modelId })
  onChunk({ content: '', done: true, model: modelId, usage })
}

export async function streamAI(
  modelId: string,
  messages: Message[],
  onChunk: (c: StreamChunk) => void,
  signal?: AbortSignal,
) {
  if (!modelId) throw new Error('Nenhuma IA conectada. Clique no botão 🔑 Chaves de API para adicionar uma chave.')

  ensureCustomProviders()
  const { provider, model } = splitModelId(modelId)
  assertProviderAllowed(provider)
  messages = normalizeTurns(messages)

  if (provider === 'gemini') return callGemini(model, messages, onChunk, signal)
  if (provider === 'anthropic') return callAnthropic(model, messages, onChunk, signal)
  if (provider === 'antigravity') return callAntigravityBridge(model, messages, onChunk, signal)
  if (provider === 'opencode') return callOpencodeBridge(model, messages, onChunk, signal)
  if (provider === 'ollama') return callOllama(model, messages, onChunk, signal)
  if (provider === 'lmstudio') {
    const base = process.env.LMSTUDIO_BASE_URL || 'http://localhost:1234/v1'
    return callOpenAICompatible('lmstudio', base, 'lm-studio', model, messages, onChunk, signal)
  }

  const api = PROVIDER_APIS.find(p => p.id === provider)
  if (!api?.chatBaseUrl) throw new Error(`Provedor não suportado: ${provider}`)
  if (api.free === false && !PAID_ENABLED) throw paidDisabled(api.name)
  const key = process.env[api.envKey] || (api.mayBeKeyless ? 'custom' : undefined)
  if (!key) throw missingKey(api.name)

  if (api.style === 'anthropic') return callAnthropic(model, messages, onChunk, signal, { baseUrl: api.chatBaseUrl, apiKey: key, label: api.name })
  return callOpenAICompatible(provider, api.chatBaseUrl, key, model, messages, onChunk, signal, api.chatHeaders)
}

// Providers whose OpenAI-compatible API accepts response_format json_object
const JSON_MODE = new Set(['groq', 'mistral', 'cerebras'])

/**
 * One-shot (non-streaming) completion used by agents: reports real token usage on every
 * OpenAI-compatible provider, and JSON mode stops models such as gpt-oss from emitting
 * native tool calls that providers reject when no tools are declared.
 */
export interface NativeToolSpec {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export async function completeOnce(
  modelId: string,
  messages: Message[],
  signal?: AbortSignal,
  opts: { json?: boolean; tools?: NativeToolSpec[] } = {},
): Promise<{ text: string; usage: Usage }> {
  if (!modelId) throw new Error('Nenhuma IA conectada. Clique no botão 🔑 Chaves de API para adicionar uma chave.')
  ensureCustomProviders()
  const { provider, model } = splitModelId(modelId)
  assertProviderAllowed(provider)
  messages = normalizeTurns(messages)
  const caps = resolveCapabilities(modelId)

  if (provider === 'gemini') {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) throw missingKey('Google Gemini')
    const systemMsg = messages.find(m => m.role === 'system')
    const g = new GoogleGenerativeAI(apiKey).getGenerativeModel({
      model,
      systemInstruction: systemMsg ? { role: 'system', parts: [{ text: systemMsg.content }] } : undefined,
      generationConfig: { maxOutputTokens: outputBudget('gemini', model), ...(opts.json && caps.json === 'native' ? { responseMimeType: 'application/json' } : {}) },
    })
    const contents = messages.filter(m => m.role !== 'system').map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }))
    const res = await g.generateContent({ contents }, { signal })
    const text = res.response.text()
    const meta = res.response.usageMetadata
    return { text, usage: meta ? { inputTokens: meta.promptTokenCount || 0, outputTokens: meta.candidatesTokenCount || 0 } : estimateUsage(messages, text) }
  }

  if (provider === 'antigravity') {
    let work = messages
    if (opts.json) {
      const instruction = jsonInstruction(caps)
      const sys = work.find(m => m.role === 'system')
      const content = instruction || 'Responda somente com um objeto JSON válido, sem cercas de código.'
      work = sys
        ? work.map(m => (m === sys ? { ...m, content: `${m.content}\n\n${content}` } : m))
        : [{ role: 'system' as const, content }, ...work]
    }
    const text = await callAntigravity(model, work, 180_000, signal)
    return { text, usage: estimateUsage(messages, text) }
  }

  if (provider === 'opencode') {
    let work = messages
    if (opts.json) {
      const instruction = jsonInstruction(caps)
      const sys = work.find(m => m.role === 'system')
      const content = instruction || 'Responda somente com um objeto JSON válido, sem cercas de código.'
      work = sys
        ? work.map(m => (m === sys ? { ...m, content: `${m.content}\n\n${content}` } : m))
        : [{ role: 'system' as const, content }, ...work]
    }
    const { text, usage } = await callOpencode(model, work, 180_000, signal)
    return { text, usage }
  }

  if (provider === 'ollama') {
    const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: withTimeout(signal),
      body: JSON.stringify(ollamaPayload(model, messages, false, { json: opts.json })),
    }).catch(e => { if (signal?.aborted) throw e; throw new Error('Ollama não está rodando neste computador.') })
    if (!res.ok) throw new Error(`Ollama: modelo "${model}" indisponível (${res.status})`)
    const d = await res.json() as { message?: { content?: string }; prompt_eval_count?: number; eval_count?: number }
    const text = d.message?.content || ''
    return { text, usage: d.eval_count ? { inputTokens: d.prompt_eval_count || 0, outputTokens: d.eval_count, cost: 0 } : estimateUsage(messages, text) }
  }

  // Provedor sem JSON nativo recebe uma instrução explícita em vez de um campo que ele rejeita.
  if (opts.json) {
    const instruction = jsonInstruction(caps)
    if (instruction) {
      const sys = messages.find(m => m.role === 'system')
      messages = sys
        ? messages.map(m => (m === sys ? { ...m, content: `${m.content}\n\n${instruction}` } : m))
        : [{ role: 'system' as const, content: instruction }, ...messages]
    }
  }

  let baseUrl: string
  let apiKey: string
  let headers: Record<string, string> | undefined
  if (provider === 'lmstudio') {
    baseUrl = process.env.LMSTUDIO_BASE_URL || 'http://localhost:1234/v1'
    apiKey = 'lm-studio'
  } else if (provider === 'anthropic') {
    const key = process.env.ANTHROPIC_API_KEY
    if (!key) throw missingKey('Anthropic (Claude)')
    if (!PAID_ENABLED) throw paidDisabled('Anthropic (Claude)')
    return completeAnthropic(model, messages, signal, { baseUrl: ANTHROPIC_BASE, apiKey: key, label: 'Anthropic' })
  } else {
    const api = PROVIDER_APIS.find(p => p.id === provider)
    if (!api?.chatBaseUrl) throw new Error(`Provedor não suportado: ${provider}`)
    if (api.free === false && !PAID_ENABLED) throw paidDisabled(api.name)
    const key = process.env[api.envKey] || (api.mayBeKeyless ? 'custom' : undefined)
    if (!key) throw missingKey(api.name)
    if (api.style === 'anthropic') return completeAnthropic(model, messages, signal, { baseUrl: api.chatBaseUrl, apiKey: key, label: api.name })
    baseUrl = api.chatBaseUrl
    apiKey = key
    headers = api.chatHeaders
  }

  const client = new OpenAI({ apiKey, baseURL: baseUrl, defaultHeaders: headers, maxRetries: 0 })
  // Extrai o máximo: saída máxima do modelo; nos agentes (JSON/ferramentas) o raciocínio vai no esforço alto
  const base: Record<string, unknown> = { model, messages, stream: false, max_tokens: outputBudget(provider, model) }
  if (/gpt-oss/.test(model)) base.reasoning_effort = opts.json || opts.tools?.length ? 'high' : 'medium'
  if (opts.tools?.length && caps.tools) {
    base.tools = opts.tools.map(t => ({ type: 'function', function: t }))
    base.tool_choice = 'auto'
  } else if (opts.json && caps.json === 'native' && (JSON_MODE.has(provider) || isCustom(provider))) {
    base.response_format = { type: 'json_object' }
  }
  if (provider === 'openrouter') base.usage = { include: true }

  // Mesma camada de compatibilidade do streaming: campo recusado → refaz sem ele e lembra
  const quirks = quirksOf(`${provider}|${model}`)
  let res: OpenAI.Chat.ChatCompletion
  for (let attempt = 0; ; attempt++) {
    const body = adaptBody(base, quirks)
    body.stream = false
    try {
      res = await client.chat.completions.create(body as unknown as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming, { signal })
      break
    } catch (e) {
      if (signal?.aborted || attempt >= MAX_COMPAT_RETRIES) throw e
      const quirk = detectQuirk(e, body, quirks)
      // Sem streaming não há o que tirar; qualquer outro erro segue para a troca de modelo
      if (!quirk || quirk === 'no_stream') throw e
      quirks.add(quirk)
    }
  }
  const msg = res.choices?.[0]?.message
  // content may come as a list of parts; <think> blocks are dropped so agents get clean JSON
  let text = stripThink(contentParts(msg?.content as unknown).text)
  if (!text && !msg?.tool_calls?.length) throw emptyAnswerError(res.choices?.[0]?.finish_reason, model)
  // Texto livre cortado pelo limite: pede a continuação (até 2 vezes). JSON/ferramentas não — juntar
  // pedaços de JSON quebraria o protocolo dos agentes; lá o max_tokens alto já evita o corte
  let extraUsage = { inputTokens: 0, outputTokens: 0 }
  if (!opts.json && !msg?.tool_calls?.length) {
    let finish = res.choices?.[0]?.finish_reason
    for (let part = 1; part < 3 && finish === 'length' && !signal?.aborted; part++) {
      try {
        const more = await client.chat.completions.create({ ...adaptBody(base, quirks), stream: false, messages: [...messages, { role: 'assistant', content: text }, { role: 'user', content: CONTINUE_PROMPT }] } as unknown as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming, { signal })
        const piece = stripThink(contentParts(more.choices?.[0]?.message?.content as unknown).text)
        if (!piece) break
        text += piece
        finish = more.choices?.[0]?.finish_reason
        extraUsage = { inputTokens: extraUsage.inputTokens + (more.usage?.prompt_tokens || 0), outputTokens: extraUsage.outputTokens + (more.usage?.completion_tokens || 0) }
      } catch { break }
    }
  }
  // Native tool calls become the same {"thought","actions"} text the agent protocol uses
  if (msg?.tool_calls?.length) {
    text = JSON.stringify({
      thought: text,
      actions: msg.tool_calls.map(tc => {
        // JSON inválido não vira {} em silêncio (era o "Parâmetro path é obrigatório"): o texto
        // segue adiante e o parseAgentTurn tenta consertar (vírgula sobrando, aspas, cercas)
        let args: unknown = tc.function.arguments || '{}'
        try { args = JSON.parse(tc.function.arguments || '{}') } catch {}
        return { tool: tc.function.name, args }
      }),
    })
  }
  const u = res.usage as (OpenAI.CompletionUsage & { cost?: number }) | undefined
  return {
    text,
    usage: u ? { inputTokens: (u.prompt_tokens || 0) + extraUsage.inputTokens, outputTokens: (u.completion_tokens || 0) + extraUsage.outputTokens, ...(typeof u.cost === 'number' ? { cost: u.cost } : {}) } : estimateUsage(messages, text),
  }
}

export type ModelErrorKind = 'rate_limit' | 'overloaded' | 'unavailable' | 'auth' | 'context' | 'cancelled' | 'network' | 'format' | 'other'

/** Classifies provider errors so the agent runtime can decide between waiting, switching model or failing. */
export function classifyModelError(err: unknown): { kind: ModelErrorKind; retryAfterMs?: number; message: string } {
  const e = err as { status?: number; name?: string; message?: string; headers?: Record<string, string> }
  const message = String(e?.message || err)
  const status = e?.status || Number(message.match(/\b(4\d\d|5\d\d)\b/)?.[1]) || 0
  if (e?.name === 'AbortError' || /abort|cancel/i.test(message)) return { kind: 'cancelled', message }

  let retryAfterMs: number | undefined
  const hdr = e?.headers?.['retry-after']
  if (hdr && !isNaN(Number(hdr))) retryAfterMs = Number(hdr) * 1000
  const m = message.match(/try again in\s+(?:(\d+)m)?([\d.]+)s/i) || message.match(/retry in\s+([\d.]+)\s*s/i)
  if (m) retryAfterMs = ((m.length === 3 ? Number(m[1] || 0) * 60 : 0) + Number(m[m.length - 1])) * 1000

  if (status === 429 || /rate.?limit|quota|too many requests|resource.?exhausted|free.?usage.?limit|free.?limit/i.test(message)) return { kind: 'rate_limit', retryAfterMs, message }
  if (status === 503 || status === 502 || status === 529 || /overloaded|high demand|unavailable/i.test(message)) return { kind: 'overloaded', retryAfterMs, message }
  if (status === 404 || status === 410 || /does not exist|not found|decommissioned|no longer supported|no longer available|end of life|model_not_found/i.test(message)) return { kind: 'unavailable', message }
  if (status === 401 || status === 402 || status === 403 || /invalid api key|unauthori[sz]ed|permission|payment required|not part of the (free )?tier|billing|purchase (credits|tokens)/i.test(message)) return { kind: 'auth', message }
  if (/context.?length|too long|maximum context|max_tokens|token limit|longa demais/i.test(message)) return { kind: 'context', message }
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN|fetch failed|network|connection (error|reset|closed)|socket hang up|broken pipe/i.test(message)) return { kind: 'network', message }
  if (/tool choice is none|called a tool|tool_use_failed|json_validate_failed|failed to generate json/i.test(message)) return { kind: 'format', message }
  return { kind: 'other', message }
}
