/**
 * Estúdio de vídeo: criar produção, acompanhar, cancelar, revisar e baixar os
 * arquivos (vídeo, legenda, narração, capa, projeto).
 *
 * O vídeo é servido com suporte a Range: é o que deixa o player da conversa
 * avançar e voltar sem baixar o arquivo inteiro.
 */
import fs from 'fs'
import path from 'path'
import { Readable } from 'stream'
import { NextRequest } from 'next/server'
import {
  cancelStudioJob, createStudioJob, getStudioJob, listStudioJobs, studioFile,
} from '@/lib/studio/producer'
import type { Aspect, Mood, Quality, StudioRequest } from '@/lib/studio/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TYPES: Record<string, string> = {
  '.mp4': 'video/mp4', '.srt': 'application/x-subrip', '.wav': 'audio/wav',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json',
}

const fail = (e: unknown, status = 400) => Response.json({ error: e instanceof Error ? e.message : String(e) }, { status })
const web = (s: fs.ReadStream) => Readable.toWeb(s) as unknown as ReadableStream<Uint8Array>

/** Nome de arquivo para o download, a partir do título do vídeo. */
function nomeDownload(titulo: string, ext: string) {
  const limpo = titulo.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'video'
  return `attachment; filename="${limpo}${ext}"; filename*=UTF-8''${encodeURIComponent(titulo.slice(0, 60) + ext)}`
}

/** Só o que conhecemos entra no pedido: nada de campo estranho virando opção. */
function sanitize(body: Record<string, unknown>): StudioRequest {
  const aspects: Aspect[] = ['16:9', '9:16', '1:1']
  const qualities: Quality[] = ['720p', '1080p']
  const moods: Array<Mood | 'auto' | 'nenhuma'> = ['auto', 'nenhuma', 'epico', 'inspirador', 'atmosferico', 'tenso', 'documental', 'publicitario', 'tecnologico']
  const req: StudioRequest = { prompt: String(body.prompt || '').slice(0, 4000) }
  if (aspects.includes(body.aspect as Aspect)) req.aspect = body.aspect as Aspect
  if (qualities.includes(body.quality as Quality)) req.quality = body.quality as Quality
  if (typeof body.seconds === 'number' && Number.isFinite(body.seconds)) req.seconds = body.seconds
  if (typeof body.voice === 'string' && /^[a-z]{2}-[A-Z]{2}-\w+$/.test(body.voice)) req.voice = body.voice
  if (typeof body.narration === 'boolean') req.narration = body.narration
  if (typeof body.captions === 'boolean') req.captions = body.captions
  if (moods.includes(body.music as Mood)) req.music = body.music as Mood
  return req
}

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams
  try {
    switch (sp.get('action') || 'list') {
      case 'list':
        return Response.json({ jobs: listStudioJobs() })
      case 'job': {
        const job = getStudioJob(String(sp.get('id')))
        return job ? Response.json({ job }) : fail('Vídeo não encontrado', 404)
      }
      case 'file': {
        const id = String(sp.get('id'))
        const name = String(sp.get('name') || '')
        const file = studioFile(id, name)
        if (!file) return fail('Arquivo não encontrado', 404)
        const job = getStudioJob(id)
        const size = fs.statSync(file).size
        const ext = path.extname(name)
        const headers: Record<string, string> = {
          'Content-Type': TYPES[ext] || 'application/octet-stream',
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-store',
        }
        if (sp.get('download') === '1') headers['Content-Disposition'] = nomeDownload(job?.title || 'video', ext)

        const range = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') || '')
        if (range && (range[1] || range[2])) {
          const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]))
          const end = range[1] && range[2] ? Math.min(size - 1, Number(range[2])) : size - 1
          if (start >= size || start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
          return new Response(web(fs.createReadStream(file, { start, end })), {
            status: 206,
            headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) },
          })
        }
        return new Response(web(fs.createReadStream(file)), { headers: { ...headers, 'Content-Length': String(size) } })
      }
      default:
        return fail('Ação inválida', 404)
    }
  } catch (e) {
    return fail(e, 500)
  }
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch {}
  try {
    switch (String(body.action || '')) {
      case 'create':
        return Response.json({ job: createStudioJob(sanitize(body)) })
      case 'revise': {
        const feedback = String(body.feedback || '').trim().slice(0, 2000)
        if (!feedback) return fail('Diga o que mudar no vídeo')
        return Response.json({ job: createStudioJob(sanitize({ ...body, prompt: '' }), { parentId: String(body.id || ''), feedback }) })
      }
      case 'cancel':
        return Response.json({ ok: cancelStudioJob(String(body.id || '')) })
      default:
        return fail('Ação inválida', 404)
    }
  } catch (e) {
    return fail(e)
  }
}
