import { NextRequest } from 'next/server'
import { createProject, getProject, listProjects, removeProject, renameProject } from '@/lib/agents/store'
import { DEFAULT_PROJECT_ID, moveSessionsToProject } from '@/lib/db'
import { clearMemory, readInstructions, readMemory, removeMemory, writeMemory } from '@/lib/agents/projectMemory'

export async function GET(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('memory')
  if (id) {
    const project = getProject(id)
    if (!project) return Response.json({ error: 'Projeto não encontrado' }, { status: 404 })
    return Response.json({
      memory: readMemory(id),
      instructions: project.path ? readInstructions(project.path) : null,
    })
  }
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
      case 'memory-save': {
        const id = String(body.id || '')
        if (!getProject(id)) return Response.json({ error: 'Projeto não encontrado' }, { status: 404 })
        return Response.json({ memory: writeMemory(id, body.memory || {}) })
      }
      case 'memory-remove': {
        const field = body.field === 'pendencias' ? 'pendencias' : 'decisoes'
        return Response.json({ memory: removeMemory(String(body.id || ''), field, String(body.text || '')) })
      }
      case 'memory-clear':
        if (body.confirm !== true) return Response.json({ error: 'Confirmação obrigatória para apagar a memória' }, { status: 400 })
        return Response.json({ memory: clearMemory(String(body.id || '')) })
      default:
        return Response.json({ error: 'Ação inválida' }, { status: 400 })
    }
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 })
  }
}
