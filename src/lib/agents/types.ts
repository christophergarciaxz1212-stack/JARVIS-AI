// Shared by the server runtime and the UI. Keep free of Node-only imports.

import type { PermissionMode, ToolRisk } from './permissions'

export type SessionKind = 'chat' | 'team'
export type SessionStatus = 'active' | 'paused' | 'completed' | 'failed'

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
  /** Líder da equipe: coordena os outros agentes e verifica as entregas deles. */
  leader?: boolean
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
  /** Depois disso o agente é ignorado pelo scheduler (fim de falha retryável). */
  cooldownUntil?: number
  /** Pergunta do líder pendente à espera de resposta do usuário (E2). */
  pendingReply?: { id: string; question: string; at: number }
  /** Setado quando o thought do agente começa com 'ag()'. */
  pendingThought?: boolean
  removed?: boolean
  /** Agent was part of the team but the plan did not need it. */
  idleReason?: string
  /** Model health indicator from the global modelHealth tracker. */
  modelHealth?: 'ok' | 'cooling' | 'unavailable'
  /** Tempo desde a última atividade do agente (segundos). */
  lastActivityMs?: number
  /** Cor personalizada para a visualização da interface. */
  interfaceColor?: string
  /** Progresso do agente atual (0-100); -1 quando desconhecido. */
  progress?: number
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
  /** Progresso estimado da execução: 0-100; -1 = sem estimativa. */
  progress?: number
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
  /** Marcado pelo MessageBus quando o agente leu (m.read = true no markRead). */
  read?: boolean
  /** Cor do avatar para o chat de agentes */
  agentColor?: string
  /** Agentes que já leram esta mensagem (E2). */
  readBy?: string[]
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

/**
 * Pedido de aprovação de UMA chamada de ferramenta, decidido pelo usuário na conversa.
 * Vale só para essa chamada: aprovar uma exclusão agora não autoriza a próxima.
 */
export interface ApprovalRequest {
  id: string
  agentId: string
  taskId?: string
  /** Nome da ferramenta (ex.: 'run_command'). */
  tool: string
  /** Peso da ação, usado para o rótulo e o destaque na interface. */
  risk: ToolRisk
  /** Frase curta em português do que será feito. */
  summary: string
  /** Argumentos já resumidos — nunca contém segredos. */
  args: Record<string, unknown>
  status: 'pending' | 'approved' | 'denied'
  at: number
  decidedAt?: number
}

/** Estado de uma chamada de ferramenta, para a visualização ao vivo no chat. */
export type ToolCallStatus = 'aguardando' | 'executando' | 'concluido' | 'falhou' | 'cancelado' | 'aprovacao'

export type RunStatus =
  | 'queued'
  | 'analyzing'
  | 'planning'
  /** Plan Mode: o plano está pronto e espera o usuário aprovar antes de executar. */
  | 'awaiting_plan'
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
  /** Quanta autonomia o agente tem nesta execução. */
  permissionMode: PermissionMode
  /** Plan Mode: investiga e apresenta o plano, mas só executa depois do "aprovar". */
  planFirst: boolean
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
  /** Aprovações de ferramenta pedidas ao usuário (execuções antigas podem não ter o campo). */
  approvals?: ApprovalRequest[]
  /**
   * Quando o usuário aprovou o plano no Plan Mode. Fica no run (e não só na
   * memória do controlador) porque uma execução retomada precisa lembrar que
   * ainda NÃO foi aprovada — senão o portão seria pulado na retomada.
   */
  planApprovedAt?: number
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

export const ACTIVE_RUN_STATUSES: RunStatus[] = ['queued', 'analyzing', 'planning', 'awaiting_plan', 'running', 'paused', 'integrating']

export const DEFAULT_RUN_OPTIONS: RunOptions = {
  maxParallel: 4,
  maxSteps: 14,
  fixRounds: 1,
  autoFallback: true,
  /**
   * Padrão de quem NÃO escolhe: mantém o comportamento histórico do runtime
   * (o agente escreve e roda comandos, e o destrutivo ainda pede aprovação).
   * Quem tem usuário na frente — o chat e o workspace — manda o modo escolhido
   * nas preferências, que começa em "supervisionado".
   */
  permissionMode: 'autonomo',
  planFirst: false,
}

/** Execuções paradas esperando uma decisão do usuário (plano ou aprovação de ferramenta). */
export function isAwaitingUser(run: Pick<Run, 'status' | 'approvals' | 'scopeRequests'>): boolean {
  if (run.status === 'awaiting_plan') return true
  if ((run.approvals || []).some(a => a.status === 'pending')) return true
  return (run.scopeRequests || []).some(r => r.status === 'pending')
}
