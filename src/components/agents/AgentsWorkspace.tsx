'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Activity, AlertTriangle, CheckCircle2, ClipboardList, FileCode2, FileText, FolderOpen, MessageSquare, Pause, Play,
  Plus, RefreshCw, RotateCcw, Send, Settings2, ShieldCheck, Square, StopCircle, Trash2, Undo2, Users, X, Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import Markdown from '@/components/chat/Markdown'
import { api, fmtDuration, fmtTokens, shortModel } from './api'
import { ConfirmDialog, ModelPicker, ProjectDialog, RUN_STATUS_LABEL, STATUS_LABEL } from './shared'
import TeamsManager from './TeamsManager'
import TeamCanvas from './TeamCanvas'
import LiveTimeline from './LiveTimeline'
import type { AgentRuntimeState, AgentTask, Project, RoleTemplate, Run, RunEvent, SessionMeta, Team } from '@/lib/agents/types'
import { ACTIVE_RUN_STATUSES, DEFAULT_RUN_OPTIONS } from '@/lib/agents/types'
import { PERMISSION_LABELS, PERMISSION_MODES } from '@/lib/agents/permissions'

type Tab = 'canvas' | 'live' | 'tasks' | 'messages' | 'activity' | 'files' | 'errors' | 'approvals' | 'report'

