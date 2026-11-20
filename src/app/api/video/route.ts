import fs from 'fs'
import path from 'path'
import { Readable } from 'stream'
import { NextRequest } from 'next/server'
import { findBrowser } from '@/lib/motion/chrome'
import {
  cancelVideoJob, createVideoJob, deleteVideoJob, getVideoJob, getVideoManifest, listVideoJobs,
  recoverVideoJobs, regenerateVideoJob, saveVideoScript, videoDir, videoJobDir,
  moveVideoScene, deleteVideoScene, duplicateVideoScene, previewVoice,
} from '@/lib/video/produce'
import { VIDEO_FORMATS } from '@/lib/video/formats'
import { downloadDisposition } from '@/lib/video/download'
import { listNarrationVoices } from '@/lib/video/edgeTts'
import { GEMINI_VOICES } from '@/lib/voice/gemini'
import { MOOD_LABELS } from '@/lib/video/audioMix'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const FILES = /^(video\.mp4|audio\.wav|narracao\.wav|narracao\.mp3|legendas\.srt|legendas\.vtt|previa_\d{5}\.jpg|cena_\d{2}\.jpg|script\.json|qa\.json)$/
const TYPES: Record<string, string> = {
  '.mp4': 'video/mp4', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.srt': 'application/x-subrip', '.vtt': 'text/vtt',
  '.jpg': 'image/jpeg', '.json': 'application/json',
}
let recovered = false

const web = (s: fs.ReadStream) => Readable.toWeb(s) as unknown as ReadableStream<Uint8Array>
const fail = (e: unknown, status = 400) => Response.json({ error: e instanceof Error ? e.message : String(e) }, { status })

export async function GET(req: NextRequest) {
  if (!recovered) { recovered = true; recoverVideoJobs() }
  const sp = new URL(req.url).searchParams
  try {
    switch (sp.get('action') || 'list') {
      case 'list': return Response.json({ jobs: listVideoJobs().slice(0, 60), browser: !!findBrowser(), formats: VIDEO_FORMATS, musicMoods: MOOD_LABELS })
      case 'job': {
        const job = getVideoJob(String(sp.get('id')))
        return job ? Response.json({ job }) : fail('Vídeo não encontrado', 404)
      }
      case 'script': {
        const id = String(sp.get('id'))
        const manifest = getVideoManifest(id)
        if (!manifest) return fail('Este vídeo não tem roteiro salvo', 404)
        return Response.json({ script: manifest })
      }
      case 'voices': {
        let edge: Array<{ id: string; label: string; gender: string }> = []
        try {
          edge = (await listNarrationVoices()).map(v => ({ id: v.ShortName, label: `Edge · ${v.ShortName.replace(/^pt-BR-/, '').replace(/Neural$/, '').replace(/Multilingual/, ' multilíngue')}`, gender: v.Gender === 'Female' ? 'feminina' : 'masculina' }))
        } catch {}
        const gemini = GEMINI_VOICES.map(v => ({ id: v.id, label: `Gemini · ${v.id} (${v.style.toLowerCase()})`, gender: v.gender }))
        const windows = [{ id: '', label: 'Voz do Windows (offline)', gender: 'sistema' }]
        return Response.json({ edge, gemini, windows })
      }
      case 'file': {
        const job = getVideoJob(String(sp.get('id')))
        const name = String(sp.get('name') || '')
        if (!job || !FILES.test(name)) return fail('Arquivo não encontrado', 404)
        const file = path.join(videoJobDir(job.id), name)
        if (!fs.existsSync(file)) return fail('Arquivo não encontrado', 404)
        const size = fs.statSync(file).size
        const type = TYPES[path.extname(name)] || 'application/octet-stream'
        const download = sp.get('download') === '1'
        const headers: Record<string, string> = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' }
        if (download) headers['Content-Disposition'] = downloadDisposition(job.title || 'video', path.extname(name))
        const range = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') || '')
        if (range && (range[1] || range[2])) {
          const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]))
          const end = range[1] && range[2] ? Math.min(size - 1, Number(range[2])) : size - 1
          if (start >= size || start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
          return new Response(web(fs.createReadStream(file, { start, end })), { status: 206, headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) } })
        }
        return new Response(web(fs.createReadStream(file)), { headers: { ...headers, 'Content-Length': String(size) } })
      }
      default: return fail('Ação inválida', 404)
    }
  } catch (e) {
    return fail(e)
  }
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch {}
  try {
    switch (String(body.action || '')) {
      case 'create': return Response.json({ job: createVideoJob(body as never) })
      case 'cancel': cancelVideoJob(String(body.id)); return Response.json({ ok: true })
      case 'delete': deleteVideoJob(String(body.id)); return Response.json({ ok: true })
      case 'saveScript': {
        const id = String(body.id)
        return Response.json({ script: saveVideoScript(id, Array.isArray(body.scenes) ? body.scenes as never : []) })
      }
      case 'regenerate': {
        const id = String(body.id)
        const scene = body.scene === undefined ? undefined : Number(body.scene)
        return Response.json({ job: regenerateVideoJob(id, Number.isFinite(scene) ? scene : undefined) })
      }
      case 'moveScene': {
        const id = String(body.id)
        return Response.json({ script: moveVideoScene(id, Number(body.from), Number(body.to)) })
      }
      case 'deleteScene': {
        const id = String(body.id)
        return Response.json({ script: deleteVideoScene(id, Number(body.index)) })
      }
      case 'voicePreview': {
        const v = (body.voice || {}) as { provider?: unknown; id?: unknown }
        const r = await previewVoice({ provider: String(v.provider || 'edge'), id: typeof v.id === 'string' ? v.id : '' }, String(body.text || ''), req.signal)
        return new Response(web(fs.createReadStream(r.file)), { headers: { 'Content-Type': r.type, 'Cache-Control': 'no-store', 'X-Voice-Provider': encodeURIComponent(r.provider) } })
      }
      case 'duplicateScene': {
        const id = String(body.id)
        return Response.json({ script: duplicateVideoScene(id, Number(body.index)) })
      }
      default: return fail('Ação inválida', 404)
    }
  } catch (e) {
    return fail(e)
  }
}
