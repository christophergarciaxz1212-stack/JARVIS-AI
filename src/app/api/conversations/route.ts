import { NextRequest } from 'next/server'
import {
  listConversations,
  getMessages,
  deleteConversation,
  updateConversationTitle,
} from '@/lib/db'

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
