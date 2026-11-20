/**
 * Pipeline do Estúdio de Vídeo: pedido → briefing → storyboard → narração →
 * imagens → trilha (com ducking) → renderização quadro a quadro → QA → entrega.
 * Filas, cancelamento, recuperação e logs detalhados, no mesmo modelo do Estúdio Motion.
 */
import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { dataDir, readJson, writeJsonAtomic } from '../agents/fsutil'
import { loadSavedKeys } from '../keys'
import { alignScript, readWav, speechSegments, writeWav, SR, type WordTime } from '../motion/audio'
import { generateImage, imageFile } from '../media/images'
import { synthesize } from '../motion/audio'
import { speak } from '../voice/gemini'
import { decodeAudioFile, openComposition, previews, renderVideo, type RenderSize } from '../motion/render'
import { Browser } from '../motion/chrome'
import { synthesizeEdge } from './edgeTts'
import { buildCues, toSrt, toVtt, transcribeWords } from './transcribe'
import { LOOKS, writeBrief, writeStoryboard, type DirectorBrief, type StoryboardScene } from './director'
import { buildCompositionHtml, imageToDataUri, MOOD_ACCENT, sceneTimingsFromWords, type CompositionScene } from './composition'
import { buildScenePrompt, styleAnchor } from './scenePrompt'
import { MOOD_LABELS, mixStudio, type MusicMood as MusicMoodT } from './audioMix'
import { auditAudio, sampleFrames, verdict } from './qa'
import { formatById, VIDEO_FORMATS } from './formats'
import type { VideoJob, VideoManifest, VideoRequest, VideoNarration } from './types'
import { VIDEO_LOOKS } from './types'

loadSavedKeys()

export const videoDir = () => path.join(dataDir(), 'video')
const jobsFile = () => path.join(videoDir(), 'jobs.json')
export const videoJobDir = (id: string) => path.join(videoDir(), id)
const scriptFile = (id: string) => path.join(videoDir(), id, 'script.json')
const qaFile = (id: string) => path.join(videoDir(), id, 'qa.json')

const MIN_SECONDS = 6
const MAX_SECONDS = 90
const ALLOWED_FPS = new Set([24, 25, 30, 50, 60])

// ─── Jobs store & queue ───────────────────────────────────────────────────────

export function listVideoJobs(): VideoJob[] {
  return readJson<VideoJob[]>(jobsFile(), []).sort((a, b) => b.createdAt - a.createdAt)
}
export function getVideoJob(id: string) {
  return listVideoJobs().find(j => j.id === id)
}
function saveVideoJob(job: VideoJob) {
  const all = readJson<VideoJob[]>(jobsFile(), [])
  const i = all.findIndex(j => j.id === job.id)
  if (i >= 0) all[i] = job
  else all.push(job)
  writeJsonAtomic(jobsFile(), all)
}

interface QueueState { queue: string[]; running?: string; aborts: Map<string, AbortController>; reuse: Map<string, VideoManifest> }
const g = globalThis as unknown as { __jarvisVideo?: QueueState }
const state = (): QueueState => (g.__jarvisVideo ||= { queue: [], aborts: new Map(), reuse: new Map() })

export function clampVideoRequest(r: Partial<VideoRequest>): VideoRequest {
  const prompt = String(r.prompt || '').trim()
  if (!prompt) throw new Error('Descreva o vídeo que você quer')
  const formatId = VIDEO_FORMATS.some(f => f.id === r.formatId) ? r.formatId! : 'youtube'
  const seconds = Math.max(MIN_SECONDS, Math.min(MAX_SECONDS, Math.round(Number(r.seconds) || 30)))
  const narration: VideoNarration = (['auto', 'none', 'file'] as const).find(n => n === r.narration) || 'auto'
  const voice = r.voice && (r.voice.provider === 'edge' || r.voice.provider === 'gemini' || r.voice.provider === 'windows')
    ? { provider: r.voice.provider, id: String(r.voice.id || 'pt-BR-AntonioNeural').slice(0, 80) }
    : { provider: 'edge' as const, id: 'pt-BR-AntonioNeural' }
  const music = (r.music as 'auto' | MusicMoodT) || 'auto'
  return {
    prompt: prompt.slice(0, 4000),
    formatId,
    seconds,
    fps: ALLOWED_FPS.has(Number(r.fps)) ? (Number(r.fps) as VideoRequest['fps']) : 30,
    narration,
    narrationText: r.narrationText ? String(r.narrationText).slice(0, 6000) : undefined,
    audioPath: r.audioPath ? String(r.audioPath) : undefined,
    voice,
    music,
    seed: r.seed !== undefined ? Math.floor(Number(r.seed)) || undefined : undefined,
    direction: r.direction ? String(r.direction).slice(0, 2000) : undefined,
    referenceImageId: typeof r.referenceImageId === 'string' && /^[\w-]{1,80}$/.test(r.referenceImageId) ? r.referenceImageId : undefined,
    look: VIDEO_LOOKS.find(l => l === r.look),
  }
}

