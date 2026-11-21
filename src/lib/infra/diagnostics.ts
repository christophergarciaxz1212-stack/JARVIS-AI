// Health dashboard of every JARVIS subsystem: what the app looks like to itself.
// Read-only: never fixes, never deletes — offers fixes where available.

import { type ModelHealthEntry, modelHealth, liveProviders } from '../agents/models'
import { listActiveRunsOnDisk, listTeams } from '../agents/store'
import type { Run } from '../agents/types'
import { ACTIVE_RUN_STATUSES } from '../agents/types'
import { listTerminals } from '../terminal'
import { listBackups } from './backup'
import { log, readLogs, type LogEntry } from './log'
import { getSystemHealth, type InfraStatus } from './reliability'
import { runSelfCheck } from './selfcheck'
import { scanData } from './selfcheck'

export type DiagnosticsLevel = 'ok' | 'warn' | 'fail'

export interface ProviderDiag {
  provider: string
  status: DiagnosticsLevel
  error?: string
  models: number
  freeCount: number
}

export interface ModelDiag {
  model: string
  state: 'ok' | 'cooling' | 'unavailable'
  cooldownMs: number
  failures: number
  latencyMs?: number
  lastError?: string
}

export interface TeamDiag {
  teams: number
  agentsTotal: number
  sessionsTotal: number
  activeRuns: number
  runningAgents: number
  waitingAgents: number
  runningTasks: number
  failedTasks: number
}

export interface TerminalDiag {
  sessions: number
}

export interface PersistenceDiag {
  files: number
  corrupt: string[]
  quarantined: string[]
  staleTmp: string[]
}

export interface BackupDiag {
  count: number
  latestAt?: number
  lastSizeMb?: number
}

export interface LogDiag {
  errors: number
  warns: number
  entries: LogEntry[]
}

export interface ElectronDiag {
  platform: string
  arch: string
  electron?: string
}

export interface SelfCheckDiag {
  status: DiagnosticsLevel
  at: number
  durationMs: number
  checks: Array<{ id: string; label: string; status: DiagnosticsLevel; detail: string }>
}

export interface Diagnostics {
  at: number
  pid: number
  levels: Record<string, DiagnosticsLevel>
  providers: ProviderDiag[]
  models: ModelDiag[]
  teams: TeamDiag
  terminal: TerminalDiag
  persistence: PersistenceDiag
  backups: BackupDiag
  logs: LogDiag
  infra: { status: InfraStatus; issues: string[] }
  selfcheck: SelfCheckDiag
  electron: ElectronDiag
}

function levelOf(s: string): DiagnosticsLevel { return s === 'ok' || s === 'warn' || s === 'fail' ? s : 'warn' }

function modelDiags(entries: ModelHealthEntry[]): ModelDiag[] {
  return entries.map(e => ({
    model: e.model,
    state: (e.unavailable ? 'unavailable' : e.cooldownUntil > Date.now() ? 'cooling' : 'ok') as ModelDiag['state'],
    cooldownMs: Math.max(0, e.cooldownUntil - Date.now()),
    failures: e.failures,
    latencyMs: e.latencyMs,
    lastError: e.lastError?.slice(0, 160),
  })).sort((a, b) => (b.failures - a.failures) || (a.model.localeCompare(b.model)))
}

