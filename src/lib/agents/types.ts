// Shared by the server runtime and the UI. Keep free of Node-only imports.

export type SessionKind = 'chat' | 'team'
export type SessionStatus = 'active' | 'paused' | 'completed'

export interface Project {
  id: string
  name: string
  /** Absolute folder on disk. Empty for the default "Geral" project (chat only). */
  path: string
  createdAt: number
}

export interface SessionMeta {
  id: string
  title: string
  model: string
  projectId: string
  kind: SessionKind
  status: SessionStatus
  archived: boolean
  createdAt: number
  updatedAt: number
  messageCount: number
  /** A chat stream or an agent run is executing right now. */
  running: boolean
  teamId?: string
}

export type ModelHint = 'strong' | 'code' | 'fast'

export interface RoleTemplate {
  id: string
  name: string
  icon: string
  color: string
  responsibilities: string[]
  /** Glob patterns (relative to the project root) this role may write to. Empty = read-only. */
  scope: string[]
  modelHint: ModelHint
  /** Reviewer-type roles report issues instead of writing code. */
  reviewer?: boolean
}

export interface AgentConfig {
  id: string
  name: string
  roleId: string
  /** Extra, user-written responsibilities appended to the role's. */
  responsibilities?: string
  /** 'auto' or a catalog id such as "groq|openai/gpt-oss-120b". */
  model: string
  scope: string[]
  enabled: boolean
  color?: string
}

export interface Team {
  id: string
  name: string
  description: string
  agents: AgentConfig[]
  preset?: boolean
  createdAt: number
  updatedAt: number
}

export interface Usage {
  inputTokens: number
  outputTokens: number
  /** USD, only when the provider reports it. */
  cost?: number
  /** Token counts were estimated from text length (provider did not report usage). */
  estimated?: boolean
}

export type AgentStatus =
  | 'waiting'
  | 'planning'
  | 'executing'
  | 'communicating'
  | 'reviewing'
  | 'paused'
  | 'done'
  | 'failed'

export interface AgentRuntimeState extends AgentConfig {
  status: AgentStatus
  resolvedModel?: string
  currentTaskId?: string
  step: number
  maxSteps: number
  usage: Usage
  calls: number
  errors: string[]
  activeMs: number
  paused: boolean
  removed?: boolean
  /** Agent was part of the team but the plan did not need it. */
  idleReason?: string
  /** Model health indicator from the global modelHealth tracker. */
  modelHealth?: 'ok' | 'cooling' | 'unavailable'
  /** Tempo desde a última atividade do agente (segundos). */
  lastActivityMs?: number
  /** Cor personalizada para a visualização da interface. */
  interfaceColor?: string
}

export type TaskStatus = 'pending' | 'running' | 'done' | 'failed' | 'blocked' | 'cancelled'

export interface TaskIssue {
  description: string
  role?: string
}

export interface AgentTask {
  id: string
  title: string
  description: string
  agentId: string
  roleId: string
  dependsOn: string[]
  /** Paths the planner explicitly authorised this task to write. */
  files: string[]
  status: TaskStatus
  kind: 'work' | 'fix' | 'verify' | 'review'
  result?: string
  issues?: TaskIssue[]
  error?: string
  createdBy: string
  createdAt: number
  startedAt?: number
  finishedAt?: number
  attempts: number
}

export type MessageKind =
  | 'info'
  | 'question'
  | 'answer'
  | 'problem'
  | 'review_request'
  | 'delegation'
  | 'decision'
  | 'done'
  | 'user'

export interface AgentMessage {
  id: string
  from: string
  to: string
  kind: MessageKind
  content: string
  at: number
  taskId?: string
  /** Cor do avatar para o chat de agentes */
  agentColor?: string
}

/** Dados resumidos para exibição no dashboard de multiagentes. */
export interface AgentDashboardEntry {
  agentId: string
  name: string
  role: string
  model: string
  status: AgentStatus
  taskCount: number
  completedCount: number
  failedCount: number
  isActive: boolean
  latencyMs?: number
  color: string
}

export interface FileChange {
  path: string
  agentId: string
  taskId: string
  action: 'created' | 'modified'
  added: number
  removed: number
  at: number
}

export interface ScopeRequest {
  id: string
  agentId: string
  taskId?: string
  path: string
  reason: string
  status: 'pending' | 'approved' | 'denied'
  at: number
}

export type RunStatus =
  | 'queued'
  | 'analyzing'
  | 'planning'
  | 'running'
  | 'paused'
  | 'integrating'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted'

export type Complexity = 'trivial' | 'small' | 'medium' | 'large'

export interface RunOptions {
  maxParallel: number
  maxSteps: number
  fixRounds: number
  autoFallback: boolean
}

export interface RunEvent {
  id: number
  at: number
  type: string
  level: 'info' | 'warn' | 'error'
  message: string
  agentId?: string
  taskId?: string
  data?: Record<string, unknown>
}

export interface Run {
  id: string
  sessionId: string
  projectId: string
  projectPath: string
  request: string
  status: RunStatus
  complexity?: Complexity
  planSummary?: string
  teamId?: string
  autoTeam: boolean
  agents: AgentRuntimeState[]
  tasks: AgentTask[]
  messages: AgentMessage[]
  changes: FileChange[]
  scopeRequests: ScopeRequest[]
  decisions: string[]
  report?: string
  error?: string
  options: RunOptions
  usage: Usage
  rolledBack?: boolean
  /** Ids of review/QA tasks whose issues already produced fix tasks. */
  handledIssues?: string[]
  createdAt: number
  startedAt?: number
  finishedAt?: number
  eventCount: number
}

export const ACTIVE_RUN_STATUSES: RunStatus[] = ['queued', 'analyzing', 'planning', 'running', 'paused', 'integrating']

export const DEFAULT_RUN_OPTIONS: RunOptions = {
  maxParallel: 4,
  maxSteps: 14,
  fixRounds: 1,
  autoFallback: true,
}