export function createVideoJob(input: Partial<VideoRequest>): VideoJob {
  const request = clampVideoRequest(input)
  if (request.narration === 'file') {
    if (!request.audioPath || !fs.existsSync(request.audioPath)) throw new Error('Escolha o arquivo de áudio da sua narração')
  }
  const job: VideoJob = {
    id: uuidv4(), request, status: 'queued', stage: 'Na fila', progress: 0, log: [], previews: [], formatId: request.formatId, createdAt: Date.now(),
  }
  fs.mkdirSync(videoJobDir(job.id), { recursive: true })
  saveVideoJob(job)
  state().queue.push(job.id)
  void pump()
  return job
}

export function cancelVideoJob(id: string) {
  const s = state()
  s.queue = s.queue.filter(x => x !== id)
  s.aborts.get(id)?.abort()
  const job = getVideoJob(id)
  if (job && (job.status === 'queued' || job.status === 'running')) saveVideoJob({ ...job, status: 'canceled', stage: 'Cancelado', finishedAt: Date.now() })
}

export function deleteVideoJob(id: string) {
  cancelVideoJob(id)
  writeJsonAtomic(jobsFile(), readJson<VideoJob[]>(jobsFile(), []).filter(j => j.id !== id))
  const dir = videoJobDir(id)
  if (path.dirname(dir) === videoDir()) fs.rmSync(dir, { recursive: true, force: true })
}

export function recoverVideoJobs() {
  for (const j of listVideoJobs()) {
    if ((j.status === 'running' || j.status === 'queued') && !state().queue.includes(j.id) && state().running !== j.id) {
      saveVideoJob({ ...j, status: 'failed', error: 'Interrompido (o JARVIS foi fechado)', stage: 'Interrompido' })
    }
  }
}

async function pump() {
  const s = state()
  if (s.running) return
  const id = s.queue.shift()
  if (!id) return
  s.running = id
  const ac = new AbortController()
  const reuse = s.reuse.get(id)
  s.reuse.delete(id)
  s.aborts.set(id, ac)
  try {
    await runJob(id, ac.signal, reuse)
  } finally {
    s.aborts.delete(id)
    s.running = undefined
    void pump()
  }
}

// ─── Pipeline ─────────────────────────────────────────────────────────────────

function updateFactory(id: string) {
  let job = getVideoJob(id)!
  return {
    get job() { return job },
    update: (patch: Partial<VideoJob>, logLine?: string) => {
      const current = getVideoJob(id)
      // Job apagado pelo usuário durante a produção: interrompe como cancelamento, não ressuscita
      if (!current) throw Object.assign(new Error('Cancelado'), { name: 'AbortError' })
      if (current.status === 'canceled') throw Object.assign(new Error('Cancelado'), { name: 'AbortError' })
      job = { ...current, ...patch, log: logLine ? [...current.log, { at: Date.now(), text: logLine }].slice(-120) : current.log }
      saveVideoJob(job)
    },
  }
}

const srtVtt = (words: WordTime[]) => {
  const cues = buildCues(words, { maxWords: 8, maxChars: 46 })
  return { srt: toSrt(cues), vtt: toVtt(cues) }
}

/** Imagem de reserva real (gradiente + nome da cena) — usada só se a geração falhar. */
function placeholderScene(scene: StoryboardScene, accent: string, formatWidth: number): string {
  const safe = scene.name.replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c] || c))
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.min(formatWidth, 1280)}" height="${Math.round(Math.min(formatWidth, 1280) * 0.6)}" viewBox="0 0 1280 768">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b0e14"/><stop offset="0.55" stop-color="#141b2e"/><stop offset="1" stop-color="#1e2a44"/></linearGradient></defs>
<rect width="1280" height="768" fill="url(#g)"/>
<circle cx="1024" cy="180" r="130" fill="${accent}" opacity="0.16"/>
<circle cx="180" cy="620" r="180" fill="${accent}" opacity="0.10"/>
<text x="96" y="400" font-family="Georgia, serif" font-size="72" fill="#f5f1e8" font-weight="700">${safe}</text>
<rect x="96" y="452" width="220" height="7" fill="${accent}" rx="3"/>
</svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function sceneSfx(scenes: Array<{ sfx: string[]; startSec: number }>, fps: number) {
  const out: Array<{ frame: number; type: 'pop' | 'tick' | 'whoosh' | 'shimmer' | 'impact' | 'rise'; vol?: number }> = []
  for (const s of scenes) {
    for (const t of s.sfx) {
      const type = t as 'pop' | 'tick' | 'whoosh' | 'shimmer' | 'impact' | 'rise'
      out.push({ frame: Math.max(0, Math.round(s.startSec * fps)), type, vol: type === 'impact' ? 0.2 : 0.13 })
    }
  }
  return out
}

const hashStr = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return (h >>> 0).toString(16)
}

