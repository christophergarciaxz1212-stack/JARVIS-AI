/**
 * Adaptador Playwright para o portal do estudante (SERVERSO / Ser Educacional).
 *
 * Desenho:
 *  - Janela chromium HEADED visível para VOCÊ entrar (login, MFA/SSO — nunca guardamos senha).
 *  - Sessão persistida em data/portal/chromium (cookies + localStorage entre sessões).
 *  - Captura de texto/tabelas de TODAS as frames same-origin da página aberta.
 *  - Reaproveita applyPortalCapture() para transformar o que foi capturado em
 *    disciplinas, notas, faltas, provas, trabalhos, avisos e calendário no Hub.
 */
import fs from 'fs'
import path from 'path'
import { chromium, type BrowserContext, type Page } from 'playwright'
import { dataDir } from '../agents/fsutil'
import { applyPortalCapture, type PortalCapture } from '../hub/portal'

const PROFILE_DIR = () => path.join(dataDir(), 'portal', 'chromium')

export type PortalStatus = 'idle' | 'opening' | 'window-open' | 'capturing' | 'error'

export interface PortalState {
  status: PortalStatus
  url?: string
  error?: string
  openedAt?: number
  loginDetected?: boolean
  lastCapture?: { url: string; title: string; at: number; courses: number; tasks: number; exams: number; materials: number; notices: number }
}

const g = globalThis as unknown as { __jarvisPortalPw?: { ctx?: BrowserContext; state: PortalState } }
const holder = () => (g.__jarvisPortalPw ||= { state: { status: 'idle' } })

export function portalState(): PortalState {
  return { ...holder().state }
}

function scrubError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, '[email]').slice(0, 400)
}

/** Abre a janela do portal (mesmo perfil persistido entre sessões). */
export async function openPortal(url: string) {
  const h = holder()
  if (h.ctx) {
    try {
      const pages = h.ctx.pages()
      if (pages.length) { await pages[0].bringToFront(); return { opened: false, url: pages[0].url() } }
    } catch {}
    try { await h.ctx.close() } catch {}
    h.ctx = undefined
  }
  try { fs.mkdirSync(PROFILE_DIR(), { recursive: true }) } catch {}
  h.state = { ...h.state, status: 'opening', error: undefined, url }
  try {
    const ctx = await chromium.launchPersistentContext(PROFILE_DIR(), {
      headless: false,
      channel: 'chromium',
      viewport: { width: 1200, height: 800 },
      // Isolamento de sites fica LIGADO: o usuário faz login nesta janela, e a captura só lê
      // frames da mesma origem (o Playwright alcança frames isolados sem desligar a proteção)
      timeout: 30_000,
    })
    h.ctx = ctx
    const page = ctx.pages()[0] || (await ctx.newPage())
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {})
    h.state = { ...h.state, status: 'window-open', openedAt: Date.now(), loginDetected: await detectLogin(page) }
    ctx.on('close', () => { holder().state = { ...holder().state, status: 'idle' }; holder().ctx = undefined })
    return { opened: true, url: page.url() }
  } catch (e) {
    h.state = { ...h.state, status: 'error', error: scrubError(e) }
    return { opened: false, error: h.state.error }
  }
}

async function detectLogin(page: Page): Promise<boolean> {
  try {
    const pw = page.locator('input[type="password"]:visible')
    return (await pw.count()) > 0
  } catch { return false }
}

/** Lê texto + tabelas de todas as frames same-origin da página aberta. */
async function extract(page: Page) {
  const frames = page.frames().filter(f => f === page.mainFrame() || sameOrigin(f.url(), page.url()))
  const texts: string[] = []
  const tables: string[][][] = []
  const links: Array<{ text: string; href: string }> = []
  for (const f of frames) {
    try {
      const t = await f.locator('body').innerText({ timeout: 5_000 }).catch(() => '')
      if (t) texts.push(t.slice(0, 14_000))
      const tableCount = await f.locator('table').count().catch(() => 0)
      for (let i = 0; i < Math.min(tableCount, 12); i++) {
        const rows = await f.locator('table').nth(i).locator('tr').all().catch(() => [] as never[])
        const table: string[][] = []
        for (const row of rows) {
          const cells = await row.locator('th,td').allInnerTexts().catch(() => [])
          if (cells.length) table.push(cells.map(c => String(c).replace(/\s+/g, ' ').trim()))
        }
        if (table.length) tables.push(table.slice(0, 60))
      }
      const anchors = await f.locator('a[href]').all().catch(() => [])
      for (const a of anchors.slice(0, 200)) {
        const [text, href] = await Promise.all([
          a.innerText().catch(() => ''),
          a.getAttribute('href').catch(() => null),
        ])
        const clean = String(text).replace(/\s+/g, ' ').trim()
        if (href && clean) links.push({ text: clean.slice(0, 120), href })
      }
    } catch {}
  }
  return { text: texts.join('\n\n'), tables, links }
}

function sameOrigin(a: string, base: string): boolean {
  try { return new URL(a).origin === new URL(base).origin } catch { return false }
}

/** Captura a página aberta e entrega ao organizador/intelligence do Hub. */
export async function captureNow(now = Date.now()) {
  const h = holder()
  const ctx = h.ctx
  if (!ctx) throw new Error('A janela do portal não está aberta. Clique em “Abrir portal” primeiro.')
  h.state = { ...h.state, status: 'capturing' }
  try {
    const pages = ctx.pages()
    if (!pages.length) throw new Error('Nenhuma página aberta na janela do portal.')
    const page = pages[0]
    const login = await detectLogin(page)
    const url = page.url()
    const title = (await page.title().catch(() => '')) || url
    const { text, tables, links } = await extract(page)
    const capture: PortalCapture = { url, title, text, tables, links, loginRequired: login }
    if (login) {
      h.state = { ...h.state, status: 'window-open', loginDetected: true, error: 'A página pede login — entre no portal na janela aberta e capture de novo.' }
      return { captured: false, loginRequired: true, url, title }
    }
    const r = await applyPortalCapture(capture, now)
    h.state = {
      ...h.state,
      status: 'window-open',
      loginDetected: false,
      error: undefined,
      lastCapture: { url, title, at: now, courses: r.summary.courses, tasks: r.summary.tasks, exams: r.summary.exams, materials: r.summary.materials, notices: r.summary.notices },
    }
    return { captured: true, loginRequired: false, url, title, ...r.summary }
  } catch (e) {
    h.state = { ...h.state, status: 'error', error: scrubError(e) }
    throw e
  }
}

export async function closePortal() {
  const h = holder()
  try { await h.ctx?.close() } catch {}
  h.ctx = undefined
  h.state = { ...h.state, status: 'idle' }
  return { status: 'idle' }
}
