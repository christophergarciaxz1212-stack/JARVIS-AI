import { describe, expect, it } from 'vitest'
import { VIDEO_FORMATS, formatById, safeZoneHint } from '@/lib/video/formats'
import { generateSecMsGecV2 } from '@/lib/video/edgeGec'
import { buildCues, toSrt, toVtt } from '@/lib/video/transcribe'
import { assignWordsToScenes, sceneTimingsFromWords } from '@/lib/video/composition'
import { duck, silenceRatio } from '@/lib/video/audioMix'
import { clampVideoRequest } from '@/lib/video/produce'
import { setDirectorLlm, writeBrief, writeStoryboard } from '@/lib/video/director'
import { formatById as fmt } from '@/lib/video/formats'
import type { WordTime } from '@/lib/motion/audio'

describe('formatos de exportação', () => {
  it('cobre YouTube, Shorts/Reels/TikTok, feed 1:1 e 4:5', () => {
    const ids = VIDEO_FORMATS.map(f => f.id)
    expect(ids).toContain('youtube')
    expect(ids).toContain('shorts')
    expect(ids).toContain('square')
    expect(ids).toContain('feed')
    const yt = VIDEO_FORMATS.find(f => f.id === 'youtube')!
    expect(yt.width / yt.height).toBeCloseTo(16 / 9, 2)
    const shorts = VIDEO_FORMATS.find(f => f.id === 'shorts')!
    expect(shorts.width / shorts.height).toBeCloseTo(9 / 16, 2)
    expect(formatById('inexistente').id).toBe('youtube')
    expect(safeZoneHint(shorts)).toContain('legendas')
  })
})

describe('token Sec-MS-GEC (port do edge-tts)', () => {
  it('bate com a referência edge-tts 7.3.1', () => {
    expect(generateSecMsGecV2(1750000000)).toBe('B029A7426816F097-4579D112DC47FC3BF432B499C0A282F427C659474AF9BF5FA33CE2C003F9E9C2')
    expect(generateSecMsGecV2(1794879999)).toBe('CF2BF8EAA938F1D6-2CB25B75461E4D04A3B041C166B2869BFACDC6752077ADF6A8554CE835CA9EA8')
    expect(generateSecMsGecV2(1700000000.123)).toBe('2CD23A2CA0B2595A-F3C846C370E05F9CC83ACC5F995C5F5D87A4D0F14CE8936A0F902E64099E38A2')
  })
})

describe('legendas', () => {
  const words: WordTime[] = Array.from({ length: 17 }, (_, i) => ({
    word: i % 5 === 4 ? ['fim.', 'fim!', 'fim?', 'fim…', 'fim,'][i % 5] : `palavra${i}`,
    start: i * 0.4,
    end: i * 0.4 + 0.35,
  }))
  it('agrupa palavras em falas curtas e gera SRT e VTT válidos', () => {
    const cues = buildCues(words, { maxWords: 8, maxChars: 44 })
    expect(cues.length).toBeGreaterThan(1)
    for (const c of cues) {
      expect(c.text.length).toBeLessThanOrEqual(50)
      expect(c.end).toBeGreaterThan(c.start)
    }
    const srt = toSrt(cues)
    const vtt = toVtt(cues)
    expect(srt).toContain('-->')
    expect(srt.split('\n').length).toBeGreaterThan(4)
    expect(vtt.startsWith('WEBVTT')).toBe(true)
  })
})

describe('tempos das cenas pela narração', () => {
  const words: WordTime[] = [
    { word: 'um', start: 0.1, end: 0.4 }, { word: 'dois', start: 0.5, end: 0.8 },
    { word: 'três', start: 3.1, end: 3.4 }, { word: 'quatro', start: 3.5, end: 3.9 },
    { word: 'cinco', start: 6.2, end: 6.5 },
  ]
  it('distribui as palavras proporcionalmente entre as cenas', () => {
    const scenes = [{ vo: 'um dois', durationSec: 2 }, { vo: 'três quatro', durationSec: 2 }, { vo: 'cinco', durationSec: 2 }]
    const map = assignWordsToScenes(scenes, words)
    expect(map[0]).toBe(0)
    expect(map[map.length - 1]).toBe(2)
    const timings = sceneTimingsFromWords(scenes, words)
    expect(timings[0].startSec).toBe(0)
    // O silêncio entre falas estica a cena anterior (a imagem "segura" na pausa)
    expect(timings[1].startSec).toBeCloseTo(0.92, 1)
    expect(timings[2].startSec).toBeCloseTo(4.02, 1)
    expect(timings[timings.length - 1].endSec).toBeGreaterThan(6.5)
  })
})

