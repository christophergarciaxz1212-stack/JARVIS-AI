import os from 'os'
import { NextRequest } from 'next/server'
import { dataDir } from '@/lib/agents/fsutil'
import { DEFAULT_PREFS, getPrefs, savePrefs } from '@/lib/prefs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  return Response.json({ prefs: getPrefs(), defaults: DEFAULT_PREFS, info: { dataDir: dataDir(), platform: `${os.type()} ${os.release()}`, node: process.version } })
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    // A malformed body must not clobber the user's saved preferences
    return Response.json({ error: 'Corpo inválido (JSON esperado)' }, { status: 400 })
  }
  if (body.reset === true) return Response.json({ prefs: savePrefs(DEFAULT_PREFS) })
  if (!body.prefs || typeof body.prefs !== 'object' || Array.isArray(body.prefs)) {
    return Response.json({ error: 'Informe “prefs” como um objeto' }, { status: 400 })
  }
  return Response.json({ prefs: savePrefs(body.prefs as Parameters<typeof savePrefs>[0]) })
}
