/**
 * Contexto da conversa: arquivos e textos que o usuário "joga" para a IA (botão Contexto, arrastar
 * e soltar no chat, colar texto). Ficam guardados por conversa em data/context/<id>.json e entram
 * em todas as mensagens seguintes daquela conversa — não só na primeira.
 *
 * Cada modelo recebe o quanto cabe nele: a janela de contexto do modelo e a cota gratuita do
 * provedor (freeTier) definem o orçamento; se o material não cabe, cada item é cortado de forma
 * proporcional (começo + fim) e o modelo é avisado de que recebeu um trecho.
 */
import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { dataDir, writeJsonAtomic } from '../agents/fsutil'
import { budgetTier, maxInputTokensFor } from '../ai/freeTier'

export interface ContextItem {
  id: string
  name: string
  kind: 'file' | 'text'
  chars: number
  text: string
  /** O arquivo era maior que o limite por item e foi cortado ao ser adicionado. */
  truncated?: boolean
  addedAt: number
}

export const MAX_ITEM_CHARS = 300_000
export const MAX_TOTAL_CHARS = 800_000
export const MAX_ITEMS = 20

const SAFE_ID = /^[\w-]{1,80}$/
const dir = () => path.join(dataDir(), 'context')
const fileFor = (conversationId: string) => {
  if (!SAFE_ID.test(conversationId)) throw new Error('conversationId inválido')
  return path.join(dir(), `${conversationId}.json`)
}

export function listContext(conversationId: string): ContextItem[] {
  try {
    const d = JSON.parse(fs.readFileSync(fileFor(conversationId), 'utf-8')) as { items?: ContextItem[] }
    return Array.isArray(d.items) ? d.items : []
  } catch { return [] }
}

function write(conversationId: string, items: ContextItem[]) {
  fs.mkdirSync(dir(), { recursive: true })
  if (!items.length) { try { fs.unlinkSync(fileFor(conversationId)) } catch { /* já não existe */ } return }
  writeJsonAtomic(fileFor(conversationId), { version: 1, items })
}

/** Limpa o texto: sem caracteres de controle, quebras de linha normalizadas. */
export function cleanText(text: string) {
  return text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\n{4,}/g, '\n\n\n').trim()
}

export function addContext(conversationId: string, input: Array<{ name?: string; text?: string; kind?: string }>): ContextItem[] {
  const items = listContext(conversationId)
  for (const raw of input) {
    let text = cleanText(String(raw?.text || ''))
    if (!text) continue
    if (items.length >= MAX_ITEMS) throw new Error(`Limite de ${MAX_ITEMS} itens de contexto por conversa — remova algum antes`)
    const used = items.reduce((n, i) => n + i.chars, 0)
    const room = MAX_TOTAL_CHARS - used
    if (room < 500) throw new Error('O contexto desta conversa já está cheio (800 mil caracteres) — remova algum item')
    let truncated = false
    const cap = Math.min(MAX_ITEM_CHARS, room)
    if (text.length > cap) { text = text.slice(0, cap); truncated = true }
    const name = String(raw?.name || 'Texto colado').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 120) || 'Texto colado'
    items.push({ id: uuidv4(), name, kind: raw?.kind === 'text' ? 'text' : 'file', chars: text.length, text, truncated: truncated || undefined, addedAt: Date.now() })
  }
  write(conversationId, items)
  return items
}

export function removeContext(conversationId: string, id: string) {
  const items = listContext(conversationId).filter(i => i.id !== id)
  write(conversationId, items)
  return items
}

export function clearContext(conversationId: string) {
  write(conversationId, [])
}

/** Visão leve para a tela (sem o texto inteiro). */
export function summarize(items: ContextItem[]) {
  return items.map(({ text, ...rest }) => ({ ...rest, preview: text.slice(0, 160) }))
}

// ── Orçamento por modelo ─────────────────────────────────────────────────────

const CHARS_PER_TOKEN = 4 / 1.15

/** Quantos caracteres de contexto cabem neste modelo, além do que a conversa já ocupa. */
export function contextBudgetChars(modelId: string, contextWindow: number | undefined, baseChars: number) {
  const window = contextWindow && contextWindow > 0 ? contextWindow : 32_000
  // Metade da janela para o material; o resto fica para histórico e resposta
  const byWindow = window * 0.55
  const byQuota = maxInputTokensFor(budgetTier(modelId))
  const tokens = Math.min(byWindow, byQuota) - baseChars / CHARS_PER_TOKEN - 1_200
  return Math.max(2_000, Math.floor(tokens * CHARS_PER_TOKEN))
}

/** Corta mantendo começo (75%) e fim (25%), avisando o quanto saiu. */
function clip(text: string, max: number) {
  if (text.length <= max) return text
  const head = Math.floor(max * 0.75)
  const tail = Math.max(0, max - head - 80)
  return `${text.slice(0, head)}\n\n[… ${(text.length - head - tail).toLocaleString('pt-BR')} caracteres omitidos por limite do modelo …]\n\n${tail ? text.slice(-tail) : ''}`
}

/**
 * Bloco de contexto para o prompt de sistema, dentro do orçamento. Itens pequenos entram inteiros;
 * o que sobra é dividido igualmente entre os grandes.
 */
export function buildContextBlock(items: ContextItem[], budgetChars: number): { block: string; usedChars: number; totalChars: number; clipped: boolean } {
  const totalChars = items.reduce((n, i) => n + i.chars, 0)
  if (!items.length) return { block: '', usedChars: 0, totalChars: 0, clipped: false }
  const overhead = 400 + items.length * 90
  let remaining = Math.max(1_000, budgetChars - overhead)
  const alloc = new Map<string, number>()
  const bySize = [...items].sort((a, b) => a.chars - b.chars)
  bySize.forEach((it, i) => {
    const share = Math.floor(remaining / (bySize.length - i))
    const give = Math.min(it.chars, share)
    alloc.set(it.id, give)
    remaining -= give
  })
  const clipped = items.some(i => (alloc.get(i.id) || 0) < i.chars)
  const parts = items.map(i => {
    const body = clip(i.text, alloc.get(i.id) || 0)
    return `<<< ${i.kind === 'text' ? 'texto' : 'arquivo'}: ${i.name} >>>\n${body}\n<<< fim: ${i.name} >>>`
  })
  const usedChars = items.reduce((n, i) => n + Math.min(i.chars, alloc.get(i.id) || 0), 0)
  const header = '\n\n' + [
    '# Contexto fornecido pelo usuário',
    `O usuário anexou ${items.length === 1 ? 'o material abaixo' : `${items.length} itens abaixo`} como contexto desta conversa.`,
    'Use esse material como fonte principal: cite o nome do arquivo quando usar uma informação dele e, se a resposta não estiver no material, diga isso claramente em vez de inventar.',
    clipped ? 'Atenção: o material era maior do que cabe neste modelo — alguns itens chegaram cortados (marcados com "caracteres omitidos"). Se a pergunta depender da parte omitida, avise o usuário.' : '',
  ].filter(Boolean).join('\n') + '\n'
  return { block: `${header}\n${parts.join('\n\n')}`, usedChars, totalChars, clipped }
}
