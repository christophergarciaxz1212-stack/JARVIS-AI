import fs from 'fs'
import path from 'path'
import os from 'os'
import { IGNORED_DIRS, matchesAny, matchesScope, resolveInside, toRel, writeJsonAtomic } from './fsutil'
import { isSafeAgentCommand, isSafeCommand, runCommand } from '../shell'
import type { FileLockManager } from './locks'
import type { AgentRuntimeState, AgentTask, MessageKind, TaskIssue } from './types'
import type { ToolAction } from './parse'
import { getEngine } from '../engine/engine'
import type { Extension } from '../engine/types'
import { buildSpreadsheet, buildReportPdf } from '../docs/generate'
import { collectInfraSections, infraSummaryMarkdown } from '../docs/infra'
import { generateImage } from '../media/images'
import { gitBranch, gitCommit, gitDiff, gitLog, gitStatus } from './git'
import { formatSearch, webFetch, webSearch } from './web'
import { appendMemory, readMemory, writeMemory } from './projectMemory'
import { INFRA_ARG_ALIASES, INFRA_TOOL_DOCS, INFRA_TOOL_SPECS, executeInfraTool, isInfraTool } from '../infra/agentTools'
import { SOCIAL_TOOL_DOCS, SOCIAL_TOOL_SPECS, executeSocialTool, isSocialTool } from '../social/agentTools'

export function describeExtension(e: Extension) {
  const tools = e.tools.length ? `ferramentas: ${e.tools.slice(0, 10).map(t => `${t.name} (${t.description.slice(0, 60)})`).join('; ')}` : e.skills?.length ? `${e.skills.length} skills — use skill_read` : 'instruções — use skill_read'
  return `- ${e.id} [${e.kind}${e.status !== 'ok' ? `, ${e.status}` : ''}]: ${e.description.slice(0, 140)} | ${tools}`
}

export const TOOL_DOCS = `Ferramentas disponíveis (use o nome exato em "tool"):
- list_dir {"path": ".", "depth": 2} → lista pastas/arquivos do projeto
- read_file {"path": "src/a.ts", "start_line": 1, "end_line": 200} → lê um arquivo (linhas opcionais)
- search {"query": "texto", "path": "src"} → procura texto nos arquivos do projeto
- write_file {"path": "src/a.ts", "content": "conteúdo COMPLETO do arquivo"} → cria ou substitui um arquivo
- edit_file {"path": "src/a.ts", "old_text": "trecho exato atual", "new_text": "novo trecho"} → troca um trecho que aparece uma única vez
- run_command {"command": "npm test", "timeout_sec": 120} → executa um comando PowerShell na pasta do projeto (para CRIAR ou EDITAR arquivos use write_file/edit_file: criam as pastas e gravam em UTF-8; echo/Set-Content no PowerShell 5 grava UTF-16 e falha sem a pasta)
- send_message {"to": "backend | id-do-agente | all | user", "kind": "info|question|problem|review_request|decision", "content": "..."} → fala com outro agente, com a equipe ou com o usuário
- delegate {"to": "frontend", "title": "...", "description": "...", "files": ["src/x.tsx"]} → cria uma subtarefa para outro agente
- request_scope {"path": "src/outro.ts", "reason": "..."} → pede autorização para alterar arquivo fora do seu escopo
- skill_find {"query": "editar vídeo"} → lista Skills/Plugins/MCP instalados úteis para isso (com as ferramentas de cada um)
- skill_use {"extension": "id", "tool": "nome", "args": {...}} → executa uma ferramenta de uma extensão instalada (MCP ou script)
- skill_read {"extension": "id", "skill": "nome opcional"} → lê as instruções de uma Skill (SKILL.md) para seguir
- skill_request {"need": "o que falta"} → o JARVIS procura, analisa e instala uma ferramenta para essa necessidade (ou pede aprovação ao usuário)
- hub_search {"query": "trabalho de banco de dados", "source": "whatsapp|teams|portal|github|chatgpt|gemini (opcional)"} → busca no Hub Escolar com a origem de cada resultado
- hub_course {"course": "Banco de Dados"} → dossiê da disciplina (tarefas, provas, mensagens do professor, materiais, notas)
- hub_tasks {"range": "semana|mes|todas|atrasadas"} → trabalhos e provas com prazos
- hub_add_task {"course": "...", "title": "...", "due": "YYYY-MM-DD", "description": "...", "type": "trabalho|atividade|prova"} → registra trabalho ou prova
- hub_complete_task {"task": "título ou id"} → marca uma tarefa como concluída
- hub_save_study {"course": "...", "kind": "resumo|exercicios|revisao|explicacao|pesquisa", "title": "...", "content": "markdown"} → salva no histórico de estudos
- remember_project {"field": "decisao|pendencia", "text": "..."} → anota na memória DESTE projeto (fica para as próximas conversas). Use quando tomar uma decisão técnica ou deixar algo para depois.
- update_project_memory {"objetivo": "...", "arquitetura": "...", "tecnologias": "...", "convencoes": "...", "preferencias": "..."} → atualiza o que você aprendeu sobre o projeto (mande só os campos que mudaram)
- web_search {"query": "o que procurar", "limit": 5} → procura na web e devolve título, link e resumo de cada resultado
- web_fetch {"url": "https://..."} → abre uma página e devolve o texto dela (use depois do web_search para ler a fonte)
- git_status {} → branch atual e arquivos alterados no repositório do projeto
- git_diff {"file": "src/a.ts (opcional)", "staged": false} → o que mudou, em formato de diff
- git_log {"limit": 20} → commits recentes (hash, autor, quando, mensagem)
- git_branch {} → branches locais, com a atual marcada
- git_commit {"message": "mensagem", "files": ["src/a.ts"]} → cria um commit (sem "files" commita tudo que está alterado). Precisa de autorização do usuário.
- github_read {"repo": "dono/repo", "path": "opcional"} → lista arquivos do repositório ou lê um arquivo
- local_businesses {"where": "Savassi, Belo Horizonte", "category": "padarias (opcional; vazio = todas)", "radius_m": 1500, "only_no_site": false} → empresas e comércios próximos (OpenStreetMap): nome, categoria, telefone, WhatsApp, site, e-mail, Instagram, endereço, distância e pontuação de lead (sem site = oportunidade)
- create_spreadsheet {"name": "Nome da planilha", "sheets": [{"name": "Aba 1", "headers": ["Coluna A", "Coluna B"], "rows": [["x", 1], ["y", 2]], "totals": true}]} → gera um arquivo .xlsx REAL para o usuário baixar
- create_report {"title": "Título", "subtitle": "opcional", "sections": [{"heading": "Seção", "body": "texto, pode ter # subtítulos e - bullets"}], "cover": "descrição para capa gerada por IA (opcional)"} → gera um PDF de relatório profissional
- infra_report {} → coleta e gera um PDF com o relatório completo da infraestrutura (PC, Node, provedores de IA, engine, vídeos, dados) + resumo no chat${INFRA_TOOL_DOCS}${SOCIAL_TOOL_DOCS}
- hub_request_action {"type": "teams-message|whatsapp-message|github-issue|github-commit", ...} → pede ao usuário para aprovar uma ação externa (nada é enviado sem aprovação)
- finish {"summary": "o que foi feito; se o pedido era uma pergunta, a resposta com o valor obtido (ex.: Node v22.1.0)", "status": "done|issues", "issues": [{"description": "...", "role": "backend"}]} → encerra sua tarefa`

