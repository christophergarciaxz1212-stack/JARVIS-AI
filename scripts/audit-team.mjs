/**
 * Missão multiagente real contra o servidor isolado (.next-dist).
 * Cria um projeto temporário, uma equipe de 4 papéis com modelos automáticos reais,
 * acompanha a execução e grava evidência (arquivos, mensagens, revisão, relatório).
 * Uso: node scripts/audit-team.mjs
 */
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = process.cwd()
const PORT = Number(process.env.TEAM_PORT || 3012)
const BASE = `http://127.0.0.1:${PORT}`
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-team-audit-'))
const LOG_DIR = path.join(ROOT, 'data', 'audit')
const LOG_FILE = path.join(LOG_DIR, 'team.log')
const EVIDENCE = path.join(LOG_DIR, 'team.json')
const sleep = ms => new Promise(r => setTimeout(r, ms))

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

const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(PORT), '-H', '127.0.0.1'], {
  cwd: ROOT, env: { ...process.env, JARVIS_DIST_DIR: '.next-dist' }, stdio: ['ignore', 'pipe', 'pipe'],
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

/** Um socket keep-alive morto derruba um fetch isolado no polling; repetir evita abortar a missão inteira. */
async function fetchRetry(url, init, tentativas = 4) {
  let last
  for (let i = 0; i < tentativas; i++) {
    // Se o servidor morreu, repetir não adianta — falhar com a causa real.
    if (child.exitCode !== null) throw new Error(`servidor saiu com ${child.exitCode}:\n${serverLog.slice(-2000)}`)
    try { return await fetch(url, init) }
    catch (e) {
      last = e
      const causa = e?.cause?.code || e?.cause?.message || ''
      if (!/ECONNRESET|ECONNREFUSED|EPIPE|UND_ERR|fetch failed|timeout|aborted/i.test(`${e.message} ${causa}`) || i === tentativas - 1) {
        log(`fetch transitório esgotado: ${e.message} (causa=${causa || '—'})`)
        throw e
      }
      await sleep(400 * (i + 1))
    }
  }
  throw last
}

async function api(route, init) {
  const res = await fetchRetry(`${BASE}${route}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
    signal: AbortSignal.timeout(60_000),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${route} → ${res.status}: ${body.error || 'sem detalhe'}`)
  return body
}

async function ready(timeoutMs = 90_000) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    if (child.exitCode !== null) throw new Error(`servidor saiu com ${child.exitCode}:\n${serverLog.slice(-2000)}`)
    try { if ((await api('/api/teams')).teams) return } catch {}
    await sleep(500)
  }
  throw new Error(`servidor não ficou pronto em ${timeoutMs}ms:\n${serverLog.slice(-2000)}`)
}

