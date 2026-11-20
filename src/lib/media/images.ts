import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { dataDir, readJson, writeJsonAtomic } from '../agents/fsutil'
import { defaultModelFrom, getLiveCatalog } from '../ai/catalog'
import { defaultComplete } from '../agents/models'
import { getPrefs } from '../prefs'

export const imagesDir = () => path.join(dataDir(), 'images')
export const indexFile = () => path.join(imagesDir(), 'index.json')

export type Aspect = '1:1' | '9:16' | '16:9' | '4:5' | '3:2' | '2:3'
export type ImageProviderId = 'nvidia' | 'gemini' | 'pollinations'

export interface GeneratedImage {
  id: string
  prompt: string
  englishPrompt: string
  width: number
  height: number
  file: string
  createdAt: number
  provider: string
  aspect?: Aspect
  /** Providers tried before this one, with the reason they were skipped. */
  fallbacks?: string[]
}

export interface ImageOptions {
  aspect?: Aspect
  width?: number
  height?: number
  seed?: number
  style?: string
  provider?: 'auto' | ImageProviderId
  /** O prompt já está no formato final (storyboard EN): não reescrever via IA (economiza tokens e preserva a cena). */
  skipEnhance?: boolean
}

const POLL_SIZE: Record<Aspect, [number, number]> = {
  '1:1': [1024, 1024], '9:16': [768, 1344], '16:9': [1344, 768], '4:5': [896, 1120], '3:2': [1216, 832], '2:3': [832, 1216],
}

// O tier anônimo do Pollinations aceita ~1 imagem por IP a cada 45 s. Em vez de
// descobrir isso por tentativa e erro (e queimar as duas tentativas de cada cena),
// todas as chamadas passam por um portão serializador: a próxima só dispara quando
// a janela de 45 s terminar — chat e Estúdio de Vídeo dividem a mesma cota.
// Testes batem na rede direto: o portão serializa em produção, não sob vitest.
const POLL_INTERVAL_MS = Number(process.env.POLLINATIONS_INTERVAL_MS ?? (process.env.VITEST || process.env.NODE_ENV === 'test' ? 0 : 45_500))
let pollChain: Promise<void> = Promise.resolve()
let lastPollAt = 0

async function waitPollinationsSlot(): Promise<void> {
  let release: () => void = () => {}
  const mine = new Promise<void>(resolve => { release = resolve })
  const previous = pollChain
  pollChain = mine
  await previous
  const wait = POLL_INTERVAL_MS - (Date.now() - lastPollAt)
  if (wait > 0) await new Promise(r => setTimeout(r, wait))
  lastPollAt = Date.now()
  release()
}

/** Closest supported aspect for explicit pixel sizes (kept for older callers). */
export function aspectFor(width?: number, height?: number): Aspect {
  if (!width || !height) return '1:1'
  const r = width / height
  const all = Object.entries(POLL_SIZE) as Array<[Aspect, [number, number]]>
  return all.reduce((best, [a, [w, h]]) => (Math.abs(w / h - r) < Math.abs(POLL_SIZE[best][0] / POLL_SIZE[best][1] - r) ? a : best), '1:1' as Aspect)
}

/** Format and number of variations asked in plain Portuguese. */
export function parseImageRequest(text: string): { aspect: Aspect; count: number } {
  const t = text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  let aspect: Aspect = '1:1'
  if (/\b(vertical|stories?|reels?|tiktok|celular|9:16|retrato de tela)\b/.test(t)) aspect = '9:16'
  else if (/\b(horizontal|paisagem|banner|capa do youtube|thumbnail|thumb|wide|16:9|wallpaper de pc|papel de parede do pc|desktop)\b/.test(t)) aspect = '16:9'
  else if (/\b(feed|post do instagram|instagram|4:5)\b/.test(t)) aspect = '4:5'
  else if (/\b(3:2|foto horizontal)\b/.test(t)) aspect = '3:2'
  else if (/\b(2:3|poster|cartaz)\b/.test(t)) aspect = '2:3'
  const n = t.match(/\b([2-4]|duas|tres|quatro)\s+(imagens|variacoes|opcoes|versoes|fotos|artes)\b/)
  const words: Record<string, number> = { duas: 2, tres: 3, quatro: 4 }
  const count = n ? (words[n[1]] || Number(n[1])) : /\b(variacoes|opcoes|versoes)\b/.test(t) ? 3 : 1
  return { aspect, count: Math.max(1, Math.min(4, count)) }
}

