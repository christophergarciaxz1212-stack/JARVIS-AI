import { NextRequest } from 'next/server'
import { addContext, clearContext, listContext, removeContext, summarize, MAX_ITEM_CHARS } from '@/lib/chat/context'
import { extractText, MAX_UPLOAD_BYTES } from '@/lib/chat/extract'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SAFE_ID = /^[\w-]{1,80}$/
const fail = (e: unknown, status = 400) => Response.json({ error: e instanceof Error ? e.message : String(e) }, { status })

export async function GET(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('conversationId') || ''
  if (!SAFE_ID.test(id)) return fail('conversationId inválido')
  return Response.json({ items: summarize(listContext(id)) })
}

export async function POST(req: NextRequest) {
  const len = Number(req.headers.get('content-length') || 0)
  // base64 ocupa ~4/3 do arquivo
  if (len > Math.ceil(MAX_UPLOAD_BYTES * 1.4) + 4096) return fail('Arquivo grande demais (máx. 10 MB)', 413)
  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { return fail('Corpo inválido (JSON esperado)') }
  try {
    switch (String(body.action || '')) {
      // Lê o arquivo e devolve o texto extraído (o cliente guarda até a conversa existir)
      case 'extract': {
        const name = String(body.name || 'arquivo').slice(0, 200)
        const data = String(body.data || '')
        if (!data) return fail('Arquivo vazio')
        const buf = Buffer.from(data, 'base64')
        const { text, kind } = await extractText(name, buf)
        const truncated = text.length > MAX_ITEM_CHARS
        return Response.json({ name, kind, chars: Math.min(text.length, MAX_ITEM_CHARS), originalChars: text.length, truncated, text: text.slice(0, MAX_ITEM_CHARS) })
      }
      case 'add': {
        const id = String(body.conversationId || '')
        if (!SAFE_ID.test(id)) return fail('conversationId inválido')
        const items = Array.isArray(body.items) ? body.items as Array<{ name?: string; text?: string; kind?: string }> : []
        return Response.json({ items: summarize(addContext(id, items)) })
      }
      case 'remove': {
        const id = String(body.conversationId || '')
        if (!SAFE_ID.test(id)) return fail('conversationId inválido')
        return Response.json({ items: summarize(removeContext(id, String(body.id || ''))) })
      }
      case 'clear': {
        const id = String(body.conversationId || '')
        if (!SAFE_ID.test(id)) return fail('conversationId inválido')
        clearContext(id)
        return Response.json({ items: [] })
      }
      default: return fail('Ação inválida', 404)
    }
  } catch (e) {
    return fail(e)
  }
}
