/**
 * Áudio do Estúdio: trilha sintetizada por clima (sem licenças externas),
 * ducking real da música sob a narração e normalização de loudness.
 * Reaproveita a síntese determinística de motion/audio.ts (Track, mix).
 */
import { mix, Track, SR } from '../motion/audio'

export type MusicMood =
  | 'epico'        // documentário/grandeza: acordes abertos graves + shimmer
  | 'inspirador'   // publicidade humana: tríade maior e pulso otimista
  | 'atmosferico'  // contemplativo: camadas longas e espaçadas
  | 'tenso'        // thriller/investigação: tons menores graves e pulsos
  | 'documental'   // neutro e sério: quinta justa grave em loop lento
  | 'publicitario' // vibrante: tríade + arpejo e brilho
  | 'nenhum'

export const MOOD_LABELS: Record<MusicMood, string> = {
  epico: 'Épica (grandes temas, documentários)',
  inspirador: 'Inspiradora (marcas e pessoas)',
  atmosferico: 'Atmosférica (contemplação, espaço)',
  tenso: 'Tensa (investigação, suspense)',
  documental: 'Documental (neutra e sóbria)',
  publicitario: 'Publicitária (vibrante e comercial)',
  nenhum: 'Sem trilha (só narração e efeitos)',
}

const MOOD_PADS: Record<Exclude<MusicMood, 'nenhum'>, { freqs: number[]; vol: number }> = {
  epico: { freqs: [98, 146.83, 196], vol: 0.055 },          // G2 D3 G3
  inspirador: { freqs: [130.81, 196, 261.63], vol: 0.05 },  // C3 G3 C4
  atmosferico: { freqs: [73.42, 110, 164.81], vol: 0.055 }, // D2 A2 E3
  tenso: { freqs: [55, 82.41, 98], vol: 0.06 },             // A1 E2 G2 (menor)
  documental: { freqs: [87.31, 130.81], vol: 0.042 },       // F2 F3 quinta grave
  publicitario: { freqs: [174.61, 261.63, 349.23], vol: 0.052 }, // F3 C4 F4
}

/** Riser suave antes do clímax (usado em ~60% da duração) e impacto no final. */
export function synthesizeBed(mood: MusicMood, seconds: number, fps: number, seed = 11): Track | null {
  if (mood === 'nenhum') return null
  const pad = MOOD_PADS[mood]
  const t = new Track(seconds, fps, seed)
  const swellStart = Math.round(seconds * 0.62 * fps)
  t.pad(pad.freqs, 0, seconds, pad.vol)
  t.rise(swellStart, 0.09, Math.min(2.4, seconds * 0.28))
  t.impact(Math.round((seconds - 0.18) * fps), 0.22)
  if (mood === 'publicitario') {
    const step = Math.round(0.41 * fps)
    for (let f = step * 2; f < Math.round(seconds * fps) - fps; f += step * 2) t.tick(f, 0.028, 3200)
  }
  if (mood === 'tenso') {
    const step = Math.round(1.7 * fps)
    for (let f = step; f < Math.round(seconds * fps); f += step) t.tick(f, 0.05, 1900)
  }
  return t
}

/**
 * Envelope follower + ducking: a música cede até `depth` (0..1) quando a narração fala.
 * Janelas de 20 ms com ataque rápido e liberação lenta (evita bombeamento).
 */