const STYLE_HINTS: Array<[RegExp, string]> = [
  [/realist|foto ?real|fotografi/i, 'photorealistic photograph, natural light, 50mm lens, sharp focus, true-to-life textures'],
  [/anime|mang[aá]/i, 'anime illustration, clean line art, vibrant cel shading'],
  [/\b3d\b|pixar|render/i, '3D render, soft global illumination, subsurface scattering, high detail'],
  [/aquarel/i, 'watercolor painting, soft washes, paper texture'],
  [/pixel/i, 'pixel art, limited palette, crisp pixels'],
  [/logo|logotipo|[ií]cone/i, 'minimal flat vector logo, simple geometric shapes, centered on a plain background, no mockup'],
  [/cartoon|desenho animado/i, 'cartoon illustration, bold outlines, playful colors'],
  [/cinema|cinematogr/i, 'cinematic still, dramatic lighting, shallow depth of field, film grain'],
]

/** Rewrites the request as a rich English prompt (subject, style, light, composition), keeping quoted text verbatim. */
async function enhancePrompt(prompt: string, aspect: Aspect, style: string): Promise<string> {
  const hint = STYLE_HINTS.find(([re]) => re.test(`${prompt} ${style}`))?.[1]
  try {
    const catalog = await getLiveCatalog()
    const model = defaultModelFrom(catalog)
    if (!model) throw new Error('sem modelo')
    const ac = new AbortController()
    const t = setTimeout(() => ac.abort(), 10_000)
    const c = await defaultComplete(model, [
      {
        role: 'system',
        content: [
          'You write prompts for image generation models. Rewrite the user request as ONE English prompt of 50-110 words.',
          'Include: main subject and action, setting, art style, lighting, color palette, camera/composition, quality cues.',
          `Composition must suit a ${aspect} frame.`,
          'If the user wants words written in the image, keep those words exactly, in their original language, inside double quotes.',
          'Do not add text/watermarks unless asked. Reply with the prompt only.',
          hint ? `Style to apply: ${hint}.` : '',
          style ? `User's default style: ${style}.` : '',
        ].filter(Boolean).join(' '),
      },
      { role: 'user', content: prompt },
    ], ac.signal).finally(() => clearTimeout(t))
    const text = c.text.replace(/^["'\s]+|["'\s]+$/g, '').replace(/\n+/g, ' ').trim()
    if (text.length > 15) return text.slice(0, 900)
  } catch {}
  return [prompt, hint, style].filter(Boolean).join(', ')
}

let fetchImpl: typeof fetch = (...a) => fetch(...a)
export function setImageFetch(f: typeof fetch) { fetchImpl = f }

class ProviderSkip extends Error {}

// A provider that said "no quota/billing" is skipped for a while instead of failing every request
const cooldown = new Map<ImageProviderId, { until: number; reason: string }>()
export function providerStatus() {
  return {
    nvidia: { configured: !!process.env.NVIDIA_API_KEY, blocked: cooldown.get('nvidia')?.until && cooldown.get('nvidia')!.until > Date.now() ? cooldown.get('nvidia')!.reason : undefined },
    gemini: { configured: !!process.env.GEMINI_API_KEY, blocked: cooldown.get('gemini')?.until && cooldown.get('gemini')!.until > Date.now() ? cooldown.get('gemini')!.reason : undefined },
    pollinations: { configured: true, blocked: undefined as string | undefined },
  }
}

// Gemini 2.5/3/3.1 image family — find as they become available (Google rolls out free quotas unpredictably)
const GEMINI_IMAGE_MODELS = [
  'gemini-3.1-flash-image',      // Nano Banana 2 (melhor custo/benefício hoje)
  'gemini-3.1-flash-lite-image', // mais rápido e barato ainda
  'gemini-3-pro-image-preview',  // Nano Banana Pro (melhor qualidade)
  'gemini-3-pro-image',          // versão estável do Pro image
  'gemini-3.1-flash-image-preview', // preview oficial da 3.1
  'gemini-2.5-flash-image',      // Nano Banana original (que a documentação chama de Banana)
]

type ImagePart = { text: string } | { inlineData: { mimeType: string; data: string } }

/** Núcleo comum: manda parts (texto e/ou imagem inline) ao Gemini e devolve a primeira imagem gerada. */
async function viaGeminiParts(parts: ImagePart[], aspect: Aspect): Promise<{ buf: Buffer; type: string; label: string }> {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new ProviderSkip('sem chave do Gemini')
  let last = ''
  for (const model of GEMINI_IMAGE_MODELS) {
    const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: aspect } } }),
      signal: AbortSignal.timeout(120_000),
    })
    const body = await res.text()
    if (res.status === 404) { last = `${model} indisponível`; continue }
    if (res.status === 429 || res.status === 403) {
      const reason = /quota|billing|plan/i.test(body) ? 'sua chave grátis do Gemini não tem cota para gerar imagens (ative o faturamento no Google AI Studio para usar)' : `Gemini recusou (${res.status})`
      cooldown.set('gemini', { until: Date.now() + 6 * 3_600_000, reason })
      throw new ProviderSkip(reason)
    }
    if (!res.ok) { last = `${model}: HTTP ${res.status}`; continue }
    const json = JSON.parse(body) as { candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ inlineData?: { data: string; mimeType: string } }> } }> }
    const inline = json.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData
    if (!inline) { last = `${model} não devolveu imagem (${json.candidates?.[0]?.finishReason || 'bloqueio de segurança?'})`; continue }
    return { buf: Buffer.from(inline.data, 'base64'), type: inline.mimeType, label: `Google Gemini (${model})` }
  }
  throw new ProviderSkip(last || 'Gemini não gerou a imagem')
}

