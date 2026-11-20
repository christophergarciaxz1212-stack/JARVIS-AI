import { subscribe } from '@/lib/whatsapp/meta/realtime'
import { subscribeWa } from '@/lib/wa/sse'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  let cleanup: (() => void) | undefined

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder()
      const send = (data: unknown) => {
        try { controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`)) } catch {}
      }
      const unsub1 = subscribe((_e, d) => send(d))
      const unsub2 = subscribeWa((d) => send(d))
      const hb = setInterval(() => { try { controller.enqueue(enc.encode(`: ping\n\n`)) } catch { clearInterval(hb) } }, 25000)
      send({ type: 'ready', ts: Date.now() })
      cleanup = () => { clearInterval(hb); unsub1(); unsub2() }
    },
    cancel() { cleanup?.() },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' },
  })
}
