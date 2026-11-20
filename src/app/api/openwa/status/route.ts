import { getOpenwaConfig, openwaConfigStatus } from '@/lib/openwa/config'
import { health, healthPublic, findSessionByName, OpenwaError } from '@/lib/openwa/client'
import { managedStatus, installJob } from '@/lib/openwa/manager'
import { openwaEventStats } from '@/lib/openwa/events'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const cfg = getOpenwaConfig()
  const base = openwaConfigStatus()
  const managed = await managedStatus()
  const install = installJob()

  // Alcance do OpenWA: com API key usa /api/health autenticado (traz a version);
  // sem key, tenta o health público (só quando o serviço local está de pé)
  let reachable = false
  let version: string | undefined
  let healthError: string | undefined
  try {
    if (base.hasApiKey) {
      const h = await health(4_000)
      reachable = true
      version = h.version
    } else if (managed.running) {
      await healthPublic(3_000)
      reachable = true
    }
  } catch (e) {
    healthError = e instanceof OpenwaError ? e.message : (e as Error).message
  }

  // Sessão configurada (só se alcançável)
  let session: Record<string, unknown> | null = null
  if (reachable && base.hasApiKey) {
    try {
      const s = await findSessionByName(cfg.sessionName)
      if (s) session = { id: s.id, name: s.name, status: s.status, phone: s.phone, pushName: s.pushName, lastError: s.lastError, engineLoaded: s.engineLoaded, connectedAt: s.connectedAt }
    } catch { /* sessão ainda não existe */ }
  }

  return Response.json({
    ...base,
    openwa: { ...managed, reachable, version, healthError },
    install: { running: install.running, done: install.done, ok: install.ok, steps: install.steps, error: install.error, startedAt: install.startedAt, finishedAt: install.finishedAt },
    session,
    stats: openwaEventStats(),
  })
}
