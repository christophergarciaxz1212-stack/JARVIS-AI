import fs from 'fs'
import path from 'path'
import { createHash } from 'crypto'
import { dataDir, readJson, writeJsonAtomic } from '../agents/fsutil'
import { saveKey } from '../keys'

const BASE = 'https://app.metricool.com/api'
export const TOKEN_ENV = 'METRICOOL_API_TOKEN'

export interface MetricoolConfig { userId: string; blogId: string; timezone: string; brandLabel?: string }
export interface Brand { blogId: string; label: string; picture?: string; instagram?: string; tiktok?: string; instagramPicture?: string; tiktokPicture?: string }
export type Network = 'instagram' | 'tiktok'
export type InstagramType = 'POST' | 'REEL' | 'STORY'

const configFile = () => path.join(dataDir(), 'social', 'metricool.json')
export const defaultTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo'

export function getConfig(): MetricoolConfig | null {
  const c = readJson<Partial<MetricoolConfig>>(configFile(), {})
  return c.userId ? { userId: c.userId, blogId: c.blogId || '', timezone: c.timezone || defaultTimezone(), brandLabel: c.brandLabel } : null
}

export function saveConfig(patch: Partial<MetricoolConfig>) {
  const cur = getConfig() || { userId: '', blogId: '', timezone: defaultTimezone() }
  const next = { ...cur, ...patch }
  writeJsonAtomic(configFile(), next)
  return next
}

export function status() {
  const c = getConfig()
  return { connected: !!process.env[TOKEN_ENV] && !!c?.userId, hasToken: !!process.env[TOKEN_ENV], config: c }
}

let fetchImpl: typeof fetch = (...a) => fetch(...a)
export function setMetricoolFetch(f: typeof fetch) { fetchImpl = f }

export class MetricoolError extends Error { constructor(message: string, readonly status = 0) { super(message) } }

function explain(status: number, body: string) {
  let msg = body.slice(0, 300)
  try { const j = JSON.parse(body) as { message?: string; error?: string; detail?: string }; msg = j.message || j.error || j.detail || msg } catch {}
  if (status === 401) return 'Token do Metricool inválido ou expirado (Metricool › Configurações da conta › API).'
  if (status === 403) return 'O Metricool recusou: a API só existe nos planos Advanced e Custom, ou esta marca não é sua.'
  if (status === 429) return 'Limite de requisições do Metricool atingido. Tente de novo em instantes.'
  return `Metricool respondeu ${status}: ${msg}`
}

