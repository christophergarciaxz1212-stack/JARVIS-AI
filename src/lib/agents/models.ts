import { completeOnce, type ModelErrorKind, type NativeToolSpec } from '../ai/client'
import { getLiveCatalog, latencyOf } from '../ai/catalog'
import { budgetScore, budgetTier, maxInputTokensFor, rateLimitFloorMs } from '../ai/freeTier'
import { lacksCapability, readModelTests } from '../ai/modelTests'
import { getRole } from './roles'
import type { AIModel, Provider as LiveProvider } from '@/types'
import type { ModelHint, Usage } from './types'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface Completion {
  text: string
  usage: Usage
  model: string
  latencyMs: number
}

export type CompleteFn = (model: string, messages: ChatMessage[], signal?: AbortSignal, opts?: { json?: boolean; tools?: NativeToolSpec[] }) => Promise<Completion>

/** Real model call through the same provider client the chat uses (one-shot, real usage). */
export const defaultComplete: CompleteFn = async (model, messages, signal, opts) => {
  const started = Date.now()
  const { text, usage } = await completeOnce(model, messages, signal, opts)
  if (signal?.aborted) throw Object.assign(new Error('Cancelado'), { name: 'AbortError' })
  return { text, usage, model, latencyMs: Date.now() - started }
}

// ─── Health tracking (shared by every run in the process) ────────────────────

export interface ModelHealthEntry {
  model: string
  failures: number
  cooldownUntil: number
  unavailable: boolean
  lastKind?: ModelErrorKind
  lastError?: string
  /** Média móvel da latência real observada nas chamadas dos agentes. */
  latencyMs?: number
  updatedAt: number
}

/**
 * A 429 that says the ACCOUNT's daily pool is gone (OpenRouter "free-models-per-day", OpenCode "Free usage
 * limit reached", Antigravity "Individual quota reached") applies to every model of that provider:
 * trying the next one just fails the same way, seconds later.
 */
export function isProviderWideQuota(message: string) {
  return /per-day|per day|daily|free usage limit reached|individual quota reached/i.test(message)
}

export class ModelHealth {
  private map = new Map<string, ModelHealthEntry>()
  private providerCooldown = new Map<string, number>()

  private providerOf(model: string) { return model.slice(0, Math.max(0, model.indexOf('|'))) }

  private entry(model: string) {
    let e = this.map.get(model)
    if (!e) { e = { model, failures: 0, cooldownUntil: 0, unavailable: false, updatedAt: Date.now() }; this.map.set(model, e) }
    return e
  }

  reportFailure(model: string, kind: ModelErrorKind, message: string, retryAfterMs?: number) {
    const e = this.entry(model)
    e.failures++
    e.lastKind = kind
    e.lastError = message.slice(0, 300)
    e.updatedAt = Date.now()
    if (kind === 'rate_limit') {
      // "Try again in 6s" mede uma sub-janela, não o minuto inteiro: o piso por faixa de
      // orçamento (60s no Groq free) impede que o mesmo modelo lento de cota seja
      // re-escolhido segundos depois e falhe de novo. Falhas consecutivas dobram o piso.
      const floor = rateLimitFloorMs(budgetTier(model))
      const bump = e.failures > 1 ? Math.min(3, e.failures - 1) : 1
      // Cota diária/semanal com prazo informado ("Resets in 139h"): espera o prazo real (até 24 h)
      // em vez de pagar uma chamada perdida a cada 5 min até a cota voltar
      e.cooldownUntil = retryAfterMs && retryAfterMs > 300_000
        ? Date.now() + Math.min(retryAfterMs, 86_400_000)
        : Date.now() + Math.min(Math.max(retryAfterMs ?? 30_000, floor) * bump, 300_000)
      if (isProviderWideQuota(message) && this.providerOf(model)) {
        // The provider's own deadline when it gives one; otherwise retry the provider in an hour
        const until = Date.now() + (retryAfterMs && retryAfterMs > 60_000 ? Math.min(retryAfterMs, 86_400_000) : 3_600_000)
        this.providerCooldown.set(this.providerOf(model), until)
        e.cooldownUntil = Math.max(e.cooldownUntil, until)
      }
    }
    else if (kind === 'overloaded' || kind === 'network') e.cooldownUntil = Date.now() + Math.min(retryAfterMs ?? 20_000, 120_000)
    else if (kind === 'unavailable' || kind === 'auth') e.unavailable = true
  }

