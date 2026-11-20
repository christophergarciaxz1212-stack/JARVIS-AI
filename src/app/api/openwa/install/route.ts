import { startInstall, nodeVersionOk } from '@/lib/openwa/manager'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 900

export async function POST(req: Request) {
  let force = false
  try { force = !!(await req.json())?.force } catch { /* body vazio é ok */ }
  if (!nodeVersionOk()) {
    return Response.json({ error: `Node ${process.versions.node} é antigo demais — o OpenWA exige Node >= 22.19. Atualize o Node e tente de novo.` }, { status: 400 })
  }
  const r = startInstall(force)
  if (r.alreadyRunning) return Response.json({ started: false, alreadyRunning: true })
  if (r.alreadyInstalled) return Response.json({ started: false, alreadyInstalled: true, note: 'OpenWA já está instalado. Use force=true para reinstalar (o serviço atual será substituído).' })
  return Response.json({ started: true })
}
