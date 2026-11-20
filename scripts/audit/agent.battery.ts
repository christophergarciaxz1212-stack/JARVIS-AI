/**
 * Bateria de auditoria: 10 tarefas curtas enviadas a um servidor JARVIS em execução, pelo mesmo
 * roteamento da interface (shouldRunAgent → agente ou chat). Cada tarefa tem uma verificação objetiva.
 *
 *   BATTERY_BASE=http://127.0.0.1:3002 BATTERY_LABEL=depois npx vitest run --config scripts/audit/battery.config.mts
 *
 * Resultados: docs/auditoria/bateria-<label>.json e .md. Sessões e projeto de teste são apagados no fim.
 */
import { it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { shouldRunAgent } from '@/lib/agents/shouldRunAgent'
import { netIntent } from '@/lib/netlab/intent'

/**
 * Routing as it was before the audit (16/11, ~21:10), kept to measure the "antes" column:
 * any message starting with qual/quais/como/quanto… went to the chat, which has no tools.
 */
function preAuditRouting(text: string, hasTopology = false): boolean {
  const t = text.trim()
  if (!t || t.startsWith('/')) return false
  if (/^(oi|olá|ola|bom dia|boa tarde|boa noite|obrigad[oa]|valeu|tudo bem)\b/i.test(t) && t.length < 40) return false
  if (/^(qual|quais|quem|quando|onde|por que|porque|como|o que|quanto|quantos|me explica|explique|explica|resuma|resume|o que é|o que e)\b/i.test(t)) return false
  if (/(?:gere|gera|crie|cria|desenhe|desenha|faça|faca|monte|produza)\b[^.!?]{0,40}\b(?:imagem|foto|vídeo|video|motion|animação|animacao|logo|logotipo|wallpaper|reels|tiktok)\b/i.test(t)) return false
  if (netIntent(t, hasTopology)) return false
  if (/\b(?:sincroniz|atualiz)\w*\b.*\b(?:hub|faculdade|escolar|teams|github|calendário|calendario)\b/i.test(t)) return false
  return true
}
const route = process.env.BATTERY_ROUTER === 'pre-audit' ? preAuditRouting : shouldRunAgent

const BASE = process.env.BATTERY_BASE || 'http://127.0.0.1:3002'
const LABEL = process.env.BATTERY_LABEL || 'antes'
const OUT = path.resolve(process.env.BATTERY_OUT || 'docs/auditoria')
const TASK_TIMEOUT = Number(process.env.BATTERY_TASK_TIMEOUT || 240_000)
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

const read = (dir: string, f: string) => { try { return fs.readFileSync(path.join(dir, f), 'utf8') } catch { return '' } }
const exec = (cmd: string, args: string[], cwd: string) => spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 30_000, windowsHide: true })

interface Task { id: string; prompt: string; executable: boolean; check: (dir: string, text: string) => boolean }

