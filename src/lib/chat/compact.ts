/**
 * Compactação de conversa (`/compact`).
 *
 * Conversa longa estoura a janela do modelo e gasta cota à toa. Compactar troca
 * as mensagens antigas por um resumo — mas **nada é apagado**: as mensagens
 * continuam no histórico e na tela. O que muda é só o que vai para o modelo.
 *
 * O ponto de corte fica no campo `metadata` da conversa, que já existia e já é
 * um JSON — nenhuma migração de armazenamento foi necessária.
 */
import { getConversation, updateConversationMetadata } from '../db'

export interface Compaction {
  /** Mensagens criadas até aqui (inclusive) são substituídas pelo resumo. */
  at: number
  summary: string
  /** Quantas mensagens o resumo cobre — mostrado ao usuário. */
  covered: number
  createdAt: number
}

interface Metadata { compaction?: Compaction }

function readMetadata(conversationId: string): Metadata {
  try {
    const raw = getConversation(conversationId)?.metadata
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? parsed as Metadata : {}
  } catch {
    return {}
  }
}

export function getCompaction(conversationId: string): Compaction | null {
  const c = readMetadata(conversationId).compaction
  if (!c || typeof c.at !== 'number' || typeof c.summary !== 'string' || !c.summary.trim()) return null
  return c
}

export function setCompaction(conversationId: string, compaction: Compaction) {
  const metadata = readMetadata(conversationId)
  metadata.compaction = compaction
  updateConversationMetadata(conversationId, JSON.stringify(metadata))
}

export function clearCompaction(conversationId: string) {
  const metadata = readMetadata(conversationId)
  delete metadata.compaction
  updateConversationMetadata(conversationId, JSON.stringify(metadata))
}

export interface HistoryMessage { role: string; content: string; created_at: number }

/**
 * Histórico que o modelo recebe: o resumo no lugar do que foi compactado, e as
 * mensagens posteriores inteiras. Sem compactação, devolve o histórico como veio.
 */
export function applyCompaction<T extends HistoryMessage>(
  conversationId: string,
  messages: T[],
): { messages: Array<T | HistoryMessage>; summary: string | null } {
  const c = getCompaction(conversationId)
  if (!c) return { messages, summary: null }

  const depois = messages.filter(m => m.created_at > c.at)
  // Se tudo é posterior ao corte, o resumo não tem o que substituir.
  if (depois.length === messages.length) return { messages, summary: null }

  const resumo: HistoryMessage = {
    role: 'assistant',
    created_at: c.at,
    content: `[Resumo da conversa até aqui, feito a pedido do usuário com /compact — ${c.covered} mensagem(ns) condensada(s). As mensagens originais continuam no histórico da conversa.]\n\n${c.summary}`,
  }
  return { messages: [resumo, ...depois], summary: c.summary }
}

/** Instrução de resumo enviada ao modelo. Exportada para teste. */
export function compactionPrompt(transcript: string): string {
  return `Resuma a conversa abaixo para que outro modelo possa continuar o trabalho sem ter lido nada dela.

Preserve, nesta ordem:
1. O que o usuário quer (objetivo e pedidos ainda em aberto).
2. Decisões tomadas e o motivo de cada uma.
3. Fatos concretos que não podem se perder: nomes de arquivos, caminhos, comandos, versões, números, credenciais citadas por nome (nunca o valor).
4. O que já foi feito e o que ficou pendente.
5. Preferências que o usuário expressou sobre como trabalhar.

Descarte saudações, repetições e texto que não muda nada.

Escreva em português do Brasil, em tópicos, sem introdução nem conclusão. Não invente nada que não esteja na conversa.

--- CONVERSA ---
${transcript}`
}

/** Monta o texto da conversa que será resumido, respeitando um teto de caracteres. */
export function buildTranscript(messages: HistoryMessage[], maxChars = 60_000): string {
  const linhas = messages.map(m => `${m.role === 'user' ? 'Usuário' : 'JARVIS'}: ${m.content}`)
  let total = 0
  const mantidas: string[] = []
  // De trás para frente: o mais recente é o que mais importa preservar.
  for (let i = linhas.length - 1; i >= 0; i--) {
    if (total + linhas[i].length > maxChars) break
    mantidas.unshift(linhas[i])
    total += linhas[i].length
  }
  return mantidas.join('\n\n')
}
