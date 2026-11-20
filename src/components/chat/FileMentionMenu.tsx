'use client'

import { useEffect, useState } from 'react'
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

  if (query === null || !hits.length) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.12 }}
      className="absolute bottom-full left-0 right-0 mb-2 max-h-64 overflow-y-auto rounded-xl border border-white/10 bg-[#0a0f1a] shadow-2xl z-30"
      role="listbox"
      aria-label="Arquivos do projeto"
    >
      {hits.map(h => (
        <button
          key={h.path}
          role="option"
          aria-selected={false}
          onClick={() => onPick(h.path, active!.start, query)}
          className="w-full flex items-baseline gap-2 px-3 py-1.5 text-left hover:bg-white/[0.06] transition-colors"
        >
          <FileCode2 size={11} className="text-white/35 flex-shrink-0 translate-y-0.5" />
          <span className="font-mono text-[12px] text-white/85 flex-shrink-0">{h.name}</span>
          <span className="font-mono text-[10px] text-white/30 truncate">{h.path}</span>
        </button>
      ))}
      <div className="px-3 py-1 text-[10px] text-white/25 border-t border-white/5">
        O conteúdo do arquivo vai junto com a mensagem
      </div>
    </motion.div>
  )
}