export default function AgentsWorkspace({
  session, project, onChanged, onProjectChange,
}: {
  session: SessionMeta
  project?: Project
  onChanged: () => void
  onProjectChange: (projectId: string) => void
}) {
  const [runs, setRuns] = useState<Run[]>([])
  const [runId, setRunId] = useState('')
  const [run, setRun] = useState<Run | null>(null)
  const [events, setEvents] = useState<RunEvent[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [roles, setRoles] = useState<RoleTemplate[]>([])
  const [request, setRequest] = useState('')
  const [teamId, setTeamId] = useState(session.teamId || '')
  const [options, setOptions] = useState({ ...DEFAULT_RUN_OPTIONS })
  const [showOptions, setShowOptions] = useState(false)
  const [tab, setTab] = useState<Tab>('live')
  const [starting, setStarting] = useState(false)
  const [showTeams, setShowTeams] = useState(false)
  const [newProject, setNewProject] = useState(false)
  const [confirmRollback, setConfirmRollback] = useState(false)
  const [adding, setAdding] = useState<{ roleId: string; model: string } | null>(null)
  const [, setTick] = useState(0)

  const loadTeams = useCallback(() => api.teams().then(d => { setTeams(d.teams); setRoles(d.roles) }).catch(() => {}), [])
  const loadRuns = useCallback(async (select?: string) => {
    const list = await api.runs(session.id).catch(() => [] as Run[])
    setRuns(list)
    setRunId(prev => select || (list.some(r => r.id === prev) ? prev : list[list.length - 1]?.id || ''))
  }, [session.id])

  useEffect(() => { loadTeams() }, [loadTeams])
  useEffect(() => { setRun(null); setEvents([]); setRunId(''); loadRuns() }, [loadRuns])

  // Live stream of the selected run
  useEffect(() => {
    if (!runId) return
    const es = new EventSource(`/api/agents/runs/${runId}/events`)
    es.addEventListener('snapshot', e => {
      const d = JSON.parse((e as MessageEvent).data)
      setRun(d.run)
      setEvents(d.events)
    })
    es.addEventListener('event', e => {
      const ev = JSON.parse((e as MessageEvent).data) as RunEvent
      setEvents(prev => (prev.some(p => p.id === ev.id) ? prev : [...prev.slice(-700), ev]))
    })
    es.addEventListener('run', e => setRun(JSON.parse((e as MessageEvent).data)))
    es.addEventListener('end', () => { es.close(); loadRuns(runId); onChanged() })
    es.onerror = () => es.close()
    return () => es.close()
  }, [runId, loadRuns, onChanged])

  const active = !!run && ACTIVE_RUN_STATUSES.includes(run.status)
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setTick(x => x + 1), 1000)
    return () => clearInterval(t)
  }, [active])

  const control = async (action: string, body: Record<string, unknown> = {}, ok?: string) => {
    if (!run) return
    try {
      const res = await api.runAction(run.id, action, body)
      if (res.run) setRun(res.run)
      if (ok) toast.success(ok)
      if (action === 'resume-run') { setRunId(''); setTimeout(() => setRunId(run.id), 50) }
      return res
    } catch (e) { toast.error((e as Error).message) }
  }

  const start = async () => {
    if (!project?.path) return
    setStarting(true)
    try {
      const r = await api.startRun({ sessionId: session.id, projectId: project.id, request, teamId: teamId || undefined, options })
      setRequest('')
      await loadRuns(r.id)
      onChanged()
      setTab('live')
    } catch (e) { toast.error((e as Error).message) } finally { setStarting(false) }
  }

  const agentName = useCallback((id: string) => (id === 'user' ? 'Você' : run?.agents.find(a => a.id === id)?.name || id), [run])
  const pendingApprovals = (run?.scopeRequests.filter(r => r.status === 'pending').length || 0) + (run?.approvals?.filter(a => a.status === 'pending').length || 0)
  const errorEvents = events.filter(e => e.level !== 'info')
  const files = useMemo(() => {
    const m = new Map<string, { path: string; added: number; removed: number; agents: Set<string>; action: string }>()
    for (const c of run?.changes || []) {
      const cur = m.get(c.path) || { path: c.path, added: 0, removed: 0, agents: new Set<string>(), action: c.action }
      cur.added += c.added; cur.removed += c.removed; cur.agents.add(c.agentId)
      m.set(c.path, cur)
    }
    return [...m.values()]
  }, [run?.changes])

  const elapsed = run?.startedAt ? (run.finishedAt || Date.now()) - run.startedAt : 0

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-6xl mx-auto px-5 py-5 space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="w-10 h-10 rounded-xl bg-violet-500/15 border border-violet-500/25 flex items-center justify-center"><Users size={18} className="text-violet-300" /></div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-white truncate">{session.title}</h2>
            <p className="text-xs text-white/40 truncate flex items-center gap-1">
              <FolderOpen size={11} /> {project?.path ? `${project.name} — ${project.path}` : 'Sem pasta de projeto'}
            </p>
          </div>
          {runs.length > 1 && (
            <select value={runId} onChange={e => setRunId(e.target.value)} className="input-jarvis px-2 py-1.5 rounded-lg text-xs max-w-[240px]" title="Histórico de execuções">
              {runs.map((r, i) => <option key={r.id} value={r.id}>#{i + 1} {RUN_STATUS_LABEL[r.status]?.label} — {r.request.slice(0, 40)}</option>)}
            </select>
          )}
          <button onClick={() => setShowTeams(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-violet-200 bg-violet-500/10 hover:bg-violet-500/20 border border-violet-500/20">
            <Settings2 size={13} /> Equipes
          </button>
        </div>

        {/* Composer */}
        {!project?.path ? (
          <div className="p-5 rounded-2xl border border-amber-400/30 bg-amber-400/[0.06] flex items-center gap-4">
            <FolderOpen size={22} className="text-amber-300" />
            <div className="flex-1 text-sm text-amber-100">A equipe precisa de uma pasta de projeto para trabalhar. Crie um projeto apontando para a pasta (por exemplo, a pasta do seu site ou app).</div>
            <button onClick={() => setNewProject(true)} className="px-4 py-2 rounded-lg text-sm font-medium bg-amber-400/80 hover:bg-amber-400 text-black">Escolher pasta</button>
          </div>
        ) : !active && (
          <div className="energy-border">
            <div className="energy-inner p-4 space-y-3">
              <textarea
                value={request}
                onChange={e => setRequest(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && request.trim()) start() }}
                rows={3}
                placeholder="O que a equipe deve fazer neste projeto? Ex.: “Crie uma página de login com API de autenticação e testes” (Ctrl+Enter para iniciar)"
                className="w-full bg-transparent resize-none text-sm text-white/90 placeholder-white/25 outline-none"
              />
              <div className="flex items-center gap-2 flex-wrap">
                <select value={teamId} onChange={e => setTeamId(e.target.value)} className="input-jarvis px-2 py-1.5 rounded-lg text-xs">
                  <option value="">🧠 Equipe automática (o JARVIS escolhe quem precisa)</option>
                  {teams.map(t => <option key={t.id} value={t.id}>👥 {t.name} ({t.agents.filter(a => a.enabled).length})</option>)}
                </select>
                <button onClick={() => setShowOptions(s => !s)} className="text-xs text-white/40 hover:text-white/70 px-2">Opções</button>
                <div className="flex-1" />
                <motion.button
                  whileHover={request.trim() ? { scale: 1.04 } : undefined}
                  whileTap={request.trim() ? { scale: 0.96 } : undefined}
                  disabled={!request.trim() || starting}
                  onClick={start}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-gradient-to-r from-cyan-500 to-violet-500 text-black disabled:opacity-30"
                >
                  {starting ? <RefreshCw size={14} className="animate-spin" /> : <Zap size={14} />} Iniciar equipe
                </motion.button>
              </div>
              <AnimatePresence>
                {showOptions && (
                  <motion.div initial={false} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2 text-xs text-white/50">
                      <NumberOpt label="Agentes em paralelo" value={options.maxParallel} min={1} max={8} onChange={v => setOptions({ ...options, maxParallel: v })} />
                      <NumberOpt label="Passos por tarefa" value={options.maxSteps} min={4} max={30} onChange={v => setOptions({ ...options, maxSteps: v })} />
                      <NumberOpt label="Rodadas de correção" value={options.fixRounds} min={0} max={3} onChange={v => setOptions({ ...options, fixRounds: v })} />
                      <label className="flex items-center gap-2 mt-4"><input type="checkbox" checked={options.autoFallback} onChange={e => setOptions({ ...options, autoFallback: e.target.checked })} /> Trocar modelo que falhar</label>
                      <div className="mt-4">
                        <div className="text-[11px] text-white/45 mb-1">Autonomia</div>
                        <div className="flex gap-1">
                          {PERMISSION_MODES.map(m => (
                            <button
                              key={m}
                              title={PERMISSION_LABELS[m].hint}
                              onClick={() => setOptions({ ...options, permissionMode: m })}
                              className={`px-2 py-1 rounded-lg text-[11px] border transition-colors ${options.permissionMode === m ? 'bg-white text-black border-white' : 'border-white/15 text-white/60 hover:bg-white/5'}`}
                            >
                              {PERMISSION_LABELS[m].name}
                            </button>
                          ))}
                        </div>
                        <div className="text-[10px] text-white/30 mt-1">{PERMISSION_LABELS[options.permissionMode].hint}</div>
                      </div>
                      <label className="flex items-center gap-2 mt-3 text-[12px] text-white/60">
                        <input type="checkbox" checked={options.planFirst} onChange={e => setOptions({ ...options, planFirst: e.target.checked })} />
                        Apresentar o plano e esperar aprovação antes de executar
                      </label>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}

        {!run && project?.path && (
          <p className="text-center text-sm text-white/30 py-10">Descreva o pedido acima. O JARVIS analisa a complexidade, monta a equipe necessária e distribui as tarefas.</p>
        )}

        {run && (
          <>
            {/* Run bar */}
            <div className="glass rounded-2xl p-4">
              <div className="flex items-center gap-3 flex-wrap">
                <span className={`text-sm font-semibold ${RUN_STATUS_LABEL[run.status]?.cls}`}>● {RUN_STATUS_LABEL[run.status]?.label}</span>
                {run.complexity && <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-white/50 uppercase tracking-wider">{run.complexity}</span>}
                <span className="text-xs text-white/40 truncate flex-1 min-w-[120px]" title={run.request}>{run.request}</span>
                <Stat label="Tarefas" value={`${run.tasks.filter(t => t.status === 'done').length}/${run.tasks.length}`} />
                <Stat label="Tokens" value={`${fmtTokens(run.usage.inputTokens + run.usage.outputTokens)}${run.usage.estimated ? '~' : ''}`} />
                <Stat label="Custo" value={run.usage.cost ? `$${run.usage.cost.toFixed(4)}` : 'grátis/n.d.'} />
                <Stat label="Tempo" value={fmtDuration(elapsed)} />
                <Stat label="Arquivos" value={String(files.length)} />
                <div className="flex items-center gap-1">
                  {active && run.status !== 'paused' && <IconBtn icon={Pause} title="Pausar execução" onClick={() => control('pause', {}, 'Pausada')} />}
                  {active && run.status === 'paused' && <IconBtn icon={Play} title="Retomar" onClick={() => control('resume', {}, 'Retomada')} />}
                  {active && <IconBtn icon={Square} title="Cancelar execução" danger onClick={() => control('cancel', {}, 'Cancelando…')} />}
                  {!active && ['interrupted', 'failed', 'cancelled'].includes(run.status) && <IconBtn icon={RotateCcw} title="Retomar de onde parou" onClick={() => control('resume-run', {}, 'Retomando')} />}
                  {!active && files.length > 0 && !run.rolledBack && <IconBtn icon={Undo2} title="Reverter alterações desta execução" onClick={() => setConfirmRollback(true)} />}
                </div>
              </div>
              {run.planSummary && <p className="text-xs text-white/45 mt-2">{run.planSummary}</p>}
              {run.error && <p className="text-xs text-red-300 mt-2">{run.error}</p>}
              {run.rolledBack && <p className="text-xs text-amber-300 mt-2">As alterações desta execução foram revertidas.</p>}
            </div>

            {/* Agents */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {run.agents.filter(a => !a.removed).map(a => (
                <AgentCard key={a.id} agent={a} task={run.tasks.find(t => t.id === a.currentTaskId)} roles={roles} active={active} control={control} />
              ))}
              {active && (
                adding ? (
                  <div className="p-4 rounded-2xl border border-dashed border-cyan-500/30 bg-cyan-500/[0.03] space-y-2">
                    <select value={adding.roleId} onChange={e => setAdding({ ...adding, roleId: e.target.value })} className="input-jarvis w-full px-2 py-1.5 rounded-lg text-xs">
                      {roles.map(r => <option key={r.id} value={r.id}>{r.icon} {r.name}</option>)}
                    </select>
                    <ModelPicker value={adding.model} onChange={m => setAdding({ ...adding, model: m })} />
                    <div className="flex gap-2">
                      <button onClick={() => { control('agent-add', adding, 'Agente adicionado'); setAdding(null) }} className="flex-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-cyan-500/80 text-black">Adicionar</button>
                      <button onClick={() => setAdding(null)} className="px-3 py-1.5 rounded-lg text-xs text-white/50 hover:bg-white/5">Cancelar</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setAdding({ roleId: 'fullstack', model: 'auto' })} className="p-4 rounded-2xl border border-dashed border-white/10 hover:border-cyan-500/30 text-sm text-white/40 hover:text-cyan-200 flex items-center justify-center gap-2 min-h-[120px]">
                    <Plus size={16} /> Adicionar agente
                  </button>
                )
              )}
            </div>

            {/* Tabs */}
            <div className="glass rounded-2xl">
              <div className="flex gap-1 p-2 border-b border-white/5 overflow-x-auto">
                {([
                  ['canvas', 'Equipe', Users, run.agents.filter(a => !a.removed).length],
                  ['live', 'Ao vivo', Zap, 0],
                  ['tasks', 'Tarefas', ClipboardList, run.tasks.length],
                  ['messages', 'Mensagens', MessageSquare, run.messages.length],
                  ['activity', 'Atividade', Activity, events.length],
                  ['files', 'Arquivos', FileCode2, files.length],
                  ['errors', 'Erros', AlertTriangle, errorEvents.length],
                  ['approvals', 'Aprovações', ShieldCheck, pendingApprovals],
                  ['report', 'Relatório', FileText, run.report ? 1 : 0],
                ] as const).map(([id, label, Icon, count]) => (
                  <button key={id} onClick={() => setTab(id)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs whitespace-nowrap transition-colors ${tab === id ? 'bg-cyan-500/15 text-cyan-200' : 'text-white/40 hover:text-white/70'}`}>
                    <Icon size={12} /> {label}
                    {count > 0 && <span className={`text-[9px] px-1.5 rounded-full ${id === 'approvals' || id === 'errors' ? 'bg-amber-400/20 text-amber-200' : 'bg-white/10'}`}>{count}</span>}
                  </button>
                ))}
              </div>
              <div className={`p-3 ${tab === 'live' ? '' : 'max-h-[460px] overflow-y-auto'}`}>
                {tab === 'canvas' && (
                  <TeamCanvas
                    run={run}
                    roles={roles}
                    active={active}
                    agentName={agentName}
                    onReply={content => void control('message', { to: run.agents.find(a => a.pendingReply)?.id || 'all', content }, 'Resposta enviada à equipe')}
                    onCancelTask={taskId => void control('cancel-task', { taskId }, 'Tarefa cancelada')}
                  />
                )}
                {tab === 'live' && (
                  <LiveTimeline
                    events={events} run={run} agentName={agentName} active={active}
                    actions={{
                      onApproval: (approvalId, approve) => void control(approve ? 'approve' : 'deny', { approvalId }, approve ? 'Aprovado' : 'Negado'),
                      onPlan: approve => void control(approve ? 'plan-approve' : 'plan-reject', {}, approve ? 'Plano aprovado — executando' : 'Plano recusado'),
                    }}
                  />
                )}
                {tab === 'tasks' && <TasksTab run={run} agentName={agentName} />}
                {tab === 'messages' && <MessagesTab run={run} agentName={agentName} active={active} control={control} />}
                {tab === 'activity' && <ActivityTab events={events} agentName={agentName} />}
                {tab === 'files' && <FilesTab files={files} agentName={agentName} />}
                {tab === 'errors' && <ErrorsTab events={errorEvents} agents={run.agents} agentName={agentName} />}
                {tab === 'approvals' && <ApprovalsTab run={run} agentName={agentName} active={active} control={control} />}
                {tab === 'report' && (run.report
                  ? <Markdown className="text-sm">{run.report}</Markdown>
                  : <Empty text={active ? 'O relatório aparece quando a equipe terminar.' : 'Sem relatório.'} />)}
              </div>
            </div>
          </>
        )}
      </div>

      <AnimatePresence>
        {showTeams && <TeamsManager onClose={() => setShowTeams(false)} onChanged={loadTeams} />}
        {newProject && (
          <ProjectDialog
            onClose={() => setNewProject(false)}
            onCreated={async p => {
              await api.sessionAction('move', { ids: [session.id], projectId: p.id })
              onProjectChange(p.id)
            }}
          />
        )}
        {confirmRollback && run && (
          <ConfirmDialog
            title="Reverter as alterações desta execução?"
            confirmLabel="Reverter"
            onClose={() => setConfirmRollback(false)}
            onConfirm={async () => {
              const r = await api.runAction(run.id, 'rollback', { confirm: true })
              toast.success(`${r.restored} arquivo(s) restaurado(s), ${r.removed} arquivo(s) criado(s) pela equipe removido(s)`)
              loadRuns(run.id)
            }}
          >
            <p>Os {files.length} arquivo(s) alterados voltam ao conteúdo original salvo antes da execução. Arquivos que a equipe criou serão removidos.</p>
            <p className="text-white/40">Alterações feitas depois por você nesses arquivos também serão desfeitas.</p>
          </ConfirmDialog>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

function NumberOpt({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span>{label}</span>
      <input type="number" min={min} max={max} value={value} onChange={e => onChange(Math.min(max, Math.max(min, Number(e.target.value) || min)))} className="input-jarvis w-full mt-1 px-2 py-1 rounded text-xs" />
    </label>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right">
      <div className="text-[9px] uppercase tracking-wider text-white/30">{label}</div>
      <div className="text-xs font-mono text-white/80">{value}</div>
    </div>
  )
}

function IconBtn({ icon: Icon, title, onClick, danger }: { icon: typeof Pause; title: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} title={title} className={`p-2 rounded-lg transition-colors ${danger ? 'text-red-300/80 hover:bg-red-500/15' : 'text-white/60 hover:text-cyan-200 hover:bg-cyan-500/10'}`}>
      <Icon size={14} />
    </button>
  )
}

function Empty({ text }: { text: string }) {
  return <p className="text-center text-xs text-white/30 py-8">{text}</p>
}

function AgentCard({ agent, task, roles, active, control }: {
  agent: AgentRuntimeState
  task?: AgentTask
  roles: RoleTemplate[]
  active: boolean
  control: (action: string, body?: Record<string, unknown>, ok?: string) => Promise<unknown>
}) {
  const role = roles.find(r => r.id === agent.roleId)
  const st = STATUS_LABEL[agent.status] || STATUS_LABEL.waiting
  const working = ['executing', 'planning', 'reviewing', 'communicating'].includes(agent.status)
  const running = task?.startedAt ? Date.now() - task.startedAt : 0
  const progress = agent.status === 'done' ? 100 : task ? Math.round((agent.step / Math.max(agent.maxSteps, 1)) * 100) : 0
  const [config, setConfig] = useState(false)
  const color = agent.color || role?.color || '#00d4ff'
  return (
    <motion.div
      layout
      initial={false}
      animate={{ opacity: 1, y: 0 }}
      className={`relative p-4 rounded-2xl border bg-[rgba(6,14,24,0.88)] overflow-hidden ${working ? 'border-cyan-500/30' : 'border-white/[0.07]'}`}
      style={{ boxShadow: working ? `0 0 26px -8px ${color}` : undefined }}
    >
      <div className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: color }} />
      <div className="flex items-start gap-3">
        <div className="relative w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0" style={{ background: `${color}22`, border: `1px solid ${color}55` }}>
          {role?.icon || '🤖'}
          {working && <span className="absolute -inset-1 rounded-xl border-2 animate-ping opacity-30" style={{ borderColor: color }} />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-white truncate">{agent.name}</span>
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full whitespace-nowrap ${st.cls}`}>{st.label}</span>
          </div>
          <div className="text-[11px] text-white/40 truncate">{role?.name || agent.roleId}</div>
          <div className="text-[11px] font-mono text-cyan-300/80 truncate mt-0.5" title={agent.resolvedModel}>⚡ {shortModel(agent.resolvedModel || agent.model)}</div>
        </div>
      </div>

      <div className="mt-3 text-xs text-white/60 min-h-[32px] line-clamp-2">
        {task ? <><span className="text-white/30">{task.id}</span> {task.title}</> : agent.idleReason || (agent.status === 'done' ? 'Trabalho concluído' : 'Sem tarefa no momento')}
      </div>

      <div className="mt-2 h-1.5 rounded-full bg-white/5 overflow-hidden">
        <motion.div className="h-full rounded-full" style={{ background: `linear-gradient(90deg, ${color}, #a78bfa)` }} animate={{ width: `${progress}%` }} transition={{ duration: 0.4 }} />
      </div>

      <div className="mt-2 flex items-center gap-3 text-[10px] text-white/40 font-mono">
        <span title="Passo atual">{task ? `passo ${agent.step}/${agent.maxSteps}` : '—'}</span>
        <span title="Tokens (entrada+saída)">{fmtTokens(agent.usage.inputTokens + agent.usage.outputTokens)}{agent.usage.estimated ? '~' : ''} tok</span>
        {agent.usage.cost ? <span>${agent.usage.cost.toFixed(4)}</span> : null}
        <span title="Tempo de execução">{fmtDuration(agent.activeMs + running)}</span>
        {agent.errors.length > 0 && <span className="text-amber-300" title={agent.errors.slice(-3).join('\n')}>⚠ {agent.errors.length}</span>}
      </div>

      {active && (
        <div className="mt-3 flex items-center gap-1 border-t border-white/5 pt-2">
          {agent.paused
            ? <MiniBtn icon={Play} title="Retomar agente" onClick={() => control('agent-resume', { agentId: agent.id })} />
            : <MiniBtn icon={Pause} title="Pausar agente" onClick={() => control('agent-pause', { agentId: agent.id })} />}
          <MiniBtn icon={StopCircle} title="Interromper agora" onClick={() => control('agent-stop', { agentId: agent.id }, `${agent.name} interrompido`)} />
          <MiniBtn icon={RotateCcw} title="Reiniciar agente" onClick={() => control('agent-restart', { agentId: agent.id }, `${agent.name} reiniciado`)} />
          <MiniBtn icon={Settings2} title="Configurar" onClick={() => setConfig(c => !c)} />
          <div className="flex-1" />
          <MiniBtn icon={Trash2} title="Remover da equipe" danger onClick={() => control('agent-remove', { agentId: agent.id }, `${agent.name} removido`)} />
        </div>
      )}
      <AnimatePresence>
        {config && active && (
          <motion.div initial={false} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="pt-2 space-y-2">
              <ModelPicker value={agent.model} onChange={m => control('agent-config', { agentId: agent.id, model: m }, 'Modelo alterado')} />
              <input
                defaultValue={agent.scope.join(', ')}
                onBlur={e => control('agent-config', { agentId: agent.id, scope: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                className="input-jarvis w-full px-2 py-1 rounded text-[10px] font-mono"
                title="Escopo de escrita (globs)"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

function MiniBtn({ icon: Icon, title, onClick, danger }: { icon: typeof Pause; title: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} title={title} className={`p-1.5 rounded-md ${danger ? 'text-white/30 hover:text-red-300 hover:bg-red-500/10' : 'text-white/40 hover:text-cyan-200 hover:bg-cyan-500/10'}`}>
      <Icon size={12} />
    </button>
  )
}

const TASK_STATUS: Record<string, string> = {
  pending: 'text-white/40', running: 'text-cyan-300', done: 'text-green-300', failed: 'text-red-300', blocked: 'text-orange-300', cancelled: 'text-white/30',
}

function TasksTab({ run, agentName }: { run: Run; agentName: (id: string) => string }) {
  if (!run.tasks.length) return <Empty text="O plano aparece aqui assim que o arquiteto terminar de planejar." />
  return (
    <div className="space-y-1.5">
      {run.tasks.map(t => (
        <div key={t.id} className="p-2.5 rounded-xl bg-white/[0.02] border border-white/5">
          <div className="flex items-center gap-2 text-xs">
            {t.status === 'done' ? <CheckCircle2 size={13} className="text-green-300" /> : t.status === 'running' ? <RefreshCw size={13} className="text-cyan-300 animate-spin" /> : <span className={`w-2 h-2 rounded-full bg-current ${TASK_STATUS[t.status]}`} />}
            <span className="text-white/30 font-mono">{t.id}</span>
            <span className="text-white/85 flex-1">{t.title}</span>
            <span className="text-[10px] text-white/40">{agentName(t.agentId)}</span>
            <span className={`text-[10px] ${TASK_STATUS[t.status]}`}>{t.status}</span>
          </div>
          {(t.dependsOn.length > 0 || t.kind !== 'work') && (
            <div className="text-[10px] text-white/30 mt-1 ml-5">{t.kind !== 'work' && `${t.kind} · `}{t.dependsOn.length > 0 && `depois de ${t.dependsOn.join(', ')}`}</div>
          )}
          {t.result && <p className="text-[11px] text-white/50 mt-1 ml-5">{t.result}</p>}
          {t.issues && t.issues.length > 0 && <ul className="text-[11px] text-amber-200/80 mt-1 ml-5 list-disc pl-4">{t.issues.map((i, k) => <li key={k}>{i.description}{i.role ? ` (${i.role})` : ''}</li>)}</ul>}
          {t.error && <p className="text-[11px] text-red-300/80 mt-1 ml-5">{t.error}</p>}
        </div>
      ))}
    </div>
  )
}

const KIND_LABEL: Record<string, string> = {
  info: 'info', question: 'pergunta', answer: 'resposta', problem: 'problema', review_request: 'pedido de revisão', delegation: 'delegação', decision: 'decisão', done: 'concluído', user: 'você',
}

function MessagesTab({ run, agentName, active, control }: { run: Run; agentName: (id: string) => string; active: boolean; control: (a: string, b?: Record<string, unknown>, ok?: string) => Promise<unknown> }) {
  const [to, setTo] = useState('all')
  const [text, setText] = useState('')
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }) }, [run.messages.length])
  return (
    <div>
      <div className="space-y-2">
        {run.messages.map(m => (
          <motion.div key={m.id} initial={false} animate={{ opacity: 1, x: 0 }} className={`p-2.5 rounded-xl border text-xs ${m.from === 'user' ? 'bg-cyan-500/[0.06] border-cyan-500/20' : 'bg-white/[0.02] border-white/5'}`}>
            <div className="flex items-center gap-2 text-[10px] text-white/40 mb-1">
              <span className="text-white/75 font-medium">{agentName(m.from)}</span> → <span>{m.to === 'all' ? 'equipe' : m.to === 'user' ? 'você' : agentName(m.to)}</span>
              <span className="px-1.5 rounded-full bg-white/5">{KIND_LABEL[m.kind] || m.kind}</span>
              <span className="ml-auto">{new Date(m.at).toLocaleTimeString('pt-BR')}</span>
            </div>
            <p className="text-white/70 whitespace-pre-wrap">{m.content}</p>
          </motion.div>
        ))}
        {!run.messages.length && <Empty text="As mensagens entre os agentes aparecem aqui." />}
        <div ref={end} />
      </div>
      {active && (
        <form className="flex gap-2 mt-3 sticky bottom-0" onSubmit={e => { e.preventDefault(); if (text.trim()) control('message', { to, content: text }).then(() => setText('')) }}>
          <select value={to} onChange={e => setTo(e.target.value)} className="input-jarvis px-2 rounded-lg text-xs">
            <option value="all">Equipe toda</option>
            {run.agents.filter(a => !a.removed).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <input value={text} onChange={e => setText(e.target.value)} placeholder="Mensagem para os agentes (eles leem no próximo passo)" className="input-jarvis flex-1 px-3 py-2 rounded-lg text-xs" />
          <button type="submit" className="px-3 rounded-lg bg-cyan-500/20 text-cyan-200 hover:bg-cyan-500/30"><Send size={13} /></button>
        </form>
      )}
    </div>
  )
}

function ActivityTab({ events, agentName }: { events: RunEvent[]; agentName: (id: string) => string }) {
  const [agent, setAgent] = useState('')
  const end = useRef<HTMLDivElement>(null)
  const list = events.filter(e => !agent || e.agentId === agent).filter(e => e.type !== 'agent_step')
  useEffect(() => { end.current?.scrollIntoView() }, [list.length])
  const agents = [...new Set(events.map(e => e.agentId).filter(Boolean))] as string[]
  return (
    <div>
      <div className="flex gap-1 mb-2 flex-wrap">
        <button onClick={() => setAgent('')} className={`px-2 py-0.5 rounded-full text-[10px] ${!agent ? 'bg-cyan-500/20 text-cyan-200' : 'text-white/40'}`}>Todos</button>
        {agents.map(a => <button key={a} onClick={() => setAgent(a)} className={`px-2 py-0.5 rounded-full text-[10px] ${agent === a ? 'bg-cyan-500/20 text-cyan-200' : 'text-white/40'}`}>{agentName(a)}</button>)}
      </div>
      <div className="font-mono text-[11px] space-y-0.5">
        {list.map(e => (
          <div key={e.id} className={`flex gap-2 ${e.level === 'error' ? 'text-red-300' : e.level === 'warn' ? 'text-amber-200/80' : e.type === 'agent_thought' ? 'text-violet-200/60 italic' : 'text-white/55'}`}>
            <span className="text-white/25 flex-shrink-0">{new Date(e.at).toLocaleTimeString('pt-BR')}</span>
            <span className="break-words">{e.message}</span>
          </div>
        ))}
        {!list.length && <Empty text="Sem atividade ainda." />}
        <div ref={end} />
      </div>
    </div>
  )
}

function FilesTab({ files, agentName }: { files: Array<{ path: string; added: number; removed: number; agents: Set<string>; action: string }>; agentName: (id: string) => string }) {
  if (!files.length) return <Empty text="Nenhum arquivo alterado ainda." />
  return (
    <div className="space-y-1">
      {files.map(f => (
        <div key={f.path} className="flex items-center gap-2 p-2 rounded-lg bg-white/[0.02] text-xs">
          <FileCode2 size={13} className={f.action === 'created' ? 'text-green-300' : 'text-cyan-300'} />
          <span className="font-mono text-white/80 flex-1 truncate">{f.path}</span>
          <span className="text-[10px] text-white/40">{[...f.agents].map(agentName).join(', ')}</span>
          <span className="font-mono text-[10px] text-green-300">+{f.added}</span>
          <span className="font-mono text-[10px] text-red-300">-{f.removed}</span>
        </div>
      ))}
    </div>
  )
}

function ErrorsTab({ events, agents, agentName }: { events: RunEvent[]; agents: AgentRuntimeState[]; agentName: (id: string) => string }) {
  const withErrors = agents.filter(a => a.errors.length)
  if (!events.length && !withErrors.length) return <Empty text="Nenhum erro. 🎉" />
  return (
    <div className="space-y-2">
      {events.map(e => (
        <div key={e.id} className={`p-2 rounded-lg text-xs ${e.level === 'error' ? 'bg-red-500/[0.07] text-red-200' : 'bg-amber-400/[0.06] text-amber-100/80'}`}>
          <span className="text-white/30 mr-2">{new Date(e.at).toLocaleTimeString('pt-BR')}</span>
          {e.agentId && <span className="font-medium mr-1">{agentName(e.agentId)}:</span>}{e.message}
        </div>
      ))}
    </div>
  )
}

function ApprovalsTab({ run, agentName, active, control }: { run: Run; agentName: (id: string) => string; active: boolean; control: (a: string, b?: Record<string, unknown>, ok?: string) => Promise<unknown> }) {
  // ALT-1: dois tipos de pedidos — aprovação de ferramenta e alteração de arquivo
  // fora do escopo — precisam das duas listas. Antes, apenas o escopo aparecia:
  // quem acionava a execução no workspace travava para sempre.
  const aprovacoes = (run.approvals || []).filter(a => a.status === 'pending')
  const escopos = run.scopeRequests.filter(r => r.status === 'pending')
  if (!aprovacoes.length && !escopos.length) {
    return <Empty text="Quando um agente pedir aprovação de ferramenta ou alterar um arquivo fora do escopo, o pedido aparece aqui para você decidir." />
  }
  return (
    <div className="space-y-2">
      {aprovacoes.map(a => (
        <div key={a.id} className="p-3 rounded-xl border border-white/5 bg-white/[0.02] text-xs flex items-center gap-3">
          <ShieldCheck size={15} className="text-amber-300" />
          <div className="flex-1">
            <div><span className="text-white/80 font-medium">{agentName(a.agentId)}</span> quer usar <span className="font-mono text-cyan-200">{a.tool}</span>{a.summary ? ` — ${a.summary}` : ''}</div>
          </div>
          {active ? (
            <>
              <button onClick={() => control('approve', { approvalId: a.id }, 'Aprovado')} className="px-3 py-1 rounded-lg bg-green-500/20 text-green-200 hover:bg-green-500/30">Aprovar</button>
              <button onClick={() => control('deny', { approvalId: a.id }, 'Negado')} className="px-3 py-1 rounded-lg bg-red-500/15 text-red-200 hover:bg-red-500/25"><X size={12} /></button>
            </>
          ) : <span className="text-[10px] text-white/40">esperando a decisão</span>}
        </div>
      ))}
      {escopos.map(r => (
        <div key={r.id} className="p-3 rounded-xl border border-white/5 bg-white/[0.02] text-xs flex items-center gap-3">
          <ShieldCheck size={15} className={r.status === 'pending' ? 'text-amber-300' : r.status === 'approved' ? 'text-green-300' : 'text-red-300'} />
          <div className="flex-1">
            <div><span className="text-white/80 font-medium">{agentName(r.agentId)}</span> quer alterar <span className="font-mono text-cyan-200">{r.path}</span></div>
            {r.reason && <div className="text-white/40 mt-0.5">{r.reason}</div>}
          </div>
          {active ? (
            <>
              <button onClick={() => control('scope-approve', { requestId: r.id }, 'Aprovado')} className="px-3 py-1 rounded-lg bg-green-500/20 text-green-200 hover:bg-green-500/30">Aprovar</button>
              <button onClick={() => control('scope-deny', { requestId: r.id }, 'Negado')} className="px-3 py-1 rounded-lg bg-red-500/15 text-red-200 hover:bg-red-500/25"><X size={12} /></button>
            </>
          ) : <span className="text-[10px] text-white/40">{r.status === 'approved' ? 'aprovado' : 'negado'}</span>}
        </div>
      ))}
    </div>
  )
}
