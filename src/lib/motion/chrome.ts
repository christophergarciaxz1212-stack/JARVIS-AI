import { spawn, type ChildProcess } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { Writable, Readable } from 'stream'

/** Chrome or Edge already installed on the PC (no download). */
export function findBrowser(): string | null {
  const env = process.env.CHROME_BIN
  const local = process.env.LOCALAPPDATA || ''
  const candidates = [
    env,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(local, 'Google\\Chrome\\Application\\chrome.exe'),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean) as string[]
  return candidates.find(c => fs.existsSync(c)) || null
}

type Pending = { res: (v: unknown) => void; rej: (e: Error) => void }

/**
 * Headless Chromium driven over --remote-debugging-pipe (the DevTools protocol on fds 3/4):
 * no WebSocket library and no open port.
 */
export class Browser {
  private proc: ChildProcess
  private out: Writable
  private id = 0
  private pending = new Map<number, Pending>()
  private buf = ''
  private profile: string
  private closed = false
  private exitError: Error | null = null

  private constructor(bin: string) {
    this.profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-motion-chrome-'))
    let stderr = ''
    this.proc = spawn(bin, [
      '--headless=new', '--remote-debugging-pipe', '--no-first-run', '--no-default-browser-check',
      '--hide-scrollbars', '--mute-audio', '--disable-extensions', '--disable-background-networking',
      '--force-device-scale-factor=1', '--allow-file-access-from-files', '--no-sandbox', '--disable-gpu',
      '--disable-dev-shm-usage', `--user-data-dir=${this.profile}`, 'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'], windowsHide: true })
    if (this.proc.stderr) {
      this.proc.stderr.on('data', (d: Buffer) => {
        stderr += d.toString('utf8')
      })
    }
    this.out = this.proc.stdio[3] as Writable
    const inp = this.proc.stdio[4] as Readable
    inp.on('data', (d: Buffer) => {
      this.buf += d.toString('utf8')
      let i: number
      while ((i = this.buf.indexOf('\0')) >= 0) {
        const raw = this.buf.slice(0, i)
        this.buf = this.buf.slice(i + 1)
        let m: { id?: number; error?: { message: string }; result?: unknown }
        try { m = JSON.parse(raw) } catch { continue }
        if (m.id && this.pending.has(m.id)) {
          const p = this.pending.get(m.id)!
          this.pending.delete(m.id)
          if (m.error) p.rej(new Error(m.error.message))
          else p.res(m.result)
        }
      }
    })
    this.proc.on('exit', code => {
      this.closed = true
      const errDetail = stderr.trim() ? `: ${stderr.trim().slice(0, 300)}` : ''
      this.exitError = new Error(`O navegador fechou (código ${code})${errDetail}`)
      for (const p of this.pending.values()) p.rej(this.exitError)
      this.pending.clear()
    })
    this.out.on('error', () => {})
  }

  static async launch(): Promise<Browser> {
    const bin = findBrowser()
    if (!bin) throw new Error('Instale o Google Chrome ou o Microsoft Edge para renderizar vídeos')
    const b = new Browser(bin)
    await b.send('Browser.getVersion')
    return b
  }

  send<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}, sessionId?: string, timeoutMs = 60_000): Promise<T> {
    if (this.closed) return Promise.reject(this.exitError || new Error('Navegador fechado'))
    return new Promise<T>((res, rej) => {
      const id = ++this.id
      const timer = setTimeout(() => { this.pending.delete(id); rej(new Error(`Tempo esgotado em ${method}`)) }, timeoutMs)
      this.pending.set(id, { res: v => { clearTimeout(timer); res(v as T) }, rej: e => { clearTimeout(timer); rej(e) } })
      this.out.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0')
    })
  }

  async newPage(url: string, width: number, height: number): Promise<Page> {
    // Own window per page: a background tab paints no frames and screenshots would hang
    const { targetId } = await this.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank', newWindow: true, background: false })
    const { sessionId } = await this.send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true })
    const page = new Page(this, sessionId)
    await page.send('Page.enable')
    await page.send('Runtime.enable')
    await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
    await page.goto(url)
    return page
  }

  async close() {
    if (!this.closed) {
      try { await this.send('Browser.close', {}, undefined, 5000) } catch {}
      if (!this.closed) this.proc.kill()
    }
    // Chrome may hold the profile for a moment after exit
    for (let i = 0; i < 10; i++) {
      try { fs.rmSync(this.profile, { recursive: true, force: true }); break } catch { await new Promise(r => setTimeout(r, 300)) }
    }
  }
}

export class Page {
  constructor(private browser: Browser, readonly sessionId: string) {}

  send<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}, timeoutMs?: number) {
    return this.browser.send<T>(method, params, this.sessionId, timeoutMs)
  }

  async goto(url: string) {
    await this.send('Page.navigate', { url })
    // Wait for load + fonts (render must never start before the page is ready)
    for (let i = 0; i < 100; i++) {
      const ready = await this.eval<string>('document.readyState').catch(() => '')
      if (ready === 'complete') break
      await new Promise(r => setTimeout(r, 100))
    }
    await this.eval('document.fonts ? document.fonts.ready.then(() => 1) : 1').catch(() => {})
  }

  /** Evaluates an expression (promises awaited); throws with the page's error message. */
  async eval<T = unknown>(expression: string, timeoutMs?: number): Promise<T> {
    const r = await this.send<{ result: { value?: T }; exceptionDetails?: { text: string; exception?: { description?: string } } }>(
      'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, timeoutMs,
    )
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description || r.exceptionDetails.text || 'Erro no script').split('\n').slice(0, 3).join(' '))
    return r.result.value as T
  }

  async screenshot(format: 'jpeg' | 'png' = 'jpeg', quality = 90): Promise<string> {
    const r = await this.send<{ data: string }>('Page.captureScreenshot', { format, ...(format === 'jpeg' ? { quality } : {}), captureBeyondViewport: false }, 30_000)
    return r.data
  }
}
