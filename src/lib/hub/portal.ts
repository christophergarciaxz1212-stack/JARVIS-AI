import { addOrMergeExam, addOrMergeTask, ensureCourse } from './academic'
import { hash } from './importers'
import { hubJson } from './llm'
import type { HubItem, Origin } from './types'

/** What the desktop app captures from a portal page the user opened (all frames merged). */
export interface PortalCapture {
  url: string
  title: string
  text: string
  tables: string[][][]
  links: Array<{ text: string; href: string }>
  loginRequired?: boolean
}

interface PortalData {
  courses?: Array<{ name: string; code?: string; professor?: string; status?: string; grades?: Array<{ label: string; value: string }>; absences?: number; maxAbsences?: number; attendancePercent?: number }>
  assignments?: Array<{ course?: string; title: string; due?: string; description?: string }>
  exams?: Array<{ course?: string; title: string; date?: string; content?: string }>
  materials?: Array<{ course?: string; title: string; url?: string }>
  notices?: Array<{ title: string; text?: string; date?: string }>
  calendar?: Array<{ title: string; date?: string }>
  situation?: string
}

export function parseIsoLocal(s?: string): number | undefined {
  if (!s) return undefined
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(s.trim())
  if (m) {
    const [, y, mo, d, h, mi] = m
    return new Date(Number(y), Number(mo) - 1, Number(d), h ? Number(h) : 23, h ? Number(mi) : 59).getTime()
  }
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s.trim())
  if (br) return new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]), 23, 59).getTime()
  return undefined
}

function tablesToText(tables: string[][][]) {
  return tables.map((t, i) => `Tabela ${i + 1}:\n${t.map(r => r.join(' | ')).join('\n')}`).join('\n\n')
}

/** Turns a captured portal page into organised academic data, keeping the page as the origin of each fact. */
export async function applyPortalCapture(c: PortalCapture, now = Date.now()) {
  if (c.loginRequired) throw Object.assign(new Error('A página pede login: entre no portal na janela do JARVIS e capture de novo'), { needsAuth: true })
  const origin: Origin = { source: 'portal', where: `Portal do Aluno › ${c.title || c.url}`, at: now, url: c.url }

  const data = await hubJson<PortalData>(
    `Você extrai dados acadêmicos de páginas do Portal do Aluno de uma faculdade brasileira. Use SOMENTE o que está na página; não invente.
Datas no formato YYYY-MM-DD ou YYYY-MM-DDTHH:mm. Hoje é ${new Date(now).toLocaleDateString('sv-SE')}.
Formato: {"courses":[{"name","code","professor","status","grades":[{"label","value"}],"absences","maxAbsences","attendancePercent"}],"assignments":[{"course","title","due","description"}],"exams":[{"course","title","date","content"}],"materials":[{"course","title","url"}],"notices":[{"title","text","date"}],"calendar":[{"title","date"}],"situation":"situação acadêmica geral, se houver"}
Omita listas vazias.`,
    `URL: ${c.url}\nTítulo: ${c.title}\n\n${tablesToText(c.tables).slice(0, 16_000)}\n\nTexto da página:\n${c.text.slice(0, 14_000)}\n\nLinks:\n${c.links.slice(0, 80).map(l => `${l.text} -> ${l.href}`).join('\n')}`,
  )

  const items: HubItem[] = [{
    id: `portal-page-${hash(c.url)}`,
    source: 'portal', kind: 'note',
    title: c.title || 'Página do portal',
    text: `${c.text.slice(0, 20_000)}\n${tablesToText(c.tables).slice(0, 10_000)}`,
    origin, meta: { url: c.url, situation: data.situation },
    importedAt: now,
  }]
  const summary = { courses: 0, tasks: 0, exams: 0, materials: 0, notices: 0 }
  const courseId = (name?: string) => (name ? ensureCourse(name, 'portal').id : undefined)

  for (const course of data.courses || []) {
    if (!course.name) continue
    ensureCourse(course.name, 'portal', {
      code: course.code,
      professors: course.professor ? [course.professor] : [],
      status: course.status,
      grades: course.grades?.map(g => ({ ...g, origin })),
      attendance: course.absences !== undefined || course.attendancePercent !== undefined
        ? { absences: course.absences, maxAbsences: course.maxAbsences, percent: course.attendancePercent, origin }
        : undefined,
    })
    summary.courses++
  }
  for (const a of data.assignments || []) {
    if (!a.title) continue
    addOrMergeTask({ courseId: courseId(a.course), title: a.title, description: a.description, due: parseIsoLocal(a.due), origin, createdBy: 'portal' })
    summary.tasks++
  }
  for (const e of data.exams || []) {
    if (!e.title) continue
    addOrMergeExam({ courseId: courseId(e.course), title: e.title, date: parseIsoLocal(e.date), content: e.content, origin, createdBy: 'portal' })
    summary.exams++
  }
  for (const m of data.materials || []) {
    if (!m.title) continue
    items.push({ id: `portal-mat-${hash(c.url, m.title, m.url)}`, source: 'portal', kind: 'material', title: m.title, text: m.title, courseId: courseId(m.course), origin: { ...origin, url: m.url || c.url }, attachments: m.url ? [{ name: m.title, url: m.url }] : [], importedAt: now })
    summary.materials++
  }
  for (const n of [...(data.notices || []), ...(data.calendar || []).map(x => ({ title: x.title, text: x.title, date: x.date }))]) {
    if (!n.title) continue
    items.push({ id: `portal-notice-${hash(c.url, n.title, n.date)}`, source: 'portal', kind: 'announcement', title: n.title, text: `${n.title}\n${n.text || ''}`, origin: { ...origin, at: parseIsoLocal(n.date) || now }, importedAt: now })
    summary.notices++
  }
  return { items, summary }
}
