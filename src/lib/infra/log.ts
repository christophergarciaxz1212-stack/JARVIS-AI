import fs from 'fs'
import path from 'path'
import { dataDir } from '../agents/fsutil'
import { deepRedact, redact } from '../redact'

export type LogLevel = 'info' | 'warn' | 'error'

export interface LogEntry {
  ts: number
  level: LogLevel
  area: string
  message: string
  data?: Record<string, unknown>
}

export interface AuditEntry {
  ts: number
  /** "user", "agent:<name>", "watchdog" or "system". */
  actor: string
  action: string
  target?: string
  risk?: string
  ok: boolean
  detail?: string
  durationMs?: number
}

const KEEP_DAYS = 14
const logsDir = () => path.join(dataDir(), 'logs')
const auditFile = () => path.join(dataDir(), 'infra', 'audit.jsonl')
const day = (ts: number) => {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

let lastPrune = 0

function pruneOldLogs() {
  if (Date.now() - lastPrune < 3_600_000) return
  lastPrune = Date.now()
  try {
    const cutoff = day(Date.now() - KEEP_DAYS * 86_400_000)
    for (const f of fs.readdirSync(logsDir())) {
      const m = f.match(/^jarvis-(\d{4}-\d{2}-\d{2})\.jsonl$/)
      if (m && m[1] < cutoff) fs.rmSync(path.join(logsDir(), f), { force: true })
    }
  } catch {}
}

/** Appends one JSON line; logging must never throw into the caller. */
function appendLine(file: string, value: unknown) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.appendFileSync(file, JSON.stringify(value) + '\n', 'utf-8')
  } catch {}
}

export function log(level: LogLevel, area: string, message: string, data?: Record<string, unknown>) {
  const ts = Date.now()
  const entry: LogEntry = { ts, level, area, message: redact(String(message)).slice(0, 4000), ...(data ? { data: deepRedact(data) } : {}) }
  appendLine(path.join(logsDir(), `jarvis-${day(ts)}.jsonl`), entry)
  pruneOldLogs()
}

function readJsonLines<T>(file: string): T[] {
  let raw = ''
  try { raw = fs.readFileSync(file, 'utf-8') } catch { return [] }
  const out: T[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try { out.push(JSON.parse(line) as T) } catch { /* a torn last line after a crash is skipped */ }
  }
  return out
}

export function readLogs(opts: { level?: LogLevel; area?: string; limit?: number; sinceMs?: number } = {}): LogEntry[] {
  const limit = Math.min(opts.limit ?? 200, 2000)
  let files: string[] = []
  try { files = fs.readdirSync(logsDir()).filter(f => /^jarvis-.*\.jsonl$/.test(f)).sort().reverse() } catch { return [] }
  const out: LogEntry[] = []
  for (const f of files) {
    const rows = readJsonLines<LogEntry>(path.join(logsDir(), f)).reverse()
    for (const r of rows) {
      if (opts.sinceMs && r.ts < opts.sinceMs) return out
      if (opts.level && r.level !== opts.level) continue
      if (opts.area && r.area !== opts.area) continue
      out.push(r)
      if (out.length >= limit) return out
    }
  }
  return out
}

export function audit(entry: Omit<AuditEntry, 'ts'>) {
  const row: AuditEntry = { ts: Date.now(), ...entry, detail: entry.detail ? redact(entry.detail).slice(0, 2000) : undefined, target: entry.target ? redact(entry.target) : undefined }
  appendLine(auditFile(), row)
  log(entry.ok ? 'info' : 'warn', 'audit', `${entry.actor} → ${entry.action}${entry.target ? ` (${row.target})` : ''}: ${entry.ok ? 'ok' : 'falhou'}`)
}

export function readAudit(limit = 200): AuditEntry[] {
  return readJsonLines<AuditEntry>(auditFile()).slice(-Math.min(limit, 2000)).reverse()
}

const g = globalThis as unknown as { __jarvisErrorHooks?: boolean }

/**
 * Records process-level failures. Rejections are logged and kept from killing the server;
 * uncaught exceptions are only observed (the monitor hook leaves Node's crash behaviour intact,
 * because continuing after one can leave state corrupted).
 */
export function installProcessErrorHooks() {
  if (g.__jarvisErrorHooks) return
  g.__jarvisErrorHooks = true
  process.on('unhandledRejection', reason => {
    const err = reason instanceof Error ? reason : new Error(String(reason))
    log('error', 'process', `Promise rejeitada sem tratamento: ${err.message}`, { stack: err.stack?.split('\n').slice(0, 8).join('\n') })
  })
  process.on('uncaughtExceptionMonitor', (err, origin) => {
    log('error', 'process', `Exceção não tratada (${origin}): ${err.message}`, { stack: err.stack?.split('\n').slice(0, 8).join('\n') })
  })
  process.on('warning', w => {
    if (w.name === 'MaxListenersExceededWarning' || w.name === 'DeprecationWarning') log('warn', 'process', `${w.name}: ${w.message}`)
  })
}
