/**
 * JARVIS — Diagnóstico de sistema e preparação/reparo da instalação.
 *
 * Server-side apenas. Tudo aqui é honesto por medição: nenhum check devolve
 * "ok" sem ter realmente executado a verificação. Os testes usam diretório
 * temporário (JARVIS_DATA_DIR) e nunca escrevem no ambiente real.
 */
import { execFile, execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { dataDir, writeJsonAtomic } from '../agents/fsutil'
import { findBrowser } from '../motion/chrome'

export interface SetupReport {
  platform: { id: 'win32' | 'linux' | 'darwin'; label: string; version: string; build?: string; arch: string }
  cpu: { model: string; cores: number; load: number }
  memory: { totalGB: number; freeGB: number }
  disk: { freeGB: number | null; totalGB: number | null }
  gpu: { name: string | null; vendor: 'nvidia' | 'amd' | 'intel' | 'desconhecida' | 'ausente'; vramMB: number | null }
  admin: boolean
  internet: { ok: boolean; latencyMs: number | null }
  tools: {
    node: { ok: boolean; detail: string }
    chrome: { ok: boolean; detail: string }
    ollama: { ok: boolean; detail: string; models: string[] }
    git: { ok: boolean; detail: string }
    winget: { ok: boolean; detail: string }
  }
  keys: { configured: string[]; missing: string[] }
  directories: { ok: boolean; detail: string; created: string[] }
  video: { browser: boolean; codecH264: boolean }
  ready: boolean
  warnings: string[]
}

const TIMEOUT = 6_000

function safeExec(file: string, args: string[], timeout = TIMEOUT): { ok: boolean; out: string } {
  try {
    const out = execFileSync(file, args, { encoding: 'utf8', timeout, windowsHide: true })
    return { ok: true, out: String(out || '') }
  } catch {
    return { ok: false, out: '' }
  }
}

/** Versão assíncrona para comandos longos (instaladores): não congela o servidor enquanto roda. */
function safeExecAsync(file: string, args: string[], timeout = TIMEOUT): Promise<{ ok: boolean; out: string }> {
  return new Promise(resolve => {
    execFile(file, args, { encoding: 'utf8', timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ ok: !error, out: String(stdout || '') + (error ? String(stderr || '') : '') })
    })
  })
}

function platformInfo() {
  const platform = os.platform()
  const release = os.release()
  if (platform === 'win32') {
    const build = Number((release.match(/(\d+)$/) || [])[1] || 0)
    const label = build >= 22000 ? 'Windows 11' : 'Windows 10'
    return { id: 'win32' as const, label, version: release, build: String(build) || undefined, arch: os.arch() }
  }
  if (platform === 'darwin') return { id: 'darwin' as const, label: 'macOS', version: release, arch: os.arch() }
  // Linux: tenta o nome legível da distro
  let label = 'Linux'
  try {
    const rel = fs.readFileSync('/etc/os-release', 'utf8')
    const name = /^PRETTY_NAME="?([^"\n]+)"?/m.exec(rel)?.[1]
    if (name) label = name
  } catch { /* sem os-release: segue genérico */ }
  return { id: 'linux' as const, label, version: release, arch: os.arch() }
}

function gpuInfo(): SetupReport['gpu'] {
  // NVIDIA primeiro (nvidia-smi é confiável quando instalado)
  const smi = safeExec('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'], 5_000)
  if (smi.ok && smi.out.trim()) {
    const [name, mem] = smi.out.trim().split(',').map(s => s.trim())
    const vramMB = Number(mem)
    return { name: name || 'GPU NVIDIA', vendor: 'nvidia', vramMB: Number.isFinite(vramMB) ? vramMB : null }
  }
  // Windows sem nvidia-smi: tenta WMI/CIM (AMD/Intel)
  if (os.platform() === 'win32') {
    const cim = safeExec('powershell', ['-NoProfile', '-Command', 'Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM | ConvertTo-Json -Compress'], 8_000)
    if (cim.ok && cim.out.trim() && cim.out.includes('Name')) {
      try {
        const parsed = JSON.parse(cim.out)
        const list = Array.isArray(parsed) ? parsed : [parsed]
        for (const entry of list) {
          const name = String(entry?.Name || '').trim()
          if (!name) continue
          const vram = Number(entry?.AdapterRAM || 0)
          const vramMB = Number.isFinite(vram) && vram > 0 ? Math.round(vram / 1024 / 1024) : null
          if (/nvidia/i.test(name)) return { name, vendor: 'nvidia', vramMB }
          if (/radeon|amd/i.test(name)) return { name, vendor: 'amd', vramMB }
          if (/intel/i.test(name)) return { name, vendor: 'intel', vramMB }
          return { name, vendor: 'desconhecida', vramMB }
        }
      } catch { /* JSON inválido: cai no relatório anônimo */ }
    }
  }
  return { name: null, vendor: 'ausente', vramMB: null }
}

