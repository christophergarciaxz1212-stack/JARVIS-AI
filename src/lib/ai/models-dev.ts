/**
 * Integração com o models.dev — banco de dados aberto de modelos de IA
 * (https://github.com/anomalyco/models.dev · MIT · "An open-source database of AI models").
 *
 * O catálogo v1 (https://models.dev/api.json) traz, por provedor, o contexto real, a saída
 * máxima, suporte a ferramentas/raciocínio/anexos, pesos abertos e a data de lançamento de
 * cada modelo. Aqui ele é usado para enriquecer o catálogo vivo do JARVIS: o que a API ao
 * vivo do provedor não informa (ou informa de forma imprecisa) passa a sair do models.dev.
 *
 * Regras:
 * - O chat nunca espera pelo models.dev. Uma leitura síncrona do cache em disco é usada;
 *   a atualização roda em segundo plano (boot + no máximo 1x/dia).
 * - Falha na rede não derruba nada: vale o cache em disco; sem cache, os modelos seguem
 *   com as estimativas de sempre.
 * - Nada aqui bloqueia nem lança na thread do chat.
 */
import path from 'path'
import fs from 'fs'
import type { AIModel } from '@/types'
import { dataDir, readJson, writeJsonAtomic } from '../agents/fsutil'

const API_URL = process.env.MODELS_DEV_API_URL || 'https://models.dev/api.json'
const MAX_BYTES = 40 * 1024 * 1024
const TTL = 24 * 3_600_000
const FETCH_TIMEOUT_MS = 30_000

/** Nossos ids de provedor → chave do provedor no models.dev */
const PROVIDER_MAP: Record<string, string> = {
  gemini: 'google',
  groq: 'groq',
  openrouter: 'openrouter',
  mistral: 'mistral',
  sambanova: 'sambanova',
  nvidia: 'nvidia',
}

export interface ModelsDevModel {
  name?: string
  family?: string
  description?: string
  attachment?: boolean
  reasoning?: boolean
  tool_call?: boolean
  structured_output?: boolean
  open_weights?: boolean
  release_date?: string
  knowledge?: string
  status?: string
  limit?: { context?: number; input?: number; output?: number }
  cost?: { input?: number; output?: number }
  modalities?: { input?: string[]; output?: string[] }
}
export type ModelsDevCatalog = Record<string, { models?: Record<string, ModelsDevModel> }>

const gl = globalThis as unknown as { __jarvisModelsDev?: ModelsDevCatalog | null }

function cacheFile() {
  return path.join(dataDir(), 'models-dev.json')
}

/** Lê o cache em disco uma vez por processo (o arquivo tem alguns MB). */
export function modelsDevCatalog(): ModelsDevCatalog | null {
  if (gl.__jarvisModelsDev !== undefined) return gl.__jarvisModelsDev ?? null
  try {
    const raw = readJson<ModelsDevCatalog>(cacheFile(), {})
    gl.__jarvisModelsDev = raw && typeof raw === 'object' && Object.keys(raw).length > 0 ? raw : null
  } catch {
    // Cache corrompido: o readJson já quarentenou o arquivo; seguimos sem enrichment
    gl.__jarvisModelsDev = null
  }
  return gl.__jarvisModelsDev
}

let refreshing: Promise<boolean> | null = null

/** Baixa o catálogo se o cache tiver mais de 24h (ou estiver faltando). Nunca lança. */
export async function refreshModelsDev(force = false): Promise<boolean> {
  try {
    if (!force) {
      try {
        if (Date.now() - fs.statSync(cacheFile()).mtimeMs < TTL) return true
      } catch {}
    }
    if (refreshing) return refreshing
    refreshing = (async () => {
      try {
        const res = await fetch(API_URL, {
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          headers: { 'User-Agent': 'jarvis-ai (models.dev client)' },
        })
        if (!res.ok) throw new Error(`models.dev respondeu HTTP ${res.status}`)
        const declared = Number(res.headers.get('content-length') || 0)
        if (declared > MAX_BYTES) throw new Error('catálogo do models.dev grande demais')
        const text = await res.text()
        if (text.length > MAX_BYTES) throw new Error('catálogo do models.dev grande demais')
        const parsed = JSON.parse(text) as ModelsDevCatalog
        if (!parsed || typeof parsed !== 'object' || Object.keys(parsed).length === 0) {
          throw new Error('models.dev retornou um catálogo vazio')
        }
        writeJsonAtomic(cacheFile(), parsed)
        gl.__jarvisModelsDev = parsed
        return true
      } catch (error) {
        console.warn('[models.dev] atualização falhou; usando cache local:', (error as Error).message)
        if (gl.__jarvisModelsDev === undefined) modelsDevCatalog()
        return false
      } finally {
        refreshing = null
      }
    })()
    return refreshing
  } catch (error) {
    console.warn('[models.dev] falha inesperada:', (error as Error).message)
    return false
  }
}

