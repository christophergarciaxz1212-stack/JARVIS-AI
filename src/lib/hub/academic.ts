import { v4 as uuidv4 } from 'uuid'
import { allItems, alerts, conflicts, connections, courses, exams, getItems, hubDir, itemsRevision, studies, tasks } from './store'
import { Bm25, normalize, snippet, tokenize } from './text'
import type { AcademicTask, Alert, Course, Exam, HubItem, HubSource, Origin, SearchHit } from './types'

const DAY = 86400_000

// ─── Courses ─────────────────────────────────────────────────────────────────

function jaccard(a: string, b: string) {
  const A = new Set(tokenize(a))
  const B = new Set(tokenize(b))
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const t of A) if (B.has(t)) inter++
  return inter / (A.size + B.size - inter)
}

export function findCourseByName(name: string): Course | undefined {
  const n = normalize(name).trim()
  const list = courses.all()
  return list.find(c => normalize(c.name) === n || c.aliases.some(a => normalize(a) === n) || (c.code && normalize(c.code) === n))
    || list.find(c => jaccard(c.name, name) >= 0.6)
}

export function ensureCourse(name: string, createdBy: Course['createdBy'], extra: Partial<Course> = {}): Course {
  const clean = name.replace(/\s+/g, ' ').trim()
  const existing = findCourseByName(clean)
  if (existing) {
    const merged = {
      ...existing,
      professors: [...new Set([...existing.professors, ...(extra.professors || [])])],
      aliases: [...new Set([...existing.aliases, ...(extra.aliases || [])])],
      code: existing.code || extra.code,
      grades: extra.grades || existing.grades,
      attendance: extra.attendance || existing.attendance,
      status: extra.status || existing.status,
    }
    courses.upsert(merged)
    return merged
  }
  const c: Course = { id: uuidv4(), name: clean, professors: [], aliases: [], createdAt: Date.now(), createdBy, ...extra }
  courses.upsert(c)
  return c
}

/** Recognises the course a message belongs to: its location (group/team/channel), text, or professor. */
export function matchCourse(text: string, origin?: Origin): Course | undefined {
  const list = courses.all()
  if (!list.length) return undefined
  const where = normalize(origin?.where || '')
  const body = normalize(text)
  const author = normalize(origin?.author || '')
  let best: Course | undefined
  let bestScore = 0
  for (const c of list) {
    const names = [c.name, ...c.aliases, ...(c.code ? [c.code] : [])].map(normalize).filter(n => n.length >= 2)
    let s = 0
    for (const n of names) {
      const re = new RegExp(`(^|[^a-z0-9])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`)
      if (re.test(where)) s = Math.max(s, 5)
      if (re.test(body)) s = Math.max(s, 3)
    }
    if (c.professors.some(p => p.length > 3 && author.includes(normalize(p)))) s += 2
    if (s > bestScore) { best = c; bestScore = s }
  }
  return bestScore >= 2 ? best : undefined
}

// ─── Tasks & exams (merged across sources, conflicts recorded) ───────────────

function sameDay(a?: number, b?: number) {
  return !!a && !!b && Math.abs(a - b) < DAY && new Date(a).getDate() === new Date(b).getDate()
}

function originKey(o: Origin) {
  return `${o.source}|${o.where}|${o.ref || o.at || ''}`
}

function recordConflict(subject: 'task' | 'exam', targetId: string, a: { value: number; origin: Origin }, b: { value: number; origin: Origin }) {
  const open = conflicts.all().find(c => c.targetId === targetId && c.status === 'pending')
  if (open) {
    if (!open.options.some(o => sameDay(o.value, b.value))) { open.options.push(b); conflicts.upsert(open) }
    return
  }
  conflicts.upsert({ id: uuidv4(), subject, targetId, field: 'date', options: [a, b], status: 'pending', createdAt: Date.now() })
}

export function addOrMergeTask(input: { courseId?: string; title: string; description?: string; due?: number; type?: AcademicTask['type']; origin: Origin; createdBy: AcademicTask['createdBy'] }): { task: AcademicTask; created: boolean } {
  const list = tasks.all()
  // Same task = similar title; a shared due date only helps when the titles are at least related
  const match = list.find(t => t.status !== 'cancelada' && (t.courseId || '') === (input.courseId || '') &&
    (jaccard(t.title, input.title) >= 0.5 || (input.due && sameDay(t.due, input.due) && t.type === (input.type || 'trabalho') && jaccard(t.title, input.title) >= 0.25)))
  if (match) {
    if (!match.origins.some(o => originKey(o) === originKey(input.origin))) match.origins.push(input.origin)
    if (input.due && !match.due) match.due = input.due
    else if (input.due && match.due && !sameDay(match.due, input.due)) {
      recordConflict('task', match.id, { value: match.due, origin: match.origins[0] }, { value: input.due, origin: input.origin })
    }
    if (input.description && !match.description) match.description = input.description
    tasks.upsert(match)
    return { task: match, created: false }
  }
  const task: AcademicTask = {
    id: uuidv4(), courseId: input.courseId, type: input.type || 'trabalho', title: input.title.slice(0, 200), description: input.description,
    due: input.due, status: 'pendente', origins: [input.origin], createdBy: input.createdBy, createdAt: Date.now(),
  }
  tasks.upsert(task)
  return { task, created: true }
}

