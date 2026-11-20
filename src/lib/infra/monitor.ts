import os from 'os'
import fs from 'fs'
import path from 'path'
import { isSafeCommand, runCommand } from '../shell'
import { redact } from '../redact'
import { runProgram, which } from './exec'
import { dnsCheck, diagnose, httpCheck, parseTarget, tcpCheck } from './netdiag'
import { readGpus } from './inventory'
import { classifyCommand } from './risk'
import { audit, log } from './log'
import { infraDir, loadStore, newId, saveStore } from './store'
import { findServer, testServer } from './ssh'

export type MonitorKind = 'http' | 'tcp' | 'dns' | 'process' | 'docker' | 'ssh' | 'resource'
export type ResourceMetric = 'memory' | 'disk' | 'cpu' | 'gpu-temp' | 'gpu-mem'

export interface RecoveryPolicy {
  /** PowerShell command written by the user (agents can't set this). */
  command: string
  maxAttempts: number
  windowMin: number
  cooldownSec: number
  verifyAfterSec: number
}

export interface MonitorDef {
  id: string
  name: string
  kind: MonitorKind
  target: string
  intervalSec: number
  failThreshold: number
  expectStatus?: number
  resource?: { metric: ResourceMetric; max: number; mount?: string }
  recovery?: RecoveryPolicy
  enabled: boolean
  createdAt: number
  createdBy: string
}

export interface Sample { t: number; ok: boolean; ms: number }

export interface MonitorState {
  id: string
  status: 'up' | 'down' | 'unknown'
  lastCheckAt: number
  lastOkAt?: number
  lastLatencyMs?: number
  lastValue?: number
  lastError?: string
  consecutiveFailures: number
  recoveryAttempts: number[]
  breakerOpen: boolean
  nextRecoveryAt: number
  history: Sample[]
}

export interface IncidentAction { t: number; kind: 'detect' | 'diagnose' | 'logs' | 'recover' | 'verify' | 'giveup' | 'resolve' | 'note'; message: string; ok?: boolean }

export interface Incident {
  id: string
  monitorId: string
  monitorName: string
  openedAt: number
  resolvedAt?: number
  status: 'open' | 'resolved'
  cause: string
  impact: string
  actions: IncidentAction[]
  acknowledged: boolean
  autoRecovered?: boolean
}

export interface CheckResult { ok: boolean; latencyMs: number; value?: number; error?: string }

export interface InfraSettings {
  seeded: boolean
  backupEveryHours: number
  backupKeep: number
  backupProfile: 'essencial' | 'completo'
  lastBackupAt: number
  lastBackupError?: string
}

const DEFS = 'monitors.json'
const STATES = 'monitor-state.json'
const INCIDENTS = 'incidents.json'
const SETTINGS = 'settings.json'
const HISTORY = 60
const MAX_INCIDENTS = 300

export const DEFAULT_SETTINGS: InfraSettings = { seeded: false, backupEveryHours: 24, backupKeep: 7, backupProfile: 'essencial', lastBackupAt: 0 }

export function loadSettings(): InfraSettings {
  return { ...DEFAULT_SETTINGS, ...loadStore<Partial<InfraSettings>>(SETTINGS, {}) }
}
export function saveSettings(patch: Partial<InfraSettings>) {
  const next = { ...loadSettings(), ...patch }
  next.backupEveryHours = Math.max(0, Math.min(168, Math.floor(Number(next.backupEveryHours) || 0)))
  next.backupKeep = Math.max(1, Math.min(60, Math.floor(Number(next.backupKeep) || 7)))
  saveStore(SETTINGS, next)
  return next
}

const clampInt = (v: unknown, min: number, max: number, def: number) => {
  const n = Math.floor(Number(v))
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : def
}

