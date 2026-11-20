import type { AIModel } from '@/types'
import '@/lib/keys'
import { enrichModels } from './models-dev'

// Model ids are "<provider>|<model>" so the same model name from two providers never collides
export const SEP = '|'

export interface ProviderApi {
  id: string
  name: string
  icon: string
  envKey: string
  keyUrl: string
  help: string
  free: boolean
  chatBaseUrl?: string
  chatHeaders?: Record<string, string>
  /** Endpoints OpenAI-compatible sem autenticação: registra com chave placeholder. */
  mayBeKeyless?: boolean
  /** Formato da API de chat: OpenAI (padrão) ou Anthropic Messages (/v1/messages). */
  style?: 'openai' | 'anthropic'
  /** Cadastrado pelo usuário na tela de provedores (data/custom-providers.json). */
  custom?: boolean
  listModels: (key: string) => Promise<AIModel[]>
  // For providers whose /models endpoint is public, listing alone doesn't prove the key works
  verify?: (key: string) => Promise<void>
}

export const NON_CHAT = /embed|whisper|tts|audio|transcri|guard|rerank|moderation|image|imagen|veo|dall-e|stable-diffusion|flux|sdxl|clip|bge|ocr|parse|retriever|reward|safety|aqa|live|computer-use|robotics|realtime|search-preview|sora|lyria|antigravity|deep-research|customtools|orpheus|playai/i

export async function apiError(res: Response) {
  let detail = res.statusText
  try {
    const body = await res.json()
    detail = body?.error?.message || body?.error || body?.message || body?.detail || detail
    if (typeof detail !== 'string') detail = JSON.stringify(detail)
  } catch {}
  if (res.status === 401 || res.status === 403) return new Error(`Chave inválida ou sem permissão (${res.status}): ${detail}`)
  return new Error(`Erro ${res.status}: ${detail}`)
}

async function getJson(url: string, headers: Record<string, string>) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw await apiError(res)
  return res.json()
}

function guessCategory(id: string): AIModel['category'] {
  if (/coder|codestral|devstral|code/i.test(id)) return 'code'
  if (/r1|reason|think|qwq|gpt-oss|magistral/i.test(id)) return 'reasoning'
  if (/instant|8b|mini|flash|lite|small|nano|haiku|fast/i.test(id)) return 'fast'
  return 'chat'
}

export function model(provider: ProviderApi | { id: string; name: string; free: boolean }, rawId: string, extra: Partial<AIModel> = {}): AIModel {
  const category = extra.category || guessCategory(rawId)
  return {
    id: `${provider.id}${SEP}${rawId}`,
    name: rawId.split('/').pop()!.replace(/:free$/, ''),
    provider: provider.id,
    providerName: provider.name,
    category,
    contextWindow: 128000,
    maxTokens: 8192,
    free: provider.free,
    multimodal: /vision|vl|4o|4\.1|gemini|llava|pixtral|scout|maverick|claude|grok-4|gpt-5/i.test(rawId),
    toolSupport: true,
    streaming: true,
    speed: category === 'fast' ? 'fast' : category === 'reasoning' ? 'slow' : 'medium',
    status: 'available',
    ...extra,
  }
}

type OpenAIModel = { id: string; context_window?: number; context_length?: number; active?: boolean; owned_by?: string }

function openAICompatible(
  base: Omit<ProviderApi, 'listModels' | 'chatBaseUrl'> & { baseUrl: string; filter?: (m: OpenAIModel) => boolean },
): ProviderApi {
  const p: ProviderApi = {
    ...base,
    chatBaseUrl: base.baseUrl,
    listModels: async (key) => {
      const data = await getJson(`${base.baseUrl}/models`, { Authorization: `Bearer ${key}` })
      const list: OpenAIModel[] = Array.isArray(data) ? data : data.data || data.models || []
      return list
        .filter(m => m.active !== false && !NON_CHAT.test(m.id) && (!base.filter || base.filter(m)))
        .map(m => model(p, m.id, { contextWindow: m.context_window || m.context_length || 128000 }))
    },
  }
  return p
}

