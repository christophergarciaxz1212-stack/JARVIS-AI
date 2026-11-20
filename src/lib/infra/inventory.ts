import os from 'os'
import fs from 'fs'
import { parseJsonList, runPowerShell, runProgram, which } from './exec'

export interface DiskInfo { mount: string; label?: string; fs?: string; totalMb: number; freeMb: number; usedPct: number }
export interface GpuInfo {
  index: number
  name: string
  vendor: 'nvidia' | 'other'
  memoryTotalMb?: number
  memoryUsedMb?: number
  utilizationPct?: number
  temperatureC?: number
  powerW?: number
  driver?: string
}
export interface NetIface { name: string; address: string; family: 'IPv4' | 'IPv6'; mac: string; cidr?: string | null }
export interface ProcInfo { pid: number; name: string; memMb: number; cpuSec?: number }
export interface ToolInfo { id: string; label: string; category: string; path: string | null; installId?: string; note?: string }
export interface StoppedService { name: string; displayName: string }

export interface Inventory {
  collectedAt: number
  host: string
  os: { platform: string; release: string; arch: string; caption?: string; uptimeSec: number }
  cpu: { model: string; cores: number; usagePct: number; loadAvg: number[] }
  memory: { totalMb: number; freeMb: number; usedPct: number }
  disks: DiskInfo[]
  gpus: GpuInfo[]
  network: NetIface[]
  topProcesses: ProcInfo[]
  stoppedAutoServices: StoppedService[]
  tools: ToolInfo[]
  issues: string[]
}

export const TOOL_CATALOG: Array<Omit<ToolInfo, 'path'>> = [
  { id: 'ssh', label: 'OpenSSH (cliente)', category: 'Acesso remoto', note: 'Recurso opcional do Windows: Configurações › Sistema › Recursos opcionais' },
  { id: 'ssh-keygen', label: 'ssh-keygen', category: 'Acesso remoto' },
  { id: 'tailscale', label: 'Tailscale (VPN mesh)', category: 'Acesso remoto', installId: 'tailscale.tailscale' },
  { id: 'wg', label: 'WireGuard', category: 'Acesso remoto', installId: 'WireGuard.WireGuard' },
  { id: 'docker', label: 'Docker', category: 'Containers', installId: 'Docker.DockerDesktop' },
  { id: 'kubectl', label: 'kubectl', category: 'Containers', installId: 'Kubernetes.kubectl' },
  { id: 'helm', label: 'Helm', category: 'Containers', installId: 'Helm.Helm' },
  { id: 'git', label: 'Git', category: 'DevOps', installId: 'Git.Git' },
  { id: 'gh', label: 'GitHub CLI', category: 'DevOps', installId: 'GitHub.cli' },
  { id: 'terraform', label: 'Terraform', category: 'DevOps', installId: 'Hashicorp.Terraform' },
  { id: 'tofu', label: 'OpenTofu', category: 'DevOps', installId: 'OpenTofu.Tofu' },
  { id: 'ansible', label: 'Ansible', category: 'DevOps', note: 'Roda em Linux: use dentro do WSL (sudo apt install ansible)' },
  { id: 'wsl', label: 'WSL (Linux no Windows)', category: 'Sistema' },
  { id: 'winget', label: 'winget', category: 'Sistema' },
  { id: 'node', label: 'Node.js', category: 'Runtime', installId: 'OpenJS.NodeJS.LTS' },
  { id: 'python', label: 'Python', category: 'Runtime', installId: 'Python.Python.3.12' },
  { id: 'caddy', label: 'Caddy (web server/HTTPS)', category: 'Web', installId: 'CaddyServer.Caddy' },
  { id: 'ffmpeg', label: 'FFmpeg', category: 'Mídia', installId: 'Gyan.FFmpeg' },
  { id: 'ollama', label: 'Ollama (IA local)', category: 'IA', installId: 'Ollama.Ollama' },
  { id: 'nvidia-smi', label: 'NVIDIA SMI (driver)', category: 'IA', note: 'Vem com o driver NVIDIA' },
  { id: 'tar', label: 'tar (backups)', category: 'Sistema' },
]

export async function detectTools(): Promise<ToolInfo[]> {
  return Promise.all(TOOL_CATALOG.map(async t => ({ ...t, path: await which(t.id) })))
}

async function cpuUsagePct(sampleMs = 400): Promise<number> {
  const snap = () => os.cpus().map(c => c.times)
  const a = snap()
  await new Promise(r => setTimeout(r, sampleMs))
  const b = snap()
  let idle = 0
  let total = 0
  b.forEach((t, i) => {
    const p = a[i]
    if (!p) return
    const d = (k: keyof typeof t) => t[k] - p[k]
    const tot = d('user') + d('nice') + d('sys') + d('idle') + d('irq')
    idle += d('idle')
    total += tot
  })
  return total > 0 ? Math.round(((total - idle) / total) * 1000) / 10 : 0
}

