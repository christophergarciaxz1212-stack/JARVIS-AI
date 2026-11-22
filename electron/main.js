const { app, BrowserWindow, Menu, Tray, shell, nativeTheme, ipcMain, dialog, Notification, screen } = require('electron')
const { spawn } = require('child_process')
const http = require('http')
const path = require('path')
const fs = require('fs')

// Neste ambiente o Chromium não consegue iniciar o sandbox (STATUS_BREAKPOINT 0x80000003);
// o launcher do usuário e o `npm run app` já usam --no-sandbox, então o empacotado também usa.
app.commandLine.appendSwitch('no-sandbox')

const HOST = '127.0.0.1'

// Pick the first free port from 3001 upward so a stale process never blocks JARVIS.
// net.listen é assíncrono (nunca lança na hora), então a checagem roda num processo filho
// síncrono: antes, a função sempre devolvia 3001 e o app abria num servidor velho (tela preta).
function findFreePort(startPort) {
  const script = `const net=require('net');const h=${JSON.stringify(HOST)};let p=${startPort};` +
    `(function t(){if(p>=${startPort + 20}){process.exit(0)}` +
    `const s=net.createServer();s.once('error',()=>{p++;t()});s.once('listening',()=>s.close(()=>process.exit(p-${startPort}+1)));s.listen(p,h)})()`
  try {
    const r = require('child_process').spawnSync(process.execPath, ['-e', script], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 5000, windowsHide: true,
    })
    // A porta volta no código de saída (1 = startPort, 2 = startPort+1…): stdout de um app GUI pode estar fechado
    if (r.status > 0) return startPort + r.status - 1
  } catch {}
  return startPort
}
const PORT = findFreePort(3001)
const APP_URL = `http://${HOST}:${PORT}`
const MIN_SPLASH_MS = 300
const isDev = process.argv.includes('--dev')

// No pacote instalado (Program Files) nada é gravável: o ROOT é resources/app,
// e os dados do usuário vão para %USERPROFILE%\Documents\JARVIS\data.
// Motivo: nesta máquina, aplicações sem assinatura só têm escrita no Documents
// (Controlled Folder Access bloqueia AppData/Desktop/temp para binários não assinados).
// Isso também mantém dev e pacote com as mesmas chaves/preferências.
const ROOT = app.isPackaged ? path.join(process.resourcesPath, 'app') : path.join(__dirname, '..')
const DATA_DIR = app.isPackaged ? path.join(app.getPath('documents'), 'JARVIS', 'data') : path.join(ROOT, 'data')
try { fs.mkdirSync(DATA_DIR, { recursive: true }) } catch {}

// ── GPU: smooth 60 fps animations need hardware compositing ─────────────────────
// Some VM/remote video drivers crash Chromium's GPU process. GPU stays on by default; if its process
// dies, that is remembered in data/gpu.json and JARVIS restarts in software mode (stable, slower).
const GPU_STATE = path.join(DATA_DIR, 'gpu.json')
function readGpuState() {
  try { return JSON.parse(fs.readFileSync(GPU_STATE, 'utf-8')) } catch { return {} }
}
/** Desktop options from ⚙️ Configurações › Desktop (data/prefs.json, written by the app). */
function readDesktopPrefs() {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'prefs.json'), 'utf-8')).desktop || {}
    return { gpu: d.gpu === 'software' ? 'software' : 'auto', backgroundOnClose: d.backgroundOnClose === true, autoStart: d.autoStart === true }
  } catch { return { gpu: 'auto', backgroundOnClose: false, autoStart: false } }
}
const softwareRender = process.env.JARVIS_SOFTWARE_RENDER === '1' || readGpuState().mode === 'software' || readDesktopPrefs().gpu === 'software'

