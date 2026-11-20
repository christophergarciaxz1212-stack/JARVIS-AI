import fs from 'fs'
import os from 'os'
import path from 'path'
import { createHash } from 'crypto'
import { dataDir, writeJsonAtomic } from '../agents/fsutil'

export type InfraStatus = 'healthy' | 'warning' | 'critical'

export interface SystemHealth {
  status: InfraStatus
  timestamp: number
  platform: string
  release: string
  uptimeSeconds: number
  totalMemoryMb: number
  freeMemoryMb: number
  usedMemoryPct: number
  cpuCount: number
  loadAverage: number[]
  diskFreeMb: number
  diskTotalMb: number
  diskUsagePct: number
  issues: string[]
}

export interface RecoveryOptions<T> {
  retries?: number
  retryDelayMs?: number
  label?: string
  fallbackValue?: T
  shouldRetry?: (error: unknown) => boolean
  onRetry?: (attempt: number, error: unknown) => void
  rollback?: () => void | Promise<void>
}

const checkpointsDir = () => path.join(dataDir(), 'infra', 'checkpoints')

// Keep the original key in the document while using a collision-resistant filename.
function checkpointFile(key: string) {
  const digest = createHash('sha256').update(key, 'utf8').digest('hex')
  return path.join(checkpointsDir(), `${digest}.json`)
}

export interface CheckpointRecord<T> {
  schemaVersion: 1
  key: string
  savedAt: number
  checksum: string
  value: T
}

function checkpointChecksum(key: string, savedAt: number, value: unknown) {
  return createHash('sha256').update(JSON.stringify({ schemaVersion: 1, key, savedAt, value }), 'utf8').digest('hex')
}

export function getSystemHealth(): SystemHealth {
  const totalMemoryMb = Math.round(os.totalmem() / (1024 * 1024))
  const freeMemoryMb = Math.round(os.freemem() / (1024 * 1024))
  const usedMemoryPct = totalMemoryMb ? Math.round(((totalMemoryMb - freeMemoryMb) / totalMemoryMb) * 100) : 0
  const cpuCount = os.cpus().length
  let diskAvailable = true
  const disk = (() => {
    try {
      const stat = fs.statfsSync(process.cwd())
      const total = stat.blocks * stat.bsize
      const free = stat.bavail * stat.bsize
      return { total, free }
    } catch {
      diskAvailable = false
      return { total: 0, free: 0 }
    }
  })()
  const diskFreeMb = disk.total ? Math.round(disk.free / (1024 * 1024)) : 0
  const diskTotalMb = disk.total ? Math.round(disk.total / (1024 * 1024)) : 0
  const diskUsagePct = diskTotalMb ? Math.round(((diskTotalMb - diskFreeMb) / diskTotalMb) * 100) : 0
  const loadAverage = os.loadavg()
  const issues: string[] = []
  if (usedMemoryPct > 85) issues.push('Uso de memória acima de 85%')
  if (!diskAvailable) issues.push('Espaço em disco indisponível para verificação')
  else if (diskUsagePct > 85) issues.push('Uso de disco acima de 85%')
  if (os.platform() !== 'win32' && loadAverage.some(v => v > cpuCount * 1.5)) issues.push('Carga do sistema elevada')
  if (os.platform() === 'win32' && !process.env.TEMP) issues.push('Variável TEMP indisponível')

  let status: InfraStatus = 'healthy'
  if (issues.length >= 2 || usedMemoryPct > 90 || diskUsagePct > 90) status = 'critical'
  else if (issues.length) status = 'warning'

  return {
    status,
    timestamp: Date.now(),
    platform: os.platform(),
    release: os.release(),
    uptimeSeconds: Math.round(os.uptime()),
    totalMemoryMb,
    freeMemoryMb,
    usedMemoryPct,
    cpuCount,
    loadAverage: loadAverage.map(v => Number(v.toFixed(2))),
    diskFreeMb,
    diskTotalMb,
    diskUsagePct,
    issues,
  }
}

export function auditInfrastructure() {
  const health = getSystemHealth()
  return {
    ...health,
    summary: health.issues.length ? `Atenção: ${health.issues.join('; ')}` : 'Sistema está estável',
  }
}

export async function withRecovery<T>(operation: () => Promise<T> | T, options: RecoveryOptions<T> = {}): Promise<T> {
  // Retrying side effects is unsafe unless the caller explicitly classifies the error.
  const retries = Math.max(0, Math.min(10, Math.floor(options.retries ?? 2)))
  const delayMs = Math.max(0, Math.min(30_000, options.retryDelayMs ?? 200))
  let lastError: unknown
  let fallback = options.fallbackValue

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await Promise.resolve(operation())
    } catch (error) {
      lastError = error
      if (attempt >= retries) break
      const shouldRetry = options.shouldRetry?.(error) ?? false
      if (!shouldRetry) break
      if (options.rollback) await Promise.resolve(options.rollback())
      if (options.onRetry) options.onRetry(attempt + 1, error)
      if (delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs))
    }
  }

  if (fallback !== undefined) return fallback
  throw lastError instanceof Error ? lastError : new Error(options.label ? `Falha em ${options.label}` : 'Falha na operação')
}

export function withRecoverySync<T>(operation: () => T, options: Omit<RecoveryOptions<T>, 'rollback'> & { rollback?: () => void } = {}): T {
  const retries = options.retries ?? 2
  let lastError: unknown
  const fallback = options.fallbackValue

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return operation()
    } catch (error) {
      lastError = error
      if (attempt >= retries) break
      const shouldRetry = options.shouldRetry?.(error) ?? false
      if (!shouldRetry) break
      if (options.rollback) options.rollback()
      if (options.onRetry) options.onRetry(attempt + 1, error)
    }
  }

  if (fallback !== undefined) return fallback
  throw lastError instanceof Error ? lastError : new Error(options.label ? `Falha em ${options.label}` : 'Falha na operação')
}

export function checkpoint(key: string, value: unknown) {
  if (!key.trim()) throw new Error('A chave do checkpoint não pode ser vazia')
  const file = checkpointFile(key)
  const savedAt = Date.now()
  const record: CheckpointRecord<unknown> = {
    schemaVersion: 1,
    key,
    savedAt,
    checksum: checkpointChecksum(key, savedAt, value),
    value,
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  writeJsonAtomic(file, record)
  return file
}

export function readCheckpoint<T>(key: string): T | undefined {
  if (!key.trim()) throw new Error('A chave do checkpoint não pode ser vazia')
  const file = checkpointFile(key)
  if (!fs.existsSync(file)) return undefined

  let parsed: CheckpointRecord<T>
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as CheckpointRecord<T>
  } catch {
    throw new Error(`Checkpoint corrompido: ${path.basename(file)}; os dados foram preservados.`)
  }

  if (parsed.schemaVersion !== 1 || parsed.key !== key || typeof parsed.savedAt !== 'number' ||
      parsed.checksum !== checkpointChecksum(key, parsed.savedAt, parsed.value)) {
    throw new Error(`Checkpoint inválido ou adulterado: ${path.basename(file)}; os dados foram preservados.`)
  }
  return parsed.value
}

export function clearCheckpoint(key: string) {
  if (!key.trim()) throw new Error('A chave do checkpoint não pode ser vazia')
  const file = checkpointFile(key)
  if (fs.existsSync(file)) fs.rmSync(file, { force: true })
}
