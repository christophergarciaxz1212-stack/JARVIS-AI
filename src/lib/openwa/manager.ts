/**
 * JARVIS — OpenWA gerenciado localmente (instala, inicia, para, status, logs).
 *
 * O OpenWA roda como processo filho separado do JARVIS, de `data/openwa/app`.
 * Nada é obrigatório: se o usuário preferir um OpenWA externo (servidor, VPS ou
 * Docker), basta configurar URL + API key no painel e o JARVIS usa a API direto.
 *
 * Instalação local = download do tarball da tag fixada no GitHub → extração com
 * tar → `npm ci` (ou reajuste better-sqlite3 ^13.2.0 + `npm install` em Node 26+,
 * sem baixar Chromium do puppeteer; engine Baileys) → `nest build` → `node dist/main`
 * com ENGINE_TYPE=baileys em SQLite. Node >= 22.19 exigido
 * (verificado em runtime; JARVIS avisa se o Node for antigo).
 */
import fs from 'fs'
import net from 'net'
import path from 'path'
import { spawn, spawnSync } from 'child_process'
import { dataDir } from '../agents/fsutil'
import { saveKey } from '../keys'
import { getOpenwaConfig, saveOpenwaConfig, OPENWA_VERSION } from './config'

const isWin = process.platform === 'win32'

export const openwaRoot = () => path.join(dataDir(), 'openwa')
export const appDir = () => path.join(openwaRoot(), 'app')
export const logPath = () => path.join(openwaRoot(), 'openwa.log')
export const pidPath = () => path.join(openwaRoot(), 'pid')
export const tarballPath = () => path.join(openwaRoot(), `openwa-${OPENWA_VERSION}.tar.gz`)
const stageDir = () => path.join(openwaRoot(), 'stage')

// ─── Status local (barato — sem spawn) ────────────────────────────────────────

export interface ManagedStatus {
  installed: boolean
  running: boolean
  pid: number | null
  port: number
  appDir: string
  nodeOk: boolean
  nodeVersion: string
}

export function nodeVersionOk(): boolean {
  const major = Number(process.versions.node.split('.')[0]) || 0
  const minor = Number(process.versions.node.split('.')[1]) || 0
  return major > 22 || (major === 22 && minor >= 19)
}

export function isPortOpen(port: number, timeoutMs = 900): Promise<boolean> {
  return new Promise(resolve => {
    const sock = net.connect({ port, host: '127.0.0.1' })
    const done = (ok: boolean) => { try { sock.destroy() } catch {}; resolve(ok) }
    sock.setTimeout(timeoutMs)
    sock.once('connect', () => done(true))
    sock.once('timeout', () => done(false))
    sock.once('error', () => done(false))
  })
}

export async function managedStatus(): Promise<ManagedStatus> {
  const cfg = getOpenwaConfig()
  const installed = fs.existsSync(path.join(appDir(), 'package.json')) && fs.existsSync(path.join(appDir(), 'dist', 'main.js'))
  const pid = readPid()
  const running = await isPortOpen(cfg.port)
  return { installed, running, pid, port: cfg.port, appDir: appDir(), nodeOk: nodeVersionOk(), nodeVersion: process.versions.node }
}

function readPid(): number | null {
  try {
    const n = Number(fs.readFileSync(pidPath(), 'utf-8').trim())
    return Number.isFinite(n) && n > 0 ? n : null
  } catch { return null }
}

// ─── Logs ─────────────────────────────────────────────────────────────────────

export function tailLog(maxBytes = 40_000): string {
  try {
    const stat = fs.statSync(logPath())
    const start = Math.max(0, stat.size - maxBytes)
    const fd = fs.openSync(logPath(), 'r')
    try {
      const buf = Buffer.alloc(Math.min(maxBytes, stat.size))
      fs.readSync(fd, buf, 0, buf.length, start)
      return buf.toString('utf-8')
    } finally { fs.closeSync(fd) }
  } catch { return '' }
}

// ─── .env do OpenWA ───────────────────────────────────────────────────────────

