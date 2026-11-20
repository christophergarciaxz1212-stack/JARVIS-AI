/**
 * JARVIS — IA para conversas do WhatsApp.
 * Usa a cadeia de modelos gratuita do JARVIS (hubComplete). Injetável em testes.
 */
import { hubComplete } from '../hub/llm'
import type { ChatMessage } from '../agents/models'

const system = 'Você é o JARVIS, assistente pessoal do usuário. Responda em português do Brasil, direto e objetivo. Nunca invente fatos que não estejam no histórico.'

export interface WaAiOptions { phone: string; transcript: string }

async function run(prompt: string, opts: WaAiOptions): Promise<string> {
  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    { role: 'system', content: `Histórico da conversa com ${opts.phone}:\n${opts.transcript.slice(-12_000)}` },
    { role: 'user', content: prompt },
  ]
  const { text } = await hubComplete(messages)
  return text.trim()
}

export function summarize(opts: WaAiOptions): Promise<string> {
  return run('Resuma esta conversa em até 8 linhas: assuntos, decisões, pendências e quem aguarda resposta.', opts)
}
export function draftReply(opts: WaAiOptions & { tone?: string }): Promise<string> {
  const tone = opts.tone || 'profissional, cordial e objetivo'
  return run(`Escreva uma resposta ${tone} para a última mensagem do contato. Responda SOMENTE com o texto da mensagem (sem aspas, sem explicação).`, opts)
}
export function translate(opts: WaAiOptions & { to?: string }): Promise<string> {
  const to = opts.to || 'inglês'
  return run(`Traduza para ${to} a ÚLTIMA mensagem do contato (a mais recente do histórico). Responda só com a tradução.`, opts)
}
export function extractCommitments(opts: WaAiOptions): Promise<string> {
  return run('Liste compromissos, prazos, cobranças e datas mencionados na conversa. Formato: uma linha por item ("- [quem] — [o quê] — [quando]"). Se não houver, responda "Nenhum compromisso identificado."', opts)
}
export function extractTasks(opts: WaAiOptions): Promise<string> {
  return run('Liste TASKS pendentes mencionadas na conversa (o que alguém prometeu fazer). Formato: uma linha por item. Se não houver, responda "Nenhuma tarefa identificada."', opts)
}
export function suggestReminders(opts: WaAiOptions): Promise<string> {
  return run('Sugira lembretes que o usuário deveria criar a partir desta conversa. Formato: "- [quando] — [o quê]". Se não houver, responda "Nenhum lembrete sugerido."', opts)
}

/** Transcrição de conversa para a IA (texto simples, horário pt-BR). */
export function buildTranscript(messages: Array<{ direction: 'in' | 'out'; text: string; at: number; mediaMime?: string }>): string {
  return messages
    .map(m => `${new Date(m.at).toLocaleString('pt-BR')} — ${m.direction === 'in' ? 'Contato' : 'Você'}: ${m.text}${m.mediaMime ? ` [${m.mediaMime}]` : ''}`)
    .join('\n')
}
