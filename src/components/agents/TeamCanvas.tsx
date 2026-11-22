'use client'

/**
 * TeamCanvas — a visão colaborativa da execução: líder, especialistas,
 * tarefas paralelas com dependências e a conversa (inclusive perguntas do
 * líder ao usuário). Tudo com indicadores de estado em texto + ícone + cor.
 */
import { useMemo, useState } from 'react'
import { Activity, AlertTriangle, ArrowRight, CheckCircle2, CircleDashed, Clock3, Loader2, MessageCircle, Send, ShieldCheck, Users, XCircle } from 'lucide-react'
import type { AgentRuntimeState, AgentTask, RoleTemplate, Run } from '@/lib/agents/types'
import { STATUS_LABEL } from './shared'
import { fmtDuration, fmtTokens, shortModel } from './api'

const STATUS: Record<string, { icon: React.ReactNode; cls: string; label: string }> = {
  pending: { icon: <CircleDashed size={13} />, cls: 'text-white/40', label: 'Na fila' },
  running: { icon: <Loader2 size={13} className="animate-spin text-cyan-300" />, cls: 'text-cyan-300', label: 'Executando' },
  done: { icon: <CheckCircle2 size={13} className="text-emerald-400" />, cls: 'text-emerald-300', label: 'Concluída' },
  failed: { icon: <XCircle size={13} className="text-red-400" />, cls: 'text-red-300', label: 'Falhou' },
  blocked: { icon: <AlertTriangle size={13} className="text-amber-400" />, cls: 'text-amber-300', label: 'Bloqueada' },
  cancelled: { icon: <XCircle size={13} className="text-white/30" />, cls: 'text-white/30', label: 'Cancelada' },
}

function TaskCard({ task, agentName, now, onCancel, active }: { task: AgentTask; agentName: (id: string) => string; now: number; onCancel?: (id: string) => void; active: boolean }) {
  const s = STATUS[task.status] || STATUS.pending
  const progress = task.status === 'done' ? 100 : task.status === 'running' && task.startedAt
    ? Math.min(95, Math.round(((now - task.startedAt) / Math.max(1, task.startedAt + 120_000 - now + (now - task.startedAt))) * 100))
    : Math.min(95, Math.round(task.progress ?? (task.status === 'pending' ? 0 : 50)))
  return (
    <div className={`w-[200px] flex-shrink-0 rounded-xl border bg-white/[0.025] p-2.5 ${task.status === 'running' ? 'border-cyan-400/35' : 'border-white/[0.07]'}`}>
      <div className="flex items-center gap-1.5">
        <span className={s.cls}>{s.icon}</span>
        <span className="text-[10px] font-mono text-white/35">{task.id}</span>
        <span className={`ml-auto text-[10px] ${s.cls}`}>{s.label}</span>
      </div>
      <div className="text-xs text-white/85 mt-1 line-clamp-2" title={task.description}>{task.title}</div>
      <div className="text-[10px] text-white/35 mt-1.5 truncate">{agentName(task.agentId)} · {task.kind}</div>
      {task.dependsOn.length > 0 && (
        <div className="text-[10px] text-white/30 mt-0.5 truncate">após {task.dependsOn.join(', ')}</div>
      )}
      <div className="mt-2 h-1 rounded-full bg-white/5 overflow-hidden">
        <div className={`h-full rounded-full ${task.status === 'done' ? 'bg-emerald-400/80' : task.status === 'failed' ? 'bg-red-400/70' : 'bg-cyan-400/80'}`} style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
      </div>
      {task.error && <div className="text-[10px] text-red-300/80 mt-1 line-clamp-2" title={task.error}>{task.error}</div>}
      {active && task.status === 'running' && onCancel && (
        <button onClick={() => onCancel(task.id)} className="mt-2 w-full py-1 rounded-lg text-[10px] text-white/45 hover:text-red-300 hover:bg-red-500/10 border border-white/5">cancelar tarefa</button>
      )}
    </div>
  )
}

