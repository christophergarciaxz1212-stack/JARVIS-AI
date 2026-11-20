/**
 * Provedores cadastrados pelo usuário (Chaves de API › "Adicionar provedor"): qualquer API no
 * formato OpenAI (Groq-like, vLLM, LiteLLM, LocalAI, llama.cpp, Jan, Hugging Face, Cerebras, Z.ai…)
 * ou Anthropic Messages. Os modelos vêm da própria API (/models) ou são digitados à mão.
 *
 * A definição (nome, endereço, formato, modelos) fica em data/custom-providers.json; a CHAVE fica
 * no mesmo cofre das outras (data/keys.json, via saveKey) e nunca volta para a tela.
 */
import fs from 'fs'
import path from 'path'
import { dataDir, writeJsonAtomic } from '../agents/fsutil'
import { saveKey } from '../keys'
import type { AIModel } from '@/types'
import { ALLOWED_ENV_KEYS, NON_CHAT, PROVIDER_APIS, apiError, clearModelCache, model, type ProviderApi } from './providers'
import { normalizeBaseUrl } from './compat'

export type ApiStyle = 'openai' | 'anthropic'

export interface CustomProvider {
  id: string
  name: string
  baseUrl: string
  style: ApiStyle
  /** Modelos digitados à mão: usados quando a API não lista modelos (ou para fixar só alguns). */
  manualModels: string[]
  /** Esconde modelos que a própria API marca como pagos (preço > 0). Padrão: ligado. */
  freeOnly: boolean
  createdAt: number
}

export interface DiscoveredModel { id: string; name?: string; contextWindow?: number; paid?: boolean }

export interface ProviderPreset {
  id: string
  name: string
  baseUrl: string
  style: ApiStyle
  keyUrl?: string
  needsKey: boolean
  note: string
}

/** Atalhos de preenchimento. Só endpoints com plano gratuito ou que rodam no seu PC. */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  { id: 'cerebras', name: 'Cerebras', baseUrl: 'https://api.cerebras.ai/v1', style: 'openai', keyUrl: 'https://cloud.cerebras.ai/', needsKey: true, note: 'Plano gratuito com limite diário; muito rápido.' },
  { id: 'huggingface', name: 'Hugging Face', baseUrl: 'https://router.huggingface.co/v1', style: 'openai', keyUrl: 'https://huggingface.co/settings/tokens', needsKey: true, note: 'Token gratuito com créditos mensais; centenas de modelos abertos.' },
  { id: 'zai', name: 'Z.ai (GLM)', baseUrl: 'https://api.z.ai/api/paas/v4', style: 'openai', keyUrl: 'https://z.ai/manage-apikey/apikey-list', needsKey: true, note: 'Os modelos GLM "Flash" são gratuitos.' },
  { id: 'cohere', name: 'Cohere', baseUrl: 'https://api.cohere.ai/compatibility/v1', style: 'openai', keyUrl: 'https://dashboard.cohere.com/api-keys', needsKey: true, note: 'Chave "Trial" gratuita, com limite mensal.' },
  { id: 'cloudflare', name: 'Cloudflare Workers AI', baseUrl: 'https://api.cloudflare.com/client/v4/accounts/SEU_ACCOUNT_ID/ai/v1', style: 'openai', keyUrl: 'https://dash.cloudflare.com/profile/api-tokens', needsKey: true, note: 'Cota diária gratuita. Troque SEU_ACCOUNT_ID e digite os modelos (ex.: @cf/meta/llama-3.1-8b-instruct).' },
  { id: 'vllm', name: 'vLLM (local)', baseUrl: 'http://localhost:8000/v1', style: 'openai', needsKey: false, note: 'Servidor vLLM rodando no seu PC ou na rede.' },
  { id: 'litellm', name: 'LiteLLM (gateway)', baseUrl: 'http://localhost:4000', style: 'openai', needsKey: false, note: 'Proxy LiteLLM: junta vários provedores num endereço só.' },
  { id: 'llamacpp', name: 'llama.cpp / LocalAI', baseUrl: 'http://localhost:8080/v1', style: 'openai', needsKey: false, note: 'llama-server ou LocalAI rodando localmente.' },
  { id: 'jan', name: 'Jan', baseUrl: 'http://localhost:1337/v1', style: 'openai', needsKey: false, note: 'Servidor local do app Jan.' },
  { id: 'textgen', name: 'text-generation-webui', baseUrl: 'http://127.0.0.1:5000/v1', style: 'openai', needsKey: false, note: 'Oobabooga com a extensão de API ativada.' },
  { id: 'anthropic-compat', name: 'Compatível com Anthropic', baseUrl: 'https://', style: 'anthropic', needsKey: true, note: 'Qualquer API no formato /v1/messages (gateways e proxies compatíveis com Claude).' },
]

const FILE = () => path.join(dataDir(), 'custom-providers.json')

