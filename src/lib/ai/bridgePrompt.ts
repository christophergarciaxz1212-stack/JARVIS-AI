/**
 * Montagem de prompt para CLIs de IA que não aceitam mensagens por papel.
 * O sistema vira contexto no topo; os turnos viram seções com marcadores.
 * Compartilhado pelas pontes Antigravity (`agy`) e OpenCode (`opencode run`).
 */
export type BridgeMessage = { role: 'user' | 'assistant' | 'system'; content: string }

export function buildBridgePrompt(messages: BridgeMessage[]): string {
  const parts: string[] = []
  for (const m of messages) {
    if (!m.content.trim()) continue
    if (m.role === 'system') parts.push(`# Instruções do sistema\n${m.content}`)
    else if (m.role === 'user') parts.push(`# Usuário\n${m.content}`)
    else parts.push(`# Você (resposta anterior)\n${m.content}`)
  }
  parts.push('# Sua resposta\n')
  return parts.join('\n\n')
}
