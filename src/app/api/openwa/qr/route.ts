import { getOpenwaConfig } from '@/lib/openwa/config'
import { findSessionByName, getQr, OpenwaError } from '@/lib/openwa/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const cfg = getOpenwaConfig()
  let session
  try {
    session = await findSessionByName(cfg.sessionName)
  } catch (e) {
    const err = e as OpenwaError
    return Response.json({ ok: false, error: err.message }, { status: err.status || 502 })
  }
  if (!session) return Response.json({ ok: false, error: 'Sessão não existe — vincule primeiro.' }, { status: 404 })
  if (session.status === 'ready') {
    return Response.json({ ok: true, status: 'ready', qr: null, phone: session.phone, pushName: session.pushName })
  }
  try {
    const q = await getQr(session.id)
    return Response.json({ ok: true, status: q?.status || session.status, qr: q?.qrCode || null, waiting: !q?.qrCode, phone: session.phone })
  } catch (e) {
    const err = e as OpenwaError
    if (err.status === 400) {
      return Response.json({ ok: true, status: session.status, qr: null, waiting: true })
    }
    return Response.json({ ok: false, error: err.message }, { status: err.status || 502 })
  }
}