/** Authenticated call: token in X-Mc-Auth, userId/blogId as query parameters on every request. */
export async function mc<T = unknown>(route: string, opts: { method?: string; query?: Record<string, string | number | undefined>; body?: unknown; brand?: boolean; config?: MetricoolConfig } = {}): Promise<T> {
  const token = process.env[TOKEN_ENV]
  const cfg = opts.config || getConfig()
  if (!token || !cfg?.userId) throw new MetricoolError('Conecte o Metricool primeiro (aba Social › Conectar).')
  const url = new URL(route.startsWith('http') ? route : `${BASE}${route}`)
  url.searchParams.set('userId', cfg.userId)
  if (opts.brand !== false) {
    if (!cfg.blogId) throw new MetricoolError('Escolha a marca (perfil) do Metricool na aba Social.')
    url.searchParams.set('blogId', cfg.blogId)
  }
  for (const [k, v] of Object.entries(opts.query || {})) if (v !== undefined && v !== '') url.searchParams.set(k, String(v))
  const res = await fetchImpl(url, {
    method: opts.method || 'GET',
    headers: { 'X-Mc-Auth': token, accept: 'application/json', ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(60_000),
  })
  const text = await res.text()
  if (!res.ok) throw new MetricoolError(explain(res.status, text), res.status)
  if (!text) return undefined as T
  try { return JSON.parse(text) as T } catch { return text as T }
}

/** Metricool wraps most v2 answers as { data: … }; older endpoints return the value itself. */
const unwrap = <T>(v: unknown): T => (v && typeof v === 'object' && !Array.isArray(v) && 'data' in (v as object) ? (v as { data: T }).data : v as T)

// ─── Connection & brands ─────────────────────────────────────────────────────

export async function listBrands(config?: MetricoolConfig): Promise<Brand[]> {
  const list = unwrap<Array<Record<string, unknown>>>(await mc('/admin/simpleProfiles', { brand: false, config }))
  return (Array.isArray(list) ? list : []).map(b => ({
    blogId: String(b.id),
    label: String(b.label || b.title || b.url || `Marca ${b.id}`),
    picture: (b.picture as string) || undefined,
    instagram: (b.instagram as string) || undefined,
    tiktok: (b.tiktok as string) || undefined,
    instagramPicture: (b.instagramPicture as string) || undefined,
    tiktokPicture: (b.tiktokPicture as string) || undefined,
  }))
}

/** Validates token + userId by listing the brands, then stores both (token in the keys vault). */
export async function connect(token: string, userId: string): Promise<Brand[]> {
  const t = token.trim()
  const u = userId.trim()
  if (!t || /\s/.test(t) || t.length > 500) throw new MetricoolError('Cole o token da API completo, sem espaços')
  if (!/^\d{1,15}$/.test(u)) throw new MetricoolError('O userId do Metricool é um número (aparece na URL do app: userId=…)')
  const previous = process.env[TOKEN_ENV]
  process.env[TOKEN_ENV] = t
  try {
    const brands = await listBrands({ userId: u, blogId: '', timezone: defaultTimezone() })
    saveKey(TOKEN_ENV, t)
    const keep = getConfig()
    saveConfig({ userId: u, blogId: brands.length === 1 ? brands[0].blogId : keep?.userId === u ? keep.blogId : '', brandLabel: brands.length === 1 ? brands[0].label : keep?.brandLabel })
    return brands
  } catch (e) {
    if (previous) process.env[TOKEN_ENV] = previous
    else delete process.env[TOKEN_ENV]
    throw e
  }
}

export function disconnect() {
  saveKey(TOKEN_ENV, '')
  fs.rmSync(configFile(), { force: true })
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

export interface ScheduledPost {
  id: number
  text: string
  publicationDate?: { dateTime: string; timezone?: string }
  providers?: Array<{ network: string; status?: string; publicUrl?: string; detailedStatus?: string }>
  media?: string[]
  draft?: boolean
  instagramData?: { type?: string }
}

const iso = (d: Date) => d.toISOString().slice(0, 19)

export async function listScheduled(fromDays = -7, toDays = 30): Promise<ScheduledPost[]> {
  const cfg = getConfig()
  const now = Date.now()
  const r = await mc('/v2/scheduler/posts', { query: { start: iso(new Date(now + fromDays * 86_400_000)), end: iso(new Date(now + toDays * 86_400_000)), timezone: cfg?.timezone } })
  const list = unwrap<ScheduledPost[]>(r)
  return (Array.isArray(list) ? list : []).sort((a, b) => String(a.publicationDate?.dateTime).localeCompare(String(b.publicationDate?.dateTime)))
}

export interface NewPost {
  text: string
  networks: Network[]
  /** Local date-time "YYYY-MM-DDTHH:mm" in the brand timezone. */
  when: string
  instagramType?: InstagramType
  tiktokPrivacy?: string
  tiktokTitle?: string
  /** Public URLs already accepted by Metricool (from uploadMedia/normalizeUrl). */
  media?: string[]
  draft?: boolean
  firstComment?: string
}

export function buildPostBody(p: NewPost, timezone: string) {
  const text = p.text.trim()
  if (!text && !p.media?.length) throw new MetricoolError('Escreva a legenda ou anexe uma mídia')
  if (!p.networks.length) throw new MetricoolError('Escolha pelo menos uma rede (Instagram ou TikTok)')
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(p.when)) throw new MetricoolError('Data/hora inválida')
  const dateTime = p.when.length === 16 ? `${p.when}:00` : p.when.slice(0, 19)
  if (!p.draft && new Date(dateTime).getTime() < Date.now() - 60_000) throw new MetricoolError('A data de publicação precisa estar no futuro')
  if (!p.draft && p.networks.includes('tiktok') && !p.media?.length) throw new MetricoolError('O TikTok exige um vídeo ou fotos anexados')
  if (!p.draft && p.networks.includes('instagram') && !p.media?.length) throw new MetricoolError('O Instagram exige uma imagem ou vídeo anexado')
  const body: Record<string, unknown> = {
    publicationDate: { dateTime, timezone },
    text,
    providers: p.networks.map(network => ({ network })),
    media: p.media || [],
    autoPublish: true,
    draft: !!p.draft,
  }
  if (p.firstComment?.trim()) body.firstCommentText = p.firstComment.trim()
  if (p.networks.includes('instagram')) body.instagramData = { type: p.instagramType || 'POST', autoPublish: true, showReelOnFeed: true }
  if (p.networks.includes('tiktok')) {
    body.tiktokData = {
      privacyOption: p.tiktokPrivacy || 'PUBLIC_TO_EVERYONE',
      disableComment: false, disableDuet: false, disableStitch: false,
      ...(p.tiktokTitle ? { title: p.tiktokTitle.slice(0, 90) } : {}),
    }
  }
  return body
}

export async function createPost(p: NewPost): Promise<ScheduledPost> {
  const cfg = getConfig()
  const r = await mc('/v2/scheduler/posts', { method: 'POST', body: buildPostBody(p, cfg?.timezone || defaultTimezone()) })
  return unwrap<ScheduledPost>(r)
}

export async function deletePost(id: number) {
  if (!Number.isInteger(id) || id <= 0) throw new MetricoolError('Id inválido')
  await mc(`/v2/scheduler/posts/${id}`, { method: 'DELETE' })
}

// ─── Media ───────────────────────────────────────────────────────────────────

const MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.mp4': 'video/mp4', '.mov': 'video/quicktime' }

/** Sends a local file (JARVIS image/video) to Metricool's storage and returns the URL to attach to a post. */
export async function uploadMedia(file: string): Promise<string> {
  const ext = path.extname(file).toLowerCase()
  const contentType = MIME[ext]
  if (!contentType) throw new MetricoolError(`Formato não suportado para postar: ${ext || 'sem extensão'}`)
  const buf = fs.readFileSync(file)
  if (buf.length > 200 * 1048576) throw new MetricoolError('Arquivo maior que 200 MB')
  const hash = createHash('sha256').update(buf).digest('base64')
  const tx = unwrap<{ presignedUrl?: string; fileUrl?: string; uploadType?: string }>(await mc('/v2/media/s3/upload-transactions', {
    method: 'PUT', brand: false,
    body: { resourceType: 'planner', contentType, fileExtension: ext.slice(1), parts: [{ size: buf.length, startByte: 0, endByte: buf.length, hash }] },
  }))
  if (!tx?.presignedUrl || !tx.fileUrl) throw new MetricoolError('O Metricool não devolveu um endereço de upload')
  const send = (withChecksum: boolean) => fetchImpl(tx.presignedUrl!, {
    method: 'PUT',
    headers: { 'content-type': contentType, ...(withChecksum ? { 'x-amz-checksum-sha256': hash } : {}) },
    body: new Uint8Array(buf),
    signal: AbortSignal.timeout(300_000),
  })
  let put = await send(true)
  // Presigned URLs that weren't signed with the checksum header reject it as an unsigned header
  if (put.status === 403 || put.status === 400) {
    const why = await put.text()
    if (/SignatureDoesNotMatch|not signed|unsigned|x-amz-checksum/i.test(why)) put = await send(false)
    else throw new MetricoolError(`Falha ao enviar o arquivo (${put.status}): ${why.slice(0, 200)}`)
  }
  if (!put.ok) throw new MetricoolError(`Falha ao enviar o arquivo (${put.status}): ${(await put.text()).slice(0, 200)}`)
  const done = unwrap<{ fileUrl?: string; convertedFileUrl?: string }>(await mc('/v2/media/s3/upload-transactions', { method: 'PATCH', brand: false, body: { simple: { fileUrl: tx.fileUrl } } }))
  return done?.convertedFileUrl || done?.fileUrl || tx.fileUrl
}

/** A public URL (image or video) checked and copied into Metricool's storage. */
export async function normalizeUrl(url: string): Promise<string> {
  if (!/^https:\/\//i.test(url)) throw new MetricoolError('Use um link https público')
  const r = await mc<unknown>('/actions/normalize/image/url', { query: { url, detailedErrors: 'true' }, brand: false })
  const v = unwrap<unknown>(r)
  const out = typeof v === 'string' ? v : (v as { url?: string })?.url
  if (!out || !/^https?:\/\//.test(out)) throw new MetricoolError('O Metricool não aceitou esse link de mídia')
  return out
}

// ─── Analytics ───────────────────────────────────────────────────────────────

export interface PostMetric {
  id: string
  kind: 'post' | 'reel' | 'tiktok'
  publishedAt: string
  url?: string
  text: string
  image?: string
  likes: number
  comments: number
  shares: number
  saves: number
  views: number
  reach: number
  engagement: number
}

const num = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0)
const pickDate = (v: unknown) => (typeof v === 'string' ? v : (v as { dateTime?: string })?.dateTime || '')

function range(days: number) {
  const to = new Date()
  const from = new Date(Date.now() - days * 86_400_000)
  return { from: iso(from), to: iso(to) }
}

export async function instagramContent(days = 30): Promise<PostMetric[]> {
  const cfg = getConfig()
  const q = { ...range(days), timezone: cfg?.timezone }
  const [posts, reels] = await Promise.all([
    mc('/v2/analytics/posts/instagram', { query: q }).then(r => unwrap<Array<Record<string, unknown>>>(r) || []),
    mc('/v2/analytics/reels/instagram', { query: q }).then(r => unwrap<Array<Record<string, unknown>>>(r) || []),
  ])
  const map = (x: Record<string, unknown>, kind: 'post' | 'reel'): PostMetric => ({
    id: String(x.postId || x.reelId || x.contentId || ''),
    kind,
    publishedAt: pickDate(x.publishedAt),
    url: x.url as string,
    text: String(x.content || ''),
    image: x.imageUrl as string,
    likes: num(x.likes), comments: num(x.comments), shares: num(x.shares), saves: num(x.saved),
    views: num(x.views ?? x.videoViews), reach: num(x.reach), engagement: num(x.engagement),
  })
  return [...(Array.isArray(posts) ? posts : []).map(x => map(x, 'post')), ...(Array.isArray(reels) ? reels : []).map(x => map(x, 'reel'))]
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
}

/** Minimal CSV parser (quoted fields, commas/semicolons). */
export function parseCsv(text: string): Array<Record<string, string>> {
  const lines: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const delim = (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : ','
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === delim) { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some(c => c !== '')) lines.push(row)
      row = []
    } else cell += ch
  }
  if (cell || row.length) { row.push(cell); if (row.some(c => c !== '')) lines.push(row) }
  const [head, ...rows] = lines
  if (!head) return []
  return rows.map(r => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])))
}

