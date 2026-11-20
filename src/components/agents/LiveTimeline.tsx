'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, Loader2 } from 'lucide-react'
import Markdown from '@/components/chat/Markdown'
import type { Run, RunEvent } from '@/lib/agents/types'
import { buildTranscript, TranscriptRow } from './transcript'

/** opencode-style transcript: what each agent thinks, reads, runs (with the shell output) and changes, live. */
export default function LiveTimeline({ events, run, agentName, active }: { events: RunEvent[]; run: Run | null; agentName: (id: string) => string; active: boolean }) {
  const [details, setDetails] = useState(false)
  const [follow, setFollow] = useState(true)
  const box = useRef<HTMLDivElement>(null)
  const items = useMemo(() => buildTranscript(events, run, agentName).filter(i => details || i.kind !== 'llm'), [events, run, agentName, details])

  useEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight
  }, [items.length, follow, items])

  const onScroll = () => {
    const el = box.current
    if (!el) return
    setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 80)
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-2 mb-2 text-[11px] text-white/40">
        <span className="flex items-center gap-1.5">{active ? <><span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" /> trabalhando ao vivo</> : 'execução encerrada'}</span>
        <div className="flex-1" />
        <label className="flex items-center gap-1 cursor-pointer"><input type="checkbox" checked={details} onChange={e => setDetails(e.target.checked)} /> chamadas de modelo</label>
      </div>
      <div ref={box} onScroll={onScroll} className="max-h-[62vh] overflow-y-auto pr-1 space-y-1.5 font-[450]">
        {items.map(it => <TranscriptRow key={it.id} it={it} />)}
        {active && (
          <div className="flex items-center gap-2 text-xs text-cyan-200/70 py-2 pl-1"><Loader2 size={13} className="animate-spin" /> pensando no próximo passo…</div>
        )}
        {run?.report && !active && (
          <div className="mt-3 p-4 rounded-xl border border-green-400/20 bg-green-500/[0.04]">
            <div className="text-[10px] uppercase tracking-wider text-green-300/70 mb-2">Resultado</div>
            <Markdown className="text-sm">{run.report}</Markdown>
          </div>
        )}
      </div>
      {!follow && (
        <button onClick={() => { setFollow(true); if (box.current) box.current.scrollTop = box.current.scrollHeight }} className="absolute bottom-2 right-3 flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] bg-cyan-500/80 text-black shadow-lg">
          <ArrowDown size={12} /> acompanhar
        </button>
      )}
    </div>
  )
}