// ── Crash log: anything that escapes in the main process is recorded instead of silently killing the app
const CRASH_LOG = path.join(DATA_DIR, 'logs', 'electron-main.log')
function logMain(level, message) {
  try {
    fs.mkdirSync(path.dirname(CRASH_LOG), { recursive: true })
    fs.appendFileSync(CRASH_LOG, JSON.stringify({ ts: Date.now(), level, message: String(message).slice(0, 4000) }) + '\n')
  } catch {}
}
// Sem console (atalho), stdout/stderr são pipes fechados: escrever neles dá EPIPE, que caía de novo
// aqui e virava um laço de milhares de linhas no log. EPIPE é ignorado e a escrita nunca lança.
process.on('uncaughtException', e => {
  if (e && e.code === 'EPIPE') return
  logMain('error', (e && e.stack) || e)
  try { process.stderr.write(`[jarvis] uncaught: ${(e && e.stack) || e}\n`) } catch {}
})
for (const s of [process.stdout, process.stderr]) { try { s.on('error', () => {}) } catch {} }
process.on('unhandledRejection', e => { logMain('error', `unhandledRejection: ${(e && e.stack) || e}`) })
if (softwareRender) {
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('disable-gpu')
  app.commandLine.appendSwitch('disable-gpu-compositing')
} else {
  app.commandLine.appendSwitch('enable-gpu-rasterization')
  app.commandLine.appendSwitch('enable-zero-copy')
}
app.on('child-process-gone', (_e, details) => {
  if (softwareRender || details.type !== 'GPU' || details.reason === 'clean-exit') return
  try {
    fs.mkdirSync(path.dirname(GPU_STATE), { recursive: true })
    fs.writeFileSync(GPU_STATE, JSON.stringify({ mode: 'software', reason: details.reason, exitCode: details.exitCode, at: new Date().toISOString() }))
  } catch {}
  process.stdout.write(`[jarvis] GPU process failed (${details.reason}); restarting with software rendering\n`)
  app.relaunch()
  app.exit(0)
})

// Instância única por arquivo: o lock do Electron crasheava o process_singleton desta
// máquina (WER dumps), então o lock é um arquivo no DATA_DIR: PID vivo = segunda
// instância foca a janela da existente e sai; PID morto ou sem lock = libera.
const APP_LOCK = path.join(DATA_DIR, 'app.lock')
function readPidFile(file) {
  try { const n = Number(fs.readFileSync(file, 'utf-8').trim()); return Number.isFinite(n) && n > 0 ? n : NaN } catch { return NaN }
}
function pidAlive(pid) {
  try { process.kill(pid, 0); return true } catch (e) { return e && e.code === 'EPERM' }
}
let appLockAcquired = false
{
  const cur = readPidFile(APP_LOCK)
  if (Number.isFinite(cur) && cur !== process.pid && pidAlive(cur)) {
    logMain('warn', 'Segunda instância detectada: focando a janela da existente e saindo.')
  } else {
    try { fs.writeFileSync(APP_LOCK, String(process.pid), 'utf-8') } catch {}
    process.on('exit', () => { try { fs.rmSync(APP_LOCK, { force: true }) } catch {} })
    appLockAcquired = true
  }
}
if (!appLockAcquired) app.exit(0)

let mainWindow
let splash
let serverProcess

// ── Start Next.js server ──────────────────────────────────────────────────────

const NEXT_BIN = path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next')
const BUILD_ID = path.join(ROOT, '.next', 'BUILD_ID')

// Run Next with Electron's embedded Node, so no system Node/npm is required
function runNext(args, env = {}) {
  const child = spawn(process.execPath, [NEXT_BIN, ...args], {
    cwd: ROOT,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', JARVIS_DATA_DIR: DATA_DIR, ...env },
    windowsHide: true
  })
  child.stdout?.on('data', d => process.stdout.write('[next] ' + d))
  child.stderr?.on('data', d => process.stderr.write('[next:err] ' + d))
  return child
}

// ── Safe updates: never compile while the user waits ──────────────────────────
// When the code is newer than the build, a new build is made in the background into .next-staging
// (the app keeps running on the current one). The next launch swaps it in before starting: instant
// startup, and a failed build never replaces a working one.
const STAGING = path.join(ROOT, '.next-staging')
const STAGING_READY = path.join(STAGING, 'JARVIS_READY')
let quitting = false
let updater = null

