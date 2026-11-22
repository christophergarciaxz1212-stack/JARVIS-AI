import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { dataDir, readJson, writeJsonAtomic } from '../agents/fsutil'
import type { Topology } from './types'

export const netlabDir = () => path.join(dataDir(), 'netlab')
const ID = /^[0-9a-f-]{36}$/

export function newTopologyId() { return uuidv4() }

export function saveTopology(t: Topology): Topology {
  if (!ID.test(t.id)) throw new Error('Id de topologia inválido')
  t.updatedAt = Date.now()
  writeJsonAtomic(path.join(netlabDir(), `${t.id}.json`), t)
  return t
}

export function getTopology(id: string): Topology | null {
  if (!ID.test(id)) return null
  const t = readJson<Topology | null>(path.join(netlabDir(), `${id}.json`), null)
  return t && t.id === id ? t : null
}

let listCache: { at: number; rows: Array<Pick<Topology, 'id' | 'title' | 'updatedAt'> & { nodes: number }> } | null = null

export async function listTopologies(): Promise<Array<Pick<Topology, 'id' | 'title' | 'updatedAt'> & { nodes: number }>> {
  const dir = netlabDir()
  if (listCache && Date.now() - listCache.at < 30_000) return listCache.rows
  let files: string[] = []
  try { files = fs.readdirSync(dir).filter(f => /^[0-9a-f-]{36}\.json$/.test(f)) } catch { listCache = { at: Date.now(), rows: [] }; return [] }
  const rows = files.map(f => {
    try { const t = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')) as Topology; return { id: t.id, title: t.title, updatedAt: t.updatedAt, nodes: t.nodes.length } } catch { return null }
  }).filter((x): x is NonNullable<typeof x> => !!x).sort((a, b) => b.updatedAt - a.updatedAt)
  listCache = { at: Date.now(), rows }
  return rows
}

/** Only positions change from the editor (dragging): everything else goes through validation. */
export function savePositions(id: string, positions: Record<string, { x: number; y: number }>) {
  const t = getTopology(id)
  if (!t) throw new Error('Topologia não encontrada')
  for (const n of t.nodes) {
    const p = positions[n.id]
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) { n.x = Math.round(p.x); n.y = Math.round(p.y) }
  }
  return saveTopology(t)
}
