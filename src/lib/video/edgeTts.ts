/**
 * Cliente do TTS gratuito do Microsoft Edge (o mesmo dos navegadores Edge/Chrome).
 * Vozes neurais em português brasileiro (Francisca, Antonio…) sem chave e sem custo.
 *
 * Protocolo reimplementado a partir da implementação de referência (edge-tts):
 * WebSocket autenticado com o token Sec-MS-GEC v2 (ver ./edgeGec.ts). Se o serviço
 * mudar de novo, o erro é de conexão/403 — nada aqui trava o JARVIS: quem chama
 * cai na cadeia (Gemini → Windows).
 */
import crypto from 'crypto'
import WebSocket from 'ws'
import { generateSecMsGecV2 } from './edgeGec'
import type { WordTime } from '../motion/audio'

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4'
// Cliente Edge TTS mais resiliente: tenta novo token se o antigo expirar/403
let lastTokenTime = 0
const TOKEN_RENEW_COOLDOWN = 30 * 60_000 // 30 min
const BASE_URL = 'speech.platform.bing.com/consumer/speech/synthesize/readaloud'
const WSS_URL = `wss://${BASE_URL}/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}`
const VOICE_LIST_URL = `https://${BASE_URL}/voices/list?trustedclienttoken=${TRUSTED_CLIENT_TOKEN}`
const CHROMIUM_FULL_VERSION = '143.0.3650.75'
const CHROMIUM_MAJOR_VERSION = CHROMIUM_FULL_VERSION.split('.')[0]
const SEC_MS_GEC_VERSION = `2-${CHROMIUM_FULL_VERSION}`

const BASE_HEADERS: Record<string, string> = {
  'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR_VERSION}.0.0.0`,
  'Accept-Encoding': 'gzip, deflate, br, zstd',
  'Accept-Language': 'en-US,en;q=0.9',
}

const WSS_HEADERS: Record<string, string> = {
  Pragma: 'no-cache',
  'Cache-Control': 'no-cache',
  Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
  'Sec-WebSocket-Version': '13',
  ...BASE_HEADERS,
}

const VOICE_HEADERS: Record<string, string> = {
  Authority: 'speech.platform.bing.com',
  'Sec-CH-UA': `" Not;A Brand";v="99", "Microsoft Edge";v="${CHROMIUM_MAJOR_VERSION}", "Chromium";v="${CHROMIUM_MAJOR_VERSION}"`,
  'Sec-CH-UA-Mobile': '?0',
  Accept: '*/*',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Dest': 'empty',
  ...BASE_HEADERS,
}

// ─── Voices ───────────────────────────────────────────────────────────────────

export interface EdgeVoice {
  ShortName: string
  Locale: string
  FriendlyName: string
  Gender: string
  Categories: { ContentCategories: string[]; VoicePersonalities: string[] }
}

let voiceCache: { at: number; voices: EdgeVoice[] } | null = null
const VOICE_CACHE_TTL = 6 * 3_600_000

