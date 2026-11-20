import path from 'path'
import { dataDir, readJson, writeJsonAtomic } from '../agents/fsutil'
import { log } from './log'

export const infraDir = () => path.join(dataDir(), 'infra')

/**
 * Reads an infra JSON store. A corrupt file is quarantined by readJson (never overwritten),
 * so falling back to the default here cannot destroy data — and Infra keeps working.
 */
export function loadStore<T>(name: string, fallback: T): T {
  const file = path.join(infraDir(), name)
  try {
    return readJson<T>(file, fallback)
  } catch (e) {
    log('error', 'infra', (e as Error).message, { file: name })
    return fallback
  }
}

export function saveStore(name: string, value: unknown) {
  writeJsonAtomic(path.join(infraDir(), name), value)
}

export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