// Compiled without the Tailwind/PostCSS configs, a build has no layout at all: panels pile on top of each other
const BUILD_CONFIGS = ['tsconfig.json', 'tailwind.config.ts', 'postcss.config.mjs']
function hasTailwindStyles(dir) {
  let found = false
  const walk = d => {
    let entries = []
    try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (found) return
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.css')) { try { found = fs.readFileSync(p, 'utf8').includes('.flex{') } catch {} }
    }
  }
  walk(path.join(dir, 'static'))
  return found
}

function applyStagedBuild() {
  if (!fs.existsSync(STAGING_READY) || !fs.existsSync(path.join(STAGING, 'BUILD_ID'))) return false
  if (!hasTailwindStyles(STAGING)) {
    fs.rmSync(STAGING, { recursive: true, force: true })
    logMain('error', 'staged build discarded: its CSS has no Tailwind styles')
    return false
  }
  const live = path.join(ROOT, '.next')
  const old = path.join(ROOT, `.next-old-${Date.now()}`)
  try {
    if (fs.existsSync(live)) fs.renameSync(live, old)
    fs.renameSync(STAGING, live)
    fs.rmSync(path.join(live, 'JARVIS_READY'), { force: true })
    fs.rm(old, { recursive: true, force: true }, () => {})
    logMain('info', 'staged build applied')
    return true
  } catch (e) {
    // Roll back so the app still starts on the previous build
    try { if (!fs.existsSync(live) && fs.existsSync(old)) fs.renameSync(old, live) } catch {}
    logMain('error', `staged build swap failed: ${e && e.message}`)
    return false
  }
}

function newestMtime(dir) {
  let newest = 0
  const walk = d => {
    let entries = []
    try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else { try { newest = Math.max(newest, fs.statSync(p).mtimeMs) } catch {} }
    }
  }
  walk(dir)
  return newest
}

function buildIsStale() {
  try {
    const built = fs.statSync(BUILD_ID).mtimeMs
    const code = Math.max(newestMtime(path.join(ROOT, 'src')), ...['next.config.ts', 'package.json', 'tailwind.config.ts'].map(f => { try { return fs.statSync(path.join(ROOT, f)).mtimeMs } catch { return 0 } }))
    return code > built
  } catch { return false }
}

/** Background build into .next-staging with low priority; system Node is preferred (Electron's Node once hung on `next build`). */
function scheduleBackgroundUpdate() {
  // A packaged copy without the build configs can't compile correctly: it receives ready builds instead
  if (isDev || updater || !fs.existsSync(BUILD_ID) || BUILD_CONFIGS.some(f => !fs.existsSync(path.join(ROOT, f))) || !buildIsStale()) return
  fs.rmSync(STAGING, { recursive: true, force: true })
  logMain('info', 'code changed since the last build: building update in background')
  const env = { ...process.env, JARVIS_DIST_DIR: '.next-staging', NODE_ENV: 'production' }
  delete env.ELECTRON_RUN_AS_NODE
  const useSystemNode = spawnSyncOk('node', ['--version'])
  updater = useSystemNode
    ? spawn('node', [NEXT_BIN, 'build'], { cwd: ROOT, env, windowsHide: true })
    : spawn(process.execPath, [NEXT_BIN, 'build'], { cwd: ROOT, env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true })
  try { require('os').setPriority(updater.pid, 10) } catch {}
  let tail = ''
  const keep = d => { tail = (tail + d).slice(-3000) }
  updater.stdout?.on('data', keep)
  updater.stderr?.on('data', keep)
  updater.on('exit', code => {
    updater = null
    const styled = code === 0 && fs.existsSync(path.join(STAGING, 'BUILD_ID')) && hasTailwindStyles(STAGING)
    if (code === 0 && !styled) tail = `build finished without Tailwind styles (missing tailwind/postcss config?)\n${tail}`
    if (styled) {
      fs.writeFileSync(STAGING_READY, new Date().toISOString())
      logMain('info', 'background update ready; applied on next launch')
      if (Notification.isSupported()) new Notification({ title: 'JARVIS atualizado', body: 'A nova versão será usada na próxima vez que você abrir o JARVIS.' }).show()
    } else {
      fs.rm(STAGING, { recursive: true, force: true }, () => {})
      if (!quitting) logMain('error', `background build failed (exit ${code}): ${tail}`)
    }
  })
}