export async function tiktokContent(days = 30): Promise<PostMetric[]> {
  const cfg = getConfig()
  const r = await mc<unknown>('/v2/analytics/posts/tiktok', { query: { ...range(days), timezone: cfg?.timezone } })
  const rows: Array<Record<string, unknown>> = typeof r === 'string' ? parseCsv(r) : (unwrap<Array<Record<string, unknown>>>(r) || [])
  const get = (x: Record<string, unknown>, ...keys: string[]) => {
    for (const k of Object.keys(x)) if (keys.some(w => k.toLowerCase().replace(/[^a-z]/g, '') === w)) return x[k]
    return undefined
  }
  return (Array.isArray(rows) ? rows : []).map((x, i) => ({
    id: String(get(x, 'videoid', 'id', 'postid') || i),
    kind: 'tiktok' as const,
    publishedAt: String(get(x, 'publishedat', 'createtime', 'date', 'created') || ''),
    url: get(x, 'url', 'link', 'sharelink') as string | undefined,
    text: String(get(x, 'title', 'description', 'content', 'text') || ''),
    image: get(x, 'imageurl', 'cover', 'coverimageurl', 'thumbnail') as string | undefined,
    likes: num(get(x, 'likes', 'likecount')), comments: num(get(x, 'comments', 'commentcount')), shares: num(get(x, 'shares', 'sharecount')),
    saves: 0, views: num(get(x, 'views', 'viewcount', 'videoviews')), reach: num(get(x, 'reach')), engagement: num(get(x, 'engagement')),
  })).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
}

