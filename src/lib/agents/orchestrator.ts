import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { classifyModelError } from '../ai/client'
import type { Provider as LiveProvider } from '@/types'
import { IGNORED_DIRS } from './fsutil'
import { FileLockManager } from './locks'
import { assignAutoModels, modelHealth, replacementsFor, type ChatMessage, type CompleteFn } from './models'
import { budgetTier, estimateInputTokens, maxInputTokensFor } from '../ai/freeTier'
import { extractJson, parseAgentTurn } from './parse'
import { agentFromRole, AUTO_TEAM_ROLES, getRole, ROLE_MAP } from './roles'
import { Scheduler } from './scheduler'
import { describeExtension, executeTool, lockOwner, normalizeArgs, TOOL_DOCS, TOOL_SPECS, type FinishResult, type ToolHost } from './tools'
import { getEngine } from '../engine/engine'
import { redact, deepRedact } from '../redact'
import { decide as decidePermission, describeRequest, PERMISSION_LABELS } from './permissions'
import { projectContext } from './projectMemory'
import type {
  AgentMessage, AgentRuntimeState, AgentStatus, AgentTask, ApprovalRequest, Complexity, MessageKind, Run, RunEvent, RunStatus, TaskIssue, Usage,
} from './types'

export interface RunDeps {
  complete: CompleteFn
  providers: () => Promise<LiveProvider[]>
  locks: FileLockManager
  snapshotDir: string
  persist: (run: Run) => void
  appendEvent: (event: RunEvent) => void
  /** Called once when the run reaches a terminal or paused state. */
  onSettled?: (run: Run) => void
}

const MAX_TASKS = 40
const MAX_ANSWERS = 12
const PLAN_LIMITS: Record<Complexity, number> = { trivial: 1, small: 3, medium: 7, large: 14 }

const abortError = () => Object.assign(new Error('Cancelado'), { name: 'AbortError' })
const isAbort = (e: unknown) => (e as Error)?.name === 'AbortError'

function addUsage(into: Usage, u: Usage) {
  into.inputTokens += u.inputTokens
  into.outputTokens += u.outputTokens
  if (typeof u.cost === 'number') into.cost = (into.cost || 0) + u.cost
  if (u.estimated) into.estimated = true
}

function clip(s: string, n: number) {
  return s.length > n ? s.slice(0, n) + '…' : s
}

/**
 * Honesty guard on the final report: when no file was written by the file tools but FEITO claims a
 * file was created/changed (an agent can declare a task done without writing), the claim gets a
 * visible warning in PENDENTE instead of passing as true. Seen in the 19/11 battery: "FEITO -
 * Criação do README.md" with zero changes.
 */
