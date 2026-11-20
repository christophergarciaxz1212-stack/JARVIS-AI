import { startLocal } from '@/lib/openwa/manager'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 150

export async function POST() {
  const r = await startLocal()
  if (!r.ok) return Response.json({ ok: false, error: r.error }, { status: 500 })
  return Response.json(r)
}
