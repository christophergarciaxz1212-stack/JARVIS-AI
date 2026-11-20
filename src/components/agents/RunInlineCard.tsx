'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Markdown from '@/components/chat/Markdown'
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, FileCode2, Loader2, Maximize2, SquareTerminal, XCircle,
} from 'lucide-react'
import type { SessionMeta } from '@/lib/agents/types'
import { ACTIVE_RUN_STATUSES } from '@/lib/agents/types'
import { api, fmtDuration, fmtTokens, shortModel } from './api'
import { useRunStream } from './useRunStream'
import { buildTranscript, TranscriptRow } from './transcript'

/**
 * opencode-style inline view of an agent run, embedded in the chat conversation:
 * every command (with its output), file created/edited, search, message and approval
 * request, live — plus a button to open the full team workspace.
 */
export default function RunInlineCard({ runId, sessionId, title, onOpenWorkspace, onChanged }: {
  runId: string
  sessionId?: string
  title?: string
  onOpenWorkspace?: (sessionId: string) => void
  onChanged?: () => void
}) {
  const [details, setDetails] = useState(false)
  const [open, setOpen] = useState(true)
  const [follow, setFollow] = useState(true)
  const box = useRef<HTMLDivElement>(null)

  const { run, events } = useRunStream(runId, onChanged)
  const [agentNames, setAgentNames] = useState<Map<string, string>>(new Map())
  const [deciding, setDeciding] = useState(false)
  const [decisionError, setDecisionError] = useState('')

  /** Decisões do usuário acontecem aqui na conversa; o SSE traz o novo estado. */
  const decide = async (action: string, body: Record<string, unknown>) => {
    setDeciding(true)
    setDecisionError('')
    try {
      await api.runAction(runId, action, body)
      onChanged?.()
    } catch (e) {
      setDecisionError((e as Error).message)
    } finally {
      setDeciding(false)
    }
  }

  const actions = {
    deciding,
    onApproval: (approvalId: string, approve: boolean) => void decide(approve ? 'approve' : 'deny', { approvalId }),
    onPlan: (approve: boolean) => void decide(approve ? 'plan-approve' : 'plan-reject', {}),
  }

  useEffect(() => {
    setAgentNames(new Map((run?.agents || []).map(a => [a.id, a.name])))
  }, [run?.agents])

  const agentName = (id: string) => agentNames.get(id) || (id === 'user' ? 'Você' : id)

  const active = !!run && ACTIVE_RUN_STATUSES.includes(run.status)
  const failed = run?.status === 'failed' || run?.status === 'interrupted'
  const done = !!run && !active

  const items = useMemo(
    () => buildTranscript(events, run, agentName).filter(i => (details || i.kind !== 'llm') && i.kind !== 'request'),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- agentName is derived from run
    [events, run, details, agentNames],
  )

  useEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight
  }, [items.length, follow, items])

  const onScroll = () => {
    const el = box.current
    if (!el) return
    setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 80)
  }

  const pendingScopes = run?.scopeRequests.filter(r => r.status === 'pending').length || 0
  const pendingTools = (run?.approvals || []).filter(a => a.status === 'pending').length
  const awaitingUser = run?.status === 'awaiting_plan' || pendingTools > 0
  const commandCount = events.filter(e => e.type === 'command').length
  const fileCount = run?.changes.length || 0
  const elapsed = run?.startedAt ? (run.finishedAt || Date.now()) - run.startedAt : 0

  const status = awaitingUser
    ? { icon: <AlertTriangle size={14} className="text-amber-300" />, text: run?.status === 'awaiting_plan' ? 'Plano pronto — sua decisão' : 'Esperando sua aprovação', cls: 'text-amber-300' }
    : active
      ? { icon: <Loader2 size={14} className="animate-spin text-cyan-300" />, text: 'JARVIS está trabalhando', cls: 'text-cyan-300' }
      : failed
        ? { icon: <XCircle size={14} className="text-red-300" />, text: 'Falhou', cls: 'text-red-300' }
        : { icon: <CheckCircle2 size={14} className="text-green-400" />, text: 'Concluído', cls: 'text-green-400' }

  return (
    <div className="my-1 w-full max-w-3xl rounded-2xl border border-cyan-500/15 bg-[#0a0f1a]/80 overflow-hidden shadow-[0_0_40px_rgba(0,212,255,0.05)]">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5 bg-white/[0.03]">
        <div className="w-6 h-6 rounded-md bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center flex-shrink-0">
          <SquareTerminal size={13} className="text-cyan-300" />
        </div>
        <button onClick={() => setOpen(o => !o)} className="flex items-center gap-2 min-w-0 flex-1 text-left">
          {status.icon}
          <span className={`text-xs font-medium ${status.cls}`}>{status.text}</span>
          {title && <span className="text-xs text-white/45 truncate hidden sm:inline">· {title}</span>}
          <span className="text-[10px] text-white/25 font-mono ml-1 hidden md:inline">{shortModel(run?.agents.find(a => a.status !== 'waiting')?.resolvedModel || run?.agents[0]?.model)}</span>
          {open ? <ChevronDown size={14} className="text-white/35 flex-shrink-0" /> : <ChevronRight size={14} className="text-white/35 flex-shrink-0" />}
        </button>
        {onOpenWorkspace && sessionId && (
          <button
            onClick={() => onOpenWorkspace(sessionId)}
            title="Abrir o acompanhamento completo (tarefas, arquivos, aprovações, relatório)"
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] text-cyan-200/80 hover:text-cyan-100 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 transition-colors flex-shrink-0"
          >
            <Maximize2 size={11} /> Workspace
          </button>
        )}
      </div>

      {/* Aprovação de ferramenta: decidida na própria conversa, abaixo no transcript */}
      {pendingTools > 0 && (
        <div className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-amber-200 bg-amber-500/10 border-b border-amber-400/20">
          <AlertTriangle size={12} />
          {pendingTools === 1 ? 'JARVIS pediu uma aprovação' : `JARVIS pediu ${pendingTools} aprovações`} — decida abaixo para continuar
        </div>
      )}
      {/* Pedido de escopo de arquivo: ainda decidido no workspace */}
      {pendingScopes > 0 && (
        <button
          onClick={() => sessionId && onOpenWorkspace?.(sessionId)}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-amber-200 bg-amber-500/10 border-b border-amber-400/20 text-left"
        >
          <AlertTriangle size={12} /> JARVIS pediu permissão para um arquivo fora do escopo — clique para decidir no workspace
        </button>
      )}

      {/* Body */}
      {open && (
        <>
          <div className="flex items-center gap-3 px-3 py-1.5 text-[10px] text-white/35 border-b border-white/5">
            <span>{commandCount} comando{commandCount === 1 ? '' : 's'}</span>
            <span className="flex items-center gap-1"><FileCode2 size={10} /> {fileCount} arquivo{fileCount === 1 ? '' : 's'}</span>
            {elapsed > 0 && <span>{fmtDuration(elapsed)}</span>}
            <span>{fmtTokens((run?.usage.inputTokens || 0) + (run?.usage.outputTokens || 0))} tokens</span>
            <div className="flex-1" />
            <label className="flex items-center gap-1 cursor-pointer hover:text-white/55"><input type="checkbox" className="accent-cyan-400" checked={details} onChange={e => setDetails(e.target.checked)} /> chamadas de modelo</label>
          </div>
          <div ref={box} onScroll={onScroll} className="max-h-[380px] overflow-y-auto px-2 py-2 space-y-1.5">
            {items.length === 0 && active && <div className="text-xs text-white/35 px-2 py-3">Analisando o pedido…</div>}
            {items.map(it => <TranscriptRow key={it.id} it={it} actions={actions} />)}
            {decisionError && <div className="text-[11px] text-red-300 px-2 py-1">{decisionError}</div>}
            {active && items.length > 0 && (
              <div className="flex items-center gap-2 text-[11px] text-cyan-200/60 py-1.5 pl-1"><Loader2 size={11} className="animate-spin" /> trabalhando…</div>
            )}
            {done && run?.report && (
              <div className="mt-2 p-3 rounded-xl border border-green-400/15 bg-green-500/[0.04]">
                <div className="text-[9px] uppercase tracking-wider text-green-300/60 mb-1.5">Resultado</div>
                <Markdown className="text-[13px]">{run.report}</Markdown>
              </div>
            )}
            {failed && run?.error && (
              <div className="mt-2 p-3 rounded-xl border border-red-400/20 bg-red-500/[0.05] text-xs text-red-300">{run.error}</div>
            )}
          </div>
          {!follow && (
            <button onClick={() => { setFollow(true); if (box.current) box.current.scrollTop = box.current.scrollHeight }} className="absolute mt-[-34px] ml-3 flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-cyan-500/80 text-black">
              acompanhar ↓
            </button>
          )}
        </>
      )}
      {!open && done && (
        <div className="px-3 py-1.5 text-[10px] text-white/30 border-t border-white/5">
          {failed ? 'Execução falhou — abra para ver os detalhes' : 'Execução concluída — clique para ver o transcript'}
        </div>
      )}
    </div>
  )
}
