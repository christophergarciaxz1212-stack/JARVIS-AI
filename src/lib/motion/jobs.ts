import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { dataDir, readJson, writeJsonAtomic } from '../agents/fsutil'
import { alignScript, mix, readWav, SR, speechSegments, Track, writeWav, type WordTime } from './audio'
import { narrate } from '../voice/narrate'
import { brandFromSite } from './brand'
import { Browser } from './chrome'
import { fixComposition, motionGuide, normalizeScenes, setRawSink, snapScenes, writeComposition, writePlan, type Plan } from './compose'
import { decodeAudioFile, openComposition, previews, renderVideo, validate, type RenderSize } from './render'
import { buildPage, fallbackComposition, staticIssues } from './template'
import { MOTION_STYLES, type Brand, type Composition, type MotionJob, type MotionRequest } from './types'
import { kitFallback } from './kit'
import { synthesizeEdge } from '../video/edgeTts'
import type { NarrationResult } from '../voice/narrate'

/**
 * Narração com a voz do Edge escolhida no Estúdio: o Edge devolve o tempo exato de cada palavra,
 * então a legenda karaokê bate com a fala. O MP3 é decodificado pelo próprio Chrome do render.
 */
async function narrateEdge(text: string, voiceId: string, browser: Browser, dir: string, outWav: string, signal: AbortSignal): Promise<NarrationResult> {
  try {
    const voice = voiceId || 'pt-BR-AntonioNeural'
    const r = await synthesizeEdge(text, { voice, signal })
    const mp3 = path.join(dir, 'narracao.mp3')
    fs.writeFileSync(mp3, r.mp3)
    fs.writeFileSync(path.join(dir, 'narracao.txt'), text, 'utf-8')
    writeWav(outWav, await decodeAudioFile(browser, mp3, dir))
    return { ok: true, words: r.words, provider: `Edge · ${voice.replace(/^pt-BR-/, '').replace(/Neural$/, '')}` }
  } catch (e) {
    if (signal.aborted) throw e
    // Edge indisponível: tenta a voz das Configurações em vez de entregar sem voz
    const fallback = await narrate(text, outWav, signal)
    return fallback.ok ? { ...fallback, note: `Edge falhou (${(e as Error).message})` } : { ok: false, note: `Edge: ${(e as Error).message} · ${fallback.note}` }
  }
}

export const motionDir = () => path.join(dataDir(), 'motion')
const jobsFile = () => path.join(motionDir(), 'jobs.json')
export const jobDir = (id: string) => path.join(motionDir(), id)

const W = 1080
const H = 1920
const MAX_FIX_ROUNDS = 3

export function listJobs(): MotionJob[] {
  return readJson<MotionJob[]>(jobsFile(), []).sort((a, b) => b.createdAt - a.createdAt)
}
export function getJob(id: string) {
  return listJobs().find(j => j.id === id)
}
function saveJob(job: MotionJob) {
  const all = readJson<MotionJob[]>(jobsFile(), [])
  const i = all.findIndex(j => j.id === job.id)
  if (i >= 0) all[i] = job
  else all.push(job)
  writeJsonAtomic(jobsFile(), all)
}

interface QueueState { queue: string[]; running?: string; aborts: Map<string, AbortController> }
const g = globalThis as unknown as { __jarvisMotion?: QueueState }
const state = (): QueueState => (g.__jarvisMotion ||= { queue: [], aborts: new Map() })

export function clampRequest(r: Partial<MotionRequest>): MotionRequest {
  const prompt = String(r.prompt || '').trim()
  if (!prompt && !r.parentId) throw new Error('Descreva o vídeo que você quer')
  return {
    prompt: prompt.slice(0, 2000),
    brandUrl: r.brandUrl && /^https?:\/\//i.test(r.brandUrl) ? r.brandUrl.slice(0, 500) : undefined,
    // Modelos retirados (cinema, continua, kinetic) caem no automático
    style: MOTION_STYLES.find(s => s === r.style) || 'auto',
    seconds: Math.max(4, Math.min(90, Math.round(Number(r.seconds) || 12))),
    fps: Number(r.fps) === 30 ? 30 : 60,
    narration: (['none', 'jarvis', 'file'] as const).find(s => s === r.narration) || 'none',
    narrationText: r.narrationText ? String(r.narrationText).slice(0, 3000) : undefined,
    audioPath: r.audioPath ? String(r.audioPath) : undefined,
    voice: r.voice && ['edge', 'gemini', 'windows'].includes(String(r.voice.provider)) ? { provider: r.voice.provider, id: String(r.voice.id || '').slice(0, 80) } : undefined,
    model: r.model ? String(r.model) : undefined,
    parentId: r.parentId ? String(r.parentId) : undefined,
    feedback: r.feedback ? String(r.feedback).slice(0, 2000) : undefined,
  }
}

