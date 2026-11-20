import { NextRequest } from 'next/server'
import { getConfig } from '@/lib/wa/config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const GRAPH_VERSION = 'v21.0'
const MEDIA_MAX_BYTES = 16 * 1024 * 1024 // limites da Meta: imagem/vídeo 5-16MB; documento 100MB; áudio 16MB — usamos 16MB para tudo
const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'video/mp4', 'video/3gpp',
  'audio/aac', 'audio/mp4', 'audio/mpeg', 'audio/amr', 'audio/ogg', 'audio/opus',
  'application/pdf', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain', 'text/csv',
])

/**
 * POST multipart (campo "file") → envia o arquivo para a Meta (/media) e devolve o media_id.
 * Os bytes nunca ficam salvos — vão direto da memória para a Graph API.
 */
export async function POST(req: NextRequest) {
  const cfg = getConfig()
  const token = process.env.WA_ACCESS_TOKEN
  if (!token || !cfg.phoneNumberId) {
    return Response.json({ error: 'Configure Phone Number ID e WA_ACCESS_TOKEN primeiro (🔑 Chaves de API).' }, { status: 400 })
  }
  let form: FormData
  try { form = await req.formData() } catch { return Response.json({ error: 'multipart/form-data esperado' }, { status: 400 }) }
  const file = form.get('file')
  if (!(file instanceof File)) return Response.json({ error: 'Campo "file" obrigatório' }, { status: 400 })
  if (file.size > MEDIA_MAX_BYTES) return Response.json({ error: 'Arquivo maior que 16 MB (limite usado pelo JARVIS)' }, { status: 413 })
  if (ALLOWED_MIME.size && !ALLOWED_MIME.has(file.type)) {
    return Response.json({ error: `Tipo não suportado pela WhatsApp Cloud API: ${file.type || 'desconhecido'}` }, { status: 415 })
  }

  const body = new FormData()
  body.append('messaging_product', 'whatsapp')
  body.append('type', file.type)
  body.append('file', new Blob([await file.arrayBuffer()], { type: file.type }), file.name || 'arquivo')

  try {
    const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(cfg.phoneNumberId)}/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body,
      signal: AbortSignal.timeout(60_000),
    })
    const data = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } }
    if (!res.ok || !data.id) {
      return Response.json({ error: data.error?.message || `Meta recusou o upload (HTTP ${res.status})` }, { status: 502 })
    }
    return Response.json({ ok: true, id: data.id, mimeType: file.type, filename: file.name, size: file.size })
  } catch (e) {
    return Response.json({ error: `Falha ao enviar mídia para a Meta: ${(e as Error).message}` }, { status: 502 })
  }
}

/**
 * GET ?id= — proxy de mídia recebida (a Meta serve os bytes só com o token).
 */
export async function GET(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id')?.trim()
  if (!id) return new Response('id obrigatório', { status: 400 })
  const token = process.env.WA_ACCESS_TOKEN
  if (!token) return new Response('WA_ACCESS_TOKEN não configurado', { status: 500 })

  try {
    const meta = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    })
    const data = (await meta.json().catch(() => ({}))) as { url?: string; mime_type?: string; error?: { message?: string } }
    if (!meta.ok || !data.url) {
      return new Response(data.error?.message || `Meta não liberou a mídia (HTTP ${meta.status})`, { status: meta.status === 404 ? 404 : 502 })
    }
    const bin = await fetch(data.url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    })
    if (!bin.ok) return new Response('Falha ao baixar a mídia da Meta', { status: 502 })
    const buf = Buffer.from(await bin.arrayBuffer())
    return new Response(buf, {
      status: 200,
      headers: {
        'Content-Type': data.mime_type || bin.headers.get('content-type') || 'application/octet-stream',
        'Cache-Control': 'private, max-age=300',
      },
    })
  } catch (e) {
    return new Response(`Erro ao buscar mídia: ${e instanceof Error ? e.message : String(e)}`, { status: 502 })
  }
}
