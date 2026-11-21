/**
 * Trilha e efeitos do estúdio, sintetizados aqui mesmo — grátis, offline e sem
 * licença de terceiros.
 *
 * O que isto é, dito sem exagero: uma trilha sintetizada por clima, com
 * progressão de acordes, baixo, arpejo e acentos — não uma música composta e
 * mixada por gente. O que a torna útil num vídeo é que ela SEGUE A EDIÇÃO: o
 * acorde muda no corte de cena, há um "whoosh" em cada transição, um impacto na
 * abertura, uma subida antes do final, e a música abaixa sozinha quando a voz
 * fala (ducking).
 *
 * (A versão antiga segurava um único acorde do começo ao fim do vídeo.)
 */
import { mix, SR, Track } from '../motion/audio'
import type { Mood, SceneTiming } from './types'

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12)

interface MoodScore {
  /** Acordes da progressão, em notas MIDI (o primeiro é a fundamental). */
  chords: number[][]
  bpm: number
  /** Densidade do arpejo: 0 = sem arpejo, 1 = colcheias, 2 = semicolcheias. */
  arp: 0 | 1 | 2
  padVol: number
  arpVol: number
  bassVol: number
}

// Graus escolhidos pelo efeito: épico em menor com vi–IV–I–V, inspirador em
// maior, tenso em menor com o V maior (a sensível pede resolução), etc.
const SCORES: Record<Mood, MoodScore> = {
  epico: { chords: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]], bpm: 72, arp: 1, padVol: 0.05, arpVol: 0.03, bassVol: 0.07 },
  inspirador: { chords: [[48, 52, 55], [55, 59, 62], [57, 60, 64], [53, 57, 60]], bpm: 96, arp: 1, padVol: 0.042, arpVol: 0.034, bassVol: 0.055 },
  atmosferico: { chords: [[50, 53, 57, 64], [46, 50, 53, 57], [53, 57, 60, 64], [48, 52, 55, 62]], bpm: 60, arp: 0, padVol: 0.055, arpVol: 0, bassVol: 0.045 },
  tenso: { chords: [[45, 48, 52], [45, 48, 52], [41, 45, 48], [40, 44, 47]], bpm: 84, arp: 2, padVol: 0.045, arpVol: 0.022, bassVol: 0.075 },
  documental: { chords: [[41, 45, 48], [50, 53, 57], [46, 50, 53], [48, 52, 55]], bpm: 72, arp: 0, padVol: 0.04, arpVol: 0, bassVol: 0.05 },
  publicitario: { chords: [[53, 57, 60], [48, 52, 55], [50, 53, 57], [46, 50, 53]], bpm: 112, arp: 2, padVol: 0.04, arpVol: 0.03, bassVol: 0.06 },
  tecnologico: { chords: [[52, 55, 59], [48, 52, 55], [55, 59, 62], [50, 54, 57]], bpm: 100, arp: 2, padVol: 0.038, arpVol: 0.03, bassVol: 0.058 },
}

export const MOOD_LABELS: Record<Mood, string> = {
  epico: 'épica',
  inspirador: 'inspiradora',
  atmosferico: 'atmosférica',
  tenso: 'tensa',
  documental: 'documental',
  publicitario: 'publicitária',
  tecnologico: 'tecnológica',
}

/** Acorde sustentado com dois osciladores levemente desafinados por nota (largura sem chiado). */
function padChord(buf: Float32Array, notes: number[], startS: number, endS: number, vol: number) {
  const i0 = Math.max(0, Math.round(startS * SR))
  const n = Math.max(0, Math.round((endS - startS) * SR))
  const dur = n / SR
  const freqs = notes.flatMap(m => [midi(m) * 0.9975, midi(m) * 1.0025])
  for (let k = 0; k < n && i0 + k < buf.length; k++) {
    const t = k / SR
    // Ataque e soltura longos: os acordes se cruzam em vez de cortar seco
    const env = Math.pow(Math.max(0, Math.min(1, t / 0.9, (dur - t) / 1.1)), 1.4)
    let s = 0
    for (const f of freqs) s += Math.sin(2 * Math.PI * f * t) + 0.18 * Math.sin(4 * Math.PI * f * t)
    buf[i0 + k] += (s / freqs.length) * env * vol
  }
}

/** Nota curta com decaimento — o arpejo. */
function pluck(buf: Float32Array, note: number, atS: number, vol: number) {
  const f = midi(note)
  const i0 = Math.round(atS * SR)
  const n = Math.round(0.55 * SR)
  for (let k = 0; k < n && i0 + k < buf.length; k++) {
    const t = k / SR
    const env = Math.exp(-t * 7) * Math.min(1, t / 0.004)
    buf[i0 + k] += (Math.sin(2 * Math.PI * f * t) + 0.35 * Math.sin(4 * Math.PI * f * t)) * env * vol
  }
}

/** Baixo: a fundamental uma oitava abaixo, pulsando no tempo. */
function bassNote(buf: Float32Array, note: number, atS: number, durS: number, vol: number) {
  const f = midi(note - 12)
  const i0 = Math.round(atS * SR)
  const n = Math.round(durS * SR)
  for (let k = 0; k < n && i0 + k < buf.length; k++) {
    const t = k / SR
    const env = Math.min(1, t / 0.02) * Math.exp(-t * 1.6)
    buf[i0 + k] += Math.sin(2 * Math.PI * f * t) * env * vol
  }
}