async function narrationFromText(text: string, outMp3: string, req: VideoRequest, signal: AbortSignal): Promise<{ words: WordTime[]; pcm: Float32Array; provider: string }> {
  const provider = req.voice.provider
  if (provider === 'edge') {
    const r = await synthesizeEdge(text, { voice: req.voice.id || 'pt-BR-AntonioNeural', boundary: 'WordBoundary', timeoutMs: 60_000, signal })
    fs.writeFileSync(outMp3, r.mp3)
    const browser = await Browser.launch()
    try {
      const pcm = await decodeAudioFile(browser, outMp3, path.dirname(outMp3))
      return { words: r.words, pcm, provider: `Edge (${req.voice.id})` }
    } finally {
      // Navegador descartável para a decodificação
      await browser.close().catch(() => {})
    }
  }
  if (provider === 'gemini') {
    const r = await speak(text, { voice: req.voice.id, signal })
    const wav = path.join(path.dirname(outMp3), 'narracao.wav')
    fs.writeFileSync(wav, r.wav)
    const pcm = readWav(wav)
    let words: WordTime[] = []
    try {
      words = (await transcribeWords(wav)).words
    } catch {
      words = alignScript(text, speechSegments(pcm))
    }
    return { words, pcm, provider: `Gemini (${req.voice.id})` }
  }
  // Windows (offline)
  await synthesize(text, outMp3.replace(/\.mp3$/i, '.wav'))
  const wav = outMp3.replace(/\.mp3$/i, '.wav')
  const pcm = readWav(wav)
  let words: WordTime[] = []
  try { words = (await transcribeWords(wav)).words } catch { words = alignScript(text, speechSegments(pcm)) }
  return { words, pcm, provider: 'Voz do Windows' }
}

/**
 * Prévia de voz do Estúdio: o MESMO motor que narra o vídeo (Edge, Gemini ou Windows), sem
 * fallback silencioso — se a voz falhar, o erro aparece, porque é isso que se quer testar.
 * Fica em cache por voz+texto: ouvir de novo é instantâneo e não gasta cota do Gemini.
 */
export async function previewVoice(voice: { provider: string; id?: string }, text: string, signal?: AbortSignal): Promise<{ file: string; type: string; provider: string }> {
  const provider = voice.provider === 'gemini' || voice.provider === 'windows' ? voice.provider : 'edge'
  const id = String(voice.id || (provider === 'edge' ? 'pt-BR-AntonioNeural' : provider === 'gemini' ? 'Kore' : '')).slice(0, 80)
  const clean = text.replace(/\s+/g, ' ').trim().slice(0, 400) || 'Olá! Esta é a voz que vai narrar o seu vídeo no JARVIS.'
  const dir = path.join(videoDir(), 'voice-previews')
  fs.mkdirSync(dir, { recursive: true })
  const base = path.join(dir, `${provider}-${hashStr(`${id}|${clean}`)}`)
  const label = provider === 'edge' ? `Edge · ${id}` : provider === 'gemini' ? `Gemini · ${id}` : 'Voz do Windows'
  for (const [ext, type] of [['.mp3', 'audio/mpeg'], ['.wav', 'audio/wav']] as const) {
    if (fs.existsSync(base + ext) && fs.statSync(base + ext).size > 1000) return { file: base + ext, type, provider: `${label} (cache)` }
  }
  if (provider === 'edge') {
    const r = await synthesizeEdge(clean, { voice: id, boundary: 'WordBoundary', timeoutMs: 30_000, signal })
    fs.writeFileSync(base + '.mp3', r.mp3)
    return { file: base + '.mp3', type: 'audio/mpeg', provider: `Edge · ${id}` }
  }
  if (provider === 'gemini') {
    const r = await speak(clean, { voice: id, signal })
    fs.writeFileSync(base + '.wav', r.wav)
    return { file: base + '.wav', type: 'audio/wav', provider: `Gemini · ${id}` }
  }
  await synthesize(clean, base + '.wav')
  return { file: base + '.wav', type: 'audio/wav', provider: 'Voz do Windows' }
}

interface RenderedNarration { words: WordTime[]; pcm: Float32Array | null; seconds: number; provider?: string }

