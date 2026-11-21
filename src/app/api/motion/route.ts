import fs from 'fs'
import path from 'path'
import { Readable } from 'stream'
import { NextRequest } from 'next/server'
import { findBrowser } from '@/lib/motion/chrome'
import { cancelJob, createJob, deleteJob, getJob, jobDir, listJobs, recoverJobs } from '@/lib/motion/jobs'
import { downloadDisposition } from '@/lib/media/download'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const FILES = /^(video\.mp4|audio\.wav|previa_\d{5}\.jpg)$/
const TYPES: Record<string, string> = { '.mp4': 'video/mp4', '.wav': 'audio/wav', '.jpg': 'image/jpeg' }
let recovered = false

const web = (s: fs.ReadStream) => Readable.toWeb(s) as unknown as ReadableStream<Uint8Array>
const fail = (e: unknown, status = 400) => Response.json({ error: e instanceof Error ? e.message : String(e) }, { status })

export async function GET(req: NextRequest) {
  if (!recovered) { recovered = true; recoverJobs() }
  const sp = new URL(req.url).searchParams
  try {
    switch (sp.get('action') || 'list') {
      case 'list': return Response.json({ jobs: listJobs().slice(0, 60), browser: !!findBrowser() })
      case 'job': {
        const job = getJob(String(sp.get('id')))
        return job ? Response.json({ job }) : fail('Vídeo não encontrado', 404)
      }
      case 'file': {
        const job = getJob(String(sp.get('id')))
        const name = String(sp.get('name') || '')
        if (!job || !FILES.test(name)) return fail('Arquivo não encontrado', 404)
        const file = path.join(jobDir(job.id), name)
        if (!fs.existsSync(file)) return fail('Arquivo não encontrado', 404)
        const size = fs.statSync(file).size
        const type = TYPES[path.extname(name)] || 'application/octet-stream'
        const download = sp.get('download') === '1'
        const headers: Record<string, string> = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' }
        if (download) headers['Content-Disposition'] = downloadDisposition(job.title || 'video', path.extname(name))
        // Range requests let the player seek inside the video
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
      case 'create': return Response.json({ job: createJob(body) })
      case 'cancel': cancelJob(String(body.id)); return Response.json({ ok: true })
      case 'delete': deleteJob(String(body.id)); return Response.json({ ok: true })
      default: return fail('Ação inválida', 404)
    }
  } catch (e) {
    return fail(e)
  }
}