export function addOrMergeExam(input: { courseId?: string; title: string; date?: number; content?: string; origin: Origin; createdBy: Exam['createdBy'] }): { exam: Exam; created: boolean } {
  const list = exams.all()
  // One course rarely has two exams on the same day; without a course, the titles must be related too
  const match = list.find(e => (e.courseId || '') === (input.courseId || '') &&
    (jaccard(e.title, input.title) >= 0.5 || (input.date && sameDay(e.date, input.date) && (!!input.courseId || jaccard(e.title, input.title) >= 0.25))))
  if (match) {
    if (!match.origins.some(o => originKey(o) === originKey(input.origin))) match.origins.push(input.origin)
    if (input.date && !match.date) match.date = input.date
    else if (input.date && match.date && !sameDay(match.date, input.date)) {
      recordConflict('exam', match.id, { value: match.date, origin: match.origins[0] }, { value: input.date, origin: input.origin })
    }
    if (input.content && !match.content) match.content = input.content
    exams.upsert(match)
    return { exam: match, created: false }
  }
  const exam: Exam = { id: uuidv4(), courseId: input.courseId, title: input.title.slice(0, 200), date: input.date, content: input.content, origins: [input.origin], createdBy: input.createdBy, createdAt: Date.now() }
  exams.upsert(exam)
  return { exam, created: true }
}

export function setTaskStatus(id: string, status: AcademicTask['status']) {
  const t = tasks.get(id)
  if (!t) throw new Error('Tarefa não encontrada')
  t.status = status
  t.completedAt = status === 'concluida' ? Date.now() : undefined
  tasks.upsert(t)
  refreshAlerts()
  return t
}

export function resolveConflict(id: string, value: number) {
  const c = conflicts.get(id)
  if (!c) throw new Error('Conflito não encontrado')
  c.status = 'resolved'
  c.chosen = value
  conflicts.upsert(c)
  if (c.subject === 'task') { const t = tasks.get(c.targetId); if (t) { t.due = value; tasks.upsert(t) } }
  else { const e = exams.get(c.targetId); if (e) { e.date = value; exams.upsert(e) } }
  refreshAlerts()
  return c
}

// ─── Alerts ──────────────────────────────────────────────────────────────────

/** Recomputes automatic alerts. Dismissed alerts stay dismissed (same deterministic id). */
export function refreshAlerts(now = Date.now()): Alert[] {
  const previous = new Map(alerts.all().map(a => [a.id, a]))
  const out: Alert[] = []
  const name = (courseId?: string) => (courseId ? courses.get(courseId)?.name : undefined)
  const add = (a: Omit<Alert, 'at'>) => out.push({ ...a, at: previous.get(a.id)?.at || now, dismissed: previous.get(a.id)?.dismissed })

  for (const t of tasks.all()) {
    if (t.status === 'concluida' || t.status === 'cancelada' || !t.due) continue
    const left = t.due - now
    const course = name(t.courseId)
    if (left < 0) {
      if (t.status !== 'atrasada') { t.status = 'atrasada'; tasks.upsert(t) }
      add({ id: `task:${t.id}:late`, level: 'urgent', title: `Atrasado: ${t.title}`, detail: `${course ? `${course} · ` : ''}venceu ${new Date(t.due).toLocaleString('pt-BR')}`, targetType: 'task', targetId: t.id })
    } else if (left < DAY) {
      add({ id: `task:${t.id}:24h`, level: 'urgent', title: `Entrega em menos de 24 h: ${t.title}`, detail: `${course ? `${course} · ` : ''}${new Date(t.due).toLocaleString('pt-BR')}`, targetType: 'task', targetId: t.id })
    } else if (left < 3 * DAY) {
      add({ id: `task:${t.id}:72h`, level: 'warning', title: `Prazo próximo: ${t.title}`, detail: `${course ? `${course} · ` : ''}${new Date(t.due).toLocaleString('pt-BR')}`, targetType: 'task', targetId: t.id })
    }
  }
  for (const e of exams.all()) {
    if (!e.date || e.date < now - DAY) continue
    const left = e.date - now
    if (left < 7 * DAY) add({ id: `exam:${e.id}:${left < 2 * DAY ? '48h' : '7d'}`, level: left < 2 * DAY ? 'urgent' : 'warning', title: `Prova ${left < 2 * DAY ? 'muito próxima' : 'nesta semana'}: ${e.title}`, detail: `${name(e.courseId) ? `${name(e.courseId)} · ` : ''}${new Date(e.date).toLocaleString('pt-BR')}`, targetType: 'exam', targetId: e.id })
  }
  for (const c of conflicts.all().filter(x => x.status === 'pending')) {
    const target = c.subject === 'task' ? tasks.get(c.targetId)?.title : exams.get(c.targetId)?.title
    add({ id: `conflict:${c.id}`, level: 'warning', title: `Datas diferentes para: ${target || 'item'}`, detail: `${c.options.length} fontes discordam — escolha a correta`, targetType: 'conflict', targetId: c.id })
  }
  for (const conn of connections.all().filter(x => x.status === 'error' || x.status === 'needs-auth')) {
    add({ id: `conn:${conn.id}:${conn.status}`, level: 'info', title: `${conn.name}: ${conn.status === 'needs-auth' ? 'precisa entrar novamente' : 'falha na sincronização'}`, detail: conn.lastError || '', targetType: 'connection', targetId: conn.id })
  }
  alerts.save(out)
  return out
}

