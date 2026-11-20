// Shared transcript builder + row renderers for agent runs.
// Used by LiveTimeline (full workspace) and RunInlineCard (inline in the chat).
import { motion } from 'framer-motion'
import { useState } from 'react'
import { Ban, CheckCircle2, ChevronDown, ChevronRight, Loader2, ShieldAlert, Terminal, XCircle } from 'lucide-react'
import type { Run, RunEvent, ToolCallStatus } from '@/lib/agents/types'

/** Decisões que as linhas do transcript podem pedir ao usuário. */
export interface TranscriptActions {
  onApproval?: (approvalId: string, approve: boolean) => void
  onPlan?: (approve: boolean) => void
  /** Uma decisão está sendo enviada: desabilita os botões para não clicar duas vezes. */
  deciding?: boolean
}

export type Item =
  | { kind: 'request'; id: string; text: string }
  | { kind: 'plan'; id: string; text: string; at: number }
  | { kind: 'task'; id: string; text: string; agent?: string; at: number; done?: boolean; failed?: boolean }
  | { kind: 'thought'; id: string; text: string; agent?: string; at: number }
  | {
    kind: 'tool'; id: string; tool: string; target: string; agent?: string; at: number; error?: string
    status: ToolCallStatus; durationMs?: number; args?: Record<string, unknown>; risk?: string
  }
  /** Pedido de aprovação de uma chamada, decidido pelo usuário aqui no chat. */
  | {
    kind: 'approval'; id: string; approvalId: string; tool: string; summary: string; risk: string
    agent?: string; at: number; status: 'pending' | 'approved' | 'denied'
  }
  /** Plan Mode: plano pronto esperando aprovação. */
  | { kind: 'planGate'; id: string; at: number; summary?: string; steps: Array<{ id: string; title: string }>; status: 'pending' | 'approved' | 'rejected' }
  | { kind: 'file'; id: string; text: string; path: string; created: boolean; added: number; removed: number; agent?: string; at: number }
  | { kind: 'command'; id: string; command: string; agent?: string; at: number; output?: string; exitCode?: number | null; durationMs?: number; done: boolean }
  | { kind: 'message'; id: string; text: string; at: number }
  | { kind: 'notice'; id: string; text: string; level: 'info' | 'warn' | 'error'; at: number }
  | { kind: 'llm'; id: string; text: string; at: number }

export const TOOL_LABEL: Record<string, [string, string]> = {
  read_file: ['📖', 'Leu'], list_dir: ['📂', 'Listou'], search: ['🔍', 'Procurou'], write_file: ['✏️', 'Escreveu'], edit_file: ['✏️', 'Editou'],
  send_message: ['💬', 'Mensagem para'], delegate: ['🤝', 'Delegou para'], request_scope: ['🔐', 'Pediu permissão para'],
  skill_find: ['🧩', 'Procurou skill'], skill_use: ['🧩', 'Usou skill'], skill_read: ['🧩', 'Leu skill'], skill_request: ['🧩', 'Pediu skill'],
  hub_search: ['🎓', 'Buscou no Hub'], hub_course: ['🎓', 'Abriu disciplina'], hub_tasks: ['🎓', 'Viu prazos'], hub_add_task: ['🎓', 'Registrou'],
  hub_complete_task: ['🎓', 'Concluiu'], hub_save_study: ['🎓', 'Salvou estudo'], github_read: ['🐙', 'Leu no GitHub'], hub_request_action: ['🛡️', 'Pediu aprovação'],
  remember_project: ['🧠', 'Anotou na memória do projeto'], update_project_memory: ['🧠', 'Atualizou a memória do projeto'],
  web_search: ['🌐', 'Procurou na web'], web_fetch: ['🌐', 'Leu a página'],
  git_status: ['🌿', 'Viu o estado do Git'], git_diff: ['🌿', 'Viu o diff'], git_log: ['🌿', 'Viu o histórico'],
  git_branch: ['🌿', 'Listou as branches'], git_commit: ['🌿', 'Commitou'],
  finish: ['✅', 'Finalizou'],
}