const gemini: ProviderApi = {
  id: 'gemini',
  name: 'Google Gemini',
  icon: '🔵',
  envKey: 'GEMINI_API_KEY',
  keyUrl: 'https://aistudio.google.com/app/apikey',
  help: 'Entre com sua conta Google e clique em "Create API key". Grátis.',
  free: true,  listModels: async (key) => {
    const data = await getJson('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', { 'x-goog-api-key': key })
    type G = { name: string; displayName?: string; description?: string; inputTokenLimit?: number; outputTokenLimit?: number; supportedGenerationMethods?: string[] }
    return (data.models as G[] || [])
      .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
      .map(m => ({ ...m, id: m.name.replace(/^models\//, '') }))
      // Gemma rejects system instructions, which every JARVIS chat sends
      .filter(m => !NON_CHAT.test(m.id) && !/gemma|learnlm|nano-banana/i.test(m.id))
      .map(m => model(gemini, m.id, {
        name: m.displayName || m.id,
        description: m.description?.slice(0, 120),
        contextWindow: m.inputTokenLimit || 1048576,
        maxTokens: m.outputTokenLimit || 8192,
        multimodal: true,
      }))
  },
}

const openrouter: ProviderApi = {
  id: 'openrouter',
  name: 'OpenRouter',
  icon: '🔀',
  envKey: 'OPENROUTER_API_KEY',
  keyUrl: 'https://openrouter.ai/settings/keys',
  help: 'Centenas de modelos numa chave só. Os marcados FREE não gastam créditos.',
  free: true,
  chatBaseUrl: 'https://openrouter.ai/api/v1',
  chatHeaders: { 'HTTP-Referer': 'https://jarvis-ai.local', 'X-Title': 'JARVIS AI' },
  listModels: async (key) => {
    const data = await getJson('https://openrouter.ai/api/v1/models', { Authorization: `Bearer ${key}` })
    type O = { id: string; name?: string; context_length?: number; pricing?: { prompt?: string; completion?: string }; architecture?: { output_modalities?: string[] } }
    return (data.data as O[] || [])
      .filter(m => !m.architecture?.output_modalities || m.architecture.output_modalities.includes('text'))
      .filter(m => !NON_CHAT.test(m.id))
      .map(m => {
        const isFree = m.id.endsWith(':free') || (Number(m.pricing?.prompt) === 0 && Number(m.pricing?.completion) === 0)
        return model(openrouter, m.id, {
          name: m.name || m.id,
          contextWindow: m.context_length || 128000,
          free: isFree,
        })
      })
      // Paid models are removed from the catalog: only free routes stay selectable
      .filter(m => m.free)
  },
  verify: async (key) => {
    await getJson('https://openrouter.ai/api/v1/key', { Authorization: `Bearer ${key}` })
  },
}

const nvidia = openAICompatible({
  id: 'nvidia',
  name: 'NVIDIA NIM',
  icon: '🟢',
  envKey: 'NVIDIA_API_KEY',
  keyUrl: 'https://build.nvidia.com/settings/api-keys',
  help: 'Crie uma conta NVIDIA e gere a chave (começa com nvapi-). Vem com créditos grátis.',
  free: true,
  baseUrl: 'https://integrate.api.nvidia.com/v1',
  filter: m => /instruct|chat|r1|qwen|nemotron|gpt-oss|kimi|glm|mistral|llama-4/i.test(m.id) && !/vila|neva|kosmos|deplot|fuyu|paligemma/i.test(m.id),
})
nvidia.verify = async (key) => {
  const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'meta/llama-3.3-70b-instruct', messages: [{ role: 'user', content: 'ok' }], max_tokens: 1 }),
    signal: AbortSignal.timeout(20000),
  })
  if (!res.ok) throw await apiError(res)
}

