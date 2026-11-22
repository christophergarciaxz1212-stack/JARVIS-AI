// Barril de mensagens da equipe: envio, inbox, marcação de lidas e espera por respostas.
// O log de mensagens é o `run.messages` — lido e escrito por closures do RunController.

import { v4 as uuidv4 } from 'uuid'
import type { AgentMessage, MessageKind } from './types'

/** Um `AgentMessage` com a flag `read` resolvida para o agente que a leu. */
export interface BusMessage extends AgentMessage {
  read?: boolean
}

export interface BusSendOptions {
  taskId?: string
  priority?: number
}

const POLL_MS = 100
const DEFAULT_TIMEOUT_MS = 30_000

function delay(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms))
}

export class MessageBus {
  /** agentId → ids das mensagens que esse agente marcou como lidas. */
  private readBy = new Map<string, Set<string>>()
  /** Ordem de gravação, para desempatar ordenações iguais de `at`. */
  private seq = 0
  private ids: Map<string, number>

  constructor(
    private readonly readMessages: () => AgentMessage[],
    private readonly writeMessage: (m: AgentMessage) => void,
    ids?: Map<string, number>,
    /** Chamado por post() depois de gravar — notificação opcional de envio. */
    private readonly onPost?: (m: AgentMessage) => void,
  ) {
    this.ids = ids || new Map()
  }

  /** Grava uma mensagem (id e `at` novos) e devolve a mensagem gravada. */
  post(msg: Omit<AgentMessage, 'id' | 'at'> & { priority?: number }): AgentMessage {
    const { priority, ...rest } = msg
    const existing = this.readMessages()
    const lastAt = existing.reduce((max, m) => Math.max(max, m.at || 0), 0)
    const message: AgentMessage = { ...rest, id: uuidv4(), at: Math.max(Date.now(), lastAt + 1) }
    this.writeMessage(message)
    this.ids.set(message.id, ++this.seq)
    this.onPost?.(message)
    return message
  }

  /** Envia uma mensagem de um agente para um destino (id do agente, papel ou "all"). */
  send(from: string, to: string, kind: MessageKind, content: string, opts?: BusSendOptions): AgentMessage {
    return this.post({ from, to, kind, content, taskId: opts?.taskId, priority: opts?.priority })
  }

  /** Inbox de um agente: mensagens endereçadas a ele (ou "all"), mais recentes primeiro. */
  inbox(agentId: string): AgentMessage[] {
    return this.readMessages()
      .filter(m => m.to === agentId || m.to === 'all')
      .sort((a, b) => (b.at || 0) - (a.at || 0) || (this.ids.get(b.id) || 0) - (this.ids.get(a.id) || 0))
  }

  /** As mensagens do inbox que o agente ainda não leu. */
  unseen(agentId: string): AgentMessage[] {
    return this.inbox(agentId).filter(m => !this.readBy.get(agentId)?.has(m.id))
  }

  markRead(agentId: string, ids: string[]): void {
    let set = this.readBy.get(agentId)
    if (!set) { set = new Set(); this.readBy.set(agentId, set) }
    for (const id of ids) {
      set.add(id)
      // (readBy tracks reads in memory; run.messages stay the source of truth)
    }
  }

  markAllRead(agentId: string): void {
    this.markRead(agentId, this.inbox(agentId).map(m => m.id))
  }

  /** Nota do usuário no log: `to='user'`. */
  userNote(content: string, opts?: { priority?: number }): AgentMessage {
    return this.post({ from: 'user', to: 'user', kind: 'user', content, priority: opts?.priority })
  }

  /** Mensagens que um agente envia de volta para o usuário. */
  repliesFor(id: string): AgentMessage[] {
    return this.readMessages().filter(m => m.to === 'user' && m.from === id)
  }

  /**
   * Primeira mensagem de `from` para `to` (opcionalmente com o filtro `pred`)
   * dentro do timeout. Resolve null se ela não aparecer.
   */
  async waitForReply(from: string, to: string, timeoutMs = DEFAULT_TIMEOUT_MS, pred?: (m: AgentMessage) => boolean): Promise<AgentMessage | null> {
    const deadline = Date.now() + timeoutMs
    const matches = () => this.readMessages().find(m => m.from === from && m.to === to && (!pred || pred(m)))
    let found = matches()
    while (!found && Date.now() < deadline) {
      await delay(POLL_MS)
      found = matches()
    }
    return found || null
  }
}