export interface Series { metric: string; values: Array<{ dateTime: string; value: number }>; total?: number }

export async function timeline(network: Network, metric: string, days = 30, subject?: string): Promise<Series> {
  const cfg = getConfig()
  const r = await mc('/v2/analytics/timelines', { query: { network, metric, subject, ...range(days), timezone: cfg?.timezone } })
  const list = unwrap<Array<{ metric: string; values?: Array<{ dateTime: string; value: number }>; aggregate?: { value: number } }>>(r)
  const first = Array.isArray(list) ? list[0] : undefined
  return { metric, values: (first?.values || []).map(v => ({ dateTime: v.dateTime, value: num(v.value) })), total: first?.aggregate?.value }
}

/** Dashboard numbers for the Social tab; each part fails independently (a missing network doesn't break the rest). */
export async function overview(days = 30) {
  const settle = async <T>(p: Promise<T>) => { try { return { ok: true as const, value: await p } } catch (e) { return { ok: false as const, error: (e as Error).message } } }
  const [igFollowers, igContent, ttFollowers, ttViews, ttContent] = await Promise.all([
    settle(timeline('instagram', 'delta_followers', days, 'account')),
    settle(instagramContent(days)),
    settle(timeline('tiktok', 'followers_count', days)),
    settle(timeline('tiktok', 'video_views', days)),
    settle(tiktokContent(days)),
  ])
  return { days, igFollowers, igContent, ttFollowers, ttViews, ttContent }
}