let bgRefreshStartedAt = 0
/** Dispara a atualização em segundo plano, no máximo uma vez por TTL por processo. */
export function maybeRefreshModelsDevInBackground() {
  const now = Date.now()
  if (now - bgRefreshStartedAt < TTL) return
  bgRefreshStartedAt = now
  refreshModelsDev(false).catch(() => {})
}

/** Busca o modelo no catálogo. Função pura (recebe o catálogo) para ser testável. */
export function findRawInCatalog(
  catalog: ModelsDevCatalog | null | undefined,
  providerKey: string,
  rawId: string,
): ModelsDevModel | null {
  const bucket = catalog?.[providerKey]?.models
  if (!bucket || typeof bucket !== 'object') return null
  const direct = bucket[rawId]
  if (direct) return direct
  // OpenRouter: "x/y:free" pode existir no models.dev só como "x/y"
  const withoutSuffix = rawId.replace(/:free$/, '')
  if (withoutSuffix !== rawId && bucket[withoutSuffix]) return bucket[withoutSuffix]
  // The catalog itself may list only the ":free" route (OpenRouter)
  if (bucket[`${rawId}:free`]) return bucket[`${rawId}:free`]
  const lower = rawId.toLowerCase()
  for (const key of Object.keys(bucket)) {
    if (key.toLowerCase() === lower) return bucket[key]
  }
  return null
}

export interface ModelsDevEnrichment {
  contextWindow?: number
  maxTokens?: number
  reasoning?: boolean
  toolSupport?: boolean
  multimodal?: boolean
  openWeights?: boolean
  description?: string
  releaseDate?: string
}

/** Fatos do models.dev para (providerId, rawId) — função pura, testável. */
export function enrichmentFromRaw(raw: ModelsDevModel | null | undefined): ModelsDevEnrichment | null {
  if (!raw) return null
  const enr: ModelsDevEnrichment = {}
  const ctx = raw.limit?.context
  const out = raw.limit?.output
  if (typeof ctx === 'number' && ctx > 0) enr.contextWindow = ctx
  if (typeof out === 'number' && out > 0) enr.maxTokens = out
  if (typeof raw.reasoning === 'boolean') enr.reasoning = raw.reasoning
  if (typeof raw.tool_call === 'boolean') enr.toolSupport = raw.tool_call
  if (typeof raw.attachment === 'boolean') enr.multimodal = raw.attachment
  if (typeof raw.open_weights === 'boolean') enr.openWeights = raw.open_weights
  if (raw.description) enr.description = raw.description.slice(0, 180)
  else if (raw.release_date) enr.description = `Lançado em ${raw.release_date}`
  if (raw.release_date) enr.releaseDate = raw.release_date
  return Object.keys(enr).length ? enr : null
}

export interface ResolvedModelDev {
  raw: ModelsDevModel | null
  enrichment: ModelsDevEnrichment | null
}

/** Resolve o modelo no cache em disco + devolve os fatos. Nunca lança. */
export function lookupModelsDev(providerId: string, rawId: string): ResolvedModelDev {
  const key = PROVIDER_MAP[providerId]
  if (!key) return { raw: null, enrichment: null }
  try {
    const raw = findRawInCatalog(modelsDevCatalog(), key, rawId)
    return { raw, enrichment: enrichmentFromRaw(raw) }
  } catch {
    return { raw: null, enrichment: null }
  }
}

/**
 * Aplica os fatos do models.dev sobre os modelos de um provedor.
 * O que o models.dev sabe vence a heurística; o que ele não sabe fica como estava.
 */
export function enrichModels(providerId: string, models: AIModel[]): AIModel[] {
  if (!PROVIDER_MAP[providerId]) return models
  try {
    if (gl.__jarvisModelsDev === undefined) modelsDevCatalog()
    maybeRefreshModelsDevInBackground()
    const catalog = modelsDevCatalog()
    if (!catalog) return models
    return models.map(m => {
      const rawId = m.id.includes('|') ? m.id.slice(m.id.indexOf('|') + 1) : m.id
      const enr = enrichmentFromRaw(findRawInCatalog(catalog, PROVIDER_MAP[providerId], rawId))
      if (!enr) return m
      const next = { ...m }
      if (enr.contextWindow) next.contextWindow = enr.contextWindow
      if (enr.maxTokens) next.maxTokens = enr.maxTokens
      if (enr.toolSupport !== undefined) next.toolSupport = enr.toolSupport
      if (enr.multimodal !== undefined) next.multimodal = enr.multimodal
      // Modelo marcado como raciocinador pelo models.dev deixa de ser "chat" genérico
      if (enr.reasoning && next.category === 'chat') next.category = 'reasoning'
      if (enr.description && !next.description) next.description = enr.description
      return next
    })
  } catch {
    return models
  }
}