const TASKS: Task[] = [
  { id: 'T1', prompt: 'Crie o arquivo notas/hoje.txt com o texto: reunião às 15h', executable: true,
    check: dir => read(dir, 'notas/hoje.txt').includes('15h') },
  { id: 'T2', prompt: 'Liste os arquivos .js deste projeto', executable: true,
    check: (_d, t) => ['app.js', 'buggy.js', 'test.js'].every(f => t.includes(f)) },
  { id: 'T3', prompt: 'Qual a versão do Node instalada neste computador?', executable: true,
    check: (_d, t) => t.includes(process.version.slice(1)) },
  { id: 'T4', prompt: 'Corrija o erro de sintaxe em buggy.js e rode node buggy.js para provar que funciona', executable: true,
    check: dir => { const r = exec('node', ['buggy.js'], dir); return r.status === 0 && r.stdout.includes('5') } },
  { id: 'T5', prompt: 'Crie fib.py que imprime os 10 primeiros números de Fibonacci e execute-o', executable: true,
    check: dir => { const r = exec('python', ['fib.py'], dir); return r.status === 0 && /\b34\b/.test(r.stdout) } },
  { id: 'T6', prompt: 'Quantas linhas tem o arquivo dados.csv?', executable: true,
    check: (_d, t) => /\b(8|oito|7|sete)\b/i.test(t) },
  { id: 'T7', prompt: 'Rode os testes do projeto com npm test e diga o resultado', executable: true,
    check: (_d, t) => /passou|passed|sucesso|ok\b|1 teste/i.test(t) },
  { id: 'T8', prompt: 'Explique em uma frase o que é DNS', executable: false,
    check: (_d, t) => t.trim().length > 20 && /dom[ií]nio|nome|endere/i.test(t) },
  { id: 'T9', prompt: 'Gere uma imagem de um gato astronauta', executable: true,
    check: (_d, t) => t.includes('/api/media?image=') },
  { id: 'T10', prompt: 'Crie um README.md para este projeto descrevendo os arquivos', executable: true,
    check: dir => /buggy\.js|app\.js/.test(read(dir, 'README.md')) },
]

// Asking permission for something the order already authorized is a defect
const ASKS_PERMISSION = /\b(posso (prosseguir|continuar|fazer|criar|executar)|devo (prosseguir|continuar)|quer que eu|deseja que eu|gostaria que eu|me (confirme|autorize)|preciso da sua (autoriza|permiss|confirma))/i

function seedProject(dir: string) {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'app.js'), "console.log('app ok')\n")
  fs.writeFileSync(path.join(dir, 'buggy.js'), 'function soma(a, b) {\n  return a + b\n\nconsole.log(soma(2, 3))\n')
  fs.writeFileSync(path.join(dir, 'dados.csv'), ['nome,idade', 'Ana,30', 'Bruno,25', 'Carla,41', 'Davi,19', 'Eva,33', 'Fabio,28', 'Gil,50'].join('\n') + '\n')
  fs.writeFileSync(path.join(dir, 'test.js'), "const assert = require('assert')\nassert.strictEqual(2 + 2, 4)\nconsole.log('1 teste passou')\n")
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'bateria', version: '1.0.0', scripts: { test: 'node test.js' } }, null, 2))
}

async function api<T>(p: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${p}`, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return res.json() as Promise<T>
}

interface RunView {
  status: string
  sessionId: string
  report?: string
  error?: string
  changes: unknown[]
  agents: Array<{ model?: string }>
}
type Ev = { type: string; message: string }

async function viaAgent(prompt: string, projectId: string) {
  const { run, error } = await api<{ run?: RunView & { id: string }; error?: string }>('/api/agents/runs', {
    agentMode: true, projectId, request: prompt, teamId: 'preset-solo',
    options: { maxSteps: 10, maxParallel: 1, fixRounds: 0, autoFallback: true },
  })
  if (!run) return { text: `ERRO: ${error}`, sessionId: '', status: 'erro', tools: 0, commands: 0, changes: 0, models: [] as string[] }
  const started = Date.now()
  let view: RunView = run
  let events: Ev[] = []
  while (Date.now() - started < TASK_TIMEOUT) {
    await sleep(2500)
    const d = await api<{ run: RunView; events: Ev[] }>(`/api/agents/runs?id=${run.id}`)
    if (d.run) { view = d.run; events = d.events || [] }
    if (['completed', 'failed', 'cancelled', 'interrupted', 'paused'].includes(view.status)) break
  }
  if (!['completed', 'failed', 'cancelled', 'interrupted', 'paused'].includes(view.status)) {
    await api('/api/sessions', { action: 'stop', ids: [run.sessionId] })
    view = { ...view, status: 'tempo esgotado' }
  }
  const outputs = events.filter(e => e.type === 'command_result' || e.type === 'command_output').map(e => e.message).join('\n')
  return {
    text: `${view.report || view.error || ''}\n${outputs}`,
    sessionId: run.sessionId,
    status: view.status,
    tools: events.filter(e => e.type === 'tool').length,
    commands: events.filter(e => e.type === 'command').length,
    changes: view.changes?.length || 0,
    models: [...new Set(view.agents.map(a => a.model).filter((m): m is string => !!m))],
  }
}

async function viaChat(prompt: string) {
  const res = await fetch(`${BASE}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: prompt }) })
  const raw = await res.text()
  let text = ''
  let conversationId = ''
  let model = ''
  let error = ''
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data: ')) continue
    try {
      const d = JSON.parse(line.slice(6))
      if (d.conversationId) conversationId = d.conversationId
      if (d.type === 'chunk') text += d.content
      if (d.type === 'done') model = d.model
      if (d.type === 'error') error = d.message
    } catch {}
  }
  // Deterministic runners (media, Skill Engine, Hub) really execute on the server
  const ranTool = model === 'jarvis-engine'
  return { text: text || `ERRO: ${error}`, sessionId: conversationId, status: error ? 'erro' : 'respondeu', tools: ranTool ? 1 : 0, commands: 0, changes: 0, models: model ? [model] : [] }
}