export const PROVIDER_APIS: ProviderApi[] = [
  gemini,
  openAICompatible({
    id: 'groq',
    name: 'Groq',
    icon: '⚡',
    envKey: 'GROQ_API_KEY',
    keyUrl: 'https://console.groq.com/keys',
    help: 'Respostas ultra-rápidas. Crie a conta e clique em "Create API Key". Grátis.',
    free: true,
    baseUrl: 'https://api.groq.com/openai/v1',
  }),
  openrouter,
  openAICompatible({
    id: 'mistral',
    name: 'Mistral AI',
    icon: '🌀',
    envKey: 'MISTRAL_API_KEY',
    keyUrl: 'https://console.mistral.ai/api-keys',
    help: 'Escolha o plano gratuito "Experiment" e gere a chave.',
    free: true,
    baseUrl: 'https://api.mistral.ai/v1',
    filter: m => !/ocr|moderation|embed/i.test(m.id),
  }),
  openAICompatible({
    id: 'sambanova',
    name: 'SambaNova',
    icon: '🔴',
    envKey: 'SAMBANOVA_API_KEY',
    keyUrl: 'https://cloud.sambanova.ai/apis',
    help: 'Crie a conta e gere a chave em "APIs". Grátis.',
    free: true,
    baseUrl: 'https://api.sambanova.ai/v1',
  }),
  nvidia,
  // Provedores pagos (OpenAI, Anthropic, DeepSeek, xAI) foram removidos: o JARVIS opera só com gratuitos.
]

// Provedor personalizado (OpenAI-compatible): qualquer endpoint compatível — LiteLLM gateway,
// vLLM, LocalAI, text-generation-webui, um proxy próprio… Registrado apenas se configurado.
// CUSTOM_AI_BASE_URL + opcional CUSTOM_AI_API_KEY (+ CUSTOM_AI_MODEL para forçar um modelo
// e CUSTOM_AI_NAME para o rótulo). O dono do endpoint decide o custo: é tratado como gratuito.
const customBase = (process.env.CUSTOM_AI_BASE_URL || '').replace(/\/+$/, '')
if (customBase) {
  const customModel = (process.env.CUSTOM_AI_MODEL || '').trim()
  const custom: ProviderApi = {
    id: 'custom',
    name: (process.env.CUSTOM_AI_NAME || 'Provedor personalizado').trim(),
    icon: '🧩',
    envKey: 'CUSTOM_AI_API_KEY',
    keyUrl: '',
    help: 'Endpoint OpenAI-compatible configurado em CUSTOM_AI_BASE_URL (LiteLLM gateway, vLLM, LocalAI…).',
    free: true,
    mayBeKeyless: true,
    chatBaseUrl: customBase,
    listModels: async (key) => {
      // CUSTOM_AI_MODEL definido: registro determinístico (funciona sem /models no servidor)
      if (customModel) return [model(custom, customModel)]
      return openAICompatible({
        id: 'custom',
        name: (process.env.CUSTOM_AI_NAME || 'Provedor personalizado').trim(),
        icon: '🧩',
        envKey: 'CUSTOM_AI_API_KEY',
        keyUrl: '',
        help: '',
        free: true,
        mayBeKeyless: true,
        baseUrl: customBase,
      }).listModels(key)
    },
  }
  PROVIDER_APIS.push(custom)
}

/**
 * Trava de segurança para provedores pagos: desligada por padrão. Os provedores pagos
 * (OpenAI, Anthropic, DeepSeek, xAI) foram removidos de PROVIDER_APIS; se um deles for
 * registrado de novo, ele só opera neste JARVIS com JARVIS_ALLOW_PAID=1 no .env.local.
 */
export const PAID_ENABLED = process.env.JARVIS_ALLOW_PAID === '1'

/** Providers the app may actually use: every free one, plus paid ones only when re-enabled. */
export function chatProviders(): ProviderApi[] {
  return PROVIDER_APIS.filter(p => p.free !== false || PAID_ENABLED)
}