/** Ferramentas que já têm visual próprio (bloco de comando, linha de arquivo). */
const SHOWN_ELSEWHERE = new Set(['run_command', 'write_file', 'edit_file'])

/** O "alvo" mostrado ao lado do verbo: caminho, consulta, destinatário… */
function toolTarget(args: Record<string, unknown>): string {
  return String(args.path ?? args.query ?? args.to ?? args.course ?? args.title ?? args.extension ?? args.repo ?? args.summary ?? '')
}

const RISK_TONE: Record<string, string> = {
  destrutivo: 'text-red-300 border-red-400/30 bg-red-500/[0.06]',
  externo: 'text-amber-200 border-amber-400/30 bg-amber-500/[0.06]',
  comando: 'text-amber-200 border-amber-400/25 bg-amber-500/[0.05]',
  escrita: 'text-amber-200 border-amber-400/20 bg-amber-500/[0.04]',
}

export function buildTranscript(events: RunEvent[], run: Run | null, agentName: (id: string) => string): Item[] {
  const items: Item[] = []
  if (run) items.push({ kind: 'request', id: 'req', text: run.request })
  const openCmd = new Map<string, Extract<Item, { kind: 'command' }>>()
  const openTool = new Map<string, Extract<Item, { kind: 'tool' }>>()
  const approvals = new Map<string, Extract<Item, { kind: 'approval' }>>()
  let planGate: Extract<Item, { kind: 'planGate' }> | undefined
  for (const e of events) {
    const agent = e.agentId ? agentName(e.agentId) : undefined
    const d = (e.data || {}) as Record<string, unknown>
    switch (e.type) {
      case 'plan': items.push({ kind: 'plan', id: `e${e.id}`, text: e.message, at: e.at }); break
      case 'task_started': items.push({ kind: 'task', id: `e${e.id}`, text: e.message, agent, at: e.at }); break
      case 'task_done': items.push({ kind: 'task', id: `e${e.id}`, text: e.message, agent, at: e.at, done: true }); break
      case 'task_failed': items.push({ kind: 'task', id: `e${e.id}`, text: e.message, agent, at: e.at, failed: true }); break
      case 'agent_thought': items.push({ kind: 'thought', id: `e${e.id}`, text: e.message, agent, at: e.at }); break
      case 'command': {
        const it = { kind: 'command' as const, id: `e${e.id}`, command: String(d.command || e.message.replace(/^\$\s*/, '')), agent, at: e.at, done: false }
        openCmd.set(`${e.agentId}|${it.command}`, it)
        items.push(it)
        break
      }
      case 'command_output': {
        const it = openCmd.get(`${e.agentId}|${String(d.command || '')}`)
        if (it) it.output = ((it.output || '') + String(d.chunk || '')).slice(-12_000)
        break
      }
      case 'command_result': {
        const key = `${e.agentId}|${String(d.command || '')}`
        const it = openCmd.get(key)
        if (it) { it.done = true; it.output = String(d.output || ''); it.exitCode = d.exitCode as number | null; it.durationMs = d.durationMs as number; openCmd.delete(key) }
        break
      }
      case 'tool_start': {
        const tool = String(d.tool || '')
        if (SHOWN_ELSEWHERE.has(tool)) break // aparece como comando / alteração de arquivo
        const args = (d.args || {}) as Record<string, unknown>
        const it = {
          kind: 'tool' as const, id: `e${e.id}`, tool, target: toolTarget(args), agent, at: e.at,
          status: 'executando' as ToolCallStatus, args, risk: d.risk ? String(d.risk) : undefined,
        }
        openTool.set(`${e.agentId}|${tool}`, it)
        items.push(it)
        break
      }
      case 'tool': {
        const tool = String(d.tool || '')
        if (SHOWN_ELSEWHERE.has(tool)) break // shown as command / file change
        const args = (d.args || {}) as Record<string, unknown>
        const key = `${e.agentId}|${tool}`
        const open = openTool.get(key)
        if (open) {
          open.status = 'concluido'
          open.durationMs = typeof d.durationMs === 'number' ? d.durationMs : undefined
          openTool.delete(key)
          break
        }
        // Execuções antigas (gravadas antes do tool_start) só têm o evento final.
        items.push({ kind: 'tool', id: `e${e.id}`, tool, target: toolTarget(args), agent, at: e.at, status: 'concluido', args })
        break
      }
      case 'tool_error': {
        const m = /→ ([\w_]+): (.*)$/.exec(e.message)
        const tool = String(d.tool || m?.[1] || 'ferramenta')
        const error = String(d.error || m?.[2] || e.message)
        const open = openTool.get(`${e.agentId}|${tool}`)
        if (open) {
          open.status = 'falhou'
          open.error = error
          open.durationMs = typeof d.durationMs === 'number' ? d.durationMs : undefined
          openTool.delete(`${e.agentId}|${tool}`)
          break
        }
        items.push({ kind: 'tool', id: `e${e.id}`, tool, target: '', agent, at: e.at, error, status: 'falhou' })
        break
      }
      case 'tool_blocked': {
        const tool = String(d.tool || 'ferramenta')
        items.push({ kind: 'tool', id: `e${e.id}`, tool, target: '', agent, at: e.at, status: 'cancelado', error: e.message })
        break
      }
      case 'approval_request': {
        const it = {
          kind: 'approval' as const, id: `e${e.id}`, approvalId: String(d.approvalId || ''),
          tool: String(d.tool || ''), summary: String(d.summary || e.message), risk: String(d.risk || ''),
          agent, at: e.at, status: 'pending' as const,
        }
        approvals.set(it.approvalId, it)
        items.push(it)
        break
      }
      case 'approval_decision': {
        const it = approvals.get(String(d.approvalId || ''))
        if (it) it.status = d.approved ? 'approved' : 'denied'
        break
      }
      case 'plan_pending': {
        const steps = Array.isArray(d.steps) ? (d.steps as Array<{ id?: unknown; title?: unknown }>) : []
        planGate = {
          kind: 'planGate', id: `e${e.id}`, at: e.at,
          summary: typeof d.summary === 'string' ? d.summary : undefined,
          steps: steps.map((s, i) => ({ id: String(s.id ?? i), title: String(s.title ?? '') })),
          status: 'pending',
        }
        items.push(planGate)
        break
      }
      case 'plan_approved': if (planGate) planGate.status = 'approved'; break
      case 'plan_rejected': if (planGate) planGate.status = 'rejected'; break
      case 'file_change': {
        const m = /(criou|alterou) (.+) \(\+(\d+)\/-(\d+)\)/.exec(e.message)
        items.push({ kind: 'file', id: `e${e.id}`, text: e.message, path: m?.[2] || '', created: m?.[1] === 'criou', added: Number(m?.[3] || 0), removed: Number(m?.[4] || 0), agent, at: e.at })
        break
      }
      case 'message': items.push({ kind: 'message', id: `e${e.id}`, text: e.message, at: e.at }); break
      case 'llm_call': items.push({ kind: 'llm', id: `e${e.id}`, text: e.message, at: e.at }); break
      case 'agent_step': case 'agent_status': case 'agent_model': case 'run_status': case 'report': break
      default:
        if (e.level !== 'info' || ['fix_round', 'model_switched', 'scope_request', 'run_cancel', 'agent_added'].includes(e.type)) items.push({ kind: 'notice', id: `e${e.id}`, text: e.message, level: e.level, at: e.at })
    }
  }
  return items
}

