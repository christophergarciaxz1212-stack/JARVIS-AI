import path from 'path'
import { dataDir, readJson, writeJsonAtomic } from '../agents/fsutil'

/**
 * Results of real model calls (the model test button, and failures seen while chatting), kept on disk.
 * A model that fails for a permanent reason — retired, no free quota, blocked for this kind of app —
 * leaves the catalog for a few days and is then offered again, so it is re-tested instead of lost.
 */
export type FailureKind = 'retired' | 'no-free-quota' | 'blocked' | 'temporary'

/** What each part of JARVIS needs from a model: chat streams, agents/director/Hub/netlab need JSON. */
export type ModelCapability = 'stream' | 'json'

export interface ModelTest {
  ok: boolean
  at: number
  ms?: number
  kind?: FailureKind
  error?: string
  /** Full test only: which capabilities really worked (false = proven broken), and why not */
  caps?: Partial<Record<ModelCapability, boolean>>
  capErrors?: Partial<Record<ModelCapability, string>>
}

const HIDE_FOR = 3 * 24 * 3_600_000
const file = () => path.join(dataDir(), 'model-tests.json')

export function classifyFailure(error: string): FailureKind {
  const e = error.toLowerCase()
  if (/no longer available|end of life|decommission|deprecated|not found|does not exist|model_not_found|unknown model|\b404\b|\b410\b/.test(e)) return 'retired'
  // Gemini: models without a free tier answer 429 with "limit: 0"; a used-up daily quota has a real limit
  if (/limit:\s*0\b/.test(e)) return 'no-free-quota'
  // Antigravity: "Individual quota reached. Resets in …" — a conta não tem cota para aquele modelo agora
  if (/individual quota reached|quota reached|quota exceeded/.test(e)) return 'no-free-quota'
  // The model test asks for a sum: echoing/translating the question means it is not a chat model
  if (/não segue instruções/.test(e)) return 'blocked'
  // SambaNova & co.: 402 "A payment method is required" — the free tier is closed for this account
  if (/\b402\b|payment method is required|payment required|add (a )?payment method/.test(e)) return 'no-free-quota'
  if (/only available on agentic harnesses|not available in your (region|country)|\b403\b/.test(e) && !/rate.?limit/.test(e)) return 'blocked'
  return 'temporary'
}

export function readModelTests(): Record<string, ModelTest> {
  return readJson<Record<string, ModelTest>>(file(), {})
}

export function recordModelTest(modelId: string, result: { ok: boolean; ms?: number; error?: string; caps?: ModelTest['caps']; capErrors?: ModelTest['capErrors'] }) {
  const all = readModelTests()
  const entry: ModelTest = { ok: result.ok, at: Date.now() }
  if (result.ok && result.ms) entry.ms = Math.round(result.ms)
  // A plain test keeps what the last full test learned about the capabilities
  const caps = result.caps ?? (result.ok ? all[modelId]?.caps : undefined)
  if (caps) entry.caps = caps
  const capErrors = result.caps ? result.capErrors : (result.ok ? all[modelId]?.capErrors : undefined)
  if (capErrors && Object.keys(capErrors).length) entry.capErrors = capErrors
  if (!result.ok && result.error) {
    entry.kind = classifyFailure(result.error)
    entry.error = result.error.slice(0, 300)
  }
  // A transient error must not erase what is known about a model that worked
  if (!result.ok && entry.kind === 'temporary' && all[modelId]?.ok) return all[modelId]
  all[modelId] = entry
  writeJsonAtomic(file(), all)
  return entry
}

/** True while a recent test proved the model unusable on a free key. */
export function isHiddenModel(modelId: string, tests = readModelTests()) {
  const t = tests[modelId]
  return !!t && !t.ok && t.kind !== 'temporary' && Date.now() - t.at < HIDE_FOR
}

/**
 * True only when a recent full test PROVED the model can't do this (never for untested models):
 * the chat skips models that can't stream, agents/director/Hub skip models that can't return JSON.
 */
export function lacksCapability(modelId: string, cap: ModelCapability, tests = readModelTests()) {
  const t = tests[modelId]
  return !!t && t.caps?.[cap] === false && Date.now() - t.at < HIDE_FOR
}

/** Latency measured on this machine, when a test succeeded. */
export function measuredMs(modelId: string, tests = readModelTests()) {
  const t = tests[modelId]
  return t?.ok ? t.ms : undefined
}
