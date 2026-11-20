import fs from 'fs'
import os from 'os'
import path from 'path'
import { redact } from '../redact'
import { runProgram, which } from './exec'
import { isValidHost } from './netdiag'
import { classifyCommand, type RiskAssessment } from './risk'
import { loadStore, newId, saveStore } from './store'

export interface ServerEntry {
  id: string
  name: string
  host: string
  port: number
  user: string
  /** Private key path. Passwords are never stored: key auth only. */
  identityFile?: string
  os: 'linux' | 'windows'
  tags: string[]
  createdAt: number
  lastCheck?: { at: number; ok: boolean; latencyMs: number; error?: string }
}

export interface RemoteResult {
  ok: boolean
  exitCode: number
  stdout: string
  stderr: string
  durationMs: number
  timedOut: boolean
  risk: RiskAssessment
}

const FILE = 'servers.json'
const USER_RE = /^[a-z_][a-z0-9_.-]{0,63}$/i

export const listServers = () => loadStore<ServerEntry[]>(FILE, [])

export function findServer(ref: string): ServerEntry {
  const all = listServers()
  const key = ref.trim().toLowerCase()
  const hit = all.find(s => s.id === ref) || all.find(s => s.name.toLowerCase() === key) || all.find(s => s.host.toLowerCase() === key)
  if (!hit) throw new Error(`Servidor "${ref}" não cadastrado. Cadastre em Infra › Servidores (host, usuário e chave SSH).`)
  return hit
}

export function validateServer(input: Partial<ServerEntry>) {
  const name = String(input.name || input.host || '').trim()
  const host = String(input.host || '').trim()
  const user = String(input.user || '').trim()
  const port = Number(input.port || 22)
  if (!name || name.length > 60) throw new Error('Dê um nome ao servidor (até 60 caracteres)')
  if (!isValidHost(host)) throw new Error('Host inválido (use nome DNS ou IP)')
  if (!USER_RE.test(user)) throw new Error('Usuário inválido')
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Porta inválida')
  let identityFile: string | undefined
  if (input.identityFile) {
    identityFile = path.resolve(String(input.identityFile).replace(/^~(?=[\\/])/, os.homedir()))
    if (!fs.existsSync(identityFile)) throw new Error(`Chave não encontrada: ${identityFile}`)
  }
  return { name, host, user, port, identityFile, os: input.os === 'windows' ? 'windows' as const : 'linux' as const, tags: Array.isArray(input.tags) ? input.tags.map(String).slice(0, 10) : [] }
}

export function saveServer(input: Partial<ServerEntry>): ServerEntry {
  const clean = validateServer(input)
  const all = listServers()
  const existing = input.id ? all.find(s => s.id === input.id) : undefined
  if (existing) {
    Object.assign(existing, clean)
    saveStore(FILE, all)
    return existing
  }
  if (all.some(s => s.name.toLowerCase() === clean.name.toLowerCase())) throw new Error('Já existe um servidor com esse nome')
  const entry: ServerEntry = { ...clean, id: newId('srv'), createdAt: Date.now() }
  saveStore(FILE, [...all, entry])
  return entry
}

export function removeServer(id: string) {
  saveStore(FILE, listServers().filter(s => s.id !== id))
}

function sshArgs(s: ServerEntry) {
  const args = [
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=10',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=3',
    '-p', String(s.port),
  ]
  if (s.identityFile) args.push('-i', s.identityFile, '-o', 'IdentitiesOnly=yes')
  args.push('--', `${s.user}@${s.host}`)
  return args
}

/**
 * Runs a command on a registered server. Critical commands need `confirmed` — the
 * caller (UI after an explicit click, or an approved request) is responsible for that.
 */
export async function execRemote(s: ServerEntry, command: string, opts: { confirmed?: boolean; timeoutMs?: number } = {}): Promise<RemoteResult> {
  if (!(await which('ssh'))) throw new Error('Cliente OpenSSH não encontrado. Ative em Configurações › Sistema › Recursos opcionais › Cliente OpenSSH.')
  const cmd = command.trim()
  if (!cmd) throw new Error('Comando vazio')
  const risk = classifyCommand(cmd)
  if (risk.level === 'critical' && !opts.confirmed) {
    throw Object.assign(new Error(`Comando crítico (${risk.reasons.join(', ')}) precisa de confirmação explícita`), { needsConfirmation: true, risk })
  }
  const r = await runProgram('ssh', [...sshArgs(s), cmd], { timeoutMs: opts.timeoutMs ?? 120_000 })
  return {
    ok: r.exitCode === 0,
    exitCode: r.exitCode,
    stdout: redact(r.stdout),
    stderr: redact(explainSshError(r.stderr, r.exitCode)),
    durationMs: r.durationMs,
    timedOut: r.timedOut,
    risk,
  }
}

