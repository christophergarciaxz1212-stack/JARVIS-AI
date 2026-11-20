import fs from 'fs'
import os from 'os'
import path from 'path'
import { getPrefs, type Prefs } from '../prefs'
import { alignScript, readWav, speechSegments, synthesize, type WordTime } from '../motion/audio'
import { GEMINI_VOICES, speak } from './gemini'
import { synthesize as synthesizePiper, PORTUGUESE_VOICES } from './piper'
import { pcmToWav } from './gemini'

export type VoicePrefs = Prefs['voice']

export interface SpeechResult { wav: Buffer; provider: string; note?: string }

const describe = (p: VoicePrefs) => {
  const v = GEMINI_VOICES.find(x => x.id === p.voice)
  return `Gemini · ${p.voice}${v ? ` (${v.style.toLowerCase()})` : ''}`
}

/** Speech for the chat/preview: the chosen Gemini voice, the Windows voice as fallback. */
export async function speakText(text: string, override: Partial<VoicePrefs> = {}, signal?: AbortSignal): Promise<SpeechResult> {
  const p = { ...getPrefs().voice, ...override }
  let note: string | undefined
  if (p.provider === 'gemini') {
    try {
      const r = await speak(text, { model: p.model, voice: p.voice, style: p.style, signal })
      return { wav: r.wav, provider: describe(p) }
    } catch (e) {
      if (signal?.aborted) throw e
      note = (e as Error).message
    }
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-say-'))
  try {
    const wav = path.join(dir, 'fala.wav')
    await synthesize(text, wav)
    return { wav: fs.readFileSync(wav), provider: 'Voz do Windows', note }
  } catch (e) {
    throw new Error(note ? `${note} — e a voz do Windows também falhou: ${(e as Error).message}` : (e as Error).message)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * Video narration. Gemini voices have no word timestamps, so words are spread over the
 * detected speech (the same alignment used for the user's own recordings).
 * When no voice works it returns ok:false and the video is still produced, without narration.
 */
export type NarrationResult = { ok: true; words: WordTime[]; provider: string; note?: string } | { ok: false; note: string }

export async function narrate(text: string, outWav: string, signal?: AbortSignal, override?: Partial<VoicePrefs>): Promise<NarrationResult> {
  // A voz escolhida num pedido (ex.: no Estúdio de Vídeo) vence a das Configurações
  const p = { ...getPrefs().voice, ...(override || {}) } as VoicePrefs
  let note: string | undefined

  // 1° tentativa: Gemini (via config de prefs)
  if (p.provider === 'gemini') {
    try {
      const r = await speak(text, { model: p.model, voice: p.voice, style: p.style, signal })
      fs.mkdirSync(path.dirname(outWav), { recursive: true })
      fs.writeFileSync(outWav, r.wav)
      fs.writeFileSync(path.join(path.dirname(outWav), 'narracao.txt'), text, 'utf-8')
      const words = alignScript(text, speechSegments(readWav(outWav)))
      return { ok: true, words, provider: describe(p) }
    } catch (e) {
      if (signal?.aborted) throw e
      note = (e as Error).message
    }
  }

  // 2° tentativa: Windows (via SAPI5)
  try {
    const words = await synthesize(text, outWav)
    return { ok: true, words, provider: 'Voz do Windows', note }
  } catch (e) {
    note = [note, `voz do Windows: ${(e as Error).message}`].filter(Boolean).join(' · ')
  }

  // 3° tentativa: Piper (open source, offline, pt-BR)
  try {
    // O PORTUGUESE_VOICES é um ReadonlyArray; usamos filter + findIndex ou um cast simples
    const voiceChoice: { id: string; name: string } = (PORTUGUESE_VOICES.find((v) => v.id === p.voice) as any) || PORTUGUESE_VOICES[0] as any
    const { pcm, rate, seconds } = await synthesizePiper(text, voiceChoice.id)
    const wav = pcmToWav(pcm, rate)
    fs.mkdirSync(path.dirname(outWav), { recursive: true })
    fs.writeFileSync(outWav, wav)
    fs.writeFileSync(path.join(path.dirname(outWav), 'narracao.txt'), text, 'utf-8')
    const words = alignScript(text, speechSegments(readWav(outWav)))
    return { ok: true, words, provider: `Piper · ${voiceChoice.name}` }
  } catch (e) {
    note = [note, `Piper: ${(e as Error).message}`].filter(Boolean).join(' · ')
  }

  // Se tudo falhou
  return { ok: false, note: note || 'Nenhum provedor de TTS funcionou' }
}
