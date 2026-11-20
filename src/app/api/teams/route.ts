import { NextRequest } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { deleteTeam, getTeam, listTeams, saveTeam } from '@/lib/agents/store'
import { ROLES } from '@/lib/agents/roles'

export async function GET() {
  return Response.json({ teams: listTeams(), roles: ROLES })
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    switch (body.action) {
      case 'save': {
        const t = body.team
        // Editing a preset saves a personal copy; presets themselves stay intact
        const id = t.id && !String(t.id).startsWith('preset-') ? t.id : undefined
        return Response.json({ team: saveTeam({ ...t, id }) })
      }
      case 'duplicate': {
        const src = getTeam(String(body.id))
        if (!src) return Response.json({ error: 'Equipe não encontrada' }, { status: 404 })
        const team = saveTeam({
          id: '',
          name: `${src.name} (cópia)`,
          description: src.description,
          agents: src.agents.map(a => ({ ...a, id: uuidv4() })),
        })
        return Response.json({ team })
      }
      case 'delete':
        deleteTeam(String(body.id))
        return Response.json({ ok: true })
      default:
        return Response.json({ error: 'Ação inválida' }, { status: 400 })
    }
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 })
  }
}
