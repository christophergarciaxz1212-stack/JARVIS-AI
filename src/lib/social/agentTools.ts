import type { ToolHost, ToolSpec } from '../agents/tools'
import type { ToolAction } from '../agents/parse'
import { audit } from '../infra/log'
import { imageFile } from '../media/images'
import { generateCaption, loadStoryboard } from './caption'
import fs from 'fs'
import path from 'path'
import { dataDir as sharedDataDir } from '../agents/fsutil'
import { createPost, listScheduled, overview, status, uploadMedia, type Network } from './metricool'

export const SOCIAL_TOOL_DOCS = `
Redes sociais (Metricool — Instagram e TikTok do usuário):
- social_stats {"days": 30} → seguidores, visualizações e melhores posts do Instagram e do TikTok
- social_scheduled {} → posts agendados nos próximos 30 dias
- social_draft {"text": "legenda + hashtags", "networks": ["instagram","tiktok"], "when": "YYYY-MM-DDTHH:mm", "image_id": "id de imagem gerada pelo JARVIS (opcional)"} → cria um RASCUNHO no Metricool; quem publica é o usuário
- social_video {"video_id": "id do trabalho do Estúdio de Vídeo ou Motion (opcional)", "video_path": "caminho absoluto de um .mp4 (opcional)", "caption": "legenda pronta (opcional — se vazia, o JARVIS escreve)", "networks": ["instagram","tiktok"], "when": "YYYY-MM-DDTHH:mm (opcional, padrão agora)"} → sobe o vídeo no Metricool e cria RASCUNHO; com SOCIAL_AUTOPOST=1 no .env.local, CONFIRMA publicação automática para o horário de <when>`

const obj = (properties: Record<string, unknown>, required: string[]) => ({ type: 'object', properties, required })

export const SOCIAL_TOOL_SPECS: ToolSpec[] = [
  { name: 'social_stats', description: 'Métricas do Instagram e TikTok (Metricool)', parameters: obj({ days: { type: 'integer' } }, []) },
  { name: 'social_scheduled', description: 'Posts agendados no Metricool', parameters: obj({}, []) },
  { name: 'social_draft', description: 'Cria um rascunho de post no Metricool (o usuário publica)', parameters: obj({ text: { type: 'string' }, networks: { type: 'array', items: { type: 'string', enum: ['instagram', 'tiktok'] } }, when: { type: 'string', description: 'YYYY-MM-DDTHH:mm' }, image_id: { type: 'string' } }, ['text', 'networks']) },
  { name: 'social_video', description: 'Sobe um vídeo produzido pelo JARVIS no Metricool como Instagram Reel + TikTok. Padrão: rascunho; com SOCIAL_AUTOPOST=1, o usuário confirma publicação automática pelo horário (o JARVIS nunca publica sozinho).', parameters: obj({ video_id: { type: 'string', description: 'id do job do Estúdio de Vídeo ou Motion (opcional)' }, video_path: { type: 'string', description: 'caminho absoluto para o .mp4 (opcional — só um dos dois)' }, caption: { type: 'string', description: 'legenda pronta (opcional — se vazio, o JARVIS escreve com IA)' }, networks: { type: 'array', items: { type: 'string', enum: ['instagram', 'tiktok'] } }, when: { type: 'string', description: 'YYYY-MM-DDTHH:mm (padrão: agora + 5 min)' }, tiktok_title: { type: 'string' }, instagram_type: { type: 'string', enum: ['POST', 'REEL', 'STORY'] } }, ['networks']) },
]

export const isSocialTool = (name: string) => SOCIAL_TOOL_SPECS.some(t => t.name === name)

