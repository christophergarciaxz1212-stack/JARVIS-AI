import { NextRequest } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import {
  listMemory,
  addMemory,
  deleteMemory,
  searchMemory,
  listConversations,
  deleteConversation,
} from '@/lib/db'

const MEMORY_TYPES = new Set(['fact', 'preference', 'project', 'task', 'context'])
const isId = (v: unknown): v is string => typeof v === 'string' && /^[\w-]+$/.test(v)

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action') || 'list'
  const type = searchParams.get('type') || undefined
  const query = (searchParams.get('q') || '').slice(0, 500)

  try {
    switch (action) {
      case 'list':
        return Response.json({ entries: listMemory(type) })

      case 'search':
        return Response.json({ entries: searchMemory(query) })

      case 'conversations':
        return Response.json({ conversations: listConversations() })

      default:
        return Response.json({ error: 'Ação inválida' }, { status: 400 })
    }
  } catch {
    return Response.json({ error: 'Erro ao carregar memória' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Corpo inválido (JSON esperado)' }, { status: 400 })
  }
  const { action } = body

  try {
    switch (action) {
      case 'add': {
        const { type, content, tags } = body
        if (typeof content !== 'string' || !content.trim()) {
          return Response.json({ error: 'Conteúdo da memória deve ser texto não vazio' }, { status: 400 })
        }
        const id = uuidv4()
        addMemory({
          id,
          type: typeof type === 'string' && MEMORY_TYPES.has(type) ? type : 'fact',
          content: content.trim().slice(0, 4000),
          tags: Array.isArray(tags) ? tags.filter(t => typeof t === 'string').map(t => t.trim().slice(0, 40)).slice(0, 10) : [],
        })
        return Response.json({ id, success: true })
      }

      case 'delete': {
        if (!isId(body.id)) return Response.json({ error: 'id inválido' }, { status: 400 })
        deleteMemory(body.id)
        return Response.json({ success: true })
      }

      case 'delete-conversation': {
        if (!isId(body.id)) return Response.json({ error: 'id inválido' }, { status: 400 })
        deleteConversation(body.id)
        return Response.json({ success: true })
      }

      default:
        return Response.json({ error: 'Ação inválida' }, { status: 400 })
    }
  } catch {
    return Response.json({ error: 'Erro ao salvar memória' }, { status: 500 })
  }
}
