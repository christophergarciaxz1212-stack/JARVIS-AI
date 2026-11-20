// Hub Escolar — shared types (server and UI). No Node-only imports.

export type HubSource = 'portal' | 'whatsapp' | 'teams' | 'github' | 'chatgpt' | 'gemini' | 'calendar' | 'files' | 'manual'

export type ItemKind =
  | 'message' | 'announcement' | 'assignment' | 'exam' | 'material' | 'grade' | 'attendance' | 'event'
  | 'course' | 'repo' | 'issue' | 'pr' | 'commit' | 'conversation' | 'file' | 'note'

/** Exactly where a piece of information came from, so the user can verify it. */
export interface Origin {
  source: HubSource
  /** Human-readable location: chat/group name, team › channel, repo, portal page, file name… */
  where: string
  author?: string
  at?: number
  url?: string
  /** Opaque id inside the source (message id, line number, file path…). */
  ref?: string
}

/** Every synchronised/imported unit of information (indexed for search). */
export interface HubItem {
  id: string
  source: HubSource
  kind: ItemKind
  title: string
  text: string
  origin: Origin
  courseId?: string
  attachments?: Array<{ name: string; url?: string; path?: string; type?: string }>
  meta?: Record<string, unknown>
  /** Set once the organizer looked at it. */
  analyzedAt?: number
  /** Organizer verdict: does this need an action from the student? */
  action?: { required: boolean; summary?: string }
  importedAt: number
}

export interface Course {
  id: string
  name: string
  code?: string
  professors: string[]
  /** Extra names used to recognise the course in messages ("BD", "banco"). */
  aliases: string[]
  /** Portal data. */
  grades?: Array<{ label: string; value: string; origin: Origin }>
  attendance?: { absences?: number; maxAbsences?: number; percent?: number; origin: Origin }
  status?: string
  githubRepos?: string[]
  createdAt: number
  createdBy: 'portal' | 'teams' | 'organizer' | 'user' | 'import'
}

export type TaskStatus = 'pendente' | 'concluida' | 'atrasada' | 'cancelada'

export interface AcademicTask {
  id: string
  courseId?: string
  type: 'trabalho' | 'atividade' | 'leitura' | 'projeto' | 'outro'
  title: string
  description?: string
  due?: number
  status: TaskStatus
  /** Every place this task was mentioned. */
  origins: Origin[]
  createdBy: 'organizer' | 'user' | 'teams' | 'portal'
  createdAt: number
  completedAt?: number
}

export interface Exam {
  id: string
  courseId?: string
  title: string
  date?: number
  content?: string
  origins: Origin[]
  createdBy: 'organizer' | 'user' | 'portal'
  createdAt: number
}

/** Two sources disagree (e.g. different due dates): the user decides. */
export interface Conflict {
  id: string
  subject: 'task' | 'exam'
  targetId: string
  field: 'date'
  options: Array<{ value: number; origin: Origin }>
  status: 'pending' | 'resolved'
  chosen?: number
  createdAt: number
}

export interface Alert {
  id: string
  level: 'info' | 'warning' | 'urgent'
  title: string
  detail: string
  targetType?: 'task' | 'exam' | 'item' | 'conflict' | 'connection'
  targetId?: string
  at: number
  dismissed?: boolean
}

export type ConnectionStatus = 'disconnected' | 'connected' | 'needs-auth' | 'error' | 'syncing'

export interface Connection {
  id: HubSource
  name: string
  status: ConnectionStatus
  /** How data is obtained: official API, official export file, or the user's own browser session. */
  mode: 'api' | 'export' | 'browser' | 'feed' | 'folder'
  lastSync?: number
  lastError?: string
  counts?: Record<string, number>
  /** Non-secret settings (client id, ICS URLs, folder, portal pages…). */
  config: Record<string, unknown>
  account?: string
  notes?: string[]
}

export interface StudyEntry {
  id: string
  courseId?: string
  kind: 'resumo' | 'exercicios' | 'revisao' | 'explicacao' | 'pesquisa'
  title: string
  content: string
  createdBy: string
  createdAt: number
  origins: Origin[]
}

export interface SearchHit {
  item: HubItem
  score: number
  snippet: string
}

export interface PendingAction {
  id: string
  type: 'teams-message' | 'whatsapp-message' | 'github-issue' | 'github-commit'
  title: string
  preview: string
  payload: Record<string, unknown>
  requestedBy: string
  status: 'pending' | 'approved' | 'denied' | 'done' | 'failed'
  result?: string
  createdAt: number
  decidedAt?: number
}