function writeAppEnv(port: number) {
  const content = [
    '# Gerado pelo JARVIS — não edite à mão (regravado a cada início)',
    `PORT=${port}`,
    'NODE_ENV=production',
    'ENGINE_TYPE=baileys',
    'DATABASE_TYPE=sqlite',
    'DATABASE_NAME=./data/openwa.sqlite',
    'SESSION_DATA_PATH=./data/sessions',
    'STORAGE_TYPE=local',
    'STORAGE_LOCAL_PATH=./data/media',
    'REDIS_ENABLED=false',
    'QUEUE_ENABLED=false',
    'AUTO_START_SESSIONS=false',
    'LOG_LEVEL=warn',
    // Swagger desligado em produção; os endpoints REST que o JARVIS usa ficam ativos
    'ENABLE_SWAGGER=false',
    'MCP_ENABLED=false',
    // Deployment local: JARVIS e OpenWA no mesmo PC — liberar o loopback para o
    // webhook de mensagens chegar. NÃO adicione redes aqui; loopback é suficiente.
    'SSRF_ALLOWED_HOSTS=127.0.0.1,localhost',
    '',
  ].join('\n')
  fs.writeFileSync(path.join(appDir(), '.env'), content, 'utf-8')
}

// ─── Adotar a admin key gerada no primeiro boot ───────────────────────────────

export function adoptGeneratedApiKey(): string | null {
  try {
    const key = fs.readFileSync(path.join(appDir(), 'data', '.api-key'), 'utf-8').trim()
    if (!key) return null
    if (process.env.OPENWA_API_KEY !== key) {
      saveKey('OPENWA_API_KEY', key) // também popula process.env
    }
    return key
  } catch { return null }
}

// ─── Iniciar / parar ─────────────────────────────────────────────────────────

/**
 * Ambiente mínimo para o processo filho: nunca vazar as chaves de IA (e qualquer
 * outro segredo do ambiente do JARVIS) para um programa de terceiros, e não herdar
 * NODE_ENV=development do `next dev` (o OpenWA trata produção de forma diferente).
 */
const ENV_KEEP = /^(PATH|Path|SystemRoot|SystemDrive|windir|ComSpec|PATHEXT|TEMP|TMP|TMPDIR|USERNAME|USERPROFILE|HOMEDRIVE|HOMEPATH|HOME|APPDATA|LOCALAPPDATA|PROGRAMDATA|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE|PROCESSOR_IDENTIFIER|LANG|LC_|TZ|OS|ComSpec)$/i

function minimalEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v == null) continue
    if (ENV_KEEP.test(k)) out[k] = String(v)
  }
  return { ...out, ...overrides } as NodeJS.ProcessEnv
}

export async function startLocal(): Promise<{ ok: boolean; alreadyRunning?: boolean; pid?: number; error?: string }> {
  const cfg = getOpenwaConfig()
  if (await isPortOpen(cfg.port)) {
    adoptGeneratedApiKey()
    return { ok: true, alreadyRunning: true }
  }
  if (!nodeVersionOk()) {
    return { ok: false, error: `Node ${process.versions.node} é antigo demais para o OpenWA (mínimo 22.19). Atualize o Node e tente de novo.` }
  }
  if (!fs.existsSync(path.join(appDir(), 'dist', 'main.js'))) {
    return { ok: false, error: 'OpenWA não instalado ainda — clique em "Instalar OpenWA".' }
  }
  writeAppEnv(cfg.port)
  fs.mkdirSync(openwaRoot(), { recursive: true })
  const out = fs.openSync(logPath(), 'a')
  // Dentro do Electron, process.execPath é o binário do JARVIS (não o node):
  // ELECTRON_RUN_AS_NODE=1 faz dele um Node comum — sem abrir nova janela do app.
  const runningInElectron = !!(process.versions as Record<string, string | undefined>).electron
  const childEnv = minimalEnv({
    NODE_ENV: 'production',
    PORT: String(cfg.port),
    ...(runningInElectron ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
  })
  try {
    const child = spawn(process.execPath, ['dist/main'], {
      cwd: appDir(),
      env: childEnv,
      detached: true,
      stdio: ['ignore', out, out],
      windowsHide: true,
    })
    child.unref()
    fs.writeFileSync(pidPath(), String(child.pid), 'utf-8')
    fs.closeSync(out)
  } catch (e) {
    try { fs.closeSync(out) } catch {}
    return { ok: false, error: `Falha ao iniciar o OpenWA: ${(e as Error).message}` }
  }
  // Aguardar o /api/health (até 90s)
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 2_000))
    if (await isPortOpen(cfg.port)) {
      adoptGeneratedApiKey()
      const pid = readPid()
      return { ok: true, pid: pid ?? undefined }
    }
  }
  return { ok: false, error: 'O OpenWA iniciou mas não respondeu em 90s. Veja os logs (data/openwa/openwa.log) ou reinicie.' }
}

