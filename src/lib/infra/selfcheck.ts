import fs from 'fs'
import path from 'path'
import { monitorEventLoopDelay, type IntervalHistogram } from 'perf_hooks'
import { dataDir } from '../agents/fsutil'
import { modelHealth } from '../agents/models'
import { getSystemHealth } from './reliability'
import { readLogs } from './log'
import { listBackups } from './backup'

export type CheckStatus = 'ok' | 'warn' | 'fail'
export interface FixAction { action: 'clean-tmp' | 'restore-file' | 'backup-now' | 'start-watchdog' | 'npm-install'; label: string; arg?: string }
export interface SelfCheck { id: string; label: string; status: CheckStatus; detail: string; fixes?: FixAction[] }
export interface SelfReport { at: number; status: CheckStatus; checks: SelfCheck[]; durationMs: number }

interface Sampler { loop: IntervalHistogram; heap: Array<{ t: number; heapMb: number; rssMb: number }>; timer: NodeJS.Timeout | null }
const g = globalThis as unknown as { __jarvisSampler?: Sampler }

/** Starts (once) the event-loop and heap samplers used to detect stalls and leaks. */
export function startSamplers() {
  if (g.__jarvisSampler?.timer) return g.__jarvisSampler
  const loop = monitorEventLoopDelay({ resolution: 20 })
  loop.enable()
  const s: Sampler = { loop, heap: [], timer: null }
  const sample = () => {
    const m = process.memoryUsage()
    s.heap.push({ t: Date.now(), heapMb: Math.round(m.heapUsed / 1048576), rssMb: Math.round(m.rss / 1048576) })
    if (s.heap.length > 120) s.heap.shift()
  }
  sample()
  s.timer = setInterval(sample, 60_000)
  s.timer.unref?.()
  g.__jarvisSampler = s
  return s
}

/** Heap that grew in most samples of the last half hour by more than 50% is reported as a probable leak. */
export function leakSuspicion(samples: Array<{ heapMb: number }>) {
  if (samples.length < 20) return null
  const recent = samples.slice(-30)
  let ups = 0
  for (let i = 1; i < recent.length; i++) if (recent[i].heapMb > recent[i - 1].heapMb) ups++
  const growth = recent[0].heapMb ? recent[recent.length - 1].heapMb / recent[0].heapMb : 1
  return ups / (recent.length - 1) >= 0.8 && growth >= 1.5 ? { growthPct: Math.round((growth - 1) * 100), from: recent[0].heapMb, to: recent[recent.length - 1].heapMb } : null
}

const SKIP_DIRS = new Set(['backups', 'restores', 'npm-cache', 'extensions', 'node_modules', 'quarantine', 'builds', 'workspace', 'home'])

interface DataScan { files: number; corrupt: string[]; quarantined: Array<{ rel: string; original: string; originalMissing: boolean }>; staleTmp: string[] }

/**
 * Vendored source trees under data/ (e.g. OpenWA) ship tsconfig files as JSONC: comments are
 * legal there and accepted by tsc. Replace only comment characters, never string contents
 * (a URL such as https://x//y must survive), so real parse errors are still detected.
 */
function stripJsonComments(text: string): string {
  let out = ''
  let i = 0
  let inString = false
  let escaped = false
  while (i < text.length) {
    const c = text[i]
    if (inString) {
      out += c
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === '"') inString = false
      i++
      continue
    }
    if (c === '"') {
      inString = true
      out += c
      i++
      continue
    }
    if (c === '/' && text[i + 1] === '/') {
      out += '  '
      i += 2
      while (i < text.length && text[i] !== '\n' && text[i] !== '\r') { out += ' '; i++ }
      continue
    }
    if (c === '/' && text[i + 1] === '*') {
      out += '  '
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        const ch = text[i]
        out += ch === '\n' || ch === '\r' ? ch : ' '
        i++
      }
      if (i < text.length) { out += '  '; i += 2 }
      continue
    }
    out += c
    i++
  }
  return out
}

export function scanData(root = dataDir()): DataScan {
  const out: DataScan = { files: 0, corrupt: [], quarantined: [], staleTmp: [] }
  const walk = (dir: string, depth: number) => {
    if (depth > 6) return
    let entries: fs.Dirent[] = []
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const abs = path.join(dir, e.name)
      const rel = path.relative(root, abs).replace(/\\/g, '/')
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(abs, depth + 1); continue }
      const q = e.name.match(/^(.*)\.corrupt-\d+$/)
      if (q) {
        const original = path.join(dir, q[1])
        out.quarantined.push({ rel, original: path.relative(root, original).replace(/\\/g, '/'), originalMissing: !fs.existsSync(original) })
        continue
      }
      if (/\.tmp$/.test(e.name)) {
        try { if (Date.now() - fs.statSync(abs).mtimeMs > 3_600_000) out.staleTmp.push(rel) } catch {}
        continue
      }
      if (!e.name.endsWith('.json')) continue
      out.files++
      try {
        const st = fs.statSync(abs)
        if (st.size > 50 * 1048576) continue
        JSON.parse(stripJsonComments(fs.readFileSync(abs, 'utf-8')))
      } catch { out.corrupt.push(rel) }
    }
  }
  walk(root, 0)
  return out
}

