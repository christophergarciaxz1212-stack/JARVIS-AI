/**
 * Validação real dos fluxos prompt → site/software, rede e vídeo.
 * Usa o servidor isolado (.next-dist) e grava evidência em data/audit/flows.json.
 * Uso: node scripts/audit-flows.mjs
 */
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const PORT = Number(process.env.FLOWS_PORT || 3013)
const BASE = `http://127.0.0.1:${PORT}`
const DIR = path.join(ROOT, 'data', 'audit')
const LOG = path.join(DIR, 'flows.log')
const OUT = path.join(DIR, 'flows.json')
const sleep = ms => new Promise(r => setTimeout(r, ms))

if (!fs.existsSync(path.join(ROOT, '.next-dist', 'BUILD_ID'))) {
  console.error('Sem build em .next-dist. Rode: JARVIS_DIST_DIR=.next-dist npm run build')
  process.exit(1)
}
fs.mkdirSync(DIR, { recursive: true })
function log(line) {
  const out = `${new Date().toISOString()} ${line}`
  fs.appendFileSync(LOG, `${out}\n`, 'utf-8')
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

/** Um socket keep-alive morto derruba um fetch isolado; repetir evita abortar a auditoria inteira. */
async function fetchRetry(url, init, tentativas = 4) {
  let last
  for (let i = 0; i < tentativas; i++) {
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
    signal: AbortSignal.timeout(300_000),
  })
  const text = await res.text()
  let body
  try { body = JSON.parse(text) } catch { body = text }
  if (!res.ok) throw new Error(`${route} → ${res.status}: ${typeof body === 'string' ? body.slice(0, 300) : body.error}`)
  return body
}

async function ready(timeoutMs = 90_000) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    if (child.exitCode !== null) throw new Error(`servidor saiu com ${child.exitCode}: ${serverLog.slice(-1500)}`)
    try { if ((await api('/api/teams')).teams) return } catch {}
    await sleep(500)
  }
  throw new Error(`servidor não ficou pronto em ${timeoutMs}ms: ${serverLog.slice(-1500)}`)
}

const evidence = { at: new Date().toISOString(), checks: {}, artifacts: {} }

async function chat(route, message) {
  const res = await fetchRetry(`${BASE}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message }),
    signal: AbortSignal.timeout(300_000),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`/api/chat → ${res.status}: ${text.slice(0, 300)}`)
  return text
}

async function main() {
  await ready()
  log('servidor pronto')

  // 1) Site/software: o chat usa o cliente real; a missão completa de equipe é validada por audit-team.mjs.
  const site = await chat('/api/chat', 'Explique em uma frase como gerar um site com o JARVIS. Responda curto.')
  evidence.checks.chat = site.length > 40
  evidence.artifacts.chatChars = site.length
  log(`chat: ${site.length} chars recebidos via SSE`)

  // 2) Rede: o comando de design chama um modelo real e grava a topologia.
  const net = await chat('/api/chat', 'Crie uma topologia de rede com um roteador, dois switches e três estações.')
  const match = net.match(/\[\[topology:([^\]]+)\]\]/)
  evidence.checks.netlab = !!match
  if (match) {
    evidence.artifacts.topologyId = match[1]
    const t = await api(`/api/netlab?action=get&id=${encodeURIComponent(match[1])}`)
    evidence.artifacts.topologyNodes = (t.topology?.nodes || []).length
    evidence.checks.netlabTopology = evidence.artifacts.topologyNodes > 0
    const svg = await fetchRetry(`${BASE}/api/netlab?action=svg&id=${encodeURIComponent(match[1])}`)
    evidence.checks.netlabSvg = svg.ok && (svg.headers.get('content-type') || '').includes('svg')
    log(`rede: topologia ${match[1]} com ${evidence.artifacts.topologyNodes} nós; SVG=${evidence.checks.netlabSvg}`)
  } else {
    log('rede: nenhum marcador [[topology:...]] na resposta')
  }

  // 3) Vídeo/animação: job real do estúdio.
  const { job } = await api('/api/studio', {
    method: 'POST',
    body: JSON.stringify({ action: 'create', prompt: 'Um farol na tempestade, ondas batendo nas rochas, amanhecer', seconds: 5, aspect: '16:9', narration: false, captions: false }),
  })
  evidence.artifacts.studioJob = job.id
  let j = job
  // O roteiro usa LLM gratuito (pode levar ~6 min) e as imagens do Pollinations
  // são serializadas a 1 por 45 s; matar o servidor antes do render derruba o
  // Chrome e produz "Unable to capture screenshot" — um falso negativo.
  const studioTimeout = Math.max(60_000, Number(process.env.FLOWS_STUDIO_TIMEOUT_MS || 25 * 60_000))
  const end = Date.now() + studioTimeout
  let lastLog = 0
  while (Date.now() < end) {
    j = (await api(`/api/studio?action=job&id=${encodeURIComponent(job.id)}`)).job || j
    if (!['queued', 'running', 'pending'].includes(String(j.status))) break
    if (Date.now() - lastLog > 30_000) {
      const etapa = (j.stages || []).find(s => s.status === 'executando')
      log(`vídeo: ainda ${j.status} · ${etapa ? `${etapa.id}: ${etapa.detail}` : 'aguardando'}`)
      lastLog = Date.now()
    }
    await sleep(2000)
  }
  evidence.artifacts.studioStatus = j.status
  evidence.checks.studio = ['done', 'completed', 'ready'].includes(String(j.status))
  // Status "done" sem arquivo não é entrega: exigir MP4 real e não trivial.
  const videoPath = path.join(ROOT, 'data', 'studio', job.id, 'video.mp4')
  const videoBytes = fs.existsSync(videoPath) ? fs.statSync(videoPath).size : 0
  evidence.artifacts.videoBytes = videoBytes
  evidence.checks.videoFile = videoBytes > 100_000
  log(`vídeo: job ${job.id} → ${j.status}; video.mp4=${videoBytes} bytes`)

  const ok = Object.values(evidence.checks).every(Boolean)
  fs.writeFileSync(OUT, JSON.stringify(evidence, null, 2), 'utf-8')
  log(`evidência: ${path.relative(ROOT, OUT)}; checks=${JSON.stringify(evidence.checks)}`)
  if (!ok) process.exitCode = 1
}

main().then(() => { stop(); if (!process.exitCode) process.exitCode = 0 }).catch(e => {
  log(`FALHA: ${e.message}`)
  fs.writeFileSync(OUT, JSON.stringify({ ...evidence, error: e.message }, null, 2), 'utf-8')
  stop()
  process.exitCode = 1
})
