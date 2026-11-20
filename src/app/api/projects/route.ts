import { NextRequest } from 'next/server'
import { createProject, listProjects, removeProject, renameProject } from '@/lib/agents/store'
import { DEFAULT_PROJECT_ID, moveSessionsToProject } from '@/lib/db'

export async function GET() {
  return Response.json({ projects: listProjects() })
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    switch (body.action) {
      case 'create':
        return Response.json({ project: createProject(String(body.name || ''), String(body.path || '')) })
      case 'rename':
        return Response.json({ ok: renameProject(String(body.id), String(body.name || '')) })
      case 'remove': {
        // JARVIS forgets the project; its sessions move to "Geral" and the folder on disk is untouched
        const moved = moveSessionsToProject(String(body.id), DEFAULT_PROJECT_ID)
        removeProject(String(body.id))
        return Response.json({ ok: true, movedSessions: moved })
      }
      default:
        return Response.json({ error: 'Ação inválida' }, { status: 400 })
    }
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 })
  }
}