function missingDependencies(root = process.cwd()) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')) as { dependencies?: Record<string, string> }
    return Object.keys(pkg.dependencies || {}).filter(dep => !fs.existsSync(path.join(root, 'node_modules', dep, 'package.json')))
  } catch { return [] }
}

function newestMtime(dir: string, depth = 0): number {
  if (depth > 8) return 0
  let max = 0
  let entries: fs.Dirent[] = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return 0 }
  for (const e of entries) {
    const abs = path.join(dir, e.name)
    if (e.isDirectory()) max = Math.max(max, newestMtime(abs, depth + 1))
    else try { max = Math.max(max, fs.statSync(abs).mtimeMs) } catch {}
  }
  return max
}

export function runSelfCheck(ctx: { watchdogRunning: boolean; openIncidents: number; backupEveryHours: number }): SelfReport {
  const started = Date.now()
  const checks: SelfCheck[] = []
  const add = (c: SelfCheck) => checks.push(c)

  const scan = scanData()
  add({
    id: 'data', label: 'Integridade dos dados',
    status: scan.corrupt.length ? 'fail' : scan.quarantined.length || scan.staleTmp.length ? 'warn' : 'ok',
    detail: [
      `${scan.files} arquivo(s) JSON verificados`,
      scan.corrupt.length ? `CORROMPIDOS: ${scan.corrupt.join(', ')} (serão isolados na próxima leitura; nada é sobrescrito)` : '',
      scan.quarantined.length ? `Em quarentena: ${scan.quarantined.map(q => q.rel).join(', ')}` : '',
      scan.staleTmp.length ? `${scan.staleTmp.length} arquivo(s) temporário(s) órfão(s) de gravações interrompidas` : '',
    ].filter(Boolean).join(' · '),
    fixes: [
      ...(scan.staleTmp.length ? [{ action: 'clean-tmp' as const, label: 'Limpar temporários órfãos' }] : []),
      ...scan.quarantined.filter(q => q.originalMissing).map(q => ({ action: 'restore-file' as const, label: `Restaurar ${q.original} do último backup`, arg: q.original })),
    ],
  })

  const sampler = g.__jarvisSampler
  const mem = process.memoryUsage()
  const leak = sampler ? leakSuspicion(sampler.heap) : null
  const heapMb = Math.round(mem.heapUsed / 1048576)
  const rssMb = Math.round(mem.rss / 1048576)
  add({
    id: 'memory', label: 'Memória do processo JARVIS',
    status: leak || rssMb > 3000 ? 'warn' : 'ok',
    detail: `heap ${heapMb} MB · RSS ${rssMb} MB${leak ? ` · heap cresceu ${leak.growthPct}% (${leak.from}→${leak.to} MB) de forma contínua: possível vazamento — reiniciar o JARVIS libera` : ''}`,
  })

  if (sampler) {
    const p99 = Math.round(sampler.loop.percentile(99) / 1e6)
    const max = Math.round(sampler.loop.max / 1e6)
    add({
      id: 'eventloop', label: 'Responsividade (event loop)',
      status: p99 > 1000 ? 'fail' : p99 > 200 ? 'warn' : 'ok',
      detail: `atraso p99 ${p99} ms · pior ${max} ms${p99 > 200 ? ' — alguma operação está bloqueando o servidor' : ''}`,
    })
    sampler.loop.reset()
  }

  const sys = getSystemHealth()
  add({
    id: 'system', label: 'Recursos da máquina',
    status: sys.status === 'critical' ? 'fail' : sys.status === 'warning' ? 'warn' : 'ok',
    detail: `RAM ${sys.usedMemoryPct}% · disco ${sys.diskUsagePct}% (${(sys.diskFreeMb / 1024).toFixed(1)} GB livres)${sys.issues.length ? ` · ${sys.issues.join('; ')}` : ''}`,
  })

  const unavailable = modelHealth.snapshot().filter(e => e.unavailable)
  const cooling = modelHealth.snapshot().filter(e => !e.unavailable && e.cooldownUntil > Date.now())
  add({
    id: 'models', label: 'Modelos de IA',
    status: unavailable.some(e => e.lastKind === 'auth') ? 'warn' : 'ok',
    detail: unavailable.length || cooling.length
      ? [
          unavailable.length ? `${unavailable.length} indisponível(is): ${unavailable.slice(0, 4).map(e => `${e.model.split('|').pop()} (${e.lastKind === 'auth' ? 'chave inválida/expirada' : e.lastKind})`).join(', ')}` : '',
          cooling.length ? `${cooling.length} em pausa por limite/instabilidade (o JARVIS usa outro automaticamente)` : '',
        ].filter(Boolean).join(' · ')
      : 'Nenhuma falha registrada nesta execução',
  })

  const missing = missingDependencies()
  add({
    id: 'deps', label: 'Dependências do projeto',
    status: missing.length ? 'fail' : 'ok',
    detail: missing.length ? `Faltando em node_modules: ${missing.join(', ')}` : 'Todas as dependências declaradas estão instaladas',
    fixes: missing.length ? [{ action: 'npm-install', label: 'Rodar npm install' }] : undefined,
  })

  try {
    const buildId = path.join(process.cwd(), process.env.JARVIS_DIST_DIR || '.next', 'BUILD_ID')
    if (fs.existsSync(buildId) && process.env.NODE_ENV === 'production') {
      const stale = newestMtime(path.join(process.cwd(), 'src')) > fs.statSync(buildId).mtimeMs
      add({ id: 'build', label: 'Build de produção', status: stale ? 'warn' : 'ok', detail: stale ? 'O código mudou depois do último build: reabra o JARVIS para recompilar (automático)' : 'Build em dia com o código' })
    }
  } catch {}

  const errors = readLogs({ level: 'error', sinceMs: Date.now() - 86_400_000, limit: 500 })
  const top = new Map<string, number>()
  for (const e of errors) top.set(e.message.slice(0, 120), (top.get(e.message.slice(0, 120)) || 0) + 1)
  add({
    id: 'errors', label: 'Erros nas últimas 24 h',
    status: errors.length >= 20 ? 'warn' : 'ok',
    detail: errors.length ? `${errors.length} erro(s). Mais frequentes: ${[...top.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([m, n]) => `${n}× ${m}`).join(' | ')}` : 'Nenhum erro registrado',
  })

  const backups = listBackups().filter(b => b.source === path.resolve(dataDir()))
  const last = backups[0]
  const maxAge = Math.max(1, ctx.backupEveryHours || 24) * 2 * 3_600_000
  add({
    id: 'backup', label: 'Backups',
    status: !last ? 'warn' : last.verifyOk === false ? 'fail' : Date.now() - last.createdAt > maxAge ? 'warn' : 'ok',
    detail: !last ? 'Nenhum backup dos dados do JARVIS ainda' : `Último: ${new Date(last.createdAt).toLocaleString('pt-BR')} (${(last.size / 1048576).toFixed(1)} MB${last.encrypted ? ', criptografado' : ''})${last.verifyOk === false ? ` — FALHOU na verificação: ${last.verifyError}` : ''}`,
    fixes: !last || Date.now() - last.createdAt > maxAge || last.verifyOk === false ? [{ action: 'backup-now', label: 'Fazer backup agora' }] : undefined,
  })

  add({
    id: 'watchdog', label: 'Watchdog (autorrecuperação)',
    status: ctx.watchdogRunning ? (ctx.openIncidents ? 'warn' : 'ok') : 'fail',
    detail: ctx.watchdogRunning ? (ctx.openIncidents ? `${ctx.openIncidents} incidente(s) aberto(s)` : 'Ativo, sem incidentes abertos') : 'Parado: serviços não estão sendo monitorados',
    fixes: ctx.watchdogRunning ? undefined : [{ action: 'start-watchdog', label: 'Iniciar watchdog' }],
  })

  const major = Number(process.versions.node.split('.')[0])
  add({ id: 'node', label: 'Runtime', status: major >= 20 ? 'ok' : 'warn', detail: `Node ${process.versions.node} · ${process.platform}/${process.arch}` })

  const status: CheckStatus = checks.some(c => c.status === 'fail') ? 'fail' : checks.some(c => c.status === 'warn') ? 'warn' : 'ok'
  return { at: Date.now(), status, checks, durationMs: Date.now() - started }
}

export function cleanStaleTmp(root = dataDir()) {
  const { staleTmp } = scanData(root)
  for (const rel of staleTmp) fs.rmSync(path.join(root, rel), { force: true })
  return staleTmp.length
}
