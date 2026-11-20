import { NextRequest } from 'next/server'
import { listNotifications, markNotificationRead, unreadNotificationCount } from '@/lib/whatsapp/meta/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  return Response.json({ notifications: listNotifications(), unread: unreadNotificationCount() })
}

export async function POST(req: NextRequest) {
  let b: any
  try { b = await req.json() } catch { return Response.json({ error: 'JSON inválido' }, { status: 400 }) }
  if (b.action === 'read') { markNotificationRead(b.id); return Response.json({ ok: true }) }
  return Response.json({ error: 'Ação inválida' }, { status: 404 })
}