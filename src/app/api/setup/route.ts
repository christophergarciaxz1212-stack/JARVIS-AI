import { NextRequest } from 'next/server'
import { applyRepair, detectSystem, markSetupDone, setupMarker, systemHealth, updateCheck, wingetInstall } from '@/lib/setup/system'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const fail = (e: unknown, status = 400) => Response.json({ error: e instanceof Error ? e.message : String(e) }, { status })

export async function GET(req: NextRequest) {
  try {
    const action = new URL(req.url).searchParams.get('action') || 'status'
    switch (action) {
      case 'status': {
        const marker = setupMarker()
        return Response.json({ firstRun: !marker.done, marker: marker.info })
      }
      case 'detect': {
        const report = await detectSystem()
        return Response.json({ report })
      }
      case 'health': {
        const health = await systemHealth()
        return Response.json({ health })
      }
      case 'update': {
        const update = await updateCheck()
        return Response.json({ update })
      }
      case 'winget-list':
        return Response.json({
          packages: [
            { id: 'Google.Chrome', label: 'Google Chrome', needed: 'renderizar vídeos (o JARVIS usa WebCodecs no Chrome — não usa FFmpeg)' },
            { id: 'Ollama.Ollama', label: 'Ollama', needed: 'modelos de IA locais grátis (opcional; provedores na nuvem também funcionam)' },
            { id: 'Git.Git', label: 'Git', needed: 'fluxos de repositório (opcional)' },
            { id: 'Gyan.FFmpeg', label: 'FFmpeg', needed: 'opcional — o JARVIS não depende dele hoje' },
          ],
        })
      default:
        return fail('Ação inválida', 404)
    }
  } catch (e) {
    return fail(e, 500)
  }
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { return fail('JSON inválido', 400) }
  try {
    switch (String(body.action || '')) {
      case 'ack': {
        const result = markSetupDone()
        return Response.json(result)
      }
      case 'repair': {
        const fix = String(body.fix || '')
        if (!['dirs', 'prefs', 'env-example', 'keys-file'].includes(fix)) return fail('Reparo desconhecido', 400)
        return Response.json(applyRepair(fix as 'dirs' | 'prefs' | 'env-example' | 'keys-file'))
      }
      case 'winget': {
        // Instalação explícita pedida pelo usuário no assistente — nunca automática
        const id = String(body.id || '')
        const result = await wingetInstall(id)
        return Response.json(result, { status: result.ok ? 200 : 400 })
      }
      default:
        return fail('Ação inválida', 404)
    }
  } catch (e) {
    return fail(e, 500)
  }
}
