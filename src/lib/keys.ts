import fs from 'fs'
import path from 'path'
import { dataDir, writeJsonAtomic } from './agents/fsutil'

// Keys saved from the in-app settings screen. Kept out of .env.local so that
// saving one doesn't make Next reload the whole app.
const KEYS_PATH = path.join(dataDir(), 'keys.json')
const ENV_PATH = path.join(process.cwd(), '.env.local')

function readKeys(): Record<string, string> {
  let raw: string
  try {
    raw = fs.readFileSync(KEYS_PATH, 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw err
  }
  try {
    return JSON.parse(raw)
  } catch {
    // Corrupt: quarantine instead of silently overwriting and losing every saved key
    const quarantine = `${KEYS_PATH}.corrupt-${Date.now()}`
    try { fs.renameSync(KEYS_PATH, quarantine) } catch {}
    throw new Error(`keys.json estava corrompido — movido para ${path.basename(quarantine)}. Nenhum dado foi apagado; cadastre as chaves de novo.`)
  }
}

export function loadSavedKeys() {
  try {
    for (const [k, v] of Object.entries(readKeys())) {
      if (v) process.env[k] = v
    }
  } catch (e) {
    // Never crash the server at import time; the user just sees "not configured" and can re-save keys
    console.error('[jarvis]', (e as Error).message)
  }
}

export function saveKey(envKey: string, value: string) {
  const keys = readKeys()
  if (value) {
    keys[envKey] = value
    process.env[envKey] = value
  } else {
    delete keys[envKey]
    delete process.env[envKey]
    clearFromEnvFile(envKey)
  }
  // Atomic write; keys are as sensitive as .env.local — keep the file owner-only where the OS allows it
  writeJsonAtomic(KEYS_PATH, keys)
  try { fs.chmodSync(KEYS_PATH, 0o600) } catch {} // NTFS: limited effect, best effort
}

function clearFromEnvFile(envKey: string) {
  if (!fs.existsSync(ENV_PATH)) return
  const lines = fs.readFileSync(ENV_PATH, 'utf-8').split(/\r?\n/)
  const updated = lines.map(l => (l.startsWith(`${envKey}=`) ? `${envKey}=` : l))
  const tmp = `${ENV_PATH}.tmp-${process.pid}`
  try { fs.writeFileSync(tmp, updated.join('\n'), 'utf-8'); fs.renameSync(tmp, ENV_PATH) } catch {
    try { fs.rmSync(tmp, { force: true }) } catch {}
  }
}

export function maskKey(value: string | undefined) {
  if (!value) return ''
  return '••••' + value.slice(-4)
}

loadSavedKeys()
