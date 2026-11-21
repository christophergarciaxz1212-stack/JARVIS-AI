/**
 * Sessões de terminal: criar, listar, escrever, interromper, fechar — e
 * acompanhar a saída ao vivo por SSE.
 *
 * A sessão vive no servidor (ver lib/terminal), então a saída continua
 * chegando mesmo que a interface recarregue no meio de um comando.
 */
import { NextRequest } from 'next/server'
import {
  closeTerminal, createTerminal, getTerminal, listTerminals, writeTerminal, type TerminalChunk,
} from '@/lib/terminal'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const fail = (e: unknown, status = 400) =>
  Response.json({ error: e instanceof Error ? e.message : String(e) }, { status })

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams
  const action = sp.get('action') || 'list'

  if (action === 'list') return Response.json({ sessions: listTerminals() })

  if (action === 'history') {
    const s = getTerminal(String(sp.get('id')))
    if (!s) return fail('Terminal não encontrado', 404)
    return Response.json({ session: s.info(), chunks: s.history(Number(sp.get('after')) || 0) })
  }

  if (action === 'stream') {
    const s = getTerminal(String(sp.get('id')))
    if (!s) return fail('Terminal não encontrado', 404)
    const after = Number(sp.get('after')) || 0

    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let open = true
        const send = (event: string, data: unknown) => {
          if (!open) return
          try { controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)) } catch { open = false }
        }

        // O que já aconteceu antes de o cliente se conectar
        for (const c of s.history(after)) send('chunk', c)

        const unsubscribe = s.subscribe((c: TerminalChunk) => send('chunk', c))
        // Alguns proxies cortam conexões silenciosas
        const ping = setInterval(() => send('ping', { at: Date.now() }), 20_000)

        const stop = () => {
          if (!open) return
          open = false
          clearInterval(ping)
          unsubscribe()
          try { controller.close() } catch { /* já fechado */ }
        }
        req.signal.addEventListener('abort', stop, { once: true })
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    })
  }

  return fail('Ação inválida', 404)
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch {}

  try {
    switch (String(body.action || '')) {
      case 'create':
        return Response.json({
          session: createTerminal({
            shell: body.shell === 'cmd' ? 'cmd' : 'powershell',
            cwd: typeof body.cwd === 'string' ? body.cwd : undefined,
            title: typeof body.title === 'string' ? body.title : undefined,
          }),
        })

      case 'write':
        return Response.json({ session: writeTerminal(String(body.id || ''), String(body.line ?? '')) })

      case 'interrupt': {
        const s = getTerminal(String(body.id || ''))
        if (!s) return fail('Terminal não encontrado', 404)
        // `killed` é quantos processos realmente pararam — a interface diz a
        // verdade em vez de afirmar que interrompeu sempre.
        const killed = await s.interrupt()
        return Response.json({ ok: killed > 0, killed, session: s.info() })
      }

      case 'close':
        return Response.json({ ok: closeTerminal(String(body.id || '')) })

      default:
        return fail('Ação inválida', 404)
    }
  } catch (e) {
    return fail(e)
  }
}