/**
 * Trilha alinhada às cenas: cada cena toca o próximo acorde da progressão
 * (cena longa troca na metade), e as transições ganham acentos.
 */
export function composeScore(mood: Mood, timings: SceneTiming[], duration: number, fps: number): Float32Array {
  const score = SCORES[mood]
  const music = new Float32Array(Math.ceil(duration * SR))
  const beat = 60 / score.bpm

  // Divide cenas longas em dois acordes: a harmonia não fica parada
  const blocos: Array<{ start: number; end: number }> = []
  for (const t of timings) {
    const dur = t.end - t.start
    if (dur > 7) {
      const meio = t.start + dur / 2
      blocos.push({ start: t.start, end: meio }, { start: meio, end: t.end })
    } else blocos.push({ start: t.start, end: t.end })
  }

  blocos.forEach((b, i) => {
    const chord = score.chords[i % score.chords.length]
    // Sobreposição de meio segundo dos dois lados: o acorde novo entra por baixo do anterior
    padChord(music, chord, Math.max(0, b.start - 0.5), Math.min(duration, b.end + 0.5), score.padVol)

    for (let t = b.start; t < b.end; t += beat * 2) bassNote(music, chord[0], t, beat * 2, score.bassVol)

    if (score.arp) {
      const passo = score.arp === 2 ? beat / 4 : beat / 2
      const notas = [...chord, chord[0] + 12]
      let k = 0
      for (let t = b.start; t < b.end - 0.1; t += passo) pluck(music, notas[k++ % notas.length] + 12, t, score.arpVol)
    }
  })

  // Acentos sobre a trilha, no tempo dos cortes
  const fx = new Track(duration, fps)
  fx.impact(Math.round(0.05 * fps), 0.2)
  for (let i = 1; i < timings.length; i++) fx.whoosh(Math.round(Math.max(0, timings[i].start - 0.25) * fps), 0.08, 0.45)
  // Clímax: a subida desemboca no último corte, e o impacto cai ali. Depois,
  // só a cauda da trilha, que esmaece até o fim (um impacto no último quadro
  // brigaria com o fade).
  const ultimoCorte = timings.length > 1 ? timings[timings.length - 1].start : 0
  if (ultimoCorte > 3) {
    fx.rise(Math.round(ultimoCorte * fps), 0.07, Math.min(1.8, ultimoCorte - 1))
    fx.impact(Math.round(ultimoCorte * fps), 0.18)
  }

  // Entrada e saída suaves da trilha inteira
  const fadeIn = Math.round(0.6 * SR)
  const fadeOut = Math.round(1.8 * SR)
  for (let k = 0; k < music.length; k++) {
    let g = 1
    if (k < fadeIn) g = k / fadeIn
    if (k > music.length - fadeOut) g = Math.min(g, (music.length - k) / fadeOut)
    music[k] = music[k] * g + (fx.buf[k] || 0)
  }
  return music
}

/**
 * Ducking: a música cede quando a voz fala. Seguidor de envelope em janelas de
 * 20 ms, ataque rápido e soltura lenta — sem "bombear" entre as palavras.
 */
export function duck(music: Float32Array, voice: Float32Array, depth = 0.72): Float32Array {
  const out = new Float32Array(music.length)
  const win = Math.round(0.02 * SR)
  const ataque = Math.exp(-1 / (0.03 * SR / win))
  const soltura = Math.exp(-1 / (0.45 * SR / win))
  let env = 0
  for (let i = 0; i < music.length; i += win) {
    let pico = 0
    for (let k = i; k < Math.min(i + win, voice.length); k++) pico = Math.max(pico, Math.abs(voice[k]))
    const alvo = pico > 0.02 ? 1 : 0
    env = alvo > env ? ataque * env + (1 - ataque) * alvo : soltura * env + (1 - soltura) * alvo
    const ganho = 1 - depth * env
    for (let k = i; k < Math.min(i + win, music.length); k++) out[k] = music[k] * ganho
  }
  return out
}

/** Voz posicionada no tempo de cada cena. */
export function placeVoice(duration: number, parts: Array<{ pcm: Float32Array; at: number }>): Float32Array {
  const out = new Float32Array(Math.ceil(duration * SR))
  for (const p of parts) {
    const off = Math.round(p.at * SR)
    for (let k = 0; k < p.pcm.length && off + k < out.length; k++) if (off + k >= 0) out[off + k] += p.pcm[k]
  }
  return out
}

/** Mixagem final: voz na frente, trilha por baixo e cedendo à voz. */
export function mixdown(duration: number, voice: Float32Array | null, music: Float32Array | null): Float32Array {
  const layers: Array<{ pcm: Float32Array; gain: number }> = []
  if (voice) layers.push({ pcm: voice, gain: 1 })
  if (music) layers.push({ pcm: voice ? duck(music, voice) : music, gain: voice ? 0.85 : 1 })
  return mix(duration, layers)
}