  reportSuccess(model: string) {
    const e = this.entry(model)
    this.providerCooldown.delete(this.providerOf(model))
    e.failures = 0
    e.cooldownUntil = 0
    e.unavailable = false
    e.updatedAt = Date.now()
  }

  reportLatency(model: string, ms: number) {
    if (!Number.isFinite(ms) || ms <= 0) return
    const e = this.entry(model)
    e.latencyMs = e.latencyMs ? Math.round(e.latencyMs * 0.7 + ms * 0.3) : Math.round(ms)
    e.updatedAt = Date.now()
  }

  latency(model: string) {
    return this.map.get(model)?.latencyMs
  }

  state(model: string): 'ok' | 'cooling' | 'unavailable' {
    const e = this.map.get(model)
    if (e?.unavailable) return 'unavailable'
    if ((this.providerCooldown.get(this.providerOf(model)) || 0) > Date.now()) return 'cooling'
    if (!e) return 'ok'
    return e.cooldownUntil > Date.now() ? 'cooling' : 'ok'
  }

  /** The whole provider ran out of its daily/account quota (see isProviderWideQuota). */
  providerCooling(model: string) {
    return (this.providerCooldown.get(this.providerOf(model)) || 0) > Date.now()
  }

  cooldownLeft(model: string) {
    return Math.max(0, (this.map.get(model)?.cooldownUntil || 0) - Date.now(), (this.providerCooldown.get(this.providerOf(model)) || 0) - Date.now())
  }

  snapshot(): ModelHealthEntry[] {
    return [...this.map.values()]
  }
}

const g = globalThis as unknown as { __jarvisModelHealth?: ModelHealth }
// Survives module reloads, but an instance built from an older class (dev hot reload) lacks the new
// methods and would crash the chat: then it is replaced.
export const modelHealth = g.__jarvisModelHealth instanceof ModelHealth ? g.__jarvisModelHealth : (g.__jarvisModelHealth = new ModelHealth())

// ─── Automatic model choice ──────────────────────────────────────────────────

const PAID = new Set(['openai', 'deepseek', 'xai'])
// Faster providers first; their free tiers also answer in well under a second.
// Groq is ping-fast but its free tier allows only ~7–8k tokens/min per model — useless
// for agent-sized prompts (5–8k tokens) — so it ranks below Gemini/OpenRouter here and
// loses even more through the free-tier budget score below.
const PROVIDER_SCORE: Record<string, number> = { groq: 8, sambanova: 22, gemini: 20, mistral: 15, openrouter: 12, nvidia: 10, lmstudio: 8, ollama: 9, antigravity: 22, opencode: 14 }

const HINT_PATTERNS: Record<ModelHint, RegExp[]> = {
  strong: [/claude-(sonnet|opus)-4/i, /gpt-oss-120b/, /deepseek-v4|glm-5|big-pickle|nemotron-3\.5-super/i, /qwen3[.\d-]*(2|3)\d\db/i, /gemini-[\d.]+-pro(?!.*preview)/, /llama-3\.3-70b|llama-4/i, /deepseek-(v3|r1)/i, /qwen/i, /gemini-[\d.]+-flash$/, /qwen2\.5-coder:7b|deepseek-r1:8b|gemma3:4b/i],
  code: [/claude-(sonnet|opus)-4/i, /coder|codestral|devstral/i, /qwen2\.5-coder/i, /gpt-oss-120b/, /deepseek-v4|glm-5|flint-40b|longcat/i, /qwen3/i, /llama-3\.3-70b/i, /gemini-[\d.]+-flash(-lite)?$/],
  fast: [/gpt-oss-20b/, /flash-lite/, /llama3\.2:3b|phi4-mini|gemma3:4b|llama3\.2:1b|qwen3:4b/i, /instant|8b/i, /qwen3/i, /gemini-[\d.]+-flash$/, /flash|lightning|hy4|inkling/i],
}