async function buildNarration(
  req: VideoRequest, scenes: StoryboardScene[], dir: string, u: ReturnType<typeof updateFactory>, signal: AbortSignal,
): Promise<RenderedNarration> {
  const mp3 = path.join(dir, 'narracao.mp3')
  if (req.narration === 'none') return { words: [], pcm: null, seconds: scenes.reduce((s, x) => s + Math.max(1.5, x.durationSec), 0) }
  if (req.narration === 'file') {
    const wav = path.join(dir, 'narracao.wav')
    const browser = await Browser.launch()
    try {
      const pcm = await decodeAudioFile(browser, req.audioPath!, dir)
      const { writeWav } = await import('../motion/audio')
      writeWav(wav, pcm)
    } finally {
      await browser.close().catch(() => {})
    }
    const pcm = readWav(wav)
    const text = (req.narrationText || scenes.map(s => s.vo).join(' ')).trim()
    const words = alignScript(text, speechSegments(pcm))
    return { words, pcm, seconds: pcm.length / SR, provider: 'sua gravação' }
  }
  const text = (req.narrationText?.trim() || scenes.map(s => s.vo).join(' ')).trim()
  if (!text) return { words: [], pcm: null, seconds: scenes.reduce((s, x) => s + x.durationSec, 0) }
  try {
    const r = await narrationFromText(text, mp3, req, signal)
    const seconds = Math.max(r.pcm.length / SR + 0.35, r.words.length ? r.words[r.words.length - 1].end + 0.35 : 0)
    return { words: r.words, pcm: r.pcm, seconds, provider: r.provider }
  } catch (e) {
    u.update({}, `Voz ${req.voice.provider} falhou (${(e as Error).message}). Tentando a próxima opção…`)
    for (const fallback of ['gemini', 'windows'] as const) {
      if (fallback === req.voice.provider) continue
      try {
        const r = await narrationFromText(text, mp3, { ...req, voice: { provider: fallback, id: fallback === 'gemini' ? 'Kore' : '' } }, signal)
        const seconds = Math.max(r.pcm.length / SR + 0.35, r.words.length ? r.words[r.words.length - 1].end + 0.35 : 0)
        u.update({}, `Narração feita com ${r.provider} (a voz escolhida falhou)`)
        return { words: r.words, pcm: r.pcm, seconds, provider: r.provider }
      } catch (e2) {
        u.update({}, `Voz ${fallback} também falhou (${(e2 as Error).message})`)
      }
    }
    u.update({}, 'Sem narração disponível agora; produzindo o vídeo mudo com legendas desligadas')
    return { words: [], pcm: null, seconds: scenes.reduce((s, x) => s + x.durationSec, 0) }
  }
}

async function ensureSceneImages(
  scenes: StoryboardScene[], baseSeed: number, formatId: string, dir: string, failed: Set<number>,
  u: ReturnType<typeof updateFactory>, signal: AbortSignal, seedBumps: Record<number, number> = {},
  referenceImageId?: string, anchor = '',
): Promise<Array<string | null>> {
  const format = formatById(formatId)
  const out: Array<string | null> = new Array(scenes.length).fill(null)
  // Cena 1 usa a imagem enviada pelo usuário quando o pedido referenciá-la ("transforme essa imagem em vídeo")
  if (referenceImageId) {
    const ref = imageFile(referenceImageId)
    const target = path.join(dir, 'cena_00.jpg')
    if (ref && fs.existsSync(ref.file)) {
      try {
        fs.copyFileSync(ref.file, target)
        out[0] = target
        u.update({}, 'Cena 1: sua imagem de referência (enviada/gerada) foi usada como quadro inicial')
      } catch { /* cai na geração normal */ }
    } else {
      u.update({}, 'Imagem de referência não encontrada na galeria — a cena 1 será gerada normalmente')
    }
  }
  const attemptScene = async (i: number, bump: number): Promise<boolean> => {
    if (out[i]) return true
    if (signal.aborted) throw Object.assign(new Error('Cancelado'), { name: 'AbortError' })
    const file = path.join(dir, `cena_${String(i).padStart(2, '0')}.jpg`)
    if (fs.existsSync(file) && !bump) { out[i] = file; u.update({}, `Cena ${i + 1}: imagem reutilizada`); return true }
    if (fs.existsSync(file) && bump) fs.rmSync(file, { force: true })
    const prompt = buildScenePrompt(scenes[i].visual, anchor)
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const img = await generateImage(prompt, { aspect: format.aspect, seed: baseSeed + i * 7919 + (bump + attempt) * 1_000_000, provider: 'auto', skipEnhance: true })
        const src = path.join(dataDir(), 'images', img.file)
        fs.copyFileSync(src, file)
        out[i] = file
        u.update({}, `Cena ${i + 1}: imagem ${img.width}×${img.height} — ${img.provider}`)
        return true
      } catch (e) {
        if (attempt === 0) u.update({}, `Imagem da cena ${i + 1} falhou (${(e as Error).message}); tentando de novo`)
      }
    }
    return false
  }
  for (let i = 0; i < scenes.length; i++) {
    const bump = seedBumps[i] ?? 0
    if (out[i]) continue // referência do usuário já aplicada nesta cena
    u.update({ stage: `Designer: gerando imagem da cena ${i + 1}/${scenes.length}` }, `Designer: cena ${i + 1} — “${scenes[i].name}”`)
    if (!(await attemptScene(i, bump))) failed.add(i)
  }
  // Autocorreção: quem ficou sem imagem ganha uma segunda passada com outra semente
  if (failed.size) {
    u.update({ stage: 'Designer: recuperando cenas sem imagem' }, `Designer: ${failed.size} cena(s) sem imagem — segunda passada com nova semente`)
    for (const i of [...failed]) {
      const bump = (seedBumps[i] ?? 0) + 100
      if (await attemptScene(i, bump)) failed.delete(i)
    }
  }
  for (const i of failed) {
    u.update({}, `Cena ${i + 1} (“${scenes[i].name}”): geração de imagem indisponível — usando cartão tipográfico`)
    out[i] = null
  }
  return out
}