export interface ToolSpec {
  name: string
  description: string
  parameters: Record<string, unknown>
}

const obj = (properties: Record<string, unknown>, required: string[]) => ({ type: 'object', properties, required })
const s = (description: string) => ({ type: 'string', description })

/** The same tools as native function definitions, for models trained on function calling (gpt-oss). */
export const TOOL_SPECS: ToolSpec[] = [
  { name: 'list_dir', description: 'Lista pastas e arquivos do projeto', parameters: obj({ path: s('Pasta relativa à raiz'), depth: { type: 'integer' } }, []) },
  { name: 'read_file', description: 'Lê um arquivo do projeto', parameters: obj({ path: s('Caminho relativo'), start_line: { type: 'integer' }, end_line: { type: 'integer' } }, ['path']) },
  { name: 'search', description: 'Procura texto nos arquivos do projeto', parameters: obj({ query: s('Texto a procurar'), path: s('Pasta (opcional)') }, ['query']) },
  { name: 'write_file', description: 'Cria ou substitui um arquivo com o conteúdo COMPLETO', parameters: obj({ path: s('Caminho relativo'), content: s('Conteúdo completo') }, ['path', 'content']) },
  { name: 'edit_file', description: 'Troca um trecho exato (único) de um arquivo', parameters: obj({ path: s('Caminho relativo'), old_text: s('Trecho atual exato'), new_text: s('Novo trecho') }, ['path', 'old_text', 'new_text']) },
  { name: 'run_command', description: 'Executa um comando PowerShell na pasta do projeto', parameters: obj({ command: s('Comando'), timeout_sec: { type: 'integer' } }, ['command']) },
  { name: 'send_message', description: 'Envia mensagem a um agente (id ou papel), à equipe (all) ou ao usuário (user)', parameters: obj({ to: s('Destinatário'), kind: { type: 'string', enum: ['info', 'question', 'problem', 'review_request', 'decision'] }, content: s('Mensagem') }, ['to', 'content']) },
  { name: 'delegate', description: 'Cria uma subtarefa para outro agente', parameters: obj({ to: s('Id ou papel'), title: s('Título'), description: s('O que fazer'), files: { type: 'array', items: { type: 'string' } } }, ['to', 'title']) },
  { name: 'request_scope', description: 'Pede ao usuário autorização para alterar um arquivo fora do seu escopo', parameters: obj({ path: s('Caminho'), reason: s('Motivo') }, ['path']) },
  { name: 'skill_find', description: 'Lista Skills/Plugins/MCP instalados úteis para uma necessidade', parameters: obj({ query: s('Necessidade') }, ['query']) },
  { name: 'skill_use', description: 'Executa uma ferramenta de uma extensão instalada', parameters: obj({ extension: s('Id da extensão'), tool: s('Nome da ferramenta'), args: { type: 'object' } }, ['extension', 'tool']) },
  { name: 'skill_read', description: 'Lê as instruções (SKILL.md) de uma Skill instalada', parameters: obj({ extension: s('Id da extensão'), skill: s('Nome da skill dentro de uma coleção (opcional)') }, ['extension']) },
  { name: 'skill_request', description: 'Pede ao JARVIS para encontrar e instalar uma ferramenta para uma necessidade', parameters: obj({ need: s('O que falta') }, ['need']) },
  { name: 'local_businesses', description: 'Empresas e comércios próximos a um endereço/bairro/cidade (OpenStreetMap), com contatos e pontuação de lead', parameters: obj({ where: s('Endereço, bairro e cidade'), category: s('Categoria (ex.: padarias, academias); vazio = todas'), radius_m: { type: 'integer' }, only_no_site: { type: 'boolean' } }, ['where']) },
  { name: 'hub_search', description: 'Busca no Hub Escolar (mensagens, portal, Teams, GitHub, históricos de IA) com a origem de cada resultado', parameters: obj({ query: s('O que procurar'), source: s('Fonte opcional') }, ['query']) },
  { name: 'hub_course', description: 'Dossiê de uma disciplina', parameters: obj({ course: s('Nome da disciplina') }, ['course']) },
  { name: 'hub_tasks', description: 'Trabalhos e provas com prazos', parameters: obj({ range: { type: 'string', enum: ['semana', 'mes', 'todas', 'atrasadas'] } }, []) },
  { name: 'hub_add_task', description: 'Registra um trabalho ou prova', parameters: obj({ course: s('Disciplina'), title: s('Título'), due: s('YYYY-MM-DD'), description: s('Detalhes'), type: { type: 'string', enum: ['trabalho', 'atividade', 'prova'] } }, ['title']) },
  { name: 'hub_complete_task', description: 'Marca uma tarefa como concluída', parameters: obj({ task: s('Título ou id') }, ['task']) },
  { name: 'hub_save_study', description: 'Salva resumo/exercícios/revisão no histórico de estudos', parameters: obj({ course: s('Disciplina'), kind: { type: 'string', enum: ['resumo', 'exercicios', 'revisao', 'explicacao', 'pesquisa'] }, title: s('Título'), content: s('Conteúdo em Markdown') }, ['title', 'content']) },
  { name: 'remember_project', description: 'Anota uma decisão técnica ou pendência na memória deste projeto', parameters: obj({ field: { type: 'string', enum: ['decisao', 'pendencia'] }, text: s('O que registrar') }, ['field', 'text']) },
  { name: 'update_project_memory', description: 'Atualiza o que o JARVIS sabe sobre este projeto', parameters: obj({ objetivo: s('Para que serve'), arquitetura: s('Como está montado'), tecnologias: s('Linguagens e frameworks'), convencoes: s('Padrões de código'), preferencias: s('Preferências do usuário') }, []) },
  { name: 'web_search', description: 'Procura na web e devolve título, link e resumo', parameters: obj({ query: s('O que procurar'), limit: { type: 'integer', description: 'Quantos resultados (1 a 10)' } }, ['query']) },
  { name: 'web_fetch', description: 'Abre uma página da web e devolve o texto legível', parameters: obj({ url: s('Endereço http/https') }, ['url']) },
  { name: 'git_status', description: 'Branch atual e arquivos alterados no repositório do projeto', parameters: obj({}, []) },
  { name: 'git_diff', description: 'Diff das alterações não commitadas (ou do índice)', parameters: obj({ file: s('Arquivo específico (opcional)'), staged: { type: 'boolean', description: 'Diff do que já está no índice' } }, []) },
  { name: 'git_log', description: 'Commits recentes do repositório', parameters: obj({ limit: { type: 'integer', description: 'Quantos commits (padrão 20)' } }, []) },
  { name: 'git_branch', description: 'Lista as branches locais', parameters: obj({}, []) },
  { name: 'git_commit', description: 'Cria um commit com a mensagem dada', parameters: obj({ message: s('Mensagem do commit'), files: { type: 'array', items: { type: 'string' }, description: 'Arquivos; vazio = tudo que está alterado' } }, ['message']) },
  { name: 'github_read', description: 'Lista arquivos de um repositório do GitHub ou lê um arquivo', parameters: obj({ repo: s('dono/repo'), path: s('Arquivo (opcional)') }, ['repo']) },
  { name: 'create_spreadsheet', description: 'Gera um arquivo .xlsx REAL para o usuário baixar', parameters: obj({ name: s('Nome da planilha'), sheets: { type: 'array', items: obj({ name: s('Nome da aba'), headers: { type: 'array', items: { type: 'string' } }, rows: { type: 'array', items: { type: 'array' } }, totals: { type: 'boolean' } }, ['headers', 'rows']) } }, ['sheets']) },
  { name: 'create_report', description: 'Gera um PDF de relatório profissional', parameters: obj({ title: s('Título'), subtitle: s('Subtítulo (opcional)'), sections: { type: 'array', items: obj({ heading: s('Seção'), body: s('Conteúdo (aceita Markdown simples, # subtítulos e - bullets)') }, ['heading', 'body']) }, cover: s('Descrição para capa gerada por IA (opcional)') }, ['title', 'sections']) },
  { name: 'infra_report', description: 'Coleta e gera PDF do relatório de infraestrutura (PC, provedores, engine, dados)', parameters: obj({}, []) },
  ...INFRA_TOOL_SPECS,
  ...SOCIAL_TOOL_SPECS,
  { name: 'hub_request_action', description: 'Pede aprovação do usuário para enviar mensagem (Teams/WhatsApp) ou criar issue/commit no GitHub', parameters: obj({ type: { type: 'string', enum: ['teams-message', 'whatsapp-message', 'github-issue', 'github-commit'] }, text: s('Mensagem'), chatId: s('Chat do Teams'), phone: s('Telefone do WhatsApp'), repo: s('dono/repo'), title: s('Título da issue'), body: s('Corpo da issue'), path: s('Arquivo'), content: s('Conteúdo do arquivo'), message: s('Mensagem do commit') }, ['type']) },
  { name: 'finish', description: 'Encerra a tarefa com um resumo', parameters: obj({ summary: s('O que foi feito; se o pedido era uma pergunta, a resposta com o valor obtido'), status: { type: 'string', enum: ['done', 'issues'] }, issues: { type: 'array', items: obj({ description: s('Problema'), role: s('Papel responsável') }, ['description']) } }, ['summary']) },
]

