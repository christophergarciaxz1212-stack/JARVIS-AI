import { subscribe } from '@/lib/whatsapp/meta/realtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder()
      const send = (event: string, data: unknown) => {
        controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }
      const unsub = subscribe((event, data) => send(event, data))
      // heartbeat
      const hb = setInterval(() => {
        try { controller.enqueue(enc.encode(`: ping\n\n`)) } catch {}
      }, 25000)
      // initial
      send('ready', { ts: Date.now() })
      // cleanup on close handled by cancel
      ;(controller as any)._cleanup = () => { clearInterval(hb); unsub() }
    },
    cancel() {
      // best-effort
    },
  })
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}