export const time = (at: number) => new Date(at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

function Who({ agent }: { agent?: string }) {
  return agent ? <span className="text-violet-200/70 font-medium mr-1.5">{agent}</span> : null
}

export function TranscriptRow({ it, actions }: { it: Item; actions?: TranscriptActions }) {
  const anim = { initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.15 } }
  switch (it.kind) {
    case 'approval':
      return <ApprovalRow it={it} actions={actions} />
    case 'planGate':
      return <PlanGateRow it={it} actions={actions} />
    case 'request':
      return <motion.div {...anim} className="ml-auto max-w-[85%] p-3 rounded-2xl rounded-br-md bg-cyan-500/10 border border-cyan-500/20 text-sm text-white/90 whitespace-pre-wrap">{it.text}</motion.div>
    case 'plan':
      return <motion.div {...anim} className="text-xs text-cyan-100/80 px-1 pt-2">🗺️ {it.text}</motion.div>
    case 'task':
      return (
        <motion.div {...anim} className={`flex items-center gap-2 text-xs px-1 pt-2 ${it.failed ? 'text-red-300' : it.done ? 'text-green-300/80' : 'text-white/75'}`}>
          {it.done ? <CheckCircle2 size={13} /> : it.failed ? <XCircle size={13} /> : <ChevronRight size={13} className="text-cyan-300" />}
          <span>{it.text}</span><span className="ml-auto text-[10px] text-white/25">{time(it.at)}</span>
        </motion.div>
      )
    case 'thought':
      return <motion.div {...anim} className="text-[12px] text-white/50 italic pl-5 border-l border-violet-400/20 ml-1.5"><Who agent={it.agent} />{it.text}</motion.div>
    case 'tool':
      return <ToolRow it={it} />
    case 'file':
      return (
        <motion.div {...anim} className="flex items-center gap-2 text-xs pl-2 text-white/70">
          <span>{it.created ? '🆕' : '✏️'}</span>
          <span><Who agent={it.agent} />{it.created ? 'Criou' : 'Alterou'} <span className="font-mono text-cyan-200/90">{it.path}</span></span>
          <span className="font-mono text-[10px] text-green-300">+{it.added}</span><span className="font-mono text-[10px] text-red-300">-{it.removed}</span>
        </motion.div>
      )
    case 'command':
      return <CommandBlock it={it} />
    case 'message':
      return <motion.div {...anim} className="text-xs text-white/60 pl-2">💬 {it.text}</motion.div>
    case 'llm':
      return <div className="text-[10px] font-mono text-white/25 pl-2">⚡ {it.text}</div>
    case 'notice':
      return <motion.div {...anim} className={`text-xs pl-2 ${it.level === 'error' ? 'text-red-300' : it.level === 'warn' ? 'text-amber-200/80' : 'text-white/45'}`}>{it.level === 'info' ? 'ℹ️' : '⚠️'} {it.text}</motion.div>
  }
}

