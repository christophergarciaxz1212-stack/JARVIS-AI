import fs from 'fs'
import path from 'path'
import { createHash } from 'crypto'
import { dataDir } from '../agents/fsutil'

const API = 'https://generativelanguage.googleapis.com/v1beta'
export const TTS_RATE = 24000

export interface VoiceInfo { id: string; style: string; gender: 'feminina' | 'masculina' }

/** The 30 prebuilt Gemini TTS voices (names are the API ids; style = Google's own description). */
export const GEMINI_VOICES: VoiceInfo[] = [
  { id: 'Zephyr', style: 'Brilhante', gender: 'feminina' },
  { id: 'Puck', style: 'Animada', gender: 'masculina' },
  { id: 'Charon', style: 'Informativa', gender: 'masculina' },
  { id: 'Kore', style: 'Firme', gender: 'feminina' },
  { id: 'Fenrir', style: 'Empolgada', gender: 'masculina' },
  { id: 'Leda', style: 'Jovem', gender: 'feminina' },
  { id: 'Orus', style: 'Firme', gender: 'masculina' },
  { id: 'Aoede', style: 'Leve', gender: 'feminina' },
  { id: 'Callirrhoe', style: 'Descontraída', gender: 'feminina' },
  { id: 'Autonoe', style: 'Brilhante', gender: 'feminina' },
  { id: 'Enceladus', style: 'Sussurrada', gender: 'masculina' },
  { id: 'Iapetus', style: 'Clara', gender: 'masculina' },
  { id: 'Umbriel', style: 'Descontraída', gender: 'masculina' },
  { id: 'Algieba', style: 'Suave', gender: 'masculina' },
  { id: 'Despina', style: 'Suave', gender: 'feminina' },
  { id: 'Erinome', style: 'Clara', gender: 'feminina' },
  { id: 'Algenib', style: 'Rouca', gender: 'masculina' },
  { id: 'Rasalgethi', style: 'Informativa', gender: 'masculina' },
  { id: 'Laomedeia', style: 'Animada', gender: 'feminina' },
  { id: 'Achernar', style: 'Macia', gender: 'feminina' },
  { id: 'Alnilam', style: 'Firme', gender: 'masculina' },
  { id: 'Schedar', style: 'Equilibrada', gender: 'masculina' },
  { id: 'Gacrux', style: 'Madura', gender: 'feminina' },
  { id: 'Pulcherrima', style: 'Direta', gender: 'feminina' },
  { id: 'Achird', style: 'Amigável', gender: 'masculina' },
  { id: 'Zubenelgenubi', style: 'Casual', gender: 'masculina' },
  { id: 'Vindemiatrix', style: 'Gentil', gender: 'feminina' },
  { id: 'Sadachbia', style: 'Vivaz', gender: 'masculina' },
  { id: 'Sadaltager', style: 'Especialista', gender: 'masculina' },
  { id: 'Sulafat', style: 'Calorosa', gender: 'feminina' },
]

export const DEFAULT_TTS_MODEL = 'gemini-3.8-flash-tts'
export const DEFAULT_VOICE = 'Kore'

export interface TtsModel { id: string; label: string; supportsStyle: boolean }

/** Gemini 3.x TTS reads the text verbatim: delivery style goes in speech_metadata (Interactions API). */
const usesInteractions = (model: string) => /^gemini-[3-9]/.test(model)

function label(id: string) {
  const v = id.match(/gemini-([\d.]+)/)?.[1] || ''
  const tier = /pro/.test(id) ? 'Pro' : /lite/.test(id) ? 'Flash-Lite' : 'Flash'
  return `Gemini ${v} ${tier}${/preview/.test(id) ? ' (prévia)' : ''}`
}

let modelCache: { at: number; models: TtsModel[] } | null = null

