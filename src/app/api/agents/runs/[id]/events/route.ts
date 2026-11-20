import { NextRequest } from 'next/server'
import { getRuntime } from '@/lib/agents/runtime'
import { readEvents } from '@/lib/agents/store'

export const dynamic = 'force-dynamic'

/** Server-Sent Events: a snapshot first, then every event plus a throttled run snapshot. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const rt = getRuntime()
  const run = rt.getRun(id)
  if (!run) return Response.json({ error: 'Execução não encontrada' }, { status: 404 })

  const encoder = new TextEncoder()
  let unsubscribe: (() => void) | undefined
  let ticker: ReturnType<typeof setInterval> | undefined

  const stream = new ReadableStream({
    start(controller) {
      const send = (type: string, data: unknown) => {
        try { controller.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)) } catch {}
      }
      send('snapshot', { run, events: readEvents(run.sessionId, run.id, 300) })

      const ctrl = rt.runs.get(id)
      if (!ctrl) { send('end', {}); controller.close(); return }

      let dirty = false
      unsubscribe = ctrl.subscribe(e => { send('event', e); dirty = true })
      ticker = setInterval(() => {
        if (dirty) { dirty = false; send('run', ctrl.run) }
        else send('ping', {})
      }, 700)

      ctrl.done.finally(() => {
        setTimeout(() => {
          send('run', ctrl.run)
          send('end', {})
          unsubscribe?.()
          clearInterval(ticker)
          try { controller.close() } catch {}
        }, 300)
      })

      req.signal.addEventListener('abort', () => {
        unsubscribe?.()
        clearInterval(ticker)
        try { controller.close() } catch {}
      })
    },
    cancel() {
      unsubscribe?.()
      clearInterval(ticker)
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' },
  })
}
