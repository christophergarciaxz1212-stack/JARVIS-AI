// Dependency-aware parallel task scheduler. Pure logic: the orchestrator supplies hooks.

export interface SchedTask {
  id: string
  status: 'pending' | 'running' | 'done' | 'failed' | 'blocked' | 'cancelled'
  dependsOn: string[]
  agentId: string
  roleId: string
  createdAt: number
}

export interface SchedAgent {
  id: string
  roleId: string
  enabled: boolean
  paused: boolean
  removed?: boolean
}

export interface SchedulerHooks {
  tasks(): SchedTask[]
  agents(): SchedAgent[]
  maxParallel(): number
  isPaused(): boolean
  signal: AbortSignal
  /** Runs the task to completion; must leave it in a terminal status. */
  execute(task: SchedTask, agentId: string): Promise<void>
  onBlocked(task: SchedTask, reason: string): void
  onReassign?(task: SchedTask, fromAgentId: string, toAgentId: string): void
}

const DEAD = new Set(['failed', 'blocked', 'cancelled'])

export class Scheduler {
  private running = new Map<string, Promise<void>>()
  private busy = new Set<string>()
  private wakeUp: (() => void) | null = null
  private pendingWake = false

  constructor(private hooks: SchedulerHooks) {}

  /** Call when tasks are added, an agent is resumed/added, or the run is unpaused. */
  wake() {
    if (this.wakeUp) { const w = this.wakeUp; this.wakeUp = null; w() } else this.pendingWake = true
  }

  isAgentBusy(agentId: string) {
    return this.busy.has(agentId)
  }

  runningCount() {
    return this.running.size
  }

  private usable(a: SchedAgent) {
    return a.enabled && !a.paused && !a.removed && !this.busy.has(a.id)
  }

  private chooseAgent(task: SchedTask, agents: SchedAgent[]): string | undefined {
    const assigned = agents.find(a => a.id === task.agentId)
    if (assigned && this.usable(assigned)) return assigned.id
    // Assigned agent busy/paused/removed: another idle agent with the same role may take it
    const sameRole = agents.find(a => a.roleId === task.roleId && this.usable(a))
    if (sameRole) return sameRole.id
    // Nobody of that role exists any more: any idle agent rather than stalling the run
    if (!assigned || assigned.removed) return agents.find(a => this.usable(a))?.id
    return undefined
  }

  private waitForChange() {
    if (this.pendingWake) { this.pendingWake = false; return Promise.resolve() }
    return new Promise<void>(resolve => { this.wakeUp = resolve })
  }

  async run() {
    const { signal } = this.hooks
    const onAbort = () => this.wake()
    signal.addEventListener('abort', onAbort)
    try {
      while (!signal.aborted) {
        const tasks = this.hooks.tasks()
        const byId = new Map(tasks.map(t => [t.id, t]))

        for (const t of tasks) {
          if (t.status !== 'pending') continue
          const deadDep = t.dependsOn.map(id => byId.get(id)).find(d => !d || DEAD.has(d.status))
          if (deadDep !== undefined) {
            this.hooks.onBlocked(t, deadDep ? `Depende de "${deadDep.id}", que terminou como ${deadDep.status}` : 'Depende de uma tarefa inexistente')
          }
        }

        const ready = this.hooks.tasks()
          .filter(t => t.status === 'pending' && !this.running.has(t.id))
          .filter(t => t.dependsOn.every(id => byId.get(id)?.status === 'done'))
          .sort((a, b) => a.createdAt - b.createdAt)

        if (!this.hooks.isPaused()) {
          const agents = this.hooks.agents()
          for (const t of ready) {
            if (this.running.size >= this.hooks.maxParallel()) break
            const agentId = this.chooseAgent(t, agents)
            if (!agentId) continue
            if (agentId !== t.agentId) this.hooks.onReassign?.(t, t.agentId, agentId)
            this.busy.add(agentId)
            const p = this.hooks.execute(t, agentId)
              .catch(() => {})
              .finally(() => {
                this.running.delete(t.id)
                this.busy.delete(agentId)
                this.wake()
              })
            this.running.set(t.id, p)
          }
        }

        const pending = this.hooks.tasks().filter(t => t.status === 'pending')
        if (this.running.size === 0) {
          if (!pending.length) break
          if (!this.hooks.isPaused()) {
            const anyReady = pending.some(t => t.dependsOn.every(id => byId.get(id)?.status === 'done'))
            const waitingOnAgent = anyReady // ready but no usable agent (paused by the user): wait for a resume
            if (!anyReady) {
              // Nothing running and nothing can ever become ready: dependency cycle
              for (const t of pending) this.hooks.onBlocked(t, 'Dependência circular ou não resolvida')
              continue
            }
            if (waitingOnAgent && !this.hooks.agents().some(a => a.enabled && !a.removed)) {
              for (const t of pending) this.hooks.onBlocked(t, 'Nenhum agente disponível')
              continue
            }
          }
        }
        await this.waitForChange()
      }
    } finally {
      signal.removeEventListener('abort', onAbort)
      await Promise.allSettled([...this.running.values()])
    }
  }
}
