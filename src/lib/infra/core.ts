import fs from 'fs'
import os from 'os'
import path from 'path'
import { runCommand, isSafeCommand } from '../shell'
import { redact } from '../redact'
import { dataDir } from '../agents/fsutil'
import { audit, installProcessErrorHooks, log } from './log'
import { Watchdog, loadSettings, saveSettings } from './monitor'
import { cleanOrphanPartials, createBackup, listBackups, restoreDataFile } from './backup'
import { infraDir } from './store'
import { cleanStaleTmp, runSelfCheck, startSamplers, type FixAction } from './selfcheck'
import { getApproval, requestApproval, settleApproval, type InfraApproval } from './approvals'
import { classifyCommand } from './risk'
import { execRemote, findServer } from './ssh'
import { dockerAction, type DockerAction } from './docker'
import { TOOL_CATALOG, getInventory } from './inventory'
import { clearWhichCache, which } from './exec'

interface CoreState { watchdog: Watchdog; started: boolean; backupRunning: boolean }
const g = globalThis as unknown as { __jarvisInfraCore?: CoreState }

function seedDefaults(w: Watchdog) {
  const settings = loadSettings()
  if (settings.seeded) return
  const add = (input: Parameters<Watchdog['add']>[0]) => { try { w.add(input, 'system') } catch (e) { log('warn', 'infra', `Monitor padrão não criado: ${(e as Error).message}`) } }
  add({ name: 'Memória RAM', kind: 'resource', resource: { metric: 'memory', max: 92 }, intervalSec: 60, failThreshold: 3 })
  add({ name: `Disco ${process.platform === 'win32' ? 'C:' : '/'}`, kind: 'resource', resource: { metric: 'disk', max: 95 }, intervalSec: 300, failThreshold: 1 })
  add({ name: 'Temperatura da GPU', kind: 'resource', resource: { metric: 'gpu-temp', max: 87 }, intervalSec: 60, failThreshold: 3 })
  // Off by default: Ollama is often closed on purpose; the user turns it on if they serve local models
  add({ name: 'Ollama (IA local)', kind: 'tcp', target: '127.0.0.1:11434', intervalSec: 60, failThreshold: 2, enabled: false })
  saveSettings({ seeded: true })
}

// ─── Leader election: one JARVIS process monitors and backs up at a time ─────

const lockFile = () => path.join(infraDir(), 'watchdog.lock')
const BEAT_STALE_MS = 45_000

function pidAlive(pid: number) {
  try { process.kill(pid, 0); return true } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM' }
}

function readLock(): { pid: number; beat: number } | null {
  try { return JSON.parse(fs.readFileSync(lockFile(), 'utf-8')) } catch { return null }
}