function spawnSyncOk(cmd, args) {
  try { return require('child_process').spawnSync(cmd, args, { windowsHide: true, timeout: 5000 }).status === 0 } catch { return false }
}

// Startup must be instant: never compile inside the app.
// Production build is used when it exists; otherwise the dev server compiles on demand.
let serverRestarts = 0
async function startServer() {
  if (!isDev) applyStagedBuild()
  const hasBuild = fs.existsSync(BUILD_ID)
  const mode = !isDev && hasBuild ? 'start' : 'dev'
  splashStatus(hasBuild ? 'Carregando núcleo' : 'Compilando interface (primeira vez)', 30)
  const child = runNext([mode, '-p', String(PORT), '-H', HOST], { PORT: String(PORT) })
  serverProcess = child
  // Self-healing: if the server dies while the app is open, start it again and reload the window
  child.on('exit', (code, signal) => {
    if (quitting || serverProcess !== child) return
    serverProcess = null
    logMain('error', `server exited unexpectedly (code ${code}, signal ${signal})`)
    if (serverRestarts >= 5) {
      logMain('error', 'server keeps crashing; giving up after 5 restarts')
      if (mainWindow) dialog.showErrorBox('JARVIS', 'O servidor interno parou várias vezes seguidas. Feche e abra o JARVIS. Detalhes em data/logs/electron-main.log')
      return
    }
    serverRestarts++
    // Another JARVIS already serves this port (second window opened): use it, nothing to restart
    const probe = http.get(APP_URL, res => { res.resume(); logMain('info', 'port already served by another JARVIS instance; not restarting') })
    probe.setTimeout(1500, () => probe.destroy())
    probe.on('error', () => setTimeout(() => {
      startServer()
      waitForServer(err => { if (!err && mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reload() })
    }, 1000 * serverRestarts))
  })
}

function stopServer() {
  quitting = true
  if (updater) { try { spawn('taskkill', ['/pid', String(updater.pid), '/T', '/F'], { windowsHide: true }) } catch {} }
  if (!serverProcess || serverProcess.killed) return
  // next spawns worker children; kill the whole tree
  spawn('taskkill', ['/pid', String(serverProcess.pid), '/T', '/F'], { windowsHide: true })
  serverProcess = null
}

// Polls every 150 ms (up to ~2 min): the window appears the moment the server answers
function waitForServer(callback, retries = 0) {
  if (retries > 800) { callback(new Error('timeout')); return }
  const req = http.get(APP_URL, res => { res.resume(); callback(null) })
  // Timeout com handler: sem isso, o timeout não virava 'error' e o retry travava
  // para sempre — o splash ficava preso (ALT-5).
  req.setTimeout(6000, () => req.destroy(new Error('timeout-req')))
  req.on('error', () => setTimeout(() => waitForServer(callback, retries + 1), 150))
  req.end()
}

function splashStatus(text, progress, hold = false) {
  if (!splash || splash.isDestroyed()) return
  splash.webContents.executeJavaScript(
    `window.jarvisStatus && window.jarvisStatus(${JSON.stringify(text)}, ${progress}, ${hold})`
  ).catch(() => {})
}

// ─── Desktop shortcut ─────────────────────────────────────────────────────────

/** The user wants a JARVIS AI icon on the desktop at all times — recreate it whenever it is missing. */
function ensureDesktopShortcut() {
  if (process.platform !== 'win32' || process.env.JARVIS_NO_SHORTCUT) return
  const lnk = path.join(app.getPath('desktop'), 'JARVIS AI.lnk')
  if (fs.existsSync(lnk)) return

  const icon = path.join(ROOT, 'electron', 'jarvis-main.ico')
  if (!fs.existsSync(icon)) {
    process.stdout.write('[jarvis] Ícone ausente, atalho não será criado\n')
    return
  }

  // Um atalho antigo sem ícone válido fica com a "pasta branca" em cache.
  // Se o ícone for mais novo que o atalho, recria o atalho para invalidar o cache.
  try {
    if (fs.existsSync(lnk)) {
      const lnkTime = fs.statSync(lnk).mtimeMs
      const iconTime = fs.statSync(icon).mtimeMs
      if (iconTime <= lnkTime) return
      fs.rmSync(lnk, { force: true })
    }
  } catch {}

  // Somente API nativa do Electron: nada de PowerShell/COM, que dispara heurística de antivírus.
  try {
    // Aponta para o Electron direto com --no-sandbox: sem a flag, o processo morre na
    // inicialização nesta máquina (0xC0000005 em Chromium startup). start.bat é pesado demais.
    const ok = shell.writeShortcutLink(lnk, 'create', {
      target: process.execPath,
      args: `--no-sandbox "${ROOT}"`,
      cwd: ROOT,
      description: 'JARVIS AI — Agente pessoal',
      icon,
      iconIndex: 0,
    })
    if (ok && fs.existsSync(lnk)) {
      process.stdout.write(`[jarvis] Atalho na área de trabalho: ${lnk}\n`)
    } else {
      process.stdout.write('[jarvis] Não foi possível criar o atalho (writeShortcutLink falhou)\n')
    }
  } catch (e) {
    process.stdout.write(`[jarvis] Erro ao criar atalho: ${(e && e.message) || e}\n`)
  }
}

// ── Windows ───────────────────────────────────────────────────────────────────

function createSplash() {
  splash = new BrowserWindow({
    width: 680,
    height: 440,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    center: true,
    show: false,
    backgroundColor: '#00000000',
    icon: path.join(__dirname, 'jarvis-main.ico'),
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  })
  splash.loadFile(path.join(__dirname, 'loading.html'))
  splash.once('ready-to-show', () => splash.show())
  splash.on('closed', () => { splash = null })
}

// Tamanho da janela proporcional à tela (área útil, sem a barra de tarefas): ~88% e centralizada.
// Antes era fixo em 1440×900 — pequeno em telas grandes e maior que a tela em notebooks.
function windowBoundsForScreen() {
  let area = { x: 0, y: 0, width: 1440, height: 900 }
  try { area = screen.getPrimaryDisplay().workArea } catch {}
  const width = Math.round(area.width * 0.88)
  const height = Math.round(area.height * 0.88)
  return {
    width, height,
    x: area.x + Math.round((area.width - width) / 2),
    y: area.y + Math.round((area.height - height) / 2),
    minWidth: Math.min(1100, Math.round(area.width * 0.6)),
    minHeight: Math.min(680, Math.round(area.height * 0.6)),
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    ...windowBoundsForScreen(),
    backgroundColor: '#000000',
    icon: path.join(__dirname, 'jarvis-main.ico'),
    title: 'JARVIS AI',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  })

  Menu.setApplicationMenu(null)

  // Open external links (key pages, docs) in the system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url) && !url.startsWith(APP_URL)) shell.openExternal(url)
    return { action: 'deny' }
  })
  // A plain link click would replace the app with the external page, with no way back
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (url === APP_URL || url.startsWith(`${APP_URL}/`)) return
    e.preventDefault()
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
  })

  // Recovery: a crashed or frozen page is reloaded instead of leaving a white/black window
  let lastRendererCrash = 0
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    logMain('error', `renderer gone: ${details.reason} (${details.exitCode})`)
    if (details.reason === 'clean-exit' || quitting) return
    const now = Date.now()
    if (now - lastRendererCrash < 10000) {
      dialog.showErrorBox('JARVIS', 'A interface travou duas vezes seguidas. Suas conversas estão salvas; feche e abra o JARVIS.')
      return
    }
    lastRendererCrash = now
    setTimeout(() => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(APP_URL) }, 500)
  })
  mainWindow.on('unresponsive', () => {
    logMain('warn', 'window unresponsive')
    dialog.showMessageBox(mainWindow, { type: 'warning', title: 'JARVIS', message: 'A interface não está respondendo.', buttons: ['Aguardar', 'Recarregar'], defaultId: 0, cancelId: 0 })
      .then(r => { if (r.response === 1 && mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reload() })
      .catch(() => {})
  })

  // Background mode: closing hides to the tray (Configurações › Desktop); the server and agents keep running
  mainWindow.on('close', e => {
    if (quitting || !readDesktopPrefs().backgroundOnClose) return
    e.preventDefault()
    mainWindow.hide()
    ensureTray()
  })
  mainWindow.on('closed', () => { mainWindow = null })
}