export interface ToolKey {
  id: string
  name: string
  icon: string
  envKey: string
  keyUrl: string
  help: string
  verify: (key: string) => Promise<void>
}

export const TOOL_KEYS: ToolKey[] = [
  {
    // GitHub Models (AI) was retired by GitHub on 2026-07-30; the token still lifts the Skills store's search limits
    id: 'github',
    name: 'GitHub (busca de skills)',
    icon: '🐙',
    envKey: 'GITHUB_TOKEN',
    keyUrl: 'https://github.com/settings/personal-access-tokens/new',
    help: 'Deixa a loja de Skills buscar repositórios no GitHub com limite maior. Um token sem permissões extras basta. (O GitHub Models foi desativado pelo GitHub em 30/07/2026.)',
    verify: async (key) => {
      await getJson('https://api.github.com/user', { Authorization: `Bearer ${key}`, Accept: 'application/vnd.github+json', 'User-Agent': 'jarvis-ai' })
    },
  },
  {
    id: 'whatsapp-token',
    name: 'WhatsApp (token de acesso)',
    icon: '💬',
    envKey: 'WA_ACCESS_TOKEN',
    keyUrl: 'https://developers.facebook.com/apps/',
    help: 'Token da WhatsApp Cloud API (começa com "EAA…"). Use um System User token permanente — o token temporário de 24h expira. Criado no painel do seu app → WhatsApp → Configuração da API.',
    verify: async (key) => {
      const res = await fetch('https://graph.facebook.com/v21.0/me?fields=id,name', { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000) })
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: number } }
        throw new Error(d.error?.message || `Token recusado pela Meta (HTTP ${res.status})`)
      }
      return
    },
  },
  {
    id: 'whatsapp-app-secret',
    name: 'WhatsApp (App Secret)',
    icon: '🔐',
    envKey: 'WA_APP_SECRET',
    keyUrl: 'https://developers.facebook.com/apps/',
    help: 'App Secret do seu app Meta (Configurações → Básico → App Secret). Usado para validar a assinatura X-Hub-Signature-256 de cada webhook recebido. Nunca sai deste computador.',
    verify: async () => { return }, // o segredo só é validável em uso; o diagnóstico testa de verdade
  },
  {
    id: 'brave',
    name: 'Brave Search',
    icon: '🦁',
    envKey: 'BRAVE_SEARCH_API_KEY',
    keyUrl: 'https://api-dashboard.search.brave.com/app/keys',
    help: 'Pesquisa na web para o JARVIS. Plano gratuito disponível.',
    verify: async (key) => {
      await getJson('https://api.search.brave.com/res/v1/web/search?q=jarvis&count=1', { 'X-Subscription-Token': key, Accept: 'application/json' })
    },
  },
]

export const ALLOWED_ENV_KEYS = new Set([...PROVIDER_APIS.map(p => p.envKey), ...TOOL_KEYS.map(t => t.envKey)])

// ── Limites reais de cada modelo (janela e saída máxima, da lista do provedor + models.dev) ──
const MODEL_LIMITS = new Map<string, { context?: number; maxTokens?: number }>()
/** Janela de contexto e saída máxima conhecidas de um modelo ("provedor|modelo"), quando a lista já foi lida. */
export function modelLimits(id: string) { return MODEL_LIMITS.get(id) }
export function rememberModelLimits(id: string, l: { context?: number; maxTokens?: number }) { MODEL_LIMITS.set(id, l) }

// ── Live model cache ─────────────────────────────────────────────────────────

const cache = new Map<string, { key: string; at: number; models: AIModel[] }>()
const failures = new Map<string, { key: string; at: number; error: unknown }>()
const refreshing = new Map<string, { key: string; job: Promise<AIModel[]> }>()
const TTL = 10 * 60 * 1000
const RETRY_AFTER_FAILURE = 60 * 1000

function recentlyFailed(id: string, key: string) {
  const f = failures.get(id)
  return f && f.key === key && Date.now() - f.at < RETRY_AFTER_FAILURE ? f : null
}

