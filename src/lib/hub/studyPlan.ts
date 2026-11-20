/**
 * Plano de estudos determinístico: examina provas e entregas do Hub e distribui
 * blocos de estudo. Sem IA obrigatória — funciona sempre; usa datas reais.
 */
import { courses, exams, tasks } from './store'
import type { AcademicTask, Course, Exam } from './types'

const DAY = 86400_000

export interface StudyBlock {
  courseId?: string
  course: string
  reason: string
  day: string
  durationMin: number
  kind: 'exam' | 'task' | 'review'
}

const WEEKDAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']
const fmtDay = (ms: number) => WEEKDAYS[new Date(ms).getDay()]
const fmtDate = (ms: number) => new Date(ms).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
const alias = (c?: Course) => c?.name || 'Geral'

/** Próximas provas (14 dias) e próximas entregas (7 dias). */
export function upcoming(now = Date.now()) {
  const ex = exams.all().filter(e => e.date && e.date >= now - DAY && e.date <= now + 14 * DAY).sort((a, b) => a.date! - b.date!)
  const ts = tasks.all().filter(t => t.status === 'pendente' || t.status === 'atrasada')
    .filter(t => t.due && t.due <= now + 7 * DAY)
    .sort((a, b) => a.due! - b.due!)
  return { exams: ex, tasks: ts }
}

/**
 * Aloca blocos de 45–60 min antes de cada avaliação/entrega, do mais urgente para
 * o mais distante, seguindo um teto diário. Terça e quarta de manhã priorizadas.
 */
export function buildStudyPlan(now = Date.now(), maxBlocksPerDay = 3): StudyBlock[] {
  const cs = courses.all()
  const byId = new Map(cs.map(c => [c.id, c] as const))
  const blocks: StudyBlock[] = []
  const { exams: ex, tasks: ts } = upcoming(now)

  const totalByCourse = new Map<string, number>()
  for (const e of ex) totalByCourse.set(e.courseId || 'geral', (totalByCourse.get(e.courseId || 'geral') || 0) + 3)
  for (const t of ts) totalByCourse.set(t.courseId || 'geral', (totalByCourse.get(t.courseId || 'geral') || 0) + 2)

  for (const e of ex) {
    const c = e.courseId ? byId.get(e.courseId) : undefined
    const daysUntil = Math.max(0, Math.floor((e.date! - now) / DAY))
    const duration = daysUntil <= 2 ? 60 : daysUntil <= 7 ? 50 : 45
    blocks.push({
      courseId: e.courseId, course: alias(c),
      reason: `Prova${c ? ` de ${c.name}` : ''}${e.title ? ` — ${e.title}` : ''} em ${fmtDate(e.date!)}`,
      day: fmtDay(e.date! - (daysUntil ? 1 : 0) * DAY),
      durationMin: duration,
      kind: 'exam',
    })
  }
  for (const t of ts.slice(0, 8)) {
    if (!t.due) continue
    const c = t.courseId ? byId.get(t.courseId) : undefined
    const daysUntil = Math.floor((t.due - now) / DAY)
    blocks.push({
      courseId: t.courseId, course: alias(c),
      reason: `${t.type === 'projeto' ? 'Projeto' : t.type === 'atividade' ? 'Atividade' : 'Entrega'}: ${t.title}${t.due ? ` — vence em ${daysUntil >= 0 ? `${daysUntil} dia${daysUntil === 1 ? '' : 's'}` : 'atraso'}` : ''}`,
      day: fmtDay(t.due), durationMin: t.type === 'projeto' ? 60 : 45,
      kind: 'task',
    })
  }

  // Revisão leve da semana (repartição justa entre disciplinas com pendência)
  const sortedCourses = [...totalByCourse.entries()].sort((a, b) => b[1] - a[1])
  for (let i = 0; i < Math.min(sortedCourses.length, 3); i++) {
    const [courseId, weight] = sortedCourses[i]
    if (weight < 2) continue
    const c = courseId !== 'geral' ? byId.get(courseId) : undefined
    blocks.push({ courseId, course: alias(c), reason: `Revisão semanal — ${alias(c)}`, day: fmtDay(now + (i + 1) * DAY), durationMin: 45, kind: 'review' })
  }

  // Mistura inteligente: urgentes primeiro, no máximo N blocos por dia (7h–22h)
  const byDay = new Map<string, StudyBlock[]>()
  for (const b of blocks) {
    const list = byDay.get(b.day) || []
    if (list.length < maxBlocksPerDay) { list.push(b); byDay.set(b.day, list) }
  }
  return [...byDay.values()].flat()
}

/** Formata como markdown para exibir no chat ou salvar como anotação. */
export function formatStudyPlan(now = Date.now()): string {
  const bs = buildStudyPlan(now)
  if (!bs.length) return '📅 Não encontrei provas nos próximos 14 dias nem entregas nos próximos 7 — tudo em dia para estudar com calma.'
  const grouped = new Map<string, StudyBlock[]>()
  for (const b of bs) {
    const list = grouped.get(b.day) || []
    list.push(b)
    grouped.set(b.day, list)
  }
  const lines = ['## 📚 Plano de estudos (próximos 14 dias)', '']
  for (const [day, blocks] of grouped) {
    lines.push(`**${day}**`)
    for (const b of blocks) {
      const icon = b.kind === 'exam' ? '📝' : b.kind === 'task' ? '✅' : '🔁'
      lines.push(`- ${icon} ${b.course} · ${b.durationMin} min — ${b.reason}`)
    }
    lines.push('')
  }
  lines.push('_Gerado com os dados reais do seu Hub Escolar; para tecnologias que não entenda, peça ajuda ao JARVIS no chat._')
  return lines.join('\n')
}
