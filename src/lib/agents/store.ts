import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { dataDir, readJson, removeDir, runsDir, sessionDir, writeJsonAtomic } from './fsutil'
import { DEFAULT_PROJECT_ID } from '../db'
import { PRESET_TEAMS } from './roles'
import type { Project, Run, RunEvent, Team } from './types'
import { ACTIVE_RUN_STATUSES } from './types'

// ─── Projects & teams (data/agents.json) ─────────────────────────────────────

interface AgentsFile {
  projects: Project[]
  teams: Team[]
}

const agentsFile = () => path.join(dataDir(), 'agents.json')

function readAgentsFile(): AgentsFile {
  const f = readJson<AgentsFile>(agentsFile(), { projects: [], teams: [] })
  if (!f.projects.some(p => p.id === DEFAULT_PROJECT_ID)) {
    f.projects.unshift({ id: DEFAULT_PROJECT_ID, name: 'Geral', path: '', createdAt: 0 })
  }
  return f
}

function writeAgentsFile(f: AgentsFile) {
  writeJsonAtomic(agentsFile(), f)
}

export function listProjects(): Project[] {
  return readAgentsFile().projects
}

export function getProject(id: string): Project | undefined {
  return readAgentsFile().projects.find(p => p.id === id)
}

export function createProject(name: string, folder: string): Project {
  const abs = path.resolve(folder)
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new Error(`Pasta não encontrada: ${folder}`)
  const f = readAgentsFile()
  const existing = f.projects.find(p => p.path && path.resolve(p.path).toLowerCase() === abs.toLowerCase())
  if (existing) return existing
  const project: Project = { id: uuidv4(), name: name.trim() || path.basename(abs), path: abs, createdAt: Date.now() }
  f.projects.push(project)
  writeAgentsFile(f)
  return project
}

export function renameProject(id: string, name: string) {
  const f = readAgentsFile()
  const p = f.projects.find(x => x.id === id)
  if (!p || id === DEFAULT_PROJECT_ID) return false
  p.name = name.trim() || p.name
  writeAgentsFile(f)
  return true
}

/** Forgets the project in JARVIS only. The folder on disk is never touched. */
export function removeProject(id: string) {
  if (id === DEFAULT_PROJECT_ID) throw new Error('O projeto Geral não pode ser removido')
  const f = readAgentsFile()
  f.projects = f.projects.filter(p => p.id !== id)
  writeAgentsFile(f)
}

export function listTeams(): Team[] {
  const saved = readAgentsFile().teams
  const savedIds = new Set(saved.map(t => t.id))
  // Presets stay available even after the user saves custom teams; an edited preset is saved under its own id
  return [...PRESET_TEAMS.filter(t => !savedIds.has(t.id)), ...saved]
}

export function getTeam(id: string): Team | undefined {
  return listTeams().find(t => t.id === id)
}

/** Evita nomes duplicados ao salvar/editar equipes (BAI-4): sufixa com contador. */
function uniqueTeamName(teams: Team[], name: string, excludeId?: string): string {
  const free = (n: string) => !teams.some(t => t.id !== excludeId && t.name === n)
  if (free(name)) return name
  let base = name.replace(/\s*\((?:cópia|\d+)\)$/i, '')
  let n = 2
  while (!free(`${base} (${n})`)) n++
  return `${base} (${n})`
}

export function saveTeam(team: Omit<Team, 'createdAt' | 'updatedAt' | 'preset'> & { createdAt?: number }): Team {
  if (!team.name?.trim()) throw new Error('Dê um nome à equipe')
  if (!team.agents?.length) throw new Error('A equipe precisa de pelo menos um agente')
  const f = readAgentsFile()
  const now = Date.now()
  const saved: Team = {
    id: team.id || uuidv4(),
    name: uniqueTeamName(f.teams, team.name.trim(), team.id),
    description: team.description || '',
    agents: team.agents.map(a => ({ ...a, id: a.id || uuidv4() })),
    createdAt: team.createdAt || now,
    updatedAt: now,
  }
  const i = f.teams.findIndex(t => t.id === saved.id)
  if (i >= 0) f.teams[i] = saved
  else f.teams.push(saved)
  writeAgentsFile(f)
  return saved
}

