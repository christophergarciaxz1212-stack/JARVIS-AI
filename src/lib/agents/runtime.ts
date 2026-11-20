import { v4 as uuidv4 } from 'uuid'
import { addMessage, createConversation, deleteConversations, DEFAULT_PROJECT_ID, getSession, updateSession } from '../db'
import { FileLockManager } from './locks'
import { defaultComplete, liveProviders, type CompleteFn } from './models'
import { newAgentState, RunController } from './orchestrator'
import { agentFromRole } from './roles'
import {
  appendEvent, deleteSessionData, findRun, getProject, getTeam, listActiveRunsOnDisk, listRuns, loadRun, saveRun, snapshotDir,
} from './store'
import { rollbackSnapshots } from './tools'
import { withRecovery, withRecoverySync } from '../infra/reliability'
import type { Provider as LiveProvider } from '@/types'
import type { Run, RunOptions, SessionStatus } from './types'
import { ACTIVE_RUN_STATUSES, DEFAULT_RUN_OPTIONS } from './types'

export interface StartRunInput {
  sessionId?: string
  projectId: string
  request: string
  teamId?: string
  options?: Partial<RunOptions>
}

/**
 * Single per-process registry. Next.js can load a module once per route bundle, so the
 * instance lives on globalThis: every route sees the same runs, locks and chat streams.
 */
export class AgentRuntime {
  readonly locks = new FileLockManager()
  readonly runs = new Map<string, RunController>()
  readonly chatStreams = new Map<string, AbortController>()
  complete: CompleteFn = defaultComplete
  providers: () => Promise<LiveProvider[]> = liveProviders
  private recovered = false

  /** Runs that were active when the app closed can't still be running: mark them interrupted. */
  recover() {
    if (this.recovered) return
    this.recovered = true
    void withRecovery(() => {
      for (const run of listActiveRunsOnDisk()) {
        if (this.runs.has(run.id)) continue
        run.status = 'interrupted'
        for (const t of run.tasks) if (t.status === 'running') t.status = 'pending'
        for (const a of run.agents) if (!['done', 'failed'].includes(a.status)) a.status = 'paused'
        saveRun(run)
        try { updateSession(run.sessionId, { status: 'paused' }) } catch {}
      }
    }, {
      label: 'recuperação de execução', retries: 2, retryDelayMs: 50,
      shouldRetry: error => ['EBUSY', 'EAGAIN', 'EMFILE'].includes((error as NodeJS.ErrnoException)?.code || ''),
    })
  }

  private controllerFor(run: Run) {
    const ctrl = new RunController(run, {
      complete: (...args) => this.complete(...args),
      providers: () => this.providers(),
      locks: this.locks,
      snapshotDir: snapshotDir(run.sessionId, run.id),
      persist: r => saveRun(r),
      appendEvent: e => appendEvent(run.sessionId, run.id, e),
      onSettled: r => this.onSettled(r),
    })
    this.runs.set(run.id, ctrl)
    return ctrl
  }

  private onSettled(run: Run) {
    const status: SessionStatus = run.status === 'paused' || run.status === 'interrupted' ? 'paused' : 'completed'
    try {
      updateSession(run.sessionId, { status })
      if (run.report && getSession(run.sessionId)) {
        addMessage({ id: uuidv4(), conversationId: run.sessionId, role: 'assistant', content: run.report, model: 'equipe' })
      }
    } catch {}
    // Keep finished controllers briefly so late SSE subscribers still get the final state
    setTimeout(() => { if (this.runs.get(run.id)?.run === run) this.runs.delete(run.id) }, 60_000)
  }

  startRun(input: StartRunInput): RunController {
    const project = getProject(input.projectId)
    if (!project || !project.path) throw new Error('Escolha um projeto com uma pasta no disco para a equipe trabalhar')
    const request = input.request?.trim()
    if (!request) throw new Error('Descreva o que a equipe deve fazer')

    let sessionId = input.sessionId
    if (!sessionId || !getSession(sessionId)) {
      sessionId = uuidv4()
      createConversation(sessionId, 'equipe', request.slice(0, 60) + (request.length > 60 ? '...' : ''), { projectId: project.id, kind: 'team', teamId: input.teamId })
    }
    if (this.activeRunForSession(sessionId)) throw new Error('Esta sessão já tem uma execução em andamento')

    const options = { ...DEFAULT_RUN_OPTIONS, ...input.options }
    const team = input.teamId ? getTeam(input.teamId) : undefined
    if (input.teamId && !team) throw new Error('Equipe não encontrada')

    const run: Run = {
      id: uuidv4(),
      sessionId,
      projectId: project.id,
      projectPath: project.path,
      request,
      status: 'queued',
      teamId: team?.id,
      autoTeam: !team,
      agents: team
        ? team.agents.filter(a => a.enabled).map(a => newAgentState({ ...agentFromRole(a.roleId, a.id, a.model), ...a }, options.maxSteps))
        : [],
      tasks: [],
      messages: [],
      changes: [],
      scopeRequests: [],
      decisions: [],
      options,
      usage: { inputTokens: 0, outputTokens: 0 },
      createdAt: Date.now(),
      eventCount: 0,
    }
    saveRun(run)
    addMessage({ id: uuidv4(), conversationId: sessionId, role: 'user', content: request })
    updateSession(sessionId, { status: 'active', team_id: team?.id })

    const ctrl = this.controllerFor(run)
    void ctrl.start()
    return ctrl
  }

