import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Browser, findBrowser } from '@/lib/motion/chrome'
import { buildPage, fallbackComposition, staticIssues } from '@/lib/motion/template'
import { openComposition, validate } from '@/lib/motion/render'
import type { Composition } from '@/lib/motion/types'

const size = { width: 1080, height: 1920, fps: 30, frames: 120 }
const scenes = [{ name: 'Abertura', start: 0, end: 1.5 }, { name: 'Meio', start: 1.5, end: 3 }, { name: 'Fecho', start: 3, end: 4 }]
const words = ['Este', 'é', 'o', 'JARVIS.', 'Seu', 'assistente', 'pessoal.'].map((word, i) => ({ word, start: 0.2 + i * 0.5, end: 0.6 + i * 0.5 }))

describe.runIf(!!findBrowser())('Motion: qualidade do quadro (Chrome real)', () => {
  let browser: Browser
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jv-quality-'))
  beforeAll(async () => { browser = await Browser.launch() }, 60_000)
  afterAll(async () => { await browser?.close() })

  const check = async (comp: Composition) => {
    const file = path.join(dir, `${Math.random().toString(36).slice(2)}.html`)
    fs.writeFileSync(file, buildPage(comp, { ...size, words }))
    const page = await openComposition(browser, file, size)
    try { return await validate(page, size) } finally { await page.send('Page.close').catch(() => {}) }
  }

  it('flags a near-blank video (the bug that shipped an empty MP4 as "Pronto")', async () => {
    // Same shape as the real failure: background + particles, a tiny logo text clipped at the top
    const blank: Composition = {
      title: 'x', scenes, sfx: [], html: '',
      css: '.bg{position:absolute;inset:0;background:#0b1324} .mark{position:absolute;top:-6px;left:50%;font-size:22px;letter-spacing:.3em}',
      js: `function renderFrame(n) { stage.innerHTML = '<div class="bg"></div>' + (n < 20 ? '<div class="mark">JARVIS</div>' : '') + '<i style="position:absolute;left:' + (100 + n) + 'px;top:300px;width:3px;height:3px;background:#22d3ee"></i>'; }`,
    }
    const v = await check(blank)
    expect(v.errors).toEqual([])
    expect(v.issues.join(' ')).toMatch(/Quadros quase vazios/)
  }, 60_000)

  it('the built-in fallback scene always renders visible content, synced with the narration', async () => {
    const comp = fallbackComposition({ title: 'JARVIS', scenes, captions: ['Seu assistente pessoal'], words, fps: size.fps, seconds: 4 })
    expect(staticIssues(comp.js)).toEqual([])
    const v = await check(comp)
    expect(v.errors).toEqual([])
    expect(v.issues.filter(i => /quase vazios|não executou|renderFrame/.test(i))).toEqual([])
    expect(comp.sfx[0]).toMatchObject({ frame: 0, type: 'impact' })
  }, 60_000)

  it('the fallback also works without narration (scene captions)', async () => {
    const comp = fallbackComposition({ title: 'Promo', scenes, captions: ['Organize suas provas', 'Lembretes no celular', 'Baixe agora'], words: [], fps: size.fps, seconds: 4 })
    const file = path.join(dir, 'nowords.html')
    fs.writeFileSync(file, buildPage(comp, { ...size, words: [] }))
    const page = await openComposition(browser, file, size)
    const texts = await page.eval(`[0, 60, 110].map(n => { window.renderFrame(n); return document.getElementById('fbl').textContent })`) as string[]
    await page.send('Page.close').catch(() => {})
    expect(texts).toEqual(['Organize suas provas', 'Lembretes no celular', 'Baixe agora'])
  }, 60_000)
})