const num = (v: string | undefined) => {
  const n = Number(String(v ?? '').trim())
  return Number.isFinite(n) ? n : undefined
}

export function parseNvidiaSmi(csv: string): GpuInfo[] {
  return csv.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(line => {
    const [index, name, memTotal, memUsed, util, temp, driver, power] = line.split(',').map(s => s.trim())
    return {
      index: num(index) ?? 0,
      name: name || 'GPU NVIDIA',
      vendor: 'nvidia' as const,
      memoryTotalMb: num(memTotal),
      memoryUsedMb: num(memUsed),
      utilizationPct: num(util),
      temperatureC: num(temp),
      driver: driver || undefined,
      powerW: num(power),
    }
  })
}

export async function readGpus(): Promise<GpuInfo[]> {
  if (await which('nvidia-smi')) {
    const r = await runProgram('nvidia-smi', ['--query-gpu=index,name,memory.total,memory.used,utilization.gpu,temperature.gpu,driver_version,power.draw', '--format=csv,noheader,nounits'], { timeoutMs: 8000 })
    if (r.exitCode === 0) {
      const gpus = parseNvidiaSmi(r.stdout)
      if (gpus.length) return gpus
    }
  }
  if (process.platform !== 'win32') return []
  const r = await runPowerShell('Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion | ConvertTo-Json -Compress', 10_000)
  return parseJsonList<{ Name: string; AdapterRAM?: number; DriverVersion?: string }>(r.stdout).map((g, i) => ({
    index: i,
    name: g.Name,
    vendor: /nvidia/i.test(g.Name) ? 'nvidia' : 'other',
    // AdapterRAM is a 32-bit field: wrong above 4 GB, so only trust small values
    memoryTotalMb: g.AdapterRAM && g.AdapterRAM > 0 && g.AdapterRAM < 4_294_967_295 ? Math.round(g.AdapterRAM / 1048576) : undefined,
    driver: g.DriverVersion,
  }))
}

interface WinSnapshot {
  caption?: string
  disks?: Array<{ DeviceID: string; VolumeName?: string; FileSystem?: string; Size?: number; FreeSpace?: number }>
  procs?: Array<{ Id: number; ProcessName: string; MemMB: number; CpuSec?: number }>
  stopped?: Array<{ Name: string; DisplayName: string }>
}

async function windowsSnapshot(): Promise<WinSnapshot> {
  const script = [
    '$o=@{}',
    '$o.caption=(Get-CimInstance Win32_OperatingSystem).Caption',
    '$o.disks=@(Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | Select-Object DeviceID,VolumeName,FileSystem,Size,FreeSpace)',
    "$o.procs=@(Get-Process | Sort-Object WS -Descending | Select-Object -First 10 Id,ProcessName,@{n='MemMB';e={[math]::Round($_.WS/1MB)}},@{n='CpuSec';e={[math]::Round([double]$_.CPU,1)}})",
    // Automatic services that are not running; trigger-start services stop on their own, so they are excluded
    "$o.stopped=@(Get-CimInstance Win32_Service -Filter \"StartMode='Auto' AND State<>'Running'\" | Where-Object { $_.Name -notmatch '^(sppsvc|gupdate|edgeupdate|MapsBroker|RemoteRegistry|tiledatamodelsvc|WbioSrvc|CDPSvc|GoogleUpdater.*|MicrosoftEdgeElevationService|BITS|TrustedInstaller|wuauserv|UsoSvc|DoSvc|sedsvc|ShellHWDetection|DPS|WpnService)$' } | Select-Object Name,DisplayName)",
    '$o | ConvertTo-Json -Depth 4 -Compress',
  ].join(';')
  const r = await runPowerShell(script, 25_000)
  try { return JSON.parse(r.stdout.trim()) as WinSnapshot } catch { return {} }
}

function unixDisks(): DiskInfo[] {
  try {
    const st = fs.statfsSync('/')
    const totalMb = Math.round((st.blocks * st.bsize) / 1048576)
    const freeMb = Math.round((st.bavail * st.bsize) / 1048576)
    return [{ mount: '/', totalMb, freeMb, usedPct: totalMb ? Math.round(((totalMb - freeMb) / totalMb) * 100) : 0 }]
  } catch { return [] }
}

interface InventoryCache { at: number; value?: Inventory; pending?: Promise<Inventory> }
const g = globalThis as unknown as { __jarvisInventory?: InventoryCache }

