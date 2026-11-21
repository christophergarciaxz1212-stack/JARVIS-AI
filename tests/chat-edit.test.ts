import { describe, expect, it } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import { addMessage, createConversation, getMessages, truncateMessagesFrom } from '@/lib/db'
import { getCompaction, setCompaction } from '@/lib/chat/compact'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Conversa com mensagens em ordem garantida (timestamps distintos). */
async function conversa(textos: string[]) {
  const id = uuidv4()
  createConversation(id, 'modelo', 'Teste')
  const ids: string[] = []
  for (let i = 0; i < textos.length; i++) {
    const mid = uuidv4()
    addMessage({ id: mid, conversationId: id, role: i % 2 === 0 ? 'user' : 'assistant', content: textos[i] })
    ids.push(mid)
    await sleep(3)
  }
  return { id, ids }
}

describe('cortar a conversa a partir de uma mensagem', () => {
  it('regenerar: tira a última pergunta e a resposta, mantém o resto', async () => {
    const { id, ids } = await conversa(['p1', 'r1', 'p2', 'r2'])
    const out = truncateMessagesFrom(id, ids[2])

    expect(out?.removed).toBe(2)
    expect(getMessages(id).map(m => m.content)).toEqual(['p1', 'r1'])
  })

  it('editar uma mensagem antiga descarta tudo que veio depois dela', async () => {
    const { id, ids } = await conversa(['p1', 'r1', 'p2', 'r2', 'p3', 'r3'])
    truncateMessagesFrom(id, ids[2])
    expect(getMessages(id).map(m => m.content)).toEqual(['p1', 'r1'])
  })

  it('cortar a partir da primeira esvazia a conversa', async () => {
    const { id, ids } = await conversa(['p1', 'r1'])
    expect(truncateMessagesFrom(id, ids[0])?.removed).toBe(2)
    expect(getMessages(id)).toHaveLength(0)
  })

  it('mensagem inexistente não apaga nada', async () => {
    const { id } = await conversa(['p1', 'r1'])
    expect(truncateMessagesFrom(id, 'nao-existe')).toBeNull()
    expect(getMessages(id)).toHaveLength(2)
  })

  it('não mexe em outras conversas, mesmo com mensagens mais novas', async () => {
    const a = await conversa(['a1', 'a2', 'a3'])
    const b = await conversa(['b1', 'b2'])
    truncateMessagesFrom(a.id, a.ids[1])

    expect(getMessages(a.id).map(m => m.content)).toEqual(['a1'])
    expect(getMessages(b.id).map(m => m.content)).toEqual(['b1', 'b2'])
  })

  it('um id de outra conversa não corta esta', async () => {
    const a = await conversa(['a1', 'a2'])
    const b = await conversa(['b1', 'b2'])
    expect(truncateMessagesFrom(a.id, b.ids[0])).toBeNull()
    expect(getMessages(a.id)).toHaveLength(2)
    expect(getMessages(b.id)).toHaveLength(2)
  })
})

describe('corte e compactação', () => {
  it('cortar antes do ponto compactado invalida o resumo pela rota', async () => {
    const { POST } = await import('@/app/api/conversations/route')
    const { id, ids } = await conversa(['p1', 'r1', 'p2', 'r2'])
    const msgs = getMessages(id)
    setCompaction(id, { at: msgs[3].created_at, summary: 'resumo de tudo', covered: 4, createdAt: Date.now() })

    const req = new Request('http://localhost/api/conversations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'truncate', id, fromMessageId: ids[2] }),
    })
    const res = await POST(req as never)
    expect(res.status).toBe(200)
    // O resumo citava mensagens que não existem mais: foi descartado
    expect(getCompaction(id)).toBeNull()
  })

  it('cortar depois do ponto compactado preserva o resumo', async () => {
    const { POST } = await import('@/app/api/conversations/route')
    const { id, ids } = await conversa(['p1', 'r1', 'p2', 'r2'])
    const msgs = getMessages(id)
    setCompaction(id, { at: msgs[1].created_at, summary: 'resumo do começo', covered: 2, createdAt: Date.now() })

    const req = new Request('http://localhost/api/conversations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'truncate', id, fromMessageId: ids[3] }),
    })
    await POST(req as never)
    expect(getCompaction(id)?.summary).toBe('resumo do começo')
  })

  it('a rota recusa pedido malformado', async () => {
    const { POST } = await import('@/app/api/conversations/route')
    const mk = (body: unknown) => new Request('http://localhost/api/conversations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }) as never
    expect((await POST(mk({ action: 'outra' }))).status).toBe(400)
    expect((await POST(mk({ action: 'truncate', id: '../x', fromMessageId: 'a' }))).status).toBe(400)
    expect((await POST(mk({ action: 'truncate', id: 'abc' }))).status).toBe(400)
    expect((await POST(mk({ action: 'truncate', id: 'abc', fromMessageId: 'nada' }))).status).toBe(404)
  })
})
