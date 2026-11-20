// Verificação da camada de movimento com mouse de verdade (Chrome headless via CDP, sem dependências).
// Uso: node scripts/audit/motion-check.mjs http://127.0.0.1:3004/ .tmp/motion
// Chrome: CHROME_PATH ou o caminho padrão do Windows. Imprime um JSON com cada verificação e salva capturas.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const [, , url, outDir] = process.argv
fs.mkdirSync(outDir, { recursive: true })
const chrome = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const port = 9341
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jv-cdp-'))
const proc = spawn(chrome, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1500,900', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' })
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = {}

async function getJson(p) {
  for (let i = 0; i < 60; i++) {
    try { return await (await fetch(`http://127.0.0.1:${port}${p}`)).json() } catch { await sleep(250) }
  }
  throw new Error('CDP não respondeu')
}

try {
  const page = (await getJson('/json/list')).find(t => t.type === 'page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise(r => ws.addEventListener('open', r, { once: true }))
  let seq = 0
  const pending = new Map()
  const consoleErrors = []
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
    if (m.method === 'Runtime.exceptionThrown') consoleErrors.push(m.params.exceptionDetails?.exception?.description?.slice(0, 300))
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push(m.params.args.map(a => a.value || a.description).join(' ').slice(0, 300))
  })
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++seq
    pending.set(i, m => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)))
    ws.send(JSON.stringify({ id: i, method, params }))
  })
  const evaluate = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 600))
    return r.result.value
  }
  const shot = async (name, clip) => {
    const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) })
    fs.writeFileSync(path.join(outDir, name), Buffer.from(r.data, 'base64'))
  }
  const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: type === 'mouseMoved' ? 0 : 1, ...extra })
  const rectOf = sel => evaluate(`(() => { const el = ${sel}; if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height } })()`)
  const pad = (r, p = 24) => ({ x: Math.max(0, r.x - p), y: Math.max(0, r.y - p), width: r.w + 2 * p, height: r.h + 2 * p })

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 900, deviceScaleFactor: 1, mobile: false })
  // O assistente de primeira execução cobre a tela num perfil novo: marcado como pulado antes de carregar
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('jarvis.firstRunSkipped', '1') } catch (e) {}` })
  await send('Page.navigate', { url })
  await sleep(12000)
  results.cover = await evaluate(`(() => { const b = document.querySelector('nav[aria-label="Navegação"] button[title^="Configurações"]'); const q = b.getBoundingClientRect(); const hit = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2); return b.contains(hit) ? 'livre' : String(hit && hit.className).slice(0, 80) })()`)

  results.base = await evaluate(`(() => {
    const root = getComputedStyle(document.documentElement)
    const btn = [...document.querySelectorAll('button')].find(b => b.offsetWidth > 60 && !b.disabled && b.closest('.ui-root'))
    const cs = btn && getComputedStyle(btn)
    return {
      moEase: root.getPropertyValue('--mo-ease').trim(),
      buttons: document.querySelectorAll('button').length,
      transitionProperty: cs && cs.transitionProperty,
      transitionDuration: cs && cs.transitionDuration,
      stagger: document.querySelectorAll('.mo-stagger').length,
      spots: document.querySelectorAll('.mo-spot').length,
      motion: document.documentElement.dataset.motion || null,
    }
  })()`)
  await shot('01-home.png')

  // Hover: botão de Ajustes do trilho (ícone de engrenagem gira)
  const gear = await rectOf(`document.querySelector('nav[aria-label="Navegação"] button[title^="Configurações"]')`)
  if (gear) {
    await mouse('mouseMoved', gear.x + gear.w / 2, gear.y + gear.h / 2)
    await sleep(450)
    results.hoverGear = await evaluate(`(() => { const b = document.querySelector('nav[aria-label="Navegação"] button[title^="Configurações"]'); const s = b.querySelector('svg'); return { btnTranslate: getComputedStyle(b).translate, iconRotate: getComputedStyle(s).rotate, iconScale: getComputedStyle(s).scale } })()`)
    await shot('02-hover-gear.png', pad(gear))
  }

  // Clique com onda: botão "Conecte uma IA"/primeiro cartão de dicas, senão o botão de chaves do trilho
  const target = `(document.querySelector('.mo-stagger .mo-spot') || document.querySelector('nav[aria-label="Navegação"] button[title="Chaves de API"]'))`
  const tr = await rectOf(target)
  if (tr) {
    const px = tr.x + tr.w * 0.3
    const py = tr.y + tr.h * 0.6
    await mouse('mouseMoved', px, py)
    await sleep(250)
    results.spot = await evaluate(`(() => { const el = ${target}; return { mx: el.style.getPropertyValue('--mx'), my: el.style.getPropertyValue('--my') } })()`)
    await mouse('mousePressed', px, py)
    await sleep(140)
    results.press = await evaluate(`(() => { const el = ${target}; document.getAnimations().forEach(a => a.pause()); return { hosts: el.querySelectorAll('.mo-ripple-host').length, press: el.style.getPropertyValue('--mo-press'), scale: getComputedStyle(el).scale, position: el.style.position } })()`)
    await shot('03-ripple.png', pad(tr, 30))
    await evaluate(`document.getAnimations().forEach(a => a.play())`)
    // Solta fora do botão para não abrir nada
    await mouse('mouseMoved', 5, 5)
    await mouse('mouseReleased', 5, 5)
    await sleep(1200)
    results.afterRipple = await evaluate(`(() => { const el = ${target}; return { hosts: el.querySelectorAll('.mo-ripple-host').length, position: el.style.position } })()`)
  }

  // Aba "Memória" da barra lateral: pílula desliza
  const tab = await rectOf(`[...document.querySelectorAll('[role=tablist] [role=tab]')].find(b => /Memória/.test(b.textContent))`)
  if (tab) {
    await mouse('mouseMoved', tab.x + tab.w / 2, tab.y + tab.h / 2)
    await mouse('mousePressed', tab.x + tab.w / 2, tab.y + tab.h / 2)
    await mouse('mouseReleased', tab.x + tab.w / 2, tab.y + tab.h / 2)
    await sleep(70)
    await evaluate(`document.getAnimations().forEach(a => a.pause())`)
    await shot('04-tab-slide.png', { x: Math.max(0, tab.x - tab.w - 30), y: tab.y - 20, width: tab.w * 2 + 60, height: tab.h + 40 })
    await evaluate(`document.getAnimations().forEach(a => a.play())`)
    await sleep(800)
    results.tab = await evaluate(`(() => { const pill = document.querySelector('[role=tablist] [aria-selected=true] span.absolute'); return { selected: document.querySelector('[role=tablist] [aria-selected=true]')?.textContent?.trim(), pill: !!pill } })()`)
    await shot('05-tab-done.png', { x: Math.max(0, tab.x - tab.w - 30), y: tab.y - 20, width: tab.w * 2 + 60, height: 260 })
  }

  // Modal: Ajustes (mo-backdrop + modal-pop)
  if (gear) {
    await mouse('mouseMoved', gear.x + gear.w / 2, gear.y + gear.h / 2)
    await mouse('mousePressed', gear.x + gear.w / 2, gear.y + gear.h / 2)
    await mouse('mouseReleased', gear.x + gear.w / 2, gear.y + gear.h / 2)
    await sleep(110)
    results.modal = await evaluate(`(() => { const names = document.getAnimations().map(a => a.animationName || a.constructor.name); document.getAnimations().forEach(a => a.pause()); return { animations: [...new Set(names)].slice(0, 20), backdrop: !!document.querySelector('.mo-backdrop'), pop: !!document.querySelector('.modal-pop') } })()`)
    await shot('06-modal-mid.png')
    await evaluate(`document.getAnimations().forEach(a => a.play())`)
    await sleep(900)
    results.modalDone = await evaluate(`(() => { const p = document.querySelector('.modal-pop'); const cs = p && getComputedStyle(p); return { filter: cs && cs.filter, transform: cs && cs.transform, opacity: cs && cs.opacity } })()`)
    await shot('07-modal-done.png')
  }

  // Preferência "Reduzido": sem deslocamento nem onda
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await sleep(500)
  await evaluate(`document.documentElement.dataset.motion = 'reduced'`)
  const keys = await rectOf(`document.querySelector('nav[aria-label="Navegação"] button[title="Chaves de API"]')`)
  if (keys) {
    await mouse('mouseMoved', keys.x + keys.w / 2, keys.y + keys.h / 2)
    await sleep(400)
    await mouse('mousePressed', keys.x + keys.w / 2, keys.y + keys.h / 2)
    await sleep(120)
    results.reduced = await evaluate(`(() => { const b = document.querySelector('nav[aria-label="Navegação"] button[title="Chaves de API"]'); return { translate: getComputedStyle(b).translate, scale: getComputedStyle(b).scale, hosts: b.querySelectorAll('.mo-ripple-host').length, iconRotate: getComputedStyle(b.querySelector('svg')).rotate } })()`)
    await mouse('mouseMoved', 5, 5)
    await mouse('mouseReleased', 5, 5)
  }
  await evaluate(`document.documentElement.dataset.motion = 'full'`)
  await sleep(300)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await sleep(400)
  results.heroAnim = await evaluate(`(() => { const h = document.querySelector('.hero-atom'); if (!h) return null; const cs = getComputedStyle(h); return { animationName: cs.animationName, boxShadow: cs.boxShadow } })()`)
  await shot('08-home-after.png', { x: 600, y: 60, width: 620, height: 300 })

  results.consoleErrors = consoleErrors.slice(0, 15)
  console.log(JSON.stringify(results, null, 2))
  ws.close()
} catch (e) {
  console.log(JSON.stringify(results, null, 2))
  console.error('FALHA:', e.message)
} finally {
  proc.kill()
  await sleep(500)
  try { fs.rmSync(profile, { recursive: true, force: true }) } catch {}
}
