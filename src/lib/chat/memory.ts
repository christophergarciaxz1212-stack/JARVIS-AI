/**
 * Memória do chat: o que o usuário pede para lembrar fica salvo (data/store.json › memory) e vai
 * em TODA conversa. Com muitas memórias, entram as mais relevantes para a mensagem + as mais recentes.
 */
import { v4 as uuidv4 } from 'uuid'
import { addMemory, deleteMemory, listMemory, searchMemory } from '../db'
import { memoryIntent } from './memoryIntent'

type Mem = { id: string; content: string; type: string; created_at: number; updated_at: number }

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const words = (s: string) => new Set(fold(s).split(/[^a-z0-9]+/).filter(w => w.length >= 3))

/** Parecido o bastante para ser a MESMA informação (ex.: "meu time é o Cruzeiro" → "meu time é o Atlético"). */
function sameSubject(a: string, b: string) {
  const A = words(a), B = words(b)
  if (!A.size || !B.size) return false
  let common = 0
  for (const w of A) if (B.has(w)) common++
  return common / Math.min(A.size, B.size) >= 0.6 && common >= 2
}

const all = () => listMemory(undefined, 500) as Mem[]

export function rememberFact(content: string): { id: string; replaced?: string } {
  const text = content.trim().slice(0, 1000)
  const old = all().find(m => sameSubject(m.content, text))
  if (old) deleteMemory(old.id)
  const id = uuidv4()
  addMemory({ id, type: 'fact', content: text, tags: ['chat'] })
  return { id, replaced: old?.content }
}

export function forgetFact(query: string): string[] {
  const q = fold(query)
  const Q = words(query)
  // Apaga só o que realmente bate: texto contido, ou a maioria das palavras do pedido presente na memória
  const gone = all().filter(m => {
    const c = fold(m.content)
    if (c.includes(q) || q.includes(c)) return true
    const M = words(m.content)
    let common = 0
    for (const w of Q) if (M.has(w)) common++
    return Q.size > 0 && common >= Math.max(1, Math.ceil(Q.size * 0.6))
  })
  for (const m of gone) deleteMemory(m.id)
  return gone.map(m => m.content)
}

/** Bloco do system prompt: tudo que o usuário pediu para lembrar (até ~3.000 caracteres). */
export function memorySystemContext(userText: string): string {
  const mems = all()
  if (!mems.length) return ''
  const relevant = searchMemory(userText, 15) as Mem[]
  const recent = [...mems].sort((a, b) => b.updated_at - a.updated_at)
  const picked: Mem[] = []
  let size = 0
  for (const m of [...relevant, ...recent]) {
    if (picked.some(p => p.id === m.id)) continue
    if (size + m.content.length > 3000) break
    picked.push(m)
    size += m.content.length
  }
  return `\n\n# Memória do usuário (ele pediu para você lembrar)\nFatos salvos pelo próprio usuário — "eu/meu/minha" se refere a ele. Use-os sempre que forem relevantes, sem precisar que ele repita. Se um fato contradiz o que ele diz agora, vale o que ele diz agora.\n${picked.map(m => `- ${m.content} (salvo em ${new Date(m.updated_at).toLocaleDateString('pt-BR')})`).join('\n')}`
}

/** Comandos de memória do chat; respondem sem gastar nenhuma IA. */
export function memoryCommandRunner(message: string): (() => Promise<string>) | null {
  const intent = memoryIntent(message)
  if (!intent) return null
  return async () => {
    if (intent.action === 'save') {
      const r = rememberFact(intent.content)
      return r.replaced
        ? `🧠 **Memória atualizada.** Troquei “${r.replaced}” por:\n\n> ${intent.content}\n\nVou usar isso nas próximas conversas.`
        : `🧠 **Guardado na memória:**\n\n> ${intent.content}\n\nVou lembrar disso em todas as conversas. Para ver tudo: “o que você lembra sobre mim?”. Para apagar: “esqueça que …”.`
    }
    if (intent.action === 'forget') {
      const gone = forgetFact(intent.query)
      return gone.length
        ? `🗑️ **Esqueci:**\n\n${gone.map(g => `- ${g}`).join('\n')}`
        : `Não encontrei nada na memória sobre “${intent.query}”. Diga “o que você lembra sobre mim?” para ver o que está salvo.`
    }
    const mems = intent.query ? (searchMemory(intent.query, 30) as Mem[]) : all()
    if (!mems.length) return intent.query ? `Não tenho nada salvo sobre “${intent.query}”.` : 'Ainda não tenho nada na memória. Diga “lembre que …” e eu guardo.'
    return `🧠 **O que eu lembro${intent.query ? ` sobre “${intent.query}”` : ''}** (${mems.length}):\n\n${mems.slice(0, 50).map(m => `- ${m.content}`).join('\n')}\n\n*Para apagar algo: “esqueça que …”.*`
  }
}