const STATUS_ICON: Record<ToolCallStatus, React.ReactNode> = {
  aguardando: <ChevronRight size={12} className="text-white/30" />,
  executando: <Loader2 size={12} className="animate-spin text-cyan-300" />,
  concluido: <CheckCircle2 size={12} className="text-green-400/80" />,
  falhou: <XCircle size={12} className="text-red-300" />,
  cancelado: <Ban size={12} className="text-white/35" />,
  aprovacao: <ShieldAlert size={12} className="text-amber-300" />,
}

const STATUS_TEXT: Record<ToolCallStatus, string> = {
  aguardando: 'aguardando', executando: 'executando', concluido: 'concluído',
  falhou: 'falhou', cancelado: 'cancelado', aprovacao: 'aguardando aprovação',
}

/** Linha de uma chamada de ferramenta: clique abre os parâmetros e o resultado. */
function ToolRow({ it }: { it: Extract<Item, { kind: 'tool' }> }) {
  const [open, setOpen] = useState(false)
  const [, verb] = TOOL_LABEL[it.tool] || ['🔧', it.tool]
  const args = Object.entries(it.args || {}).filter(([k]) => k !== 'content')
  const expandable = args.length > 0 || !!it.error
  const tone = it.status === 'falhou' ? 'text-red-300/90' : it.status === 'cancelado' ? 'text-white/40' : 'text-white/65'

  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.15 }} className="pl-2">
      <button
        onClick={() => expandable && setOpen(o => !o)}
        className={`w-full flex items-baseline gap-2 text-xs text-left ${tone} ${expandable ? 'hover:text-white/85' : 'cursor-default'}`}
      >
        <span className="translate-y-[2px]">{STATUS_ICON[it.status]}</span>
        <span className="min-w-0 flex-1">
          <Who agent={it.agent} />{verb}{' '}
          <span className="font-mono text-cyan-200/80 break-all">{it.target}</span>
          {it.error && <span className="text-red-300/90"> — {it.error}</span>}
        </span>
        {it.durationMs !== undefined && <span className="text-[10px] font-mono text-white/25 flex-shrink-0">{(it.durationMs / 1000).toFixed(1)}s</span>}
        {it.status !== 'concluido' && <span className="text-[10px] text-white/30 flex-shrink-0">{STATUS_TEXT[it.status]}</span>}
        {expandable && (open ? <ChevronDown size={11} className="text-white/25 flex-shrink-0" /> : <ChevronRight size={11} className="text-white/25 flex-shrink-0" />)}
      </button>
      {open && (
        <div className="mt-1 ml-5 rounded-lg border border-white/[0.07] bg-black/40 px-2.5 py-1.5 space-y-0.5">
          <div className="text-[9px] uppercase tracking-wider text-white/25">{it.tool}{it.risk ? ` · ${it.risk}` : ''}</div>
          {args.map(([k, v]) => (
            <div key={k} className="text-[11px] font-mono text-white/55 break-all">
              <span className="text-white/30">{k}:</span> {typeof v === 'string' ? v : JSON.stringify(v)}
            </div>
          ))}
          {it.error && <div className="text-[11px] text-red-300/90">{it.error}</div>}
        </div>
      )}
    </motion.div>
  )
}