async function runJob(id: string, signal: AbortSignal, reuse?: VideoManifest | null) {
  const u = updateFactory(id)
  const dir = videoJobDir(id)
  let browser: Browser | null = null
  try {
    u.update({ status: 'running', stage: 'Analisando o pedido', progress: 0.02 })
    const req = getVideoJob(id)!.request
    const format = formatById(req.formatId)

    // ── Plano: roteiro salvo (regeneração) ou o diretor de IA cria um novo
    let brief: DirectorBrief
    let scenes: Array<StoryboardScene & { startSec?: number; endSec?: number }>
    let model: string | undefined
    let planTitle: string
    if (reuse) {
      brief = reuse.brief
      scenes = reuse.scenes.map(s => ({ ...s }))
      model = reuse.model
      planTitle = getVideoJob(id)!.title || req.prompt.slice(0, 60)
      u.update({}, `Roteiro salvo reutilizado (${scenes.length} cenas)`)
    } else {
      u.update({ stage: 'Diretor Criativo: direção de arte e briefing', progress: 0.05 })
      const r = await writeBrief(req.prompt + (req.direction ? `\nDireção extra do usuário: ${req.direction}` : ''), format, req.seconds, { signal, look: req.look })
      brief = r.brief
      u.update({}, `Briefing: “${brief.title}” · visual ${LOOKS[req.look || 'publicitario'].label} · ${brief.tone} · voz ${brief.voiceGender} · som: voz + efeitos`)
      u.update({ stage: 'Roteirista: storyboard cena a cena', progress: 0.12 })
      const s = await writeStoryboard(req.prompt, brief, format, req.seconds, { signal, look: req.look })
      scenes = s.storyboard.scenes
      model = s.model || r.model
      planTitle = s.storyboard.title
      u.update({ title: planTitle }, `Storyboard: ${scenes.length} cenas — ${scenes.map(x => x.name).join(' → ')}`)
    }

    // ── Narração (define o tempo das cenas; reaproveitada se a fala não mudou)
    u.update({ stage: 'Diretor de Áudio: narração', progress: 0.2 })
    const voHash = hashStr(scenes.map(s => s.vo).join('|'))
    const wavPath = path.join(dir, 'narracao.wav')
    let nar: RenderedNarration
    if (reuse?.words?.length && reuse.voHash === voHash && fs.existsSync(wavPath)) {
      const pcm = readWav(wavPath)
      nar = { words: reuse.words, pcm, seconds: pcm.length / SR, provider: 'reutilizada (a fala não mudou)' }
      u.update({}, 'Narração reutilizada (o texto das cenas é o mesmo)')
    } else {
      nar = await buildNarration(req, scenes, dir, u, signal)
      if (nar.pcm && !fs.existsSync(wavPath)) writeWav(wavPath, nar.pcm)
    }
    u.update({}, nar.provider ? `Narração: ${nar.provider} · ${(nar.pcm ? nar.pcm.length / SR : 0).toFixed(1)} s` : 'Vídeo mudo')

    const timings = nar.words.length
      ? sceneTimingsFromWords(scenes, nar.words)
      : scenes.map(s => ({ startSec: 0, endSec: 0 })).reduce<Array<{ startSec: number; endSec: number }>>((acc, s, i) => {
          const start = i === 0 ? 0 : acc[i - 1].endSec
          const dur = Math.max(1.5, scenes[i].durationSec)
          acc.push({ startSec: start, endSec: start + dur })
          return acc
        }, [])
    for (let i = 0; i < scenes.length; i++) { scenes[i].startSec = timings[i].startSec; scenes[i].endSec = timings[i].endSec }
    let seconds = Math.max(timings[timings.length - 1]?.endSec ?? req.seconds, 2)
    // O usuário pediu req.seconds: se a narração terminou antes, estica as cenas (imagens) até o tempo pedido
    if (seconds < req.seconds * 0.8 && scenes.length > 0) {
      const k = req.seconds / seconds
      let t = 0
      for (const s of scenes) {
        const dur = Math.max(1.5, ((s.endSec ?? 0) - (s.startSec ?? 0)) * k)
        s.startSec = t
        s.endSec = t + dur
        t += dur
      }
      seconds = t
      u.update({}, `Cenas esticadas para ${seconds.toFixed(1)}s (a narração durou ${(timings[timings.length - 1]?.endSec ?? 0).toFixed(1)}s — as imagens seguram o tempo pedido)`)
    }
    u.update({ durationSec: seconds })

    // ── Manifesto do roteiro (editável depois)
    const baseSeed = reuse?.baseSeed ?? req.seed ?? Math.floor(Math.random() * 1e9)
    const manifest: VideoManifest = {
      version: 1, engine: 'cinematic-v1', request: req, brief, scenes, baseSeed, model, createdAt: reuse?.createdAt ?? Date.now(),
      words: nar.words.length ? nar.words : undefined, voHash, seedBumps: reuse?.seedBumps,
    }
    fs.writeFileSync(scriptFile(id), JSON.stringify(manifest, null, 2))

    // ── Imagens das cenas
    u.update({ stage: 'Designer: imagens das cenas', progress: 0.3 })
    const failedImages = new Set<number>()
    const sceneFiles = await ensureSceneImages(scenes, baseSeed, format.id, dir, failedImages, u, signal, reuse?.seedBumps, req.referenceImageId, styleAnchor(brief))
    u.update({}, `Imagens: ${scenes.length - failedImages.size}/${scenes.length} geradas${failedImages.size ? ` (${failedImages.size} em cartão tipográfico)` : ''}`)
    // Regra de ouro do Estúdio: vídeo sem NENHUMA imagem não é entregue como pronto.
    if (failedImages.size === scenes.length) {
      throw new Error('Nenhuma imagem de cena pôde ser gerada (provedor grátis esgotado neste IP e/ou Gemini sem quota de imagem). Nada foi renderizado — tente novamente em instantes.')
    }

    // ── Trilha + efeitos + mixagem com ducking
    u.update({ stage: 'Diretor de Áudio: narração e efeitos', progress: 0.55 })
    const mood: MusicMoodT = req.music === 'auto' ? brief.musicMood : req.music
    const sfx = sceneSfx(scenes.map(s => ({ sfx: s.sfx, startSec: s.startSec! })), req.fps)
    const mixed = mixStudio({
      seconds, fps: req.fps, narration: nar.pcm, mood,
      sfx: [...sfx, { frame: Math.round(1.55 * req.fps), type: 'impact', vol: 0.16 }],
    })
    writeWav(path.join(dir, 'audio.wav'), mixed.pcm)

    // ── Página de composição determinística
    u.update({ stage: 'Editor: montagem e composição', progress: 0.62 })
    const compScenes: CompositionScene[] = scenes.map((s, i) => ({
      ...s,
      startSec: s.startSec!, endSec: s.endSec!,
      imgDataUri: sceneFiles[i] ? imageToDataUri(sceneFiles[i]!) : placeholderScene(s, MOOD_ACCENT[brief.musicMood] || '#ffd166', format.width),
    }))
    const html = buildCompositionHtml({ title: planTitle, brief, scenes: compScenes, words: nar.words, format, fps: req.fps, showTitleCard: true, showEndCard: true })
    const htmlFile = path.join(dir, 'composition.html')
    fs.writeFileSync(htmlFile, html)

    // ── QA: frames e áudio
    u.update({ stage: 'Revisor: QA de quadros e áudio', progress: 0.68 })
    browser = await Browser.launch()
    const size: RenderSize = { width: format.width, height: format.height, fps: req.fps, frames: Math.round(seconds * req.fps) }
    const page = await openComposition(browser, htmlFile, size)
    let shots: Array<{ frame: number; file: string; bytes: number }> = []
    try {
      for (const f of fs.readdirSync(dir).filter(f => f.startsWith('previa_'))) fs.rmSync(path.join(dir, f), { force: true })
      shots = await previews(page, size, dir)
      const frameSamples = await sampleFrames(page, size.frames)
      const audioAudit = auditAudio(nar.pcm)
      const qa = verdict({ samples: frameSamples, durationSec: seconds, plannedSec: req.seconds, narrationPlanned: req.narration !== 'none' && !!nar.pcm, audio: audioAudit, failedImages: failedImages.size, expectedImages: scenes.length })
      fs.writeFileSync(qaFile(id), JSON.stringify(qa, null, 2))
      u.update({
        qa: { ok: qa.ok, issues: qa.issues, warnings: qa.warnings, blackFrames: qa.blackFrames, durationSec: qa.durationSec, plannedSec: qa.plannedSec },
      }, qa.issues.length ? `QA: ${qa.issues.length} problema(s) — ${qa.issues[0]}` : `QA aprovado (${qa.warnings.length} aviso(s))`)
    } finally {
      await page.send('Page.close').catch(() => {})
    }
    u.update({ previews: shots.map(s => path.basename(s.file)) })

    // ── Render + encode
    u.update({ stage: 'Editor: renderização quadro a quadro', progress: 0.74, frames: size.frames })
    const started = Date.now()
    const out = path.join(dir, 'video.mp4')
    const page2 = await openComposition(browser, htmlFile, size)
    try {
      let lastSave = 0
      await renderVideo(browser, page2, size, mixed.pcm, out, done => {
        if (Date.now() - lastSave < 1500 && done < size.frames) return
        lastSave = Date.now()
        const eta = done ? Math.round(((Date.now() - started) / done) * (size.frames - done) / 1000) : 0
        u.update({ stage: `Renderizando ${done}/${size.frames}${eta ? ` · ~${eta}s` : ''}`, progress: 0.74 + 0.24 * (done / size.frames) })
      }, signal)
    } finally {
      await page2.send('Page.close').catch(() => {})
    }

    // ── Legendas exportáveis
    if (nar.words.length) {
      const { srt, vtt } = srtVtt(nar.words)
      fs.writeFileSync(path.join(dir, 'legendas.srt'), srt)
      fs.writeFileSync(path.join(dir, 'legendas.vtt'), vtt)
    }

    const bytes = fs.statSync(out).size
    u.update({
      status: 'done', stage: 'Pronto', progress: 1, output: 'video.mp4', sizeBytes: bytes, finishedAt: Date.now(),
    }, `Vídeo pronto: ${size.frames} quadros · ${seconds.toFixed(1)} s · ${(bytes / 1e6).toFixed(1)} MB`)
  } catch (e) {
    const msg = (e as Error).message
    const current = getVideoJob(id)
    if (current && current.status !== 'canceled') {
      saveVideoJob({ ...current, status: msg === 'Cancelado' ? 'canceled' : 'failed', stage: msg === 'Cancelado' ? 'Cancelado' : 'Falhou', error: msg === 'Cancelado' ? undefined : msg, finishedAt: Date.now() })
    }
    // Job já apagado pelo usuário: fica apagado (não ressuscita)
  } finally {
    try { await browser?.close() } catch {}
  }
}