async function viaGemini(prompt: string, aspect: Aspect): Promise<{ buf: Buffer; type: string; label: string }> {
  return viaGeminiParts([{ text: prompt }], aspect)
}

/**
 * FLUX na NVIDIA NIM (build.nvidia.com) com a chave nvapi- que o usuário já usa no chat: imagens
 * nítidas, sem marca d'água. FLUX.1-dev = qualidade (~35 s); FLUX.1-schnell = rápido (~4 s), usado
 * quando o dev falha ou demora. A API não aceita "seed" (422 extra_forbidden).
 * Tamanhos múltiplos de 64 (o 4:5 do Pollinations, 896×1120, não é).
 */
const NV_SIZE: Record<Aspect, [number, number]> = {
  '1:1': [1024, 1024], '9:16': [768, 1344], '16:9': [1344, 768], '4:5': [896, 1152], '3:2': [1216, 832], '2:3': [832, 1216],
}
async function viaNvidia(prompt: string, aspect: Aspect): Promise<{ buf: Buffer; type: string; label: string; width: number; height: number }> {
  const key = process.env.NVIDIA_API_KEY
  if (!key) throw new ProviderSkip('sem chave da NVIDIA')
  const [width, height] = NV_SIZE[aspect]
  const models: Array<[string, Record<string, unknown>, number]> = [
    ['flux.1-dev', { prompt, width, height, steps: 28, cfg_scale: 3.5, mode: 'base' }, 90_000],
    ['flux.1-schnell', { prompt, width, height, steps: 4 }, 45_000],
  ]
  let last = ''
  for (const [model, body, timeout] of models) {
    try {
      const res = await fetchImpl(`https://ai.api.nvidia.com/v1/genai/black-forest-labs/${model}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeout),
      })
      const text = await res.text()
      if (res.status === 401 || res.status === 403) {
        cooldown.set('nvidia', { until: Date.now() + 3_600_000, reason: `a NVIDIA recusou a chave (${res.status})` })
        throw new ProviderSkip(`a NVIDIA recusou a chave (${res.status})`)
      }
      if (res.status === 402) {
        cooldown.set('nvidia', { until: Date.now() + 6 * 3_600_000, reason: 'créditos grátis da NVIDIA esgotados' })
        throw new ProviderSkip('créditos grátis da NVIDIA esgotados')
      }
      if (!res.ok) { last = `${model}: HTTP ${res.status} ${text.slice(0, 120)}`; continue }
      const j = JSON.parse(text) as { artifacts?: Array<{ base64?: string; finishReason?: string }> }
      const art = j.artifacts?.[0]
      if (!art?.base64) { last = `${model}: sem imagem`; continue }
      if (art.finishReason && art.finishReason !== 'SUCCESS') { last = `${model}: ${art.finishReason} (filtro de conteúdo?)`; continue }
      const buf = Buffer.from(art.base64, 'base64')
      return { buf, type: 'image/jpeg', label: `NVIDIA FLUX (${model})`, width, height }
    } catch (e) {
      if (e instanceof ProviderSkip) throw e
      last = `${model}: ${(e as Error).message}`
    }
  }
  throw new Error(last || 'NVIDIA não gerou a imagem')
}

async function viaPollinations(prompt: string, aspect: Aspect, seed: number, size?: [number, number]): Promise<{ buf: Buffer; type: string; label: string; width: number; height: number }> {
  const [width, height] = size || POLL_SIZE[aspect]
  // "sana" is the model the anonymous tier serves today (asking for "flux" silently returns sana anyway)
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&seed=${seed}&nologo=true&model=sana`
  let last = ''
  let waited = false
  for (let attempt = 0; attempt < 2; attempt++) {
    await waitPollinationsSlot()
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(90_000), headers: { 'User-Agent': 'jarvis-desktop' } })
      const type = res.headers.get('content-type') || ''
      if (!res.ok || !/^image\//.test(type)) {
        // Free tier: 1 image every 45s per IP — read the "retry after" hint instead of burning both attempts
        const body = await res.text().catch(() => '')
        const retry = /retry after (\d+)s/i.exec(body)
        last = retry ? `limite grátis (tente de novo em ${retry[1]}s)` : `serviço respondeu ${res.status}`
        if ((res.status === 402 || res.status === 429) && !waited) {
          const waitS = Math.min(58, Math.max(6, Number(retry?.[1] || 32) + 2))
          waited = true
          await new Promise(r => setTimeout(r, waitS * 1000))
          continue
        }
        continue
      }
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length < 1000) { last = 'imagem vazia'; continue }
      return { buf, type, label: 'Pollinations (grátis, com marca d’água)', width, height }
    } catch (e) {
      last = (e as Error).message
    }
  }
  throw new Error(last)
}

