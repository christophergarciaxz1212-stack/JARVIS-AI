import { NextRequest } from 'next/server'
import {
  listConversations,
  getMessages,
  deleteConversation,
  updateConversationTitle,
  truncateMessagesFrom,
} from '@/lib/db'
import { clearCompaction, getCompaction } from '@/lib/chat/compact'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')

    if (id) {
      if (!/^[\w-]+$/.test(id)) return Response.json({ error: 'id inválido' }, { status: 400 })
      const messages = getMessages(id)
      return Response.json({ messages })
    }

    const conversations = listConversations()
    return Response.json({ conversations })
  } catch {
    return Response.json({ error: 'Erro ao carregar conversas' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { id } = await req.json()
    if (!id || typeof id !== 'string' || !/^[\w-]+$/.test(id)) {
      return Response.json({ error: 'id inválido' }, { status: 400 })
    }
    deleteConversation(id)
    return Response.json({ success: true })
  } catch {
    return Response.json({ error: 'Erro ao apagar conversa' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { id, title } = await req.json()
    if (!id || typeof id !== 'string' || !/^[\w-]+$/.test(id)) {
      return Response.json({ error: 'id inválido' }, { status: 400 })
    }
    if (!title || typeof title !== 'string' || !title.trim()) {
      return Response.json({ error: 'título inválido' }, { status: 400 })
    }
    updateConversationTitle(id, title.trim().slice(0, 120))
    return Response.json({ success: true })
  } catch {
    return Response.json({ error: 'Erro ao renomear conversa' }, { status: 500 })
  }
}


/**
 * Editar / regenerar: remove a mensagem indicada e tudo depois dela. O cliente
 * reenvia o texto em seguida, pelo caminho normal do chat.
 */
export async function POST(req: NextRequest) {
  try {
    const { action, id, fromMessageId } = await req.json()
    if (action !== 'truncate') return Response.json({ error: 'Ação inválida' }, { status: 400 })
    if (!id || typeof id !== 'string' || !/^[\w-]+$/.test(id)) return Response.json({ error: 'id inválido' }, { status: 400 })
    if (!fromMessageId || typeof fromMessageId !== 'string') return Response.json({ error: 'Informe a mensagem' }, { status: 400 })

    const out = truncateMessagesFrom(id, fromMessageId)
    if (!out) return Response.json({ error: 'Mensagem não encontrada nesta conversa' }, { status: 404 })

    // Se o corte apagou mensagens que o resumo do /compact cobria, o resumo
    // passaria a citar coisas que não existem mais: volta ao histórico normal.
    const c = getCompaction(id)
    if (c && out.fromCreatedAt <= c.at) clearCompaction(id)

    return Response.json({ ok: true, removed: out.removed })
  } catch (e) {
    return Response.json({ error: (e as Error).message || 'Erro ao editar a conversa' }, { status: 500 })
  }
}
