'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import Markdown from '@/components/chat/Markdown'
import {
  AlertTriangle, BookOpen, Calendar, Check, CheckCircle2, ChevronRight, Circle, ClipboardList, GraduationCap, Inbox,
  Link2, Loader2, MessageCircleQuestion, Plus, RefreshCw, Search, ShieldCheck, Sparkles, Trash2, Users, X,
} from 'lucide-react'
import { toast } from 'sonner'
import HubConnections from './HubConnections'
import { hub, originText, SOURCE_META, when, type Dashboard, type Dossier } from './hubApi'
import type { AcademicTask, Course, Exam, HubItem, HubSource, Origin, PendingAction, SearchHit } from '@/lib/hub/types'
import type { SessionMeta } from '@/lib/agents/types'

type Tab = 'painel' | 'disciplinas' | 'tarefas' | 'mensagens' | 'perguntar' | 'conexoes' | 'aprovacoes'

const TABS: Array<{ id: Tab; label: string; icon: typeof Inbox }> = [
  { id: 'painel', label: 'Painel', icon: GraduationCap },
  { id: 'disciplinas', label: 'Disciplinas', icon: BookOpen },
  { id: 'tarefas', label: 'Tarefas & Provas', icon: ClipboardList },
  { id: 'mensagens', label: 'Mensagens', icon: Inbox },
  { id: 'perguntar', label: 'Perguntar & Buscar', icon: MessageCircleQuestion },
  { id: 'conexoes', label: 'Conexões', icon: Link2 },
  { id: 'aprovacoes', label: 'Aprovações', icon: ShieldCheck },
]

const card = 'rounded-2xl border border-white/[0.07] bg-[rgba(6,14,24,0.88)]'

