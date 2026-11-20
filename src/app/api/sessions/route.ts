import { NextRequest } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import {
  createConversation, DEFAULT_PROJECT_ID, duplicateSession, getSession, listSessions, updateSession, type SessionRow,
} from '@/lib/db'
import { getRuntime } from '@/lib/agents/runtime'
import { duplicateSessionData } from '@/lib/agents/store'
import type { SessionKind, SessionMeta, SessionStatus } from '@/lib/agents/types'

function toMeta(s: SessionRow): SessionMeta {
  return {
    id: s.id,
    title: s.title,
    model: s.model,
    projectId: s.project_id,
    kind: s.kind,
    status: s.status,
    archived: s.archived,
    createdAt: s.created_at,
    updatedAt: s.updated_at,
    messageCount: s.message_count,
    running: getRuntime().isSessionRunning(s.id),
    teamId: s.team_id,
  }
}

const STATUSES: SessionStatus[] = ['active', 'paused', 'completed']

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams
  const archived = sp.get('archived')
  const status = sp.get('status') as SessionStatus | null
  const sessions = listSessions({
    projectId: sp.get('projectId') || undefined,
    status: status && STATUSES.includes(status) ? status : undefined,
    archived: archived === null ? false : archived === 'all' ? undefined : archived === 'true',
    q: sp.get('q') || undefined,
    kind: (sp.get('kind') as SessionKind) || undefined,
  })
  return Response.json({ sessions: sessions.map(toMeta) })
}

function ids(body: { ids?: unknown; id?: unknown }): string[] {
  const list = Array.isArray(body.ids) ? body.ids : body.id ? [body.id] : []
  return list.map(String).filter(id => /^[\w-]+$/.test(id))
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const rt = getRuntime()
    switch (body.action) {
      case 'create': {
        const id = uuidv4()
        const kind: SessionKind = body.kind === 'team' ? 'team' : 'chat'
        createConversation(id, kind === 'team' ? 'equipe' : String(body.model || ''), String(body.title || (kind === 'team' ? 'Nova sessão de equipe' : 'Nova Conversa')), {
          projectId: String(body.projectId || DEFAULT_PROJECT_ID),
          kind,
          teamId: body.teamId ? String(body.teamId) : undefined,
        })
        return Response.json({ session: toMeta(getSession(id)!) })
      }

      case 'rename': {
        const title = String(body.title || '').trim()
        if (!title) return Response.json({ error: 'Nome vazio' }, { status: 400 })
        return Response.json({ ok: updateSession(ids(body)[0], { title: title.slice(0, 120) }) })
      }

      case 'archive':
      case 'restore':
        for (const id of ids(body)) updateSession(id, { archived: body.action === 'archive' })
        return Response.json({ ok: true })

      case 'status': {
        if (!STATUSES.includes(body.status)) return Response.json({ error: 'Status inválido' }, { status: 400 })
        for (const id of ids(body)) updateSession(id, { status: body.status })
        return Response.json({ ok: true })
      }

      case 'move': {
        for (const id of ids(body)) updateSession(id, { project_id: String(body.projectId || DEFAULT_PROJECT_ID) })
        return Response.json({ ok: true })
      }

      case 'duplicate': {
        const source = ids(body)[0]
        const newId = uuidv4()
        const copy = duplicateSession(source, newId, uuidv4)
        if (!copy) return Response.json({ error: 'Sessão não encontrada' }, { status: 404 })
        duplicateSessionData(source, newId)
        return Response.json({ session: toMeta(getSession(newId)!) })
      }

      case 'stop': {
        let stopped = 0
        for (const id of ids(body)) stopped += await rt.stopSession(id)
        for (const id of ids(body)) updateSession(id, { status: 'paused' })
        return Response.json({ ok: true, stoppedRuns: stopped })
      }

      case 'delete': {
        // Permanent: the caller must confirm explicitly
        if (body.confirm !== true) return Response.json({ error: 'Confirmação obrigatória para excluir' }, { status: 400 })
        const list = ids(body)
        if (!list.length) return Response.json({ error: 'Nenhuma sessão selecionada' }, { status: 400 })
        const removed = await rt.deleteSessions(list)
        return Response.json({ ok: true, removed })
      }

      default:
        return Response.json({ error: 'Ação inválida' }, { status: 400 })
    }
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 })
  }
}