let tray = null
function ensureTray() {
  if (tray) return
  try {
    tray = new Tray(path.join(__dirname, 'jarvis-main.ico'))
    tray.setToolTip('JARVIS AI — rodando em segundo plano')
    const show = () => { if (mainWindow) { mainWindow.show(); mainWindow.focus() } }
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Abrir JARVIS', click: show },
      { type: 'separator' },
      { label: 'Sair', click: () => { quitting = true; stopServer(); app.quit() } },
    ]))
    tray.on('click', show)
  } catch (e) { logMain('warn', `tray unavailable: ${e && e.message}`) }
}

/** "Iniciar com o Windows" from Configurações › Desktop; applied on every launch so the setting stays in sync. */
function applyLoginItem() {
  if (process.platform !== 'win32' || isDev) return
  try {
    app.setLoginItemSettings({ openAtLogin: readDesktopPrefs().autoStart, path: process.execPath, args: ['--no-sandbox', ROOT] })
  } catch (e) { logMain('warn', `login item: ${e && e.message}`) }
}

// The app asks main to re-read desktop options right after they are saved
ipcMain.handle('jarvis:desktop-prefs-changed', () => { applyLoginItem(); return readDesktopPrefs() })
ipcMain.handle('jarvis:relaunch', () => { quitting = true; stopServer(); app.relaunch(); app.exit(0) })

