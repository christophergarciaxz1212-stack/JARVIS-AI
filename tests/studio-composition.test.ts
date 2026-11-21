import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Jimp } from 'jimp'
import { Browser, findBrowser } from '@/lib/motion/chrome'
import { openComposition, renderVideo } from '@/lib/motion/render'
import { buildComposition, type CompositionInput } from '@/lib/studio/composition'

const temChrome = !!findBrowser()
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-studio-comp-'))

/** Imagem de teste com gradiente e grade: dá para ver movimento entre quadros. */
async function imagemTeste(w: number, h: number, cor: [number, number, number]): Promise<string> {
  const img = new Jimp({ width: w, height: h, color: 0x000000ff })
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const grade = (x % 80 < 4 || y % 80 < 4) ? 1 : 0
    const r = Math.min(255, cor[0] * (x / w) + grade * 200)
    const g = Math.min(255, cor[1] * (y / h) + grade * 200)
    const b = Math.min(255, cor[2] + grade * 200)
    img.setPixelColor(((r & 255) << 24 | (g & 255) << 16 | (b & 255) << 8 | 255) >>> 0, x, y)
  }
  const buf = await img.getBuffer('image/jpeg')
  return `data:image/jpeg;base64,${buf.toString('base64')}`
}

let browser: Browser
let entrada: CompositionInput

beforeAll(async () => {
  if (!temChrome) return
  browser = await Browser.launch()
  entrada = {
    width: 640, height: 360, fps: 24, duration: 7,
    plan: { title: 'Teste do Estúdio', palette: ['#0b0b0f', '#f5f5f5', '#ffffff'], font: 'sans', cta: 'Fim do teste' },
    scenes: [
      { image: await imagemTeste(800, 450, [255, 60, 40]), camera: 'zoom-in', transition: 'fade', onScreen: 'Primeira cena', fit: 'cover' },
      // Imagem quadrada num vídeo 16:9: o primeiro plano encaixa, o fundo preenche
      { image: await imagemTeste(500, 500, [40, 200, 255]), camera: 'parallax', transition: 'zoom', onScreen: 'Segunda', fit: 'contain' },
      { image: await imagemTeste(800, 450, [60, 255, 90]), camera: 'pan-left', transition: 'slide', fit: 'cover' },
    ],
    timings: [{ scene: 0, start: 0, end: 2.5 }, { scene: 1, start: 2.5, end: 4.5 }, { scene: 2, start: 4.5, end: 7 }],
    cues: [
      { start: 0.7, end: 2.0, words: [{ word: 'olá', start: 0.7, end: 1.2 }, { word: 'mundo', start: 1.2, end: 2.0 }] },
      { start: 2.8, end: 4.0, words: [{ word: 'segunda', start: 2.8, end: 3.4 }, { word: 'parte', start: 3.4, end: 4.0 }] },
    ],
    endCardFrom: 5.8,
  }
}, 60_000)

afterAll(async () => { await browser?.close().catch(() => {}) })

/** Fração de pixels que mudaram entre dois quadros (JPEG base64). */
async function diferenca(a: string, b: string): Promise<number> {
  const [ia, ib] = await Promise.all([Jimp.read(Buffer.from(a, 'base64')), Jimp.read(Buffer.from(b, 'base64'))])
  let mudou = 0
  const total = ia.bitmap.width * ia.bitmap.height
  for (let i = 0; i < ia.bitmap.data.length; i += 4) {
    const d = Math.abs(ia.bitmap.data[i] - ib.bitmap.data[i]) + Math.abs(ia.bitmap.data[i + 1] - ib.bitmap.data[i + 1]) + Math.abs(ia.bitmap.data[i + 2] - ib.bitmap.data[i + 2])
    if (d > 30) mudou++
  }
  return mudou / total
}