// Parameter names models commonly use instead of ours
const ARG_ALIASES: Record<string, Record<string, string[]>> = {
  '*': { path: ['file_path', 'filePath', 'file', 'filename', 'arquivo', 'caminho'] },
  write_file: { content: ['text', 'code', 'contents', 'conteudo', 'data'] },
  edit_file: { old_text: ['oldText', 'old', 'old_string', 'search', 'find', 'original'], new_text: ['newText', 'new', 'new_string', 'replace', 'replacement'] },
  run_command: { command: ['cmd', 'comando', 'script'] },
  search: { query: ['pattern', 'q', 'text', 'term'] },
  send_message: { to: ['recipient', 'para', 'agent'], content: ['message', 'text', 'mensagem'] },
  read_file: { start_line: ['startLine', 'from'], end_line: ['endLine', 'to'] },
  skill_use: { extension: ['ext', 'extension_id', 'id', 'skill', 'plugin', 'server'], tool: ['tool_name', 'name', 'function'], args: ['arguments', 'input', 'params'] },
  skill_read: { extension: ['ext', 'extension_id', 'id'] },
  skill_find: { query: ['need', 'q', 'text'] },
  skill_request: { need: ['query', 'description', 'what'] },
  ...INFRA_ARG_ALIASES,
}

export function normalizeArgs(tool: string, args: Record<string, unknown>) {
  const out = { ...args }
  for (const table of [ARG_ALIASES['*'], ARG_ALIASES[tool] || {}]) {
    for (const [canonical, aliases] of Object.entries(table)) {
      if (out[canonical] !== undefined) continue
      const hit = aliases.find(a => out[a] !== undefined)
      if (hit) out[canonical] = out[hit]
    }
  }
  return out
}