export function explainSshError(stderr: string, code: number) {
  if (code !== 255) return stderr
  const hints: Array<[RegExp, string]> = [
    [/Permission denied \(publickey/i, 'Chave recusada: adicione a chave pública ao ~/.ssh/authorized_keys do servidor (botão "Gerar chave" mostra qual).'],
    [/Connection refused/i, 'Porta SSH fechada: o sshd está parado ou usa outra porta.'],
    [/timed out|Operation timed out/i, 'Sem resposta: servidor desligado, IP errado ou firewall bloqueando a porta.'],
    [/Could not resolve hostname/i, 'Nome do host não resolve no DNS.'],
    [/Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i, 'A identidade do servidor MUDOU desde a última conexão — possível reinstalação ou ataque man-in-the-middle. Confirme com o provedor antes de remover a linha antiga do known_hosts.'],
  ]
  const hint = hints.find(([re]) => re.test(stderr))?.[1]
  return hint ? `${stderr.trim()}\n→ ${hint}` : stderr
}

export async function testServer(s: ServerEntry) {
  const r = await execRemote(s, 'echo jarvis-ok', { timeoutMs: 20_000 }).catch(e => ({ ok: false, stdout: '', stderr: (e as Error).message, durationMs: 0 }) as Partial<RemoteResult>)
  const ok = !!r.ok && /jarvis-ok/.test(r.stdout || '')
  const all = listServers()
  const entry = all.find(x => x.id === s.id)
  if (entry) {
    entry.lastCheck = { at: Date.now(), ok, latencyMs: r.durationMs || 0, error: ok ? undefined : (r.stderr || 'falhou').slice(0, 300) }
    saveStore(FILE, all)
  }
  return { ok, latencyMs: r.durationMs || 0, error: ok ? undefined : r.stderr }
}

const LINUX_INVENTORY = [
  'echo "### SISTEMA"; (. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME"); uname -srm',
  'echo "### UPTIME"; uptime',
  'echo "### MEMORIA"; free -m',
  'echo "### DISCO"; df -hP -x tmpfs -x devtmpfs -x squashfs 2>/dev/null || df -h',
  'echo "### SERVICOS COM FALHA"; systemctl --failed --no-legend --plain 2>/dev/null | head -20',
  'echo "### PORTAS EM ESCUTA"; (ss -tlnH 2>/dev/null || netstat -tln 2>/dev/null) | head -30',
  'echo "### CONTAINERS"; (docker ps --format "{{.Names}}\t{{.Status}}" 2>/dev/null || echo "docker ausente ou sem permissão") | head -30',
  'echo "### ATUALIZACOES"; (apt list --upgradable 2>/dev/null | tail -n +2 | wc -l | sed "s/$/ pacotes atualizáveis (apt)/") || (dnf -q check-update 2>/dev/null | grep -c . | sed "s/$/ pacotes atualizáveis (dnf)/") || true',
  'echo "### FIREWALL"; (ufw status 2>/dev/null | head -5) || (firewall-cmd --state 2>/dev/null) || echo "sem acesso ao firewall (precisa de sudo)"',
  'echo "### SSH"; (sshd -T 2>/dev/null | grep -Ei "^(permitrootlogin|passwordauthentication) ") || echo "sem acesso ao sshd -T"',
].join('; ')

const WINDOWS_INVENTORY = [
  'Write-Output "### SISTEMA"; (Get-CimInstance Win32_OperatingSystem).Caption',
  'Write-Output "### MEMORIA"; Get-CimInstance Win32_OperatingSystem | ForEach-Object { "{0:N0} MB livres de {1:N0} MB" -f ($_.FreePhysicalMemory/1KB), ($_.TotalVisibleMemorySize/1KB) }',
  'Write-Output "### DISCO"; Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object { "{0} {1:N1} GB livres de {2:N1} GB" -f $_.DeviceID, ($_.FreeSpace/1GB), ($_.Size/1GB) }',
  'Write-Output "### SERVICOS AUTOMATICOS PARADOS"; Get-CimInstance Win32_Service -Filter "StartMode=\'Auto\' AND State<>\'Running\'" | Select-Object -First 20 -ExpandProperty Name',
  'Write-Output "### PORTAS EM ESCUTA"; Get-NetTCPConnection -State Listen | Sort-Object LocalPort -Unique | Select-Object -First 30 | ForEach-Object { "$($_.LocalAddress):$($_.LocalPort)" }',
].join('; ')

export async function remoteInventory(s: ServerEntry) {
  const cmd = s.os === 'windows' ? `powershell -NoProfile -Command "${WINDOWS_INVENTORY.replace(/"/g, '\\"')}"` : LINUX_INVENTORY
  // Read-only by construction; confirmed avoids false positives from the classifier on the long script
  const r = await execRemote(s, cmd, { confirmed: true, timeoutMs: 60_000 })
  const sections: Array<{ title: string; body: string }> = []
  for (const block of r.stdout.split(/^### /m).filter(Boolean)) {
    const [title, ...rest] = block.split('\n')
    sections.push({ title: title.trim(), body: rest.join('\n').trim() })
  }
  return { ok: r.ok, sections, stderr: r.stderr, durationMs: r.durationMs }
}

/** Creates (once) a dedicated ed25519 key for JARVIS and returns the public key to install on servers. */
export async function ensureJarvisKey() {
  const dir = path.join(os.homedir(), '.ssh')
  const priv = path.join(dir, 'jarvis_ed25519')
  const pub = `${priv}.pub`
  if (!fs.existsSync(priv)) {
    if (!(await which('ssh-keygen'))) throw new Error('ssh-keygen não encontrado (instale o Cliente OpenSSH do Windows)')
    fs.mkdirSync(dir, { recursive: true })
    const r = await runProgram('ssh-keygen', ['-t', 'ed25519', '-f', priv, '-N', '', '-C', `jarvis@${os.hostname()}`], { timeoutMs: 20_000 })
    if (r.exitCode !== 0) throw new Error(`ssh-keygen falhou: ${r.stderr || r.stdout}`)
  }
  const publicKey = fs.readFileSync(pub, 'utf-8').trim()
  return {
    privateKeyPath: priv,
    publicKey,
    howTo: `No servidor, rode uma vez (logado com o seu usuário):\nmkdir -p ~/.ssh && chmod 700 ~/.ssh && echo "${publicKey}" >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`,
  }
}