  /** Continues a paused/interrupted/failed run from where it stopped (completed tasks are kept). */
  resumeRun(runId: string): RunController {
    const live = this.runs.get(runId)
    if (live && !live.abort.signal.aborted && ACTIVE_RUN_STATUSES.includes(live.run.status)) {
      live.resume()
      return live
    }
    const run = live?.run || findRun(runId)
    if (!run) throw new Error('Execução não encontrada')
    if (this.activeRunForSession(run.sessionId)) throw new Error('Esta sessão já tem uma execução em andamento')
    run.status = 'queued'
    run.error = undefined
    run.finishedAt = undefined
    for (const t of run.tasks) if (['running', 'cancelled', 'blocked', 'failed'].includes(t.status)) { t.status = 'pending'; t.error = undefined }
    for (const a of run.agents) { a.paused = false; if (a.status !== 'done') a.status = 'waiting' }
    updateSession(run.sessionId, { status: 'active' })
    const ctrl = this.controllerFor(run)
    void ctrl.start()
    return ctrl
  }

  activeRunForSession(sessionId: string) {
    return [...this.runs.values()].find(c => c.run.sessionId === sessionId && ACTIVE_RUN_STATUSES.includes(c.run.status) && !c.abort.signal.aborted)
  }

  isSessionRunning(sessionId: string) {
    return !!this.activeRunForSession(sessionId) || this.chatStreams.has(sessionId)
  }

  getRun(runId: string): Run | undefined {
    return this.runs.get(runId)?.run || findRun(runId)
  }

  /** Cancels the session's run and/or chat stream and waits (bounded) for everything to stop. */
  async stopSession(sessionId: string, timeoutMs = 15_000) {
    this.chatStreams.get(sessionId)?.abort()
    this.chatStreams.delete(sessionId)
    const ctrls = [...this.runs.values()].filter(c => c.run.sessionId === sessionId)
    for (const c of ctrls) c.cancel()
    await Promise.race([Promise.allSettled(ctrls.map(c => c.done)), new Promise(r => setTimeout(r, timeoutMs))])
    for (const c of ctrls) this.locks.releasePrefix(`${c.run.id}:`)
    return ctrls.length
  }

  /**
   * Permanently removes sessions: stops their work, releases locks, deletes conversation,
   * messages, runs, logs and snapshots. Project files are never touched.
   */
  async deleteSessions(ids: string[]) {
    for (const id of ids) await this.stopSession(id)
    const rows = deleteConversations(ids)
    let dataDirs = 0
    for (const id of ids) {
      for (const c of [...this.runs.values()]) if (c.run.sessionId === id) this.runs.delete(c.run.id)
      if (deleteSessionData(id)) dataDirs++
    }
    return { sessions: rows.conversations, messages: rows.messages, dataDirs }
  }

  /** Restores the project files a run changed (originals back, created files removed). */
  rollback(runId: string) {
    const run = this.getRun(runId)
    if (!run) throw new Error('Execução não encontrada')
    if (ACTIVE_RUN_STATUSES.includes(run.status) && this.runs.get(runId) && !this.runs.get(runId)!.abort.signal.aborted) {
      throw new Error('Pare a execução antes de reverter as alterações')
    }
    const result = withRecoverySync(() => {
      const out = rollbackSnapshots(run.projectPath, snapshotDir(run.sessionId, run.id))
      run.rolledBack = true
      saveRun(run)
      return out
    }, { label: 'rollback de projeto', retries: 1 })
    return result
  }

  listSessionRuns(sessionId: string) {
    return listRuns(sessionId).map(r => this.runs.get(r.id)?.run || r)
  }

  loadRunFromDisk(sessionId: string, runId: string) {
    return loadRun(sessionId, runId)
  }
}

const g = globalThis as unknown as { __jarvisAgentRuntime?: AgentRuntime }

export function getRuntime(): AgentRuntime {
  if (!g.__jarvisAgentRuntime) {
    g.__jarvisAgentRuntime = new AgentRuntime()
    g.__jarvisAgentRuntime.recover()
  }
  return g.__jarvisAgentRuntime
}

export { DEFAULT_PROJECT_ID }
