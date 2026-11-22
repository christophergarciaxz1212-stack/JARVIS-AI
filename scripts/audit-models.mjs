/**
 * Auditoria real de modelos contra o servidor isolado (.next-dist).
 * Uso: node scripts/audit-models.mjs
 * Variáveis: AUDIT_LEVEL (1-5, padrão 3), AUDIT_LIMIT (padrão 20), AUDIT_BATCH (padrão 3),
 * AUDIT_PORT (padrão 3011), AUDIT_MODELS (ids separados por vírgula, opcional).
 * Nenhuma chave de API é impressa ou enviada a outro modelo.
 */
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const PORT = Number(process.env.AUDIT_PORT || 3011)
const LEVEL = Math.max(1, Math.min(5, Number(process.env.AUDIT_LEVEL || 3)))
const LIMIT = Math.max(1, Number(process.env.AUDIT_LIMIT || 20))
const BATCH = Math.max(1, Number(process.env.AUDIT_BATCH || 3))
const BASE = `http://127.0.0.1:${PORT}`
const LOG_DIR = path.join(ROOT, 'data', 'audit')
const LOG_FILE = path.join(LOG_DIR, 'run.log')
const REPORT_FILE = path.join(LOG_DIR, 'report.md')
const MODELS_FILE = path.join(LOG_DIR, 'models.json')
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
// Carregar antes de qualquer await: uma falha de startup não pode apagar o relatório anterior.
results.push(...loadPrior())

function loadPrior() {
  try {
    const data = JSON.parse(fs.readFileSync(MODELS_FILE, 'utf-8'))
    return Array.isArray(data) ? data : []
  } catch { return [] }
}

/** Substitui um resultado pelo id do modelo, sem duplicar na retomada. */
function record(result) {
  const i = results.findIndex(r => r.model === result.model)
  if (i >= 0) results[i] = result
  else results.push(result)
}

if (!fs.existsSync(path.join(ROOT, '.next-dist', 'BUILD_ID'))) {
  console.error('Sem build em .next-dist. Rode: JARVIS_DIST_DIR=.next-dist npm run build')
  process.exit(1)
}
fs.mkdirSync(LOG_DIR, { recursive: true })

function log(line) {
  const out = `${new Date().toISOString()} ${line}`
  fs.appendFileSync(LOG_FILE, `${out}\n`, 'utf-8')
  console.log(out)
}

/** Grava o relatório a cada lote: uma interrupção não pode perder o que já foi medido. */
function writeReport() {
  const fmt = v => v == null ? '—' : v ? 'sim' : 'não'
  const lines = [
    '# Auditoria real de modelos',
    '',
    `Executado em ${new Date().toISOString()} — nível alvo N${LEVEL}.`,
    '',
    '| Modelo | Nível | Latência | Stream | JSON | Raciocínio | Código | Ferramentas | Erro |',
    '|---|---:|---:|---|---|---|---|---|---|',
    ...results.map(r => `| ${r.model} | ${r.reached}/${r.level} | ${r.ms} ms | ${fmt(r.capability.stream)} | ${fmt(r.capability.json)} | ${fmt(r.capability.reasoning)} | ${fmt(r.capability.code)} | ${fmt(r.capability.tools)} | ${(r.error || '—').replace(/\|/g, '\\|')} |`),
    '',
  ]
  fs.writeFileSync(REPORT_FILE, lines.join('\n'), 'utf-8')
}

const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(PORT), '-H', '127.0.0.1'], {
  cwd: ROOT,
  env: { ...process.env, JARVIS_DIST_DIR: '.next-dist' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let serverLog = ''
child.stdout.on('data', d => { serverLog += d.toString() })
child.stderr.on('data', d => { serverLog += d.toString() })

function stop() {
  if (!child.pid || child.exitCode !== null) return
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  else child.kill('SIGTERM')
}
process.on('exit', stop)
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    writeReport()
    log(`interrompido por ${sig}; relatório preservado com ${results.length} modelos`)
    stop()
    process.exit(130)
  })
}

async function ready(timeoutMs = 90_000) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    if (child.exitCode !== null) throw new Error(`servidor saiu com ${child.exitCode}:\n${serverLog.slice(-2000)}`)
    try {
      const r = await fetch(`${BASE}/api/audit`, { signal: AbortSignal.timeout(3_000) })
      if (r.ok) return
    } catch {}
    await sleep(500)
  }
  throw new Error(`servidor não ficou pronto em ${timeoutMs}ms:\n${serverLog.slice(-2000)}`)
}

async function main() {
  await ready()
  log(`servidor pronto na porta ${PORT}; alvo=N${LEVEL}, limite=${LIMIT}`)

  let ids = process.env.AUDIT_MODELS
    ? process.env.AUDIT_MODELS.split(',').map(s => s.trim()).filter(Boolean)
    : []
  if (!ids.length) {
    const res = await fetch(`${BASE}/api/models`, { signal: AbortSignal.timeout(120_000) })
    if (!res.ok) throw new Error(`/api/models respondeu ${res.status}`)
    const cat = await res.json()
    ids = cat.providers
      .filter(p => p.status === 'connected')
      .flatMap(p => p.models)
      .filter(m => m.free !== false && !/^(openai|anthropic|deepseek|xai)\|/.test(m.id))
      .map(m => m.id)
      .slice(0, LIMIT)
  }
  if (!ids.length) throw new Error('nenhum modelo gratuito disponível para auditar')

  // A rota persiste cada resultado em models.json: retomar evita repetir o que já foi medido.
  const done = new Set(results.filter(r => r.level >= LEVEL).map(r => r.model))
  const pending = ids.filter(id => !done.has(id))
  log(`retomada: ${done.size} já medidos em N${LEVEL}+, ${pending.length} restantes de ${ids.length}`)
  writeReport()
  if (!pending.length) { log('nada a fazer; relatório atualizado'); return }

  for (let i = 0; i < pending.length; i += BATCH) {
    const batch = pending.slice(i, i + BATCH)
    const res = await fetch(`${BASE}/api/audit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ models: batch, level: LEVEL }),
      signal: AbortSignal.timeout(1_800_000),
    })
    const out = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(`/api/audit respondeu ${res.status}: ${out.error || 'sem detalhe'}`)
    for (const r of out.results || []) {
      record(r)
      log(`${r.model} | ok=${r.ok} | N${r.reached}/${r.level} | ${r.ms}ms | caps=${JSON.stringify(r.capability)}${r.error ? ` | erro=${r.error}` : ''}`)
    }
    writeReport()
  }

  writeReport()
  log(`relatório: ${path.relative(ROOT, REPORT_FILE)} (${results.length} modelos)`)
}

main().then(() => { stop(); process.exitCode = 0 }).catch(e => {
  log(`FALHA: ${e.message}`)
  writeReport()
  stop()
  process.exitCode = 1
})
