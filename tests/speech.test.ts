import { describe, expect, it } from 'vitest'
import { generateSecMsGecV2 } from '@/lib/speech/edgeGec'
import { buildCues, toSrt, toVtt } from '@/lib/speech/transcribe'
import type { WordTime } from '@/lib/motion/audio'

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