export function candidateModels(providers: LiveProvider[]): AIModel[] {
  // Agents speak a JSON protocol: a model a full test proved unable to return JSON never gets a role
  const tests = readModelTests()
  return providers
    .filter(p => p.status === 'connected')
    .flatMap(p => p.models)
    .filter(m => m.free !== false && !PAID.has(m.provider))
    .filter(m => modelHealth.state(m.id) !== 'unavailable')
    .filter(m => !lacksCapability(m.id, 'json', tests))
}

function score(m: AIModel, hint: ModelHint) {
  const raw = m.id.slice(m.id.indexOf('|') + 1)
  let s = PROVIDER_SCORE[m.provider] ?? 5
  s += budgetScore(budgetTier(m.id))
  const patterns = HINT_PATTERNS[hint]
  const i = patterns.findIndex(p => p.test(raw))
  if (i >= 0) s += 40 - i * 5
  if (/preview|exp|beta|latest/i.test(raw)) s -= 6
  if (modelHealth.state(m.id) === 'cooling') s -= 30

  const local = m.provider === 'ollama' || m.provider === 'lmstudio'
  if (local) {
    const billions = Number((raw.match(/(\d+(?:\.\d+)?)\s*b\b/i) || [])[1] || 0)
    if (billions && billions <= 4) s += 6
    if (hint === 'fast' && billions > 6) s -= 22
    if (billions > 12) s -= 20
  }
  const measured = modelHealth.latency(m.id) ?? latencyOf(m.id)
  if (measured) s += Math.max(-20, 14 - measured / 1000)
  return s
}

/**
 * Pool without models that hit a rate limit recently. If everything cooled down it
 * returns the whole pool and the caller decides the wait — a model in cooldown is
 * never re-picked just because it scores well, which used to ping-pong between two
 * limited models.
 */
function healthyPool(providers: LiveProvider[]) {
  const pool = candidateModels(providers)
  const warm = pool.filter(m => modelHealth.state(m.id) !== 'cooling')
  return warm.length ? warm : pool
}

/**
 * Picks a model per agent. Reusing a model shares its rate limit, and reusing a provider
 * shares its quota too — both cost score, so a normal team actually uses several free AIs.
 */
export function assignAutoModels(
  agents: Array<{ id: string; roleId: string; model: string }>,
  providers: LiveProvider[],
): Map<string, string> {
  // Sem pool gratuita, o agente fica sem modelo e reporta o bloqueio; nunca cai para um provedor pago
  const pool = healthyPool(providers)
  const used = new Map<string, number>()
  const providerUse = new Map<string, number>()
  const out = new Map<string, string>()
  const claim = (id: string, provider: string) => {
    used.set(id, (used.get(id) || 0) + 1)
    providerUse.set(provider, (providerUse.get(provider) || 0) + 1)
  }
  for (const a of agents) {
    if (a.model && a.model !== 'auto') {
      out.set(a.id, a.model)
      claim(a.model, a.model.split('|')[0])
      continue
    }
    const hint = getRole(a.roleId).modelHint
    let best: AIModel | undefined
    let bestScore = -Infinity
    for (const m of pool) {
      const s = score(m, hint) - (used.get(m.id) || 0) * 18 - (providerUse.get(m.provider) || 0) * 30
      if (s > bestScore) { best = m; bestScore = s }
    }
    if (best) { out.set(a.id, best.id); claim(best.id, best.provider) }
  }
  return out
}

/**
 * Ordered replacements for a failed model: same hint, healthy first, never the failed one.
 * When `estInputTokens` is given, models whose free tier cannot fit the request rank last —
 * an oversized prompt must go to a roomier provider instead of burning another 429.
 */
export function replacementsFor(failed: string, roleId: string, providers: LiveProvider[], exclude: Set<string>, estInputTokens?: number): string[] {
  const hint = getRole(roleId).modelHint
  const maxFor = (m: AIModel) => maxInputTokensFor(budgetTier(m.id))
  const ranked = healthyPool(providers)
    .filter(m => m.id !== failed && !exclude.has(m.id))
    .map(m => ({ id: m.id, fits: maxFor(m) >= (estInputTokens ?? 0), s: score(m, hint) }))
    .sort((a, b) => b.s - a.s)
  const fitting = ranked.filter(r => r.fits)
  return (fitting.length ? fitting : ranked).slice(0, 5).map(x => x.id)
}

export async function liveProviders() {
  return getLiveCatalog()
}
