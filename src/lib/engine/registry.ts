import fs from 'fs'
import path from 'path'
import { dataDir, readJson, writeJsonAtomic } from '../agents/fsutil'
import type { Approval, EngineSettings, Extension, HistoryAction, HistoryEntry, Opportunity } from './types'

export const engineDir = () => path.join(dataDir(), 'engine')
export const extensionsDir = () => path.join(engineDir(), 'extensions')
export const quarantineDir = () => path.join(engineDir(), 'quarantine')
const registryFile = () => path.join(engineDir(), 'registry.json')
const historyFile = () => path.join(engineDir(), 'history.jsonl')
const approvalsFile = () => path.join(engineDir(), 'approvals.json')
const settingsFile = () => path.join(engineDir(), 'settings.json')
const opportunitiesFile = () => path.join(engineDir(), 'opportunities.json')

// ─── Secret redaction (logs, prompts and tool outputs never carry credentials) ─

export { redact } from '../redact'
import { redact } from '../redact'

// ─── Registry ────────────────────────────────────────────────────────────────

export function listExtensions(): Extension[] {
  return readJson<Extension[]>(registryFile(), [])
}

export function getExtension(id: string): Extension | undefined {
  return listExtensions().find(e => e.id === id)
}

export function saveExtension(ext: Extension) {
  const all = listExtensions()
  const i = all.findIndex(e => e.id === ext.id)
  ext.updatedAt = Date.now()
  if (i >= 0) all[i] = ext
  else all.push(ext)
  writeJsonAtomic(registryFile(), all)
  return ext
}

export function deleteExtension(id: string) {
  writeJsonAtomic(registryFile(), listExtensions().filter(e => e.id !== id))
}

// ─── History (append-only, redacted) ─────────────────────────────────────────

export function logHistory(action: HistoryAction, ok: boolean, message: string, ext?: { id: string; name: string }) {
  const entry: HistoryEntry = { at: Date.now(), action, ok, message: redact(message).slice(0, 2000), extensionId: ext?.id, name: ext?.name }
  fs.mkdirSync(engineDir(), { recursive: true })
  fs.appendFileSync(historyFile(), JSON.stringify(entry) + '\n', 'utf-8')
  return entry
}

export function readHistory(limit = 300, extensionId?: string): HistoryEntry[] {
  if (!fs.existsSync(historyFile())) return []
  return fs.readFileSync(historyFile(), 'utf-8').split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l) as HistoryEntry } catch { return null } })
    .filter((e): e is HistoryEntry => !!e && (!extensionId || e.extensionId === extensionId))
    .slice(-limit)
    .reverse()
}

// ─── Approvals ───────────────────────────────────────────────────────────────

export function listApprovals(): Approval[] {
  return readJson<Approval[]>(approvalsFile(), [])
}

export function saveApproval(a: Approval) {
  const all = listApprovals()
  const i = all.findIndex(x => x.id === a.id)
  if (i >= 0) all[i] = a
  else all.push(a)
  writeJsonAtomic(approvalsFile(), all.slice(-200))
  return a
}

// ─── Settings ────────────────────────────────────────────────────────────────

export function getSettings(): EngineSettings {
  const saved = readJson<Partial<EngineSettings>>(settingsFile(), {})
  return {
    autonomy: saved.autonomy === 'manual' || saved.autonomy === 'autonomous' ? saved.autonomy : 'assisted',
    autoUpdate: saved.autoUpdate === true,
    autoCreate: saved.autoCreate !== false,
    autoOptimize: saved.autoOptimize !== false,
    lastUpdateCheck: saved.lastUpdateCheck,
    lastSelfCheck: saved.lastSelfCheck,
    lastOptimizeCheck: saved.lastOptimizeCheck,
  }
}

export function saveSettings(patch: Partial<EngineSettings>) {
  const next = { ...getSettings(), ...patch }
  writeJsonAtomic(settingsFile(), next)
  return next
}

// ─── Opportunities (needs JARVIS noticed while working) ──────────────────────

export function listOpportunities(): Opportunity[] {
  return readJson<Opportunity[]>(opportunitiesFile(), [])
}

export function saveOpportunity(o: Opportunity) {
  const all = listOpportunities()
  const i = all.findIndex(x => x.id === o.id)
  if (i >= 0) all[i] = o
  else all.push(o)
  writeJsonAtomic(opportunitiesFile(), all.slice(-100))
  return o
}