function diskInfo(): SetupReport['disk'] {
  try {
    const root = path.parse(dataDir()).root
    const s = fs.statfsSync(root)
    const freeGB = Math.round((Number(s.bavail) * Number(s.bsize)) / 1024 / 1024 / 1024)
    const totalGB = Math.round((Number(s.blocks) * Number(s.bsize)) / 1024 / 1024 / 1024)
    return { freeGB, totalGB }
  } catch {
    return { freeGB: null, totalGB: null }
  }
}

async function internetCheck(): Promise<SetupReport['internet']> {
  const started = Date.now()
  try {
    const res = await fetch('https://www.google.com/generate_204', { cache: 'no-store', signal: AbortSignal.timeout(4_000) })
    return { ok: res.ok || res.status === 204, latencyMs: Date.now() - started }
  } catch {
    try {
      // Fallback: GitHub (usado pelos provedores GitHub Models/skills)
      const res = await fetch('https://api.github.com', { cache: 'no-store', signal: AbortSignal.timeout(4_000) })
      return { ok: res.ok, latencyMs: Date.now() - started }
    } catch {
      return { ok: false, latencyMs: null }
    }
  }
}

function toolsCheck() {
  const isWin = os.platform() === 'win32'
  const winget = isWin ? safeExec('winget', ['--version'], 5_000) : { ok: false, out: '' }
  const git = safeExec('git', ['--version'], 5_000)
  return {
    winget: { ok: winget.ok, detail: winget.ok ? winget.out.trim() : 'WinGet não disponível' },
    git: { ok: git.ok, detail: git.ok ? git.out.trim() : 'git não encontrado no PATH' },
  }
}

function chromeCheck(): SetupReport['tools']['chrome'] {
  const bin = findBrowser()
  return bin
    ? { ok: true, detail: bin }
    : { ok: false, detail: 'Chrome ou Edge não encontrado (necessário para renderizar vídeos)' }
}

async function ollamaCheck(): Promise<SetupReport['tools']['ollama']> {
  const base = (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '')
  try {
    const res = await fetch(`${base}/api/tags`, { cache: 'no-store', signal: AbortSignal.timeout(3_000) })
    if (!res.ok) return { ok: false, detail: `Ollama respondeu HTTP ${res.status}`, models: [] }
    const data = (await res.json()) as { models?: Array<{ name: string }> }
    const models = (data.models || []).map(m => m.name)
    return { ok: true, detail: `Ollama ativo em ${base} — ${models.length} modelo(s)`, models }
  } catch {
    return { ok: false, detail: `Ollama não respondeu em ${base}`, models: [] }
  }
}

function keysReport(): SetupReport['keys'] {
  const TRACKED = [
    'GEMINI_API_KEY', 'GROQ_API_KEY', 'OPENROUTER_API_KEY', 'NVIDIA_API_KEY', 'MISTRAL_API_KEY',
    'SAMBANOVA_API_KEY', 'CEREBRAS_API_KEY', 'HUGGINGFACE_API_KEY', 'BRAVE_SEARCH_API_KEY', 'GITHUB_TOKEN', 'CUSTOM_AI_BASE_URL',
    'WA_ACCESS_TOKEN', 'WA_APP_SECRET',
  ]
  const configured: string[] = []
  const missing: string[] = []
  // Valores nunca são lidos nem expostos — só a presença
  for (const key of TRACKED) {
    if (process.env[key] || loadSavedKey(key)) configured.push(key)
    else missing.push(key)
  }
  return { configured, missing }
}

function loadSavedKey(key: string): string | undefined {
  try {
    const p = path.join(dataDir(), 'keys.json')
    if (!fs.existsSync(p)) return undefined
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown>
    const v = parsed[key]
    return typeof v === 'string' && v.trim() ? v : undefined
  } catch {
    return undefined
  }
}