export default function HubWorkspace({ onOpenSession }: { onOpenSession: (s: SessionMeta) => void }) {
  const [tab, setTab] = useState<Tab>('painel')
  const [dash, setDash] = useState<Dashboard | null>(null)
  const [pendingActions, setPendingActions] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [courseId, setCourseId] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const notified = useRef(new Set<string>())

  const load = useCallback(async () => {
    try {
      const [d, a] = await Promise.all([hub.dashboard(), hub.actions()])
      setDash(d)
      setPendingActions(a.actions.filter(x => x.status === 'pending').length)
      // Desktop notification for new urgent alerts (once per alert)
      for (const al of d.alerts.filter(x => x.level === 'urgent')) {
        if (notified.current.has(al.id)) continue
        notified.current.add(al.id)
        try {
          if ('Notification' in window && Notification.permission === 'granted') new Notification(`🎓 ${al.title}`, { body: al.detail })
        } catch {}
      }
    } catch (e) { toast.error((e as Error).message) }
  }, [])

  useEffect(() => {
    try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission() } catch {}
  }, [])
  useEffect(() => { load() }, [load, version])
  useEffect(() => {
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [load])

  const changed = useCallback(() => setVersion(v => v + 1), [])

  const syncAll = async () => {
    setSyncing(true)
    try {
      const r = await hub.act<Record<string, { added?: number; error?: string }>>('sync-all')
      const parts = Object.entries(r || {}).map(([k, v]) => v.error ? `${k}: erro` : `${k}: +${v.added ?? 0}`)
      toast.success(parts.length ? `Sincronizado — ${parts.join(' · ')}` : 'Nenhuma fonte conectada para sincronizar')
      changed()
    } catch (e) { toast.error((e as Error).message) } finally { setSyncing(false) }
  }

  const startTeam = async () => {
    try {
      const r = await hub.act<{ session: SessionMeta }>('agent-session')
      toast.success('Equipe Acadêmica pronta')
      onOpenSession(r.session)
    } catch (e) { toast.error((e as Error).message) }
  }

  const openCourse = (id: string) => { setCourseId(id); setTab('disciplinas') }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="px-5 pt-4 pb-3 flex items-center gap-3 flex-wrap">
        <motion.div initial={false} animate={{ rotate: 0, scale: 1, opacity: 1 }} className="w-10 h-10 rounded-2xl bg-gradient-to-br from-cyan-400/30 to-violet-500/30 border border-cyan-400/30 flex items-center justify-center shadow-[0_0_24px_rgba(34,211,238,0.25)]">
          <GraduationCap size={20} className="text-cyan-200" />
        </motion.div>
        <div>
          <h1 className="text-lg font-semibold text-white tracking-wide">Hub Escolar</h1>
          <p className="text-[11px] text-white/40">
            {dash ? `${dash.totals.courses} disciplina(s) · ${dash.totals.tasks} tarefa(s) · ${dash.totals.exams} prova(s) · ${dash.totals.items} mensagem(ns) e arquivo(s) organizados` : 'Carregando…'}
          </p>
        </div>
        <div className="flex-1" />
        <button onClick={startTeam} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs text-violet-100 bg-violet-500/15 hover:bg-violet-500/25 border border-violet-400/30">
          <Users size={13} /> Equipe Acadêmica
        </button>
        <button onClick={syncAll} disabled={syncing} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs text-cyan-100 bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-400/30 disabled:opacity-50">
          <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} /> Sincronizar tudo
        </button>
      </div>

      {/* Tabs */}
      <div className="px-5 flex gap-1 border-b border-white/5 overflow-x-auto">
        {TABS.map(t => {
          const badge = t.id === 'aprovacoes' ? pendingActions : t.id === 'painel' ? (dash?.alerts.filter(a => a.level === 'urgent').length || 0) : 0
          return (
            <button key={t.id} onClick={() => { setTab(t.id); if (t.id !== 'disciplinas') setCourseId(null) }} className={`relative flex items-center gap-1.5 px-3 py-2 text-xs whitespace-nowrap transition-colors ${tab === t.id ? 'text-cyan-200' : 'text-white/40 hover:text-white/70'}`}>
              <t.icon size={13} /> {t.label}
              {badge > 0 && <span className="ml-0.5 min-w-4 h-4 px-1 rounded-full bg-red-500/80 text-[10px] text-white flex items-center justify-center">{badge}</span>}
              {tab === t.id && <motion.div layoutId="hub-tab" className="absolute left-2 right-2 -bottom-px h-0.5 bg-cyan-400 rounded-full shadow-[0_0_8px_rgba(34,211,238,0.8)]" />}
            </button>
          )
        })}
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        <AnimatePresence mode="wait">
          <motion.div key={tab + (courseId || '')} initial={false} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
            {tab === 'painel' && dash && <Panel dash={dash} changed={changed} openCourse={openCourse} goConnections={() => setTab('conexoes')} />}
            {tab === 'disciplinas' && dash && (courseId
              ? <CourseView id={courseId} back={() => setCourseId(null)} changed={changed} version={version} />
              : <Courses dash={dash} open={openCourse} changed={changed} />)}
            {tab === 'tarefas' && <TasksView changed={changed} version={version} />}
            {tab === 'mensagens' && <MessagesView courses={dash?.courses || []} />}
            {tab === 'perguntar' && <AskView />}
            {tab === 'conexoes' && <HubConnections onChanged={changed} />}
            {tab === 'aprovacoes' && <ApprovalsView changed={changed} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

// ─── Small pieces ────────────────────────────────────────────────────────────

function SourceChip({ o }: { o: Origin }) {
  const m = SOURCE_META[o.source]
  const inner = <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-white/[0.04] border border-white/[0.06] text-white/50 max-w-full" title={originText(o)}>
    <span>{m?.icon}</span><span className="truncate">{o.where}{o.author ? ` · ${o.author}` : ''}</span>
  </span>
  return o.url ? <a href={o.url} target="_blank" rel="noreferrer" className="hover:opacity-80 max-w-full">{inner}</a> : inner
}

function Origins({ list }: { list: Origin[] }) {
  return <div className="flex flex-wrap gap-1 mt-1">{list.slice(0, 4).map((o, i) => <SourceChip key={i} o={o} />)}{list.length > 4 && <span className="text-[10px] text-white/30">+{list.length - 4}</span>}</div>
}

function Section({ title, icon: Icon, children, right }: { title: string; icon: typeof Inbox; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className={`${card} p-4`}>
      <div className="flex items-center gap-2 mb-3">
        <Icon size={14} className="text-cyan-300" />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-white/70">{title}</h3>
        <div className="flex-1" />{right}
      </div>
      {children}
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-white/30 py-3 text-center">{children}</p>
}

function courseName(courses: Course[], id?: string) {
  return id ? courses.find(c => c.id === id)?.name : undefined
}

function TaskRow({ t, courses, changed }: { t: AcademicTask; courses: Course[]; changed: () => void }) {
  const done = t.status === 'concluida'
  const late = t.status === 'atrasada'
  const toggle = async () => {
    try { await hub.act('task-status', { id: t.id, status: done ? 'pendente' : 'concluida' }); changed() } catch (e) { toast.error((e as Error).message) }
  }
  return (
    <motion.div layout className="flex items-start gap-2.5 py-2 border-b border-white/[0.04] last:border-0 group">
      <button onClick={toggle} title={done ? 'Reabrir' : 'Marcar como concluída'} className="mt-0.5 text-white/40 hover:text-green-300">
        {done ? <CheckCircle2 size={16} className="text-green-400" /> : <Circle size={16} />}
      </button>
      <div className="flex-1 min-w-0">
        <div className={`text-sm ${done ? 'line-through text-white/30' : 'text-white/85'}`}>{t.title}</div>
        <div className="text-[11px] flex items-center gap-2 flex-wrap">
          <span className={late ? 'text-red-300' : t.due && t.due - Date.now() < 2 * 86400_000 && !done ? 'text-amber-200' : 'text-white/40'}>{late ? '⚠ atrasada · ' : ''}{when(t.due)}</span>
          {courseName(courses, t.courseId) && <span className="text-cyan-200/60">{courseName(courses, t.courseId)}</span>}
          <span className="text-white/25">{t.type}</span>
        </div>
        <Origins list={t.origins} />
      </div>
      <button onClick={async () => { await hub.act('task-delete', { id: t.id }); changed() }} title="Remover" className="opacity-0 group-hover:opacity-100 text-white/25 hover:text-red-300"><Trash2 size={13} /></button>
    </motion.div>
  )
}

function ExamRow({ e, courses, changed }: { e: Exam; courses: Course[]; changed: () => void }) {
  const days = e.date ? Math.ceil((e.date - Date.now()) / 86400_000) : undefined
  return (
    <div className="flex items-start gap-3 py-2 border-b border-white/[0.04] last:border-0 group">
      <div className={`w-11 flex-shrink-0 text-center rounded-lg py-1 ${days !== undefined && days <= 2 ? 'bg-red-500/15 text-red-200' : days !== undefined && days <= 7 ? 'bg-amber-400/10 text-amber-100' : 'bg-white/5 text-white/60'}`}>
        <div className="text-base font-semibold leading-tight">{e.date ? new Date(e.date).getDate() : '?'}</div>
        <div className="text-[9px] uppercase">{e.date ? new Date(e.date).toLocaleDateString('pt-BR', { month: 'short' }) : 'sem data'}</div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-white/85">{e.title}</div>
        <div className="text-[11px] text-white/40">{when(e.date)}{courseName(courses, e.courseId) ? ` · ${courseName(courses, e.courseId)}` : ''}</div>
        {e.content && <div className="text-[11px] text-white/50 mt-0.5">Conteúdo: {e.content}</div>}
        <Origins list={e.origins} />
      </div>
      <button onClick={async () => { await hub.act('exam-delete', { id: e.id }); changed() }} title="Remover" className="opacity-0 group-hover:opacity-100 text-white/25 hover:text-red-300"><Trash2 size={13} /></button>
    </div>
  )
}

function ItemRow({ i, courses }: { i: HubItem; courses?: Course[] }) {
  const [open, setOpen] = useState(false)
  const m = SOURCE_META[i.source]
  return (
    <div className="py-2 border-b border-white/[0.04] last:border-0">
      <button onClick={() => setOpen(!open)} className="w-full text-left flex items-start gap-2.5">
        <span className="w-7 h-7 rounded-lg flex items-center justify-center text-sm flex-shrink-0" style={{ background: `${m.color}1f` }}>{m.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/80 truncate">{i.origin.author && !i.title.startsWith(i.origin.author) ? <b className="font-medium">{i.origin.author}: </b> : null}{i.title}</span>
            {i.action?.required && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-400/15 text-amber-200 flex-shrink-0">ação</span>}
          </div>
          <div className={`text-[11px] text-white/45 ${open ? 'whitespace-pre-wrap' : 'truncate'}`}>{i.action?.summary && !open ? `→ ${i.action.summary}` : i.text.slice(0, open ? 4000 : 220)}</div>
          <div className="text-[10px] text-white/30 mt-0.5">{originText(i.origin)}{courses && courseName(courses, i.courseId) ? ` · ${courseName(courses, i.courseId)}` : ''}</div>
          {open && i.attachments?.length ? <div className="mt-1 flex flex-wrap gap-1">{i.attachments.map((a, k) => <span key={k} className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-white/50">📎 {a.name}</span>)}</div> : null}
          {open && i.origin.url && <a href={i.origin.url} target="_blank" rel="noreferrer" className="text-[11px] text-cyan-300 underline">Abrir na origem</a>}
        </div>
      </button>
    </div>
  )
}

// ─── Painel ─────────────────────────────────────────────────────────────────

function Panel({ dash, changed, openCourse, goConnections }: { dash: Dashboard; changed: () => void; openCourse: (id: string) => void; goConnections: () => void }) {
  const [md, setMd] = useState<{ title: string; text: string } | null>(null)
  const [busyMd, setBusyMd] = useState(false)
  const empty = dash.totals.items === 0 && dash.totals.tasks === 0
  const showStudyPlan = async () => {
    setBusyMd(true)
    try { const r = await hub.act<{ markdown: string }>('study-plan'); setMd({ title: 'Plano de estudos', text: r.markdown }) } catch (e) { toast.error((e as Error).message) } finally { setBusyMd(false) }
  }
  const showWeekly = async () => {
    setBusyMd(true)
    try { const r = await hub.act<{ markdown: string }>('weekly-summary'); setMd({ title: 'Resumo da semana', text: r.markdown }) } catch (e) { toast.error((e as Error).message) } finally { setBusyMd(false) }
  }
  return (
    <div className="space-y-4">
      {empty && (
        <motion.button initial={false} animate={{ scale: 1, opacity: 1 }} onClick={goConnections} className={`${card} w-full p-5 text-left flex items-center gap-4 hover:border-cyan-400/30`}>
          <Sparkles className="text-cyan-300" />
          <div className="flex-1">
            <div className="text-sm font-medium text-white">Conecte suas fontes para o Hub se organizar sozinho</div>
            <div className="text-xs text-white/45 mt-0.5">Portal do Aluno (UNAMA), Teams, WhatsApp, GitHub, ChatGPT, Gemini, calendários e pastas de materiais.</div>
          </div>
          <ChevronRight className="text-cyan-300/60" />
        </motion.button>
      )}

      <div className="flex flex-wrap gap-2">
        <button disabled={busyMd} onClick={showStudyPlan} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs bg-cyan-500/10 border border-cyan-400/20 text-cyan-100 hover:bg-cyan-500/20 disabled:opacity-40"><GraduationCap size={13} /> {busyMd ? 'Gerando…' : 'Plano de estudos'}</button>
        <button disabled={busyMd} onClick={showWeekly} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 disabled:opacity-40"><ClipboardList size={13} /> Resumo da semana</button>
      </div>
      {dash.alerts.length > 0 && (
        <div className="space-y-1.5">
          {dash.alerts.slice(0, 8).map((a, i) => (
            <motion.div key={a.id} initial={false} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }}
              className={`flex items-start gap-2.5 px-3 py-2 rounded-xl border ${a.level === 'urgent' ? 'bg-red-500/10 border-red-400/25' : a.level === 'warning' ? 'bg-amber-400/[0.07] border-amber-300/20' : 'bg-cyan-500/[0.06] border-cyan-400/15'}`}>
              <AlertTriangle size={14} className={`mt-0.5 ${a.level === 'urgent' ? 'text-red-300' : a.level === 'warning' ? 'text-amber-200' : 'text-cyan-300'}`} />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-white/90">{a.title}</div>
                <div className="text-[11px] text-white/50">{a.detail}</div>
              </div>
              <button onClick={async () => { await hub.act('dismiss-alert', { id: a.id }); changed() }} title="Dispensar" className="text-white/30 hover:text-white/70"><X size={13} /></button>
            </motion.div>
          ))}
        </div>
      )}

      {dash.conflicts.length > 0 && <ConflictsBox dash={dash} changed={changed} />}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Section title="Para entregar nesta semana" icon={ClipboardList} right={<span className="text-[11px] text-white/30">{dash.weekTasks.length}</span>}>
          {dash.weekTasks.length ? dash.weekTasks.map(t => <TaskRow key={t.id} t={t} courses={dash.courses} changed={changed} />) : <Empty>Nada com prazo nos próximos 7 dias 🎉</Empty>}
          {dash.undatedTasks.length > 0 && (
            <details className="mt-2">
              <summary className="text-[11px] text-white/40 cursor-pointer">{dash.undatedTasks.length} tarefa(s) sem data definida</summary>
              {dash.undatedTasks.map(t => <TaskRow key={t.id} t={t} courses={dash.courses} changed={changed} />)}
            </details>
          )}
        </Section>
        <Section title="Próximas provas" icon={Calendar}>
          {dash.upcomingExams.length ? dash.upcomingExams.map(e => <ExamRow key={e.id} e={e} courses={dash.courses} changed={changed} />) : <Empty>Nenhuma prova encontrada nas fontes</Empty>}
        </Section>
      </div>

      <Section title="Mensagens que pedem uma ação sua" icon={Inbox}>
        {dash.needsAction.length ? dash.needsAction.map(i => <ItemRow key={i.id} i={i} courses={dash.courses} />) : <Empty>Nenhuma mensagem pendente de ação</Empty>}
      </Section>

      {dash.courses.length > 0 && (
        <Section title="Disciplinas" icon={BookOpen}>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
            {dash.courses.map(c => <CourseCard key={c.id} c={c} onClick={() => openCourse(c.id)} />)}
          </div>
        </Section>
      )}
      {md && (
        <div className="mo-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onClick={() => setMd(null)}>
          <div className="glass modal-pop rounded-2xl max-w-2xl w-full max-h-[80vh] overflow-y-auto p-5 border border-cyan-400/15" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-semibold text-cyan-100">{md.title}</div>
              <button onClick={() => setMd(null)} className="text-white/40 hover:text-white"><X size={16} /></button>
            </div>
            <Markdown className="text-sm">{md.text}</Markdown>
          </div>
        </div>
      )}
    </div>
  )
}

function ConflictsBox({ dash, changed }: { dash: Dashboard; changed: () => void }) {
  return (
    <Section title="Informações contraditórias — você decide" icon={AlertTriangle}>
      {dash.conflicts.map(c => {
        const target = c.subject === 'task' ? [...dash.weekTasks, ...dash.undatedTasks].find(t => t.id === c.targetId)?.title : dash.upcomingExams.find(e => e.id === c.targetId)?.title
        return (
          <div key={c.id} className="py-2 border-b border-white/[0.04] last:border-0">
            <div className="text-xs text-white/80 mb-1.5">{c.subject === 'task' ? 'Prazo' : 'Data da prova'}{target ? ` de “${target}”` : ''}: as fontes não concordam.</div>
            <div className="flex flex-wrap gap-2">
              {c.options.map((o, i) => (
                <button key={i} onClick={async () => { await hub.act('resolve-conflict', { id: c.id, value: o.value }); toast.success('Data confirmada'); changed() }}
                  className="text-left px-3 py-2 rounded-xl bg-white/[0.03] border border-white/10 hover:border-cyan-400/40 hover:bg-cyan-500/10">
                  <div className="text-sm text-white">{when(o.value)}</div>
                  <div className="text-[10px] text-white/40">{originText(o.origin)}</div>
                </button>
              ))}
            </div>
          </div>
        )
      })}
    </Section>
  )
}

function CourseCard({ c, onClick }: { c: Dashboard['courses'][number]; onClick: () => void }) {
  return (
    <motion.button whileHover={{ y: -2 }} onClick={onClick} className="text-left p-3 rounded-xl bg-white/[0.025] border border-white/[0.06] hover:border-cyan-400/30">
      <div className="text-sm font-medium text-white truncate">{c.name}</div>
      <div className="text-[11px] text-white/40 truncate">{c.professors.length ? c.professors.join(', ') : 'professor não identificado'}</div>
      <div className="flex gap-3 mt-2 text-[11px]">
        <span className={c.pending ? 'text-amber-200' : 'text-white/30'}>{c.pending} pendente(s)</span>
        <span className="text-white/30">{c.items} item(ns)</span>
      </div>
      {c.nextExam && <div className="text-[11px] text-cyan-200/80 mt-1">Próxima prova: {when(c.nextExam.date)}</div>}
      {c.attendance?.absences !== undefined && <div className="text-[11px] text-white/40">Faltas: {c.attendance.absences}{c.attendance.maxAbsences ? `/${c.attendance.maxAbsences}` : ''}</div>}
    </motion.button>
  )
}

// ─── Disciplinas ────────────────────────────────────────────────────────────

function Courses({ dash, open, changed }: { dash: Dashboard; open: (id: string) => void; changed: () => void }) {
  const [name, setName] = useState('')
  const [prof, setProf] = useState('')
  const add = async () => {
    if (!name.trim()) return
    try {
      await hub.act('course-save', { name, professors: prof ? prof.split(',').map(s => s.trim()) : [] })
      setName(''); setProf(''); changed()
    } catch (e) { toast.error((e as Error).message) }
  }
  return (
    <div className="space-y-4">
      <div className={`${card} p-3 flex gap-2 flex-wrap`}>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Nova disciplina (ex.: Banco de Dados)" className="input-jarvis flex-1 min-w-48 px-3 py-2 rounded-lg text-xs" />
        <input value={prof} onChange={e => setProf(e.target.value)} placeholder="Professor(es), separados por vírgula" className="input-jarvis flex-1 min-w-48 px-3 py-2 rounded-lg text-xs" />
        <button onClick={add} className="flex items-center gap-1 px-3 rounded-lg text-xs bg-cyan-500/15 text-cyan-200"><Plus size={13} /> Adicionar</button>
      </div>
      <p className="text-[11px] text-white/35">As disciplinas também são criadas sozinhas a partir do Portal do Aluno e das equipes do Teams.</p>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {dash.courses.map(c => <CourseCard key={c.id} c={c} onClick={() => open(c.id)} />)}
      </div>
      {!dash.courses.length && <Empty>Nenhuma disciplina ainda</Empty>}
    </div>
  )
}

function CourseView({ id, back, changed, version }: { id: string; back: () => void; changed: () => void; version: number }) {
  const [d, setD] = useState<Dossier | null>(null)
  const [aliases, setAliases] = useState('')
  const [repos, setRepos] = useState('')
  const [note, setNote] = useState({ title: '', content: '' })

  useEffect(() => {
    hub.course(id).then(x => { setD(x); setAliases(x.course.aliases.join(', ')); setRepos((x.course.githubRepos || []).join(', ')) }).catch(e => toast.error(e.message))
  }, [id, version])

  if (!d) return <Loader2 className="animate-spin text-cyan-300 mx-auto" />
  const c = d.course
  const save = async () => {
    await hub.act('course-save', { name: c.name, aliases: aliases.split(',').map(s => s.trim()).filter(Boolean), githubRepos: repos.split(',').map(s => s.trim()).filter(Boolean), professors: c.professors })
    toast.success('Disciplina atualizada'); changed()
  }
  return (
    <div className="space-y-4">
      <button onClick={back} className="text-xs text-cyan-300/80 hover:text-cyan-200">‹ Todas as disciplinas</button>
      <div className={`${card} p-4`}>
        <div className="flex items-start gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-white">{c.name}</h2>
            <div className="text-xs text-white/45">{c.code ? `${c.code} · ` : ''}{c.professors.join(', ') || 'professor não identificado'}{c.status ? ` · ${c.status}` : ''}</div>
          </div>
          <button onClick={async () => { await hub.act('course-delete', { id: c.id }); changed(); back() }} className="text-[11px] text-red-300/70 hover:text-red-300">Remover disciplina</button>
        </div>
        {(c.grades?.length || c.attendance) && (
          <div className="mt-3 flex flex-wrap gap-2">
            {c.grades?.map((g, i) => <span key={i} className="px-2 py-1 rounded-lg bg-white/5 text-xs text-white/80" title={originText(g.origin)}>{g.label}: <b>{g.value}</b></span>)}
            {c.attendance && <span className="px-2 py-1 rounded-lg bg-white/5 text-xs text-white/80" title={originText(c.attendance.origin)}>Faltas: <b>{c.attendance.absences ?? '?'}</b>{c.attendance.maxAbsences ? `/${c.attendance.maxAbsences}` : ''}{c.attendance.percent !== undefined ? ` · ${c.attendance.percent}%` : ''}</span>}
          </div>
        )}
        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
          <input value={aliases} onChange={e => setAliases(e.target.value)} placeholder="Apelidos usados nas mensagens (ex.: BD, banco)" className="input-jarvis px-2 py-1.5 rounded-lg text-[11px]" />
          <input value={repos} onChange={e => setRepos(e.target.value)} placeholder="Repositórios GitHub (usuario/repo)" className="input-jarvis px-2 py-1.5 rounded-lg text-[11px] font-mono" />
        </div>
        <button onClick={save} className="mt-2 text-[11px] px-2.5 py-1 rounded-lg bg-cyan-500/15 text-cyan-200">Salvar</button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Section title="Trabalhos e atividades" icon={ClipboardList}>
          {d.tasks.length ? d.tasks.map(t => <TaskRow key={t.id} t={t} courses={[c]} changed={changed} />) : <Empty>Nenhum trabalho</Empty>}
        </Section>
        <Section title="Provas" icon={Calendar}>
          {d.exams.length ? d.exams.map(e => <ExamRow key={e.id} e={e} courses={[c]} changed={changed} />) : <Empty>Nenhuma prova</Empty>}
        </Section>
        <Section title="Mensagens do professor" icon={Inbox}>
          {d.professorMessages.length ? d.professorMessages.slice(0, 30).map(i => <ItemRow key={i.id} i={i} />) : <Empty>Nenhuma mensagem identificada do professor</Empty>}
        </Section>
        <Section title="Materiais" icon={BookOpen}>
          {d.materials.length ? d.materials.slice(0, 30).map(i => <ItemRow key={i.id} i={i} />) : <Empty>Nenhum material</Empty>}
        </Section>
        <Section title="Todas as mensagens" icon={Inbox}>
          {d.messages.length ? d.messages.slice(0, 40).map(i => <ItemRow key={i.id} i={i} />) : <Empty>Nenhuma mensagem</Empty>}
        </Section>
        <Section title="Estudos, resumos e conversas com IA" icon={Sparkles}>
          {d.studies.map(s => (
            <details key={s.id} className="py-1.5 border-b border-white/[0.04]">
              <summary className="text-xs text-white/80 cursor-pointer">{s.title} <span className="text-white/30">· {s.createdBy} · {new Date(s.createdAt).toLocaleDateString('pt-BR')}</span></summary>
              <Markdown className="text-xs mt-1">{s.content}</Markdown>
            </details>
          ))}
          {d.conversations.map(i => <ItemRow key={i.id} i={i} />)}
          {d.github.map(i => <ItemRow key={i.id} i={i} />)}
          <div className="mt-2 space-y-1.5">
            <input value={note.title} onChange={e => setNote({ ...note, title: e.target.value })} placeholder="Título da anotação" className="input-jarvis w-full px-2 py-1.5 rounded-lg text-[11px]" />
            <textarea value={note.content} onChange={e => setNote({ ...note, content: e.target.value })} rows={3} placeholder="Resumo, anotação de aula…" className="input-jarvis w-full px-2 py-1.5 rounded-lg text-[11px]" />
            <button disabled={!note.content.trim()} onClick={async () => { await hub.act('study-save', { courseId: c.id, ...note }); setNote({ title: '', content: '' }); changed() }} className="text-[11px] px-2.5 py-1 rounded-lg bg-cyan-500/15 text-cyan-200 disabled:opacity-40">Salvar anotação</button>
          </div>
        </Section>
      </div>
    </div>
  )
}

// ─── Tarefas & Provas ───────────────────────────────────────────────────────

function TasksView({ changed, version }: { changed: () => void; version: number }) {
  const [data, setData] = useState<{ tasks: AcademicTask[]; exams: Exam[]; courses: Course[] } | null>(null)
  const [filter, setFilter] = useState<'abertas' | 'concluidas' | 'todas'>('abertas')
  const [course, setCourse] = useState('')
  const [form, setForm] = useState({ type: 'trabalho', title: '', due: '', courseId: '', description: '' })

  useEffect(() => { hub.tasks().then(setData).catch(e => toast.error(e.message)) }, [version])
  if (!data) return <Loader2 className="animate-spin text-cyan-300 mx-auto" />

  const tasks = data.tasks
    .filter(t => !course || t.courseId === course)
    .filter(t => filter === 'todas' || (filter === 'concluidas' ? t.status === 'concluida' : t.status === 'pendente' || t.status === 'atrasada'))
    .sort((a, b) => (a.due || Infinity) - (b.due || Infinity))
  const exams = data.exams.filter(e => !course || e.courseId === course).sort((a, b) => (a.date || Infinity) - (b.date || Infinity))

  const add = async () => {
    if (!form.title.trim()) return
    try {
      await hub.act('task-add', { ...form, courseId: form.courseId || undefined })
      setForm({ ...form, title: '', due: '', description: '' })
      toast.success(form.type === 'prova' ? 'Prova adicionada' : 'Tarefa adicionada')
      changed()
    } catch (e) { toast.error((e as Error).message) }
  }

  return (
    <div className="space-y-4">
      <div className={`${card} p-3 flex gap-2 flex-wrap items-center`}>
        <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} className="input-jarvis px-2 py-2 rounded-lg text-xs">
          <option value="trabalho">Trabalho</option><option value="atividade">Atividade</option><option value="prova">Prova</option>
        </select>
        <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Título" className="input-jarvis flex-1 min-w-48 px-3 py-2 rounded-lg text-xs" />
        <input type="datetime-local" value={form.due} onChange={e => setForm({ ...form, due: e.target.value })} className="input-jarvis px-2 py-2 rounded-lg text-xs" />
        <select value={form.courseId} onChange={e => setForm({ ...form, courseId: e.target.value })} className="input-jarvis px-2 py-2 rounded-lg text-xs max-w-48">
          <option value="">Sem disciplina</option>{data.courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button onClick={add} className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs bg-cyan-500/15 text-cyan-200"><Plus size={13} /> Adicionar</button>
      </div>

      <div className="flex gap-2 items-center flex-wrap">
        {(['abertas', 'concluidas', 'todas'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1 rounded-full text-xs ${filter === f ? 'bg-cyan-500/20 text-cyan-100' : 'text-white/40 hover:text-white/70'}`}>{f === 'abertas' ? 'Em aberto' : f === 'concluidas' ? 'Concluídas' : 'Todas'}</button>
        ))}
        <select value={course} onChange={e => setCourse(e.target.value)} className="input-jarvis ml-auto px-2 py-1 rounded-lg text-xs">
          <option value="">Todas as disciplinas</option>{data.courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Section title="Trabalhos e atividades" icon={ClipboardList} right={<span className="text-[11px] text-white/30">{tasks.length}</span>}>
          {tasks.length ? tasks.map(t => <TaskRow key={t.id} t={t} courses={data.courses} changed={changed} />) : <Empty>Nada aqui</Empty>}
        </Section>
        <Section title="Provas" icon={Calendar} right={<span className="text-[11px] text-white/30">{exams.length}</span>}>
          {exams.length ? exams.map(e => <ExamRow key={e.id} e={e} courses={data.courses} changed={changed} />) : <Empty>Nenhuma prova</Empty>}
        </Section>
      </div>
    </div>
  )
}

// ─── Mensagens (central unificada) ──────────────────────────────────────────

function MessagesView({ courses }: { courses: Course[] }) {
  const [source, setSource] = useState<HubSource | ''>('')
  const [course, setCourse] = useState('')
  const [onlyAction, setOnlyAction] = useState(false)
  const [items, setItems] = useState<HubItem[] | null>(null)
  const [total, setTotal] = useState(0)

  useEffect(() => {
    const q: Record<string, string> = { limit: '300' }
    if (source) q.source = source
    if (course) q.courseId = course
    hub.items(q).then(r => { setItems(r.items); setTotal(r.total) }).catch(e => toast.error(e.message))
  }, [source, course])

  const list = useMemo(() => (items || []).filter(i => !onlyAction || i.action?.required), [items, onlyAction])

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5 flex-wrap items-center">
        <button onClick={() => setSource('')} className={`px-2.5 py-1 rounded-full text-xs ${!source ? 'bg-cyan-500/20 text-cyan-100' : 'text-white/40 hover:text-white/70'}`}>Todas</button>
        {(Object.keys(SOURCE_META) as HubSource[]).filter(s => s !== 'manual').map(s => (
          <button key={s} onClick={() => setSource(s)} className={`px-2.5 py-1 rounded-full text-xs ${source === s ? 'bg-cyan-500/20 text-cyan-100' : 'text-white/40 hover:text-white/70'}`}>{SOURCE_META[s].icon} {SOURCE_META[s].label}</button>
        ))}
        <div className="flex-1" />
        <label className="flex items-center gap-1.5 text-xs text-white/50"><input type="checkbox" checked={onlyAction} onChange={e => setOnlyAction(e.target.checked)} /> Só o que pede ação</label>
        <select value={course} onChange={e => setCourse(e.target.value)} className="input-jarvis px-2 py-1 rounded-lg text-xs">
          <option value="">Todas as disciplinas</option>{courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div className={`${card} px-4 py-2`}>
        {items === null ? <Loader2 className="animate-spin text-cyan-300 mx-auto my-4" /> : list.length ? list.map(i => <ItemRow key={i.id} i={i} courses={courses} />) : <Empty>Nenhuma mensagem</Empty>}
      </div>
      {total > (items?.length || 0) && <p className="text-[11px] text-white/30 text-center">Mostrando {items?.length} de {total}. Use a busca para encontrar mensagens antigas.</p>}
    </div>
  )
}

// ─── Perguntar & Buscar ─────────────────────────────────────────────────────

const SUGGESTIONS = [
  'O que tenho para entregar esta semana?',
  'Quais provas tenho este mês?',
  'O que o professor falou sobre o trabalho?',
  'Existe alguma mensagem que eu ainda não respondi?',
]

function AskView() {
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState<{ answer: string; model?: string; sources: Array<{ n: number; origin: Origin }> } | null>(null)
  const [hits, setHits] = useState<SearchHit[] | null>(null)

  const doAsk = async (question = q) => {
    if (!question.trim()) return
    setQ(question); setBusy(true); setAnswer(null)
    try {
      const [a, s] = await Promise.all([
        hub.act<{ answer: string; model?: string; sources: Array<{ n: number; origin: Origin }> }>('ask', { question }),
        hub.search(question, []),
      ])
      setAnswer(a); setHits(s.hits)
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  const doSearch = async () => {
    if (!q.trim()) return
    setBusy(true)
    try { setHits((await hub.search(q, [])).hits); setAnswer(null) } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="space-y-4 max-w-4xl">
      <div className={`${card} p-3`}>
        <div className="flex gap-2">
          <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && doAsk()} placeholder="Pergunte sobre suas aulas, provas, trabalhos, mensagens…" className="input-jarvis flex-1 px-3 py-2.5 rounded-xl text-sm" />
          <button onClick={() => doAsk()} disabled={busy} className="flex items-center gap-1.5 px-4 rounded-xl text-xs bg-cyan-500/20 text-cyan-100 disabled:opacity-50">{busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Perguntar</button>
          <button onClick={doSearch} disabled={busy} title="Só buscar" className="px-3 rounded-xl text-xs bg-white/5 text-white/60"><Search size={13} /></button>
        </div>
        <div className="flex gap-1.5 flex-wrap mt-2">
          {SUGGESTIONS.map(s => <button key={s} onClick={() => doAsk(s)} className="text-[11px] px-2.5 py-1 rounded-full bg-white/[0.04] text-white/50 hover:text-cyan-100 hover:bg-cyan-500/10">{s}</button>)}
        </div>
      </div>

      {answer && (
        <motion.div initial={false} animate={{ opacity: 1, y: 0 }} className={`${card} p-4`}>
          <Markdown className="text-sm">{answer.answer}</Markdown>
          {answer.sources.length > 0 && (
            <div className="mt-3 pt-3 border-t border-white/5">
              <div className="text-[10px] uppercase tracking-wider text-white/35 mb-1.5">Fontes</div>
              <div className="space-y-1">{answer.sources.map(s => <div key={s.n} className="text-[11px] text-white/50"><span className="text-cyan-300">[F{s.n}]</span> {originText(s.origin)}{s.origin.url && <> · <a className="underline" href={s.origin.url} target="_blank" rel="noreferrer">abrir</a></>}</div>)}</div>
            </div>
          )}
          {answer.model && <div className="text-[10px] text-white/25 mt-2">Respondido por {answer.model}</div>}
        </motion.div>
      )}

      {hits && (
        <Section title={`Resultados da busca (${hits.length})`} icon={Search}>
          {hits.length ? hits.map(h => (
            <div key={h.item.id} className="py-2 border-b border-white/[0.04] last:border-0">
              <div className="text-xs text-white/85">{SOURCE_META[h.item.source].icon} {h.item.title}</div>
              <div className="text-[11px] text-white/50">{h.snippet}</div>
              <div className="text-[10px] text-white/30">{originText(h.item.origin)}</div>
            </div>
          )) : <Empty>Nada encontrado</Empty>}
        </Section>
      )}
    </div>
  )
}

// ─── Aprovações ─────────────────────────────────────────────────────────────

function ApprovalsView({ changed }: { changed: () => void }) {
  const [list, setList] = useState<PendingAction[] | null>(null)
  const load = useCallback(() => hub.actions().then(r => setList(r.actions)).catch(e => toast.error(e.message)), [])
  useEffect(() => { load() }, [load])

  const decide = async (a: PendingAction, approve: boolean) => {
    try {
      const r = await hub.act<{ action: PendingAction }>(approve ? 'action-approve' : 'action-deny', { id: a.id })
      const link = r.action.result && /^https:\/\/wa\.me\//.test(r.action.result) ? r.action.result : null
      if (link) window.open(link, '_blank')
      toast[r.action.status === 'failed' ? 'error' : 'success'](r.action.status === 'denied' ? 'Recusado' : r.action.result || 'Feito')
      load(); changed()
    } catch (e) { toast.error((e as Error).message) }
  }

  if (!list) return <Loader2 className="animate-spin text-cyan-300 mx-auto" />
  const pending = list.filter(a => a.status === 'pending')
  const past = list.filter(a => a.status !== 'pending')
  return (
    <div className="space-y-4 max-w-4xl">
      <p className="text-xs text-white/45">Nada é enviado em seu nome sem a sua aprovação aqui: mensagens no Teams, issues e commits no GitHub. Para o WhatsApp, o JARVIS abre a conversa já escrita e você mesmo envia.</p>
      <Section title="Aguardando você" icon={ShieldCheck}>
        {pending.length ? pending.map(a => (
          <div key={a.id} className="py-3 border-b border-white/[0.04] last:border-0">
            <div className="text-sm text-white">{a.title}</div>
            <div className="text-[11px] text-white/35">pedido por {a.requestedBy} · {new Date(a.createdAt).toLocaleString('pt-BR')}</div>
            <pre className="mt-2 p-2 rounded-lg bg-black/40 text-[11px] text-white/70 whitespace-pre-wrap max-h-60 overflow-auto">{a.preview}</pre>
            <div className="flex gap-2 mt-2">
              <button onClick={() => decide(a, true)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs bg-green-500/20 text-green-100 hover:bg-green-500/30"><Check size={12} /> Aprovar e executar</button>
              <button onClick={() => decide(a, false)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs bg-white/5 text-white/60 hover:bg-red-500/15 hover:text-red-200"><X size={12} /> Recusar</button>
            </div>
          </div>
        )) : <Empty>Nenhuma ação esperando aprovação</Empty>}
      </Section>
      {past.length > 0 && (
        <Section title="Histórico" icon={ClipboardList}>
          {past.map(a => (
            <div key={a.id} className="py-1.5 border-b border-white/[0.04] last:border-0 text-xs flex gap-2">
              <span className={a.status === 'done' ? 'text-green-300' : a.status === 'failed' ? 'text-red-300' : 'text-white/40'}>{a.status === 'done' ? 'feito' : a.status === 'failed' ? 'falhou' : a.status === 'denied' ? 'recusado' : a.status}</span>
              <span className="text-white/70 flex-1 truncate">{a.title}</span>
              <span className="text-white/30">{new Date(a.decidedAt || a.createdAt).toLocaleString('pt-BR')}</span>
            </div>
          ))}
        </Section>
      )}
    </div>
  )
}
