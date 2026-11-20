import fs from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { netlabDir } from './store'
import { containerlabYaml } from './export'
import type { Topology } from './types'

export interface LabTools { wsl: boolean; docker: boolean; containerlab: boolean; gns3?: string; checkedAt: number; detail: string[] }

function run(cmd: string, args: string[], timeout = 20_000): Promise<{ code: number; out: string }> {
  return new Promise(resolve => {
    execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      const out = `${stdout || ''}${stderr || ''}`.replace(/\0/g, '')
      resolve({ code: err ? (typeof (err as NodeJS.ErrnoException & { code?: unknown }).code === 'number' ? (err as unknown as { code: number }).code : 1) : 0, out })
    })
  })
}

let cache: LabTools | null = null

/** What can actually run a lab here: Containerlab needs Docker on Linux (WSL2 on Windows); GNS3 exposes a local API. */
export async function detectLabTools(force = false): Promise<LabTools> {
  if (cache && !force && Date.now() - cache.checkedAt < 60_000) return cache
  const detail: string[] = []
  let wsl = false, docker = false, containerlab = false
  if (process.platform === 'win32') {
    const s = await run('wsl.exe', ['-e', 'sh', '-c', 'echo ok; command -v docker; command -v containerlab'])
    wsl = s.code === 0 && /\bok\b/.test(s.out)
    docker = wsl && /\/docker\b/.test(s.out)
    containerlab = wsl && /\/containerlab\b/.test(s.out)
    if (!wsl) detail.push('WSL2 não está instalado (necessário para Docker/Containerlab no Windows).')
  } else {
    const s = await run('sh', ['-c', 'command -v docker; command -v containerlab'])
    docker = /docker/.test(s.out); containerlab = /containerlab/.test(s.out)
  }
  if (wsl && !docker) detail.push('Docker não encontrado dentro do WSL.')
  if ((wsl || process.platform !== 'win32') && !containerlab) detail.push('Containerlab não está instalado.')
  let gns3: string | undefined
  try {
    const r = await fetch('http://127.0.0.1:3080/v2/version', { signal: AbortSignal.timeout(1500) })
    if (r.ok) gns3 = String(((await r.json()) as { version?: string }).version || 'ok')
  } catch {}
  cache = { wsl, docker, containerlab, gns3, checkedAt: Date.now(), detail }
  return cache
}

export const SETUP_STEPS = [
  'Instale o WSL2 (PowerShell como administrador): `wsl --install -d Ubuntu` e reinicie o Windows.',
  'No Ubuntu: `curl -fsSL https://get.docker.com | sudo sh` e `sudo usermod -aG docker $USER`.',
  'Instale o Containerlab: `bash -c "$(curl -sL https://get.containerlab.dev)"`.',
  'Volte ao JARVIS e peça "suba o laboratório".',
]

const toWslPath = (p: string) => p.replace(/^([A-Za-z]):\\/, (_m, d: string) => `/mnt/${d.toLowerCase()}/`).replace(/\\/g, '/')

/**
 * Deploys the topology for real with Containerlab (containers with the designed IPs and routes).
 * Uses `sudo -n` (no password prompt): when sudo needs a password, it reports the exact command to run.
 */
export async function deployLab(t: Topology): Promise<{ ok: boolean; message: string; file: string }> {
  const { yaml } = containerlabYaml(t)
  const file = path.join(netlabDir(), `${t.id}.clab.yml`)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, yaml)
  const tools = await detectLabTools(true)
  if (!tools.containerlab || !tools.docker) {
    return { ok: false, file, message: `Não dá para subir o laboratório neste PC ainda: ${tools.detail.join(' ')}\n\nPara habilitar (uma vez só):\n${SETUP_STEPS.map((s, i) => `${i + 1}. ${s}`).join('\n')}` }
  }
  const target = process.platform === 'win32' ? toWslPath(file) : file
  const args = ['containerlab', 'deploy', '--reconfigure', '-t', target]
  const r = process.platform === 'win32' ? await run('wsl.exe', ['-e', 'sudo', '-n', ...args], 600_000) : await run('sudo', ['-n', ...args], 600_000)
  if (r.code !== 0 && /password|a terminal is required/i.test(r.out)) {
    return { ok: false, file, message: `O Containerlab precisa de sudo com senha. Rode no terminal do Ubuntu:\n\`sudo containerlab deploy --reconfigure -t ${target}\`` }
  }
  return { ok: r.code === 0, file, message: r.out.trim().split('\n').slice(-40).join('\n') }
}

export async function destroyLab(t: Topology): Promise<{ ok: boolean; message: string }> {
  const file = path.join(netlabDir(), `${t.id}.clab.yml`)
  if (!fs.existsSync(file)) return { ok: false, message: 'Este laboratório não foi iniciado pelo JARVIS.' }
  const target = process.platform === 'win32' ? toWslPath(file) : file
  const args = ['containerlab', 'destroy', '--cleanup', '-t', target]
  const r = process.platform === 'win32' ? await run('wsl.exe', ['-e', 'sudo', '-n', ...args], 300_000) : await run('sudo', ['-n', ...args], 300_000)
  return { ok: r.code === 0, message: r.out.trim().split('\n').slice(-20).join('\n') }
}