const REQUIRED_DIRS = ['images', 'video', 'logs', 'temp', 'cache', 'models']

export function ensureDirectories(): { ok: boolean; detail: string; created: string[] } {
  const root = dataDir()
  const created: string[] = []
  try {
    fs.mkdirSync(root, { recursive: true })
    for (const d of REQUIRED_DIRS) {
      const dir = path.join(root, d)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
        created.push(d)
      }
      // Teste real de escrita (arquivos de zero byte falham em pastas sem permissão)
      const probe = path.join(dir, `.write-test-${process.pid}-${Date.now()}`)
      fs.writeFileSync(probe, 'ok')
      fs.rmSync(probe, { force: true })
    }
    return { ok: true, detail: `Diretórios prontos em ${root}`, created }
  } catch (e) {
    return { ok: false, detail: `Falha ao preparar diretórios de dados: ${(e as Error).message}`, created }
  }
}

/** Diagnóstico completo. Não altera nada — só mede. ~2-6s. */
export async function detectSystem(): Promise<SetupReport> {
  const warnings: string[] = []
  const platform = platformInfo()
  const cpus = os.cpus()
  const cpuModel = cpus[0]?.model?.trim() || 'Desconhecido'
  const cores = cpus.length
  const load = (os.loadavg() || [0, 0, 0])[0] || 0
  const ramTotalGB = Math.round((os.totalmem() / 1024 / 1024 / 1024) * 100) / 100
  const ramFreeGB = Math.round((os.freemem() / 1024 / 1024 / 1024) * 100) / 100
  const disk = diskInfo()
  const gpu = gpuInfo()
  const isAdmin = os.platform() === 'win32' ? safeExec('net', ['session'], 3_000).ok : (typeof (os as any).getuid === 'function' ? (os as any).getuid() === 0 : false)
  const internet = await internetCheck()
  const tools = toolsCheck()
  const chrome = chromeCheck()
  const nodeCheck = { ok: true, detail: `Node ${process.version} (processo do JARVIS)` }
  const ollama = await ollamaCheck()
  const keys = keysReport()
  const directories = ensureDirectories()

  if (!disk.freeGB || disk.freeGB < 2) warnings.push(`Espaço livre baixo (${disk.freeGB ?? '?'} GB). Recomendado: 5 GB ou mais.`)
  if (ramTotalGB < 4) warnings.push(`RAM abaixo do recomendado (${ramTotalGB} GB). O JARVIS funciona melhor com 8 GB+.`)
  if (!chrome.ok) warnings.push('Sem Chrome/Edge: a renderização de vídeos não funciona (WebCodecs).')
  if (!internet.ok) warnings.push('Sem internet neste momento: provedores de IA na nuvem e imagens (Pollinations) não funcionam; Ollama continua disponível.')
  if (!tools.git.ok && os.platform() === 'win32') warnings.push('Git não encontrado (necessário apenas para fluxos de repositório, não para o uso diário).')
  if (keys.configured.length === 0 && !ollama.ok) warnings.push('Nenhuma chave de IA configurada e nenhum Ollama ativo — o chat não terá com quem conversar.')

  const video = { browser: chrome.ok, codecH264: true }
  const ready = platform.id !== undefined && chrome.ok && directories.ok && (internet.ok || ollama.ok || keys.configured.length > 0)

  return {
    platform,
    cpu: { model: cpuModel, cores, load },
    memory: { totalGB: ramTotalGB, freeGB: ramFreeGB },
    disk,
    gpu,
    admin: isAdmin,
    internet,
    tools: {
      node: nodeCheck,
      chrome,
      ollama,
      git: tools.git,
      winget: tools.winget,
    },
    keys,
    directories,
    video,
    ready,
    warnings,
  }
}

