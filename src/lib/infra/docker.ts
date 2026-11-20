import { redact } from '../redact'
import { runProgram, which } from './exec'

export interface ContainerInfo { id: string; name: string; image: string; state: string; status: string; ports: string; cpu?: string; mem?: string }
export interface DockerOverview { available: boolean; daemon: boolean; version?: string; containers: ContainerInfo[]; images: number; error?: string; installHint?: string }

const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/

function lines<T>(text: string): T[] {
  return text.split(/\r?\n/).filter(Boolean).flatMap(l => { try { return [JSON.parse(l) as T] } catch { return [] } })
}

export async function dockerOverview(): Promise<DockerOverview> {
  if (!(await which('docker'))) {
    return { available: false, daemon: false, containers: [], images: 0, installHint: 'Docker não instalado. Instale o Docker Desktop (winget install -e --id Docker.DockerDesktop) — o JARVIS pode fazer isso pela aba Ferramentas, com sua aprovação.' }
  }
  const ver = await runProgram('docker', ['version', '--format', '{{.Server.Version}}'], { timeoutMs: 10_000 })
  if (ver.exitCode !== 0) {
    return { available: true, daemon: false, containers: [], images: 0, error: /pipe|daemon|connect/i.test(ver.stderr) ? 'O daemon do Docker não está rodando: abra o Docker Desktop.' : ver.stderr.trim().slice(0, 400) }
  }
  const [ps, stats, imgs] = await Promise.all([
    runProgram('docker', ['ps', '-a', '--format', '{{json .}}'], { timeoutMs: 15_000 }),
    runProgram('docker', ['stats', '--no-stream', '--format', '{{json .}}'], { timeoutMs: 20_000 }),
    runProgram('docker', ['images', '-q'], { timeoutMs: 15_000 }),
  ])
  const st = new Map(lines<{ Name: string; CPUPerc: string; MemUsage: string }>(stats.stdout).map(s => [s.Name, s]))
  const containers = lines<{ ID: string; Names: string; Image: string; State: string; Status: string; Ports: string }>(ps.stdout).map(c => ({
    id: c.ID, name: c.Names, image: c.Image, state: c.State, status: c.Status, ports: c.Ports, cpu: st.get(c.Names)?.CPUPerc, mem: st.get(c.Names)?.MemUsage,
  }))
  return { available: true, daemon: true, version: ver.stdout.trim(), containers, images: imgs.stdout.split(/\r?\n/).filter(Boolean).length }
}

export async function dockerLogs(container: string, tail = 200) {
  if (!ID_RE.test(container)) throw new Error('Container inválido')
  const r = await runProgram('docker', ['logs', '--tail', String(Math.min(Math.max(tail, 1), 2000)), '--timestamps', container], { timeoutMs: 20_000 })
  if (r.exitCode !== 0) throw new Error(r.stderr.trim() || 'Falha ao ler logs')
  return redact((r.stdout + r.stderr).slice(-60_000))
}

export type DockerAction = 'start' | 'stop' | 'restart'

export async function dockerAction(container: string, action: DockerAction) {
  if (!ID_RE.test(container)) throw new Error('Container inválido')
  if (!['start', 'stop', 'restart'].includes(action)) throw new Error('Ação não permitida (só start/stop/restart; remover containers/volumes é feito por você)')
  const r = await runProgram('docker', [action, container], { timeoutMs: 60_000 })
  if (r.exitCode !== 0) throw new Error(r.stderr.trim() || `docker ${action} falhou`)
  return `docker ${action} ${container}: ok`
}
