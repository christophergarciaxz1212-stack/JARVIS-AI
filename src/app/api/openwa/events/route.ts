import { listOpenwaEvents, openwaEventStats } from '@/lib/openwa/events'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const limit = Math.min(100, Math.max(1, Number(new URL(req.url).searchParams.get('limit')) || 20))
  return Response.json({ events: listOpenwaEvents(limit), stats: openwaEventStats() })
}
