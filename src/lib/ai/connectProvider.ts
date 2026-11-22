/**
 * "Conectar com URL e chave": o usuário cola só o endereço e a chave de QUALQUER provedor
 * (mesmo desconhecido) e o JARVIS descobre o resto sozinho:
 * - o endereço certo (com/sem /v1, /openai/v1, endpoints colados com /chat/completions…);
 * - o formato da API (OpenAI, Anthropic Messages; Gemini vira o endpoint compatível com OpenAI);
 * - como a chave vai no cabeçalho (Bearer, "api-key" do Azure, "x-api-key");
 * - TODOS os modelos que a API lista (como a DeepSeek faz em /models);
 * e prova com uma conversa de verdade antes de dizer que conectou.
 */
import { completeOnce } from './client'
import { normalizeBaseUrl } from './compat'
import {
  discoverModels, readCustomProviders, upsertCustomProvider, type ApiStyle, type AuthMode,
  type CustomProvider, type DiscoveredModel,
} from './customProviders'
import { SEP } from './providers'
import { recordModelTest } from './modelTests'

/** Nomes bonitos para hosts conhecidos; o resto vira o nome do domínio com inicial maiúscula. */
const KNOWN_NAMES: Record<string, string> = {
  deepseek: 'DeepSeek', openai: 'OpenAI', anthropic: 'Anthropic', mistral: 'Mistral', together: 'Together AI',
  fireworks: 'Fireworks', deepinfra: 'DeepInfra', perplexity: 'Perplexity', 'x': 'xAI', xai: 'xAI', moonshot: 'Moonshot',
  siliconflow: 'SiliconFlow', novita: 'Novita', hyperbolic: 'Hyperbolic', cerebras: 'Cerebras', groq: 'Groq',
  openrouter: 'OpenRouter', huggingface: 'Hugging Face', cohere: 'Cohere', 'z': 'Z.ai', zai: 'Z.ai', minimax: 'MiniMax',
  baidu: 'Baidu', aliyuncs: 'Alibaba (Qwen)', dashscope: 'Alibaba (Qwen)', volces: 'Volcengine', sambanova: 'SambaNova',
  nvidia: 'NVIDIA', googleapis: 'Google Gemini', azure: 'Azure OpenAI', chutes: 'Chutes', kluster: 'Kluster', nebius: 'Nebius',
  lepton: 'Lepton', featherless: 'Featherless', inference: 'Inference.net', github: 'GitHub Models', cloudflare: 'Cloudflare',
}

export function nameFromUrl(url: string): string {
  let u: URL
  try { u = new URL(normalizeBaseUrl(url)) } catch { return 'Provedor' }
  if (/^(localhost|127\.|\[::1\]|192\.168\.|10\.)/.test(u.hostname)) return `Servidor local${u.port ? ` :${u.port}` : ''}`
  if (/openai\.azure\.com$/.test(u.hostname)) return 'Azure OpenAI'
  const labels = u.hostname.split('.')
  // Tira o sufixo do domínio: ".com", ".ai", e também os duplos ".com.br", ".co.uk"
  const cut = labels.length >= 3 && /^(com|net|org|gov|edu|co|ac)$/i.test(labels[labels.length - 2]) && labels[labels.length - 1].length === 2 ? 2 : 1
  const named = labels.slice(0, Math.max(1, labels.length - cut))
  const parts = named.filter(p => !/^(api|www|app|router|inference|openai|gateway|llm|chat|v\d+)$/i.test(p))
  // "api.deepseek.com" → deepseek; "generativelanguage.googleapis.com" → googleapis; "x.ai" → x
  const core = parts[parts.length - 1] || named[named.length - 1] || u.hostname
  return KNOWN_NAMES[core.toLowerCase()] || core.charAt(0).toUpperCase() + core.slice(1)
}

/** Endereços a tentar, do mais provável ao menos. Hosts famosos com formato próprio já saem no certo. */
export function candidateBases(raw: string): Array<{ base: string; style: ApiStyle }> {
  const base = normalizeBaseUrl(raw)
  const host = new URL(base).hostname
  if (/generativelanguage\.googleapis\.com$/.test(host)) return [{ base: 'https://generativelanguage.googleapis.com/v1beta/openai', style: 'openai' }]
  if (/(^|\.)anthropic\.com$/.test(host)) return [{ base: /\/v1$/.test(base) ? base : `${new URL(base).origin}/v1`, style: 'anthropic' }]
  const hasVersion = /\/v\d+[a-z]*$/i.test(base)
  const out: Array<{ base: string; style: ApiStyle }> = [{ base, style: 'openai' }]
  if (!hasVersion) {
    out.push({ base: `${base}/v1`, style: 'openai' })
    out.push({ base: `${base}/openai/v1`, style: 'openai' })
  }
  // Por último, formato Anthropic Messages (gateways e proxies compatíveis com Claude)
  out.push({ base: hasVersion ? base : `${base}/v1`, style: 'anthropic' })
  return out
}

export interface Probe { baseUrl: string; style: ApiStyle; auth: AuthMode; models: DiscoveredModel[] }

