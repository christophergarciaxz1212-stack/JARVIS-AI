import { addOrMergeExam, addOrMergeTask, ensureCourse, findCourseByName, matchCourse, refreshAlerts } from './academic'
import { hubJson } from './llm'
import { courses, updateItems } from './store'
import { academicSignals, extractDates } from './text'
import type { HubItem, HubSource } from './types'

const DAY = 86400_000
const LLM_BATCH = 12
const MAX_LLM_BATCHES = 12

interface Verdict {
  i: number
  academic: boolean
  action: boolean
  actionSummary?: string
  type: 'task' | 'exam' | 'material' | 'notice' | 'none'
  course?: string | null
  title?: string
  date?: string | null
}

function parseLocal(s?: string | null): number | undefined {
  if (!s) return undefined
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(s)
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), m[4] ? Number(m[4]) : 23, m[4] ? Number(m[5]) : 59).getTime() : undefined
}

/** Local wall-clock time (the student's timezone), never UTC: the model must see the dates people wrote. */
function localIso(ms: number) {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

function firstLine(text: string) {
  return text.split('\n').map(s => s.trim()).find(Boolean)?.slice(0, 120) || 'Atividade'
}

export interface OrganizeSummary {
  analyzed: number
  withAi: number
  tasksCreated: number
  examsCreated: number
  actionRequired: number
  coursesLinked: number
  aiError?: string
}

/**
 * Runs after every sync/import: links items to courses, turns academic messages into tasks and
 * exams (with the message as origin), flags messages that need an action, refreshes alerts.
 */
export async function organize(items: HubItem[], opts: { useAi?: boolean; now?: number } = {}): Promise<OrganizeSummary> {
  const now = opts.now ?? Date.now()
  const summary: OrganizeSummary = { analyzed: 0, withAi: 0, tasksCreated: 0, examsCreated: 0, actionRequired: 0, coursesLinked: 0 }
  if (!items.length) return summary
  const patches = new Map<string, Partial<HubItem>>()
  const patch = (id: string, p: Partial<HubItem>) => patches.set(id, { ...patches.get(id), ...p })

  // 1. Structured sources first: Teams classes become courses, Teams assignments become tasks
  for (const it of items) {
    if (it.source === 'teams' && it.kind === 'course') ensureCourse(it.title, 'teams', { aliases: [] })
  }
  for (const it of items) {
    let courseId = it.courseId
    if (!courseId) {
      const c = matchCourse(`${it.title}\n${it.text}`, it.origin)
      if (c) { courseId = c.id; patch(it.id, { courseId }); summary.coursesLinked++ }
    }
    if (it.kind === 'assignment') {
      const r = addOrMergeTask({ courseId, title: it.title, description: it.text.slice(0, 1000), due: (it.meta?.due as number) || undefined, origin: it.origin, createdBy: it.source === 'teams' ? 'teams' : 'organizer' })
      if (r.created) summary.tasksCreated++
      patch(it.id, { analyzedAt: now, action: { required: true, summary: `Entregar: ${it.title}` } })
    }
    if (it.kind === 'event' && academicSignals(`${it.title} ${it.text}`).exam) {
      const r = addOrMergeExam({ courseId, title: it.title, date: (it.meta?.start as number) || it.origin.at, origin: it.origin, createdBy: 'organizer' })
      if (r.created) summary.examsCreated++
    }
  }

  // 2. Messages with academic signals, most recent first, go to the AI in batches
  const candidates = items
    .filter(it => !it.analyzedAt && ['message', 'announcement', 'material', 'event'].includes(it.kind) && !['chatgpt', 'gemini', 'github'].includes(it.source))
    .filter(it => { const s = academicSignals(`${it.title} ${it.text}`); return s.exam || s.task || s.material })
    .sort((a, b) => (b.origin.at || 0) - (a.origin.at || 0))
  const recent = candidates.filter(it => !it.origin.at || it.origin.at > now - 120 * DAY)

  const courseNames = courses.all().map(c => c.name)
  const batches: HubItem[][] = []
  for (let i = 0; i < recent.length && batches.length < MAX_LLM_BATCHES; i += LLM_BATCH) batches.push(recent.slice(i, i + LLM_BATCH))
  const aiHandled = new Set<string>()
  const handled = new Set<string>() // itens que já viraram tarefa/prova (IA ou regra)

  if (opts.useAi !== false) {
    for (const batch of batches) {
      try {
        const verdicts = await hubJson<{ items: Verdict[] }>(
          `Você organiza a vida acadêmica de um estudante universitário brasileiro. Para cada mensagem, diga se é acadêmica, se exige ação do estudante, o tipo (task = trabalho/atividade/entrega, exam = prova/avaliação, material, notice = aviso, none), a disciplina e a data/prazo.
Disciplinas conhecidas: ${courseNames.join('; ') || '(nenhuma ainda)'}.
Resolva datas relativas ("amanhã", "sexta") usando a data da própria mensagem. Datas: YYYY-MM-DD ou YYYY-MM-DDTHH:mm. Não invente datas.
Formato: {"items":[{"i":0,"academic":true,"action":true,"actionSummary":"o que fazer","type":"task","course":"nome ou null","title":"título curto","date":"YYYY-MM-DD ou null"}]}`,
          batch.map((it, i) => {
            const dates = extractDates(it.text, new Date(it.origin.at || now)).map(d => localIso(d.date.getTime())).join(', ')
            return `[${i}] ${it.origin.where} · ${it.origin.author || ''} · ${it.origin.at ? localIso(it.origin.at) : 'sem data'}${dates ? ` · datas no texto: ${dates}` : ''}\n${it.text.slice(0, 900)}`
          }).join('\n\n'),
        )
        for (const v of verdicts.items || []) {
          const it = batch[v.i]
          if (!it) continue
          aiHandled.add(it.id)
          summary.withAi++
          let courseId = patches.get(it.id)?.courseId || it.courseId
          if (!courseId && v.course) {
            const known = findCourseByName(v.course)
            // Only structured sources may create a course; chatter only links to existing ones
            courseId = known?.id || (it.source === 'teams' || it.source === 'portal' ? ensureCourse(v.course, 'organizer').id : undefined)
          }
          patch(it.id, { analyzedAt: now, courseId, action: { required: !!v.action && !!v.academic, summary: v.actionSummary } })
          if (v.action && v.academic) summary.actionRequired++
          const date = parseLocal(v.date)
          if (v.academic && v.type === 'task') {
            if (addOrMergeTask({ courseId, title: v.title || firstLine(it.text), description: it.text.slice(0, 800), due: date, origin: it.origin, createdBy: 'organizer' }).created) { summary.tasksCreated++; handled.add(it.id) }
          } else if (v.academic && v.type === 'exam') {
            if (addOrMergeExam({ courseId, title: v.title || firstLine(it.text), date, origin: it.origin, createdBy: 'organizer' }).created) { summary.examsCreated++; handled.add(it.id) }
          } else if (v.academic && v.type === 'material') {
            patch(it.id, { kind: 'material' })
          }
        }
      } catch (e) {
        summary.aiError = (e as Error).message
        break
      }
    }
  }

  // 3. Rede de segurança por regras: cobre o que a IA errou ou ignorou (ex.: chamou de "aviso"
  //    uma prova com data). Itens já transformados em tarefa/prova não são repetidos.
  for (const it of candidates) {
    if (handled.has(it.id)) continue
    const s = academicSignals(`${it.title} ${it.text}`)
    const date = extractDates(it.text, new Date(it.origin.at || now))[0]?.date.getTime()
    const courseId = patches.get(it.id)?.courseId || it.courseId
    // Sem data só guardamos provas/tarefas de mensagens recentes, para não virar ruído
    if (s.exam && (date || (it.origin.at || 0) > now - 30 * DAY)) {
      if (addOrMergeExam({ courseId, title: firstLine(it.text), date, origin: it.origin, createdBy: 'organizer' }).created) { summary.examsCreated++; handled.add(it.id) }
    } else if (s.task && date) {
      if (addOrMergeTask({ courseId, title: firstLine(it.text), description: it.text.slice(0, 800), due: date, origin: it.origin, createdBy: 'organizer' }).created) { summary.tasksCreated++; handled.add(it.id) }
    }
    patch(it.id, { analyzedAt: now, action: { required: !!(date && date > now && (s.exam || s.task)), summary: s.exam ? 'Prova mencionada' : s.task ? 'Entrega mencionada' : undefined } })
  }
  summary.analyzed = patches.size

  // 4. Persist per source
  const bySource = new Map<HubSource, Set<string>>()
  for (const it of items) if (patches.has(it.id)) bySource.set(it.source, (bySource.get(it.source) || new Set()).add(it.id))
  for (const [source, ids] of bySource) {
    updateItems(source, item => (ids.has(item.id) ? { ...item, ...patches.get(item.id) } : item))
  }

  refreshAlerts(now)
  return summary
}