/** Lista de vozes (cacheada em memória). Filtra por idioma quando pedido. */
export async function listEdgeVoices(opts: { locale?: string; fresh?: boolean } = {}): Promise<EdgeVoice[]> {
  if (!opts.fresh && voiceCache && Date.now() - voiceCache.at < VOICE_CACHE_TTL) {
    return filterVoices(voiceCache.voices, opts.locale)
  }
  const res = await fetch(VOICE_LIST_URL, { headers: VOICE_HEADERS, signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`Microsoft Edge TTS respondeu ${res.status} ao listar vozes`)
  const voices = (await res.json()) as EdgeVoice[]
  voiceCache = { at: Date.now(), voices }
  return filterVoices(voices, opts.locale)
}

function filterVoices(voices: EdgeVoice[], locale?: string) {
  if (!locale) return voices
  const prefix = locale.toLowerCase()
  return voices.filter(v => v.Locale.toLowerCase().startsWith(prefix))
}

// Renova o token TrustedClient quando o serviço retorna 403 ou a cooldown passou
export function maybeRenewToken(): void {
  const now = Date.now()
  if (now - lastTokenTime > TOKEN_RENEW_COOLDOWN) {
    // O token pode ser reutilizado; o serviço lida com rotação interna
    lastTokenTime = now
  }
}

/** Vozes pt/pt-BR que fazem sentido para narração (multilíngue incluído). */
export async function listNarrationVoices(): Promise<EdgeVoice[]> {
  const all = await listEdgeVoices()
  return all.filter(v => /^(pt-BR|pt-PT)/i.test(v.Locale) || /Multilingual/i.test(v.ShortName))
}

// ─── Synthesis ────────────────────────────────────────────────────────────────

export interface EdgeSynthOptions {
  voice?: string
  rate?: string   // ex. '+8%' (mais rápido) ou '-10%' (mais lento)
  volume?: string // ex. '+0%'
  pitch?: string  // ex. '+0Hz'
  boundary?: 'WordBoundary' | 'SentenceBoundary'
  timeoutMs?: number
  signal?: AbortSignal
}

export interface EdgeSynthResult {
  mp3: Buffer
  words: WordTime[]
  /** Posição do fim da última palavra em segundos (para dimensionar a cena). */
  lastWordEnd: number
}

const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

/** Quebra o texto em pedaços de até `maxBytes` sem cortar palavras (limite do serviço). */
export function chunkTextForEdge(text: string, maxBytes = 4096): string[] {
  const clean = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim()
  if (!clean) return []
  const sentences = clean.split(/(?<=[.!?…\n])\s+/)
  const out: string[] = []
  let cur = ''
  const pushIf = () => { if (cur.trim()) out.push(cur.trim()); cur = '' }
  const byteLen = (s: string) => Buffer.byteLength(s, 'utf8')
  for (const sentence of sentences) {
    if (byteLen(sentence) > maxBytes) {
      // Frase gigante: quebra por palavras
      for (const word of sentence.split(/\s+/)) {
        if (byteLen(cur + ' ' + word) > maxBytes) pushIf()
        cur = cur ? cur + ' ' + word : word
      }
      pushIf()
      continue
    }
    if (byteLen(cur ? cur + ' ' + sentence : sentence) > maxBytes) pushIf()
    cur = cur ? cur + ' ' + sentence : sentence
  }
  pushIf()
  return out
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const edgeDate = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${p(d.getUTCDate())} ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} GMT+0000 (Coordinated Universal Time)`
}

const MKSSML = (voice: string, rate: string, volume: string, pitch: string, lang: string, text: string) =>
  `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${lang}'>` +
  `<voice name='${voice}'><prosody pitch='${pitch}' rate='${rate}' volume='${volume}'>${escapeXml(text)}</prosody></voice></speak>`

function parseTextFrame(data: Buffer | string): { path?: string; offsetMs?: number; raw: string } {
  const s = Buffer.isBuffer(data) ? data.toString('utf8') : data
  const sep = s.indexOf('\r\n\r\n')
  const head = sep >= 0 ? s.slice(0, sep) : s
  const body = sep >= 0 ? s.slice(sep + 4) : ''
  const headers: Record<string, string> = {}
  for (const line of head.split('\r\n')) {
    const i = line.indexOf(':')
    if (i > 0) headers[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return { path: headers['Path'], raw: body }
}

/** Sintetiza um texto; resolve com o MP3 completo e os limites de cada palavra. */
export async function synthesizeEdge(text: string, opts: EdgeSynthOptions = {}): Promise<EdgeSynthResult> {
  const voice = opts.voice || 'pt-BR-AntonioNeural'
  const rate = opts.rate || '+0%'
  const volume = opts.volume || '+0%'
  const pitch = opts.pitch || '+0Hz'
  const wantWords = opts.boundary !== 'SentenceBoundary'
  const lang = /^(pt-BR|pt-PT|es-|fr-|it-|de-|en-|ja-|zh-|ko-)/i.exec(voice)?.[0].split('-').slice(0, 2).join('-') || 'pt-BR'
  const chunks = chunkTextForEdge(text)
  if (!chunks.length) throw new Error('Nada para sintetizar')

  const mp3Parts: Buffer[] = []
  const words: WordTime[] = []
  let compensationTicks = 0 // ticks acumulados dos pedaços anteriores (CBR 48 kbps)
  let lastWordEnd = 0

  for (const chunk of chunks) {
    const part = await synthesizeChunk(chunk, { voice, rate, volume, pitch, lang, wantWords, timeoutMs: opts.timeoutMs, signal: opts.signal }, compensationTicks)
    mp3Parts.push(part.mp3)
    words.push(...part.words)
    lastWordEnd = Math.max(lastWordEnd, ...part.words.map(w => w.end), lastWordEnd)
    compensationTicks += Math.floor((part.mp3.length * 8 * 10_000_000) / 48_000)
  }

  return { mp3: Buffer.concat(mp3Parts), words, lastWordEnd }
}

interface ChunkResult { mp3: Buffer; words: WordTime[] }

function synthesizeChunk(
  chunk: string,
  cfg: { voice: string; rate: string; volume: string; pitch: string; lang: string; wantWords: boolean; timeoutMs?: number; signal?: AbortSignal },
  compensationTicks: number,
): Promise<ChunkResult> {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID().replace(/-/g, '')
    const muid = crypto.randomBytes(16).toString('hex').toUpperCase()
    const url = `${WSS_URL}&ConnectionId=${crypto.randomUUID().replace(/-/g, '')}&Sec-MS-GEC=${generateSecMsGecV2()}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`
    const headers = { ...WSS_HEADERS, Cookie: `muid=${muid};` }
    const ws = new WebSocket(url, { headers, perMessageDeflate: true })

    const mp3: Buffer[] = []
    const words: WordTime[] = []
    let settled = false
    const timeoutMs = cfg.timeoutMs ?? 45_000
    const fail = (e: Error) => { if (settled) return; settled = true; clearTimeout(timer); try { ws.terminate() } catch {} ; reject(e) }
    const timer = setTimeout(() => fail(new Error('A voz do Edge demorou demais para responder')), timeoutMs)
    cfg.signal?.addEventListener('abort', () => fail(Object.assign(new Error('Cancelado'), { name: 'AbortError' })), { once: true })

    ws.on('open', () => {
      ws.send(
        `X-Timestamp:${edgeDate()}\r\n` +
        'Content-Type:application/json; charset=utf-8\r\n' +
        'Path:speech.config\r\n\r\n' +
        `{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"${cfg.wantWords ? 'false' : 'true'}","wordBoundaryEnabled":"${cfg.wantWords ? 'true' : 'false'}"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n`,
      )
      ws.send(
        `X-RequestId:${requestId}\r\n` +
        'Content-Type:application/ssml+xml\r\n' +
        `X-Timestamp:${edgeDate()}Z\r\n` +
        'Path:ssml\r\n\r\n' +
        MKSSML(cfg.voice, cfg.rate, cfg.volume, cfg.pitch, cfg.lang, chunk),
      )
    })

    ws.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
      try {
        if (isBinary) {
          const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer)
          if (buf.length < 2) return
          const headerLen = buf.readUInt16BE(0)
          if (headerLen > buf.length) return
          const head = buf.subarray(2, 2 + headerLen).toString('utf8')
          const body = buf.subarray(2 + headerLen)
          if (!/Path:\s*audio\b/.test(head)) return
          mp3.push(body)
          return
        }
        const frame = parseTextFrame(data as Buffer)
        const path = frame.path
        if (path === 'audio.metadata') {
          try {
            const json = JSON.parse(frame.raw) as { Metadata?: Array<{ Type: string; Data: { Offset: number; Duration: number; text?: { Text: string } } }> }
            for (const m of json.Metadata || []) {
              if (m.Type !== 'WordBoundary') continue
              const offset = m.Data.Offset + compensationTicks
              const start = offset / 1e7
              const end = (offset + m.Data.Duration) / 1e7
              if (m.Data.text?.Text) words.push({ word: m.Data.text.Text, start, end })
            }
          } catch {}
          return
        }
        if (path === 'turn.end') {
          // Nesta implementação a compensação CBR do pedaço entra na variável do laço externo
          if (settled) return
          settled = true
          clearTimeout(timer)
          try { ws.close() } catch {}
          const audio = Buffer.concat(mp3)
          if (!audio.length) return reject(new Error('A voz do Edge devolveu áudio vazio'))
          resolve({ mp3: audio, words })
          return
        }
      } catch (e) {
        fail(e as Error)
      }
    })
    // Renovação de token: se o serviço retornar 403, tenta um novo token na próxima tentativa
ws.on('error', e => {
  const msg = (e as Error).message
  if (msg.includes('403') || msg.includes('token')) {
    maybeRenewToken()
  }
  fail(e as Error)
})
    ws.on('unexpected-response', (_req, res) => fail(new Error(`A voz do Edge recusou a conexão (HTTP ${res.statusCode}${res.statusCode === 403 ? ' — token Sec-MS-GEC expirado ou serviço alterado' : ''})`)))
  })
}
