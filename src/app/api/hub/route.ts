import fs from 'fs'
import path from 'path'
import { NextRequest } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { createConversation } from '@/lib/db'
import { createProject } from '@/lib/agents/store'
import {
  addOrMergeExam, addOrMergeTask, courseDossier, dashboard, ensureCourse, refreshAlerts, resolveConflict, searchHub, setTaskStatus,
} from '@/lib/hub/academic'
import {
  ask, configure, decideAction, disconnect, importFile, listConnections, portalCapture, readLog, reorganizeAll, requestAction, startHubScheduler, sync, syncAll,
} from '@/lib/hub/hub'
import { parseIsoLocal } from '@/lib/hub/portal'
import { actions, alerts, allItems, conflicts, courses, exams, getItems, hubDir, studies, tasks } from '@/lib/hub/store'
import { startTeamsLogin, teamsLoginStatus } from '@/lib/hub/teams'
import { waDiscover, waSetAcademic, waStart, waStatus, waStop } from '@/lib/whatsapp/bridge'
import { openPortal, captureNow, closePortal, portalState } from '@/lib/portal/playwrightPortal'
import type { HubSource, PendingAction } from '@/lib/hub/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SOURCES: HubSource[] = ['portal', 'whatsapp', 'teams', 'github', 'chatgpt', 'gemini', 'calendar', 'files', 'manual']
const src = (v: unknown): HubSource => {
  if (!SOURCES.includes(v as HubSource)) throw new Error('Fonte inválida')
  return v as HubSource
}
const fail = (e: unknown, status = 400) => Response.json({ error: e instanceof Error ? e.message : String(e) }, { status })

export async function GET(req: NextRequest) {
  startHubScheduler()
  const sp = new URL(req.url).searchParams
  try {
    switch (sp.get('action') || 'dashboard') {
      case 'dashboard': return Response.json(dashboard())
      case 'courses': return Response.json({ courses: courses.all() })
      case 'course': return Response.json(courseDossier(String(sp.get('id'))))
      case 'tasks': return Response.json({ tasks: tasks.all(), exams: exams.all(), courses: courses.all() })
      case 'items': {
        const source = sp.get('source')
        const courseId = sp.get('courseId')
        const list = (source ? getItems(src(source)) : allItems())
          .filter(i => !courseId || i.courseId === courseId)
          .filter(i => sp.get('kind') ? i.kind === sp.get('kind') : !['repo', 'commit', 'course', 'note'].includes(i.kind))
          .sort((a, b) => (b.origin.at || 0) - (a.origin.at || 0))
        const limit = Math.min(Number(sp.get('limit')) || 150, 500)
        return Response.json({ items: list.slice(0, limit), total: list.length })
      }
      case 'search': {
        const sources = (sp.get('sources') || '').split(',').filter(Boolean).map(src)
        return Response.json({ hits: searchHub(String(sp.get('q') || ''), { sources, courseId: sp.get('courseId') || undefined }, 40) })
      }
      case 'connections': {
        const connections = listConnections()
        let whatsappLive: unknown
        try { whatsappLive = await waStatus() } catch { whatsappLive = { status: 'error', error: 'status indisponível' } }
        return Response.json({ connections, teamsLogin: teamsLoginStatus(), whatsappLive })
      }
      case 'portal-status': return Response.json(portalState())
      case 'conflicts': return Response.json({ conflicts: conflicts.all(), tasks: tasks.all(), exams: exams.all() })
      case 'actions': return Response.json({ actions: actions.all().sort((a, b) => b.createdAt - a.createdAt).slice(0, 100) })
      case 'studies': return Response.json({ studies: studies.all().sort((a, b) => b.createdAt - a.createdAt) })
      case 'log': return Response.json({ log: readLog(150) })
      default: return fail('Ação inválida', 404)
    }
  } catch (e) {
    return fail(e)
  }
}

