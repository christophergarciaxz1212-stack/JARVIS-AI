/**
 * Camada de catálogo do JARVIS.
 * Reaproveita o registro de provedores do projeto (PROVIDER_APIS) e só adiciona:
 * ranking por tarefa, teste de qualquer modelo e o modo "melhor IA automática".
 *
 * Regra do catálogo: só entram provedores e modelos gratuitos. Os provedores pagos
 * (OpenAI, Anthropic, DeepSeek, xAI) foram removidos; as chaves salvas em keys.json
 * não são apagadas. Para reativá-los, registre os blocos de novo em PROVIDER_APIS
 * e defina JARVIS_ALLOW_PAID=1 no .env.local.
 */
import type { AIModel, Provider } from '@/types'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { chatProviders, getProviderModels, pickDefault, SEP, splitModelId } from './providers'
import { ensureCustomProviders } from './customProviders'
import { completeOnce, streamAI } from './client'
import { AGY_PROVIDER, probeAntigravity } from './antigravity'
import { OPENCODE_PROVIDER, probeOpencode } from './opencodeBridge'
import { isHiddenModel, lacksCapability, measuredMs, readModelTests, recordModelTest, type ModelCapability, type ModelTest } from './modelTests'

/** Alias mantido para compatibilidade com o restante do código. */
export type LiveProvider = Provider

