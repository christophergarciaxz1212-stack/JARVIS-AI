/**
 * Produtor do estúdio: executa a produção inteira e diz a verdade sobre onde está.
 *
 * Etapas reais, na ordem: roteiro → imagens → narração → trilha → montagem →
 * renderização. Cada etapa muda de estado quando começa e quando termina de
 * fato; o progresso do render é o número de quadros já gravados, não uma
 * estimativa. Cancelar interrompe a etapa em curso (rede, voz e render recebem
 * o mesmo sinal), e um trabalho que estava rodando quando o app fechou volta
 * como "interrompido" — nunca como "rodando" para sempre.
 *
 * Saídas na pasta do trabalho: video.mp4, legendas.srt, narracao.wav,
 * capa.jpg e projeto.json (o plano editável, usado nas revisões).
 */
import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { dataDir, writeJsonAtomic } from '../agents/fsutil'
import { Browser } from '../motion/chrome'
import { decodeAudioFile, openComposition, renderVideo } from '../motion/render'
import { SR, writeWav } from '../motion/audio'
import { renderImage, imageSize } from '../media/images'
import { synthesizeEdge } from '../video/edgeTts'
import { buildCues, toSrt } from '../video/transcribe'
import { direct } from './director'
import { chooseVoice, decideFormat } from './plan'
import { buildTimeline, type SceneSpeech } from './timeline'
import { composeScore, mixdown, MOOD_LABELS, placeVoice } from './music'
import { buildComposition, type CompositionScene } from './composition'
import {
  STAGE_LABELS, STAGE_ORDER,
  type Aspect, type Mood, type ProductionPlan, type SceneAsset, type Stage, type StageId, type StudioJob, type StudioRequest,
} from './types'

const FPS = 30

export const studioDir = () => path.join(dataDir(), 'studio')
export const studioJobDir = (id: string) => path.join(studioDir(), id)
const jobFile = (id: string) => path.join(studioJobDir(id), 'job.json')

/** Arquivos que a API pode servir de dentro da pasta do trabalho. */
export const SERVABLE = /^(video\.mp4|legendas\.srt|narracao\.wav|capa\.jpg|projeto\.json|cena_\d{2}\.(?:jpg|png|webp))$/

const abortError = () => Object.assign(new Error('Cancelado'), { name: 'AbortError' })
const isAbort = (e: unknown) => (e as Error)?.name === 'AbortError' || /cancelad/i.test((e as Error)?.message || '')

// ─── Registro em memória (sobrevive a recargas de rota) ─────────────────────

interface Running { ctrl: AbortController }
interface Registry { running: Map<string, Running>; queue: string[]; busy: boolean; recovered: boolean }
const g = globalThis as unknown as { __jarvisStudio?: Registry }
const reg = (): Registry => (g.__jarvisStudio ??= { running: new Map(), queue: [], busy: false, recovered: false })

// ─── Persistência ────────────────────────────────────────────────────────────

function save(job: StudioJob) {
  fs.mkdirSync(studioJobDir(job.id), { recursive: true })
  writeJsonAtomic(jobFile(job.id), job)
}

export function getStudioJob(id: string): StudioJob | null {
  if (!/^[\w-]{1,80}$/.test(id)) return null
  try { return JSON.parse(fs.readFileSync(jobFile(id), 'utf-8')) as StudioJob } catch { return null }
}

export function listStudioJobs(limit = 50): StudioJob[] {
  recoverStudioJobs()
  let ids: string[] = []
  try { ids = fs.readdirSync(studioDir()) } catch { return [] }
  return ids
    .map(id => getStudioJob(id))
    .filter((j): j is StudioJob => !!j)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
}