export interface ToolHost {
  root: string
  runId: string
  /** Projeto a que esta execução pertence — endereça a memória de projeto. */
  projectId: string
  agent: AgentRuntimeState
  task: AgentTask
  signal: AbortSignal
  locks: FileLockManager
  snapshotDir: string
  /** Scope granted on top of the role scope (task files + approved requests). */
  extraScope(): string[]
  /**
   * O usuário aprovou ESTA chamada na conversa. Libera o que o agente não faz
   * sozinho (apagar, reescrever histórico do Git), mas nunca o que destrói a
   * máquina — esse piso não é aprovável.
   */
  approvedByUser?: boolean
  recordChange(rel: string, action: 'created' | 'modified', added: number, removed: number): void
  sendMessage(to: string, kind: MessageKind, content: string): string
  delegate(to: string, title: string, description: string, files: string[]): string
  requestScope(rel: string, reason: string): string
  log(type: string, message: string, data?: Record<string, unknown>, level?: 'info' | 'warn' | 'error'): void
}

export interface FinishResult {
  summary: string
  status: 'done' | 'issues'
  issues: TaskIssue[]
}

const MAX_READ = 24_000
const TEXT_LIMIT = 1_000_000

function str(v: unknown, name: string): string {
  if (typeof v !== 'string' || !v.length) throw new Error(`Parâmetro "${name}" é obrigatório`)
  return v
}

export function lockOwner(runId: string, agentId: string) {
  return `${runId}:${agentId}`
}

function lineDelta(before: string, after: string) {
  const count = (s: string) => {
    const m = new Map<string, number>()
    for (const l of s.split('\n')) m.set(l, (m.get(l) || 0) + 1)
    return m
  }
  const a = count(before)
  const b = count(after)
  let added = 0
  let removed = 0
  for (const [l, n] of b) added += Math.max(0, n - (a.get(l) || 0))
  for (const [l, n] of a) removed += Math.max(0, n - (b.get(l) || 0))
  return { added, removed }
}

/** Explicit grants (plan files, approved requests) win over the role scope and its exclusions. */
/** Modelos de configuração sem segredo: qualquer agente pode criar (o .env de verdade continua protegido). */
const SHARED_CONFIG = /(^|\/)\.env\.(example|sample|template)$/i

export function canWrite(host: Pick<ToolHost, 'agent' | 'extraScope'>, rel: string) {
  return SHARED_CONFIG.test(rel.replace(/\\/g, '/')) || matchesAny(rel, host.extraScope()) || matchesScope(rel, host.agent.scope)
}