/**
 * Stale-while-revalidate: a recent snapshot is returned at once; an old one is returned
 * immediately too while a single background refresh runs. maxAgeMs = 0 waits for fresh data.
 */
export function getInventory(maxAgeMs = 20_000): Promise<Inventory> {
  const c = (g.__jarvisInventory ??= { at: 0 })
  if (c.value && maxAgeMs > 0 && Date.now() - c.at < maxAgeMs) return Promise.resolve(c.value)
  if (!c.pending) {
    const p = collectInventory()
      .then(v => { c.value = v; c.at = Date.now(); return v })
      .finally(() => { c.pending = undefined })
    p.catch(() => {})
    c.pending = p
  }
  return c.value && maxAgeMs > 0 ? Promise.resolve(c.value) : c.pending
}

async function collectInventory(): Promise<Inventory> {
  // Sampled before spawning PowerShell/where/nvidia-smi, otherwise we would measure our own spike
  const usage = await cpuUsagePct()
  const [gpus, tools, win] = await Promise.all([
    readGpus().catch(() => [] as GpuInfo[]),
    detectTools(),
    process.platform === 'win32' ? windowsSnapshot() : Promise.resolve({} as WinSnapshot),
  ])
  const totalMb = Math.round(os.totalmem() / 1048576)
  const freeMb = Math.round(os.freemem() / 1048576)
  const disks: DiskInfo[] = win.disks?.length
    ? win.disks.filter(d => d.Size).map(d => {
        const t = Math.round((d.Size || 0) / 1048576)
        const f = Math.round((d.FreeSpace || 0) / 1048576)
        return { mount: d.DeviceID, label: d.VolumeName || undefined, fs: d.FileSystem, totalMb: t, freeMb: f, usedPct: t ? Math.round(((t - f) / t) * 100) : 0 }
      })
    : unixDisks()
  const network: NetIface[] = Object.entries(os.networkInterfaces()).flatMap(([name, list]) =>
    (list || []).filter(i => !i.internal).map(i => ({ name, address: i.address, family: (i.family === 'IPv6' ? 'IPv6' : 'IPv4') as 'IPv4' | 'IPv6', mac: i.mac, cidr: i.cidr })),
  )
  const inv: Inventory = {
    collectedAt: Date.now(),
    host: os.hostname(),
    os: { platform: os.platform(), release: os.release(), arch: os.arch(), caption: win.caption, uptimeSec: Math.round(os.uptime()) },
    cpu: { model: os.cpus()[0]?.model?.trim() || 'desconhecida', cores: os.cpus().length, usagePct: usage, loadAvg: os.loadavg().map(v => Math.round(v * 100) / 100) },
    memory: { totalMb, freeMb, usedPct: totalMb ? Math.round(((totalMb - freeMb) / totalMb) * 100) : 0 },
    disks,
    gpus,
    network,
    topProcesses: (win.procs || []).map(p => ({ pid: p.Id, name: p.ProcessName, memMb: p.MemMB, cpuSec: p.CpuSec })),
    stoppedAutoServices: (win.stopped || []).map(s => ({ name: s.Name, displayName: s.DisplayName })),
    tools,
    issues: [],
  }
  inv.issues = findIssues(inv)
  return inv
}

export function findIssues(inv: Pick<Inventory, 'memory' | 'disks' | 'gpus' | 'cpu'>): string[] {
  const issues: string[] = []
  if (inv.memory.usedPct >= 90) issues.push(`Memória RAM em ${inv.memory.usedPct}% — risco de lentidão e travamentos`)
  else if (inv.memory.usedPct >= 80) issues.push(`Memória RAM em ${inv.memory.usedPct}%`)
  for (const d of inv.disks) {
    if (d.usedPct >= 95 || d.freeMb < 2048) issues.push(`Disco ${d.mount} quase cheio (${d.usedPct}% usado, ${(d.freeMb / 1024).toFixed(1)} GB livres)`)
    else if (d.usedPct >= 85) issues.push(`Disco ${d.mount} em ${d.usedPct}%`)
  }
  for (const gpu of inv.gpus) {
    if ((gpu.temperatureC ?? 0) >= 85) issues.push(`GPU ${gpu.name} a ${gpu.temperatureC} °C — temperatura alta`)
    if (gpu.memoryTotalMb && gpu.memoryUsedMb && gpu.memoryUsedMb / gpu.memoryTotalMb >= 0.95) issues.push(`VRAM da GPU ${gpu.name} quase toda em uso`)
  }
  if (inv.cpu.usagePct >= 95) issues.push(`CPU em ${inv.cpu.usagePct}%`)
  return issues
}