function revealMainWindow(startedAt) {
  const wait = Math.max(0, MIN_SPLASH_MS - (Date.now() - startedAt))
  setTimeout(() => {
    splashStatus('Sistemas online', 100)
    // Short exit beat for the splash, then a quick fade-in of the app
    setTimeout(() => {
      if (mainWindow) {
        mainWindow.setOpacity(0)
        mainWindow.show()
        let o = 0
        const fade = setInterval(() => {
          o = Math.min(1, o + 0.2)
          if (mainWindow) mainWindow.setOpacity(o)
          if (o >= 1) clearInterval(fade)
        }, 16)
      }
      if (splash && !splash.isDestroyed()) splash.close()
    }, 180)
  }, wait)
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

app.setAppUserModelId('com.jarvis.ai')

ipcMain.handle('jarvis:pick-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { title: 'Escolha a pasta', properties: ['openDirectory'] })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('jarvis:pick-file', async (_e, filters) => {
  const result = await dialog.showOpenDialog(mainWindow, { title: 'Escolha o arquivo para importar', properties: ['openFile'], filters: Array.isArray(filters) ? filters : undefined })
  return result.canceled ? null : result.filePaths[0]
})

// ─── Hub Escolar: Portal do Aluno in the user's own signed-in window ─────────
// The student signs in themselves; JARVIS only reads pages they opened (never types passwords).

const PORTAL_PARTITION = 'persist:hub-portal'
let portalWindow = null

const CAPTURE_JS = `(() => {
  const clean = s => (s || '').replace(/\\s+\\n/g, '\\n').trim()
  const tables = [...document.querySelectorAll('table')].slice(0, 30).map(t => [...t.rows].slice(0, 200).map(r => [...r.cells].map(c => clean(c.innerText).slice(0, 300))))
  const links = [...document.querySelectorAll('a[href]')].slice(0, 300).map(a => ({ text: clean(a.innerText).slice(0, 120), href: a.href })).filter(l => l.text && /^https?:/.test(l.href))
  return { url: location.href, title: document.title, text: clean(document.body ? document.body.innerText : '').slice(0, 60000), tables, links, loginRequired: !!document.querySelector('input[type=password]') }
})()`

