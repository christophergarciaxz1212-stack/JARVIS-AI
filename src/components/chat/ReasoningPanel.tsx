'use client'

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Brain, ChevronDown } from 'lucide-react'

/**
 * What a reasoning model (qwen3, deepseek-r1, gpt-oss…) thinks before answering. Local models can think
 * for a minute on this GPU: showing it live replaces a silent wait. Open while thinking, folded after.
 */
export default function ReasoningPanel({ text, live }: { text: string; live: boolean }) {
  const [open, setOpen] = useState(live)
  const body = useRef<HTMLDivElement>(null)
  const wasLive = useRef(live)

  useEffect(() => {
    if (wasLive.current && !live) setOpen(false)
    wasLive.current = live
  }, [live])

  useEffect(() => {
    if (live && open && body.current) body.current.scrollTop = body.current.scrollHeight
  }, [text, live, open])

  const words = text.trim().split(/\s+/).filter(Boolean).length
  return (
    <div className={`reasoning-panel mb-2 ${live ? 'fx-beam' : ''}`}>
      <button type="button" onClick={() => setOpen(o => !o)} className="flex w-full items-center gap-2 px-3 py-1.5 text-[11px] text-left">
        <Brain size={12} className={live ? 'text-cyan-300 animate-pulse' : 'text-white/40'} />
        <span className={live ? 'thinking-text font-medium' : 'text-white/45'}>{live ? 'Pensando…' : `Raciocínio (${words} palavras)`}</span>
        <ChevronDown size={12} className={`ml-auto text-white/35 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.2, 0.9, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div ref={body} className="max-h-56 overflow-y-auto px-3 pb-2.5 text-[11.5px] leading-relaxed text-white/45 whitespace-pre-wrap">
              {text}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