export function validateMonitor(input: Partial<MonitorDef>, actor: string): Omit<MonitorDef, 'id' | 'createdAt'> {
  const kinds: MonitorKind[] = ['http', 'tcp', 'dns', 'process', 'docker', 'ssh', 'resource']
  const kind = input.kind as MonitorKind
  if (!kinds.includes(kind)) throw new Error(`Tipo de monitor inválido. Use: ${kinds.join(', ')}`)
  const name = String(input.name || input.target || kind).trim().slice(0, 80)
  let target = String(input.target || '').trim()
  if (kind === 'http') { const u = new URL(target); if (!/^https?:$/.test(u.protocol)) throw new Error('Use uma URL http(s)'); target = u.toString() }
  if (kind === 'tcp') { const t = parseTarget(target); if (!t.port) throw new Error('Informe host:porta'); target = `${t.host}:${t.port}` }
  if (kind === 'dns') parseTarget(target)
  if ((kind === 'process' || kind === 'docker') && !/^[\w.-]{1,128}$/.test(target)) throw new Error('Nome inválido')
  if (kind === 'ssh') findServer(target)
  let resource: MonitorDef['resource']
  if (kind === 'resource') {
    const metric = input.resource?.metric as ResourceMetric
    if (!['memory', 'disk', 'cpu', 'gpu-temp', 'gpu-mem'].includes(metric)) throw new Error('Métrica inválida')
    resource = { metric, max: clampInt(input.resource?.max, 1, metric === 'gpu-temp' ? 120 : 100, 90), mount: input.resource?.mount }
    target = metric
  }
  let recovery: RecoveryPolicy | undefined
  if (input.recovery?.command) {
    // Only the user (UI) may attach a recovery command: it runs unattended
    if (actor !== 'user') throw new Error('Só o usuário pode configurar um comando de recuperação automática')
    const command = String(input.recovery.command).trim()
    if (!isSafeCommand(command)) throw new Error('Comando de recuperação bloqueado por segurança')
    const risk = classifyCommand(command)
    if (risk.level === 'critical') throw new Error(`Recuperação automática não pode ser destrutiva (${risk.reasons.join(', ')})`)
    recovery = {
      command,
      maxAttempts: clampInt(input.recovery.maxAttempts, 1, 10, 3),
      windowMin: clampInt(input.recovery.windowMin, 5, 1440, 60),
      cooldownSec: clampInt(input.recovery.cooldownSec, 5, 3600, 30),
      verifyAfterSec: clampInt(input.recovery.verifyAfterSec, 1, 600, 10),
    }
  }
  return {
    name, kind, target, resource, recovery,
    intervalSec: clampInt(input.intervalSec, 10, 86_400, 60),
    failThreshold: clampInt(input.failThreshold, 1, 10, 2),
    expectStatus: input.expectStatus ? clampInt(input.expectStatus, 100, 599, 200) : undefined,
    enabled: input.enabled !== false,
    createdBy: actor,
  }
}

async function resourceValue(metric: ResourceMetric, mount?: string): Promise<number> {
  if (metric === 'memory') return Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100)
  if (metric === 'cpu') {
    const a = os.cpus().map(c => c.times)
    await new Promise(r => setTimeout(r, 500))
    let idle = 0, total = 0
    os.cpus().forEach((c, i) => {
      const p = a[i]
      if (!p) return
      const t = c.times
      const tot = t.user - p.user + t.nice - p.nice + t.sys - p.sys + t.idle - p.idle + t.irq - p.irq
      idle += t.idle - p.idle
      total += tot
    })
    return total ? Math.round(((total - idle) / total) * 100) : 0
  }
  if (metric === 'disk') {
    const st = fs.statfsSync(mount || (process.platform === 'win32' ? 'C:\\' : '/'))
    return Math.round(((st.blocks - st.bavail) / st.blocks) * 100)
  }
  const gpus = await readGpus()
  const gpu = gpus[0]
  if (!gpu) throw new Error('Nenhuma GPU com telemetria (nvidia-smi) encontrada')
  if (metric === 'gpu-temp') {
    if (gpu.temperatureC === undefined) throw new Error('GPU sem sensor de temperatura disponível')
    return gpu.temperatureC
  }
  if (!gpu.memoryTotalMb || gpu.memoryUsedMb === undefined) throw new Error('GPU sem telemetria de memória')
  return Math.round((gpu.memoryUsedMb / gpu.memoryTotalMb) * 100)
}