function AgentTile({ agent, role, task, now }: { agent: AgentRuntimeState; role?: RoleTemplate; task?: AgentTask; now: number }) {
  const st = STATUS_LABEL[agent.status] || STATUS_LABEL.waiting
  const working = ['executing', 'planning', 'reviewing', 'communicating'].includes(agent.status)
  const color = agent.color || role?.color || '#00d4ff'
  const progress = agent.status === 'done' ? 100 : agent.progress ?? (task ? Math.round((agent.step / Math.max(1, agent.maxSteps)) * 100) : 0)
  return (
    <div className={`relative rounded-xl border bg-white/[0.025] p-3 ${working ? 'border-cyan-400/30' : 'border-white/[0.07]'}`} style={{ boxShadow: working ? `0 0 22px -10px ${color}` : undefined }}>
      <div className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full" style={{ background: color }} />
      <div className="flex items-center gap-2">
        <span className="w-8 h-8 rounded-xl flex items-center justify-center text-base flex-shrink-0" style={{ background: `${color}22`, border: `1px solid ${color}55` }}>{role?.icon || '🤖'}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-white truncate">{agent.name}</span>
            {role?.leader && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-fuchsia-500/15 text-fuchsia-300 border border-fuchsia-400/20">LÍDER</span>}
          </div>
          <div className="text-[10px] text-white/40 truncate" title={agent.resolvedModel}>{role?.name || agent.roleId} · {shortModel(agent.resolvedModel || agent.model)}</div>
        </div>
        <span className={`text-[10px] ${working ? 'text-cyan-300' : agent.status === 'done' ? 'text-emerald-300' : agent.status === 'failed' ? 'text-red-300' : 'text-white/40'}`}>{st.label}</span>
      </div>
      <div className="text-[11px] text-white/55 mt-2 line-clamp-2 min-h-[28px]">
        {task ? <><span className="text-white/30">{task.id}</span> {task.title}</> : agent.idleReason || (agent.status === 'done' ? 'Entrega concluída' : 'Aguardando tarefa')}
      </div>
      <div className="mt-2 h-1 rounded-full bg-white/5 overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(0, Math.min(100, progress))}%`, background: `linear-gradient(90deg, ${color}, #a78bfa)` }} />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] font-mono text-white/35">
        <span>{fmtTokens(agent.usage.inputTokens + agent.usage.outputTokens)} tok</span>
        <span>{fmtDuration(agent.activeMs + (agent.currentTaskId && task?.startedAt ? now - task.startedAt : 0))}</span>
        <span title="Passos">{agent.step}/{agent.maxSteps}</span>
        {agent.errors.length > 0 && <span className="text-amber-300">⚠ {agent.errors.length}</span>}
        {agent.pendingReply && <span className="text-fuchsia-300">aguardando você</span>}
      </div>
    </div>
  )
}

export default function TeamCanvas({ run, roles, active, onReply, onCancelTask, agentName }: {
  run: Run
  roles: RoleTemplate[]
  active: boolean
  onReply: (content: string) => void
  onCancelTask?: (taskId: string) => void
  agentName: (id: string) => string
}) {
  const now = Date.now()
  const [reply, setReply] = useState('')
  const agents = run.agents.filter(a => !a.removed)
  const leader = agents.find(a => roles.find(r => r.id === a.roleId)?.leader)
  const pendingQuestion = leader?.pendingReply
    ? [...run.messages].reverse().find(m => m.id === leader.pendingReply?.id)
    : undefined
  const levels = useMemo(() => {
    const byId = new Map(run.tasks.map(t => [t.id, t]))
    const depth = new Map<string, number>()
    const get = (t: AgentTask, seen = new Set<string>()): number => {
      if (depth.has(t.id)) return depth.get(t.id)!
      if (seen.has(t.id)) return 0
      seen.add(t.id)
      const d = t.dependsOn.length ? Math.max(...t.dependsOn.map(id => { const dep = byId.get(id); return dep ? get(dep, seen) + 1 : 0 })) : 0
      depth.set(t.id, d)
      return d
    }
    run.tasks.forEach(t => get(t))
    const cols = new Map<number, AgentTask[]>()
    for (const t of run.tasks) {
      const d = depth.get(t.id) || 0
      cols.set(d, [...(cols.get(d) || []), t])
    }
    return [...cols.entries()].sort((a, b) => a[0] - b[0]).map(([d, tasks]) => ({ depth: d, tasks }))
  }, [run.tasks])

  const working = agents.filter(a => ['executing', 'planning', 'reviewing', 'communicating'].includes(a.status)).length
  const doneTasks = run.tasks.filter(t => t.status === 'done').length
  const failedTasks = run.tasks.filter(t => t.status === 'failed' || t.status === 'blocked').length

  return (
    <div className="space-y-4">
      {/* Resumo da equipe — o que está acontecendo AGORA */}
      <div className="jv-card jv-card-pad flex items-center gap-3 flex-wrap">
        <Users size={16} className="text-fuchsia-300" />
        <div className="flex-1 min-w-[180px]">
          <div className="text-sm font-semibold text-white">{leader ? `${leader.name} coordenando` : 'Equipe em trabalho'}</div>
          <div className="jv-muted-text">{agents.length} agentes · {working} trabalhando · {doneTasks}/{run.tasks.length} tarefas concluídas{failedTasks ? ` · ${failedTasks} com problema` : ''}</div>
        </div>
        <span className={`jv-badge ${active ? 'jv-badge-info' : failedTasks ? 'jv-badge-fail' : 'jv-badge-ok'}`}>
          {active ? <Loader2 size={11} className="animate-spin" /> : failedTasks ? <AlertTriangle size={11} /> : <CheckCircle2 size={11} />}
          {active ? 'Equipe trabalhando' : failedTasks ? 'Entrega com pendências' : 'Equipe finalizou'}
        </span>
      </div>

      {/* Pergunta do líder ao usuário (human-in-the-loop) */}
      {pendingQuestion && (
        <div className="jv-card jv-card-pad border-fuchsia-400/30">
          <div className="flex items-center gap-2 text-xs font-semibold text-fuchsia-200"><MessageCircle size={13} /> {leader?.name} precisa de uma decisão sua</div>
          <p className="text-sm text-white/80 mt-2">{pendingQuestion.content}</p>
          <div className="flex gap-2 mt-3">
            <input value={reply} onChange={e => setReply(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && reply.trim()) { onReply(reply.trim()); setReply('') } }} placeholder="Sua resposta para a equipe…" className="jv-input flex-1" />
            <button disabled={!reply.trim()} onClick={() => { onReply(reply.trim()); setReply('') }} className="jv-btn jv-btn-primary"><Send size={12} /> Responder</button>
          </div>
        </div>
      )}

      {/* Especialistas */}
      <div>
        <div className="jv-section-title"><Users size={12} /> Especialistas ({agents.length})</div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
          {agents.map(a => <AgentTile key={a.id} agent={a} role={roles.find(r => r.id === a.roleId)} task={run.tasks.find(t => t.id === a.currentTaskId)} now={now} />)}
        </div>
      </div>

      {/* Plano visual: tarefas paralelas por nível de dependência */}
      <div>
        <div className="jv-section-title"><Activity size={12} /> Plano de execução — tarefas paralelas e dependências</div>
        {run.tasks.length === 0 ? (
          <p className="jv-muted-text">O plano aparece aqui quando o líder termina de analisar a missão.</p>
        ) : (
          <div className="flex gap-2 overflow-x-auto pb-2">
            {levels.map((col, i) => (
              <div key={col.depth} className="flex gap-2 items-start">
                <div className="flex flex-col gap-2">
                  <span className="text-[10px] text-white/30 uppercase tracking-wide">nível {i + 1}</span>
                  {col.tasks.map(t => <TaskCard key={t.id} task={t} agentName={agentName} now={now} active={active} onCancel={onCancelTask} />)}
                </div>
                {i < levels.length - 1 && <ArrowRight size={14} className="text-white/20 mt-8 flex-shrink-0" />}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Comunicação da equipe (quem falou com quem) */}
      <div>
        <div className="jv-section-title"><MessageCircle size={12} /> Comunicação da equipe ({run.messages.length})</div>
        <div className="jv-card jv-card-pad max-h-[300px] overflow-y-auto space-y-1.5">
          {run.messages.length === 0 && <p className="jv-muted-text">Nenhuma mensagem trocada ainda.</p>}
          {[...run.messages].reverse().slice(0, 60).map(m => (
            <div key={m.id} className="flex gap-2 text-[11px] border-b border-white/5 last:border-0 pb-1.5">
              <span className="text-cyan-300/70 font-mono flex-shrink-0">{agentName(m.from) === m.from ? m.from : agentName(m.from)}</span>
              <ArrowRight size={11} className="text-white/20 mt-0.5 flex-shrink-0" />
              <span className="text-violet-300/80 flex-shrink-0">{m.to}</span>
              <span className="text-white/55 flex-1 min-w-0">{m.content}</span>
              <Clock3 size={10} className="text-white/20 flex-shrink-0" />
            </div>
          ))}
        </div>
      </div>

      {/* Critérios de conclusão (revisão cruzada) */}
      <div className="jv-card jv-card-pad flex items-start gap-2">
        <ShieldCheck size={14} className="text-emerald-300 flex-shrink-0" />
        <div className="jv-muted-text">
          Uma tarefa só conta como concluída quando o agente grava a alteração e a verifica com ferramenta.
          Revisores (QA/Segurança) apontam problemas; o líder devolve para correção antes da entrega final.
        </div>
      </div>
    </div>
  )
}