/** Aprovação de uma ação, decidida aqui na conversa (nunca em outra tela). */
function ApprovalRow({ it, actions }: { it: Extract<Item, { kind: 'approval' }>; actions?: TranscriptActions }) {
  const tone = RISK_TONE[it.risk] || 'text-amber-200 border-amber-400/25 bg-amber-500/[0.05]'
  const decided = it.status !== 'pending'
  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className={`rounded-xl border px-3 py-2 ${decided ? 'border-white/[0.08] bg-white/[0.02]' : tone}`}>
      <div className="flex items-start gap-2">
        <ShieldAlert size={13} className={`mt-0.5 flex-shrink-0 ${decided ? 'text-white/30' : ''}`} />
        <div className="min-w-0 flex-1">
          <div className="text-[9px] uppercase tracking-wider opacity-60">
            {decided ? (it.status === 'approved' ? 'Você aprovou' : 'Você negou') : `Precisa da sua aprovação · ${it.risk}`}
          </div>
          <div className={`text-[12px] font-mono break-all ${decided ? 'text-white/45' : ''}`}>{it.summary}</div>
          {it.agent && <div className="text-[10px] opacity-50 mt-0.5">pedido por {it.agent}</div>}
        </div>
      </div>
      {!decided && (
        <div className="flex gap-2 mt-2 pl-5">
          <button
            disabled={actions?.deciding}
            onClick={() => actions?.onApproval?.(it.approvalId, true)}
            className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-white text-black hover:bg-white/90 disabled:opacity-40 transition-colors"
          >
            Aprovar
          </button>
          <button
            disabled={actions?.deciding}
            onClick={() => actions?.onApproval?.(it.approvalId, false)}
            className="px-2.5 py-1 rounded-lg text-[11px] border border-white/15 text-white/70 hover:bg-white/5 disabled:opacity-40 transition-colors"
          >
            Negar
          </button>
        </div>
      )}
    </motion.div>
  )
}