export function guardFileClaims(report: string, changes: number): string {
  if (changes > 0) return report
  const feito = (/##\s*FEITO([\s\S]*?)(?=\n##\s|$)/i.exec(report)?.[1] || '')
  const claims = /\b(cri(ei|ado|ada|ação|ou)|alter(ei|ado|ada|ação|ou)|edit(ei|ado|ada|ou)|escrev(i|eu|ido)|grav(ei|ado|ou)|atualiz(ei|ado|ada|ação|ou)|corrig(i|ido|iu))\b[^\n]*(arquivo|\.\w{1,5}\b|readme)/i.test(feito)
  if (!claims) return report
  const warning = '- ⚠️ Nenhum arquivo foi gravado pelas ferramentas de arquivo nesta execução: o que aparece em FEITO como criado/alterado não foi confirmado. Peça de novo ou confira a pasta.'
  return /##\s*PENDENTE/i.test(report)
    ? report.replace(/(##\s*PENDENTE[^\n]*\n)(\s*Nenhuma pendência\.?\s*)?/i, `$1${warning}\n`)
    : `${report}\n\n## PENDENTE\n${warning}`
}

export function newAgentState(cfg: Omit<AgentRuntimeState, 'status' | 'step' | 'maxSteps' | 'usage' | 'calls' | 'errors' | 'activeMs' | 'paused'>, maxSteps: number): AgentRuntimeState {
  return { ...cfg, status: 'waiting', step: 0, maxSteps, usage: { inputTokens: 0, outputTokens: 0 }, calls: 0, errors: [], activeMs: 0, paused: false }
}

export class RunController {
  readonly abort = new AbortController()
  private agentAborts = new Map<string, AbortController>()
  private stoppedAgents = new Set<string>()
  private scheduler?: Scheduler
  private listeners = new Set<(e: RunEvent) => void>()
  private inboxSeen = new Map<string, number>()
  private persistTimer: ReturnType<typeof setTimeout> | null = null
  private brief = ''
  /** Instruções do projeto (JARVIS.md/CLAUDE.md/AGENTS.md) + memória guardada. */
  private memo = ''
  private answers = 0
  private pauseWaiters: Array<() => void> = []
  /** Quem está esperando uma decisão do usuário (aprovação de ferramenta ou do plano). */
  private decisionWaiters: Array<() => void> = []
  /** Decisão do usuário sobre o plano no Plan Mode. */
  private planDecision: 'pending' | 'approved' | 'rejected' = 'pending'

  private get planStillPending() { return this.planDecision === 'pending' }
  private get planApproved() { return this.planDecision === 'approved' }
  private settled = false
  done: Promise<void> = Promise.resolve()

  constructor(public run: Run, private deps: RunDeps) {}

  // ─── Events & persistence ──────────────────────────────────────────────────

  subscribe(fn: (e: RunEvent) => void) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  emit(type: string, message: string, extra: Partial<Omit<RunEvent, 'id' | 'at' | 'type' | 'message'>> = {}) {
    // Shell output and agent text can carry credentials — redact before persisting or streaming anywhere
    const { data, ...rest } = extra
    const safeMessage = redact(String(message)).slice(0, 4000)
    const safeData = data ? deepRedact(data) : undefined
    const event: RunEvent = { id: ++this.run.eventCount, at: Date.now(), type, message: safeMessage, level: extra.level || 'info', ...rest, data: safeData }
    try { this.deps.appendEvent(event) } catch {}
    for (const l of this.listeners) { try { l(event) } catch {} }
    this.schedulePersist()
    return event
  }

  private schedulePersist() {
    if (this.persistTimer) return
    this.persistTimer = setTimeout(() => { this.persistTimer = null; this.persistNow() }, 250)
  }

  persistNow() {
    if (this.persistTimer) { clearTimeout(this.persistTimer); this.persistTimer = null }
    try { this.deps.persist(this.run) } catch {}
  }

  private setStatus(status: RunStatus, message?: string) {
    this.run.status = status
    this.emit('run_status', message || `Execução: ${status}`, { data: { status } })
  }

  private setAgentStatus(agent: AgentRuntimeState, status: AgentStatus) {
    if (agent.status === status) return
    agent.status = status
    this.emit('agent_status', `${agent.name}: ${status}`, { agentId: agent.id, data: { status } })
  }

  agent(id: string) {
    return this.run.agents.find(a => a.id === id)
  }

  private task(id: string) {
    return this.run.tasks.find(t => t.id === id)
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  start() {
    this.run.startedAt ??= Date.now()
    this.done = this.execute()
    return this.done
  }

  private async execute() {
    try {
      this.setStatus('analyzing', 'Analisando o projeto')
      this.brief = buildProjectBrief(this.run.projectPath)
      // O que o projeto já ensinou ao JARVIS: instruções versionadas na pasta e
      // memória guardada. Entra antes da estrutura porque vale mais que ela.
      this.memo = projectContext({ projectId: this.run.projectId, root: this.run.projectPath })
      if (this.memo) this.emit('project_memory', 'Li as instruções e a memória deste projeto')

      if (!this.run.tasks.length) {
        this.setStatus('planning', 'Planejando e distribuindo tarefas')
        await this.plan()
      } else {
        // Resuming: tasks interrupted mid-flight start over
        for (const t of this.run.tasks) if (t.status === 'running') t.status = 'pending'
      }

      // Plan Mode: investigou e planejou, mas não toca no projeto antes do
      // "aprovar". Fora do if acima de propósito: uma execução retomada já tem
      // tarefas, e antes disso o portão era pulado justamente na retomada —
      // o plano rodava sem nunca ter sido aprovado.
      if (this.run.options.planFirst && !this.run.planApprovedAt) await this.awaitPlanApproval()
      await this.resolveModels()

      this.setStatus('running', 'Agentes trabalhando')
      await this.runScheduler()

      for (let round = 0; round < this.run.options.fixRounds && !this.abort.signal.aborted; round++) {
        if (!this.createFixTasks(round)) break
        this.emit('fix_round', `Rodada de correções ${round + 1}`)
        await this.runScheduler()
      }

      if (this.abort.signal.aborted) throw abortError()

      this.setStatus('integrating', 'Integrando resultados e escrevendo o relatório')
      await this.writeReport()

      const failed = this.run.tasks.filter(t => t.status === 'failed' || t.status === 'blocked')
      const done = this.run.tasks.filter(t => t.status === 'done')
      this.run.finishedAt = Date.now()
      for (const a of this.run.agents) if (!a.removed && a.status !== 'failed') this.setAgentStatus(a, a.idleReason ? 'waiting' : 'done')
      this.setStatus(done.length === 0 && failed.length ? 'failed' : 'completed',
        failed.length ? `Concluído com ${failed.length} tarefa(s) sem sucesso` : 'Concluído')
    } catch (e) {
      this.run.finishedAt = Date.now()
      if (isAbort(e) || this.abort.signal.aborted) {
        for (const t of this.run.tasks) if (t.status === 'pending' || t.status === 'running') t.status = 'cancelled'
        for (const a of this.run.agents) if (!a.removed && a.status !== 'done') this.setAgentStatus(a, 'paused')
        this.setStatus('cancelled', 'Execução cancelada')
      } else {
        this.run.error = (e as Error).message
        this.emit('error', `Falha na execução: ${this.run.error}`, { level: 'error' })
        this.setStatus('failed', this.run.error)
      }
    } finally {
      this.deps.locks.releasePrefix(`${this.run.id}:`)
      this.persistNow()
      if (!this.settled) { this.settled = true; this.deps.onSettled?.(this.run) }
    }
  }

  /**
   * Plan Mode: para a execução com o plano pronto e espera o usuário decidir.
   * Nada foi escrito no projeto até aqui — o planejamento só lê.
   */
  private async awaitPlanApproval() {
    this.planDecision = 'pending'
    this.setStatus('awaiting_plan', 'Plano pronto — esperando sua aprovação')
    this.emit('plan_pending', `Plano com ${this.run.tasks.length} etapa(s). Nada foi alterado no projeto ainda.`, {
      level: 'warn',
      data: { steps: this.run.tasks.map(t => ({ id: t.id, title: t.title, agentId: t.agentId })), summary: this.run.planSummary },
    })
    this.persistNow()

    // Só a decisão explícita do usuário tira a execução daqui: um despertar
    // de outra espera (uma aprovação de ferramenta antiga) não aprova o plano.
    while (this.planStillPending && !this.abort.signal.aborted) {
      await this.waitForDecision(this.abort.signal)
    }
    if (!this.planApproved || this.abort.signal.aborted) throw abortError()
    this.setStatus('running', 'Plano aprovado — agentes trabalhando')
  }

  // ─── Planning ──────────────────────────────────────────────────────────────

  private plannerAgent(): AgentRuntimeState {
    let architect = this.run.agents.find(a => a.roleId === 'architect' && a.enabled && !a.removed)
    if (!architect && this.run.autoTeam) {
      architect = newAgentState({ ...agentFromRole('architect', 'architect') }, this.run.options.maxSteps)
      this.run.agents.unshift(architect)
    }
    // Teams without an architect still need someone to plan: the first enabled agent does it
    return architect || this.run.agents.find(a => a.enabled && !a.removed)!
  }

  private async plan() {
    const planner = this.plannerAgent()
    if (!planner) throw new Error('A equipe não tem agentes ativos')
    await this.resolveModels([planner.id])
    this.setAgentStatus(planner, 'planning')

    const roles = this.run.autoTeam
      ? AUTO_TEAM_ROLES.map(id => ROLE_MAP.get(id)!)
      : [...new Map(this.run.agents.filter(a => a.enabled && !a.removed).map(a => [a.roleId, getRole(a.roleId)])).values()]

    const roleList = roles.map(r => `- ${r.id}: ${r.name} — ${r.responsibilities.join('; ')}`).join('\n')
    const system = `Você é ${planner.name}, coordenador técnico de uma equipe de agentes de IA que trabalha num projeto real.
Analise o pedido e o projeto e devolva SOMENTE um JSON com o plano.

Regras:
- Classifique a complexidade: "trivial" (1 ajuste pontual), "small" (poucos arquivos), "medium" (várias partes do sistema), "large" (sistema novo ou grande mudança).
- Use uma quantidade de agentes PROPORCIONAL: trivial = 1 tarefa e 1 papel; small = até 3 tarefas; medium = até 7; large = até 14. Nunca acione papéis desnecessários.
- Use somente estes papéis (campo "role"):
${roleList}
- Tarefas independentes não dependem umas das outras (rodam em paralelo). Use "dependsOn" só quando uma tarefa precisa do resultado de outra.
- Inclua QA ("qa") para validar quando houver algo testável, e revisão ("reviewer") em pedidos medium/large, dependendo das tarefas que verificam.
- Em "files" liste os caminhos (relativos à raiz) que a tarefa pode criar/alterar.
- Escreva em português do Brasil.

Formato:
{"complexity": "small", "summary": "visão geral do plano", "decisions": ["decisão técnica"], "tasks": [{"id": "t1", "title": "...", "description": "o que fazer, critérios de pronto", "role": "frontend", "dependsOn": [], "files": ["src/x.tsx"]}]}`

    const user = `# Pedido\n${this.run.request}\n\n${this.memo ? `${clip(this.memo, 8_000)}\n\n` : ''}# Projeto\n${this.brief}`
    const messages: ChatMessage[] = [{ role: 'system', content: system }, { role: 'user', content: user }]

    let raw: Record<string, unknown> | null = null
    for (let attempt = 0; attempt < 3 && !raw; attempt++) {
      const text = await this.callModel(planner, messages, this.abort.signal, { json: true })
      try {
        raw = extractJson(text) as Record<string, unknown>
      } catch (e) {
        messages.push({ role: 'assistant', content: clip(text, 2000) }, { role: 'user', content: `Resposta inválida (${(e as Error).message}). Devolva apenas o JSON do plano.` })
      }
    }
    if (!raw) throw new Error('O planejador não devolveu um plano válido')

    const complexity = (['trivial', 'small', 'medium', 'large'] as const).find(c => c === raw!.complexity) || 'small'
    this.run.complexity = complexity
    this.run.planSummary = String(raw.summary || '')
    const decisions = Array.isArray(raw.decisions) ? raw.decisions.map(String).filter(Boolean).slice(0, 10) : []
    this.run.decisions.push(...decisions)

    let rawTasks = (Array.isArray(raw.tasks) ? raw.tasks : []).slice(0, PLAN_LIMITS[complexity]) as Array<Record<string, unknown>>
    // A request phrased as a question ("qual a versão do Node instalada?") may come back with no tasks.
    // It is still work: the request itself becomes the only task instead of failing the whole run.
    if (!rawTasks.length) {
      rawTasks = [{ id: 't1', title: this.run.request, description: `${this.run.request}\n\nObtenha a resposta com as ferramentas (comando ou leitura de arquivo) e mostre a evidência.` }]
      this.emit('plan_fallback', 'O plano veio sem tarefas: o pedido virou uma tarefa única', { level: 'warn' })
    }

    const validRoles = new Set(roles.map(r => r.id))
    const idMap = new Map<string, string>()
    rawTasks.forEach((t, i) => idMap.set(String(t.id || `t${i + 1}`), `t${i + 1}`))

    const tasks: AgentTask[] = rawTasks.map((t, i) => {
      let roleId = String(t.role || '')
      if (!validRoles.has(roleId)) roleId = validRoles.has('fullstack') ? 'fullstack' : planner.roleId
      return {
        id: `t${i + 1}`,
        title: clip(String(t.title || `Tarefa ${i + 1}`), 140),
        description: String(t.description || t.title || ''),
        agentId: '',
        roleId,
        dependsOn: (Array.isArray(t.dependsOn) ? t.dependsOn : []).map(d => idMap.get(String(d))).filter((d): d is string => !!d && d !== `t${i + 1}`),
        files: (Array.isArray(t.files) ? t.files : []).map(String).filter(Boolean).slice(0, 30),
        status: 'pending',
        kind: getRole(roleId).reviewer ? (roleId === 'qa' ? 'verify' : 'review') : 'work',
        createdBy: planner.id,
        createdAt: Date.now() + i,
        attempts: 0,
      }
    })
    breakCycles(tasks)

    // Build or match the team
    for (const t of tasks) t.agentId = this.agentForRole(t.roleId).id
    const used = new Set(tasks.map(t => t.agentId))
    for (const a of this.run.agents) {
      if (!used.has(a.id) && a.id !== planner.id) a.idleReason = 'Não necessário para este pedido'
    }

    this.run.tasks.push(...tasks)
    this.setAgentStatus(planner, used.has(planner.id) ? 'waiting' : 'done')
    this.emit('plan', `Plano (${complexity}): ${tasks.length} tarefa(s), ${used.size} agente(s)`, {
      agentId: planner.id,
      data: { complexity, summary: this.run.planSummary, tasks: tasks.map(t => ({ id: t.id, title: t.title, role: t.roleId, dependsOn: t.dependsOn })) },
    })
    this.postMessage(planner.id, 'all', 'decision',
      `Plano: ${this.run.planSummary}\n${tasks.map(t => `• ${t.id} [${getRole(t.roleId).name}] ${t.title}${t.dependsOn.length ? ` (depois de ${t.dependsOn.join(', ')})` : ''}`).join('\n')}${decisions.length ? `\nDecisões: ${decisions.join(' | ')}` : ''}`)
  }

  /** Existing agent for the role, or (auto team) a new one. Falls back to the closest teammate. */
  private agentForRole(roleId: string): AgentRuntimeState {
    const live = this.run.agents.filter(a => a.enabled && !a.removed)
    const match = live.find(a => a.roleId === roleId)
    if (match) return match
    if (this.run.autoTeam) {
      const created = newAgentState({ ...agentFromRole(roleId, roleId) }, this.run.options.maxSteps)
      this.run.agents.push(created)
      this.emit('agent_added', `${created.name} entrou na equipe`, { agentId: created.id })
      return created
    }
    return live.find(a => a.roleId === 'fullstack') || live.find(a => a.roleId === 'architect') || live[0]
  }

  private async resolveModels(onlyIds?: string[]) {
    const providers = await this.deps.providers()
    const targets = this.run.agents.filter(a => !a.removed && (!onlyIds || onlyIds.includes(a.id)) && (!a.resolvedModel || a.model !== 'auto' && a.resolvedModel !== a.model))
    if (!targets.length) return
    const picks = assignAutoModels(targets.map(a => ({ id: a.id, roleId: a.roleId, model: a.model })), providers)
    for (const a of targets) {
      const m = picks.get(a.id)
      if (m) {
        a.resolvedModel = m
        this.emit('agent_model', `${a.name} usará ${m.split('|').pop()}`, { agentId: a.id, data: { model: m } })
      } else {
        a.errors.push('Nenhum modelo disponível')
      }
    }
  }

  // ─── Scheduling ────────────────────────────────────────────────────────────

  private async runScheduler() {
    this.scheduler = new Scheduler({
      tasks: () => this.run.tasks,
      agents: () => this.run.agents,
      maxParallel: () => this.run.options.maxParallel,
      isPaused: () => this.run.status === 'paused',
      signal: this.abort.signal,
      execute: (t, agentId) => this.runTask(this.task(t.id)!, agentId),
      onBlocked: (t, reason) => {
        const task = this.task(t.id)!
        task.status = 'blocked'
        task.error = reason
        this.emit('task_blocked', `${task.id} bloqueada: ${reason}`, { taskId: task.id, level: 'warn' })
      },
      onReassign: (t, from, to) => {
        const task = this.task(t.id)!
        task.agentId = to
        this.emit('task_reassigned', `${task.id} passou de ${this.agent(from)?.name || from} para ${this.agent(to)?.name || to}`, { taskId: task.id, agentId: to })
      },
    })
    await this.scheduler.run()
  }

  private async runTask(task: AgentTask, agentId: string) {
    const agent = this.agent(agentId)!
    const ctrl = new AbortController()
    const onRunAbort = () => ctrl.abort()
    this.abort.signal.addEventListener('abort', onRunAbort)
    this.agentAborts.set(agent.id, ctrl)
    this.stoppedAgents.delete(agent.id)

    task.status = 'running'
    task.agentId = agent.id
    task.startedAt = Date.now()
    task.attempts++
    agent.currentTaskId = task.id
    agent.step = 0
    agent.maxSteps = this.run.options.maxSteps
    agent.idleReason = undefined
    const role = getRole(agent.roleId)
    this.setAgentStatus(agent, role.reviewer ? 'reviewing' : 'executing')
    this.emit('task_started', `${agent.name} começou: ${task.title}`, { agentId: agent.id, taskId: task.id })

    const started = Date.now()
    try {
      if (!agent.resolvedModel) await this.resolveModels([agent.id])
      const result = await this.agentLoop(agent, task, ctrl.signal)
      task.status = 'done'
      task.result = result.summary
      task.issues = result.issues
      task.finishedAt = Date.now()
      this.emit('task_done', `${agent.name} concluiu ${task.id}${result.issues.length ? ` (${result.issues.length} problema(s) apontado(s))` : ''}`, {
        agentId: agent.id, taskId: task.id, data: { summary: result.summary, issues: result.issues },
      })
      this.postMessage(agent.id, 'all', 'done', `Concluí "${task.title}": ${clip(result.summary, 600)}`, task.id)
    } catch (e) {
      task.finishedAt = Date.now()
      if (this.abort.signal.aborted) {
        task.status = 'cancelled'
      } else if (isAbort(e) && this.stoppedAgents.has(agent.id)) {
        // Interrupted by the user: back to the queue, picked up again when the agent is restarted
        task.status = 'pending'
        task.finishedAt = undefined
        this.emit('task_interrupted', `${agent.name} foi interrompido em ${task.id}`, { agentId: agent.id, taskId: task.id, level: 'warn' })
      } else {
        task.status = 'failed'
        task.error = (e as Error).message
        agent.errors.push(clip(task.error, 300))
        this.setAgentStatus(agent, 'failed')
        this.emit('task_failed', `${agent.name} falhou em ${task.id}: ${task.error}`, { agentId: agent.id, taskId: task.id, level: 'error' })
      }
    } finally {
      this.abort.signal.removeEventListener('abort', onRunAbort)
      this.agentAborts.delete(agent.id)
      this.deps.locks.releaseAll(lockOwner(this.run.id, agent.id))
      agent.activeMs += Date.now() - started
      agent.currentTaskId = undefined
      if (agent.paused) this.setAgentStatus(agent, 'paused')
      else if (agent.status !== 'failed') this.setAgentStatus(agent, 'waiting')
      this.schedulePersist()
    }
  }

  // ─── Agent loop ────────────────────────────────────────────────────────────

  private async agentLoop(agent: AgentRuntimeState, task: AgentTask, signal: AbortSignal): Promise<FinishResult> {
    const history: ChatMessage[] = [
      { role: 'system', content: this.systemPrompt(agent) },
      { role: 'user', content: this.taskContext(agent, task) },
    ]
    let parseFailures = 0

    for (let step = 0; step < agent.maxSteps; step++) {
      await this.gate(agent, signal)
      agent.step = step + 1
      this.emit('agent_step', `${agent.name}: passo ${agent.step}/${agent.maxSteps}`, { agentId: agent.id, taskId: task.id, data: { step: agent.step } })

      const text = await this.callModel(agent, history, signal, { json: true, nativeTools: true })
      history.push({ role: 'assistant', content: clip(text, 12_000) })

      let turn
      try {
        turn = parseAgentTurn(text)
        parseFailures = 0
      } catch (e) {
        if (++parseFailures > 2) throw new Error(`Respostas fora do formato esperado: ${(e as Error).message}`)
        history.push({ role: 'user', content: `Formato inválido: ${(e as Error).message}. Responda somente com o JSON {"thought": "...", "actions": [...]}. Escape aspas e quebras de linha dentro das strings.` })
        continue
      }
      if (turn.thought) this.emit('agent_thought', clip(turn.thought, 500), { agentId: agent.id, taskId: task.id })

      const observations: string[] = []
      for (const action of turn.actions) {
        if (signal.aborted) throw abortError()
        if (action.tool === 'send_message' || action.tool === 'delegate') this.setAgentStatus(agent, 'communicating')

        // Modo de permissão: o que é livre segue; o resto pede aprovação na conversa
        // ou é recusado pelo modo (Restrito), e o agente recebe o motivo como observação.
        const mode = this.run.options.permissionMode || 'supervisionado'
        // Classifica sobre os MESMOS argumentos que serão executados: o
        // executeTool normaliza aliases (run_command aceita "cmd", "comando",
        // "script"), e classificar o argumento cru deixava um comando de
        // instalação passar como simples "comando" — e o cartão de aprovação
        // aparecia sem texto nenhum.
        const argsReais = normalizeArgs(action.tool, action.args)
        const verdict = decidePermission(action.tool, argsReais, mode)
        let approvedByUser = false
        if (!verdict.allow) {
          if (!verdict.needsApproval) {
            this.emit('tool_blocked', `${agent.name} → ${action.tool} recusado pelo modo ${PERMISSION_LABELS[mode].name}`, {
              agentId: agent.id, taskId: task.id, level: 'warn',
              data: { tool: action.tool, risk: verdict.risk, mode },
            })
            observations.push(`### ${action.tool} → RECUSADO: ${verdict.reason}`)
            continue
          }
          const approved = await this.askApproval(agent, task, action.tool, argsReais, verdict.risk, signal)
          if (!approved) {
            if (signal.aborted || this.abort.signal.aborted) throw abortError()
            observations.push(`### ${action.tool} → NEGADO pelo usuário. Não repita este pedido; siga por outro caminho ou finalize explicando o que ficou pendente.`)
            continue
          }
          approvedByUser = true
        }

        const host = this.toolHost(agent, task, signal, approvedByUser)
        const startedAt = Date.now()
        this.emit('tool_start', `${agent.name} → ${action.tool}${describeArgs(action.args)}`, {
          agentId: agent.id, taskId: task.id,
          data: { tool: action.tool, args: summarizeArgs(action.args), risk: verdict.risk },
        })
        try {
          const { output, finish } = await executeTool(host, action)
          this.emit('tool', `${agent.name} → ${action.tool}${describeArgs(action.args)}`, {
            agentId: agent.id, taskId: task.id,
            data: { tool: action.tool, args: summarizeArgs(action.args), durationMs: Date.now() - startedAt, ok: true },
          })
          if (finish) return finish
          observations.push(`### ${action.tool}${describeArgs(action.args)}\n${clip(output, isLocalModel(agent.resolvedModel) ? 3_000 : 8_000)}`)
        } catch (e) {
          if (isAbort(e)) throw e
          const msg = (e as Error).message
          this.emit('tool_error', `${agent.name} → ${action.tool}: ${msg}`, {
            agentId: agent.id, taskId: task.id, level: 'warn',
            data: { tool: action.tool, durationMs: Date.now() - startedAt, ok: false, error: msg },
          })
          observations.push(`### ${action.tool} → ERRO: ${msg}`)
        }
        if (agent.status === 'communicating') this.setAgentStatus(agent, getRole(agent.roleId).reviewer ? 'reviewing' : 'executing')
      }

      const inbox = this.takeInbox(agent)
      const left = agent.maxSteps - agent.step
      history.push({
        role: 'user',
        content: `${observations.join('\n\n')}${inbox ? `\n\n# Novas mensagens para você\n${inbox}` : ''}\n\n(${left} passo(s) restante(s). ${left <= 2 ? 'Finalize agora com "finish".' : 'Continue ou use "finish" quando terminar.'})`,
      })
      trimHistory(history, 10, contextBudgetFor(agent.resolvedModel))
    }
    throw new Error(`Limite de ${agent.maxSteps} passos atingido antes de concluir`)
  }

  private async gate(agent: AgentRuntimeState, signal: AbortSignal) {
    while (this.run.status === 'paused' || agent.paused) {
      if (signal.aborted) throw abortError()
      if (agent.status !== 'paused') this.setAgentStatus(agent, 'paused')
      await new Promise<void>(resolve => {
        this.pauseWaiters.push(resolve)
        signal.addEventListener('abort', () => resolve(), { once: true })
      })
    }
    if (signal.aborted) throw abortError()
    if (agent.status === 'paused') this.setAgentStatus(agent, getRole(agent.roleId).reviewer ? 'reviewing' : 'executing')
  }

  private releasePauseWaiters() {
    const w = this.pauseWaiters
    this.pauseWaiters = []
    for (const r of w) r()
  }

  /** Calls the agent's model; on failure records health and switches to a replacement model. */
  async callModel(agent: AgentRuntimeState, messages: ChatMessage[], signal: AbortSignal, opts: { json?: boolean; nativeTools?: boolean } = {}): Promise<string> {
    const tried = new Set<string>()
    let lastError: unknown
    let formatRetries = 0
    for (let attempt = 0; attempt < 8; attempt++) {
      if (signal.aborted) throw abortError()
      const model = agent.resolvedModel
      if (!model) throw new Error('Nenhum modelo disponível. Configure uma chave em 🔑 Chaves de API.')
      // Um pedido maior que a cota por minuto do provedor vira 429 antes da resposta:
      // troca proativamente por um modelo cuja faixa aguenta o tamanho. Sem nenhum
      // com folga, segue mesmo assim — numa janela recém-iniciada ainda pode caber.
      const est = estimateInputTokens(messages)
      if (est > maxInputTokensFor(budgetTier(model))) {
        const next = replacementsFor(model, agent.roleId, await this.deps.providers(), tried, est)[0]
        if (next && maxInputTokensFor(budgetTier(next)) >= est) {
          tried.add(model)
          agent.resolvedModel = next
          this.emit('model_switched', `${agent.name} trocou ${model.split('|').pop()} por ${next.split('|').pop()} (pedido de ~${Math.round(est / 1000)}k tokens não cabe na cota gratuita)`, {
            agentId: agent.id, data: { from: model, to: next, estInputTokens: est },
          })
          continue
        }
      }
      try {
        // gpt-oss is trained on function calling and emits native calls even when asked for JSON text
        const tools = opts.nativeTools && /gpt-oss/.test(model) ? TOOL_SPECS : undefined
        const c = await this.deps.complete(model, messages, signal, { json: opts.json, tools })
        modelHealth.reportSuccess(model)
        modelHealth.reportLatency(model, c.latencyMs)
        agent.calls++
        addUsage(agent.usage, c.usage)
        addUsage(this.run.usage, c.usage)
        this.emit('llm_call', `${agent.name} ← ${model.split('|').pop()} (${c.usage.inputTokens}+${c.usage.outputTokens} tokens, ${c.latencyMs} ms)`, {
          agentId: agent.id, data: { model, usage: c.usage, latencyMs: c.latencyMs },
        })
        return c.text
      } catch (e) {
        if (signal.aborted || isAbort(e)) throw abortError()
        lastError = e
        const cls = classifyModelError(e)
        modelHealth.reportFailure(model, cls.kind, cls.message, cls.retryAfterMs)
        agent.errors.push(clip(`${model.split('|').pop()}: ${cls.message}`, 300))
        this.emit('model_error', `${agent.name}: ${model.split('|').pop()} falhou (${cls.kind}): ${clip(cls.message, 200)}`, {
          agentId: agent.id, level: 'warn', data: { model, kind: cls.kind },
        })
        // The model answered in the wrong shape (e.g. a native tool call): nudge it once before switching
        if (cls.kind === 'format' && formatRetries < 1) {
          formatRetries++
          messages.push({ role: 'user', content: 'Não chame funções nem ferramentas nativas da API. Responda em texto, somente com o objeto JSON pedido.' })
          continue
        }
        tried.add(model)

        if (cls.kind === 'context') {
          // O provedor recusou o tamanho: corta pela metade do orçamento e tenta de novo
          trimHistory(messages, 4, Math.floor(contextBudgetFor(model) / 2))
          continue
        }
        if (this.run.options.autoFallback) {
          const next = replacementsFor(model, agent.roleId, await this.deps.providers(), tried, est)[0]
          if (next) {
            agent.resolvedModel = next
            this.emit('model_switched', `${agent.name} trocou ${model.split('|').pop()} por ${next.split('|').pop()}`, {
              agentId: agent.id, data: { from: model, to: next },
            })
            continue
          }
        }
        if (cls.kind === 'rate_limit' || cls.kind === 'overloaded' || cls.kind === 'network') {
          const wait = Math.min(Math.max(modelHealth.cooldownLeft(model), 3_000), 60_000)
          this.emit('model_wait', `${agent.name} aguardando ${Math.round(wait / 1000)}s pelo limite de ${model.split('|').pop()}`, { agentId: agent.id, level: 'warn' })
          await sleep(wait, signal)
          continue
        }
        throw e
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Falha ao chamar o modelo')
  }

  // ─── Prompts & shared context ──────────────────────────────────────────────

  private systemPrompt(agent: AgentRuntimeState) {
    const role = getRole(agent.roleId)
    const team = this.run.agents.filter(a => !a.removed).map(a => `- ${a.id}: ${a.name}`).join('\n')
    return `Você é ${agent.name} (${role.name}), um agente de IA numa equipe de engenharia que trabalha num projeto REAL no disco do usuário.
Responsabilidades:
${[...role.responsibilities, ...(agent.responsibilities ? [agent.responsibilities] : [])].map(r => `- ${r}`).join('\n')}

Equipe (use o id em send_message/delegate):
${team}

Regras:
- Responda SEMPRE e SOMENTE com um JSON: {"thought": "raciocínio curto", "actions": [{"tool": "nome", "args": {...}}]}. Até 6 ações por resposta.
- Leia antes de alterar. Em write_file envie o arquivo COMPLETO. Prefira edit_file para mudanças pequenas.
- Só altere arquivos do seu escopo ou dos "arquivos autorizados" da tarefa. Fora disso use request_scope ou peça ao agente responsável.
- Não apague arquivos nem rode comandos destrutivos.
- NUNCA declare algo concluído sem uma observação real de ferramenta nesta conversa. Se não executou, escreva "não executei" no resumo.
- Se uma ferramenta falhar, tente outra rota (outro comando, outro caminho, outra ferramenta) antes de reportar bloqueio; cite o erro exato.
- Antes de usar finish, verifique o resultado com read_file ou run_command (conteúdo gravado, saída do script, teste).
- Comunique descobertas, problemas e decisões com send_message. Peça revisão com kind "review_request".
- Pedido de planilha (planilha, xlsx, csv, tabela organizada) → use SEMPRE create_spreadsheet. Pedido de relatório, PDF ou documento → use SEMPRE create_report. Pedido de status da infraestrutura ("como está o meu PC/servidor", "relatório de infraestrutura") → use SEMPRE infra_report. Nunca entregue CSV via write_file como substituto de uma planilha de verdade.
- Se faltar uma capacidade (ex.: gerar imagem, editar vídeo, acessar uma API), use skill_find e, se não houver, skill_request. Ferramentas instaladas por qualquer agente ficam disponíveis para todos.
- ${role.reviewer ? 'Você valida o trabalho dos outros: verifique de verdade (leia os arquivos, rode testes quando houver) e liste em "issues" cada problema real com o papel responsável. Se estiver tudo certo, finish com status "done" e issues vazio.' : 'Quando terminar, use finish com um resumo objetivo do que mudou (arquivos e motivo).'}
- Escreva em português do Brasil.

${TOOL_DOCS}`
  }

  private taskContext(agent: AgentRuntimeState, task: AgentTask) {
    const name = (id: string) => this.agent(id)?.name || id
    const planLines = this.run.tasks.map(t => `- [${t.status}] ${t.id} (${name(t.agentId)}): ${t.title}${t.result ? ` → ${clip(t.result, 200)}` : ''}`).join('\n')
    const depResults = task.dependsOn.map(id => this.task(id)).filter(Boolean)
      .map(t => `## ${t!.id} — ${t!.title} (${name(t!.agentId)})\n${clip(t!.result || '(sem resumo)', 1500)}${t!.issues?.length ? `\nProblemas: ${t!.issues.map(i => i.description).join('; ')}` : ''}`).join('\n\n')
    const changes = this.run.changes.slice(-40).map(c => `- ${c.path} (${name(c.agentId)}, ${c.action}, +${c.added}/-${c.removed})`).join('\n')
    const inbox = this.takeInbox(agent)
    const scope = [...agent.scope, ...task.files]
    let caps = ''
    try {
      const found = getEngine().recommend(`${task.title} ${task.description} ${this.run.request}`, agent.roleId, 6)
      if (found.length) caps = `\n# Ferramentas instaladas úteis para esta tarefa (skill_use / skill_read)\n${found.map(describeExtension).join('\n')}\n`
    } catch {}
    return `# Pedido do usuário
${this.run.request}

${this.memo ? `${clip(this.memo, 6_000)}
` : ''}# Projeto
${clip(this.brief, isLocalModel(agent.resolvedModel) ? 5_000 : budgetTier(agent.resolvedModel || '') === 'tiny' ? 4_000 : 9_000)}

# Plano da equipe
${this.run.planSummary ? this.run.planSummary + '\n' : ''}${planLines}
${this.run.decisions.length ? `\n# Decisões técnicas\n${this.run.decisions.map(d => `- ${d}`).join('\n')}\n` : ''}${changes ? `\n# Arquivos já alterados pela equipe\n${changes}\n` : ''}${depResults ? `\n# Resultados das tarefas de que você depende\n${depResults}\n` : ''}
# Sua tarefa: ${task.id} — ${task.title}
${task.description}
Arquivos autorizados nesta tarefa: ${task.files.length ? task.files.join(', ') : '(nenhum específico)'}
Seu escopo de escrita: ${scope.length ? scope.join(', ') : 'somente leitura'}
${caps}${inbox ? `\n# Mensagens para você\n${inbox}\n` : ''}
Comece. Responda somente com o JSON.`
  }

  private takeInbox(agent: AgentRuntimeState) {
    const seen = this.inboxSeen.get(agent.id) || 0
    const msgs = this.run.messages.slice(seen)
    this.inboxSeen.set(agent.id, this.run.messages.length)
    return msgs
      .filter(m => m.from !== agent.id && (m.to === agent.id || m.to === 'all' || m.to === agent.roleId))
      .slice(-12)
      .map(m => `- de ${this.agent(m.from)?.name || m.from} [${m.kind}]: ${clip(m.content, 800)}`)
      .join('\n')
  }

  // ─── Tool host (coordination side of the tools) ────────────────────────────

  private toolHost(agent: AgentRuntimeState, task: AgentTask, signal: AbortSignal, approvedByUser = false): ToolHost {
    return {
      root: this.run.projectPath,
      runId: this.run.id,
      projectId: this.run.projectId,
      agent,
      task,
      signal,
      approvedByUser,
      locks: this.deps.locks,
      snapshotDir: this.deps.snapshotDir,
      extraScope: () => [
        ...task.files,
        ...this.run.scopeRequests.filter(r => r.agentId === agent.id && r.status === 'approved').map(r => r.path),
      ],
      recordChange: (rel, action, added, removed) => {
        this.run.changes.push({ path: rel, agentId: agent.id, taskId: task.id, action, added, removed, at: Date.now() })
        this.emit('file_change', `${agent.name} ${action === 'created' ? 'criou' : 'alterou'} ${rel} (+${added}/-${removed})`, {
          agentId: agent.id, taskId: task.id, data: { path: rel, action, added, removed },
        })
      },
      sendMessage: (to, kind, content) => this.sendFromAgent(agent, task, to, kind, content),
      delegate: (to, title, description, files) => this.delegate(agent, task, to, title, description, files),
      requestScope: (rel, reason) => {
        const req = { id: uuidv4(), agentId: agent.id, taskId: task.id, path: rel, reason, status: 'pending' as const, at: Date.now() }
        this.run.scopeRequests.push(req)
        this.emit('scope_request', `${agent.name} pede permissão para alterar ${rel}: ${reason}`, { agentId: agent.id, taskId: task.id, level: 'warn', data: { requestId: req.id, path: rel } })
        return 'Pedido enviado ao usuário. Continue com o que estiver no seu escopo; você será avisado por mensagem se for aprovado.'
      },
      log: (type, message, data, level) => this.emit(type, message, { agentId: agent.id, taskId: task.id, data, level }),
    }
  }

  private postMessage(from: string, to: string, kind: MessageKind, content: string, taskId?: string): AgentMessage {
    const msg: AgentMessage = { id: uuidv4(), from, to, kind, content, at: Date.now(), taskId }
    this.run.messages.push(msg)
    this.emit('message', `${this.agent(from)?.name || from} → ${to === 'all' ? 'equipe' : this.agent(to)?.name || to}: ${clip(content, 160)}`, {
      agentId: from, taskId, data: { messageId: msg.id, to, kind },
    })
    return msg
  }

  /** Resolves a recipient: agent id, role id (first live agent of that role), 'all' or 'user'. */
  private recipient(to: string): string | undefined {
    if (to === 'all' || to === 'user') return to
    const live = this.run.agents.filter(a => !a.removed)
    return live.find(a => a.id === to)?.id || live.find(a => a.roleId === to)?.id
  }

  private sendFromAgent(agent: AgentRuntimeState, task: AgentTask, toRaw: string, kind: MessageKind, content: string): string {
    const to = this.recipient(toRaw)
    if (!to) return `Destinatário "${toRaw}" não existe na equipe. Use um dos ids listados.`
    const msg = this.postMessage(agent.id, to, kind, content, task.id)
    const target = to !== 'all' && to !== 'user' ? this.agent(to) : undefined
    if (target && !this.scheduler?.isAgentBusy(target.id) && !target.paused) {
      if (kind === 'review_request') {
        this.createTask({
          title: `Revisar pedido de ${agent.name}`,
          description: `${agent.name} pediu revisão: ${content}`,
          roleId: target.roleId,
          agentId: target.id,
          kind: 'review',
          createdBy: agent.id,
          dependsOn: [],
          files: [],
        })
        return `Pedido de revisão entregue; ${target.name} vai revisar.`
      }
      if (kind === 'question') {
        void this.answerQuestion(target, agent, msg)
        return `Pergunta entregue a ${target.name}; a resposta chegará nas suas mensagens.`
      }
    }
    return 'Mensagem entregue.'
  }

  /** An idle agent answers a teammate's question with one model call. */
  private async answerQuestion(target: AgentRuntimeState, asker: AgentRuntimeState, question: AgentMessage) {
    if (this.answers >= MAX_ANSWERS || this.abort.signal.aborted) return
    this.answers++
    const prev = target.status
    this.setAgentStatus(target, 'communicating')
    try {
      if (!target.resolvedModel) await this.resolveModels([target.id])
      const text = await this.callModel(target, [
        { role: 'system', content: `Você é ${target.name} (${getRole(target.roleId).name}). Responda a pergunta de um colega de equipe de forma objetiva, em português, com base no contexto do projeto. Não use JSON.` },
        { role: 'user', content: `# Projeto\n${clip(this.brief, 4000)}\n\n# Plano\n${this.run.tasks.map(t => `- [${t.status}] ${t.id}: ${t.title}${t.result ? ` → ${clip(t.result, 200)}` : ''}`).join('\n')}\n\n# Pergunta de ${asker.name}\n${question.content}` },
      ], this.abort.signal)
      this.postMessage(target.id, asker.id, 'answer', clip(text.trim(), 3000), question.taskId)
    } catch (e) {
      if (!isAbort(e)) this.emit('error', `${target.name} não conseguiu responder: ${(e as Error).message}`, { agentId: target.id, level: 'warn' })
    } finally {
      if (target.status === 'communicating') this.setAgentStatus(target, prev === 'communicating' ? 'waiting' : prev)
    }
  }

  private delegate(agent: AgentRuntimeState, task: AgentTask, to: string, title: string, description: string, files: string[]): string {
    if (this.run.tasks.length >= MAX_TASKS) return 'Limite de tarefas desta execução atingido; resolva você mesmo ou avise o usuário.'
    let target = this.run.agents.find(a => !a.removed && (a.id === to || a.roleId === to))
    if (!target && this.run.autoTeam && ROLE_MAP.has(to)) target = this.agentForRole(to)
    if (!target) return `Ninguém com id/papel "${to}" na equipe.`
    const t = this.createTask({ title, description, roleId: target.roleId, agentId: target.id, kind: 'work', createdBy: agent.id, dependsOn: [], files })
    this.postMessage(agent.id, target.id, 'delegation', `Nova subtarefa ${t.id}: ${title}\n${description}`, t.id)
    if (target.resolvedModel === undefined) void this.resolveModels([target.id])
    return `Subtarefa ${t.id} criada para ${target.name}.`
  }

  createTask(p: Pick<AgentTask, 'title' | 'description' | 'roleId' | 'agentId' | 'kind' | 'createdBy' | 'dependsOn' | 'files'>): AgentTask {
    const t: AgentTask = { ...p, id: `t${this.run.tasks.length + 1}`, status: 'pending', createdAt: Date.now(), attempts: 0 }
    this.run.tasks.push(t)
    this.emit('task_created', `Nova tarefa ${t.id} para ${this.agent(t.agentId)?.name}: ${t.title}`, { taskId: t.id, agentId: t.agentId })
    this.scheduler?.wake()
    return t
  }

  // ─── Fix rounds & report ───────────────────────────────────────────────────

  private createFixTasks(round: number): boolean {
    const handled = new Set(this.run.handledIssues || [])
    const reports = this.run.tasks.filter(t => t.status === 'done' && t.issues?.length && !handled.has(t.id))
    if (!reports.length) return false
    const groups = new Map<string, TaskIssue[]>()
    for (const r of reports) {
      for (const issue of r.issues!) {
        const owner = this.ownerForIssue(issue)
        groups.set(owner.id, [...(groups.get(owner.id) || []), issue])
      }
      handled.add(r.id)
    }
    this.run.handledIssues = [...handled]

    const fixIds: string[] = []
    for (const [agentId, issues] of groups) {
      const a = this.agent(agentId)!
      const t = this.createTask({
        title: `Corrigir ${issues.length} problema(s) apontado(s) (rodada ${round + 1})`,
        description: `Corrija os problemas encontrados na validação:\n${issues.map(i => `- ${i.description}`).join('\n')}`,
        roleId: a.roleId, agentId, kind: 'fix', createdBy: 'orchestrator', dependsOn: [], files: [],
      })
      fixIds.push(t.id)
    }
    // Whoever reported the problems checks the fixes
    for (const reporterId of new Set(reports.map(r => r.agentId))) {
      const reporter = this.agent(reporterId)
      if (!reporter || reporter.removed) continue
      this.createTask({
        title: `Verificar correções (rodada ${round + 1})`,
        description: `Confirme se os problemas que você apontou foram corrigidos:\n${reports.filter(r => r.agentId === reporterId).flatMap(r => r.issues!).map(i => `- ${i.description}`).join('\n')}`,
        roleId: reporter.roleId, agentId: reporter.id, kind: 'verify', createdBy: 'orchestrator', dependsOn: fixIds, files: [],
      })
    }
    return true
  }

  private ownerForIssue(issue: TaskIssue): AgentRuntimeState {
    const live = this.run.agents.filter(a => !a.removed && a.enabled)
    if (issue.role) {
      const byRole = live.find(a => a.roleId === issue.role || a.id === issue.role)
      if (byRole) return byRole
      if (this.run.autoTeam && ROLE_MAP.has(issue.role)) return this.agentForRole(issue.role)
    }
    // The agent that changed the most files is the most likely owner
    const counts = new Map<string, number>()
    for (const c of this.run.changes) counts.set(c.agentId, (counts.get(c.agentId) || 0) + 1)
    const top = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0]
    return live.find(a => a.id === top) || live.find(a => !getRole(a.roleId).reviewer) || live[0]
  }

  private async writeReport() {
    const name = (id: string) => this.agent(id)?.name || id
    const facts = `# Pedido\n${this.run.request}\n\n# Complexidade\n${this.run.complexity}\n\n# Tarefas\n${this.run.tasks.map(t => `- [${t.status}] ${t.id} ${t.title} (${name(t.agentId)})${t.result ? `: ${clip(t.result, 500)}` : ''}${t.error ? ` — erro: ${t.error}` : ''}${t.issues?.length ? ` — problemas: ${t.issues.map(i => i.description).join('; ')}` : ''}`).join('\n')}\n\n# Arquivos alterados\n${this.run.changes.map(c => `- ${c.path} (${c.action}, +${c.added}/-${c.removed}, ${name(c.agentId)})`).join('\n') || '(nenhum)'}\n\n# Decisões\n${this.run.decisions.join('\n') || '(nenhuma)'}`

    const reporter = this.run.agents.find(a => a.roleId === 'architect' && !a.removed && a.resolvedModel) || this.run.agents.find(a => !a.removed && a.resolvedModel)
    if (reporter) {
      try {
        const text = await this.callModel(reporter, [
          { role: 'system', content: `Escreva o relatório final de uma execução de equipe de agentes, em português do Brasil, em Markdown. Use SOMENTE os fatos fornecidos; não invente arquivos, testes ou resultados.

Se o pedido for uma pergunta (qual, quantos, quais…), a PRIMEIRA linha é a resposta direta, com o valor que aparece nos fatos.

Seções obrigatórias, nesta ordem:
## FEITO
Liste o que foi realmente executado, com caminho de arquivo ou comando.
## VERIFICADO
Liste apenas o que foi conferido por ferramenta/observação real (arquivo relido, comando reexecutado, teste). Se nada foi verificado, escreva "Nada verificado por ferramenta".
## PENDENTE
Liste o que falta, o que falhou e o próximo passo. Se não houver nada, escreva "Nenhuma pendência".

Regras: não crie seção Resumo; não repita o pedido; não afirme teste que não aparece nos fatos.
Um arquivo só foi criado ou alterado se aparecer em "# Arquivos alterados". Se essa lista for "(nenhum)", NÃO diga em FEITO que criou, alterou ou escreveu arquivo — a tarefa pode ter se declarado concluída sem gravar nada; registre isso em PENDENTE.` },
          { role: 'user', content: facts },
        ], this.abort.signal)
        this.run.report = guardFileClaims(text.trim(), this.run.changes.length)
      } catch (e) {
        if (isAbort(e)) throw e
      }
    }
    this.run.report ||= `## Relatório\n\n${facts}`
    this.emit('report', 'Relatório final pronto')
  }

  // ─── Controls ──────────────────────────────────────────────────────────────

  pause() {
    if (['running', 'planning', 'analyzing'].includes(this.run.status)) this.setStatus('paused', 'Execução pausada')
  }

  resume() {
    if (this.run.status === 'paused') {
      this.setStatus('running', 'Execução retomada')
      this.releasePauseWaiters()
      this.scheduler?.wake()
    }
  }

  cancel() {
    if (!this.abort.signal.aborted) {
      this.emit('run_cancel', 'Cancelamento solicitado', { level: 'warn' })
      this.abort.abort()
      this.releasePauseWaiters()
      // Pedidos de aprovação pendentes não ficam pendurados: o cancelamento os encerra.
      for (const a of this.run.approvals || []) {
        if (a.status === 'pending') { a.status = 'denied'; a.decidedAt = Date.now() }
      }
      this.releaseDecisionWaiters()
    }
  }

  pauseAgent(id: string) {
    const a = this.agent(id)
    if (!a) return
    a.paused = true
    if (!a.currentTaskId) this.setAgentStatus(a, 'paused')
    this.emit('agent_pause', `${a.name} pausado`, { agentId: id })
  }

  resumeAgent(id: string) {
    const a = this.agent(id)
    if (!a) return
    a.paused = false
    this.stoppedAgents.delete(id)
    this.setAgentStatus(a, a.currentTaskId ? (getRole(a.roleId).reviewer ? 'reviewing' : 'executing') : 'waiting')
    this.releasePauseWaiters()
    this.scheduler?.wake()
  }

  /** Interrupts the agent immediately: cancels its model call / command and pauses it. */
  stopAgent(id: string) {
    const a = this.agent(id)
    if (!a) return
    a.paused = true
    this.stoppedAgents.add(id)
    this.agentAborts.get(id)?.abort()
    this.setAgentStatus(a, 'paused')
    this.emit('agent_stop', `${a.name} interrompido`, { agentId: id, level: 'warn' })
  }

  /** Clears errors, re-queues the agent's failed/cancelled tasks and lets it work again. */
  restartAgent(id: string) {
    const a = this.agent(id)
    if (!a) return
    this.agentAborts.get(id)?.abort()
    a.errors = []
    a.paused = false
    this.stoppedAgents.delete(id)
    for (const t of this.run.tasks) {
      if (t.agentId === id && (t.status === 'failed' || t.status === 'cancelled')) { t.status = 'pending'; t.error = undefined }
    }
    // Tasks that were blocked only because of this agent's failures can run again
    for (const t of this.run.tasks) if (t.status === 'blocked') { t.status = 'pending'; t.error = undefined }
    this.setAgentStatus(a, 'waiting')
    this.emit('agent_restart', `${a.name} reiniciado`, { agentId: id })
    this.releasePauseWaiters()
    this.scheduler?.wake()
  }

  addAgent(cfg: { roleId: string; model: string; name?: string; scope?: string[]; responsibilities?: string }) {
    const base = agentFromRole(cfg.roleId, `${cfg.roleId}-${uuidv4().slice(0, 4)}`, cfg.model || 'auto')
    const a = newAgentState({ ...base, name: cfg.name || base.name, scope: cfg.scope || base.scope, responsibilities: cfg.responsibilities }, this.run.options.maxSteps)
    this.run.agents.push(a)
    this.emit('agent_added', `${a.name} entrou na equipe`, { agentId: a.id })
    void this.resolveModels([a.id]).then(() => this.scheduler?.wake())
    return a
  }

  removeAgent(id: string) {
    const a = this.agent(id)
    if (!a) return
    this.stopAgent(id)
    a.removed = true
    a.enabled = false
    this.emit('agent_removed', `${a.name} saiu da equipe`, { agentId: id, level: 'warn' })
    // Its waiting work goes to a teammate of the same role (scheduler) or anyone available
    for (const t of this.run.tasks) if (t.agentId === id && t.status === 'pending') t.agentId = ''
    this.scheduler?.wake()
  }

  configureAgent(id: string, patch: { model?: string; name?: string; scope?: string[]; responsibilities?: string }) {
    const a = this.agent(id)
    if (!a) return
    if (patch.name) a.name = patch.name
    if (patch.scope) a.scope = patch.scope
    if (patch.responsibilities !== undefined) a.responsibilities = patch.responsibilities
    if (patch.model) {
      a.model = patch.model
      a.resolvedModel = patch.model === 'auto' ? undefined : patch.model
      if (patch.model === 'auto') void this.resolveModels([id])
    }
    this.emit('agent_config', `${a.name} reconfigurado${patch.model ? ` (modelo: ${patch.model === 'auto' ? 'automático' : patch.model.split('|').pop()})` : ''}`, { agentId: id })
  }

  decideScope(requestId: string, approve: boolean) {
    const req = this.run.scopeRequests.find(r => r.id === requestId)
    if (!req || req.status !== 'pending') return false
    req.status = approve ? 'approved' : 'denied'
    this.postMessage('user', req.agentId, 'user', approve
      ? `Permissão concedida para alterar ${req.path}.`
      : `Permissão negada para alterar ${req.path}. Siga sem alterar esse arquivo ou peça ao responsável.`)
    this.emit('scope_decision', `${approve ? 'Aprovado' : 'Negado'}: ${req.path}`, { agentId: req.agentId })
    return true
  }

  // ─── Aprovações de ferramenta (modos de permissão) ─────────────────────────

  /**
   * Registra o pedido e espera a decisão do usuário. Resolve com `true` quando aprovado.
   * Cancelar a execução libera a espera e devolve `false` — nada fica pendurado.
   */
  private async askApproval(agent: AgentRuntimeState, task: AgentTask, tool: string, args: Record<string, unknown>, risk: ApprovalRequest['risk'], signal: AbortSignal): Promise<boolean> {
    const req: ApprovalRequest = {
      id: uuidv4(),
      agentId: agent.id,
      taskId: task.id,
      tool,
      risk,
      summary: describeRequest(tool, args),
      args: summarizeArgs(args),
      status: 'pending',
      at: Date.now(),
    }
    this.run.approvals ??= []
    this.run.approvals.push(req)
    this.emit('approval_request', `${agent.name} pede aprovação — ${req.summary}`, {
      agentId: agent.id, taskId: task.id, level: 'warn',
      data: { approvalId: req.id, tool, risk, summary: req.summary },
    })
    this.persistNow()

    while (req.status === 'pending') {
      if (signal.aborted || this.abort.signal.aborted) {
        req.status = 'denied'
        req.decidedAt = Date.now()
        this.persistNow()
        return false
      }
      await this.waitForDecision(signal)
    }
    return req.status === 'approved'
  }

  /** Decisão do usuário sobre um pedido de ferramenta. */
  decideApproval(approvalId: string, approve: boolean) {
    const req = (this.run.approvals || []).find(a => a.id === approvalId)
    if (!req || req.status !== 'pending') return false
    req.status = approve ? 'approved' : 'denied'
    req.decidedAt = Date.now()
    this.emit('approval_decision', `${approve ? 'Aprovado' : 'Negado'} — ${req.summary}`, {
      agentId: req.agentId, taskId: req.taskId,
      data: { approvalId: req.id, approved: approve },
    })
    this.releaseDecisionWaiters()
    this.persistNow()
    return true
  }

  /** Plan Mode: libera a execução do plano apresentado. */
  approvePlan() {
    if (this.run.status !== 'awaiting_plan' || this.planDecision !== 'pending') return false
    this.planDecision = 'approved'
    this.run.planApprovedAt = Date.now()
    this.emit('plan_approved', 'Plano aprovado pelo usuário — iniciando a execução')
    this.releaseDecisionWaiters()
    return true
  }

  /** Plan Mode: descarta o plano e encerra sem tocar no projeto. */
  rejectPlan() {
    if (this.run.status !== 'awaiting_plan' || this.planDecision !== 'pending') return false
    this.planDecision = 'rejected'
    this.emit('plan_rejected', 'Plano recusado pelo usuário — nada foi alterado no projeto')
    this.cancel()
    return true
  }

  /**
   * Espera um despertar: uma decisão do usuário ou o cancelamento.
   *
   * O listener de abort é removido ao fim de CADA espera. Antes ele era
   * registrado com `{ once: true }` a cada volta do laço e só sairia se o abort
   * disparasse — como toda decisão acorda todos os que esperam, um agente
   * parado acumulava um listener por despertar até o Node reclamar.
   */
  private waitForDecision(signal: AbortSignal): Promise<void> {
    return new Promise<void>(resolve => {
      let done = false
      const finish = () => {
        if (done) return
        done = true
        signal.removeEventListener('abort', finish)
        resolve()
      }
      this.decisionWaiters.push(finish)
      signal.addEventListener('abort', finish)
    })
  }

  private releaseDecisionWaiters() {
    const w = this.decisionWaiters
    this.decisionWaiters = []
    for (const r of w) r()
  }

  userMessage(to: string, content: string) {
    const target = to === 'all' ? 'all' : this.recipient(to)
    if (!target) throw new Error('Agente não encontrado')
    this.postMessage('user', target, 'user', content)
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => { clearTimeout(t); reject(abortError()) }, { once: true })
  })
}