/** TTS models this key can use, read live from the API (newest first). */
export async function listTtsModels(fresh = false): Promise<TtsModel[]> {
  const key = process.env.GEMINI_API_KEY
  if (!key) return []
  if (!fresh && modelCache && Date.now() - modelCache.at < 10 * 60_000) return modelCache.models
  const res = await fetch(`${API}/models?pageSize=1000`, { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`Gemini respondeu ${res.status} ao listar modelos`)
  const data = (await res.json()) as { models?: Array<{ name: string; supportedGenerationMethods?: string[] }> }
  const models = (data.models || [])
    .map(m => m.name.replace(/^models\//, ''))
    .filter(id => /tts/.test(id))
    .sort((a, b) => {
      const va = Number(a.match(/gemini-([\d.]+)/)?.[1] || 0), vb = Number(b.match(/gemini-([\d.]+)/)?.[1] || 0)
      return vb - va || Number(/preview/.test(a)) - Number(/preview/.test(b)) || Number(/lite/.test(a)) - Number(/lite/.test(b))
    })
    .map(id => ({ id, label: label(id), supportsStyle: true }))
  modelCache = { at: Date.now(), models }
  return models
}

// ─── Audio helpers ───────────────────────────────────────────────────────────

export function pcmToWav(pcm: Buffer, rate = TTS_RATE): Buffer {
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8)
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22)
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34)
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([h, pcm])
}

/** Raw 16-bit PCM and its rate out of a WAV (walks the chunks instead of assuming a 44-byte header). */
export function wavToPcm(wav: Buffer): { pcm: Buffer; rate: number } {
  if (wav.toString('ascii', 0, 4) !== 'RIFF') throw new Error('Áudio não é WAV')
  let off = 12
  let rate = TTS_RATE
  while (off + 8 <= wav.length) {
    const id = wav.toString('ascii', off, off + 4)
    const size = wav.readUInt32LE(off + 4)
    if (id === 'fmt ') rate = wav.readUInt32LE(off + 12)
    if (id === 'data') return { pcm: wav.subarray(off + 8, Math.min(wav.length, off + 8 + size)), rate }
    off += 8 + size + (size % 2)
  }
  throw new Error('WAV sem dados de áudio')
}

/** Accepts what Gemini returns (audio/wav or audio/L16;rate=…) and yields raw PCM 16-bit mono. */
export function toPcm(data: Buffer, mime: string): { pcm: Buffer; rate: number } {
  if (/wav/i.test(mime) || data.toString('ascii', 0, 4) === 'RIFF') return wavToPcm(data)
  return { pcm: data, rate: Number(mime.match(/rate=(\d+)/)?.[1]) || TTS_RATE }
}

