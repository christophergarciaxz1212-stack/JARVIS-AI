import fs from 'fs'
import path from 'path'
import { NextRequest } from 'next/server'
import {
  connect, createPost, deletePost, disconnect, listBrands, listScheduled, normalizeUrl, overview, saveConfig, status, uploadMedia,
  type InstagramType, type Network,
} from '@/lib/social/metricool'
import { imageFile, listImages } from '@/lib/media/images'
import { jobDir, listJobs } from '@/lib/motion/jobs'
import { audit } from '@/lib/infra/log'
import { defaultComplete } from '@/lib/agents/models'
import { defaultModelFrom, getLiveCatalog } from '@/lib/ai/catalog'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const fail = (e: unknown, code = 400) => Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: code })
const str = (v: unknown) => (typeof v === 'string' ? v : '')

type Attachment = { kind: 'image'; id: string } | { kind: 'video'; id: string } | { kind: 'url'; url: string }

/** Attachments are references to the JARVIS gallery (never arbitrary paths from the client). */
function resolveLocal(a: Attachment): string {
  if (a.kind === 'image') {
    const f = imageFile(a.id)
    if (!f) throw new Error('Imagem não encontrada na galeria do JARVIS')
    return f.file
  }
  if (a.kind === 'video') {
    const job = listJobs().find(j => j.id === a.id && j.status === 'done')
    const file = job && path.join(jobDir(job.id), 'video.mp4')
    if (!file || !fs.existsSync(file)) throw new Error('Vídeo não encontrado no Estúdio Motion')
    return file
  }
  throw new Error('Anexo inválido')
}

function library() {
  const images = listImages().slice(0, 40).map(i => ({ kind: 'image' as const, id: i.id, title: i.prompt.slice(0, 80), thumb: `/api/media?image=${i.id}`, createdAt: i.createdAt, aspect: i.aspect }))
  const videos = listJobs().filter(j => j.status === 'done' && fs.existsSync(path.join(jobDir(j.id), 'video.mp4'))).slice(0, 30)
    .map(j => ({ kind: 'video' as const, id: j.id, title: (j.title || j.request.prompt).slice(0, 80), thumb: j.previews?.[0] ? `/api/motion?action=file&id=${j.id}&name=${encodeURIComponent(j.previews[0])}` : undefined, createdAt: j.createdAt }))
  return [...videos, ...images].sort((a, b) => b.createdAt - a.createdAt)
}

async function caption(idea: string, networks: string[], tone: string) {
  const catalog = await getLiveCatalog()
  const model = defaultModelFrom(catalog)
  if (!model) throw new Error('Conecte uma IA (Chaves de API) para gerar legendas')
  const c = await defaultComplete(model, [
    {
      role: 'system',
      content: `Você é social media brasileiro. Escreva UMA legenda pronta para ${networks.join(' e ') || 'Instagram'} em português do Brasil.
Regras: gancho forte na primeira linha; frases curtas; 1-3 emojis no máximo; CTA no final; depois uma linha em branco e 5 a 8 hashtags relevantes (mistura de grandes e de nicho).${tone ? ` Tom: ${tone}.` : ''}
TikTok: legenda mais curta (até 150 caracteres antes das hashtags). Responda só com a legenda.`,
    },
    { role: 'user', content: idea },
  ], AbortSignal.timeout(30_000))
  return c.text.trim()
}

export async function GET(req: NextRequest) {
  const q = new URL(req.url).searchParams
  try {
    switch (q.get('action') || 'status') {
      case 'status': return Response.json(status())
      case 'brands': return Response.json({ brands: await listBrands() })
      case 'overview': return Response.json(await overview(Math.max(7, Math.min(90, Number(q.get('days')) || 30))))
      case 'scheduled': return Response.json({ posts: await listScheduled() })
      case 'library': return Response.json({ items: library() })
      default: return fail('Ação inválida', 404)
    }
  } catch (e) {
    return fail(e, 502)
  }
}

export async function POST(req: NextRequest) {
  let b: Record<string, unknown>
  try { b = await req.json() } catch { return fail('JSON inválido') }
  try {
    switch (str(b.action)) {
      case 'connect': {
        const brands = await connect(str(b.token), str(b.userId))
        audit({ actor: 'user', action: 'metricool:connect', target: `userId ${str(b.userId)}`, ok: true, detail: `${brands.length} marca(s)` })
        return Response.json({ brands, ...status() })
      }
      case 'select-brand': return Response.json({ config: saveConfig({ blogId: str(b.blogId), brandLabel: str(b.label) || undefined }) })
      case 'timezone': return Response.json({ config: saveConfig({ timezone: str(b.timezone) || undefined }) })
      case 'disconnect': disconnect(); audit({ actor: 'user', action: 'metricool:disconnect', ok: true }); return Response.json({ ok: true })
      case 'caption': return Response.json({ caption: await caption(str(b.idea).slice(0, 2000), Array.isArray(b.networks) ? b.networks.map(String) : [], str(b.tone).slice(0, 80)) })
      case 'create': {
        const attachments = (Array.isArray(b.attachments) ? b.attachments : []) as Attachment[]
        const media: string[] = []
        for (const a of attachments.slice(0, 10)) media.push(a.kind === 'url' ? await normalizeUrl(a.url) : await uploadMedia(resolveLocal(a)))
        const networks = (Array.isArray(b.networks) ? b.networks : []).filter((n): n is Network => n === 'instagram' || n === 'tiktok')
        const post = await createPost({
          text: str(b.text).slice(0, 2200),
          networks,
          when: str(b.when),
          instagramType: (['POST', 'REEL', 'STORY'] as const).find(t => t === b.instagramType) as InstagramType | undefined,
          tiktokPrivacy: str(b.tiktokPrivacy) || undefined,
          tiktokTitle: str(b.tiktokTitle) || undefined,
          firstComment: str(b.firstComment) || undefined,
          media,
          draft: b.draft === true,
        })
        audit({ actor: 'user', action: b.draft === true ? 'metricool:rascunho' : 'metricool:agendar', target: `${networks.join('+')} ${str(b.when)}`, ok: true, detail: str(b.text).slice(0, 120) })
        return Response.json({ post })
      }
      case 'delete': {
        await deletePost(Number(b.id))
        audit({ actor: 'user', action: 'metricool:excluir', target: String(b.id), ok: true })
        return Response.json({ ok: true })
      }
      default: return fail('Ação inválida', 404)
    }
  } catch (e) {
    return fail(e)
  }
}