async function brilhoMedio(b64: string): Promise<number> {
  const img = await Jimp.read(Buffer.from(b64, 'base64'))
  let s = 0
  for (let i = 0; i < img.bitmap.data.length; i += 4) s += (img.bitmap.data[i] + img.bitmap.data[i + 1] + img.bitmap.data[i + 2]) / 3
  return s / (img.bitmap.data.length / 4)
}

describe.skipIf(!temChrome)('composição renderizada num Chrome de verdade', () => {
  it('abre, carrega as imagens e renderiza quadros sem erro', async () => {
    const file = path.join(dir, 'comp.html')
    fs.writeFileSync(file, buildComposition(entrada))
    const size = { width: 640, height: 360, fps: 24, frames: 7 * 24 }
    const page = await openComposition(browser, file, size)
    expect(await page.eval('window.ready')).toBe(1)

    const shots: string[] = []
    for (const n of [0, 12, 30, 66, 72, 84, 130, 160]) {
      expect(await page.eval(`window.renderFrame(${n})`)).toBe(n)
      shots.push(await page.screenshot('jpeg', 85))
    }

    // Nenhum quadro preto
    for (const s of shots) expect(await brilhoMedio(s)).toBeGreaterThan(8)
    // Há movimento dentro de uma mesma cena (câmera andando)
    expect(await diferenca(shots[1], shots[2])).toBeGreaterThan(0.05)
    // A troca de cena muda a imagem de verdade
    expect(await diferenca(shots[2], shots[5])).toBeGreaterThan(0.2)
  }, 120_000)

  it('o mesmo quadro sai igual duas vezes (render determinístico)', async () => {
    const file = path.join(dir, 'comp2.html')
    fs.writeFileSync(file, buildComposition(entrada))
    const page = await openComposition(browser, file, { width: 640, height: 360, fps: 24, frames: 168 })
    await page.eval('window.ready')
    await page.eval('window.renderFrame(50)')
    const a = await page.screenshot('jpeg', 90)
    await page.eval('window.renderFrame(120)')
    await page.eval('window.renderFrame(50)')
    const b = await page.screenshot('jpeg', 90)
    expect(await diferenca(a, b)).toBeLessThan(0.01)
  }, 120_000)

  it('texto do usuário com tags não quebra a página', async () => {
    const malicioso = { ...entrada, plan: { ...entrada.plan, title: '</script><b>oi</b>' }, scenes: entrada.scenes.map(s => ({ ...s, onScreen: '<img src=x onerror=alert(1)>' })) }
    const file = path.join(dir, 'comp3.html')
    fs.writeFileSync(file, buildComposition(malicioso))
    const page = await openComposition(browser, file, { width: 640, height: 360, fps: 24, frames: 168 })
    await page.eval('window.ready')
    expect(await page.eval('window.renderFrame(40)')).toBe(40)
    // O título aparece como TEXTO, não como HTML
    expect(await page.eval(`document.querySelector('#titulo h1').textContent`)).toBe('</script><b>oi</b>')
  }, 120_000)

  it('gera um MP4 válido de verdade', async () => {
    const file = path.join(dir, 'comp4.html')
    fs.writeFileSync(file, buildComposition({ ...entrada, duration: 3, timings: entrada.timings.map(t => ({ ...t, start: t.start * 3 / 7, end: t.end * 3 / 7 })), endCardFrom: undefined }))
    const size = { width: 640, height: 360, fps: 24, frames: 72 }
    const page = await openComposition(browser, file, size)
    await page.eval('window.ready')
    const out = path.join(dir, 'teste.mp4')
    const audio = new Float32Array(48000 * 3).map((_, i) => 0.1 * Math.sin(i / 20))
    const r = await renderVideo(browser, page, size, audio, out, () => {})
    const buf = fs.readFileSync(out)
    expect(r.bytes).toBeGreaterThan(10_000)
    // Caixa "ftyp" no começo: é um MP4 de verdade
    expect(buf.subarray(4, 8).toString('ascii')).toBe('ftyp')
    expect(r.codecs.video).toMatch(/avc|h264/i)
  }, 180_000)
})