describe('ducking e silêncio', () => {
  it('a trilha cede sob a narração e se recupera depois', () => {
    const SR = 48000
    const seconds = 2.4
    const music = new Float32Array(Math.floor(SR * seconds)).fill(0.4)
    const narration = new Float32Array(Math.floor(SR * seconds))
    // Narração só na metade central
    for (let i = SR * 0.8; i < SR * 1.6; i++) narration[i] = 0.5
    const out = duck(music, narration, { depth: 0.7, threshold: 0.05, releaseMs: 120 })
    const head = out.subarray(0, SR * 0.4)
    const mid = out.subarray(Math.floor(SR * 1.0), Math.floor(SR * 1.4))
    const tail = out.subarray(Math.floor(SR * 2.0))
    const mean = (a: Float32Array) => a.reduce((s, x) => s + Math.abs(x), 0) / a.length
    expect(mean(head)).toBeGreaterThan(mean(mid) * 2)
    expect(mean(tail)).toBeGreaterThan(mean(mid) * 1.5)
  })
  it('detecta silêncio total e narração audível', () => {
    expect(silenceRatio(new Float32Array(48000))).toBe(1)
    const loud = new Float32Array(48000).map((_, i) => Math.sin(i * 0.05) * 0.5)
    expect(silenceRatio(loud)).toBeLessThan(0.05)
  })
})

describe('requisição do vídeo', () => {
  it('aplica padrões e rejeita o que não serve', () => {
    expect(() => clampVideoRequest({})).toThrow('Descreva o vídeo')
    const r = clampVideoRequest({ prompt: 'teste', seconds: 999, fps: 60, narration: 'auto' })
    expect(r.formatId).toBe('youtube')
    expect(r.seconds).toBe(90)
    expect(r.fps).toBe(60)
    expect(r.voice.provider).toBe('edge')
    expect(clampVideoRequest({ prompt: 'x', formatId: 'shorts' }).formatId).toBe('shorts')
  })
})

describe('diretor de IA com modelo falso', () => {
  it('cai para o briefing de reserva quando o modelo devolve lixo', async () => {
    setDirectorLlm(async () => ({ text: 'isto não é JSON', model: 'falso', latencyMs: 1, usage: { inputTokens: 10, outputTokens: 5 } }))
    const { brief } = await writeBrief('um vídeo sobre oceanos', fmt('youtube'), 15)
    expect(brief.title.length).toBeGreaterThan(0)
    expect(brief.musicMood).toBeTruthy()
    setDirectorLlm(async () => ({ text: JSON.stringify({ title: 'Farol', scenes: [
      { name: 'abertura', vo: 'A luz do farol corta a escuridão.', visual: 'lighthouse beam cutting through storm night, cinematic photoreal photography', camera: 'zoom-in', transition: 'zoom', sfx: ['impact'], durationSec: 5 },
      { name: 'fecho', vo: 'Assista até o fim.', visual: 'sunrise over calm sea, lighthouse silhouette, cinematic photoreal photography', camera: 'zoom-out', transition: 'fade', sfx: ['shimmer'], durationSec: 5 },
    ] }), model: 'falso', latencyMs: 1, usage: { inputTokens: 10, outputTokens: 5 } }))
    const { storyboard } = await writeStoryboard('vídeo sobre faróis', { ...brief, title: 'Farol' }, fmt('youtube'), 10)
    expect(storyboard.scenes.length).toBe(2)
    expect(storyboard.scenes[0].camera).toBe('zoom-in')
    const total = storyboard.scenes.reduce((s, x) => s + x.durationSec, 0)
    expect(Math.abs(total - 10)).toBeLessThan(2)
  })
})