export function envKeyFor(id: string) {
  return `CUSTOMP_${id.replace(/[^a-z0-9]/gi, '_').toUpperCase()}_KEY`
}

export function readCustomProviders(): CustomProvider[] {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE(), 'utf-8')) as { providers?: CustomProvider[] }
    return Array.isArray(raw.providers) ? raw.providers.filter(p => p && p.id && p.baseUrl) : []
  } catch { return [] }
}

function writeCustomProviders(list: CustomProvider[]) {
  writeJsonAtomic(FILE(), { version: 1, providers: list })
  lastMtime = -1
  ensureCustomProviders()
}

// ── Descoberta de modelos ────────────────────────────────────────────────────

function authHeaders(style: ApiStyle, key: string): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/json' }
  if (!key) return h
  if (style === 'anthropic') { h['x-api-key'] = key; h['anthropic-version'] = '2023-06-01' }
  h.Authorization = `Bearer ${key}`
  return h
}

/** Lê as várias formas de "lista de modelos" que as APIs devolvem. */
export function parseModelList(data: unknown): DiscoveredModel[] {
  const d = data as Record<string, unknown>
  const list: unknown[] = Array.isArray(data) ? data
    : Array.isArray(d?.data) ? d.data as unknown[]
    : Array.isArray(d?.models) ? d.models as unknown[]
    : Array.isArray((d?.result as Record<string, unknown>)?.models) ? (d.result as { models: unknown[] }).models
    : Array.isArray(d?.result) ? d.result as unknown[]
    : []
  const out: DiscoveredModel[] = []
  for (const item of list) {
    if (typeof item === 'string') { out.push({ id: item }); continue }
    const m = item as Record<string, unknown>
    const id = String(m.id ?? m.model ?? m.name ?? '').replace(/^models\//, '')
    if (!id) continue
    const pricing = m.pricing as Record<string, unknown> | undefined
    const priced = pricing && (Number(pricing.prompt) > 0 || Number(pricing.completion) > 0 || Number(pricing.input) > 0 || Number(pricing.output) > 0)
    const ctx = Number(m.context_length ?? m.context_window ?? m.max_context_length ?? m.inputTokenLimit ?? m.max_model_len ?? 0)
    const name = typeof m.display_name === 'string' ? m.display_name : typeof m.displayName === 'string' ? m.displayName : undefined
    out.push({ id, name, contextWindow: ctx > 0 ? ctx : undefined, paid: !!priced })
  }
  // Sem repetidos, e sem modelos que não conversam (embeddings, imagem, áudio…)
  const seen = new Set<string>()
  return out.filter(m => !seen.has(m.id) && seen.add(m.id) && !NON_CHAT.test(m.id))
}

/**
 * Procura a lista de modelos em <base>/models e, se a base não tiver versão, em <base>/v1/models
 * e no /api/tags do Ollama. Devolve também a base que funcionou (corrige "…:8000" → "…:8000/v1").
 */
export async function discoverModels(baseUrl: string, style: ApiStyle, key: string): Promise<{ models: DiscoveredModel[]; baseUrl: string }> {
  const base = normalizeBaseUrl(baseUrl)
  const attempts: Array<{ url: string; base: string }> = [{ url: `${base}/models`, base }]
  if (!/\/v\d+[a-z]*$/i.test(base)) {
    attempts.push({ url: `${base}/v1/models`, base: `${base}/v1` })
    attempts.push({ url: `${base}/api/tags`, base: `${base}/v1` })
  }
  let lastError: Error | null = null
  for (const a of attempts) {
    try {
      const res = await fetch(a.url, { headers: authHeaders(style, key), signal: AbortSignal.timeout(15_000) })
      if (!res.ok) {
        lastError = await apiError(res)
        // Chave recusada: não adianta tentar outros caminhos
        if (res.status === 401 || res.status === 403) throw lastError
        continue
      }
      const models = parseModelList(await res.json().catch(() => null))
      if (models.length) return { models, baseUrl: a.base }
      lastError = new Error('A API respondeu, mas sem modelos de conversa na lista')
    } catch (e) {
      const err = e as Error
      if (/Chave inválida/.test(err.message)) throw err
      lastError = err.name === 'TimeoutError' ? new Error('A API não respondeu em 15 s') : /fetch failed|ECONNREFUSED/i.test(err.message) ? new Error(`Não consegui conectar em ${new URL(a.url).host} — o servidor está ligado?`) : err
    }
  }
  throw lastError || new Error('Lista de modelos indisponível')
}

// ── Registro no catálogo ─────────────────────────────────────────────────────

function toProviderApi(cp: CustomProvider): ProviderApi {
  const api: ProviderApi = {
    id: cp.id,
    name: cp.name,
    icon: cp.style === 'anthropic' ? '🅰️' : '🧩',
    envKey: envKeyFor(cp.id),
    keyUrl: '',
    help: `${cp.style === 'anthropic' ? 'Formato Anthropic' : 'Formato OpenAI'} · ${cp.baseUrl}`,
    free: true,
    mayBeKeyless: true,
    custom: true,
    style: cp.style,
    chatBaseUrl: cp.baseUrl,
    listModels: async (key) => {
      const realKey = key === 'custom' ? '' : key
      let found: DiscoveredModel[] = []
      if (cp.manualModels.length) found = cp.manualModels.map(id => ({ id }))
      else found = (await discoverModels(cp.baseUrl, cp.style, realKey)).models
      return found
        .filter(m => !(cp.freeOnly && m.paid))
        .map((m): AIModel => model(api, m.id, {
          name: m.name || m.id.split('/').pop()!,
          ...(m.contextWindow ? { contextWindow: m.contextWindow } : {}),
          free: !m.paid,
        }))
    },
  }
  return api
}

let lastMtime = -1

/** Mantém PROVIDER_APIS em dia com data/custom-providers.json (barato: só relê se o arquivo mudou). */
export function ensureCustomProviders() {
  let mtime = 0
  try { mtime = fs.statSync(FILE()).mtimeMs } catch { mtime = 0 }
  if (mtime === lastMtime) return
  lastMtime = mtime
  for (let i = PROVIDER_APIS.length - 1; i >= 0; i--) {
    if (PROVIDER_APIS[i].custom) { clearModelCache(PROVIDER_APIS[i].id); PROVIDER_APIS.splice(i, 1) }
  }
  for (const cp of readCustomProviders()) {
    const api = toProviderApi(cp)
    PROVIDER_APIS.push(api)
    ALLOWED_ENV_KEYS.add(api.envKey)
  }
}

// ── Cadastro ─────────────────────────────────────────────────────────────────

const RESERVED = new Set(['gemini', 'groq', 'openrouter', 'mistral', 'sambanova', 'nvidia', 'ollama', 'lmstudio', 'antigravity', 'opencode', 'custom', 'anthropic', 'openai', 'auto'])

function slug(name: string) {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'provedor'
}

export interface ProviderInput {
  id?: string
  name: string
  baseUrl: string
  style?: ApiStyle
  /** undefined = manter a chave atual; '' = remover. */
  apiKey?: string
  manualModels?: string[] | string
  freeOnly?: boolean
}

function cleanModels(v: ProviderInput['manualModels']) {
  const list = Array.isArray(v) ? v : String(v || '').split(/[\n,]+/)
  return [...new Set(list.map(s => s.trim()).filter(s => s && s.length <= 200 && !/\s/.test(s)))].slice(0, 200)
}

export function upsertCustomProvider(input: ProviderInput): CustomProvider {
  const name = String(input.name || '').trim().slice(0, 40)
  if (!name) throw new Error('Dê um nome ao provedor')
  const style: ApiStyle = input.style === 'anthropic' ? 'anthropic' : 'openai'
  const baseUrl = normalizeBaseUrl(String(input.baseUrl || ''))
  if (/SEU_ACCOUNT_ID/.test(baseUrl)) throw new Error('Troque SEU_ACCOUNT_ID pelo ID da sua conta Cloudflare')
  const list = readCustomProviders()
  const existing = input.id ? list.find(p => p.id === input.id) : undefined
  if (input.id && !existing) throw new Error('Provedor não encontrado')

  let id = existing?.id
  if (!id) {
    const base = `cp-${slug(name)}`
    id = base
    for (let n = 2; RESERVED.has(id) || list.some(p => p.id === id); n++) id = `${base}-${n}`
  }
  const cp: CustomProvider = {
    id,
    name,
    baseUrl,
    style,
    manualModels: cleanModels(input.manualModels),
    freeOnly: input.freeOnly !== false,
    createdAt: existing?.createdAt || Date.now(),
  }
  if (input.apiKey !== undefined) {
    const key = input.apiKey.trim()
    if (key && (key.length > 2000 || /\s/.test(key))) throw new Error('Cole a chave completa, sem espaços')
    ALLOWED_ENV_KEYS.add(envKeyFor(id))
    saveKey(envKeyFor(id), key)
  }
  writeCustomProviders(existing ? list.map(p => (p.id === id ? cp : p)) : [...list, cp])
  clearModelCache(id)
  return cp
}

export function removeCustomProvider(id: string) {
  const list = readCustomProviders()
  if (!list.some(p => p.id === id)) throw new Error('Provedor não encontrado')
  try { saveKey(envKeyFor(id), '') } catch { /* chave já ausente */ }
  writeCustomProviders(list.filter(p => p.id !== id))
  clearModelCache(id)
}

/** Visão segura para a tela: nunca inclui a chave, só se existe e os 4 últimos caracteres. */
export function publicView(cp: CustomProvider) {
  const key = process.env[envKeyFor(cp.id)]
  return { ...cp, hasKey: !!key, keyHint: key ? `••••${key.slice(-4)}` : '' }
}

ensureCustomProviders()
