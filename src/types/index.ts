export type MessageRole = 'user' | 'assistant' | 'system' | 'tool'

export interface Message {
  id: string
  role: MessageRole
  content: string
  createdAt: number
  metadata?: Record<string, unknown>
  model?: string
  tokens?: number
  toolCalls?: ToolCall[]
  /** Set on the synthetic assistant message that embeds a live agent run in the chat. */
  run?: { id: string; sessionId: string }
  /** Set on the synthetic assistant message that embeds a live video production in the chat. */
  video?: { jobId: string }
  /** Set on the synthetic assistant message that embeds a generated image in the chat. */
  image?: { url: string; prompt: string }
  /** What a reasoning model thought before answering, streamed live (not saved). */
  reasoning?: string
  /** Measured by the client while streaming: first visible token and whole answer, in ms. */
  stats?: { firstMs?: number; totalMs?: number }
  /**
   * Id desta mensagem no servidor. O id local é gerado pelo navegador e não
   * existe no armazenamento; editar e regenerar só são oferecidos quando este
   * campo é conhecido, para nunca cortar a conversa no ponto errado.
   */
  serverId?: string
}

export interface Conversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  model: string
  messageCount: number
  metadata?: Record<string, unknown>
}

export interface AIModel {
  id: string
  name: string
  provider: string
  providerName: string
  category: 'chat' | 'code' | 'vision' | 'reasoning' | 'fast' | 'local' | 'search'
  contextWindow: number
  maxTokens: number
  free: boolean
  multimodal: boolean
  toolSupport: boolean
  streaming: boolean
  speed: 'fast' | 'medium' | 'slow'
  status: 'available' | 'unavailable' | 'unknown'
  description?: string
  note?: string
  /** Local models only: already in GPU/RAM (answers in ~1 s) vs. cold (seconds to minutes of loading) */
  loaded?: boolean
}

export interface Provider {
  id: string
  name: string
  icon: string
  baseUrl?: string
  envKey: string
  models: AIModel[]
  free: boolean
  status: 'connected' | 'disconnected' | 'no-key'
}

export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
  result?: string
  status: 'running' | 'done' | 'error'
}

export interface MemoryEntry {
  id: string
  type: 'fact' | 'preference' | 'project' | 'task' | 'context'
  content: string
  tags: string[]
  createdAt: number
  updatedAt: number
  relevance: number
}

export interface Project {
  id: string
  name: string
  description: string
  path: string
  createdAt: number
  metadata?: Record<string, unknown>
}

export interface Skill {
  id: string
  name: string
  description: string
  source: string
  content: string
  enabled: boolean
  createdAt: number
  tags?: string[]
}

export interface ExecuteResult {
  stdout: string
  stderr: string
  exitCode: number
  duration: number
  command: string
  cwd: string
}

export interface ChatRequest {
  conversationId?: string
  messages: { role: MessageRole; content: string }[]
  model: string
  systemPrompt?: string
  tools?: boolean
  stream?: boolean
}

export interface AgentTask {
  id: string
  title: string
  status: 'pending' | 'running' | 'done' | 'error'
  steps: AgentStep[]
  createdAt: number
}

export interface AgentStep {
  id: string
  title: string
  status: 'pending' | 'running' | 'done' | 'error'
  output?: string
  tool?: string
}