export async function runCheck(def: MonitorDef): Promise<CheckResult> {
  const started = Date.now()
  const took = () => Date.now() - started
  switch (def.kind) {
    case 'http': {
      const r = await httpCheck(def.target, 10_000)
      const ok = def.expectStatus ? r.status === def.expectStatus : r.ok
      return { ok, latencyMs: r.latencyMs, value: r.status, error: ok ? undefined : r.error || `HTTP ${r.status}${def.expectStatus ? ` (esperado ${def.expectStatus})` : ''}` }
    }
    case 'tcp': {
      const t = parseTarget(def.target)
      const r = await tcpCheck(t.host, t.port!, 5000)
      return { ok: r.ok, latencyMs: r.latencyMs, error: r.error }
    }
    case 'dns': {
      const r = await dnsCheck(parseTarget(def.target).host)
      return { ok: r.ok, latencyMs: r.durationMs, error: r.error }
    }
    case 'process': {
      const r = process.platform === 'win32'
        ? await runProgram('tasklist', ['/FI', `IMAGENAME eq ${def.target.replace(/\.exe$/i, '')}.exe`, '/NH', '/FO', 'CSV'], { timeoutMs: 10_000 })
        : await runProgram('pgrep', ['-x', def.target], { timeoutMs: 10_000 })
      const ok = process.platform === 'win32' ? /^"/m.test(r.stdout) : r.exitCode === 0
      return { ok, latencyMs: took(), error: ok ? undefined : `Processo ${def.target} não está rodando` }
    }
    case 'docker': {
      if (!(await which('docker'))) return { ok: false, latencyMs: took(), error: 'Docker não instalado' }
      const r = await runProgram('docker', ['inspect', '-f', '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}', def.target], { timeoutMs: 15_000 })
      const [state, health] = r.stdout.trim().split('|')
      const ok = r.exitCode === 0 && state === 'running' && health !== 'unhealthy'
      return { ok, latencyMs: took(), error: ok ? undefined : r.exitCode !== 0 ? r.stderr.trim().slice(0, 200) : `Container ${state}${health ? ` (${health})` : ''}` }
    }
    case 'ssh': {
      const r = await testServer(findServer(def.target))
      return { ok: r.ok, latencyMs: r.latencyMs, error: r.error?.slice(0, 300) }
    }
    case 'resource': {
      const res = def.resource!
      const value = await resourceValue(res.metric, res.mount)
      const unit = res.metric === 'gpu-temp' ? ' °C' : '%'
      const ok = value < res.max
      return { ok, latencyMs: took(), value, error: ok ? undefined : `${res.metric} em ${value}${unit} (limite ${res.max}${unit})` }
    }
  }
}

export interface WatchdogDeps {
  now?: () => number
  check?: (def: MonitorDef) => Promise<CheckResult>
  recover?: (command: string) => Promise<{ ok: boolean; output: string }>
  /** Extra evidence gathered when an incident opens (diagnosis, logs). */
  investigate?: (def: MonitorDef) => Promise<IncidentAction[]>
  onIncident?: (incident: Incident) => void
}

async function defaultRecover(command: string) {
  const r = await runCommand(command, os.homedir(), { timeoutMs: 120_000 })
  const output = redact(`${r.stdout}\n${r.stderr}`.trim()).slice(-2000)
  return { ok: r.exitCode === 0 && !r.timedOut, output: r.timedOut ? `Tempo esgotado (120 s). ${output}` : output }
}

