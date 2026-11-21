/**
 * Linha do tempo do vídeo: quando cada cena começa e termina, onde cada fala
 * entra e onde cada palavra cai — tudo derivado da narração REAL.
 *
 * Cada cena é narrada separadamente, então a duração dela vem do tempo que a
 * voz levou para falar, não de um palpite. A legenda bate com a fala porque as
 * palavras carregam o tempo devolvido pelo próprio serviço de voz.
 *
 * Puro (sem imports de Node): testável.
 */
import type { SceneTiming } from './types'

export interface WordTime { word: string; start: number; end: number }

export interface SceneSpeech {
  /** Duração da fala desta cena, em segundos. 0 = cena sem narração. */
  speech: number
  /** Palavras com tempo relativo ao início da fala desta cena. */
  words: WordTime[]
}

export interface Timeline {
  timings: SceneTiming[]
  /** Todas as palavras, já em tempo absoluto do vídeo. */
  words: WordTime[]
  /** Onde a fala de cada cena começa no vídeo (para posicionar o áudio). */
  speechAt: number[]
  duration: number
  /** Duração do cartão final, se houver. */
  endCardFrom?: number
}

/** Respiro antes da primeira fala: o título aparece sozinho por um instante. */
export const LEAD_IN = 0.7
/** Pausa entre a fala de uma cena e a da seguinte. */
export const GAP = 0.45
/** Cena mais curta aceitável: menos que isso vira piscada. */
export const MIN_SCENE = 2.8
/** Quanto a duração de uma cena pode ser esticada para chegar à duração pedida. */
const MAX_STRETCH = 2.5
/** Cartão final com a chamada. */
export const END_CARD = 2.6

/**
 * Monta a linha do tempo.
 *
 * Se a fala ficou mais curta que a duração pedida, distribui o que falta entre
 * as cenas — até um limite, para não esticar cena até ficar parada. Se ficou
 * mais longa, a fala manda: cortar fala para caber seria pior.
 */
export function buildTimeline(scenes: SceneSpeech[], opts: { target: number; endCard?: boolean; narrated?: boolean }): Timeline {
  const n = scenes.length
  if (!n) return { timings: [], words: [], speechAt: [], duration: 0 }

  const narrated = opts.narrated !== false && scenes.some(s => s.speech > 0)
  const fim = opts.endCard ? END_CARD : 0

  // Sem narração: divide o tempo pedido igualmente
  if (!narrated) {
    const each = Math.max(MIN_SCENE, (opts.target - fim) / n)
    const timings = scenes.map((_, i) => ({ scene: i, start: i * each, end: (i + 1) * each }))
    const last = timings[n - 1].end
    if (fim) timings[n - 1].end = last + fim
    return { timings, words: [], speechAt: scenes.map((_, i) => i * each), duration: last + fim, endCardFrom: fim ? last : undefined }
  }

  // Duração base de cada cena: a fala + o respiro até a próxima
  const base = scenes.map((s, i) => {
    const lead = i === 0 ? LEAD_IN : 0
    return Math.max(MIN_SCENE, lead + s.speech + GAP)
  })
  const total = base.reduce((a, b) => a + b, 0) + fim

  // Faltou tempo: espalha, sem passar do limite por cena
  const falta = opts.target - total
  const extra = falta > 0 ? Math.min(MAX_STRETCH, falta / n) : 0

  const timings: SceneTiming[] = []
  const speechAt: number[] = []
  const words: WordTime[] = []
  let t = 0
  for (let i = 0; i < n; i++) {
    const dur = base[i] + extra
    const lead = i === 0 ? LEAD_IN : 0
    // A fala fica no começo da cena; o tempo esticado vira respiro no fim
    const falaEm = t + lead
    speechAt.push(falaEm)
    for (const w of scenes[i].words) words.push({ word: w.word, start: falaEm + w.start, end: falaEm + w.end })
    timings.push({ scene: i, start: t, end: t + dur })
    t += dur
  }
  if (fim) timings[n - 1].end = t + fim

  return { timings, words, speechAt, duration: t + fim, endCardFrom: fim ? t : undefined }
}

/** Cena visível no instante `t` (a de maior índice que já começou). */
export function sceneAt(timings: SceneTiming[], t: number): number {
  let idx = 0
  for (let i = 0; i < timings.length; i++) if (timings[i].start <= t) idx = i
  return idx
}