function writeBeat() {
  const tmp = `${lockFile()}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify({ pid: process.pid, beat: Date.now() }))
  fs.renameSync(tmp, lockFile())
}

/** Takes the monitoring lock if it is free, stale, or its owner died. Exclusive create: two processes can't both win. */
export function tryLead(): boolean {
  const cur = readLock()
  if (cur?.pid === process.pid) { writeBeat(); return true }
  if (cur && pidAlive(cur.pid) && Date.now() - cur.beat < BEAT_STALE_MS) return false
  try {
    fs.mkdirSync(infraDir(), { recursive: true })
    if (cur) fs.rmSync(lockFile(), { force: true })
    const fd = fs.openSync(lockFile(), 'wx')
    fs.writeSync(fd, JSON.stringify({ pid: process.pid, beat: Date.now() }))
    fs.closeSync(fd)
    return true
  } catch {
    return false
  }
}

function heartbeat(core: CoreState) {
  const cur = readLock()
  // Someone took over (our beat stalled past the limit): step down instead of double-monitoring
  if (cur && cur.pid !== process.pid) { core.watchdog.follower = true; log('warn', 'infra', `Outro processo do JARVIS (pid ${cur.pid}) assumiu o monitoramento`); return }
  writeBeat()
}

async function scheduledBackup(state: CoreState) {
  const s = loadSettings()
  if (!s.backupEveryHours || state.backupRunning) return
  // Keep startup fast: the first scheduled backup waits a few minutes after boot
  if (process.uptime() < 180) return
  cleanOrphanPartials()
  if (Date.now() - s.lastBackupAt < s.backupEveryHours * 3_600_000) return
  state.backupRunning = true
  try {
    const b = await createBackup({ trigger: 'agendado', profile: s.backupProfile, keep: s.backupKeep })
    saveSettings({ lastBackupAt: b.createdAt, lastBackupError: undefined })
    log('info', 'backup', `Backup agendado concluído: ${(b.size / 1048576).toFixed(1)} MB, ${b.entries} itens`)
  } catch (e) {
    // Retry no sooner than one hour so a persistent failure does not loop every tick
    saveSettings({ lastBackupAt: Date.now() - s.backupEveryHours * 3_600_000 + 3_600_000, lastBackupError: (e as Error).message })
    log('error', 'backup', `Backup agendado falhou: ${(e as Error).message}`)
  } finally {
    state.backupRunning = false
  }
}

/** The Infrastructure Core singleton: watchdog, schedules and process instrumentation. */
export function getInfraCore(): CoreState {
  if (g.__jarvisInfraCore) return g.__jarvisInfraCore
  const state: CoreState = { watchdog: new Watchdog(), started: false, backupRunning: false }
  g.__jarvisInfraCore = state
  return state
}

export function startInfraCore() {
  const core = getInfraCore()
  if (core.started || process.env.JARVIS_INFRA_DISABLED === '1') return core
  core.started = true
  installProcessErrorHooks()
  startSamplers()
  seedDefaults(core.watchdog)
  const removed = cleanOrphanPartials()
  if (removed) log('warn', 'backup', `${removed} backup(s) interrompido(s) por encerramento inesperado foram limpos`)
  core.watchdog.follower = !tryLead()
  core.watchdog.onTick(() => heartbeat(core))
  core.watchdog.onTick(() => scheduledBackup(core))
  core.watchdog.start()
  const takeover = setInterval(() => {
    if (core.watchdog.follower && tryLead()) {
      core.watchdog.follower = false
      log('warn', 'infra', `Processo líder do monitoramento parou; pid ${process.pid} assumiu`)
    }
  }, 15_000)
  takeover.unref?.()
  // Warm the inventory after boot settles, so the Infra panel opens with data already there
  setTimeout(() => { getInventory().catch(() => {}) }, 30_000).unref?.()
  process.once('exit', () => { if (readLock()?.pid === process.pid) try { fs.rmSync(lockFile(), { force: true }) } catch {} })
  log('info', 'infra', `Infrastructure Core iniciado em ${os.hostname()} (pid ${process.pid}) como ${core.watchdog.follower ? 'seguidor — outro processo do JARVIS já monitora' : 'líder do monitoramento'}`)
  return core
}

export function selfReport() {
  const core = getInfraCore()
  return runSelfCheck({ watchdogRunning: core.watchdog.running, openIncidents: core.watchdog.openIncidents().length, backupEveryHours: loadSettings().backupEveryHours })
}

export async function applyFix(fix: Pick<FixAction, 'action' | 'arg'>, actor = 'user') {
  const core = getInfraCore()
  let result = ''
  switch (fix.action) {
    case 'clean-tmp': result = `${cleanStaleTmp() + cleanOrphanPartials()} temporário(s) removido(s)`; break
    case 'restore-file': {
      const r = await restoreDataFile(String(fix.arg || ''))
      result = `${r.restored} restaurado do backup de ${new Date(r.createdAt).toLocaleString('pt-BR')}`
      break
    }
    case 'backup-now': {
      const s = loadSettings()
      const b = await createBackup({ trigger: 'manual', profile: s.backupProfile, keep: s.backupKeep })
      saveSettings({ lastBackupAt: b.createdAt })
      result = `Backup criado (${(b.size / 1048576).toFixed(1)} MB)`
      break
    }
    case 'start-watchdog': core.watchdog.start(); result = 'Watchdog iniciado'; break
    case 'npm-install': {
      const r = await runCommand('npm install --no-audit --no-fund', process.cwd(), { timeoutMs: 600_000 })
      if (r.exitCode !== 0) throw new Error(`npm install falhou: ${redact(r.stderr).slice(-600)}`)
      result = 'Dependências instaladas'
      break
    }
    default: throw new Error('Correção desconhecida')
  }
  audit({ actor, action: `selfcheck:${fix.action}`, target: fix.arg, ok: true, detail: result })
  return result
}

// ─── Approvals: what agents may only REQUEST, and the user executes ──────────

export function requestInstall(toolId: string, actor: string): InfraApproval {
  const tool = TOOL_CATALOG.find(t => t.id === toolId || t.label.toLowerCase() === toolId.toLowerCase())
  if (!tool) throw new Error(`Ferramenta desconhecida: ${toolId}. Disponíveis: ${TOOL_CATALOG.filter(t => t.installId).map(t => t.id).join(', ')}`)
  if (!tool.installId) throw new Error(`${tool.label} não é instalável pelo winget. ${tool.note || ''}`.trim())
  const command = `winget install -e --id ${tool.installId} --accept-source-agreements --accept-package-agreements --disable-interactivity`
  return requestApproval({ actor, kind: 'install', title: `Instalar ${tool.label}`, command, risk: 'change', reasons: ['instala software no computador'], payload: { tool: tool.id } })
}

export function requestSshExec(serverRef: string, command: string, actor: string): InfraApproval {
  const server = findServer(serverRef)
  const risk = classifyCommand(command)
  return requestApproval({ actor, kind: 'ssh-exec', title: `Executar em ${server.name}`, command, risk: risk.level, reasons: risk.reasons, payload: { server: server.id } })
}

export function requestDockerAction(container: string, action: DockerAction, actor: string): InfraApproval {
  return requestApproval({ actor, kind: 'docker', title: `docker ${action} ${container}`, command: `docker ${action} ${container}`, risk: 'change', reasons: ['altera containers'], payload: { container, action } })
}

export function requestLocalExec(command: string, actor: string): InfraApproval {
  const risk = classifyCommand(command)
  return requestApproval({ actor, kind: 'local-exec', title: 'Comando no computador', command, risk: risk.level, reasons: risk.reasons, payload: {} })
}

/** Runs an approved request. Only called from the UI after the user's explicit click. */
export async function approveAndRun(id: string): Promise<InfraApproval> {
  const a = getApproval(id)
  if (!a) throw new Error('Solicitação não encontrada')
  if (a.status !== 'pending') throw new Error('Esta solicitação já foi decidida')
  const started = Date.now()
  try {
    let output = ''
    if (a.kind === 'install') {
      const r = await runCommand(a.command, os.homedir(), { timeoutMs: 900_000, maxOutput: 20_000 })
      output = redact(`${r.stdout}\n${r.stderr}`).trim().slice(-3000)
      clearWhichCache()
      const tool = String(a.payload.tool || '')
      if (r.exitCode !== 0 && !(await which(tool))) throw new Error(`winget terminou com código ${r.exitCode}\n${output}`)
      output += (await which(tool)) ? '\n✔ Instalado e encontrado no PATH.' : '\nInstalado — pode ser preciso reabrir o JARVIS para o PATH atualizar.'
    } else if (a.kind === 'ssh-exec') {
      const r = await execRemote(findServer(String(a.payload.server)), a.command, { confirmed: true })
      output = `exit ${r.exitCode}\n${r.stdout}${r.stderr ? `\n[stderr]\n${r.stderr}` : ''}`.slice(-6000)
      if (!r.ok) throw new Error(output)
    } else if (a.kind === 'docker') {
      output = await dockerAction(String(a.payload.container), a.payload.action as DockerAction)
    } else if (a.kind === 'local-exec') {
      if (!isSafeCommand(a.command)) throw new Error('Comando bloqueado pela política de segurança do JARVIS')
      const r = await runCommand(a.command, os.homedir(), { timeoutMs: 600_000 })
      output = redact(`exit ${r.exitCode}\n${r.stdout}${r.stderr ? `\n[stderr]\n${r.stderr}` : ''}`).slice(-6000)
      if (r.exitCode !== 0) throw new Error(output)
    }
    audit({ actor: `user (aprovou pedido de ${a.actor})`, action: a.kind, target: a.title, risk: a.risk, ok: true, detail: a.command, durationMs: Date.now() - started })
    return settleApproval(id, 'executed', output)
  } catch (e) {
    audit({ actor: `user (aprovou pedido de ${a.actor})`, action: a.kind, target: a.title, risk: a.risk, ok: false, detail: `${a.command}: ${(e as Error).message}`, durationMs: Date.now() - started })
    return settleApproval(id, 'failed', (e as Error).message)
  }
}

export function rejectApproval(id: string) {
  const a = settleApproval(id, 'rejected')
  audit({ actor: 'user', action: `recusou:${a.kind}`, target: a.title, risk: a.risk, ok: true, detail: a.command })
  return a
}

export function backupStatus() {
  const s = loadSettings()
  const ours = listBackups().filter(b => b.source === path.resolve(dataDir()))
  return { settings: s, last: ours[0], count: ours.length }
}