/** Reparos seguros e reversíveis (só executam quando o usuário clica). */
export function applyRepair(fix: 'dirs' | 'prefs' | 'env-example' | 'keys-file'): { ok: boolean; detail: string } {
  const root = dataDir()
  try {
    if (fix === 'dirs') return ensureDirectories()
    if (fix === 'keys-file') {
      const p = path.join(root, 'keys.json')
      if (fs.existsSync(p)) return { ok: true, detail: 'keys.json já existe (preservado)' }
      writeJsonAtomic(p, {})
      return { ok: true, detail: 'keys.json criado (vazio — configure as chaves em 🔑 Chaves de API)' }
    }
    if (fix === 'prefs') {
      const p = path.join(root, 'prefs.json')
      if (fs.existsSync(p)) return { ok: true, detail: 'prefs.json já existe (preservado)' }
      writeJsonAtomic(p, {})
      return { ok: true, detail: 'prefs.json criado com padrões' }
    }
    if (fix === 'env-example') {
      // __dirname aponta para dentro do bundle do Next (.next/server/...); a raiz do app é o cwd
      const rootDir = process.cwd()
      const src = path.join(rootDir, '.env.local.example')
      const dst = path.join(rootDir, '.env.local')
      if (fs.existsSync(dst)) return { ok: true, detail: '.env.local já existe (preservado)' }
      if (!fs.existsSync(src)) return { ok: false, detail: '.env.local.example ausente no pacote' }
      fs.copyFileSync(src, dst)
      return { ok: true, detail: '.env.local criado a partir do exemplo (preencha as chaves que quiser)' }
    }
    return { ok: false, detail: `Reparo desconhecido: ${fix}` }
  } catch (e) {
    return { ok: false, detail: `Falha ao reparar: ${(e as Error).message}` }
  }
}

// ─── Saúde do sistema (permanente) ──────────────────────────────────────────

export interface HealthReport {
  ok: boolean
  checkedAt: number
  items: Array<{ id: string; label: string; ok: boolean; detail: string }>
  logFile: string
}

const HEALTH_LOG = () => path.join(dataDir(), 'logs', 'health.log')

export async function systemHealth(): Promise<HealthReport> {
  const items: HealthReport['items'] = []
  const push = (id: string, label: string, ok: boolean, detail: string) => items.push({ id, label, ok, detail })

  // Diretórios e escrita
  const dirs = ensureDirectories()
  push('dirs', 'Diretórios de dados', dirs.ok, dirs.detail)

  // Chrome (vídeos)
  const chrome = chromeCheck()
  push('chrome', 'Chrome/Edge para o Estúdio', chrome.ok, chrome.detail)

  // Ollama
  const ollama = await ollamaCheck()
  push('ollama', 'Ollama (opcional)', ollama.ok || true, ollama.ok ? ollama.detail : 'não ativo — opcional, o JARVIS continua com provedores na nuvem')

  // Chaves de IA
  const keys = keysReport()
  push('keys', 'Chaves de IA', keys.configured.length > 0, keys.configured.length ? `${keys.configured.length} configurada(s)` : 'nenhuma chave configurada (o chat exige ao menos uma)')

  // Internet
  const internet = await internetCheck()
  push('internet', 'Internet', internet.ok, internet.ok ? `latência ${internet.latencyMs}ms` : 'sem conexão — provedores em nuvem indisponíveis')

  // Espaço em disco
  const disk = diskInfo()
  push('disk', 'Espaço em disco', disk.freeGB === null || disk.freeGB >= 2, disk.freeGB === null ? 'não foi possível medir' : `${disk.freeGB} GB livres`)

  const ok = items.filter(i => i.id !== 'ollama').every(i => i.ok)
  const report: HealthReport = { ok, checkedAt: Date.now(), items, logFile: HEALTH_LOG() }
  try {
    fs.mkdirSync(path.dirname(HEALTH_LOG()), { recursive: true })
    fs.appendFileSync(HEALTH_LOG(), JSON.stringify({ ts: report.checkedAt, ok, items }) + '\n')
  } catch { /* log é conveniência */ }
  return report
}

