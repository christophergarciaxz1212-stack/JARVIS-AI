import { getOpenwaConfig } from '@/lib/openwa/config'
import { findSessionByName, logoutSession, stopSession, OpenwaError } from '@/lib/openwa/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 90

/**
 * Body: { logout?: boolean }
 *  - logout=false (padrão): apenas para o engine (credenciais ficam salvas; reconectar não pede QR)
 *  - logout=true: desvincula o aparelho do WhatsApp (logout nativo) e apaga as credenciais — exige QR novo depois
 */
export async function POST(req: Request) {
  let logout = false
  try { logout = !!(await req.json())?.logout } catch {}
  const cfg = getOpenwaConfig()

  let session
  try {
    session = await findSessionByName(cfg.sessionName)
  } catch (e) {
    const err = e as OpenwaError
    return Response.json({ ok: false, error: err.message }, { status: err.status || 502 })
  }
  if (!session) return Response.json({ ok: true, note: 'Nenhuma sessão vinculada.' })

  if (logout) {
    try {
      await logoutSession(session.id)
      return Response.json({ ok: true, loggedOut: true })
    } catch (e) {
      const err = e as OpenwaError
      // Sessão parada: o unlink nativo exige engine rodando. Para mesmo assim.
      if (err.status === 400) {
        await stopSession(session.id).catch(() => {})
        return Response.json({
          ok: true,
          loggedOut: false,
          warning: 'A sessão estava parada; as credenciais locais foram encerradas, mas o aparelho pode continuar listado em "Aparelhos conectados" no seu celular — remova por lá se quiser.',
        })
      }
      return Response.json({ ok: false, error: err.message }, { status: err.status || 502 })
    }
  }

  try {
    await stopSession(session.id)
    return Response.json({ ok: true, stopped: true })
  } catch (e) {
    const err = e as OpenwaError
    // 400 com engine não carregado: já está parada
    if (err.status === 400) return Response.json({ ok: true, stopped: true, note: 'A sessão já estava parada.' })
    return Response.json({ ok: false, error: err.message }, { status: err.status || 502 })
  }
}