/** Saves the original before a run first modifies a file, so the run can be rolled back. */
function snapshot(host: ToolHost, abs: string, rel: string) {
  const manifestFile = path.join(host.snapshotDir, 'manifest.json')
  let manifest: Record<string, boolean> = {}
  try { manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf-8')) } catch {}
  if (rel in manifest) return
  const existed = fs.existsSync(abs)
  if (existed) {
    const dest = path.join(host.snapshotDir, 'files', rel)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(abs, dest)
  }
  manifest[rel] = existed
  writeJsonAtomic(manifestFile, manifest)
}

/** Restores every file a run touched: originals come back, files the run created are removed. */
export function rollbackSnapshots(root: string, snapshotDir: string) {
  const manifestFile = path.join(snapshotDir, 'manifest.json')
  if (!fs.existsSync(manifestFile)) return { restored: 0, removed: 0 }
  const manifest: Record<string, boolean> = JSON.parse(fs.readFileSync(manifestFile, 'utf-8'))
  let restored = 0
  let removed = 0
  for (const [rel, existed] of Object.entries(manifest)) {
    const abs = resolveInside(root, rel)
    if (existed) {
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      fs.copyFileSync(path.join(snapshotDir, 'files', rel), abs)
      restored++
    } else if (fs.existsSync(abs)) {
      fs.unlinkSync(abs)
      removed++
    }
  }
  return { restored, removed }
}

async function writeGuarded(host: ToolHost, relInput: string, produce: (current: string | null) => string) {
  const abs = resolveInside(host.root, relInput)
  const rel = toRel(host.root, abs)
  if (!canWrite(host, rel)) {
    const envHint = /(^|[\\/])\.env$/i.test(rel) ? ' O .env guarda segredos: crie ".env.example" com os nomes das variáveis (qualquer agente pode) e deixe o usuário preencher o .env.' : ''
    throw new Error(`"${rel}" está fora do seu escopo (${host.agent.scope.join(', ') || 'somente leitura'}).${envHint} Para outro arquivo, use request_scope ou peça a outro agente via send_message.`)
  }
  const holder = host.locks.holder(abs)
  if (holder && holder.owner !== lockOwner(host.runId, host.agent.id)) {
    host.log('lock_wait', `Aguardando ${holder.label} liberar ${rel}`, { path: rel })
  }
  await host.locks.acquire(abs, lockOwner(host.runId, host.agent.id), host.agent.name, { timeoutMs: 90_000, signal: host.signal })
  const current = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf-8') : null
  const next = produce(current)
  snapshot(host, abs, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  // Atomic replace so a crash mid-write never leaves a truncated source file
  const tmp = path.join(path.dirname(abs), `.${path.basename(abs)}.${process.pid}.${Date.now()}.tmp`)
  fs.writeFileSync(tmp, next, 'utf-8')
  fs.renameSync(tmp, abs)
  const { added, removed } = lineDelta(current ?? '', next)
  host.recordChange(rel, current === null ? 'created' : 'modified', added, removed)
  return { rel, added, removed, created: current === null }
}

function listDir(root: string, rel: string, depth: number) {
  const base = resolveInside(root, rel)
  const out: string[] = []
  const walk = (dir: string, d: number, prefix: string) => {
    if (out.length > 300) return
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    for (const e of entries) {
      if (IGNORED_DIRS.has(e.name)) continue
      out.push(`${prefix}${e.name}${e.isDirectory() ? '/' : ''}`)
      if (e.isDirectory() && d < depth) walk(path.join(dir, e.name), d + 1, prefix + '  ')
    }
  }
  walk(base, 1, '')
  return out.length ? out.join('\n') + (out.length > 300 ? '\n…(lista truncada)' : '') : '(pasta vazia)'
}

function search(root: string, query: string, rel: string) {
  const base = resolveInside(root, rel || '.')
  const q = query.toLowerCase()
  const hits: string[] = []
  const walk = (dir: string) => {
    if (hits.length >= 60) return
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (hits.length >= 60) return
      if (IGNORED_DIRS.has(e.name) || e.isSymbolicLink()) continue
      const abs = path.join(dir, e.name)
      if (e.isDirectory()) { walk(abs); continue }
      let text: string
      try {
        if (fs.statSync(abs).size > TEXT_LIMIT) continue
        text = fs.readFileSync(abs, 'utf-8')
      } catch { continue }
      if (text.includes('\u0000')) continue
      const lines = text.split('\n')
      lines.forEach((line, i) => {
        if (hits.length < 60 && line.toLowerCase().includes(q)) hits.push(`${toRel(root, abs)}:${i + 1}: ${line.trim().slice(0, 200)}`)
      })
    }
  }
  walk(base)
  return hits.length ? hits.join('\n') : 'Nenhum resultado.'
}

/** Arquivos que um comando de terminal vai gravar (para criar a pasta antes). */
export function commandWriteTargets(command: string): string[] {
  const out: string[] = []
  const unq = (s: string) => s.replace(/^["']|["']$/g, '')
  for (const m of command.matchAll(/\b(?:Set-Content|Add-Content|Out-File)\b[^;|&]*?(?:-(?:Path|FilePath|LiteralPath)\s+)?("[^"]+"|'[^']+'|[^\s"';|&-][^\s;|&]*)/gi)) out.push(unq(m[1]))
  // Só redirecionamento de verdade (espaço antes do ">"): "=>" de código JS dentro do comando não conta
  for (const m of command.matchAll(/(?:^|\s)>{1,2}\s*("[^"]+"|'[^']+'|[^\s"';|&>]+)/g)) {
    const t = unq(m[1])
    if (!/^(nul|\$null|&\d)$/i.test(t)) out.push(t)
  }
  return [...new Set(out)].filter(t => t && !/[*?]/.test(t))
}

/** Exemplo do formato certo de cada ferramenta (sai junto do erro de parâmetro faltando). */
function toolExample(tool: string) {
  const line = TOOL_DOCS.split('\n').find(l => l.startsWith(`- ${tool} `))
  return line ? line.slice(2).split(' → ')[0] : ''
}

export async function executeTool(host: ToolHost, action: ToolAction): Promise<{ output: string; finish?: FinishResult }> {
  try {
    return await executeToolInner(host, action)
  } catch (e) {
    const msg = (e as Error).message
    // Parâmetro faltando: diz o que chegou e o formato certo — o modelo corrige no passo seguinte
    if (/^Parâmetro ".+" é obrigatório$/.test(msg)) {
      const got = Object.keys(action.args || {})
      const ex = toolExample(action.tool)
      throw Object.assign(new Error(`${msg} (recebi: ${got.length ? got.join(', ') : 'nenhum argumento'})${ex ? `. Formato: {"tool": "${action.tool}", "args": ${ex.slice(action.tool.length + 1)}}` : ''}`), { name: 'ToolArgsError' })
    }
    throw e
  }
}

async function executeToolInner(host: ToolHost, action: ToolAction): Promise<{ output: string; finish?: FinishResult }> {
  const a = normalizeArgs(action.tool, action.args)
  switch (action.tool) {
    case 'list_dir':
      return { output: listDir(host.root, String(a.path || '.'), Math.min(Number(a.depth) || 2, 4)) }

    case 'read_file': {
      const abs = resolveInside(host.root, str(a.path, 'path'))
      if (!fs.existsSync(abs)) return { output: `Arquivo não existe: ${toRel(host.root, abs)}` }
      if (fs.statSync(abs).size > TEXT_LIMIT) return { output: 'Arquivo grande demais para leitura (>1 MB).' }
      const lines = fs.readFileSync(abs, 'utf-8').split('\n')
      const start = Math.max(1, Number(a.start_line) || 1)
      const end = Math.min(lines.length, Number(a.end_line) || lines.length)
      let text = lines.slice(start - 1, end).map((l, i) => `${start + i}| ${l}`).join('\n')
      if (text.length > MAX_READ) text = text.slice(0, MAX_READ) + `\n…(truncado; ${lines.length} linhas no total — use start_line/end_line)`
      return { output: `${toRel(host.root, abs)} (${lines.length} linhas)\n${text}` }
    }

    case 'search':
      return { output: search(host.root, str(a.query, 'query'), String(a.path || '.')) }

    case 'write_file': {
      const content = typeof a.content === 'string' ? a.content : ''
      const r = await writeGuarded(host, str(a.path, 'path'), () => content)
      return { output: `${r.created ? 'Criado' : 'Atualizado'} ${r.rel} (+${r.added}/-${r.removed} linhas)` }
    }

    case 'edit_file': {
      const oldText = str(a.old_text, 'old_text')
      const newText = typeof a.new_text === 'string' ? a.new_text : ''
      const r = await writeGuarded(host, str(a.path, 'path'), current => {
        if (current === null) throw new Error('Arquivo não existe; use write_file para criá-lo')
        const count = current.split(oldText).length - 1
        if (count === 0) throw new Error('old_text não encontrado no arquivo. Leia o arquivo e copie o trecho exato.')
        if (count > 1) throw new Error(`old_text aparece ${count} vezes; inclua mais contexto para torná-lo único.`)
        return current.replace(oldText, newText)
      })
      return { output: `Editado ${r.rel} (+${r.added}/-${r.removed} linhas)` }
    }

    case 'run_command': {
      const command = str(a.command, 'command')
      const { getPrefs } = await import('../prefs')
      if (!getPrefs().agent.allowCommands) throw Object.assign(new Error('Recusado: o usuário desativou comandos de terminal para os agentes (⚙️ Configurações › Agente). Trabalhe só com leitura e edição de arquivos.'), { name: 'ToolBlocked' })
      // Piso absoluto: formatar disco, apagar a raiz, desligar a máquina. Nem com aprovação.
      if (!isSafeCommand(command)) throw Object.assign(new Error('Recusado: comando bloqueado por segurança — destrói o sistema e não é liberado nem com aprovação do usuário.'), { name: 'ToolBlocked' })
      // O resto (apagar arquivo, reescrever histórico) o agente não faz sozinho,
      // mas o usuário pode liberar na conversa.
      const blocked = isSafeAgentCommand(command)
      if (blocked && !host.approvedByUser) throw Object.assign(new Error(`Recusado: ${blocked}`), { name: 'ToolBlocked' })
      const timeoutMs = Math.min(Math.max(Number(a.timeout_sec) || 120, 5), 300) * 1000
      // Comando que grava num arquivo cuja pasta ainda não existe (Set-Content, Out-File, ">"):
      // cria a pasta antes — só dentro do projeto e só pastas, nunca arquivos
      for (const target of commandWriteTargets(command)) {
        try {
          const abs = resolveInside(host.root, target)
          if (!fs.existsSync(path.dirname(abs))) fs.mkdirSync(path.dirname(abs), { recursive: true })
        } catch { /* fora do projeto ou caminho estranho: o próprio comando reporta */ }
      }
      host.log('command', `$ ${command}`, { command })
      // Output is streamed to the live view in small batches while the command runs
      let pending = ''
      let flushed = 0
      const flush = () => {
        if (!pending || flushed > 200) return
        host.log('command_output', pending.slice(-4000), { command, chunk: pending.slice(-4000) })
        pending = ''
        flushed++
      }
      const ticker = setInterval(flush, 700)
      const r = await runCommand(command, host.root, { timeoutMs, signal: host.signal, onOutput: c => { pending += c } }).finally(() => clearInterval(ticker))
      if (r.cancelled) throw Object.assign(new Error('Cancelado'), { name: 'AbortError' })
      const status = r.timedOut ? `tempo esgotado (${timeoutMs / 1000}s)` : `código de saída ${r.exitCode}`
      host.log('command_result', `${command} → ${status}`, { command, exitCode: r.exitCode, durationMs: r.durationMs, output: (r.stdout + r.stderr).slice(-2000) }, r.exitCode === 0 ? 'info' : 'warn')
      return { output: `${status} em ${r.durationMs} ms\n--- stdout ---\n${r.stdout || '(vazio)'}\n--- stderr ---\n${r.stderr || '(vazio)'}` }
    }

    case 'remember_project': {
      const field = String(a.field) === 'pendencia' ? 'pendencias' : 'decisoes'
      const m = appendMemory(host.projectId, field, str(a.text, 'text'))
      return { output: `Anotado na memória do projeto (${field}). Agora são ${m[field].length} item(ns).` }
    }

    case 'update_project_memory': {
      const patch: Record<string, string> = {}
      for (const k of ['objetivo', 'arquitetura', 'tecnologias', 'convencoes', 'preferencias']) {
        if (typeof a[k] === 'string' && a[k]) patch[k] = String(a[k])
      }
      if (!Object.keys(patch).length) return { output: 'Nada para atualizar: mande pelo menos um campo.' }
      writeMemory(host.projectId, patch)
      return { output: `Memória do projeto atualizada: ${Object.keys(patch).join(', ')}.` }
    }

    case 'web_search': {
      const outcome = await webSearch(str(a.query, 'query'), { limit: Number(a.limit) || 5, signal: host.signal })
      return { output: formatSearch(outcome) }
    }

    case 'web_fetch': {
      const page = await webFetch(str(a.url, 'url'), { signal: host.signal })
      const corte = page.truncated ? '\n\n… (página cortada)' : ''
      return { output: `# ${page.title}\n${page.url}\n\n${page.text}${corte}` }
    }

    case 'git_status':
      return { output: await gitStatus({ root: host.root, signal: host.signal }) }

    case 'git_diff':
      return { output: await gitDiff({ root: host.root, signal: host.signal }, { file: a.file ? String(a.file) : undefined, staged: a.staged === true }) }

    case 'git_log':
      return { output: await gitLog({ root: host.root, signal: host.signal }, Number(a.limit) || 20) }

    case 'git_branch':
      return { output: await gitBranch({ root: host.root, signal: host.signal }) }

    case 'git_commit': {
      const files = Array.isArray(a.files) ? a.files.map(String) : undefined
      return { output: await gitCommit({ root: host.root, signal: host.signal }, { message: str(a.message, 'message'), files }) }
    }

    case 'send_message': {
      const kind = (['info', 'question', 'problem', 'review_request', 'decision'] as const).find(k => k === a.kind) || 'info'
      return { output: host.sendMessage(str(a.to, 'to'), kind, str(a.content, 'content')) }
    }

    case 'delegate': {
      const files = Array.isArray(a.files) ? a.files.map(String) : []
      return { output: host.delegate(str(a.to, 'to'), str(a.title, 'title'), String(a.description || a.title), files) }
    }

    case 'request_scope':
      return { output: host.requestScope(str(a.path, 'path'), String(a.reason || '')) }

    // ─── Prospecção local (OpenStreetMap) ──────────────────────────────────
    case 'local_businesses': {
      const { searchPlaces } = await import('../local/places')
      const r = await searchPlaces({ where: str(a.where, 'where'), radiusM: Number(a.radius_m) || undefined, categoryText: String(a.category || '') })
      const list = (a.only_no_site ? r.places.filter(p => p.leadScore >= 70) : r.places).slice(0, 60)
      if (!list.length) return { output: `Nada encontrado num raio de ${r.radiusM} m de ${r.center.label}.` }
      return {
        output: `${r.stats.total} resultado(s) perto de ${r.center.label} (raio ${r.radiusM} m; ${r.stats.semSite} sem site próprio, ${r.stats.comTelefone} com telefone). Fonte: ${r.source}.\n` +
          list.map(p => `- ${p.name} | ${p.category} | lead ${p.leadScore} (${p.leadReason}) | tel ${p.phone || '—'}${p.whatsapp ? ` | wa.me/${p.whatsapp}` : ''} | site ${p.website || '—'} | email ${p.email || '—'} | insta ${p.instagram || '—'} | ${p.address || 'endereço não cadastrado'} | ${p.distanceM} m | ${p.mapsUrl}`).join('\n'),
      }
    }

    // ─── Hub Escolar ────────────────────────────────────────────────────────
    case 'hub_search': {
      const { searchHub } = await import('../hub/academic')
      const source = typeof a.source === 'string' && a.source ? [a.source as import('../hub/types').HubSource] : undefined
      const hits = searchHub(str(a.query, 'query'), { sources: source }, 12)
      if (!hits.length) return { output: 'Nada encontrado no Hub Escolar.' }
      return { output: hits.map((h, i) => `[${i + 1}] ${h.item.origin.source} › ${h.item.origin.where}${h.item.origin.author ? ` · ${h.item.origin.author}` : ''}${h.item.origin.at ? ` · ${new Date(h.item.origin.at).toLocaleString('pt-BR')}` : ''}\n${h.item.title}\n${h.snippet}${h.item.attachments?.length ? `\nArquivos: ${h.item.attachments.map(x => x.name).join(', ')}` : ''}`).join('\n\n') }
    }

    case 'hub_course': {
      const { courseDossier, findCourseByName } = await import('../hub/academic')
      const c = findCourseByName(str(a.course, 'course'))
      if (!c) return { output: 'Disciplina não encontrada no Hub.' }
      const d = courseDossier(c.id)
      const when = (ms?: number) => (ms ? new Date(ms).toLocaleString('pt-BR') : 'sem data')
      return {
        output: `# ${c.name}${c.code ? ` (${c.code})` : ''}\nProfessores: ${c.professors.join(', ') || '—'}\n${c.grades?.length ? `Notas: ${c.grades.map(g => `${g.label}=${g.value}`).join(', ')}\n` : ''}${c.attendance ? `Faltas: ${c.attendance.absences ?? '?'}${c.attendance.maxAbsences ? `/${c.attendance.maxAbsences}` : ''}\n` : ''}
## Tarefas\n${d.tasks.map(t => `- ${t.title} · ${when(t.due)} · ${t.status}`).join('\n') || '—'}
## Provas\n${d.exams.map(e => `- ${e.title} · ${when(e.date)}`).join('\n') || '—'}
## Mensagens do professor\n${d.professorMessages.slice(0, 15).map(m => `- ${when(m.origin.at)} ${m.origin.author}: ${m.text.slice(0, 200)}`).join('\n') || '—'}
## Materiais\n${d.materials.slice(0, 20).map(m => `- ${m.title} (${m.origin.source} › ${m.origin.where})`).join('\n') || '—'}`.slice(0, 12_000),
      }
    }

    case 'hub_tasks': {
      const { tasks: taskStore, exams: examStore, courses: courseStore } = await import('../hub/store')
      const range = String(a.range || 'semana')
      const now = Date.now()
      const limit = range === 'semana' ? now + 7 * 86400_000 : range === 'mes' ? now + 31 * 86400_000 : Infinity
      const name = (id?: string) => (id ? courseStore.get(id)?.name || '' : '')
      const ts = taskStore.all().filter(t => (range === 'atrasadas' ? t.status === 'atrasada' : t.status !== 'concluida' && t.status !== 'cancelada' && (!t.due || t.due <= limit)))
      const ex = examStore.all().filter(e => range !== 'atrasadas' && e.date && e.date >= now - 86400_000 && e.date <= limit)
      return { output: `${ts.map(t => `- [${t.status}] ${t.title} (${name(t.courseId)}) · ${t.due ? new Date(t.due).toLocaleString('pt-BR') : 'sem data'} · origem: ${t.origins.map(o => `${o.source} › ${o.where}`).join('; ')}`).join('\n') || 'Sem tarefas.'}\n${ex.map(e => `- [prova] ${e.title} (${name(e.courseId)}) · ${new Date(e.date!).toLocaleString('pt-BR')}`).join('\n')}` }
    }

    case 'hub_add_task': {
      const { addOrMergeExam, addOrMergeTask, findCourseByName } = await import('../hub/academic')
      const { parseIsoLocal } = await import('../hub/portal')
      const courseId = typeof a.course === 'string' ? findCourseByName(a.course)?.id : undefined
      const origin = { source: 'manual' as const, where: `Registrado por ${host.agent.name}`, at: Date.now() }
      if (a.type === 'prova') {
        const r = addOrMergeExam({ courseId, title: str(a.title, 'title'), date: parseIsoLocal(String(a.due || '')), content: String(a.description || ''), origin, createdBy: 'user' })
        return { output: `${r.created ? 'Prova registrada' : 'Prova já existia (origem adicionada)'}: ${r.exam.title}` }
      }
      const r = addOrMergeTask({ courseId, title: str(a.title, 'title'), due: parseIsoLocal(String(a.due || '')), description: String(a.description || ''), type: a.type === 'atividade' ? 'atividade' : 'trabalho', origin, createdBy: 'user' })
      return { output: `${r.created ? 'Tarefa registrada' : 'Tarefa já existia (origem adicionada)'}: ${r.task.title}` }
    }

    case 'hub_complete_task': {
      const { tasks: taskStore } = await import('../hub/store')
      const { setTaskStatus } = await import('../hub/academic')
      const q = str(a.task, 'task').toLowerCase()
      const t = taskStore.all().find(x => x.id === q || x.title.toLowerCase().includes(q))
      if (!t) return { output: 'Tarefa não encontrada.' }
      setTaskStatus(t.id, 'concluida')
      return { output: `Concluída: ${t.title}` }
    }

    case 'hub_save_study': {
      const { studies } = await import('../hub/store')
      const { findCourseByName } = await import('../hub/academic')
      const kinds = ['resumo', 'exercicios', 'revisao', 'explicacao', 'pesquisa'] as const
      const entry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        courseId: typeof a.course === 'string' ? findCourseByName(a.course)?.id : undefined,
        kind: kinds.find(k => k === a.kind) || 'resumo',
        title: str(a.title, 'title'),
        content: str(a.content, 'content'),
        createdBy: host.agent.name,
        createdAt: Date.now(),
        origins: [],
      }
      studies.upsert(entry)
      return { output: `Salvo no histórico de estudos: ${entry.title}` }
    }

    case 'github_read': {
      const { readRepoFile, repoTree } = await import('../hub/github')
      const repo = str(a.repo, 'repo')
      if (typeof a.path === 'string' && a.path) return { output: (await readRepoFile(repo, a.path)).slice(0, 20_000) }
      const files = await repoTree(repo)
      return { output: `${files.length} arquivo(s):\n${files.slice(0, 400).join('\n')}` }
    }

    case 'hub_request_action': {
      const { requestAction } = await import('../hub/hub')
      const type = (['teams-message', 'whatsapp-message', 'github-issue', 'github-commit'] as const).find(t => t === a.type)
      if (!type) return { output: 'Tipo de ação inválido.' }
      const { type: _t, ...payload } = a
      void _t
      const pending = requestAction(type, payload, host.agent.name)
      host.log('hub_action', `${host.agent.name} pediu aprovação: ${pending.title}`, { actionId: pending.id }, 'warn')
      return { output: `Pedido enviado ao usuário para aprovação (Hub Escolar › Aprovações): ${pending.title}. Nada foi enviado ainda.` }
    }

    // ─── Jarvis Skill Engine (shared by every agent, filtered by role permission) ───
    case 'skill_find': {
      const engine = getEngine()
      const found = engine.recommend(str(a.query, 'query'), host.agent.roleId, 8)
      if (!found.length) return { output: 'Nenhuma extensão instalada atende a isso. Use skill_request para o JARVIS procurar e instalar uma.' }
      return { output: found.map(describeExtension).join('\n') }
    }

    case 'skill_use': {
      const args = (a.args && typeof a.args === 'object' ? a.args : {}) as Record<string, unknown>
      host.log('skill_use', `${host.agent.name} usa ${a.extension}.${a.tool}`, { extension: a.extension, tool: a.tool })
      const out = await getEngine().callTool(str(a.extension, 'extension'), str(a.tool, 'tool'), args, host.agent.roleId)
      return { output: out }
    }

    case 'skill_read':
      return { output: getEngine().readSkill(str(a.extension, 'extension'), host.agent.roleId, typeof a.skill === 'string' ? a.skill : undefined) }

    case 'skill_request': {
      const need = str(a.need, 'need')
      host.log('skill_request', `${host.agent.name} pediu uma ferramenta para: ${need}`)
      const lines: string[] = []
      const acquired = await getEngine().acquire(need, `agente ${host.agent.name}`, s => { lines.push(s); host.log('skill_engine', s) })
      const head = lines.slice(-6).join('\n')
      // acquire may have written and installed a new Skill when no public solution existed
      const outcome = acquired.status === 'created' ? acquired.outcome : acquired
      if (outcome.status === 'installed' || outcome.status === 'existing') return { output: `${head}\nDisponível agora:\n${describeExtension(outcome.extension)}` }
      if (outcome.status === 'pending') return { output: `${head}\nAguardando aprovação do usuário (${outcome.approval.reason}). Continue sem ela por enquanto.` }
      if (outcome.status === 'blocked') return { output: `${head}\nBloqueada por segurança: ${outcome.reason}` }
      const tried = 'tried' in acquired && acquired.tried.length ? `\nTentativas:\n${acquired.tried.map(t => `- ${t}`).join('\n')}` : ''
      return { output: `${head}${tried}\nNada adequado encontrado. Siga com as ferramentas que você tem; a necessidade foi registrada como oportunidade de melhoria.` }
    }

    case 'create_spreadsheet': {
      if (!Array.isArray(a.sheets) || !(a.sheets as unknown[]).length) throw new Error('Informe sheets: [{ name?, headers, rows, totals? }]')
      const rawSheets = (a.sheets as Array<Record<string, unknown>>).map((s, i) => {
        const headers = Array.isArray(s.headers) ? (s.headers as unknown[]).map(String) : []
        const rows = Array.isArray(s.rows) ? (s.rows as unknown[][]).map(r => (r as unknown[]).map(v => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : (typeof v === 'number' ? v : String(v))))) : []
        return { name: String(s.name || `Aba ${i + 1}`), headers, rows, totals: s.totals === true }
      })
      host.log('tool', `${host.agent.name} → create_spreadsheet (${rawSheets.length} aba(s))`, { tool: 'create_spreadsheet' })
      const meta = await buildSpreadsheet({ name: typeof a.name === 'string' && a.name.trim() ? a.name.trim() : undefined, sheets: rawSheets })
      return { output: `Planilha pronta: **${meta.title}** (${(meta.size / 1024).toFixed(1)} KB)\n\n[[document:${meta.file}]]` }
    }

    case 'create_report': {
      if (!Array.isArray(a.sections) || !(a.sections as unknown[]).length) throw new Error('Informe sections: [{ heading, body }]')
      const sections = (a.sections as Array<Record<string, unknown>>).map((s, i) => ({ heading: String(s.heading || `Seção ${i + 1}`), body: String(s.body || '') }))
      const title = String(a.title || 'Relatório').slice(0, 90)
      // Optional AI-generated cover; failure must not block the document
      let coverImagePath: string | undefined
      if (typeof a.cover === 'string' && a.cover.trim()) {
        try {
          const img = await generateImage(`${a.cover.trim()} — capa de relatório, formato retrato, estética premium, sem texto na imagem`, { width: 768, height: 1344 })
          const { imageFile } = await import('../media/images')
          coverImagePath = imageFile(img.id)?.file
        } catch {}
      }
      host.log('tool', `${host.agent.name} → create_report (${sections.length} seção(ões))`, { tool: 'create_report' })
      const meta = await buildReportPdf({ title, subtitle: typeof a.subtitle === 'string' ? a.subtitle : undefined, sections, coverImagePath })
      return { output: `PDF pronto: **${meta.title}** (${(meta.size / 1024).toFixed(1)} KB)${coverImagePath ? ' · capa com imagem gerada por IA' : ''}\n\n[[document:${meta.file}]]` }
    }

    case 'infra_report': {
      host.log('tool', `${host.agent.name} → infra_report`, { tool: 'infra_report' })
      const sections = collectInfraSections()
      let coverImagePath: string | undefined
      try {
        const img = await generateImage('Minimal dark technology dashboard, abstract server room with cyan data streams, cinematic, premium, no text, portrait format', { width: 768, height: 1344 })
        const { imageFile } = await import('../media/images')
        coverImagePath = imageFile(img.id)?.file
      } catch {}
      const meta = await buildReportPdf({ title: 'Relatório de Infraestrutura', subtitle: `${os.hostname()} — ${new Date().toLocaleDateString('pt-BR')}`, coverImagePath, sections })
      return { output: `${infraSummaryMarkdown()}\n\n[[document:${meta.file}]]` }
    }

    case 'finish': {
      const issues: TaskIssue[] = Array.isArray(a.issues)
        ? a.issues.map(i => (typeof i === 'string' ? { description: i } : { description: String((i as TaskIssue).description || ''), role: (i as TaskIssue).role })).filter(i => i.description)
        : []
      const status = a.status === 'issues' || issues.length ? 'issues' : 'done'
      return { output: 'Tarefa encerrada.', finish: { summary: String(a.summary || 'Concluído'), status, issues } }
    }

    default:
      if (isInfraTool(action.tool)) return executeInfraTool(host, action)
      if (isSocialTool(action.tool)) return executeSocialTool(host, action)
      throw new Error(`Ferramenta desconhecida: ${action.tool}`)
  }
}
