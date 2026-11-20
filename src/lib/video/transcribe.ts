/**
 * Transcrição com timestamps por palavra (Groq Whisper — grátis, já usado pelo JARVIS)
 * e construtores de legenda (.srt / .vtt / legendas para o vídeo).
 * Usado quando a voz síntese não devolve os tempos das palavras (Gemini/Windows).
 * Falha de rede/chave → o chamador usa o alinhamento por energia (alignScript).
 */
import fs from 'fs'
import Groq from 'groq-sdk'
import type { WordTime } from '../motion/audio'

export interface TranscriptResult {
  text: string
  words: WordTime[]
}

const MODEL = 'whisper-large-v3-turbo'

/** Transcreve o arquivo de áudio com tempos por palavra. */
export async function transcribeWords(file: string, opts: { language?: string } = {}): Promise<TranscriptResult> {
  const key = process.env.GROQ_API_KEY
  if (!key) throw new Error('Sem chave do Groq (ative em Chaves de API) para gerar legendas palavra por palavra')
  const stat = fs.statSync(file)
  if (stat.size > 24 * 1024 * 1024) throw new Error('Áudio maior que 24 MB para transcrição')
  const groq = new Groq({ apiKey: key })
  const res = await groq.audio.transcriptions.create({
    file: fs.createReadStream(file),
    model: MODEL,
    response_format: 'verbose_json',
    timestamp_granularities: ['word'],
    language: opts.language || 'pt',
  } as Parameters<typeof groq.audio.transcriptions.create>[0])
  const words = Array.isArray((res as unknown as { words?: Array<{ word: string; start: number; end: number }> }).words)
    ? (res as unknown as { words: Array<{ word: string; start: number; end: number }> }).words
        .map(w => ({ word: String(w.word || '').trim(), start: Number(w.start) || 0, end: Number(w.end) || 0 }))
        .filter(w => w.word && Number.isFinite(w.start) && w.end > w.start)
    : []
  return { text: String((res as unknown as { text?: string }).text || ''), words }
}

const pad = (n: number, w = 2) => String(Math.floor(Math.abs(n))).padStart(w, '0')
const msPart = (t: number) => pad((t % 1) * 1000, 3)

/** HH:MM:SS,mmm (SRT) */
export function srtTime(t: number): string {
  const s = Math.max(0, t)
  return `${pad(s / 3600)}:${pad((s / 60) % 60)}:${pad(s % 60)},${msPart(s)}`
}

/** HH:MM:SS.mmm (VTT) */
export function vttTime(t: number): string {
  const s = Math.max(0, t)
  return `${pad(s / 3600)}:${pad((s / 60) % 60)}:${pad(s % 60)}.${msPart(s)}`
}

export interface Cue {
  start: number
  end: number
  text: string
  /** Índices das palavras de `words` usadas nesta deixa (para realce karaokê) */
  words: Array<{ word: string; start: number; end: number }>
}

/**
 * Agrupa as palavras em falas de 1 a 2 linhas (~9 palavras / ~42 caracteres),
 * respeitando pontuação. Cada cue é uma linha de legenda animada no vídeo.
 */
export function buildCues(words: WordTime[], opts: { maxWords?: number; maxChars?: number } = {}): Cue[] {
  const maxWords = opts.maxWords ?? 8
  const maxChars = opts.maxChars ?? 44
  const cues: Cue[] = []
  let cur: WordTime[] = []
  let chars = 0
  const flush = () => {
    if (!cur.length) return
    cues.push({
      start: cur[0].start,
      end: cur[cur.length - 1].end,
      text: cur.map(w => w.word).join(' '),
      words: [...cur],
    })
    cur = []
    chars = 0
  }
  for (const w of words) {
    if (cur.length && (cur.length >= maxWords || chars + w.word.length + 1 > maxChars || /[.!?…]$/.test(cur[cur.length - 1].word))) flush()
    cur.push({ ...w })
    chars += w.word.length + 1
  }
  flush()
  return cues
}

export function toSrt(cues: Cue[]): string {
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join('\n').trimEnd() + '\n'
}

export function toVtt(cues: Cue[]): string {
  return 'WEBVTT\n\n' + cues.map(c => `${vttTime(c.start)} --> ${vttTime(c.end)}\n${c.text}\n`).join('\n').trimEnd() + '\n'
}