/** Instalador explícito via WinGet — só roda quando o usuário clica no botão (nunca automático). */
export async function wingetInstall(id: string): Promise<{ ok: boolean; detail: string; before: string; after: string }> {
  const ALLOWED: Record<string, { probe: () => { ok: boolean; out: string }; label: string }> = {
    'Gyan.FFmpeg': { probe: () => safeExec('ffmpeg', ['-version'], 5_000), label: 'FFmpeg (opcional — o JARVIS usa WebCodecs)' },
    'Git.Git': { probe: () => safeExec('git', ['--version'], 5_000), label: 'Git' },
    'Cloudflare.cloudflared': { probe: () => safeExec('cloudflared', ['--version'], 5_000), label: 'Cloudflare Tunnel (webhook HTTPS público para a WhatsApp Cloud API)' },
    'Ollama.Ollama': { probe: () => ({ ok: ollamaSync(), out: 'ollama detectado' }), label: 'Ollama (modelos locais grátis)' },
    'Google.Chrome': { probe: () => ({ ok: !!findBrowser(), out: findBrowser() || '' }), label: 'Google Chrome' },
  }
  const entry = ALLOWED[id]
  if (!entry) return { ok: false, detail: `Pacote não permitido: ${id}`, before: '', after: '' }
  const before = entry.probe().out.trim().split('\n')[0] || 'ausente'
  if (process.platform !== 'win32') return { ok: false, detail: 'WinGet está disponível apenas no Windows. Instale manualmente pelo site oficial.', before, after: '' }
  const winget = safeExec('winget', ['--version'], 5_000)
  if (!winget.ok) return { ok: false, detail: 'WinGet não encontrado. Instale o "App Installer" da Microsoft Store (ou instale manualmente).', before, after: '' }
  // Instalação silenciosa, escopo por usuário quando suportado pelo pacote
  // --exact: o id da whitelist nunca casa por aproximação com outro pacote
  const res = await safeExecAsync('winget', ['install', '--exact', '--id', id, '--accept-package-agreements', '--accept-source-agreements', '--silent'], 240_000)
  const afterProbe = entry.probe()
  const after = afterProbe.out.trim().split('\n')[0] || 'ausente'
  return {
    ok: afterProbe.ok,
    detail: afterProbe.ok ? `${entry.label} instalado.` : `Instalador terminou mas a verificação falhou. Saída: ${res.out.trim().slice(0, 300) || '(sem saída)'}`,
    before,
    after,
  }
}

function ollamaSync(): boolean {
  try { execFileSync('ollama', ['--version'], { encoding: 'utf8', timeout: 4_000, windowsHide: true }); return true } catch { return false }
}

// ─── Marcador de primeira execução / atualização ─────────────────────────────

export function setupMarker(): { done: boolean; info: { completedAt?: number; appVersion?: string } | null } {
  const p = path.join(dataDir(), 'logs', '.first-run-done')
  try {
    if (!fs.existsSync(p)) return { done: false, info: null }
    const info = JSON.parse(fs.readFileSync(p, 'utf8')) as { completedAt?: number; appVersion?: string }
    return { done: true, info }
  } catch {
    return { done: true, info: null }
  }
}

export function markSetupDone(): { ok: boolean; file: string } {
  const p = path.join(dataDir(), 'logs', '.first-run-done')
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, JSON.stringify({ completedAt: Date.now(), appVersion: appVersion() }))
    return { ok: true, file: p }
  } catch (e) {
    return { ok: false, file: (e as Error).message }
  }
}

function appVersion(): string {
  try {
    const p = path.join(process.cwd(), 'package.json')
    return String(JSON.parse(fs.readFileSync(p, 'utf8')).version || 'dev')
  } catch {
    return 'dev'
  }
}

/** Verificação de atualização honesta: só funciona se JARVIS_UPDATE_REPO=<dono/repo> (GitHub Releases). */
export async function updateCheck(): Promise<{ supported: boolean; message: string; current: string; latest?: string; url?: string }> {
  const current = appVersion()
  const repo = process.env.JARVIS_UPDATE_REPO
  if (!repo) {
    return { supported: false, current, message: 'Atualização automática não configurada. Defina JARVIS_UPDATE_REPO=dono/repo (GitHub Releases) no .env.local para habilitar.' }
  }
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      cache: 'no-store',
      headers: { 'User-Agent': 'jarvis-setup', Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(6_000),
    })
    if (!res.ok) return { supported: false, current, message: `GitHub respondeu ${res.status} ao verificar ${repo}` }
    const data = (await res.json()) as { tag_name?: string; html_url?: string }
    const latest = (data.tag_name || '').replace(/^v/, '')
    const newer = latest && latest !== current
    return {
      supported: true,
      current,
      latest,
      url: data.html_url,
      message: newer ? `Nova versão disponível: v${latest} (atual: v${current}). Baixe em ${data.html_url}` : `Você está na versão mais recente (v${current}).`,
    }
  } catch (e) {
    return { supported: false, current, message: `Falha ao verificar atualização: ${(e as Error).message}` }
  }
}