// ─── Search ──────────────────────────────────────────────────────────────────

let indexCache: { key: string; bm25: Bm25<HubItem> } | null = null

function index() {
  const items = allItems()
  const key = `${hubDir()}:${itemsRevision()}`
  if (!indexCache || indexCache.key !== key) {
    indexCache = { key, bm25: new Bm25(items, i => `${i.title} ${i.text} ${i.origin.where} ${i.origin.author || ''} ${(i.attachments || []).map(a => a.name).join(' ')}`) }
  }
  return indexCache.bm25
}

export function searchHub(query: string, filter: { sources?: HubSource[]; courseId?: string; kinds?: HubItem['kind'][] } = {}, limit = 25): SearchHit[] {
  return index().search(query, 400)
    .filter(({ doc }) => (!filter.sources?.length || filter.sources.includes(doc.source)) && (!filter.courseId || doc.courseId === filter.courseId) && (!filter.kinds?.length || filter.kinds.includes(doc.kind)))
    .slice(0, limit)
    .map(({ doc, score }) => ({ item: doc, score, snippet: snippet(doc.text || doc.title, query) }))
}

// ─── Views ───────────────────────────────────────────────────────────────────

export function dashboard(now = Date.now()) {
  const al = refreshAlerts(now)
  const ts = tasks.all()
  const ex = exams.all()
  const weekEnd = now + 7 * DAY
  const items = allItems()
  return {
    alerts: al.filter(a => !a.dismissed).sort((a, b) => ({ urgent: 0, warning: 1, info: 2 }[a.level] - { urgent: 0, warning: 1, info: 2 }[b.level])),
    weekTasks: ts.filter(t => (t.status === 'pendente' || t.status === 'atrasada') && t.due && t.due <= weekEnd).sort((a, b) => a.due! - b.due!),
    undatedTasks: ts.filter(t => t.status === 'pendente' && !t.due),
    upcomingExams: ex.filter(e => e.date && e.date >= now - DAY).sort((a, b) => a.date! - b.date!).slice(0, 12),
    courses: courses.all().map(c => ({
      ...c,
      pending: ts.filter(t => t.courseId === c.id && t.status !== 'concluida' && t.status !== 'cancelada').length,
      nextExam: ex.filter(e => e.courseId === c.id && e.date && e.date >= now).sort((a, b) => a.date! - b.date!)[0],
      items: items.filter(i => i.courseId === c.id).length,
    })),
    needsAction: items.filter(i => i.action?.required).sort((a, b) => (b.origin.at || 0) - (a.origin.at || 0)).slice(0, 20),
    conflicts: conflicts.all().filter(c => c.status === 'pending'),
    totals: { items: items.length, tasks: ts.length, exams: ex.length, courses: courses.all().length },
  }
}

export function courseDossier(courseId: string) {
  const course = courses.get(courseId)
  if (!course) throw new Error('Disciplina não encontrada')
  const items = allItems().filter(i => i.courseId === courseId).sort((a, b) => (b.origin.at || 0) - (a.origin.at || 0))
  const profs = course.professors.map(normalize)
  return {
    course,
    tasks: tasks.all().filter(t => t.courseId === courseId),
    exams: exams.all().filter(e => e.courseId === courseId),
    professorMessages: items.filter(i => i.kind === 'message' || i.kind === 'announcement').filter(i => profs.some(p => p && normalize(i.origin.author || '').includes(p))).slice(0, 60),
    messages: items.filter(i => i.kind === 'message' || i.kind === 'announcement').slice(0, 120),
    materials: items.filter(i => i.kind === 'material' || i.kind === 'file' || (i.attachments?.length ?? 0) > 0).slice(0, 80),
    github: getItems('github').filter(i => i.kind === 'repo' && (course.githubRepos || []).includes(String(i.meta?.fullName || ''))),
    studies: studies.all().filter(s => s.courseId === courseId).sort((a, b) => b.createdAt - a.createdAt),
    conversations: items.filter(i => i.source === 'chatgpt' || i.source === 'gemini').slice(0, 40),
  }
}
