import fs from 'fs'
import path from 'path'
import { Readable } from 'stream'
import { NextRequest } from 'next/server'
import { generateImage, generateImages, imageFile, listImages, providerStatus, editImage, type Aspect, type ImageProviderId } from '@/lib/media/images'
import { dataDir, readJson, writeJsonAtomic } from '@/lib/agents/fsutil'
import { cancelVideoJob, createVideoJob, deleteVideoJob, getVideoJob, getVideoManifest, listVideoJobs, recoverVideoJobs, regenerateVideoJob, saveVideoScript, videoDir, videoJobDir } from '@/lib/video/produce'
import { findBrowser } from '@/lib/motion/chrome'
import { VIDEO_FORMATS } from '@/lib/video/formats'
import { listNarrationVoices } from '@/lib/video/edgeTts'
import { GEMINI_VOICES } from '@/lib/voice/gemini'
import { MOOD_LABELS } from '@/lib/video/audioMix'

const ASPECTS: Aspect[] = ['1:1', '9:16', '16:9', '4:5', '3:2', '2:3']

const FILES = /^(video\.mp4|audio\.wav|narracao\.wav|legendas\.srt|legendas\.vtt|previa_\d{5}\.jpg|cena_\d{2}\.jpg|script\.json|qa\.json)$/
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
      case 'image': {
        const id = String(sp.get('id') || '')
        if (!id) return Response.json({ images: listImages() })
        const img = listImages().find(i => i.id === id)
        if (!img) return fail('Imagem não encontrada', 404)
        const file = path.join(dataDir(), 'images', img.file)
        if (!fs.existsSync(file)) return fail('Arquivo não encontrado', 404)
        const size = fs.statSync(file).size
        const type = img.file.endsWith('.png') ? 'image/png' : img.file.endsWith('.webp') ? 'image/webp' : 'image/jpeg'
        return new Response(fs.readFileSync(file), { headers: { 'Content-Type': type, 'Content-Length': String(size), 'Cache-Control': 'no-store' } })
      }
      case 'image/job': {
        const id = String(sp.get('id') || '')
        if (!id) return Response.json({ images: listImages() })
        const indexPath = path.join(dataDir(), 'image-jobs.json')
        const jobs = readJson<any[]>(indexPath, [])
        const job = jobs.find(j => j.id === id)
        if (job) {
          return Response.json({ status: job.status, progress: job.progress, imageId: job.imageId })
        }
        return Response.json({ status: 'queued', progress: 0 })
      }
      case 'providers': return Response.json({ providers: providerStatus() })
      default: return Response.json({ images: listImages().slice(0, 100) })
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
      case 'generate': {
        const aspect = ASPECTS.find(a => a === body.aspect)
        const provider = (['auto', 'gemini', 'pollinations'] as const).find(p => p === body.provider) as 'auto' | ImageProviderId | undefined
        const count = Math.max(1, Math.min(4, Number(body.count) || 1))
        if (count > 1) {
          const images = await generateImages(String(body.prompt || ''), count, { aspect, provider, style: typeof body.style === 'string' ? body.style : undefined })
          const urls = images.map(i => `/api/media?image=${i.id}`)
          return Response.json({ images, urls })
        }
        const img = await generateImage(String(body.prompt || ''), { aspect, provider, style: typeof body.style === 'string' ? body.style : undefined, width: Number(body.width) || undefined, height: Number(body.height) || undefined })
        return Response.json({ image: img, url: `/api/media?image=${img.id}` })
      }
      case 'imageJob': {
        const id = String(body.id || '')
        if (!id) return Response.json({ ok: false, error: 'ID necessário' })
        const indexPath = path.join(dataDir(), 'image-jobs.json')
        const jobs = readJson<any[]>(indexPath, [])
        const existingIdx = jobs.findIndex(j => j.id === id)
        if (body.prompt) {
          const jobData = {
            id,
            prompt: body.prompt,
            aspect: body.aspect || '16:9',
            status: 'queued',
            progress: 0,
            createdAt: Date.now(),
            imageId: body.imageId
          }
          if (existingIdx >= 0) jobs[existingIdx] = jobData
          else jobs.push(jobData)
          writeJsonAtomic(indexPath, jobs)
        }
        return Response.json({ ok: true, status: 'queued', progress: 0 })
      }
      case 'edit': {
        const data = typeof body.imageData === 'string' ? body.imageData : ''
        const mimeType = typeof body.mimeType === 'string' ? body.mimeType : 'image/jpeg'
        if (!data) return Response.json({ error: 'Imagem não fornecida' }, { status: 400 })
        const buf = Buffer.from(data, 'base64')
        const img = await editImage({ data: buf, mimeType }, String(body.instruction || ''))
        return Response.json({ image: img, url: `/api/media?image=${img.id}` })
      }
      default: return fail('Ação inválida', 404)
    }
  } catch (e) {
    return fail(e)
  }
}