export function createJob(input: Partial<MotionRequest>): MotionJob {
  const request = clampRequest(input)
  if (request.parentId) {
    const parent = getJob(request.parentId)
    if (!parent) throw new Error('Vídeo original não encontrado')
    if (!fs.existsSync(path.join(jobDir(parent.id), 'composition.json'))) throw new Error('O vídeo original não tem cena salva para ajustar')
    request.prompt = request.prompt || parent.request.prompt
  }
  if (request.narration === 'file' && (!request.audioPath || !fs.existsSync(request.audioPath))) throw new Error('Escolha o arquivo de áudio da sua narração')
  const job: MotionJob = { id: uuidv4(), request, status: 'queued', stage: 'Na fila', progress: 0, log: [], previews: [], createdAt: Date.now() }
  fs.mkdirSync(jobDir(job.id), { recursive: true })
  saveJob(job)
  state().queue.push(job.id)
  void pump()
  return job
}

export function cancelJob(id: string) {
  const s = state()
  s.queue = s.queue.filter(x => x !== id)
  s.aborts.get(id)?.abort()
  const job = getJob(id)
  if (job && (job.status === 'queued' || job.status === 'running')) saveJob({ ...job, status: 'canceled', stage: 'Cancelado', finishedAt: Date.now() })
}

export function deleteJob(id: string) {
  cancelJob(id)
  writeJsonAtomic(jobsFile(), readJson<MotionJob[]>(jobsFile(), []).filter(j => j.id !== id))
  // Only the job's own folder inside data/motion (never the user's files, e.g. their narration audio)
  const dir = jobDir(id)
  if (path.dirname(dir) === motionDir()) fs.rmSync(dir, { recursive: true, force: true })
}

/** After a restart, jobs that were mid-way are marked as interrupted. */
export function recoverJobs() {
  for (const j of listJobs()) if ((j.status === 'running' || j.status === 'queued') && !state().queue.includes(j.id) && state().running !== j.id) saveJob({ ...j, status: 'failed', error: 'Interrompido (o JARVIS foi fechado)', stage: 'Interrompido' })
}

async function pump() {
  const s = state()
  if (s.running) return
  const id = s.queue.shift()
  if (!id) return
  s.running = id
  const ac = new AbortController()
  s.aborts.set(id, ac)
  try {
    await runJob(id, ac.signal)
  } finally {
    s.aborts.delete(id)
    s.running = undefined
    void pump()
  }
}

