'use client'

import type { Provider } from '@/types'
import type { Project, RoleTemplate, Run, RunEvent, SessionMeta, Team } from '@/lib/agents/types'

export async function post<T = Record<string, unknown>>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.error) throw new Error(data.error || `Erro ${res.status}`)
  return data as T
}

export async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.error) throw new Error(data.error || `Erro ${res.status}`)
  return data as T
}

export const api = {
  projects: () => get<{ projects: Project[] }>('/api/projects').then(d => d.projects),
  createProject: (name: string, path: string) => post<{ project: Project }>('/api/projects', { action: 'create', name, path }).then(d => d.project),
  renameProject: (id: string, name: string) => post('/api/projects', { action: 'rename', id, name }),
  removeProject: (id: string) => post('/api/projects', { action: 'remove', id }),

  sessions: (q: Record<string, string>) => get<{ sessions: SessionMeta[] }>(`/api/sessions?${new URLSearchParams(q)}`).then(d => d.sessions),
  sessionAction: (action: string, body: Record<string, unknown>) => post<{ session?: SessionMeta; removed?: { sessions: number; messages: number; dataDirs: number } }>('/api/sessions', { action, ...body }),

  teams: () => get<{ teams: Team[]; roles: RoleTemplate[] }>('/api/teams'),
  saveTeam: (team: Partial<Team>) => post<{ team: Team }>('/api/teams', { action: 'save', team }).then(d => d.team),
  duplicateTeam: (id: string) => post<{ team: Team }>('/api/teams', { action: 'duplicate', id }).then(d => d.team),
  deleteTeam: (id: string) => post('/api/teams', { action: 'delete', id }),

  runs: (sessionId: string) => get<{ runs: Run[] }>(`/api/agents/runs?sessionId=${sessionId}`).then(d => d.runs),
  run: (id: string) => get<{ run: Run; events: RunEvent[] }>(`/api/agents/runs?id=${id}`),
  startRun: (body: Record<string, unknown>) => post<{ run: Run }>('/api/agents/runs', body).then(d => d.run),
  runAction: (id: string, action: string, body: Record<string, unknown> = {}) => post<{ run?: Run; restored?: number; removed?: number }>(`/api/agents/runs/${id}`, { action, ...body }),

  models: () => get<{ providers: Array<Provider & { error?: string }> }>('/api/models').then(d => d.providers),
  health: () => get<{ models: Array<{ model: string; state: 'ok' | 'cooling' | 'unavailable'; cooldownMs: number; lastError?: string }> }>('/api/agents/health'),
}

declare global {
  interface Window {
    electron?: {
      platform: string
      isElectron: boolean
      pickFolder?: () => Promise<string | null>
      pickFile?: (filters?: Array<{ name: string; extensions: string[] }>) => Promise<string | null>
      portalOpen?: (url: string) => Promise<boolean>
      portalCapture?: () => Promise<{ url: string; title: string; text: string; tables: string[][][]; links: Array<{ text: string; href: string }>; loginRequired?: boolean }>
      portalSyncPages?: (urls: string[]) => Promise<Array<{ url: string; title: string; text: string; tables: string[][][]; links: Array<{ text: string; href: string }>; loginRequired?: boolean; error?: string }>>
      desktopPrefsChanged?: () => Promise<unknown>
      relaunch?: () => Promise<void>
    }
  }
}

export function fmtTokens(n: number) {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

export function fmtDuration(ms: number) {
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}

export function shortModel(id?: string) {
  if (!id) return '—'
  if (id === 'auto') return 'Automático'
  return id.slice(id.indexOf('|') + 1).split('/').pop()!.replace(/:free$/, '')
}
