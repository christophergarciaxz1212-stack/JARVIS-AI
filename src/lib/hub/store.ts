import fs from 'fs'
import path from 'path'
import { dataDir, readJson, writeJsonAtomic } from '../agents/fsutil'
import type {
  AcademicTask, Alert, Conflict, Connection, Course, Exam, HubItem, HubSource, PendingAction, StudyEntry,
} from './types'

export const hubDir = () => path.join(dataDir(), 'hub')
const itemsFile = (source: HubSource) => path.join(hubDir(), 'items', `${source}.json`)

// ─── Items (one file per source, cached by mtime) ────────────────────────────

const itemCache = new Map<string, { mtime: number; items: HubItem[] }>()
let revision = 0

/** Changes whenever any item file is written or read fresh (search index key). */
export const itemsRevision = () => revision

export function getItems(source: HubSource): HubItem[] {
  const file = itemsFile(source)
  try {
    const mtime = fs.statSync(file).mtimeMs
    const hit = itemCache.get(file)
    if (hit && hit.mtime === mtime) return hit.items
    const items = readJson<HubItem[]>(file, [])
    itemCache.set(file, { mtime, items })
    revision++
    return items
  } catch {
    if (itemCache.delete(file)) revision++
    return []
  }
}

function writeItems(source: HubSource, items: HubItem[]) {
  const file = itemsFile(source)
  writeJsonAtomic(file, items)
  itemCache.set(file, { mtime: fs.statSync(file).mtimeMs, items })
  revision++
}

export const ALL_SOURCES: HubSource[] = ['portal', 'whatsapp', 'teams', 'github', 'chatgpt', 'gemini', 'calendar', 'files', 'manual']

export function allItems(): HubItem[] {
  return ALL_SOURCES.flatMap(getItems)
}

/** Adds or replaces items by id. Returns the ones that are new (for the organizer). */
export function upsertItems(source: HubSource, incoming: HubItem[]): HubItem[] {
  const current = getItems(source)
  const byId = new Map(current.map(i => [i.id, i]))
  const fresh: HubItem[] = []
  for (const item of incoming) {
    const prev = byId.get(item.id)
    if (!prev) fresh.push(item)
    // Keep what the organizer already concluded about an unchanged item
    byId.set(item.id, prev && prev.text === item.text ? { ...item, analyzedAt: prev.analyzedAt, action: prev.action, courseId: item.courseId || prev.courseId } : item)
  }
  writeItems(source, [...byId.values()])
  return fresh
}

export function updateItems(source: HubSource, patch: (item: HubItem) => HubItem | null) {
  writeItems(source, getItems(source).map(patch).filter((i): i is HubItem => !!i))
}

export function clearSource(source: HubSource) {
  const file = itemsFile(source)
  if (fs.existsSync(file)) fs.rmSync(file, { force: true })
  itemCache.delete(file)
  revision++
}

// ─── Small collections ───────────────────────────────────────────────────────

function collection<T extends { id: string }>(name: string) {
  const file = () => path.join(hubDir(), `${name}.json`)
  return {
    all: () => readJson<T[]>(file(), []),
    save: (list: T[]) => writeJsonAtomic(file(), list),
    get: (id: string) => readJson<T[]>(file(), []).find(x => x.id === id),
    upsert: (x: T) => {
      const list = readJson<T[]>(file(), [])
      const i = list.findIndex(y => y.id === x.id)
      if (i >= 0) list[i] = x
      else list.push(x)
      writeJsonAtomic(file(), list)
      return x
    },
    remove: (id: string) => writeJsonAtomic(file(), readJson<T[]>(file(), []).filter(x => x.id !== id)),
  }
}

export const courses = collection<Course>('courses')
export const tasks = collection<AcademicTask>('tasks')
export const exams = collection<Exam>('exams')
export const conflicts = collection<Conflict>('conflicts')
export const alerts = collection<Alert>('alerts')
export const studies = collection<StudyEntry>('studies')
export const actions = collection<PendingAction>('actions')
export const connections = collection<Connection>('connections')

// ─── Secrets (OAuth tokens). Never logged, never sent to a model. ────────────

const secretsFile = () => path.join(hubDir(), 'secrets.json')

export function getSecret<T = Record<string, unknown>>(key: string): T | undefined {
  return readJson<Record<string, T>>(secretsFile(), {})[key]
}

export function setSecret(key: string, value: unknown) {
  const all = readJson<Record<string, unknown>>(secretsFile(), {})
  if (value === undefined || value === null) delete all[key]
  else all[key] = value
  writeJsonAtomic(secretsFile(), all)
}

/** Everything the Hub stored for a source: items, secrets, connection. Used by "desconectar e apagar". */
export function forgetSource(source: HubSource) {
  clearSource(source)
  setSecret(source, null)
  connections.remove(source)
}
