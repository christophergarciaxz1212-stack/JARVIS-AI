// Shared transcript builder + row renderers for agent runs.
// Used by LiveTimeline (full workspace) and RunInlineCard (inline in the chat).
import { motion } from 'framer-motion'
import { useState } from 'react'
import { CheckCircle2, ChevronRight, Loader2, Terminal, XCircle } from 'lucide-react'
import type { Run, RunEvent } from '@/lib/agents/types'

export type Item =
  | { kind: 'request'; id: string; text: string }
  | { kind: 'plan'; id: string; text: string; at: number }
  | { kind: 'task'; id: string; text: string; agent?: string; at: number; done?: boolean; failed?: boolean }
  | { kind: 'thought'; id: string; text: string; agent?: string; at: number }
  | { kind: 'tool'; id: string; tool: string; target: string; agent?: string; at: number; error?: string }
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
  finish: ['✅', 'Finalizou'],
}

export function buildTranscript(events: RunEvent[], run: Run | null, agentName: (id: string) => string): Item[] {
  const items: Item[] = []
  if (run) items.push({ kind: 'request', id: 'req', text: run.request })
  const openCmd = new Map<string, Extract<Item, { kind: 'command' }>>()
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
      case 'tool': {
        const tool = String(d.tool || '')
        if (tool === 'run_command' || tool === 'write_file' || tool === 'edit_file') break // shown as command / file change
        const args = (d.args || {}) as Record<string, unknown>
        const target = String(args.path ?? args.query ?? args.to ?? args.course ?? args.title ?? args.extension ?? args.repo ?? args.summary ?? '')
        items.push({ kind: 'tool', id: `e${e.id}`, tool, target, agent, at: e.at })
        break
      }
      case 'tool_error': {
        const m = /→ (\w+): (.*)$/.exec(e.message)
        items.push({ kind: 'tool', id: `e${e.id}`, tool: m?.[1] || 'ferramenta', target: '', agent, at: e.at, error: m?.[2] || e.message })
        break
      }
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

export function TranscriptRow({ it }: { it: Item }) {
  const anim = { initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.15 } }
  switch (it.kind) {
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
    case 'tool': {
      const [icon, verb] = TOOL_LABEL[it.tool] || ['🔧', it.tool]
      return (
        <motion.div {...anim} className={`flex items-baseline gap-2 text-xs pl-2 ${it.error ? 'text-red-300/90' : 'text-white/65'}`}>
          <span>{icon}</span>
          <span><Who agent={it.agent} />{verb} <span className="font-mono text-cyan-200/80">{it.target}</span>{it.error && <> — {it.error}</>}</span>
        </motion.div>
      )
    }
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