export async function stopLocal(): Promise<{ ok: boolean; error?: string }> {
  const pid = readPid()
  if (!pid) {
    // Talvez esteja rodando sem pid file nosso; não matar processo que não é nosso
    const cfg = getOpenwaConfig()
    if (await isPortOpen(cfg.port)) {
      return { ok: false, error: `A porta ${cfg.port} está ocupada por um processo que o JARVIS não iniciou — encerre-o manualmente.` }
    }
    return { ok: true }
  }
  try {
    if (isWin) {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { timeout: 20_000 })
    } else {
      try { process.kill(pid, 'SIGTERM') } catch {}
      await new Promise(r => setTimeout(r, 3_000))
      try { process.kill(pid, 0); process.kill(pid, 'SIGKILL') } catch {}
    }
  } catch (e) {
    return { ok: false, error: `Falha ao parar o PID ${pid}: ${(e as Error).message}` }
  }
  const cfg = getOpenwaConfig()
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (!(await isPortOpen(cfg.port))) break
    await new Promise(r => setTimeout(r, 500))
  }
  try { fs.rmSync(pidPath(), { force: true }) } catch {}
  return { ok: true }
}

// ─── Instalação (job em background — o POST responde na hora) ────────────────

export interface InstallJob {
  running: boolean
  done: boolean
  ok: boolean
  steps: string[]
  error?: string
  startedAt?: number
  finishedAt?: number
}

const g = globalThis as unknown as { __openwaInstallJob?: InstallJob }
export function installJob(): InstallJob {
  return (g.__openwaInstallJob ||= { running: false, done: false, ok: false, steps: [] })
}

export function startInstall(force = false): { started: boolean; alreadyRunning?: boolean; alreadyInstalled?: boolean } {
  const job = installJob()
  if (job.running) return { started: false, alreadyRunning: true }
  // Instalação já existe e force não foi pedido: não tocar no que está instalado (e no serviço em execução)
  if (!force && fs.existsSync(path.join(appDir(), 'dist', 'main.js'))) {
    return { started: false, alreadyInstalled: true }
  }
  g.__openwaInstallJob = { running: true, done: false, ok: false, steps: [], startedAt: Date.now() }
  void runInstall(force).then(
    () => { const j = installJob(); j.running = false; j.done = true; },
    (e) => { const j = installJob(); j.running = false; j.done = true; j.ok = false; j.error = (e as Error).message || String(e) },
  )
  return { started: true }
}