/** Text for speech: no code blocks, markdown, links or JARVIS markers. */
export function speakableText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' (trecho de código omitido) ')
    .replace(/\[\[[^\]]+\]\]/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/^\s{0,3}(#{1,6}|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_~>|]+/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

/** Splits long text at sentence boundaries so each request stays small and fast. */
export function chunkText(text: string, max = 900): string[] {
  const sentences = text.match(/[^.!?…\n]+[.!?…]*\s*|\n/g) || [text]
  const out: string[] = []
  let cur = ''
  for (const s of sentences) {
    if ((cur + s).length > max && cur.trim()) { out.push(cur.trim()); cur = '' }
    if (s.length > max) { for (let i = 0; i < s.length; i += max) out.push(s.slice(i, i + max).trim()); continue }
    cur += s
  }
  if (cur.trim()) out.push(cur.trim())
  return out.filter(Boolean)
}

// ─── Synthesis ───────────────────────────────────────────────────────────────

export interface SpeakOptions { model?: string; voice?: string; style?: string; signal?: AbortSignal }

let fetchImpl: typeof fetch = (...a) => fetch(...a)
export function setTtsFetch(f: typeof fetch) { fetchImpl = f }

function apiError(status: number, body: string) {
  let msg = body
  try { msg = (JSON.parse(body) as { error?: { message?: string } }).error?.message || body } catch {}
  if (status === 429) return new Error('Cota de voz do Gemini esgotada por agora (limite do plano grátis). Tente em alguns minutos ou use a voz do Windows.')
  if (status === 401 || status === 403) return new Error('Chave do Gemini recusada para voz: confira em Chaves de API.')
  return new Error(`Gemini TTS respondeu ${status}: ${msg.slice(0, 200)}`)
}

async function synthChunk(text: string, model: string, voice: string, style: string | undefined, signal?: AbortSignal): Promise<{ pcm: Buffer; rate: number }> {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('Configure a chave do Gemini (Chaves de API) para usar as vozes do Gemini')
  const headers = { 'x-goog-api-key': key, 'content-type': 'application/json' }
  const timeout = AbortSignal.timeout(90_000)
  const sig = signal ? AbortSignal.any([signal, timeout]) : timeout
  if (usesInteractions(model)) {
    const content: Record<string, unknown> = { type: 'text', text }
    if (style) content.annotations = [{ type: 'speech_metadata', style }]
    const res = await fetchImpl(`${API}/interactions`, {
      method: 'POST', headers, signal: sig,
      body: JSON.stringify({ model, input: [{ type: 'user_input', content: [content] }], response_format: { type: 'audio' }, generation_config: { speech_config: [{ voice }] } }),
    })
    const body = await res.text()
    if (!res.ok) throw apiError(res.status, body)
    const json = JSON.parse(body) as { steps?: Array<{ content?: Array<{ data?: string; mime_type?: string }> }> }
    const part = json.steps?.flatMap(s => s.content || []).find(c => c.data)
    if (!part?.data) throw new Error('Gemini não devolveu áudio')
    return toPcm(Buffer.from(part.data, 'base64'), part.mime_type || 'audio/wav')
  }
  // Gemini 2.5 TTS: a natural-language prefix sets the delivery and is not spoken
  const res = await fetchImpl(`${API}/models/${model}:generateContent`, {
    method: 'POST', headers, signal: sig,
    body: JSON.stringify({
      contents: [{ parts: [{ text: style ? `${style}: ${text}` : text }] }],
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
    }),
  })
  const body = await res.text()
  if (!res.ok) throw apiError(res.status, body)
  const json = JSON.parse(body) as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data: string; mimeType: string } }> } }> }
  const inline = json.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData
  if (!inline) throw new Error('Gemini não devolveu áudio')
  return toPcm(Buffer.from(inline.data, 'base64'), inline.mimeType)
}

const cacheDir = () => path.join(dataDir(), 'voice-cache')

function pruneCache(max = 300) {
  try {
    const files = fs.readdirSync(cacheDir()).map(f => ({ f, t: fs.statSync(path.join(cacheDir(), f)).mtimeMs })).sort((a, b) => b.t - a.t)
    for (const x of files.slice(max)) fs.rmSync(path.join(cacheDir(), x.f), { force: true })
  } catch {}
}

/** Text → WAV (24 kHz mono 16-bit) with a Gemini voice. Same text+voice+style is served from cache. */
export async function speak(text: string, opts: SpeakOptions = {}): Promise<{ wav: Buffer; seconds: number; cached: boolean }> {
  const clean = text.trim()
  if (!clean) throw new Error('Nada para falar')
  const model = opts.model || DEFAULT_TTS_MODEL
  const voice = GEMINI_VOICES.some(v => v.id === opts.voice) ? opts.voice! : DEFAULT_VOICE
  const style = opts.style?.trim().slice(0, 200) || undefined
  const hash = createHash('sha256').update(JSON.stringify([model, voice, style, clean])).digest('hex').slice(0, 32)
  const file = path.join(cacheDir(), `${hash}.wav`)
  if (fs.existsSync(file)) {
    const wav = fs.readFileSync(file)
    try { fs.utimesSync(file, new Date(), new Date()) } catch {}
    return { wav, seconds: (wav.length - 44) / (TTS_RATE * 2), cached: true }
  }
  const parts: Buffer[] = []
  let rate = TTS_RATE
  for (const chunk of chunkText(clean)) {
    const r = await synthChunk(chunk, model, voice, style, opts.signal)
    rate = r.rate
    parts.push(r.pcm)
  }
  const wav = pcmToWav(Buffer.concat(parts), rate)
  fs.mkdirSync(cacheDir(), { recursive: true })
  fs.writeFileSync(file, wav)
  pruneCache()
  return { wav, seconds: (wav.length - 44) / (rate * 2), cached: false }
}