/** Trabalhos que estavam rodando quando o app fechou não podem continuar "rodando". */
export function recoverStudioJobs() {
  const r = reg()
  if (r.recovered) return
  r.recovered = true
  let ids: string[] = []
  try { ids = fs.readdirSync(studioDir()) } catch { return }
  for (const id of ids) {
    const j = getStudioJob(id)
    if (!j || (j.status !== 'running' && j.status !== 'queued') || r.running.has(id)) continue
    j.status = 'failed'
    j.error = 'A produção foi interrompida (o JARVIS fechou no meio). Peça de novo para refazer.'
    for (const s of j.stages) if (s.status === 'executando' || s.status === 'aguardando') s.status = 'falhou'
    j.finishedAt = Date.now()
    save(j)
  }
}

// ─── Criação, fila e cancelamento ───────────────────────────────────────────

function newStages(): Stage[] {
  return STAGE_ORDER.map(id => ({ id, label: STAGE_LABELS[id], status: 'aguardando' as const }))
}

export interface CreateOptions {
  /** Revisão de um trabalho anterior: o plano dele é ajustado, não reescrito do zero. */
  parentId?: string
  feedback?: string
}

export function createStudioJob(request: StudioRequest, opts: CreateOptions = {}): StudioJob {
  recoverStudioJobs()
  const prompt = String(request.prompt || '').trim()
  if (!prompt && !opts.parentId) throw new Error('Descreva o vídeo que você quer')

  const parent = opts.parentId ? getStudioJob(opts.parentId) : null
  if (opts.parentId && !parent) throw new Error('Vídeo anterior não encontrado')

  // Revisão herda o pedido original; o que mudou vai no feedback
  const req: StudioRequest = parent ? { ...parent.request, ...request, prompt: parent.request.prompt } : { ...request, prompt }
  const f = decideFormat(req)
  const job: StudioJob = {
    id: uuidv4(),
    request: req,
    status: 'queued',
    stages: newStages(),
    aspect: f.aspect,
    width: f.width,
    height: f.height,
    fps: FPS,
    notes: [],
    parentId: parent?.id,
    createdAt: Date.now(),
  }
  save(job)
  const r = reg()
  r.queue.push(job.id)
  feedbackOf.set(job.id, opts.feedback || '')
  void pump()
  return job
}

const feedbackOf = new Map<string, string>()

/** Uma produção por vez: render e geradores grátis não aguentam paralelo. */
async function pump() {
  const r = reg()
  if (r.busy) return
  const id = r.queue.shift()
  if (!id) return
  r.busy = true
  try {
    await produce(id)
  } finally {
    r.busy = false
    void pump()
  }
}

export function cancelStudioJob(id: string): boolean {
  const r = reg()
  const naFila = r.queue.indexOf(id)
  if (naFila >= 0) {
    r.queue.splice(naFila, 1)
    const j = getStudioJob(id)
    if (j) { j.status = 'canceled'; j.finishedAt = Date.now(); for (const s of j.stages) if (s.status === 'aguardando') s.status = 'pulado'; save(j) }
    return true
  }
  const running = r.running.get(id)
  if (!running) return false
  running.ctrl.abort()
  return true
}

// ─── A produção ─────────────────────────────────────────────────────────────