it(`bateria (${LABEL})`, async () => {
  const dir = path.join(os.tmpdir(), `jarvis-bateria-${LABEL}-${Date.now()}`)
  seedProject(dir)
  const { project } = await api<{ project: { id: string } }>('/api/projects', { action: 'create', name: `Bateria ${LABEL}`, path: dir })
  const rows: Array<Record<string, unknown>> = []
  const sessions: string[] = []
  try {
    const only = process.env.BATTERY_ONLY?.split(',')
    for (const t of TASKS.filter(x => !only || only.includes(x.id))) {
      const rota = route(t.prompt) ? 'agente' : 'chat'
      const started = Date.now()
      const r = rota === 'agente' ? await viaAgent(t.prompt, project.id) : await viaChat(t.prompt)
      if (r.sessionId) sessions.push(r.sessionId)
      const executed = r.tools + r.commands + r.changes > 0
      const row = {
        id: t.id, prompt: t.prompt, rota, executavel: t.executable,
        executou: executed, ferramentas: r.tools + r.commands, arquivos: r.changes,
        artefato_verificado: t.check(dir, r.text), pediu_permissao: ASKS_PERMISSION.test(r.text),
        status: r.status, modelos: r.models, segundos: Math.round((Date.now() - started) / 1000),
        resposta: r.text.replace(/\s+/g, ' ').trim().slice(0, 300),
      }
      rows.push(row)
      console.log(`${t.id} ${rota.padEnd(6)} executou=${executed} artefato=${row.artefato_verificado} permissão=${row.pediu_permissao} ${row.status} ${row.segundos}s ${r.models.join(',')}`)
    }
  } finally {
    if (sessions.length) await api('/api/sessions', { action: 'delete', ids: sessions, confirm: true })
    await api('/api/projects', { action: 'remove', id: project.id })
    fs.mkdirSync(OUT, { recursive: true })
    fs.writeFileSync(path.join(OUT, `bateria-${LABEL}.json`), JSON.stringify({ label: LABEL, base: BASE, at: new Date().toISOString(), rows }, null, 2))
    const md = [
      `| Tarefa | Rota | Executou | Ferramentas | Artefato verificado | Pediu permissão | Status | Tempo |`,
      `|---|---|---|---|---|---|---|---|`,
      ...rows.map(r => `| ${r.id} ${String(r.prompt).slice(0, 48)} | ${r.rota} | ${r.executou ? 'sim' : 'não'} | ${r.ferramentas} | ${r.artefato_verificado ? 'sim' : 'não'} | ${r.pediu_permissao ? 'sim' : 'não'} | ${r.status} | ${r.segundos}s |`),
    ].join('\n')
    fs.writeFileSync(path.join(OUT, `bateria-${LABEL}.md`), md + '\n')
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
