import { NextRequest } from 'next/server'
import { listAutomations, upsertAutomation, deleteAutomation } from '@/lib/whatsapp/meta/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  return Response.json({ automations: listAutomations() })
}

export async function POST(req: NextRequest) {
  let b: any
  try { b = await req.json() } catch { return Response.json({ error: 'JSON inválido' }, { status: 400 }) }
  if (b.action === 'upsert') {
    return Response.json({ automation: upsertAutomation(b.automation) })
  }
  if (b.action === 'delete') {
    deleteAutomation(b.id)
    return Response.json({ ok: true })
  }
  if (b.action === 'toggle') {
    const list = listAutomations()
    const a = list.find(x => x.id === b.id)
    if (!a) return Response.json({ error: 'Não encontrado' }, { status: 404 })
    a.enabled = !!b.enabled
    a.updatedAt = Date.now()
    upsertAutomation(a)
    return Response.json({ automation: a })
  }
  return Response.json({ error: 'Ação inválida' }, { status: 404 })
}