function isLocalModel(model?: string) {
  return !!model && (model.startsWith('ollama|') || model.startsWith('lmstudio|'))
}

/**
 * Character budget per model. Local models often run with 4k–8k tokens of context;
 * 16k characters (~4k tokens) keeps the prompt small enough for the ~16k-token free
 * tiers of cloud providers and well inside their per-minute budgets.
 */
function contextBudgetFor(model?: string) {
  return isLocalModel(model) ? 12_000 : 16_000
}

function historyChars(history: ChatMessage[]) {
  return history.reduce((sum, m) => sum + m.content.length, 0)
}

/**
 * Keeps the system prompt, the task context and the most recent exchanges within a
 * character budget. Removes a pair (assistant + observation) at a time so the
 * conversation never starts with two messages of the same role.
 */
function trimHistory(history: ChatMessage[], keepRecent = 10, maxChars = 28_000) {
  const minKeep = 4
  while (
    history.length > 2 + minKeep &&
    (history.length > 2 + keepRecent || historyChars(history) > maxChars)
  ) {
    history.splice(2, 2)
  }
}

function describeArgs(args: Record<string, unknown>) {
  const key = args.path ?? args.command ?? args.query ?? args.to
  return key ? ` ${clip(String(key), 80)}` : ''
}

function summarizeArgs(args: Record<string, unknown>) {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(args)) out[k] = typeof v === 'string' ? clip(v, 200) : v
  return out
}