async function runJob(id: string, signal: AbortSignal) {
  let job = getJob(id)!
  const dir = jobDir(id)
  const update = (patch: Partial<MotionJob>, logLine?: string) => {
    const current = getJob(id)
    if (current?.status === 'canceled') throw new Error('Cancelado')
    job = { ...job, ...patch, log: logLine ? [...job.log, { at: Date.now(), text: logLine }].slice(-80) : job.log }
    saveJob(job)
  }
  let browser: Browser | null = null
  try {
    update({ status: 'running', stage: 'Preparando', progress: 0.02 })
    const req = job.request
    let rawN = 0
    setRawSink((step, text) => { try { fs.writeFileSync(path.join(dir, `ia_${String(++rawN).padStart(2, '0')}_${step}.txt`), text) } catch {} })
    const guide = await motionGuide()
    update({}, `Método: ${guide.source}`)

    // ── Brand
    let brand: Brand | undefined
    let fontCss = ''
    if (req.brandUrl) {
      update({ stage: 'Lendo a identidade da marca', progress: 0.04 })
      try {
        const r = await brandFromSite(req.brandUrl)
        brand = r.brand
        fontCss = r.fontCss
        update({}, `Marca: ${brand.name} · cores ${brand.colors.join(' ') || '—'} · fonte ${brand.font || '—'}${brand.logoDataUri ? ' · logo ok' : ''}`)
        for (const n of brand.notes) update({}, n)
      } catch (e) {
        update({}, `Marca: ${(e as Error).message}`)
      }
    }

    browser = await Browser.launch()
    let comp: Composition
    let words: WordTime[] = []
    let narrationPcm: Float32Array | null = null
    let seconds = req.seconds
    let model = ''

    const parent = req.parentId ? getJob(req.parentId) : undefined
    if (parent) {
      // ── Revision of an earlier video: same timing and voice, adjusted scene
      comp = readJson<Composition>(path.join(jobDir(parent.id), 'composition.json'), null as unknown as Composition)
      words = parent.words || []
      seconds = (parent.frames || parent.request.seconds * parent.request.fps) / parent.request.fps
      const voice = path.join(jobDir(parent.id), 'narracao.wav')
      if (fs.existsSync(voice)) narrationPcm = readWav(voice)
      req.fps = parent.request.fps
      update({ title: `${comp.title} (ajuste)`, stage: 'Ajustando a cena', progress: 0.1 })
      const size = { width: W, height: H, fps: req.fps, frames: Math.round(seconds * req.fps) }
      const r = await fixComposition(req, comp, [], guide.text, size, signal)
      comp = r.comp
      model = r.model
    } else {
      // ── Plan
      update({ stage: 'Escrevendo o roteiro', progress: 0.06 })
      const p = await writePlan(req, brand, guide.text, signal)
      let plan: Plan = p.plan
      model = p.model
      update({ title: plan.title, model }, `Roteiro (${plan.style}): ${plan.scenes.map(s => s.name).join(' → ')}`)

      // ── Audio first: narration decides the timing
      const text = (req.narrationText || plan.narration || '').trim()
      if (req.narration === 'jarvis' && text) {
        update({ stage: 'Gravando a narração', progress: 0.12 })
        const wav = path.join(dir, 'narracao.wav')
        const voice = req.voice?.provider === 'edge'
          ? await narrateEdge(text, req.voice.id, browser, dir, wav, signal)
          : await narrate(text, wav, signal, req.voice ? { provider: req.voice.provider === 'gemini' ? 'gemini' : 'windows', ...(req.voice.provider === 'gemini' && req.voice.id ? { voice: req.voice.id } : {}) } : undefined)
        if (voice.ok) {
          words = voice.words
          narrationPcm = readWav(wav)
          seconds = Math.min(90, narrationPcm.length / SR + 0.9)
          update({}, `Narração (${voice.provider}): ${words.length} palavras, ${(narrationPcm.length / SR).toFixed(1)} s${voice.note ? ` — Gemini indisponível: ${voice.note}` : ''}`)
        } else {
          // The video still gets made; the log says why it has no voice
          update({}, `Sem narração: ${voice.note}`)
        }
      } else if (req.narration === 'file' && req.audioPath) {
        update({ stage: 'Analisando a sua narração', progress: 0.12 })
        narrationPcm = await decodeAudioFile(browser, req.audioPath, dir)
        writeWav(path.join(dir, 'narracao.wav'), narrationPcm)
        const segs = speechSegments(narrationPcm)
        words = text ? alignScript(text, segs) : []
        seconds = Math.min(90, narrationPcm.length / SR + 0.5)
        update({}, `Sua narração: ${(narrationPcm.length / SR).toFixed(1)} s, ${segs.length} trecho(s) de fala${text ? '' : ' (sem texto: as cenas seguem as pausas)'}`)
        if (!text && segs.length) plan = { ...plan, scenes: normalizeScenes(segs.map((s, i) => ({ name: `trecho ${i + 1}`, start: s.start, end: s.end, idea: plan.scenes[Math.min(i, plan.scenes.length - 1)]?.idea || '' })), seconds) }
      }
      if (seconds !== req.seconds) {
        const k = seconds / req.seconds
        plan = { ...plan, scenes: normalizeScenes(plan.scenes.map(s => ({ ...s, start: s.start * k, end: s.end * k })), seconds) }
      }
      plan = { ...plan, scenes: snapScenes(plan.scenes, words) }

      // ── Scene code
      update({ stage: 'Programando a animação', progress: 0.18, words })
      const size0 = { width: W, height: H, fps: req.fps, frames: Math.round(seconds * req.fps) }
      let c: Awaited<ReturnType<typeof writeComposition>> | null = null
      for (let attempt = 0; !c; attempt++) {
        try { c = await writeComposition(req, plan, brand, words, guide.text, size0, signal) } catch (e) {
          if (signal.aborted || attempt >= 1 || !/bloco/.test((e as Error).message)) throw e
          update({}, 'A IA respondeu fora do formato; pedindo de novo')
        }
      }
      comp = c.comp
      model = c.model
    }

    const size: RenderSize = { width: W, height: H, fps: req.fps, frames: Math.round(seconds * req.fps) }
    update({ frames: size.frames, model })

    // ── Test frames, fix what breaks (up to 2 rounds)
    const htmlFile = path.join(dir, 'composition.html')
    let previewFiles: string[] = []
    let best: { comp: Composition; problems: number; previews: string[] } | null = null
    let compModel = model
    let lastErrKey = ''
    const avoidModels: string[] = []
    for (let round = 0; ; round++) {
      update({ stage: round ? `Corrigindo (rodada ${round})` : 'Testando quadros', progress: 0.3 + round * 0.05 })
      const problems = staticIssues(comp.js)
      fs.writeFileSync(htmlFile, buildPage(comp, { ...size, words, brand, fontCss }))
      if (!problems.length) {
        const page = await openComposition(browser, htmlFile, size)
        const v = await validate(page, size).catch(e => ({ errors: [`Erro ao executar a página: ${(e as Error).message}`], issues: [] as string[] }))
        problems.push(...v.errors, ...v.issues)
        if (!v.errors.length) {
          for (const f of fs.readdirSync(dir).filter(f => f.startsWith('previa_'))) fs.rmSync(path.join(dir, f), { force: true })
          const shots = await previews(page, size, dir)
          previewFiles = shots.map(s => path.basename(s.file))
          if (shots.every(s => s.bytes < 9000)) problems.push('Todos os quadros de prévia saíram praticamente vazios (nada visível): verifique se renderFrame desenha no #stage')
        }
        await page.send('Page.close').catch(() => {})
      }
      update({ previews: previewFiles }, problems.length ? `Teste: ${problems.length} problema(s): ${problems.slice(0, 3).join(' | ')}` : 'Teste: todos os quadros ok')
      // Broken = the page cannot render; cosmetic = it renders but could be better
      const broken = problems.filter(p => !/passa da largura|muda quando|cenas não mudam|metade de baixo|sobreposto|meio do quadro/.test(p))
      if (!broken.length && (!best || problems.length < best.problems)) best = { comp, problems: problems.length, previews: previewFiles }
      if (!problems.length) break
      if (round >= MAX_FIX_ROUNDS) {
        // A later "fix" may have broken a version that worked: fall back to the best one seen
        if (broken.length && best) {
          comp = best.comp
          previewFiles = best.previews
          fs.writeFileSync(htmlFile, buildPage(comp, { ...size, words, brand, fontCss }))
          update({ previews: previewFiles }, 'Usando a melhor versão testada (a última correção quebrou a cena)')
        } else if (broken.length) {
          // Never ship a broken or blank video: switch to the built-in kinetic typography (synced to the voice)
          update({}, `A IA não entregou uma cena válida depois de ${MAX_FIX_ROUNDS} correções (${broken[0].slice(0, 120)}). Usando a cena de reserva do JARVIS: tipografia animada sincronizada com a narração.`)
          const sentences = (req.narrationText || req.prompt).split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(Boolean)
          comp = comp.kit
            ? kitFallback(comp.kit, { title: comp.title || req.prompt.slice(0, 60), scenes: comp.scenes, words, fps: size.fps, seconds })
            : fallbackComposition({ title: comp.title || req.prompt.slice(0, 60), scenes: comp.scenes, captions: sentences.map(s => s.slice(0, 70)), words, fps: size.fps, seconds })
          fs.writeFileSync(htmlFile, buildPage(comp, { ...size, words, brand, fontCss }))
          const page = await openComposition(browser, htmlFile, size)
          const v = await validate(page, size)
          if (v.errors.length) { await page.send('Page.close').catch(() => {}); throw new Error(`A cena de reserva falhou: ${v.errors[0]}`) }
          for (const f of fs.readdirSync(dir).filter(f => f.startsWith('previa_'))) fs.rmSync(path.join(dir, f), { force: true })
          previewFiles = (await previews(page, size, dir)).map(s => path.basename(s.file))
          await page.send('Page.close').catch(() => {})
          update({ previews: previewFiles }, 'Cena de reserva testada: ok')
        }
        break
      }
      // O mesmo erro depois de uma correção: esse modelo não está conseguindo — a próxima rodada usa outro
      const errKey = broken.join('|').replace(/\d+/g, '#')
      if (round >= 1 && errKey && errKey === lastErrKey && compModel && !avoidModels.includes(compModel)) {
        avoidModels.push(compModel)
        update({}, `O mesmo erro voltou: a próxima correção usa outro modelo (evitando ${compModel.split('|').pop()})`)
      }
      lastErrKey = errKey
      try {
        const f = await fixComposition({ ...req, feedback: undefined }, comp, problems, guide.text, size, signal, avoidModels)
        comp = f.comp
        compModel = f.model
        update({ model: f.model })
      } catch (e) {
        if (signal.aborted) throw e
        // A malformed reply costs one round; the previous code is kept and sent again
        update({}, `Correção inválida: ${(e as Error).message}`)
      }
    }
    fs.writeFileSync(path.join(dir, 'composition.json'), JSON.stringify(comp, null, 2))

    // ── Sound: effects on the same frames as the visual events, voice on top
    update({ stage: 'Criando os efeitos sonoros', progress: 0.42 })
    // Só voz e efeitos: a cama harmônica (pad) que a IA pede é ignorada — soava como zumbido constante
    const track = new Track(seconds, size.fps)
    // A IA às vezes não manda efeitos: entram os básicos nas viradas de cena (sem eles o vídeo fica "seco")
    if (!comp.sfx.length) {
      comp.sfx = [
        { frame: 0, type: 'impact', vol: 0.2 },
        ...comp.scenes.slice(1).map(s => ({ frame: Math.round(s.start * size.fps), type: 'whoosh' as const, vol: 0.09 })),
        { frame: Math.max(1, size.frames - Math.round(1.1 * size.fps)), type: 'shimmer', vol: 0.06 },
      ]
      update({}, 'A IA não enviou efeitos sonoros: usando os efeitos padrão nas viradas de cena')
    }
    for (const e of comp.sfx) track.add(e)
    const audio = mix(seconds, narrationPcm ? [{ pcm: narrationPcm, gain: 1 }, { pcm: track.buf, gain: 0.5 }] : [{ pcm: track.buf, gain: 0.95 }])
    writeWav(path.join(dir, 'audio.wav'), audio)
    update({}, `Som: ${narrationPcm ? 'narração + ' : ''}${comp.sfx.length} efeito(s)`)

    // ── Render + encode (H.264/AAC in Chrome, no ffmpeg)
    update({ stage: 'Renderizando quadro a quadro', progress: 0.45 })
    const page = await openComposition(browser, htmlFile, size)
    const out = path.join(dir, 'video.mp4')
    const started = Date.now()
    let lastSave = 0
    const r = await renderVideo(browser, page, size, audio, out, done => {
      if (Date.now() - lastSave < 1500 && done < size.frames) return
      lastSave = Date.now()
      const eta = done ? Math.round(((Date.now() - started) / done) * (size.frames - done) / 1000) : 0
      update({ stage: `Renderizando ${done}/${size.frames}${eta ? ` · ~${eta}s` : ''}`, progress: 0.45 + 0.53 * (done / size.frames) })
    }, signal)
    update({ status: 'done', stage: 'Pronto', progress: 1, output: 'video.mp4', sizeBytes: r.bytes, finishedAt: Date.now() },
      `Vídeo: ${size.frames} quadros, ${(r.bytes / 1e6).toFixed(1)} MB (${r.codecs.video}${r.codecs.audio ? ` + ${r.codecs.audio}` : ''}) em ${Math.round((Date.now() - started) / 1000)} s`)
  } catch (e) {
    const msg = (e as Error).message
    const current = getJob(id)
    if (current?.status !== 'canceled') saveJob({ ...job, status: msg === 'Cancelado' ? 'canceled' : 'failed', stage: msg === 'Cancelado' ? 'Cancelado' : 'Falhou', error: msg === 'Cancelado' ? undefined : msg, finishedAt: Date.now() })
  } finally {
    setRawSink(undefined)
    await browser?.close()
  }
}