// 127.0.0.1, not localhost: Ollama listens on IPv4 only and "localhost" tries ::1 first
const LOCAL: Record<string, { base: string; tags?: string }> = {
  ollama: { base: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434', tags: '/api/tags' },
  lmstudio: { base: process.env.LMSTUDIO_BASE_URL || 'http://127.0.0.1:1234/v1', tags: '/models' },
}

// Last answer of each local server. The catalog is read on every chat message: a busy Ollama
// must neither delay the message nor make its models vanish for a moment.
const gl = globalThis as unknown as { __jarvisLocalProbe?: Map<string, { at: number; result: Provider }>; __jarvisLocalProbing?: Set<string> }
const LOCAL_CACHE = (gl.__jarvisLocalProbe ??= new Map())
const LOCAL_PROBING = (gl.__jarvisLocalProbing ??= new Set())
const LOCAL_TTL = 15_000

async function probeLocalCached(id: string, name: string, icon: string, free: boolean, force: boolean): Promise<Provider> {
  const refresh = async () => {
    LOCAL_PROBING.add(id)
    try {
      const result = await probeLocal(id, name, icon, free)
      const prev = LOCAL_CACHE.get(id)
      // One slow answer (model loading) does not disconnect a server that answered a moment ago
      if (result.status === 'connected' || !prev || prev.result.status !== 'connected' || Date.now() - prev.at > 120_000) {
        LOCAL_CACHE.set(id, { at: Date.now(), result })
      }
      return LOCAL_CACHE.get(id)!.result
    } finally {
      LOCAL_PROBING.delete(id)
    }
  }
  const hit = LOCAL_CACHE.get(id)
  if (!hit || force) return refresh()
  if (Date.now() - hit.at > LOCAL_TTL && !LOCAL_PROBING.has(id)) refresh().catch(() => {})
  return hit.result
}

// Medições feitas nesta máquina (teste de modelo): memória do processo, não do arquivo
const g = globalThis as unknown as { __jarvisLatency?: Map<string, { ms: number; at: number }> }
const LATENCY = (g.__jarvisLatency ??= new Map())

/** Guarda a latência real medida no teste; o ranking prefere modelos comprovadamente rápidos. */
export function noteLatency(modelId: string, ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return
  LATENCY.set(modelId, { ms, at: Date.now() })
}

export function latencyOf(modelId: string): number | undefined {
  // Measurements saved on disk survive restarts
  return LATENCY.get(modelId)?.ms ?? measuredMs(modelId)
}

async function probeLocal(id: string, name: string, icon: string, free: boolean): Promise<Provider> {
  if (id === 'antigravity') return probeAntigravity()
  if (id === 'opencode') return probeOpencode()
  const local = LOCAL[id]
  const base = { id, name, icon, envKey: '', baseUrl: local.base, free, models: [] as AIModel[] }
  try {
    const res = await fetch(`${local.base}${local.tags}`, { signal: AbortSignal.timeout(2500), cache: 'no-store' })
    if (!res.ok) return { ...base, status: 'disconnected' }
    const data: any = await res.json()
    const list: any[] = data.models || data.data || []
    // Ollama: which models are already loaded (a cold one takes 20–100 s on this GPU before the first word)
    let loadedNames: Set<string> | null = null
    if (id === 'ollama') {
      try {
        const ps: any = await (await fetch(`${local.base}/api/ps`, { signal: AbortSignal.timeout(1500), cache: 'no-store' })).json()
        loadedNames = new Set((ps.models || []).map((m: any) => String(m.name || m.model)))
      } catch { loadedNames = null }
    }
    const models: AIModel[] = list.map((m) => {
      const rawId = String(m.name || m.id || '')
      const cat = /coder|code/i.test(rawId) ? 'code' : /reason|r1|think/i.test(rawId) ? 'reasoning' : /vision|vl/i.test(rawId) ? 'vision' : 'chat'
      const billions = Number((rawId.match(/(\d+(?:\.\d+)?)\s*b\b/i) || [])[1] || 0)
      return {
        id: `${id}${SEP}${rawId}`,
        name: rawId.split('/').pop() || rawId,
        provider: id,
        providerName: name,
        category: cat,
        contextWindow: Number(m.details?.context_length || 0),
        maxTokens: 8192,
        free: true,
        multimodal: /vision|vl|llava|gemma3/i.test(rawId),
        toolSupport: /llama3|qwen|mistral|deepseek|phi|granite/i.test(rawId),
        streaming: true,
        speed: billions && billions <= 4 ? 'fast' : billions >= 9 ? 'slow' : 'medium',
        status: 'available',
        ...(loadedNames ? { loaded: loadedNames.has(rawId) } : {}),
      } as AIModel
    })
    return { ...base, status: models.length ? 'connected' : 'disconnected', models }
  } catch {
    return { ...base, status: 'disconnected' }
  }
}

/**
 * Provedores como a NVIDIA listam no mesmo catálogo modelos que não conversam: tradução (o
 * riva-translate "respondia" traduzindo a pergunta e chegou a virar o modelo padrão por ser rápido),
 * embeddings, reranking, guardas de segurança, reward e fala. Nenhuma função do JARVIS os usa.
 */
const NON_CONVERSATIONAL = /(translate|embed|rerank|guard|safety|reward|moderation|whisper|\btts\b|[-/]asr|parakeet|canary-|nv-?clip|paligemma|retriever|nvclip|-vlm-embed)/i
export function isConversational(modelId: string) {
  return !NON_CONVERSATIONAL.test(modelId.slice(modelId.indexOf(SEP) + 1))
}

/** Sonda todos os provedores gratuitos: chave presente = tenta listar modelos ao vivo. */
export async function getLiveCatalog(force = false): Promise<Provider[]> {
  ensureCustomProviders()
  // Models a recent test proved unusable on a free key (retired, no free quota, blocked) stay out
  const tests = readModelTests()
  const usable = (p: Provider): Provider => {
    const models = p.models.filter(m => !isHiddenModel(m.id, tests) && isConversational(m.id))
    return { ...p, models, status: p.status === 'connected' && !models.length ? 'disconnected' : p.status }
  }
  const cloud = chatProviders().map(async (api): Promise<Provider> => {
    const base = {
      id: api.id,
      name: api.name,
      icon: api.icon,
      envKey: api.envKey,
      baseUrl: api.chatBaseUrl,
      free: api.free,
      models: [] as AIModel[],
    }
    if (LOCAL[api.id]) return usable(await probeLocalCached(api.id, api.name, api.icon, api.free, force))
    // Servidores locais/gateways sem autenticação (mayBeKeyless) são consultados mesmo sem chave
    if (!process.env[api.envKey] && !api.mayBeKeyless) return { ...base, status: 'no-key' }
    try {
      const listed = await getProviderModels(api, { fresh: force })
      // Defesa em profundidade: nenhum modelo pago entra no catálogo, mesmo se o provedor listar um
      const models = listed.filter(m => m.free !== false)
      return usable({ ...base, models, status: models.length ? 'connected' : 'disconnected' })
    } catch {
      return { ...base, status: 'disconnected' }
    }
  })

  const EXTRA_LOCAL: Record<string, { name: string; icon: string }> = {
    ollama: { name: 'Ollama (Local)', icon: '🦙' },
    lmstudio: { name: 'LM Studio (Local)', icon: '🖥️' },
    antigravity: { name: AGY_PROVIDER.name, icon: AGY_PROVIDER.icon },
    opencode: { name: OPENCODE_PROVIDER.name, icon: OPENCODE_PROVIDER.icon },
  }
  const extra = Object.keys(EXTRA_LOCAL)
    .filter((id) => !chatProviders().some((p) => p.id === id))
    .map(async (id) => usable(await probeLocalCached(id, EXTRA_LOCAL[id].name, EXTRA_LOCAL[id].icon, true, force)))

  return Promise.all([...cloud, ...extra])
}

/**
 * Análise de imagens anexadas pelo usuário: usa o melhor Gemini flash conectado
 * (grátis) com a imagem inline. Lança Error com orientação clara se não houver chave.
 */
export async function analyzeImages(
  images: Array<{ data: Buffer; mimeType: string }>,
  prompt: string,
  system?: string,
): Promise<{ text: string; model: string }> {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('Analisar imagens exige a chave do Gemini (GEMINI_API_KEY). Adicione em 🔑 Chaves de API.')
  const catalog = await getLiveCatalog()
  const names = (catalog.find(p => p.id === 'gemini' && p.status === 'connected')?.models || []).map(m => m.id.split(SEP)[1])
  if (!names.length) throw new Error('Nenhum modelo Gemini disponível agora para ver a imagem. Tente novamente em instantes.')
  const preferred = ['gemini-3.5-flash', 'gemini-flash-latest', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.1-flash-lite', 'gemini-flash-lite-latest', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite-preview']
  const g = new GoogleGenerativeAI(key)
  const imageParts = images.map(i => ({ inlineData: { mimeType: i.mimeType, data: i.data.toString('base64') } }))
  // Uma linha por modelo: 503 (alta demanda) e 429 (quota) são comuns nos flash grátis — tenta o próximo
  const order = [...preferred.filter(n => names.includes(n)), ...names.filter(n => /flash/i.test(n)), ...names]
  let last: unknown
  for (const model of [...new Set(order)].slice(0, 5)) {
    try {
      const gm = g.getGenerativeModel({
        model,
        ...(system ? { systemInstruction: { role: 'system', parts: [{ text: system }] } } : {}),
      })
      const res = await gm.generateContent({ contents: [{ role: 'user', parts: [...imageParts, { text: prompt }] }] })
      const text = res.response.text() || ''
      if (!text.trim()) throw new Error('Resposta vazia do modelo')
      return { text, model: `gemini${SEP}${model}` }
    } catch (e) {
      last = e
    }
  }
  const msg = last instanceof Error ? last.message : String(last)
  throw new Error(`Não consegui analisar a imagem agora (${msg.replace(/\[GoogleGenerativeAI Error\]:\s*/i, '').slice(0, 220)}). Tente de novo em instantes.`)
}

/** Chamada de chat unificada: usa o mesmo cliente do chat (Gemini, Ollama e OpenAI-compatible). */
export async function chatCompletion(opts: {
  providerId: string
  model: string
  messages: { role: string; content: string }[]
  temperature?: number
  maxTokens?: number
}) {
  const id = opts.model.includes(SEP) ? opts.model : `${opts.providerId}${SEP}${opts.model}`
  const messages = opts.messages
    .filter(m => m.role === 'system' || m.role === 'user' || m.role === 'assistant')
    .map(m => ({ role: m.role as 'system' | 'user' | 'assistant', content: m.content }))
  const { text, usage } = await completeOnce(id, messages)
  return { text, usage }
}

/** Testa um modelo de qualquer provedor (Gemini, Ollama, OpenRouter, Groq…). */
// Every probe asks for a small sum: a model that echoes, translates or ignores the instruction
// (and would still "answer ok") fails here instead of becoming the default.
const visible = (text: string) => text.replace(/<think>[\s\S]*?<\/think>/gi, '')

/** Streaming exactly as the chat does it: system prompt + user turn; only visible text counts (not reasoning). */
async function probeStream(id: string, timeoutMs: number) {
  let text = ''
  await streamAI(id, [
    { role: 'system', content: 'Você é o JARVIS. Responda em português, curto.' },
    { role: 'user', content: 'Quanto é 9 + 4? Responda só com o número.' },
  ], c => { if (c.content) text += c.content }, AbortSignal.timeout(timeoutMs))
  if (!text.trim()) throw new Error('streaming terminou sem texto visível (só raciocínio ou vazio)')
  if (!/\b13\b|treze/i.test(visible(text))) throw new Error(`não seguiu a instrução no chat: "${text.replace(/\s+/g, ' ').slice(0, 80)}"`)
}

/** JSON as agents, the video director, the Hub and netlab ask for it, parsed the tolerant way they parse it. */
async function probeJson(id: string, timeoutMs: number) {
  const { text } = await completeOnce(id, [
    { role: 'system', content: 'Responda somente com um objeto JSON válido.' },
    { role: 'user', content: 'Devolva um objeto JSON com o campo "soma" igual a 6 + 2, o campo "ok" igual a true e o campo "itens" com a lista [1, 2, 3].' },
  ], AbortSignal.timeout(timeoutMs), { json: true })
  const body = visible(text)
  const raw = body.slice(body.indexOf('{'), body.lastIndexOf('}') + 1)
  let parsed: { ok?: unknown; itens?: unknown; soma?: unknown } = {}
  try { parsed = JSON.parse(raw) } catch { throw new Error(`JSON inválido: ${text.replace(/\s+/g, ' ').slice(0, 80)}`) }
  if (parsed.ok !== true || !Array.isArray(parsed.itens) || Number(parsed.soma) !== 8) throw new Error(`JSON sem os campos/valores pedidos: ${raw.slice(0, 80)}`)
}

/**
 * Tests a model. `full` also checks the two capabilities JARVIS depends on (streaming for the chat,
 * JSON for agents/director/Hub/netlab) and records them, so each feature only picks models that work for it.
 */
export async function testProviderModel(providerId: string, modelId: string, opts: { full?: boolean } = {}) {
  const started = Date.now()
  const id = modelId.includes(SEP) ? modelId : `${providerId}${SEP}${modelId}`
  try {
    const { provider, model } = splitModelId(id)
    const { text } = await completeOnce(
      id,
      [{ role: 'user', content: 'Quanto é 7 + 5? Responda só com o número.' }],
      AbortSignal.timeout(120_000),
    )
    const latencyMs = Date.now() - started
    if (!text.trim()) throw new Error('Resposta vazia do modelo')
    if (!/\b12\b|doze/i.test(visible(text))) throw new Error(`O modelo não segue instruções (não é de conversa?): "${text.replace(/\s+/g, ' ').slice(0, 80)}"`)
    noteLatency(id, latencyMs)
    let caps: ModelTest['caps']
    const capErrors: NonNullable<ModelTest['capErrors']> = {}
    if (opts.full) {
      caps = {}
      const probes: Array<[ModelCapability, () => Promise<void>]> = [['stream', () => probeStream(id, 120_000)], ['json', () => probeJson(id, 120_000)]]
      for (const [cap, run] of probes) {
        try { await run(); caps[cap] = true } catch (e) {
          const msg = String((e as Error).message)
          // Rate limit/overload mid-test says nothing about the capability: leave it unknown
          if (/429|rate.?limit|quota|too many|503|overloaded|timeout|timed out|aborted/i.test(msg)) capErrors[cap] = `não medido: ${msg.slice(0, 160)}`
          else { caps[cap] = false; capErrors[cap] = msg.slice(0, 200) }
        }
      }
    }
    recordModelTest(id, { ok: true, ms: latencyMs, caps, capErrors })
    return { success: true, latencyMs, reply: text.slice(0, 120), provider, model, caps, capErrors: Object.keys(capErrors).length ? capErrors : undefined }
  } catch (error) {
    const message = String((error as Error).message)
    const saved = recordModelTest(id, { ok: false, error: message })
    return { success: false, latencyMs: Date.now() - started, error: message, kind: saved.ok ? undefined : saved.kind }
  }
}

const TASK_HINTS: Record<string, RegExp> = {
  code: /coder|codestral|devstral|deepseek|qwen|llama-3\.3/i,
  reasoning: /reason|think|r1|qwq|gemini-2/i,
  vision: /vision|vl|llava|pixtral|gemini/i,
  fast: /flash|instant|mini|8b|lite|nano|haiku|3b|4b/i,
  chat: /./,
}

export function detectTask(text: string): string {
  const s = String(text || '').toLowerCase()
  if (/(código|codigo|program|bug|refator|api|typescript|python|react|função|erro|stack|teste)/.test(s)) return 'code'
  if (/(racioc|analis|lógica|logica|prove|demonstr|matemática|matematica|planej|arquitet)/.test(s)) return 'reasoning'
  if (/(imagem|image|logo|banner|capa|vision|foto|print|design)/.test(s)) return 'vision'
  if (/(rápido|rapido|resum|curto|instant)/.test(s)) return 'fast'
  return 'chat'
}

/**
 * Ranking: tarefa + gratuidade + contexto + eficiência local + latência medida.
 * Modelos locais grandes (>9B) perdem pontos em tarefas rápidas: em 6 GB de VRAM
 * eles estouram a GPU e ficam mais lentos que a nuvem gratuita.
 */
export function rankModels(providers: Provider[], task: string): AIModel[] {
  const hint = TASK_HINTS[task] || TASK_HINTS.chat
  return providers
    .filter((p) => p.status === 'connected')
    .flatMap((p) => p.models)
    .filter((model) => model.free !== false)
    .map((model) => {
      let score = 50
      const id = model.id.slice(model.id.indexOf(SEP) + 1)
      if (hint.test(id)) score += 25
      if (model.free) score += 12
      if (model.category === task) score += 10
      if (model.contextWindow >= 200_000) score += 8
      else if (model.contextWindow >= 100_000) score += 4
      if (/embed|guard|moderation|whisper|tts|image|video|veo|sora/i.test(id)) score -= 60

      const local = model.provider === 'ollama' || model.provider === 'lmstudio'
      if (local) {
        // No flat bonus for being local: on this GPU a warm 4B model takes ~1–2 s and a cold one 20–100 s,
        // while the fastest cloud models answer in 0.3 s — the measured latency below decides.
        const billions = Number((id.match(/(\d+(?:\.\d+)?)\s*b\b/i) || [])[1] || 0)
        if (billions > 4) score -= 6
        if (task === 'fast' && billions > 6) score -= 18
        if (billions > 12) score -= 20
        // "Melhor IA automática" must not pick a cold local model for a quick question (48 s for "17 x 3")
        if (model.loaded === false) score -= 25
      }
      const measured = latencyOf(model.id)
      if (measured) score += Math.max(-15, 10 - measured / 1500)
      return { model, score }
    })
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.model)
}