async function runInstall(force: boolean) {
  const job = installJob()
  const step = (s: string) => { job.steps.push(s) }
  const fail = (msg: string): never => { throw new Error(msg) }
  try {
    if (!nodeVersionOk()) fail(`Node ${process.versions.node} é antigo demais — o OpenWA exige Node >= 22.19 (atual: ${process.versions.node}).`)

    step(`Baixando OpenWA ${OPENWA_VERSION} do GitHub…`)
    fs.mkdirSync(openwaRoot(), { recursive: true })
    const res = await fetch(`https://codeload.github.com/rmyndharis/OpenWA/tar.gz/refs/tags/${OPENWA_VERSION}`, {
      signal: AbortSignal.timeout(10 * 60_000),
    })
    if (!res.ok) fail(`Download do GitHub falhou (HTTP ${res.status}).`)
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length < 100_000) fail('Download suspeito (arquivo pequeno demais) — aborte e tente de novo.')
    step(`Download ok (${(buf.length / 1024 / 1024).toFixed(1)} MB). Extraindo…`)
    fs.writeFileSync(tarballPath(), buf)

    if (force) {
      step('Removendo instalação anterior…')
      fs.rmSync(appDir(), { recursive: true, force: true })
    }
    fs.rmSync(stageDir(), { recursive: true, force: true })
    fs.mkdirSync(stageDir(), { recursive: true })
    const tar = spawnSync('tar', ['-xzf', tarballPath(), '-C', stageDir()], { timeout: 120_000 })
    if (tar.status !== 0) fail(`Extração falhou: ${tar.stderr?.toString().slice(-300) || 'tar retornou erro'}`)
    const extracted = fs.readdirSync(stageDir(), { withFileTypes: true }).find(e => e.isDirectory() && e.name.startsWith('OpenWA-'))
    if (!extracted) fail('Tarball extraído mas a pasta OpenWA-* não foi encontrada.')
    fs.rmSync(appDir(), { recursive: true, force: true })
    fs.renameSync(path.join(stageDir(), extracted!.name), appDir())
    fs.rmSync(stageDir(), { recursive: true, force: true })
    fs.rmSync(tarballPath(), { force: true })
    step('Extração concluída. Instalando dependências — pode levar alguns minutos…')

    const npm = isWin ? 'npm.cmd' : 'npm'
    const nodeMajor = Number(process.versions.node.split('.')[0]) || 0
    if (nodeMajor >= 26) {
      // better-sqlite3 13.0.x (lock da tag) não tem prebuild para o Node 26 e compilaria
      // com node-gyp (exige Visual Studio). Reajusta para ^13.2.0, que tem prebuild.
      step('Node 26+: ajustando better-sqlite3 para ^13.2.0 (prebuild; evita compilar com node-gyp)…')
      bumpBetterSqlite3(appDir())
      run(npm, ['install', '--no-audit', '--no-fund'], {
        timeoutMs: 20 * 60_000,
        env: { PUPPETEER_SKIP_DOWNLOAD: '1', PUPPETEER_SKIP_CHROMIUM_DOWNLOAD: '1', CI: 'true' },
      })
    } else {
      try {
        run(npm, ['ci', '--no-audit', '--no-fund'], {
          timeoutMs: 20 * 60_000,
          env: { PUPPETEER_SKIP_DOWNLOAD: '1', PUPPETEER_SKIP_CHROMIUM_DOWNLOAD: '1', CI: 'true' },
        })
      } catch (e) {
        const msg = (e as Error).message || ''
        if (!/better-sqlite3|node-gyp|gyp ERR/i.test(msg)) throw e
        // Falha de compilação nativa do better-sqlite3: tenta a versão com prebuild
        step('npm ci falhou no better-sqlite3 — aplicando fix (^13.2.0 com prebuild) e tentando de novo…')
        bumpBetterSqlite3(appDir())
        run(npm, ['install', '--no-audit', '--no-fund'], {
          timeoutMs: 20 * 60_000,
          env: { PUPPETEER_SKIP_DOWNLOAD: '1', PUPPETEER_SKIP_CHROMIUM_DOWNLOAD: '1', CI: 'true' },
        })
      }
    }
    step('Dependências instaladas. Compilando (nest build)…')
    run(npm, ['run', 'build'], { timeoutMs: 10 * 60_000, env: {} })
    if (!fs.existsSync(path.join(appDir(), 'dist', 'main.js'))) fail('Build terminou mas dist/main.js não existe.')
    step('Build concluído. Gravando configuração…')

    const cfg = getOpenwaConfig()
    writeAppEnv(cfg.port)
    saveOpenwaConfig({ manageLocal: true, baseUrl: `http://127.0.0.1:${cfg.port}` })
    step('Iniciando o OpenWA…')
    const started = await startLocal()
    if (!started.ok) fail(started.error || 'OpenWA instalado, mas falhou ao iniciar.')
    const key = adoptGeneratedApiKey()
    step(key ? 'OpenWA instalado, iniciado e chave adotada. Pronto para vincular!' : 'OpenWA instalado e iniciado. Configure a API key no painel.')
    job.ok = true
    job.finishedAt = Date.now()
  } catch (e) {
    job.ok = false
    job.error = (e as Error).message || String(e)
    job.finishedAt = Date.now()
    job.steps.push(`ERRO: ${job.error}`)
    throw e
  }
}

/** Reajusta o pacote better-sqlite3 para uma versão com prebuild (evita node-gyp/VS). */
function bumpBetterSqlite3(appPath: string) {
  const pkgPath = path.join(appPath, 'package.json')
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as {
    dependencies?: Record<string, string>
    overrides?: Record<string, string>
  }
  if (pkg.dependencies?.['better-sqlite3']) pkg.dependencies['better-sqlite3'] = '^13.2.0'
  if (pkg.overrides) pkg.overrides['better-sqlite3'] = '$better-sqlite3' // self-reference: transitivo acompanha o direto
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8')
}

function run(cmd: string, args: string[], opts: { timeoutMs: number; env: Record<string, string> }) {
  const result = spawnSync(cmd, args, {
    cwd: appDir(),
    timeout: opts.timeoutMs,
    windowsHide: true,
    shell: isWin,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...opts.env },
    encoding: 'utf-8',
  })
  if (result.error) {
    const err = result.error as NodeJS.ErrnoException
    throw new Error(err.code === 'ETIMEDOUT' ? `${cmd} ${args.join(' ')} excedeu o tempo limite` : `${cmd} falhou: ${err.message}`)
  }
  if (result.status !== 0) {
    const tail = `${result.stdout || ''}\n${result.stderr || ''}`.trim().split(/\r?\n/).slice(-12).join('\n')
    throw new Error(`${cmd} ${args.join(' ')} saiu com código ${result.status}:\n${tail}`)
  }
}

/** Porta aponta para PID no pid file? (para exibir "gerenciado pelo JARVIS") */
export function managedPidAlive(): boolean {
  const pid = readPid()
  if (!pid) return false
  try { process.kill(pid, 0); return true } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}