export function duck(music: Float32Array, narration: Float32Array, opts: { depth?: number; threshold?: number; attackMs?: number; releaseMs?: number } = {}): Float32Array {
  const depth = Math.min(0.9, Math.max(0, opts.depth ?? 0.72))
  const threshold = opts.threshold ?? 0.012
  const win = Math.round(0.02 * SR)
  const attack = Math.exp(-1 / ((opts.attackMs ?? 60) / 1000 * SR / win))
  const release = Math.exp(-1 / ((opts.releaseMs ?? 450) / 1000 * SR / win))
  let env = 0
  const gains = new Float32Array(Math.ceil(music.length / win))
  for (let w = 0; w < gains.length; w++) {
    let s = 0
    const i0 = w * win
    for (let k = i0; k < Math.min(i0 + win, narration.length); k++) s += narration[k] * narration[k]
    const rms = Math.sqrt(s / win)
    const target = rms > threshold ? 1 : 0
    env = target > env ? env * attack + target * (1 - attack) : env * release + target * (1 - release)
    gains[w] = 1 - depth * env
  }
  const out = new Float32Array(music.length)
  for (let w = 0; w < gains.length; w++) {
    const i0 = w * win
    const g = gains[w]
    for (let k = i0; k < Math.min(i0 + win, music.length); k++) out[k] = music[k] * g
  }
  return out
}

/** RMS em dBFS de um bloco (para o relatório de QA e para loudness). */
export function rmsDbfs(pcm: Float32Array): number {
  if (!pcm.length) return -Infinity
  let s = 0
  for (let i = 0; i < pcm.length; i++) s += pcm[i] * pcm[i]
  const rms = Math.sqrt(s / pcm.length)
  return rms <= 0 ? -Infinity : 20 * Math.log10(rms)
}

/** Fração de janelas de 50 ms praticamente em silêncio (narração ausente/abafada). */
export function silenceRatio(pcm: Float32Array, windowMs = 50, silentDb = -45): number {
  const win = Math.round((windowMs / 1000) * SR)
  if (win <= 0 || pcm.length < win) return pcm.length ? 0 : 1
  const silentAmp = Math.pow(10, silentDb / 20)
  let silent = 0, total = 0
  for (let i = 0; i + win <= pcm.length; i += win) {
    let s = 0
    for (let k = i; k < i + win; k++) s += pcm[k] * pcm[k]
    if (Math.sqrt(s / win) < silentAmp) silent++
    total++
  }
  return total ? silent / total : 1
}

/** Pico absoluto (0..1). */
export function peak(pcm: Float32Array): number {
  let p = 0
  for (let i = 0; i < pcm.length; i++) { const a = Math.abs(pcm[i]); if (a > p) p = a }
  return p
}

/** Normaliza para um pico alvo (ex.: -1 dBFS ≈ 0.89) só se estiver fora do alvo. */
export function normalizePeak(pcm: Float32Array, targetDb = -1): Float32Array {
  const p = peak(pcm)
  const target = Math.pow(10, targetDb / 20)
  if (p <= 0 || p >= target * 0.9) return pcm
  const g = target / p
  const out = new Float32Array(pcm.length)
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] * g
  return out
}

/**
 * Mixa narração + efeitos, com loudness final normalizado.
 * Só voz e efeitos: a trilha sintetizada (cama contínua) foi retirada a pedido — ela soava como um
 * zumbido/chiado constante por baixo da narração. `mood` continua aceito por compatibilidade e é ignorado.
 */
export function mixStudio(opts: { seconds: number; fps: number; narration: Float32Array | null; mood: MusicMood; sfx: Array<{ frame: number; type: 'pop' | 'tick' | 'whoosh' | 'shimmer' | 'impact' | 'rise'; vol?: number }>; narrationGain?: number; musicGain?: number }) {
  const { seconds, fps, narration, sfx } = opts
  const track = new Track(seconds, fps, 11)
  for (const e of sfx) track.add(e)
  const layers: Array<{ pcm: Float32Array; gain: number; offsetS?: number }> = []
  if (narration) layers.push({ pcm: narration, gain: opts.narrationGain ?? 1 })
  // Efeitos cedem sob a fala (não cobrem palavras)
  const music = narration ? duck(track.buf, narration, { depth: 0.5 }) : track.buf
  layers.push({ pcm: music, gain: opts.musicGain ?? (narration ? 0.8 : 0.95) })
  const mixed = mix(seconds, layers)
  return { pcm: normalizePeak(mixed, -1), music, track }
}