async function produce(id: string) {
  const job = getStudioJob(id)
  if (!job || job.status === 'canceled') return
  const ctrl = new AbortController()
  reg().running.set(id, { ctrl })
  const signal = ctrl.signal
  const dir = studioJobDir(id)

  let ultimoSave = 0
  const persist = (forcar = false) => {
    const agora = Date.now()
    if (forcar || agora - ultimoSave > 400) { ultimoSave = agora; save(job) }
  }
  const stage = (sid: StageId) => job.stages.find(s => s.id === sid)!
  const inicia = (sid: StageId, detail?: string) => { const s = stage(sid); s.status = 'executando'; s.startedAt = Date.now(); s.detail = detail; persist(true) }
  const detalhe = (sid: StageId, detail: string) => { stage(sid).detail = detail; persist() }
  const conclui = (sid: StageId, detail?: string) => { const s = stage(sid); s.status = 'concluido'; s.endedAt = Date.now(); if (detail !== undefined) s.detail = detail; persist(true) }
  const pula = (sid: StageId, detail: string) => { const s = stage(sid); s.status = 'pulado'; s.detail = detail; persist(true) }
  const checa = () => { if (signal.aborted) throw abortError() }

  let browser: Browser | null = null
  job.status = 'running'
  persist(true)

  try {
    const req = job.request
    const f = decideFormat(req)

    // 1. Roteiro e direção ──────────────────────────────────────────────────
    inicia('roteiro', 'o diretor está escrevendo o roteiro')
    const parent = job.parentId ? getStudioJob(job.parentId) : null
    const feedback = feedbackOf.get(id) || ''
    const { plan, model } = await direct({
      prompt: req.prompt, aspect: f.aspect, seconds: f.seconds, scenes: f.scenes, words: f.words,
      previous: parent?.plan, feedback: parent ? feedback : undefined,
    }, signal)
    job.plan = plan
    job.title = plan.title
    conclui('roteiro', `${plan.scenes.length} cenas · ${model.split('|').pop()}`)
    checa()

    // 2. Imagens ────────────────────────────────────────────────────────────
    inicia('imagens', `0 de ${plan.scenes.length}`)
    job.assets = await sceneImages(plan, req, f.aspect, dir, parent, (feitas, total, via) => detalhe('imagens', `${feitas} de ${total}${via ? ` · ${via}` : ''}`), job.notes, signal)
    conclui('imagens', `${job.assets.length} imagens`)
    checa()

    browser = await Browser.launch()

    // 3. Narração ───────────────────────────────────────────────────────────
    const narrar = req.narration !== false
    const speeches: SceneSpeech[] = plan.scenes.map(() => ({ speech: 0, words: [] }))
    const vozes: Array<{ pcm: Float32Array; at: number }> = []
    const pcmPorCena: Float32Array[] = []
    if (narrar) {
      const voz = chooseVoice(plan.voice.gender, plan.voice.style, req.voice)
      job.voiceLabel = voz.label
      inicia('narracao', `voz ${voz.label}`)
      for (let i = 0; i < plan.scenes.length; i++) {
        checa()
        const fala = plan.scenes[i].narration
        if (!fala) { pcmPorCena.push(new Float32Array(0)); continue }
        detalhe('narracao', `cena ${i + 1} de ${plan.scenes.length} · ${voz.label}`)
        const r = await synthesizeEdge(fala, { voice: voz.id, rate: voz.rate, pitch: voz.pitch, signal })
        const mp3 = path.join(dir, `fala_${String(i).padStart(2, '0')}.mp3`)
        fs.writeFileSync(mp3, r.mp3)
        const pcm = await decodeAudioFile(browser, mp3, dir)
        fs.rmSync(mp3, { force: true })
        pcmPorCena.push(pcm)
        speeches[i] = { speech: pcm.length / SR, words: r.words }
      }
      conclui('narracao', job.voiceLabel)
    } else pula('narracao', 'sem narração, como pedido')
    checa()

    // Linha do tempo a partir da fala real
    const tl = buildTimeline(speeches, { target: f.seconds, endCard: !!plan.cta, narrated: narrar })
    job.timings = tl.timings
    job.durationSec = Math.round(tl.duration * 10) / 10
    tl.speechAt.forEach((at, i) => { if (pcmPorCena[i]?.length) vozes.push({ pcm: pcmPorCena[i], at }) })
    if (narrar && Math.abs(tl.duration - f.seconds) > Math.max(6, f.seconds * 0.25)) {
      job.notes.push(`Ficou com ${Math.round(tl.duration)} s em vez de ${f.seconds} s: a duração segue a fala, para não cortar nem esticar demais.`)
    }

    // 4. Trilha e efeitos ───────────────────────────────────────────────────
    const humor: Mood | null = req.music === 'nenhuma' ? null : req.music && req.music !== 'auto' ? req.music : plan.mood
    let trilha: Float32Array | null = null
    if (humor) {
      inicia('trilha', `trilha ${MOOD_LABELS[humor]}`)
      trilha = composeScore(humor, tl.timings, tl.duration, FPS)
      conclui('trilha', `trilha ${MOOD_LABELS[humor]} sintetizada, acompanhando os cortes`)
    } else pula('trilha', 'sem trilha, como pedido')
    checa()

    // 5. Montagem e legendas ────────────────────────────────────────────────
    inicia('montagem', 'juntando imagem, fala, trilha e legenda')
    const voz = vozes.length ? placeVoice(tl.duration, vozes) : null
    if (voz) writeWav(path.join(dir, 'narracao.wav'), voz)
    const audio = mixdown(tl.duration, voz, trilha)

    const legendas = req.captions !== false && tl.words.length > 0
    const cues = legendas ? buildCues(tl.words, f.aspect === '9:16' ? { maxWords: 5, maxChars: 28 } : { maxWords: 7, maxChars: 42 }) : []
    if (cues.length) fs.writeFileSync(path.join(dir, 'legendas.srt'), toSrt(cues), 'utf-8')

    const cenas: CompositionScene[] = plan.scenes.map((s, i) => {
      const a = job.assets![i]
      const buf = fs.readFileSync(path.join(dir, a.file))
      const tipo = /\.png$/.test(a.file) ? 'image/png' : /\.webp$/.test(a.file) ? 'image/webp' : 'image/jpeg'
      return {
        image: `data:${tipo};base64,${buf.toString('base64')}`,
        camera: s.camera,
        transition: s.transition,
        onScreen: s.onScreen,
        fit: fitFor(a.width / a.height, f.width / f.height),
      }
    })
    const monochrome = /preto e branco|preta e branca|p&b|monocrom|black and white/i.test(`${req.prompt} ${plan.look}`)
    const html = buildComposition({
      width: f.width, height: f.height, fps: FPS, duration: tl.duration,
      plan, scenes: cenas, timings: tl.timings, cues, endCardFrom: tl.endCardFrom, monochrome,
    })
    const htmlFile = path.join(dir, 'composicao.html')
    fs.writeFileSync(htmlFile, html, 'utf-8')
    writeJsonAtomic(path.join(dir, 'projeto.json'), { versao: 1, request: req, plan, timings: tl.timings, assets: job.assets, voz: job.voiceLabel, formato: { aspect: f.aspect, width: f.width, height: f.height, fps: FPS } })
    conclui('montagem', `${cues.length ? `${cues.length} legendas · ` : ''}${tl.timings.length} cenas`)
    checa()

    // 6. Renderização ───────────────────────────────────────────────────────
    const frames = Math.max(1, Math.round(tl.duration * FPS))
    job.framesTotal = frames
    job.framesDone = 0
    inicia('render', `quadro 0 de ${frames}`)
    const size = { width: f.width, height: f.height, fps: FPS, frames }
    const page = await openComposition(browser, htmlFile, size)
    await page.eval('window.ready', 60_000)

    // Capa: um quadro com o título inteiro na tela
    await page.eval(`window.renderFrame(${Math.min(frames - 1, Math.round(1.3 * FPS))})`)
    fs.writeFileSync(path.join(dir, 'capa.jpg'), Buffer.from(await page.screenshot('jpeg', 88), 'base64'))

    const t0 = Date.now()
    const r = await renderVideo(browser, page, size, audio, path.join(dir, 'video.mp4'), done => {
      job.framesDone = done
      const vel = done / Math.max(0.001, (Date.now() - t0) / 1000)
      const resta = vel > 0 ? Math.round((frames - done) / vel) : 0
      detalhe('render', `quadro ${done} de ${frames}${done > 30 && resta ? ` · ~${resta < 90 ? `${resta}s` : `${Math.round(resta / 60)} min`}` : ''}`)
    }, signal)
    job.framesDone = frames

    // Confere o arquivo antes de chamar de pronto
    const out = path.join(dir, 'video.mp4')
    const head = fs.readFileSync(out).subarray(4, 8).toString('ascii')
    if (head !== 'ftyp' || r.bytes < 1000) throw new Error('O arquivo de vídeo saiu inválido')
    job.output = 'video.mp4'
    job.sizeBytes = r.bytes
    conclui('render', `${Math.round(r.bytes / 1024 / 1024 * 10) / 10} MB · H.264${r.codecs.audio ? ' + áudio' : ''}`)

    job.status = 'done'
    job.finishedAt = Date.now()
    persist(true)
  } catch (e) {
    const cancelado = isAbort(e) || signal.aborted
    job.status = cancelado ? 'canceled' : 'failed'
    job.error = cancelado ? undefined : (e as Error).message
    for (const s of job.stages) {
      if (s.status === 'executando') s.status = cancelado ? 'pulado' : 'falhou'
      else if (s.status === 'aguardando') s.status = 'pulado'
    }
    job.finishedAt = Date.now()
    persist(true)
  } finally {
    reg().running.delete(id)
    feedbackOf.delete(id)
    await browser?.close().catch(() => {})
    limpaTemporarios(dir)
  }
}