/** Real pixel size from the file header (providers may return a different size than requested). */
export function imageSize(buf: Buffer): [number, number] | null {
  try {
    if (buf.length > 24 && buf.toString('ascii', 1, 4) === 'PNG') return [buf.readUInt32BE(16), buf.readUInt32BE(20)]
    if (buf.length > 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
      const kind = buf.toString('ascii', 12, 16)
      if (kind === 'VP8X') return [1 + buf.readUIntLE(24, 3), 1 + buf.readUIntLE(27, 3)]
      if (kind === 'VP8 ') return [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff]
      if (kind === 'VP8L') { const b = buf.readUInt32LE(21); return [(b & 0x3fff) + 1, ((b >> 14) & 0x3fff) + 1] }
    }
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      let off = 2
      while (off + 9 < buf.length) {
        if (buf[off] !== 0xff) { off++; continue }
        const marker = buf[off + 1]
        const len = buf.readUInt16BE(off + 2)
        // SOF0..SOF15 except DHT(C4), JPG(C8), DAC(CC) carry height then width
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return [buf.readUInt16BE(off + 7), buf.readUInt16BE(off + 5)]
        off += 2 + len
      }
    }
  } catch {}
  return null
}

function chain(choice: 'auto' | ImageProviderId): ImageProviderId[] {
  if (choice === 'pollinations') return ['pollinations']
  if (choice === 'gemini') return ['gemini', 'nvidia', 'pollinations']
  if (choice === 'nvidia') return ['nvidia', 'gemini', 'pollinations']
  // Automático: FLUX na NVIDIA (grátis com a chave do chat, sem marca d'água), depois Gemini
  // (quando a chave tem cota de imagem) e, por último, o Pollinations anônimo (fraco, com marca d'água)
  return process.env.NVIDIA_API_KEY ? ['nvidia', 'gemini', 'pollinations'] : ['gemini', 'pollinations']
}