export async function POST(req: NextRequest) {
  startHubScheduler()
  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch {}
  const action = String(body.action || '')
  try {
    switch (action) {
      case 'configure': return Response.json({ connection: configure(src(body.source), (body.config || {}) as Record<string, unknown>) })
      case 'sync': return Response.json(await sync(src(body.source)))
      case 'sync-all': return Response.json(await syncAll())
      case 'import': return Response.json(await importFile(src(body.source), String(body.path || ''), { name: body.name ? String(body.name) : undefined }))
      case 'portal-capture': return Response.json(await portalCapture(body.capture as Parameters<typeof portalCapture>[0]))
      case 'teams-login': return Response.json({ flow: await startTeamsLogin() })
      case 'disconnect':
        if (body.erase === true && body.confirm !== true) return fail('Confirme para apagar os dados importados')
        disconnect(src(body.source), body.erase === true)
        return Response.json({ ok: true })
      case 'reorganize': return Response.json(await reorganizeAll())
      case 'study-plan': {
        const { formatStudyPlan, buildStudyPlan } = await import('@/lib/hub/studyPlan')
        return Response.json({ markdown: formatStudyPlan(), blocks: buildStudyPlan() })
      }
      case 'weekly-summary': {
        const { weeklySummary } = await import('@/lib/hub/hub')
        return Response.json({ markdown: weeklySummary() })
      }
      case 'ask': return Response.json(await ask(String(body.question || '')))

      case 'course-save': {
        const name = String(body.name || '').trim()
        if (!name) return fail('Informe o nome da disciplina')
        const c = ensureCourse(name, 'user', {
          code: body.code ? String(body.code) : undefined,
          professors: Array.isArray(body.professors) ? body.professors.map(String).filter(Boolean) : [],
          aliases: Array.isArray(body.aliases) ? body.aliases.map(String).filter(Boolean) : [],
        })
        if (Array.isArray(body.githubRepos)) courses.upsert({ ...c, githubRepos: body.githubRepos.map(String) })
        return Response.json({ course: courses.get(c.id) })
      }
      case 'course-delete': courses.remove(String(body.id)); return Response.json({ ok: true })

      case 'task-add': {
        const origin = { source: 'manual' as const, where: 'Adicionado por você', at: Date.now() }
        if (body.type === 'prova') {
          return Response.json(addOrMergeExam({ courseId: body.courseId ? String(body.courseId) : undefined, title: String(body.title || 'Prova'), date: parseIsoLocal(String(body.due || '')), content: String(body.description || ''), origin, createdBy: 'user' }))
        }
        return Response.json(addOrMergeTask({ courseId: body.courseId ? String(body.courseId) : undefined, title: String(body.title || 'Tarefa'), description: String(body.description || ''), due: parseIsoLocal(String(body.due || '')), type: body.type === 'atividade' ? 'atividade' : 'trabalho', origin, createdBy: 'user' }))
      }
      case 'task-status': return Response.json({ task: setTaskStatus(String(body.id), body.status as 'pendente' | 'concluida' | 'cancelada') })
      case 'task-delete': tasks.remove(String(body.id)); refreshAlerts(); return Response.json({ ok: true })
      case 'exam-delete': exams.remove(String(body.id)); refreshAlerts(); return Response.json({ ok: true })
      case 'resolve-conflict': return Response.json({ conflict: resolveConflict(String(body.id), Number(body.value)) })
      case 'dismiss-alert': {
        const a = alerts.get(String(body.id))
        if (a) alerts.upsert({ ...a, dismissed: true })
        return Response.json({ ok: true })
      }
      case 'study-save':
        return Response.json({ study: studies.upsert({ id: uuidv4(), courseId: body.courseId ? String(body.courseId) : undefined, kind: 'resumo', title: String(body.title || 'Anotação'), content: String(body.content || ''), createdBy: 'você', createdAt: Date.now(), origins: [] }) })

      case 'agent-session': {
        // The academic team works in the hub's own folder (study notes, summaries, exercises)
        const folder = path.join(hubDir(), 'workspace')
        fs.mkdirSync(folder, { recursive: true })
        const readme = path.join(folder, 'LEIA-ME.md')
        if (!fs.existsSync(readme)) fs.writeFileSync(readme, '# Hub Escolar\n\nPasta de trabalho da Equipe Acadêmica do JARVIS: resumos, exercícios e revisões.\n', 'utf-8')
        const project = createProject('Hub Escolar', folder)
        const id = uuidv4()
        const request = String(body.request || '').trim()
        createConversation(id, 'equipe', request ? request.slice(0, 60) : 'Equipe Acadêmica', { projectId: project.id, kind: 'team', teamId: 'preset-academic' })
        return Response.json({ session: { id, title: request ? request.slice(0, 60) : 'Equipe Acadêmica', model: 'equipe', projectId: project.id, kind: 'team', status: 'active', archived: false, createdAt: Date.now(), updatedAt: Date.now(), messageCount: 0, running: false, teamId: 'preset-academic' }, project })
      }

      case 'action-request': return Response.json({ action: requestAction(body.type as PendingAction['type'], (body.payload || {}) as Record<string, unknown>, 'você') })
      case 'action-approve':
      case 'action-deny': return Response.json({ action: await decideAction(String(body.id), action === 'action-approve') })
      case 'whatsapp-connect': {
        // Marca o modo ao vivo no cadastro e pareia (QR aparece na UI do Hub)
        configure('whatsapp', { live: true, liveSince: Date.now() })
        const r = await waStart()
        return Response.json(r)
      }
      case 'portal-open': {
        const fromBody = typeof body.url === 'string' ? String(body.url) : undefined
        const portalConn = listConnections().find(c => c.id === 'portal')
        const startUrl = String(fromBody || portalConn?.config.startUrl || 'https://www.serverso.com.br/home')
        if (!/^https?:\/\//i.test(startUrl)) return fail('URL inválida')
        configure('portal', { startUrl })
        return Response.json(await openPortal(startUrl))
      }
      case 'portal-capture-now': return Response.json(await captureNow())
      case 'portal-close': return Response.json(await closePortal())
      case 'whatsapp-disconnect': {
        const erase = body.erase === true
        await waStop(erase)
        if (erase) { disconnect('whatsapp', true) } else { configure('whatsapp', { live: false }) }
        return Response.json({ ok: true })
      }
      case 'whatsapp-discover': return Response.json({ chats: await waDiscover() })
      case 'whatsapp-toggle-chat': {
        const jid = String(body.jid || '')
        if (!jid) return fail('Informe o grupo (jid)')
        const academic = body.academic !== false
        return Response.json({ academicJids: waSetAcademic(jid, academic) })
      }
      case 'whatsapp-toggle-chats': {
        const jids = Array.isArray(body.jids) ? body.jids.map(String) : []
        const { waSetAcademicAll } = await import('@/lib/whatsapp/bridge')
        return Response.json({ academicJids: waSetAcademicAll(jids) })
      }
      default: return fail('Ação inválida', 404)
    }
  } catch (e) {
    return fail(e)
  }
}
