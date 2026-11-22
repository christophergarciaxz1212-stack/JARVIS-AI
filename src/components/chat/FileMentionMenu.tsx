'use client'

import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { FileCode2 } from 'lucide-react'
import { activeFileQuery } from '@/lib/chat/slash'

interface Hit { path: string; name: string }

/**
 * Sugestões de arquivo enquanto o usuário escreve `@` no composer.
 * Os caminhos vêm da pasta do projeto escolhido — não da pasta do JARVIS.
 */
export default function FileMentionMenu({ input, caret, projectId, onPick }: {
  input: string
  caret: number
  projectId: string
  onPick: (path: string, start: number, query: string) => void
}) {
  const active = activeFileQuery(input, caret)
  const query = active?.query ?? null
  const [hits, setHits] = useState<Hit[]>([])
  const [selected, setSelected] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (query === null || !projectId) { setHits([]); return }
    const ctrl = new AbortController()
    // Pequeno atraso: a lista é pedida a cada tecla.
    const t = setTimeout(() => {
      fetch(`/api/projects?files=${encodeURIComponent(projectId)}&q=${encodeURIComponent(query)}`, { signal: ctrl.signal, cache: 'no-store' })
        .then(r => r.json())
        .then(d => setHits(Array.isArray(d.files) ? d.files : []))
        .catch(() => { /* abortado ou offline: some a lista */ })
    }, 120)
    return () => { clearTimeout(t); ctrl.abort() }
  }, [query, projectId])

  // Navegação por teclado: setas movem, Enter confirma, Esc fecha (o foco fica no textarea).
  useEffect(() => { setSelected(0) }, [query])
  useEffect(() => { listRef.current?.querySelector<HTMLElement>(`[data-index="${selected}"]`)?.scrollIntoView({ block: 'nearest' }) }, [selected])
  useEffect(() => {
    if (query === null || !hits.length) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(i => (i + 1) % hits.length) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(i => (i - 1 + hits.length) % hits.length) }
      else if (e.key === 'Enter') {
        const hit = hits[selected]
        if (hit) { e.preventDefault(); e.stopPropagation(); onPick(hit.path, active!.start, query) }
      } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setHits([]) }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [query, hits, selected, onPick, active])

  if (query === null || !hits.length) return null

  return (
    <motion.div
      ref={listRef}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.12 }}
      className="absolute bottom-full left-0 right-0 mb-2 max-h-64 overflow-y-auto rounded-xl border border-white/10 bg-[#0a0f1a] shadow-2xl z-30"
      role="listbox"
      aria-label="Arquivos do projeto"
    >
      {hits.map((h, i) => (
        <button
          key={h.path}
          type="button"
          data-index={i}
          role="option"
          aria-selected={i === selected}
          onClick={() => onPick(h.path, active!.start, query)}
          className={`w-full flex items-baseline gap-2 px-3 py-1.5 text-left transition-colors ${i === selected ? 'bg-white/[0.09]' : 'hover:bg-white/[0.06]'}`}
        >
          <FileCode2 size={11} className="text-white/35 flex-shrink-0 translate-y-0.5" />
          <span className="font-mono text-[12px] text-white/85 flex-shrink-0">{h.name}</span>
          <span className="font-mono text-[10px] text-white/30 truncate">{h.path}</span>
        </button>
      ))}
      <div className="px-3 py-1 text-[10px] text-white/25 border-t border-white/5">
        ↑↓ navegar · Enter inserir · Esc fechar — o conteúdo vai junto com a mensagem
      </div>
    </motion.div>
  )
}