/** Generates one image with the best available provider, saving it in the JARVIS gallery. */
export async function generateImage(prompt: string, opts: ImageOptions = {}): Promise<GeneratedImage> {
  const clean = prompt.trim().slice(0, 1000)
  if (!clean) throw new Error('Descreva a imagem')
  const prefs = getPrefs().images
  const explicitSize = opts.width && opts.height
  const aspect = opts.aspect || aspectFor(opts.width, opts.height)
  const english = opts.skipEnhance && clean.length > 30 ? clean : await enhancePrompt(clean, aspect, opts.style ?? prefs.style)
  const seed = opts.seed ?? Math.floor(Math.random() * 1e9)
  const fallbacks: string[] = []
  let errors = ''
  for (const p of chain(opts.provider || prefs.provider)) {
    const blocked = cooldown.get(p)
    if (blocked && blocked.until > Date.now()) { fallbacks.push(`${p}: ${blocked.reason}`); continue }
    try {
      let r: { buf: Buffer; type: string; label: string; width?: number; height?: number }
      if (p === 'nvidia') r = await viaNvidia(english, aspect)
      else if (p === 'gemini') r = await viaGemini(english, aspect)
      else r = await viaPollinations(english, aspect, seed, explicitSize ? [Math.max(256, Math.min(1536, opts.width!)), Math.max(256, Math.min(1536, opts.height!))] : undefined)
      const [width, height] = imageSize(r.buf) || (r.width && r.height ? [r.width, r.height] : POLL_SIZE[aspect])
      const id = uuidv4()
      const ext = /png/.test(r.type) ? 'png' : /webp/.test(r.type) ? 'webp' : 'jpg'
      fs.mkdirSync(imagesDir(), { recursive: true })
      const file = `${id}.${ext}`
      fs.writeFileSync(path.join(imagesDir(), file), r.buf)
      const img: GeneratedImage = { id, prompt: clean, englishPrompt: english, width, height, file, createdAt: Date.now(), provider: r.label, aspect, fallbacks: fallbacks.length ? fallbacks : undefined }
      writeJsonAtomic(indexFile(), [img, ...listImages()].slice(0, 500))
      return img
    } catch (e) {
      const msg = (e as Error).message
      fallbacks.push(`${p}: ${msg}`)
      errors = msg
    }
  }
  throw new Error(`Não consegui gerar a imagem agora (${errors || fallbacks.join('; ')}). Tente de novo em instantes.`)
}

/**
 * Edição de imagem por instrução em linguagem natural (remove fundo, troca estilo, etc.).
 * Usa os mesmos modelos de imagem do Gemini com a imagem de origem como inlineData.
 * Preserva tudo o que não foi mencionado na instrução.
 */
