import { tailLog } from '@/lib/openwa/manager'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const log = tailLog(40_000)
  return Response.json({ log: log || '(vazio — o OpenWA ainda não foi iniciado pelo JARVIS)' })
}