const n = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)} mil` : String(Math.round(v)))

const dataDir = () => sharedDataDir()

const listDoneVideos = (): Array<{ id: string; file: string; at: number; prompt?: string; title?: string }> => {
  const out: Array<{ id: string; file: string; at: number; prompt?: string; title?: string }> = []
  try {
    const candidates = [
      path.join(dataDir(), 'video', 'jobs.json'),
      path.join(dataDir(), 'motion', 'jobs.json'),
    ]
    for (const f of candidates) {
      if (!fs.existsSync(f)) continue
      const jobs = JSON.parse(fs.readFileSync(f, 'utf8')) as Array<{ id: string; status?: string; output?: string; createdAt?: number; finishedAt?: number; request?: { prompt?: string }; title?: string }>
      for (const j of jobs) {
        if (j.status !== 'done') continue
        const p = j.output || (path.join(path.dirname(f), j.id, 'video.mp4'))
        if (fs.existsSync(p)) out.push({ id: j.id, file: p, at: j.finishedAt || j.createdAt || 0, prompt: j.request?.prompt, title: j.title })
      }
    }
  } catch {}
  // Estúdio de vídeo: um job.json por pasta em data/studio/<id>/
  try {
    const dir = path.join(dataDir(), 'studio')
    for (const id of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(dir, id, 'job.json'), 'utf8')) as { id: string; status?: string; output?: string; createdAt?: number; finishedAt?: number; request?: { prompt?: string }; title?: string }
        const p = j.output || path.join(dir, id, 'video.mp4')
        if (j.status === 'done' && fs.existsSync(p)) out.push({ id: j.id, file: p, at: j.finishedAt || j.createdAt || 0, prompt: j.request?.prompt, title: j.title })
      } catch {}
    }
  } catch {}
  return out.sort((a, b) => b.at - a.at)
}

const resolveVideoFile = (videoId: string | undefined): { file: string; id?: string; prompt?: string; title?: string } => {
  if (videoId) {
    const directMotion = path.join(dataDir(), 'motion', videoId, 'video.mp4')
    if (fs.existsSync(directMotion)) return { file: directMotion, id: videoId }
    const directStudio = /^[\w-]{1,80}$/.test(videoId) ? path.join(dataDir(), 'studio', videoId, 'video.mp4') : ''
    if (directStudio && fs.existsSync(directStudio)) return { file: directStudio, id: videoId }
    // Perhaps the id is a jobs.json entry rather than a folder name
    const done = listDoneVideos().find(x => x.id === videoId)
    if (done) return done
    // Ultimate fallback: accept an absolute path in video_id (caller-provided)
    if (path.isAbsolute(videoId) && fs.existsSync(videoId)) return { file: videoId }
    throw new Error(`Vídeo "${videoId}" não encontrado. Produza um primeiro (Estúdio de Vídeo) ou informe video_path.`)
  }
  const recent = listDoneVideos()[0]
  if (!recent) throw new Error('Nenhum vídeo concluído disponível no JARVIS. Produza um no Estúdio de Vídeo antes de publicar.')
  return recent
}

export async function executeSocialTool(host: Pick<ToolHost, 'agent' | 'log'>, action: ToolAction): Promise<{ output: string }> {
  host.log('tool', `${host.agent.name} → ${action.tool}`, { tool: action.tool })
  if (!status().connected) return { output: 'O Metricool não está conectado. Peça ao usuário para conectar no botão Social (topo do app) — precisa do token da API (plano Advanced/Custom) e do userId.' }
  const a = action.args
  if (action.tool === 'social_stats') {
    const days = Math.max(7, Math.min(90, Number(a.days) || 30))
    const o = await overview(days)
    const lines = [`Período: ${days} dias`]
    const sum = (vals?: Array<{ value: number }>) => (vals || []).reduce((s, v) => s + v.value, 0)
    lines.push(o.igFollowers.ok ? `Instagram: ${sum(o.igFollowers.value.values) >= 0 ? '+' : ''}${n(sum(o.igFollowers.value.values))} seguidores no período` : `Instagram seguidores: ${o.igFollowers.error}`)
    lines.push(o.ttFollowers.ok ? `TikTok: ${n(o.ttFollowers.value.values.at(-1)?.value ?? 0)} seguidores` : `TikTok seguidores: ${o.ttFollowers.error}`)
    for (const [label, r] of [['Instagram', o.igContent], ['TikTok', o.ttContent]] as const) {
      if (!r.ok) { lines.push(`${label} posts: ${r.error}`); continue }
      const top = [...r.value].sort((x, y) => y.views + y.likes * 5 - (x.views + x.likes * 5)).slice(0, 5)
      lines.push(`${label}: ${r.value.length} publicações. Melhores:`)
      for (const p of top) lines.push(`  - ${p.publishedAt.slice(0, 10)} ${p.kind}: 👁 ${n(p.views)} ❤ ${n(p.likes)} 💬 ${n(p.comments)} — ${p.text.slice(0, 70)}`)
    }
    return { output: lines.join('\n') }
  }
  if (action.tool === 'social_scheduled') {
    const posts = await listScheduled(0, 30)
    return { output: posts.length ? posts.map(p => `${p.publicationDate?.dateTime} · ${(p.providers || []).map(x => `${x.network}:${x.status || 'agendado'}`).join(', ')}${p.draft ? ' · rascunho' : ''} — ${p.text.slice(0, 80)}`).join('\n') : 'Nada agendado nos próximos 30 dias.' }
  }
  if (action.tool === 'social_draft') {
    const networks = (Array.isArray(a.networks) ? a.networks : []).filter((x): x is Network => x === 'instagram' || x === 'tiktok')
    const media: string[] = []
    if (typeof a.image_id === 'string' && a.image_id) {
      const f = imageFile(a.image_id)
      if (!f) throw new Error('image_id não encontrado na galeria do JARVIS')
      media.push(await uploadMedia(f.file))
    }
    const when = typeof a.when === 'string' && a.when ? a.when : new Date(Date.now() + 86_400_000).toISOString().slice(0, 16)
    // Drafts only: going live on a public account is the user's decision
    const post = await createPost({ text: String(a.text || ''), networks, when, media, draft: true })
    audit({ actor: `agent:${host.agent.name}`, action: 'metricool:rascunho', target: networks.join('+'), ok: true, detail: String(a.text || '').slice(0, 120) })
    return { output: `Rascunho ${post?.id ?? ''} criado no Metricool para ${networks.join(' e ')} (${when}). O usuário revisa e agenda no botão Social › Calendário ou no Metricool.` }
  }
  if (action.tool === 'social_video') {
    const networks = (Array.isArray(a.networks) ? (a.networks as unknown[]).filter((x): x is Network => x === 'instagram' || x === 'tiktok') : [])
    if (!networks.length) throw new Error('Informe networks: ["instagram","tiktok"] (pelo menos um). Ex.: ["instagram","tiktok"].')
    const resolution = ((): { file: string; id?: string; prompt?: string; title?: string } => {
      if (typeof a.video_path === 'string' && a.video_path.trim()) {
        const p = a.video_path.trim()
        if (!path.isAbsolute(p) || !fs.existsSync(p)) throw new Error(`Arquivo não encontrado: ${p}`)
        return { file: p }
      }
      return resolveVideoFile(typeof a.video_id === 'string' ? a.video_id.trim() : undefined)
    })()
    const storyboard = resolution.id ? loadStoryboard(resolution.id) : null
    const provided = typeof a.caption === 'string' ? a.caption.trim() : ''
    const caption = provided
      ? { caption: provided, hashtags: [], model: 'user' as const }
      : await generateCaption({ prompt: [storyboard?.prompt, resolution.prompt, resolution.title, path.basename(resolution.file, path.extname(resolution.file))].filter(Boolean).join(' — '), title: storyboard?.title || resolution.title, scenes: storyboard?.scenes, platformHints: `redes: ${networks.join(', ')}; Instagram como Reel; TikTok como público ao alcance de todos` })
    const media = await uploadMedia(resolution.file)
    const when = typeof a.when === 'string' && a.when.trim() ? a.when.trim() : new Date(Date.now() + 300_000).toISOString().slice(0, 16)
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/.test(when)) throw new Error('when deve ser YYYY-MM-DDTHH:mm (ex.: 2026-12-01T19:30)')
    const autopost = process.env.SOCIAL_AUTOPOST === '1' && /^(?:true|1|yes|sim)$/i.test(String(a.autopost || '').trim())
    const draft = !autopost
    const imageOrReel = typeof a.instagram_type === 'string' && ['POST', 'REEL', 'STORY'].includes(a.instagram_type) ? a.instagram_type as 'POST' | 'REEL' | 'STORY' : 'REEL'
    const post = await createPost({ text: caption.caption, networks, when, media: [media], draft, instagramType: imageOrReel, tiktokTitle: typeof a.tiktok_title === 'string' ? a.tiktok_title : undefined, tiktokPrivacy: 'PUBLIC_TO_EVERYONE' })
    audit({ actor: `agent:${host.agent.name}`, action: 'metricool:video', target: networks.join('+'), ok: true, detail: caption.caption.slice(0, 120) })
    return { output: `${draft ? 'Rascunho' : 'Publicação criada'} no Metricool para ${networks.join(' e ')} (${when}).\nLegenda/Reel: ${caption.caption.slice(0, 400)}` }
  }
  throw new Error(`Ferramenta desconhecida: ${action.tool}`)
}