/** Captures the main page and every frame (portals often render inside iframes). */
async function captureContents(wc) {
  const frames = wc.mainFrame.framesInSubtree
  const parts = []
  for (const frame of frames) {
    try { parts.push(await frame.executeJavaScript(CAPTURE_JS)) } catch {}
  }
  const main = parts[0] || { url: wc.getURL(), title: wc.getTitle(), text: '', tables: [], links: [], loginRequired: false }
  return {
    url: wc.getURL(),
    title: wc.getTitle() || main.title,
    text: parts.map(p => p.text).filter(Boolean).join('\n\n').slice(0, 80000),
    tables: parts.flatMap(p => p.tables).slice(0, 40),
    links: parts.flatMap(p => p.links).slice(0, 400),
    loginRequired: parts.some(p => p.loginRequired) && parts.every(p => p.tables.length === 0),
  }
}

function safeUrl(url) {
  try {
    const u = new URL(String(url))
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null
  } catch { return null }
}

ipcMain.handle('jarvis:portal-open', async (_e, url) => {
  const target = safeUrl(url) || 'https://www.unama.br/'
  if (portalWindow && !portalWindow.isDestroyed()) {
    await portalWindow.loadURL(target)
    portalWindow.focus()
    return true
  }
  portalWindow = new BrowserWindow({
    width: 1200, height: 860, title: 'Portal do Aluno — JARVIS', backgroundColor: '#ffffff', icon: path.join(__dirname, 'jarvis-main.ico'),
    webPreferences: { partition: PORTAL_PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  portalWindow.setMenuBarVisibility(false)
  portalWindow.on('closed', () => { portalWindow = null })
  await portalWindow.loadURL(target)
  return true
})

ipcMain.handle('jarvis:portal-capture', async () => {
  if (!portalWindow || portalWindow.isDestroyed()) throw new Error('Abra o portal primeiro (botão “Abrir portal”)')
  return captureContents(portalWindow.webContents)
})

/** Revisits saved pages with the same signed-in session, in a hidden window. */
ipcMain.handle('jarvis:portal-sync', async (_e, urls) => {
  const list = (Array.isArray(urls) ? urls : []).map(safeUrl).filter(Boolean).slice(0, 20)
  const hidden = new BrowserWindow({ show: false, webPreferences: { partition: PORTAL_PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true } })
  const out = []
  try {
    for (const url of list) {
      try {
        await hidden.loadURL(url)
        await new Promise(r => setTimeout(r, 3000)) // let client-side portals render
        out.push(await captureContents(hidden.webContents))
      } catch (e) {
        out.push({ url, title: url, text: '', tables: [], links: [], error: String(e && e.message || e) })
      }
    }
  } finally {
    hidden.destroy()
  }
  return out
})

// The Next server is the slow part: start it before Electron is even ready, in parallel with the splash
const startedAt = Date.now()
startServer()

app.whenReady().then(async () => {
  nativeTheme.themeSource = 'dark'
  ensureDesktopShortcut()

  createSplash()
  createMainWindow()
  splash.webContents.once('did-finish-load', () => splashStatus('Iniciando núcleo neural', 30))

  waitForServer((err) => {
    if (err) {
      splashStatus('Falha ao iniciar o servidor', -1)
      logMain('error', `Servidor não respondeu: ${err.message}`)
      dialog.showErrorBox('JARVIS', 'O servidor interno não respondeu em 2 minutos. Feche e abra o JARVIS; se persistir, abra data/logs/electron-main.log.')
      try { splash?.destroy() } catch {}
      app.exit(1)
      return
    }
    splashStatus('Carregando interface', 70)
    mainWindow.loadURL(APP_URL)
    mainWindow.once('ready-to-show', () => {
      revealMainWindow(startedAt)
      applyLoginItem()
      // Only after the user has the window: check for code changes and prepare the next version quietly
      setTimeout(scheduleBackgroundUpdate, 20000)
    })
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (tray && !quitting) return // background mode keeps running from the tray
  stopServer()
  app.quit()
})

app.on('before-quit', stopServer)