export async function gatherDiagnostics(): Promise<Diagnostics> {
  const at = Date.now()
  const scan = scanData()

  const providers: ProviderDiag[] = []
  let providerErr = 0
  try {
    for (const p of await liveProviders()) {
      const status: DiagnosticsLevel = p.status === 'connected' ? 'ok' : 'warn'
      if (status === 'warn') providerErr++
      providers.push({
        provider: p.id,
        status,
        error: p.status === 'connected' ? undefined : `Provedor ${p.status}`,
        models: (p.models || []).length,
        freeCount: (p.models || []).filter(m => m.free !== false).length,
      })
    }
  } catch (e) {
    providerErr++
    providers.push({ provider: 'global', status: 'warn', error: `Não foi possível listar provedores: ${(e as Error).message}`, models: 0, freeCount: 0 })
  }

  const runs = listActiveRunsOnDisk() as Run[]
  const teams = listTeams()
  const terminal = listTerminals()
  const backups = listBackups()
  const infra = getSystemHealth()
  const selfcheck = runSelfCheck({ watchdogRunning: false, openIncidents: 0, backupEveryHours: 0 })

  const logs: LogDiag = (() => {
    const entries = readLogs({ level: undefined, limit: 200 })
    return {
      entries,
      errors: entries.filter(e => e.level === 'error').length,
      warns: entries.filter(e => e.level === 'warn').length,
    }
  })()

  const levels: Diagnostics['levels'] = {}
  for (const p of providers) if (levels[`provider:${p.provider}`] === undefined) levels[`provider:${p.provider}`] = p.status
  for (const m of modelDiags(modelHealth.snapshot())) if (levels[`model:${m.model}`] === undefined) levels[`model:${m.model}`] = m.state === 'unavailable' ? 'fail' : m.state === 'cooling' ? 'warn' : 'ok'
  if (providers.length === 0) levels['providers'] = providerErr ? 'fail' : 'ok'
  levels.teams = runs.length ? 'warn' : 'ok'
  levels.terminal = terminal.length ? 'ok' : 'ok'
  levels.persistence = scan.corrupt.length ? 'fail' : scan.quarantined.length || scan.staleTmp.length ? 'warn' : 'ok'
  levels.backups = selfcheck.status
  levels.logs = logs.entries.some(e => e.level === 'error') ? 'warn' : 'ok'
  levels.infra = infra.status === 'critical' ? 'fail' : infra.status === 'warning' ? 'warn' : 'ok'
  levels.selfcheck = selfcheck.status

  const diagnostics: Diagnostics = {
    at, pid: process.pid, levels, providers,
    models: modelDiags(modelHealth.snapshot()),
    teams: {
      teams: teams.length,
      agentsTotal: teams.reduce((n, t) => n + t.agents.length, 0),
      sessionsTotal: 0,
      activeRuns: runs.length,
      runningAgents: runs.filter(run => ACTIVE_RUN_STATUSES.includes(run.status)).flatMap(run => run.agents).filter(a => a.status === 'executing' || a.status === 'planning' || a.status === 'communicating').length,
      waitingAgents: runs.flatMap(r => r.agents).filter(a => !a.removed && !['executing', 'planning', 'communicating', 'done', 'failed'].includes(a.status)).length,
      runningTasks: runs.flatMap(r => r.tasks).filter(t => t.status === 'running').length,
      failedTasks: runs.flatMap(r => r.tasks).filter(t => t.status === 'failed' || t.status === 'blocked').length,
    },
    terminal: { sessions: terminal.length },
    persistence: { files: scan.files, corrupt: scan.corrupt, quarantined: scan.quarantined.map(q => q.rel), staleTmp: scan.staleTmp },
    backups: { count: backups.length, latestAt: backups[0]?.createdAt, lastSizeMb: backups[0] ? backups[0].size / 1048576 : undefined },
    logs,
    infra: { status: infra.status, issues: infra.issues },
    selfcheck: { status: selfcheck.status, at: selfcheck.at, durationMs: selfcheck.durationMs, checks: selfcheck.checks.map(c => ({ id: c.id, label: c.label, status: c.status, detail: c.detail })) },
    electron: { platform: process.platform, arch: process.arch, electron: typeof process.versions.electron === 'string' ? process.versions.electron : undefined },
  }

  // Ensure a problem is in the log too so the global log view shows it
  if (selfcheck.status === 'fail') log('warn', 'diagnostics', `Autodiagnóstico: ${selfcheck.checks.filter(c => c.status === 'fail').map(c => c.id).join(', ')}`)
  return diagnostics
}

export function mapDiagnosticsToUI(d: Diagnostics): Record<string, string> {
  const out: Record<string, string> = { ...d.levels }
  return out
}