export function deleteTeam(id: string) {
  const f = readAgentsFile()
  const before = f.teams.length
  f.teams = f.teams.filter(t => t.id !== id)
  if (f.teams.length === before && PRESET_TEAMS.some(t => t.id === id)) {
    throw new Error('Equipes padrão não podem ser excluídas (duplique para personalizar)')
  }
  writeAgentsFile(f)
}

// ─── Runs (data/sessions/<sessionId>/runs/<runId>.json + .events.jsonl) ──────

const runFile = (sessionId: string, runId: string) => path.join(runsDir(sessionId), `${runId}.json`)
const eventsFile = (sessionId: string, runId: string) => path.join(runsDir(sessionId), `${runId}.events.jsonl`)
export const snapshotDir = (sessionId: string, runId: string) => path.join(runsDir(sessionId), `${runId}.snapshots`)

export function saveRun(run: Run) {
  writeJsonAtomic(runFile(run.sessionId, run.id), run)
}

export function loadRun(sessionId: string, runId: string): Run | undefined {
  return readJson<Run | undefined>(runFile(sessionId, runId), undefined)
}

export function listRuns(sessionId: string): Run[] {
  const dir = runsDir(sessionId)
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => readJson<Run | undefined>(path.join(dir, f), undefined))
    .filter((r): r is Run => !!r)
    .sort((a, b) => a.createdAt - b.createdAt)
}

/** Finds a run when only its id is known (runs live under their session's folder). */
export function findRun(runId: string): Run | undefined {
  const root = path.join(dataDir(), 'sessions')
  if (!fs.existsSync(root)) return undefined
  for (const sid of fs.readdirSync(root)) {
    const run = loadRun(sid, runId)
    if (run) return run
  }
  return undefined
}

export function appendEvent(sessionId: string, runId: string, event: RunEvent) {
  const file = eventsFile(sessionId, runId)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.appendFileSync(file, JSON.stringify(event) + '\n', 'utf-8')
}

export function readEvents(sessionId: string, runId: string, limit = 400): RunEvent[] {
  const file = eventsFile(sessionId, runId)
  if (!fs.existsSync(file)) return []
  const lines = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean)
  return lines.slice(-limit).map(l => { try { return JSON.parse(l) as RunEvent } catch { return null } }).filter((e): e is RunEvent => !!e)
}

/** Everything JARVIS stored for a session: runs, logs and file snapshots. Project files live elsewhere. */
export function deleteSessionData(sessionId: string) {
  const dir = sessionDir(sessionId)
  const existed = fs.existsSync(dir)
  removeDir(dir)
  return existed
}

/** Copies runs/logs/snapshots to a duplicated session, rewriting the session id inside run files. */
export function duplicateSessionData(fromId: string, toId: string) {
  const from = sessionDir(fromId)
  if (!fs.existsSync(from)) return
  const to = sessionDir(toId)
  fs.cpSync(from, to, { recursive: true })
  for (const run of listRuns(toId)) {
    run.sessionId = toId
    if (ACTIVE_RUN_STATUSES.includes(run.status)) run.status = 'interrupted'
    saveRun(run)
  }
}

/** All runs left in an active state, e.g. because the app was closed mid-run. */
export function listActiveRunsOnDisk(): Run[] {
  const root = path.join(dataDir(), 'sessions')
  if (!fs.existsSync(root)) return []
  return fs.readdirSync(root).flatMap(sid => {
    try { return listRuns(sid) } catch { return [] }
  }).filter(r => ACTIVE_RUN_STATUSES.includes(r.status))
}
