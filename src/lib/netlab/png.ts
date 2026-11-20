import fs from 'fs'
import os from 'os'
import path from 'path'
import { Browser, findBrowser } from '../motion/chrome'
import { topologySvg } from './svg'
import { netlabDir } from './store'
import type { Topology } from './types'

/** Rasterizes the diagram with the same headless Chrome used for videos (crisp text, real fonts). */
export async function topologyPng(t: Topology, scale = 1.5): Promise<string> {
  if (!findBrowser()) throw new Error('Instale o Google Chrome ou o Microsoft Edge para exportar imagens')
  const svg = topologySvg(t)
  const w = Number(svg.match(/width="(\d+(?:\.\d+)?)"/)?.[1] || 1200)
  const h = Number(svg.match(/height="(\d+(?:\.\d+)?)"/)?.[1] || 800)
  const vw = Math.min(4000, Math.round(w * scale))
  const vh = Math.min(4000, Math.round(h * scale))
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-netlab-'))
  const html = path.join(dir, 'diagram.html')
  fs.writeFileSync(html, `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}svg{display:block;width:${vw}px;height:${vh}px}</style></head><body>${svg}</body></html>`)
  const browser = await Browser.launch()
  try {
    const page = await browser.newPage('about:blank', vw, vh)
    await page.goto(`file:///${html.replace(/\\/g, '/')}`)
    const data = Buffer.from(await page.screenshot('png'), 'base64')
    const out = path.join(netlabDir(), `${t.id}.png`)
    fs.mkdirSync(netlabDir(), { recursive: true })
    fs.writeFileSync(out, data)
    return out
  } finally {
    await browser.close().catch(() => {})
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