/** Modelo padrão quando o usuário não escolheu nenhum. */
export function defaultModelFrom(catalog: Provider[]): string {
  // The default serves every feature (chat streams, agents/director need JSON): skip models proven broken at either
  const tests = readModelTests()
  // …and a cold local model would make the first message wait for it to load
  const capable = (m: AIModel) => !lacksCapability(m.id, 'stream', tests) && !lacksCapability(m.id, 'json', tests) && m.loaded !== false
  const candidates = catalog
    .filter(p => p.status === 'connected' && p.models.length)
    .map(p => pickDefault(p.id, p.models.filter(capable)) || pickDefault(p.id, p.models))
    .filter((m): m is AIModel => !!m && m.free !== false && capable(m))
  // Each provider's preferred model; the fastest one measured on this machine wins (catalog order otherwise)
  const measured = candidates.filter(m => latencyOf(m.id) !== undefined).sort((a, b) => latencyOf(a.id)! - latencyOf(b.id)!)
  return (measured[0] || candidates[0])?.id || ''
}

/**
 * Cadeia de fallback: o modelo pedido primeiro, depois alternativas gratuitas do catálogo vivo.
 * Um provedor fora do ar não interrompe a resposta.
 */
export function fallbackChain(catalog: Provider[], preferred: string, limit = 4, need: ModelCapability = 'stream'): string[] {
  const chain: string[] = []
  if (preferred) chain.push(preferred)
  // Alternatives never include a model a full test proved unable to do what this feature needs
  const tests = readModelTests()
  for (const model of rankModels(catalog, 'chat')) {
    if (chain.length >= limit) break
    if (!chain.includes(model.id) && !lacksCapability(model.id, need, tests)) chain.push(model.id)
  }
  return chain
}

export { SEP, splitModelId }