async function main() {
  await ready()
  log(`servidor pronto; projeto temporário ${DIR}`)

  const { project } = await api('/api/projects', { method: 'POST', body: JSON.stringify({ action: 'create', name: 'Auditoria de equipe', path: DIR }) })
  const team = {
    id: '', name: 'Equipe de auditoria', description: 'Missão real de ponta a ponta',
    createdAt: Date.now(), updatedAt: Date.now(),
    agents: [
      { id: 'a-arq', roleId: 'architect', model: 'auto', scope: ['**/*'], enabled: true },
      { id: 'a-back', roleId: 'backend', model: 'auto', scope: ['**/*'], enabled: true },
      { id: 'a-front', roleId: 'frontend', model: 'auto', scope: ['**/*'], enabled: true },
      { id: 'a-qa', roleId: 'qa', model: 'auto', scope: ['**/*'], enabled: true },
    ],
  }
  const saved = await api('/api/teams', { method: 'POST', body: JSON.stringify({ action: 'save', team }) })
  log(`equipe ${saved.team.id} com ${saved.team.agents.length} agentes`)

  const request = 'Crie um site de soma de verdade: index.html com dois campos e botão, server.js exportando uma função soma(a,b) que valida números, e README.md com instruções. O backend e o frontend devem trocar mensagens sobre a rota usada e o QA deve revisar e apontar problemas antes de terminar.'
  const started = await api('/api/agents/runs', {
    method: 'POST',
    body: JSON.stringify({ projectId: project.id, teamId: saved.team.id, request, options: { maxParallel: 3, maxSteps: 10, fixRounds: 1 } }),
  })
  const id = started.run.id
  log(`run ${id} iniciado`)

  // Modelos gratuitos com cota instável e o modelo local gemma3:4b (que falha
  // JSON e força reatribuição/rodada de correção) podem levar bem mais de 20 min.
  // Matar o servidor no meio do trabalho gera falso negativo — ver audit-flows.
  const teamTimeout = Math.max(60_000, Number(process.env.TEAM_TIMEOUT_MS || 40 * 60_000))
  const deadline = Date.now() + teamTimeout
  let run = started.run
  let lastProgress = 0
  while (Date.now() < deadline) {
    run = (await api(`/api/agents/runs?id=${encodeURIComponent(id)}`)).run
    if (run.status === 'awaiting_plan') {
      log('plano esperando aprovação → aprovando automaticamente (decisão delegada pelo usuário)')
      await api(`/api/agents/runs/${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify({ action: 'plan-approve' }) })
    }
    if (Date.now() - lastProgress > 30_000) {
      lastProgress = Date.now()
      const done = (run.tasks || []).filter(t => t.status === 'done').length
      const total = (run.tasks || []).length
      log(`progresso: status=${run.status}, tarefas=${done}/${total}`)
    }
    if (!['queued', 'analyzing', 'planning', 'awaiting_plan', 'running', 'paused', 'integrating'].includes(run.status)) break
    await sleep(2000)
  }
  log(`fim do polling: status=${run.status} (orçamento=${Math.round(teamTimeout / 60_000)} min)`)

  const files = fs.readdirSync(DIR, { recursive: true }).filter(f => /\.(html|js|md)$/i.test(String(f))).map(String)
  const evidence = {
    at: new Date().toISOString(), id, status: run.status, complexity: run.complexity,
    agents: (run.agents || []).map(a => ({ role: a.roleId, configured: a.model, resolved: a.resolvedModel || a.model })),
    tasks: (run.tasks || []).map(t => ({ id: t.id, role: t.roleId, status: t.status, kind: t.kind })),
    files,
    changed: (run.changes || []).map(c => c.path),
    messages: (run.messages || []).map(m => ({ kind: m.kind, from: m.from, to: m.to })),
    report: run.report || '',
    checks: {
      completed: run.status === 'completed',
      multiAgent: (run.agents || []).length >= 2,
      realModels: (run.agents || []).length > 0 && (run.agents || []).every(a => {
        const m = a.resolvedModel || a.model
        return !!m && m !== 'auto'
      }),
      filesCreated: files.length >= 2,
      communication: (run.messages || []).some(m => ['question', 'answer', 'decision'].includes(m.kind)),
      reported: !!(run.report && run.report.length > 20),
    },
  }
  fs.writeFileSync(EVIDENCE, JSON.stringify(evidence, null, 2), 'utf-8')
  for (const [k, v] of Object.entries(evidence.checks)) log(`check ${k}=${v}`)
  log(`run ${id} → ${run.status}; arquivos=${files.join(', ') || 'nenhum'}; relatório=${run.report ? run.report.length : 0} chars`)
  log(`evidência: ${path.relative(ROOT, EVIDENCE)}`)
  if (!Object.values(evidence.checks).every(Boolean)) process.exitCode = 1
}

main().then(() => { stop(); if (!process.exitCode) process.exitCode = 0 }).catch(e => {
  const causa = e?.cause?.code || e?.cause?.message || ''
  log(`FALHA: ${e.message} (causa=${causa || '—'}; servidor=${child.exitCode ?? 'vivo'})`)
  if (serverLog) log(`servidor: ${serverLog.slice(-1200).replace(/\s+/g, ' ')}`)
  stop()
  process.exitCode = 1
})