function refreshModels(p: ProviderApi, key: string): Promise<AIModel[]> {
  const running = refreshing.get(p.id)
  if (running && running.key === key) return running.job
  const job: Promise<AIModel[]> = p.listModels(key)
    .then(models => {
      // models.dev (MIT) enriquece contexto, saída máxima, ferramentas, raciocínio e anexos
      const enriched = enrichModels(p.id, models)
      for (const m of enriched) MODEL_LIMITS.set(m.id, { context: m.contextWindow, maxTokens: m.maxTokens })
      cache.set(p.id, { key, at: Date.now(), models: enriched }); failures.delete(p.id); return enriched
    })
    .catch(error => { failures.set(p.id, { key, at: Date.now(), error }); throw error })
    .finally(() => { if (refreshing.get(p.id)?.job === job) refreshing.delete(p.id) })
  refreshing.set(p.id, { key, job })
  return job
}

/**
 * Live model list of a provider. An expired list is returned at once and refreshed in the
 * background, so a chat message never waits on a listing; a failing provider is retried at
 * most once a minute instead of on every message.
 */
export async function getProviderModels(p: ProviderApi, opts: { fresh?: boolean } = {}): Promise<AIModel[]> {
  const key = process.env[p.envKey] || (p.mayBeKeyless ? 'custom' : undefined)
  if (!key) return []
  if (opts.fresh) return refreshModels(p, key)
  const hit = cache.get(p.id)
  if (hit && hit.key === key) {
    if (Date.now() - hit.at >= TTL && !recentlyFailed(p.id, key)) refreshModels(p, key).catch(() => {})
    return hit.models
  }
  const failed = recentlyFailed(p.id, key)
  if (failed) throw failed.error
  return refreshModels(p, key)
}

export function clearModelCache(providerId: string) {
  cache.delete(providerId)
  failures.delete(providerId)
}

// ── Default model choice ─────────────────────────────────────────────────────

const PREFERRED: Record<string, RegExp[]> = {
  // Measured 2026-11-14: numbered flash-lite answered in ~0.6s while the newest -flash previews returned 503
  gemini: [/^gemini-[\d.]+-flash-lite$/, /^gemini-flash-lite-latest$/, /^gemini-flash-latest$/, /flash/],
  groq: [/gpt-oss-120b/, /qwen3/, /gpt-oss-20b/, /llama/],
  openrouter: [/deepseek.*:free/, /llama-3\.3-70b.*:free/, /:free$/],
  mistral: [/mistral-large-latest/, /mistral-medium/, /mistral-small-latest/],
  sambanova: [/Llama-3\.3-70B/i, /DeepSeek-V3/i, /Llama/i],
  nvidia: [/llama-3\.3-70b-instruct/, /llama-3\.1-70b-instruct/, /instruct/],
  anthropic: [/claude-haiku/, /claude-sonnet/, /claude/],
}

function versionOf(id: string) {
  const m = id.match(/(\d+(?:\.\d+)?)/)
  return m ? parseFloat(m[1]) : 0
}

export function pickDefault(providerId: string, models: AIModel[]): AIModel | undefined {
  const raw = (m: AIModel) => m.id.slice(m.id.indexOf(SEP) + 1)
  for (const re of PREFERRED[providerId] || []) {
    const hits = models.filter(m => m.free !== false && re.test(raw(m)))
    if (hits.length) return hits.sort((a, b) => versionOf(raw(b)) - versionOf(raw(a)))[0]
  }
  return models.find(m => m.free !== false) || models[0]
}

export function splitModelId(id: string): { provider: string; model: string } {
  const i = id.indexOf(SEP)
  if (i > 0) return { provider: id.slice(0, i), model: id.slice(i + 1) }
  // Ids saved before provider prefixes existed
  if (id.startsWith('gemini')) return { provider: 'gemini', model: id }
  return { provider: 'ollama', model: id }
}
