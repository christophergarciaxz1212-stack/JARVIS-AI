import { saveKey } from '@/lib/keys'
import { getOpenwaConfig, saveOpenwaConfig, openwaConfigStatus, sanitizeBaseUrl, sanitizeSessionName } from '@/lib/openwa/config'
import { managedStatus } from '@/lib/openwa/manager'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const managed = await managedStatus()
  return Response.json({ ...openwaConfigStatus(), openwa: managed })
}

export async function POST(req: Request) {
  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { return Response.json({ error: 'Body inválido.' }, { status: 400 }) }

  // API key (segredo): vai para data/keys.json, nunca para o config.json
  if (typeof body.apiKey === 'string') {
    saveKey('OPENWA_API_KEY', body.apiKey.trim()) // string vazia remove a key
  }

  if (body.baseUrl !== undefined && !sanitizeBaseUrl(String(body.baseUrl))) {
    return Response.json({ error: 'URL inválida — use http(s)://host:porta (ex.: http://127.0.0.1:2785).' }, { status: 400 })
  }
  if (body.sessionName !== undefined && !sanitizeSessionName(String(body.sessionName))) {
    return Response.json({ error: 'Nome de sessão inválido — 3 a 50 caracteres, só letras, números e hífen.' }, { status: 400 })
  }
  const patch: Parameters<typeof saveOpenwaConfig>[0] = {}
  if (body.baseUrl !== undefined) patch.baseUrl = String(body.baseUrl)
  if (body.sessionName !== undefined) patch.sessionName = String(body.sessionName)
  if (body.port !== undefined && body.port !== null) {
    const p = Number(body.port)
    if (!Number.isFinite(p) || p < 1 || p > 65535) return Response.json({ error: 'Porta inválida (1-65535).' }, { status: 400 })
    patch.port = Math.floor(p)
  }
  if (typeof body.manageLocal === 'boolean') patch.manageLocal = body.manageLocal
  if (typeof body.autoRegisterWebhook === 'boolean') patch.autoRegisterWebhook = body.autoRegisterWebhook

  saveOpenwaConfig(patch)
  // Se a porta mudou e o gerenciado está parado, mantenha a URL coerente com a porta
  if (patch.port && !patch.baseUrl) {
    const cur = getOpenwaConfig()
    if (/^http:\/\/127\.0\.0\.1:\d+$/.test(cur.baseUrl)) saveOpenwaConfig({ baseUrl: `http://127.0.0.1:${patch.port}` })
  }
  return Response.json({ ok: true, ...openwaConfigStatus() })
}