// ─── Roteiro editável & regeneração ─────────────────────────────────────────

export function getVideoManifest(id: string): VideoManifest | null {
  return readJson<VideoManifest | null>(scriptFile(id), null)
}

/** Salva edições do roteiro (vo/visual por cena). O usuário regera o vídeo em seguida. */
export function saveVideoScript(id: string, edits: Array<{ name?: string; vo?: string; visual?: string; camera?: string; durationSec?: number }>): VideoManifest {
  const m = getVideoManifest(id)
  if (!m) throw new Error('Este vídeo não tem roteiro salvo')
  const scenes = m.scenes.slice()
  const seedBumps = { ...(m.seedBumps || {}) }
  edits.forEach((e, i) => {
    if (!scenes[i]) return
    const s = { ...scenes[i] }
    if (typeof e.name === 'string') s.name = e.name.slice(0, 60)
    if (typeof e.vo === 'string') s.vo = e.vo.slice(0, 1500)
    if (typeof e.visual === 'string') {
      const next = e.visual.slice(0, 600)
      if (next !== s.visual) { seedBumps[i] = (seedBumps[i] ?? 0) + 1 } // imagem nova depois
      s.visual = next
    }
    if (typeof e.camera === 'string' && ['zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'pan-up', 'pan-down', 'static', 'orbit'].includes(e.camera)) s.camera = e.camera as typeof s.camera
    if (Number.isFinite(Number(e.durationSec)) && Number(e.durationSec) > 0.8) s.durationSec = Math.min(30, Number(e.durationSec))
    scenes[i] = s
  })
  const next = { ...m, scenes, seedBumps, dirty: true }
  fs.writeFileSync(scriptFile(id), JSON.stringify(next, null, 2))
  const job = getVideoJob(id)
  if (job) saveVideoJob({ ...job, scriptEdited: true })
  return next
}

/** Regenera a partir do roteiro salvo. Sem `onlyScene`, regera o vídeo inteiro; com ele, apenas a imagem daquela cena. */
/** Read all cena_XX.jpg into memory, rewrite with a new index mapping (newPos → oldPos). */
function reindexSceneArtifacts(dir: string, origin: number[]) {
  const pad = (i: number) => `cena_${String(i).padStart(2, '0')}.jpg`
  const cached = new Map<number, Buffer>()
  for (const f of fs.readdirSync(dir).filter(f => /^cena_\d{2}\.jpg$/.test(f))) {
    cached.set(Number(f.slice(5, 7)), fs.readFileSync(path.join(dir, f)))
  }
  for (const f of fs.readdirSync(dir).filter(f => /^cena_\d{2}\.jpg$/.test(f))) {
    fs.rmSync(path.join(dir, f), { force: true })
  }
  for (let j = 0; j < origin.length; j++) {
    const buf = cached.get(origin[j])
    if (buf) fs.writeFileSync(path.join(dir, pad(j)), buf)
  }
}

function rekeyBumps(seedBumps: Record<number, number> | undefined, origin: number[]): Record<number, number> | undefined {
  if (!seedBumps) return undefined
  const out: Record<number, number> = {}
  origin.forEach((oldIdx, newPos) => {
    if (seedBumps[oldIdx] !== undefined) out[newPos] = seedBumps[oldIdx]
  })
  return out
}

function rekeyManifest(id: string, scenes: VideoManifest['scenes'], origin: number[], seedBumps: Record<number, number> | undefined): VideoManifest {
  const dir = videoJobDir(id)
  reindexSceneArtifacts(dir, origin)
  // O manifesto fica "sujo": a narração muda (VOs reordenados) e os tempos são recalculados na regeração
  const manifest = readJson<VideoManifest | null>(scriptFile(id), null)
  if (!manifest) throw new Error('Este vídeo não tem roteiro salvo')
  const next: VideoManifest = { ...manifest, scenes, seedBumps: rekeyBumps(seedBumps ?? manifest.seedBumps, origin), dirty: true, words: undefined, voHash: undefined }
  fs.writeFileSync(scriptFile(id), JSON.stringify(next, null, 2))
  const job = getVideoJob(id)
  if (job) saveVideoJob({ ...job, scriptEdited: true })
  return next
}

/** Move a cena `from` para a posição `to` (índices 0-based). Imagens são reindexadas junto. */
export function moveVideoScene(id: string, from: number, to: number): VideoManifest {
  const m = getVideoManifest(id)
  if (!m) throw new Error('Este vídeo não tem roteiro salvo')
  const n = m.scenes.length
  if (from < 0 || from >= n) throw new Error('Cena inexistente')
  const dest = Math.max(0, Math.min(n - 1, to))
  if (from === dest) return m
  const scenes = m.scenes.slice()
  const [moved] = scenes.splice(from, 1)
  scenes.splice(dest, 0, moved)
  const origin = scenes.map(s => m.scenes.indexOf(s))
  return rekeyManifest(id, scenes, origin, m.seedBumps)
}

/** Exclui a cena `index` (mínimo uma cena restante); as seguintes são rebaixadas. */
export function deleteVideoScene(id: string, index: number): VideoManifest {
  const m = getVideoManifest(id)
  if (!m) throw new Error('Este vídeo não tem roteiro salvo')
  const n = m.scenes.length
  if (index < 0 || index >= n) throw new Error('Cena inexistente')
  if (n <= 1) throw new Error('O vídeo precisa de pelo menos uma cena')
  const scenes = m.scenes.slice()
  scenes.splice(index, 1)
  const origin: number[] = []
  for (let j = 0; j < n - 1; j++) origin.push(j < index ? j : j + 1)
  return rekeyManifest(id, scenes, origin, m.seedBumps)
}

/** Duplica a cena `index` logo depois dela; a cópia recebe seedBump para ganhar imagem própria na regeração. */
export function duplicateVideoScene(id: string, index: number): VideoManifest {
  const m = getVideoManifest(id)
  if (!m) throw new Error('Este vídeo não tem roteiro salvo')
  const n = m.scenes.length
  if (index < 0 || index >= n) throw new Error('Cena inexistente')
  const scenes = m.scenes.slice()
  const copy = { ...scenes[index], name: `${scenes[index].name} (cópia)`.slice(0, 60) }
  scenes.splice(index + 1, 0, copy)
  const origin: number[] = scenes.map((_, newPos) => (newPos <= index ? newPos : newPos === index + 1 ? index : newPos - 1))
  const manifest = rekeyManifest(id, scenes, origin, m.seedBumps)
  // A cópia herda a imagem por ora (reindex copia os bytes), mas regera imagem própria na próxima regeração
  const seedBumps = { ...(manifest.seedBumps || {}) }
  seedBumps[index + 1] = (seedBumps[index + 1] ?? 0) + 1
  const next = { ...manifest, seedBumps }
  fs.writeFileSync(scriptFile(id), JSON.stringify(next, null, 2))
  return next
}

export function regenerateVideoJob(id: string, onlyScene?: number): VideoJob {
  const job = getVideoJob(id)
  if (!job) throw new Error('Vídeo não encontrado')
  const m = getVideoManifest(id)
  if (!m) throw new Error('Este vídeo não tem roteiro para regerar')
  const dir = videoJobDir(id)
  if (onlyScene !== undefined && (onlyScene < 0 || onlyScene >= m.scenes.length)) throw new Error('Cena inexistente')
  const seedBumps = { ...(m.seedBumps || {}) }
  if (onlyScene !== undefined) seedBumps[onlyScene] = (seedBumps[onlyScene] ?? 0) + 1
  const nextManifest = { ...m, seedBumps, dirty: false }
  const nextId = uuidv4()
  const nextDir = videoJobDir(nextId)
  fs.mkdirSync(nextDir, { recursive: true })
  fs.writeFileSync(path.join(nextDir, 'script.json'), JSON.stringify(nextManifest, null, 2))
  for (const f of fs.readdirSync(dir)) {
    if (!/^cena_\d{2}\.jpg$/.test(f)) continue
    const idx = Number(f.match(/\d{2}/)![0])
    if (onlyScene === idx) continue // esta cena terá imagem nova
    fs.copyFileSync(path.join(dir, f), path.join(nextDir, f))
  }
  if (fs.existsSync(path.join(dir, 'narracao.wav'))) fs.copyFileSync(path.join(dir, 'narracao.wav'), path.join(nextDir, 'narracao.wav'))
  const next: VideoJob = {
    id: nextId,
    request: { ...m.request, seconds: m.request.seconds },
    status: 'queued',
    stage: onlyScene !== undefined ? `Regerando a cena ${onlyScene + 1}` : 'Na fila (regência do vídeo)',
    progress: 0,
    log: [{ at: Date.now(), text: onlyScene !== undefined ? `Regeração da cena ${onlyScene + 1}` : 'Regência a partir do roteiro salvo' }],
    previews: [], formatId: m.request.formatId, createdAt: Date.now(), scriptEdited: false,
  }
  saveVideoJob(next)
  state().reuse.set(nextId, nextManifest)
  state().queue.push(nextId)
  void pump()
  return next
}