/** Removes dependency edges that would form a cycle (keeps the plan runnable). */
export function breakCycles(tasks: Array<{ id: string; dependsOn: string[] }>) {
  const byId = new Map(tasks.map(t => [t.id, t]))
  const state = new Map<string, 0 | 1 | 2>()
  const visit = (t: { id: string; dependsOn: string[] }) => {
    state.set(t.id, 1)
    t.dependsOn = t.dependsOn.filter(d => {
      const dep = byId.get(d)
      if (!dep) return false
      const s = state.get(d) || 0
      if (s === 1) return false
      if (s === 0) visit(dep)
      return true
    })
    state.set(t.id, 2)
  }
  for (const t of tasks) if (!state.get(t.id)) visit(t)
}

/** Compact view of the project for prompts: directory tree plus key manifest files. */
export function buildProjectBrief(root: string) {
  const lines: string[] = []
  const walk = (dir: string, depth: number, prefix: string) => {
    if (lines.length > 160) return
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    for (const e of entries) {
      if (IGNORED_DIRS.has(e.name) || e.name.startsWith('.git')) continue
      if (lines.length > 160) { lines.push(`${prefix}…`); return }
      lines.push(`${prefix}${e.name}${e.isDirectory() ? '/' : ''}`)
      if (e.isDirectory() && depth < 3) walk(path.join(dir, e.name), depth + 1, prefix + '  ')
    }
  }
  walk(root, 1, '')
  const key = ['package.json', 'README.md', 'pyproject.toml', 'requirements.txt', 'tsconfig.json']
    .filter(f => fs.existsSync(path.join(root, f)))
    .map(f => `## ${f}\n${clip(fs.readFileSync(path.join(root, f), 'utf-8'), 1500)}`)
  return `Raiz: ${root}\n\n## Estrutura\n${lines.join('\n') || '(pasta vazia)'}\n\n${key.join('\n\n')}`
}
