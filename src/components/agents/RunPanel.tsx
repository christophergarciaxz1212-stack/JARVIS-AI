'use client'

import { useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronRight, CircleDashed, Loader2, Users, XCircle } from 'lucide-react'
import type { AgentTask, TaskStatus } from '@/lib/agents/types'
import { ACTIVE_RUN_STATUSES } from '@/lib/agents/types'
import { useRunStream } from './useRunStream'
import DiffView from './DiffView'
import { fmtDuration, shortModel } from './api'

/**
 * Coluna da direita durante uma execução: o plano, quem está trabalhando e o
 * que mudou em cada arquivo. Acompanha a conversa — não é uma tela à parte.
 */
export default function RunPanel({ runId, onChanged }: { runId: string; onChanged?: () => void }) {
  const { run } = useRunStream(runId, onChanged)
  const [aba, setAba] = useState<'plano' | 'arquivos'>('plano')

  if (!run) {
    return <div className="flex items-center gap-2 px-3 py-4 text-[11px] text-white/35"><Loader2 size={11} className="animate-spin" /> carregando a execução…</div>
  }

  const ativo = ACTIVE_RUN_STATUSES.includes(run.status)
  const pendentes = (run.approvals || []).filter(a => a.status === 'pending').length
  const feitas = run.tasks.filter(t => t.status === 'done').length
  const decorrido = run.startedAt ? (run.finishedAt || Date.now()) - run.startedAt : 0

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Resumo */}
      <div className="px-3 py-2 border-b border-white/5">
        <div className="flex items-center gap-2">
          {ativo
            ? <Loader2 size={12} className="animate-spin text-cyan-300 flex-shrink-0" />
            : run.status === 'failed' || run.status === 'interrupted'
              ? <XCircle size={12} className="text-red-300 flex-shrink-0" />
              : <CheckCircle2 size={12} className="text-green-400 flex-shrink-0" />}
          <span className="text-[11px] text-white/70 truncate flex-1">{run.request}</span>
        </div>
        <div className="flex items-center gap-2.5 mt-1 text-[10px] text-white/30">
          <span>{feitas}/{run.tasks.length} tarefas</span>
          <span>{run.changes.length} arquivo{run.changes.length === 1 ? '' : 's'}</span>
          {decorrido > 0 && <span>{fmtDuration(decorrido)}</span>}
        </div>
      </div>

      {pendentes > 0 && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] text-amber-200 bg-amber-500/10 border-b border-amber-400/20">
          <AlertTriangle size={10} />
          {pendentes === 1 ? '1 aprovação esperando você na conversa' : `${pendentes} aprovações esperando você na conversa`}
        </div>
      )}

      <div className="flex gap-1 px-2 py-1.5 border-b border-white/5">
        {([['plano', 'Plano'], ['arquivos', 'Alterações']] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setAba(id)}
            className={`flex-1 py-1 rounded-lg text-[11px] transition-colors ${aba === id ? 'bg-white/[0.07] text-white/85' : 'text-white/35 hover:text-white/65'}`}
          >
            {label}{id === 'arquivos' && run.changes.length ? ` (${run.changes.length})` : ''}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {aba === 'plano' ? <Plano tarefas={run.tasks} nomeDoAgente={id => run.agents.find(a => a.id === id)?.name || id} /> : <DiffView runId={runId} onChanged={onChanged} />}
      </div>

      {/* Quem está na equipe */}
      {run.agents.length > 0 && (
        <div className="border-t border-white/5 px-3 py-2">
          <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-white/30 mb-1">
            <Users size={9} /> Agentes
          </div>
          <div className="space-y-0.5">
            {run.agents.filter(a => !a.removed).map(a => (
              <div key={a.id} className="flex items-center gap-1.5 text-[11px]">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${a.status === 'executing' || a.status === 'planning' ? 'bg-cyan-400 animate-pulse' : a.status === 'done' ? 'bg-green-400/70' : a.status === 'failed' ? 'bg-red-400' : 'bg-white/20'}`} />
                <span className="text-white/65 truncate flex-1">{a.name}</span>
                <span className="text-[9px] font-mono text-white/25 truncate max-w-[90px]">{shortModel(a.resolvedModel || a.model)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const ICONE: Record<TaskStatus, React.ReactNode> = {
  pending: <CircleDashed size={11} className="text-white/25" />,
  running: <Loader2 size={11} className="animate-spin text-cyan-300" />,
  done: <CheckCircle2 size={11} className="text-green-400/80" />,
  failed: <XCircle size={11} className="text-red-300" />,
  blocked: <AlertTriangle size={11} className="text-amber-300" />,
  cancelled: <ChevronRight size={11} className="text-white/20" />,
}

function Plano({ tarefas, nomeDoAgente }: { tarefas: AgentTask[]; nomeDoAgente: (id: string) => string }) {
  if (!tarefas.length) return <div className="text-[11px] text-white/30 px-1 py-2">O plano ainda está sendo montado…</div>
  return (
    <ol className="space-y-1">
      {tarefas.map((t, i) => (
        <li key={t.id} className="flex items-start gap-2 px-1 py-1">
          <span className="flex-shrink-0 mt-0.5">{ICONE[t.status]}</span>
          <div className="min-w-0 flex-1">
            <div className={`text-[12px] leading-tight ${t.status === 'done' ? 'text-white/45' : t.status === 'failed' ? 'text-red-300/90' : 'text-white/75'}`}>
              <span className="text-white/25 font-mono mr-1">{i + 1}.</span>{t.title}
            </div>
            <div className="text-[10px] text-white/25 mt-0.5">{nomeDoAgente(t.agentId)}</div>
            {t.error && <div className="text-[10px] text-red-300/80 mt-0.5">{t.error}</div>}
          </div>
        </li>
      ))}
    </ol>
  )
}