/** Acha endereço + formato + cabeçalho que fazem /models responder. */
export async function probeProvider(rawUrl: string, key: string): Promise<Probe> {
  const tried: string[] = []
  let keyRefused = ''
  for (const c of candidateBases(rawUrl)) {
    const auths: AuthMode[] = c.style === 'anthropic' ? ['x-api-key'] : key ? ['bearer', 'api-key', 'x-api-key'] : ['bearer']
    for (const auth of auths) {
      try {
        const r = await discoverModels(c.base, c.style, key, auth)
        return { baseUrl: r.baseUrl, style: c.style, auth, models: r.models }
      } catch (e) {
        const msg = (e as Error).message
        tried.push(`${c.base} (${c.style === 'anthropic' ? 'Anthropic' : 'OpenAI'}${auth !== 'bearer' && c.style !== 'anthropic' ? `, ${auth}` : ''}): ${msg}`)
        if (/Chave inválida/.test(msg)) { keyRefused = msg; continue } // tenta o próximo jeito de mandar a chave
        if (/não respondeu|conectar em/.test(msg)) break // servidor fora do ar: outro cabeçalho não muda nada
        break // 404 etc.: outro endereço
      }
    }
  }
  if (keyRefused) throw new Error(`A API recusou a chave em todos os formatos que testei — confira se ela está completa e ativa. (${keyRefused})`)
  throw new Error(`Não achei a lista de modelos nesse endereço. Testei:\n${tried.slice(0, 6).map(t => `- ${t}`).join('\n')}`)
}

/** Ordem de teste: modelos de conversa leves primeiro (respondem rápido); raciocínio/gigantes por último. */
export function testOrder(models: string[]): string[] {
  const score = (id: string) => {
    let s = 0
    if (/chat|instruct|flash|mini|turbo|small|lite|haiku|8b|7b|9b|v3/i.test(id)) s += 3
    if (/reason|r1\b|think|o1|o3|405b|large|max|ultra|vision|vl\b|coder/i.test(id)) s -= 3
    if (/preview|beta|exp/i.test(id)) s -= 1
    return s
  }
  return [...models].sort((a, b) => score(b) - score(a))
}

export interface ConnectResult {
  provider: CustomProvider
  models: DiscoveredModel[]
  test: { ok: boolean; model?: string; latencyMs?: number; answer?: string; error?: string; tried?: string[] }
  detected: { baseUrl: string; style: ApiStyle; auth: AuthMode }
}

/**
 * Conecta qualquer provedor só com URL e chave. `model` é opcional: só serve para APIs que não
 * listam modelos. Se já existe um provedor com esse endereço, ele é atualizado (não duplica).
 */
export async function connectProvider(input: { baseUrl: string; apiKey: string; name?: string; model?: string; signal?: AbortSignal }): Promise<ConnectResult> {
  const key = (input.apiKey || '').trim()
  if (key && (key.length > 2000 || /\s/.test(key))) throw new Error('Cole a chave completa, sem espaços')
  const manual = (input.model || '').trim()

  let probe: Probe
  try {
    probe = await probeProvider(input.baseUrl, key)
  } catch (e) {
    // API que não lista modelos: com o nome de um modelo, conecta mesmo assim (no formato OpenAI)
    if (!manual) throw new Error(`${(e as Error).message}\n\nSe essa API não lista modelos, informe o nome de um modelo dela e conecte de novo.`)
    const c = candidateBases(input.baseUrl)[0]
    probe = { baseUrl: c.base, style: c.style, auth: 'bearer', models: [] }
  }

  const sameUrl = readCustomProviders().find(p => p.baseUrl === probe.baseUrl)
  const provider = upsertCustomProvider({
    id: sameUrl?.id,
    name: (input.name || '').trim() || sameUrl?.name || nameFromUrl(probe.baseUrl),
    baseUrl: probe.baseUrl,
    style: probe.style,
    // Reconectar o mesmo endereço sem colar a chave mantém a chave salva
    apiKey: key || (sameUrl ? undefined : ''),
    // Lista da API: usa TODOS (vazio = buscar sempre ao vivo); sem lista, o modelo digitado
    manualModels: probe.models.length ? [] : [manual],
    // TODOS os modelos que a API oferece (pedido do usuário, 21/11). Muitas APIs informam preço
    // mesmo no plano grátis (o Groq marca 3 de 4): a etiqueta "pago" é só informativa aqui.
    freeOnly: sameUrl?.freeOnly ?? false,
    auth: probe.auth,
  })

  // Prova de verdade: conversa curta com até 3 modelos, dos mais leves para os mais pesados
  const ids = manual && (!probe.models.length || probe.models.some(m => m.id === manual))
    ? [manual]
    : testOrder(probe.models.filter(m => !(provider.freeOnly && m.paid)).map(m => m.id)).slice(0, 3)
  let test: ConnectResult['test'] = { ok: false, error: 'nenhum modelo para testar' }
  const tried: string[] = []
  for (const model of ids) {
    const fullId = `${provider.id}${SEP}${model}`
    const t0 = Date.now()
    try {
      const signal = input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000)
      const { text } = await completeOnce(fullId, [{ role: 'user', content: 'Quanto é 7+5? Responda só com o número.' }], signal)
      const ms = Date.now() - t0
      if (/\b12\b/.test(text)) {
        recordModelTest(fullId, { ok: true, ms })
        test = { ok: true, model, latencyMs: ms, answer: text.slice(0, 120) }
        break
      }
      test = { ok: false, model, latencyMs: ms, answer: text.slice(0, 120), error: 'respondeu, mas errou a conta 7+5' }
    } catch (e) {
      if (input.signal?.aborted) throw e
      test = { ok: false, model, latencyMs: Date.now() - t0, error: (e as Error).message.slice(0, 300) }
    }
    tried.push(`${model}: ${test.error}`)
  }
  if (!test.ok && tried.length > 1) test.tried = tried
  return { provider, models: probe.models, test, detected: { baseUrl: probe.baseUrl, style: probe.style, auth: probe.auth } }
}
