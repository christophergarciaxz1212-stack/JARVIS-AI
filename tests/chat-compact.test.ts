import { describe, expect, it } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import {
  applyCompaction, buildTranscript, clearCompaction, compactionPrompt,
  getCompaction, setCompaction, type HistoryMessage,
} from '@/lib/chat/compact'
import { addMessage, createConversation, getMessages } from '@/lib/db'

function conversaCom(textos: string[]) {
  const id = uuidv4()
  createConversation(id, 'modelo', 'Conversa de teste')
  textos.forEach((t, i) => addMessage({
    id: uuidv4(),
    conversationId: id,
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: t,
  }))
  return id
}

describe('ponto de compactação', () => {
  it('começa sem compactação', () => {
    expect(getCompaction(conversaCom(['oi']))).toBeNull()
  })

  it('guarda e lê de volta, sem migrar o armazenamento', () => {
    const id = conversaCom(['uma', 'duas'])
    setCompaction(id, { at: 1000, summary: 'resumo guardado', covered: 2, createdAt: Date.now() })
    const c = getCompaction(id)!
    expect(c.summary).toBe('resumo guardado')
    expect(c.at).toBe(1000)
    expect(c.covered).toBe(2)
  })

  it('resumo vazio não conta como compactação', () => {
    const id = conversaCom(['uma'])
    setCompaction(id, { at: 1, summary: '   ', covered: 1, createdAt: Date.now() })
    expect(getCompaction(id)).toBeNull()
  })

  it('apagar o ponto devolve a conversa ao estado normal', () => {
    const id = conversaCom(['uma'])
    setCompaction(id, { at: 1, summary: 'r', covered: 1, createdAt: Date.now() })
    clearCompaction(id)
    expect(getCompaction(id)).toBeNull()
  })
})

describe('histórico entregue ao modelo', () => {
  it('sem compactação, entrega o histórico como veio', () => {
    const id = conversaCom(['uma', 'duas', 'tres'])
    const msgs = getMessages(id)
    const out = applyCompaction(id, msgs)
    expect(out.messages).toHaveLength(3)
    expect(out.summary).toBeNull()
  })

  it('troca as antigas pelo resumo e mantém as posteriores', () => {
    const id = conversaCom(['antiga 1', 'antiga 2', 'antiga 3', 'recente'])
    const msgs = getMessages(id)
    setCompaction(id, { at: msgs[2].created_at, summary: 'tudo que importava', covered: 3, createdAt: Date.now() })

    const out = applyCompaction(id, msgs)
    const textos = out.messages.map(m => m.content)
    expect(textos.some(t => t.includes('tudo que importava'))).toBe(true)
    expect(textos.some(t => t.includes('antiga 1'))).toBe(false)
    expect(textos.some(t => t.includes('recente'))).toBe(true)
  })

  it('NENHUMA mensagem é apagada do histórico de verdade', () => {
    const id = conversaCom(['antiga 1', 'antiga 2', 'recente'])
    const msgs = getMessages(id)
    setCompaction(id, { at: msgs[1].created_at, summary: 'resumo', covered: 2, createdAt: Date.now() })

    applyCompaction(id, msgs)
    // O armazenamento continua com as três
    expect(getMessages(id)).toHaveLength(3)
    expect(getMessages(id).map(m => m.content)).toContain('antiga 1')
  })

  it('avisa, no texto do resumo, que as originais continuam guardadas', () => {
    const id = conversaCom(['a', 'b', 'c'])
    const msgs = getMessages(id)
    setCompaction(id, { at: msgs[1].created_at, summary: 'resumo', covered: 2, createdAt: Date.now() })
    const resumo = applyCompaction(id, msgs).messages[0]
    expect(resumo.content).toContain('continuam no histórico')
    expect(resumo.content).toContain('2 mensagem')
  })

  it('corte anterior a tudo não inventa um resumo sem conteúdo a substituir', () => {
    const id = conversaCom(['uma', 'duas'])
    const msgs = getMessages(id)
    setCompaction(id, { at: msgs[0].created_at - 10_000, summary: 'resumo', covered: 0, createdAt: Date.now() })
    const out = applyCompaction(id, msgs)
    expect(out.messages).toHaveLength(2)
    expect(out.summary).toBeNull()
  })
})

describe('texto enviado para resumir', () => {
  const msgs: HistoryMessage[] = [
    { role: 'user', content: 'preciso de um login', created_at: 1 },
    { role: 'assistant', content: 'vou usar JWT', created_at: 2 },
  ]

  it('identifica quem falou', () => {
    const t = buildTranscript(msgs)
    expect(t).toContain('Usuário: preciso de um login')
    expect(t).toContain('JARVIS: vou usar JWT')
  })

  it('no teto, mantém as mensagens mais recentes', () => {
    const muitas: HistoryMessage[] = Array.from({ length: 50 }, (_, i) => ({
      role: 'user', content: `mensagem numero ${i} `.repeat(20), created_at: i,
    }))
    const t = buildTranscript(muitas, 2000)
    expect(t.length).toBeLessThanOrEqual(2000)
    expect(t).toContain('numero 49')
    expect(t).not.toContain('numero 0 ')
  })

  it('a instrução pede o que não pode se perder e proíbe inventar', () => {
    const p = compactionPrompt('conversa')
    expect(p).toContain('Decisões tomadas')
    expect(p).toContain('pendente')
    expect(p).toContain('Não invente')
    expect(p).toContain('nunca o valor')
    expect(p).toContain('conversa')
  })
})