/**
 * Apaga o que só serve durante a produção: página de composição, codificador,
 * decodificador e falas soltas. Roda no sucesso, na falha e no cancelamento.
 */
export function limpaTemporarios(dir: string) {
  let nomes: string[] = []
  try { nomes = fs.readdirSync(dir) } catch { return }
  for (const n of nomes) {
    if (n === 'composicao.html' || n === 'encoder.html' || n === 'decoder.html' || /^fala_\d+\.mp3$/.test(n)) {
      fs.rmSync(path.join(dir, n), { force: true })
    }
  }
}

/** Imagem com proporção muito diferente do vídeo encaixa (com fundo desfocado) em vez de cortar. */
export function fitFor(imageRatio: number, frameRatio: number): 'cover' | 'contain' {
  const dif = Math.abs(Math.log(imageRatio / frameRatio))
  return dif > Math.log(1.35) ? 'contain' : 'cover'
}

// ─── Imagens: duas filas grátis em paralelo ─────────────────────────────────

const IMG_ASPECT: Record<Aspect, '16:9' | '9:16' | '1:1'> = { '16:9': '16:9', '9:16': '9:16', '1:1': '1:1' }

/**
 * Gera a imagem de cada cena usando as filas gratuitas ao mesmo tempo: NVIDIA
 * (se houver chave) e Pollinations (sem chave). Cada fila puxa a próxima cena
 * livre; se uma falhar numa cena, a outra tenta. Imagens do usuário entram
 * primeiro. Numa revisão, cenas cuja descrição não mudou reaproveitam a imagem.
 */