export async function editImage(source: { data: Buffer; mimeType: string }, instruction: string): Promise<GeneratedImage> {
  const clean = instruction.trim().slice(0, 600)
  if (!clean) throw new Error('Descreva o que alterar na imagem')
  if (!/^image\/(jpeg|png|webp)$/i.test(source.mimeType)) throw new Error('Anexe a imagem como JPEG, PNG ou WebP')
  const parts: ImagePart[] = [
    { text: `Edit this image exactly as instructed, preserving everything not mentioned in the instruction. Instruction: ${clean}` },
    { inlineData: { mimeType: source.mimeType, data: source.data.toString('base64') } },
  ]
  const blocked = cooldown.get('gemini')
  if (blocked && blocked.until > Date.now()) {
    throw new Error(`A edição está indisponível agora: ${blocked.reason}. Tente novamente mais tarde ou ative o faturamento no Google AI Studio.`)
  }
  // Preserva o enquadramento original: o aspecto pedido é o mais próximo das dimensões da fonte
  const dims = imageSize(source.data)
  const aspect = dims ? aspectFor(dims[0], dims[1]) : '1:1'
  const r = await viaGeminiParts(parts, aspect)
  const [width, height] = imageSize(r.buf) || [1024, 1024]
  const id = uuidv4()
  const ext = /png/.test(r.type) ? 'png' : /webp/.test(r.type) ? 'webp' : 'jpg'
  fs.mkdirSync(imagesDir(), { recursive: true })
  const file = `${id}.${ext}`
  fs.writeFileSync(path.join(imagesDir(), file), r.buf)
  const img: GeneratedImage = { id, prompt: `Edição: ${clean}`, englishPrompt: clean, width, height, file, createdAt: Date.now(), provider: `${r.label} — edição`, aspect }
  writeJsonAtomic(indexFile(), [img, ...listImages()].slice(0, 500))
  return img
}

/** Registra uma imagem enviada pelo usuário na galeria (para virar cena/referência de vídeo ou edição). */
export function saveGalleryImage(input: { data: Buffer; mimeType: string; name?: string; prompt?: string }): GeneratedImage {
  const dims = imageSize(input.data)
  const id = uuidv4()
  const ext = input.mimeType === 'image/png' ? 'png' : input.mimeType === 'image/webp' ? 'webp' : 'jpg'
  fs.mkdirSync(imagesDir(), { recursive: true })
  const file = `${id}.${ext}`
  fs.writeFileSync(path.join(imagesDir(), file), input.data)
  const img: GeneratedImage = {
    id,
    prompt: input.prompt || `Imagem enviada pelo usuário${input.name ? ` (${input.name})` : ''}`,
    englishPrompt: input.prompt || 'user attachment',
    width: dims?.[0] || 1280,
    height: dims?.[1] || 1280,
    file,
    createdAt: Date.now(),
    provider: 'upload do usuário',
    aspect: dims ? aspectFor(dims[0], dims[1]) : '1:1',
  }
  writeJsonAtomic(indexFile(), [img, ...listImages()].slice(0, 500))
  return img
}

/** Several variations of the same idea (different seeds/compositions), generated in parallel. */
export async function generateImages(prompt: string, count: number, opts: ImageOptions = {}): Promise<GeneratedImage[]> {
  const n = Math.max(1, Math.min(4, count))
  const results = await Promise.allSettled(Array.from({ length: n }, (_, i) => generateImage(n > 1 ? `${prompt} (variação ${i + 1}: composição diferente)` : prompt, { ...opts, seed: opts.seed !== undefined ? opts.seed + i : undefined })))
  const ok = results.flatMap(r => (r.status === 'fulfilled' ? [r.value] : []))
  if (!ok.length) throw (results[0] as PromiseRejectedResult).reason
  return ok
}

export function listImages(): GeneratedImage[] {
  return readJson<GeneratedImage[]>(indexFile(), [])
}

export function imageFile(id: string): { file: string; type: string } | null {
  const img = listImages().find(i => i.id === id)
  if (!img) return null
  const file = path.join(imagesDir(), img.file)
  if (!fs.existsSync(file)) return null
  return { file, type: img.file.endsWith('.png') ? 'image/png' : img.file.endsWith('.webp') ? 'image/webp' : 'image/jpeg' }
}
