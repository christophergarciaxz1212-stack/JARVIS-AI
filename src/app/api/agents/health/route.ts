import { modelHealth } from '@/lib/agents/models'
import { getRuntime } from '@/lib/agents/runtime'

export const dynamic = 'force-dynamic'

export async function GET() {
  const rt = getRuntime()
  return Response.json({
    models: modelHealth.snapshot().map(m => ({ ...m, state: modelHealth.state(m.model), cooldownMs: modelHealth.cooldownLeft(m.model) })),
    locks: rt.locks.held(),
    activeRuns: [...rt.runs.values()].filter(c => !c.abort.signal.aborted).map(c => ({ id: c.run.id, sessionId: c.run.sessionId, status: c.run.status })),
  })
}