/** Plan Mode: o plano aparece no chat e só executa depois do "aprovar". */
function PlanGateRow({ it, actions }: { it: Extract<Item, { kind: 'planGate' }>; actions?: TranscriptActions }) {
  const pending = it.status === 'pending'
  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className={`rounded-xl border px-3 py-2.5 ${pending ? 'border-cyan-400/25 bg-cyan-500/[0.05]' : 'border-white/[0.08] bg-white/[0.02]'}`}>
      <div className="text-[9px] uppercase tracking-wider text-white/40 mb-1.5">
        {pending ? 'Plano — nada foi alterado ainda' : it.status === 'approved' ? 'Plano aprovado' : 'Plano recusado'}
      </div>
      {it.summary && <div className="text-[12px] text-white/70 mb-1.5">{it.summary}</div>}
      <ol className="space-y-0.5">
        {it.steps.map((s, i) => (
          <li key={s.id} className="text-[12px] text-white/60 flex gap-2">
            <span className="text-white/25 font-mono flex-shrink-0">{i + 1}.</span>
            <span>{s.title}</span>
          </li>
        ))}
      </ol>
      {pending && (
        <div className="flex gap-2 mt-2.5">
          <button
            disabled={actions?.deciding}
            onClick={() => actions?.onPlan?.(true)}
            className="px-3 py-1 rounded-lg text-[11px] font-medium bg-white text-black hover:bg-white/90 disabled:opacity-40 transition-colors"
          >
            Aprovar e executar
          </button>
          <button
            disabled={actions?.deciding}
            onClick={() => actions?.onPlan?.(false)}
            className="px-3 py-1 rounded-lg text-[11px] border border-white/15 text-white/70 hover:bg-white/5 disabled:opacity-40 transition-colors"
          >
            Recusar
          </button>
        </div>
      )}
    </motion.div>
  )
}

export function CommandBlock({ it }: { it: Extract<Item, { kind: 'command' }> }) {
  const [open, setOpen] = useState(true)
  const failed = it.done && it.exitCode !== 0
  const lines = (it.output || '').trimEnd().split('\n')
  const shown = open ? lines.slice(-40) : []
  return (
    <motion.div initial={false} animate={{ opacity: 1, y: 0 }} className={`rounded-xl border overflow-hidden ${failed ? 'border-red-400/25' : 'border-white/[0.08]'} bg-black/60`}>
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-2 px-3 py-1.5 text-left bg-white/[0.03]">
        <Terminal size={12} className="text-cyan-300/80" />
        <span className="font-mono text-[12px] text-cyan-100 flex-1 truncate"><span className="text-green-300/80">$</span> {it.command}</span>
        {!it.done ? <Loader2 size={12} className="animate-spin text-cyan-300" />
          : <span className={`text-[10px] font-mono ${failed ? 'text-red-300' : 'text-green-300/80'}`}>{it.exitCode === null ? 'tempo esgotado' : `saída ${it.exitCode}`}{it.durationMs ? ` · ${(it.durationMs / 1000).toFixed(1)}s` : ''}</span>}
        {it.agent && <span className="text-[10px] text-violet-200/50">{it.agent}</span>}
      </button>
      {open && it.done && (
        <pre className="px-3 py-2 text-[11px] leading-relaxed font-mono text-white/70 whitespace-pre-wrap break-words max-h-72 overflow-y-auto">
          {lines.length > 40 && <span className="text-white/30">… ({lines.length - 40} linhas anteriores)\n</span>}
          {shown.join('\n') || <span className="text-white/30">(sem saída)</span>}
        </pre>
      )}
      {open && !it.done && (
        <pre className="px-3 py-2 text-[11px] leading-relaxed font-mono text-white/60 whitespace-pre-wrap break-words max-h-72 overflow-y-auto">
          {shown.join('\n') || 'executando…'}<span className="inline-block w-1.5 h-3 bg-cyan-300/70 ml-0.5 animate-pulse align-middle" />
        </pre>
      )}
    </motion.div>
  )
}