async function sceneImages(
  plan: ProductionPlan, req: StudioRequest, aspect: Aspect, dir: string, parent: StudioJob | null,
  progresso: (feitas: number, total: number, via?: string) => void, notes: string[], signal: AbortSignal,
): Promise<SceneAsset[]> {
  const total = plan.scenes.length
  const assets: Array<SceneAsset | undefined> = new Array(total)
  let feitas = 0

  const grava = (i: number, buf: Buffer, ext: string, provider: string) => {
    const file = `cena_${String(i).padStart(2, '0')}.${ext}`
    fs.writeFileSync(path.join(dir, file), buf)
    const [w, h] = imageSize(buf) || [1024, 1024]
    assets[i] = { scene: i, file, provider, width: w, height: h }
    feitas++
  }

  // Imagens do usuário
  const doUsuario = (req.images || []).filter(p => { try { return fs.statSync(p).isFile() } catch { return false } })
  doUsuario.slice(0, total).forEach((p, i) => grava(i, fs.readFileSync(p), path.extname(p).slice(1).toLowerCase() || 'jpg', 'sua imagem'))

  // Revisão: reaproveita imagens de cenas iguais
  if (parent?.plan && parent.assets) {
    plan.scenes.forEach((s, i) => {
      if (assets[i]) return
      const k = parent.plan!.scenes.findIndex(o => o.image === s.image)
      const a = k >= 0 ? parent.assets!.find(x => x.scene === k) : undefined
      const origem = a ? path.join(studioJobDir(parent.id), a.file) : ''
      if (a && fs.existsSync(origem)) grava(i, fs.readFileSync(origem), path.extname(a.file).slice(1), a.provider)
    })
  }
  progresso(feitas, total)

  const pendentes = plan.scenes.map((_, i) => i).filter(i => !assets[i])
  if (!pendentes.length) return assets as SceneAsset[]

  const filas: Array<'nvidia' | 'pollinations'> = process.env.NVIDIA_API_KEY ? ['nvidia', 'pollinations'] : ['pollinations']
  const tentativas = new Map<number, Set<string>>()
  const marcaDagua = { vista: false }

  const fila = async (provider: 'nvidia' | 'pollinations') => {
    while (true) {
      if (signal.aborted) throw abortError()
      // Próxima cena livre que esta fila ainda não tentou
      const idx = pendentes.findIndex(i => !tentativas.get(i)?.has(provider))
      if (idx < 0) return
      const i = pendentes.splice(idx, 1)[0]
      const tentou = tentativas.get(i) ?? new Set<string>()
      tentou.add(provider)
      tentativas.set(i, tentou)
      const prompt = `${plan.scenes[i].image}. ${plan.look}. Cinematic, high detail, consistent style, no text, no letters, no watermark.`
      try {
        const r = await renderImage(prompt, { aspect: IMG_ASPECT[aspect], provider, skipEnhance: true })
        const ext = /png/.test(r.type) ? 'png' : /webp/.test(r.type) ? 'webp' : 'jpg'
        grava(i, r.buf, ext, r.label)
        if (/marca d/i.test(r.label)) marcaDagua.vista = true
        progresso(feitas, total, r.label.replace(/\s*\(.*$/, ''))
      } catch (e) {
        if (signal.aborted) throw abortError()
        // Devolve a cena para a outra fila tentar
        if (filas.some(p => !tentou.has(p))) pendentes.push(i)
        else notes.push(`Cena ${i + 1}: nenhum gerador entregou a imagem (${(e as Error).message.slice(0, 120)}).`)
      }
    }
  }
  await Promise.all(filas.map(fila))

  if (marcaDagua.vista) notes.push('Algumas imagens vieram do Pollinations gratuito, que aplica marca d’água.')

  // Cena sem imagem: usa a da cena vizinha, dito claramente
  for (let i = 0; i < total; i++) {
    if (assets[i]) continue
    // A mais próxima: anterior primeiro (mantém a continuidade), depois a seguinte
    let vizinha = -1
    for (let d = 1; d < total && vizinha < 0; d++) {
      if (i - d >= 0 && assets[i - d]) vizinha = i - d
      else if (i + d < total && assets[i + d]) vizinha = i + d
    }
    if (vizinha < 0) throw new Error('Nenhuma imagem pôde ser gerada agora. Tente de novo em alguns minutos.')
    assets[i] = { ...assets[vizinha]!, scene: i }
    notes.push(`Cena ${i + 1} reaproveitou a imagem da cena ${vizinha + 1}.`)
  }
  return assets as SceneAsset[]
}

/** Caminho seguro de um arquivo servível do trabalho. */
export function studioFile(id: string, name: string): string | null {
  if (!/^[\w-]{1,80}$/.test(id) || !SERVABLE.test(name)) return null
  const p = path.join(studioJobDir(id), name)
  return fs.existsSync(p) ? p : null
}