async function defaultInvestigate(def: MonitorDef): Promise<IncidentAction[]> {
  const out: IncidentAction[] = []
  try {
    if (def.kind === 'http' || def.kind === 'tcp' || def.kind === 'dns') {
      const d = await diagnose(def.target)
      out.push({ t: Date.now(), kind: 'diagnose', message: `${d.probableCause || 'Sem causa clara'}\n${d.findings.map(f => `• ${f}`).join('\n')}` })
    } else if (def.kind === 'docker') {
      const r = await runProgram('docker', ['logs', '--tail', '30', def.target], { timeoutMs: 15_000 })
      out.push({ t: Date.now(), kind: 'logs', message: redact((r.stdout + r.stderr).trim().slice(-2500)) || '(sem logs)' })
    } else if (def.kind === 'process' && process.platform === 'win32') {
      const r = await runProgram('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "Get-WinEvent -FilterHashtable @{LogName='Application';Level=1,2;StartTime=(Get-Date).AddMinutes(-30)} -MaxEvents 5 -ErrorAction SilentlyContinue | ForEach-Object { \"[$($_.TimeCreated.ToString('HH:mm'))] $($_.ProviderName): $($_.Message.Split([char]10)[0])\" }"], { timeoutMs: 20_000 })
      if (r.stdout.trim()) out.push({ t: Date.now(), kind: 'logs', message: `Erros recentes no Visualizador de Eventos:\n${redact(r.stdout.trim()).slice(0, 2500)}` })
    }
  } catch (e) {
    out.push({ t: Date.now(), kind: 'note', message: `Investigação automática falhou: ${(e as Error).message}` })
  }
  return out
}

export class Watchdog {
  private defs: MonitorDef[]
  private states: Map<string, MonitorState>
  private incidents: Incident[]
  private busy = new Set<string>()
  private timer: NodeJS.Timeout | null = null
  private dirty = false
  private now: () => number
  private deps: WatchdogDeps
  private tickHooks: Array<() => Promise<void> | void> = []
  private mtimes = new Map<string, number>()
  /** Another JARVIS process owns monitoring: this one serves the UI from disk and does not check. */
  follower = false

  constructor(deps: WatchdogDeps = {}) {
    this.deps = deps
    this.now = deps.now || Date.now
    this.defs = loadStore<MonitorDef[]>(DEFS, [])
    this.states = new Map(loadStore<MonitorState[]>(STATES, []).map(s => [s.id, s]))
    this.incidents = loadStore<Incident[]>(INCIDENTS, [])
    for (const f of [DEFS, STATES, INCIDENTS]) this.remember(f)
  }

  private mtime(name: string) {
    try { return fs.statSync(path.join(infraDir(), name)).mtimeMs } catch { return 0 }
  }
  private remember(name: string) { this.mtimes.set(name, this.mtime(name)) }
  private changed(name: string) { return this.mtime(name) !== this.mtimes.get(name) }

  /** Picks up what another JARVIS process (or a follower's UI) wrote since our last read/write. */
  sync() {
    if (this.changed(DEFS)) { this.defs = loadStore<MonitorDef[]>(DEFS, []); this.remember(DEFS) }
    if (this.changed(INCIDENTS)) { this.incidents = loadStore<Incident[]>(INCIDENTS, []); this.remember(INCIDENTS) }
    if (this.follower && this.changed(STATES)) { this.states = new Map(loadStore<MonitorState[]>(STATES, []).map(s => [s.id, s])); this.remember(STATES) }
  }

  /** Extra periodic work (scheduled backups, self-check) run after each tick. */
  onTick(fn: () => Promise<void> | void) { this.tickHooks.push(fn) }

  start(periodMs = 5000) {
    if (this.timer) return
    this.timer = setInterval(() => { this.tick().catch(e => log('error', 'watchdog', `Falha no ciclo do watchdog: ${(e as Error).message}`)) }, periodMs)
    this.timer.unref?.()
    log('info', 'watchdog', `Watchdog iniciado com ${this.defs.filter(d => d.enabled).length} monitor(es) ativo(s)`)
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null }
  get running() { return !!this.timer }

  list() {
    this.sync()
    return this.defs.map(d => ({ ...d, state: this.state(d.id) }))
  }

  state(id: string): MonitorState {
    let s = this.states.get(id)
    if (!s) { s = { id, status: 'unknown', lastCheckAt: 0, consecutiveFailures: 0, recoveryAttempts: [], breakerOpen: false, nextRecoveryAt: 0, history: [] }; this.states.set(id, s) }
    return s
  }

  add(input: Partial<MonitorDef>, actor: string): MonitorDef {
    this.sync()
    const clean = validateMonitor(input, actor)
    if (this.defs.length >= 200) throw new Error('Limite de 200 monitores')
    const def: MonitorDef = { ...clean, id: newId('mon'), createdAt: this.now() }
    this.defs.push(def)
    this.persistDefs()
    return def
  }

  update(id: string, input: Partial<Omit<MonitorDef, 'recovery'>> & { recovery?: Partial<RecoveryPolicy> | null }, actor: string): MonitorDef {
    this.sync()
    const def = this.defs.find(d => d.id === id)
    if (!def) throw new Error('Monitor não encontrado')
    if (input.recovery && actor !== 'user') throw new Error('Só o usuário pode configurar um comando de recuperação automática')
    const recovery = input.recovery === null ? undefined : (input.recovery as RecoveryPolicy | undefined) ?? def.recovery
    // A recovery command the user already set stays valid when other fields are edited
    const clean = validateMonitor({ ...def, ...input, recovery }, input.recovery ? actor : 'user')
    Object.assign(def, clean, { createdBy: def.createdBy })
    if (!clean.recovery) delete def.recovery
    this.persistDefs()
    return def
  }

  remove(id: string) {
    this.sync()
    this.defs = this.defs.filter(d => d.id !== id)
    this.states.delete(id)
    this.persistDefs()
    this.persistStates()
  }

  /** Closes the breaker so automatic recovery may try again (user decision). */
  resetBreaker(id: string) {
    const s = this.state(id)
    s.breakerOpen = false
    s.recoveryAttempts = []
    s.nextRecoveryAt = 0
    this.persistStates()
  }

  listIncidents(limit = 100) { this.sync(); return this.incidents.slice(-limit).reverse() }
  openIncidents() { this.sync(); return this.incidents.filter(i => i.status === 'open') }

  acknowledge(id: string) {
    this.sync()
    const inc = this.incidents.find(i => i.id === id)
    if (inc) { inc.acknowledged = true; this.persistIncidents() }
  }

  async tick() {
    this.sync()
    if (this.follower) return
    const now = this.now()
    const due = this.defs.filter(d => d.enabled && !this.busy.has(d.id) && now - this.state(d.id).lastCheckAt >= d.intervalSec * 1000)
    await Promise.all(due.map(d => this.checkNow(d.id)))
    for (const hook of this.tickHooks) {
      try { await hook() } catch (e) { log('error', 'watchdog', `Tarefa periódica falhou: ${(e as Error).message}`) }
    }
    this.flush()
  }

  async checkNow(id: string): Promise<MonitorState> {
    if (!this.defs.some(d => d.id === id)) this.sync()
    const def = this.defs.find(d => d.id === id)
    if (!def) throw new Error('Monitor não encontrado')
    const s = this.state(id)
    if (this.busy.has(id)) return s
    this.busy.add(id)
    try {
      let r: CheckResult
      try { r = await (this.deps.check || runCheck)(def) } catch (e) { r = { ok: false, latencyMs: 0, error: (e as Error).message } }
      await this.apply(def, s, r)
      return s
    } finally {
      this.busy.delete(id)
      this.dirty = true
    }
  }

  private async apply(def: MonitorDef, s: MonitorState, r: CheckResult) {
    const now = this.now()
    s.lastCheckAt = now
    s.lastLatencyMs = r.latencyMs
    s.lastValue = r.value
    s.history.push({ t: now, ok: r.ok, ms: r.latencyMs })
    if (s.history.length > HISTORY) s.history.splice(0, s.history.length - HISTORY)

    if (r.ok) {
      s.lastOkAt = now
      s.lastError = undefined
      s.consecutiveFailures = 0
      if (s.status === 'down') {
        const inc = this.openIncidentFor(def.id)
        if (inc) {
          const auto = inc.actions.some(a => a.kind === 'recover' && a.ok)
          inc.autoRecovered = auto
          this.resolve(inc, auto ? 'Serviço voltou após a recuperação automática' : 'Serviço voltou a responder')
        }
        s.breakerOpen = false
      }
      s.status = 'up'
      return
    }

    s.lastError = r.error
    s.consecutiveFailures++
    if (s.consecutiveFailures < def.failThreshold) return

    let inc = this.openIncidentFor(def.id)
    if (s.status !== 'down' || !inc) {
      s.status = 'down'
      inc = this.openIncident(def, r)
      const evidence = await (this.deps.investigate || defaultInvestigate)(def).catch(() => [] as IncidentAction[])
      inc.actions.push(...evidence)
      const diag = evidence.find(e => e.kind === 'diagnose')
      if (diag) inc.cause = diag.message.split('\n')[0]
      this.persistIncidents()
      this.deps.onIncident?.(inc)
    }
    await this.maybeRecover(def, s, inc)
  }

  private async maybeRecover(def: MonitorDef, s: MonitorState, inc: Incident) {
    const policy = def.recovery
    if (!policy || s.breakerOpen) return
    const now = this.now()
    if (now < s.nextRecoveryAt) return
    s.recoveryAttempts = s.recoveryAttempts.filter(t => now - t < policy.windowMin * 60_000)
    if (s.recoveryAttempts.length >= policy.maxAttempts) {
      s.breakerOpen = true
      inc.actions.push({ t: now, kind: 'giveup', message: `Recuperação automática suspensa: ${policy.maxAttempts} tentativa(s) em ${policy.windowMin} min sem sucesso. Repetir agora poderia piorar a falha — precisa de você.` })
      inc.acknowledged = false
      this.persistIncidents()
      this.deps.onIncident?.(inc)
      audit({ actor: 'watchdog', action: 'recovery-giveup', target: def.name, ok: false, detail: s.lastError })
      return
    }
    s.recoveryAttempts.push(now)
    const attempt = s.recoveryAttempts.length
    // Exponential backoff between attempts: cooldown, 2×, 4×…
    s.nextRecoveryAt = now + policy.cooldownSec * 1000 * 2 ** (attempt - 1)
    const started = Date.now()
    const res = await (this.deps.recover || defaultRecover)(policy.command).catch(e => ({ ok: false, output: (e as Error).message }))
    inc.actions.push({ t: this.now(), kind: 'recover', ok: res.ok, message: `Tentativa ${attempt}/${policy.maxAttempts}: ${policy.command}${res.output ? `\n${res.output}` : ''}` })
    audit({ actor: 'watchdog', action: 'recovery', target: def.name, risk: classifyCommand(policy.command).level, ok: res.ok, detail: policy.command, durationMs: Date.now() - started })
    this.persistIncidents()
    if (!res.ok) return
    // Validate: the service must actually answer before the incident is closed
    await new Promise(r => setTimeout(r, this.deps.check ? 0 : policy.verifyAfterSec * 1000))
    let verify: CheckResult
    try { verify = await (this.deps.check || runCheck)(def) } catch (e) { verify = { ok: false, latencyMs: 0, error: (e as Error).message } }
    inc.actions.push({ t: this.now(), kind: 'verify', ok: verify.ok, message: verify.ok ? `Verificado: respondendo em ${verify.latencyMs} ms` : `Ainda com falha: ${verify.error}` })
    if (verify.ok) {
      s.status = 'up'
      s.consecutiveFailures = 0
      s.lastOkAt = this.now()
      s.lastError = undefined
      inc.autoRecovered = true
      this.resolve(inc, 'Recuperado automaticamente e verificado')
    } else this.persistIncidents()
  }

  private openIncidentFor(monitorId: string) {
    return this.incidents.find(i => i.monitorId === monitorId && i.status === 'open')
  }

  private openIncident(def: MonitorDef, r: CheckResult): Incident {
    const inc: Incident = {
      id: newId('inc'), monitorId: def.id, monitorName: def.name, openedAt: this.now(), status: 'open', acknowledged: false,
      cause: r.error || 'Falha na verificação',
      impact: def.kind === 'resource' ? 'Desempenho/estabilidade da máquina em risco' : `${def.name} indisponível para quem depende dele`,
      actions: [{ t: this.now(), kind: 'detect', message: `${def.failThreshold} verificação(ões) seguidas falharam: ${r.error || 'sem detalhe'}` }],
    }
    this.incidents.push(inc)
    if (this.incidents.length > MAX_INCIDENTS) this.incidents.splice(0, this.incidents.length - MAX_INCIDENTS)
    log('warn', 'watchdog', `Incidente aberto: ${def.name} — ${inc.cause}`)
    return inc
  }

  private resolve(inc: Incident, message: string) {
    inc.status = 'resolved'
    inc.resolvedAt = this.now()
    inc.actions.push({ t: this.now(), kind: 'resolve', ok: true, message })
    log('info', 'watchdog', `Incidente resolvido: ${inc.monitorName} — ${message}`)
    this.persistIncidents()
    this.deps.onIncident?.(inc)
  }

  private persistDefs() { saveStore(DEFS, this.defs); this.remember(DEFS) }
  private persistStates() { saveStore(STATES, [...this.states.values()]); this.remember(STATES) }
  private persistIncidents() { saveStore(INCIDENTS, this.incidents); this.remember(INCIDENTS) }

  flush() {
    if (!this.dirty) return
    this.dirty = false
    this.persistStates()
  }
}
