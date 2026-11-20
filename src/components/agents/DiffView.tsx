'use client'

import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Check, ChevronDown, ChevronRight, FileCode2, FilePlus2, FileX2, Loader2, Undo2 } from 'lucide-react'
import type { FileDiff } from '@/lib/agents/diff'
import { api, get } from './api'

/**
 * Alterações da execução, arquivo por arquivo: o que entrou, o que saiu, e a
 * decisão de manter ou desfazer — sem precisar abrir o arquivo em outro lugar.
 */
export default function DiffView({ runId, onChanged }: { runId: string; onChanged?: () => void }) {
  const [files, setFiles] = useState<FileDiff[] | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const d = await get<{ files: FileDiff[] }>(`/api/agents/runs?id=${runId}&changes=1`)
      setFiles(d.files)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [runId])

  useEffect(() => { void load() }, [load])

  const decide = async (file: string, accept: boolean) => {
    setBusy(file)
    setError('')
    try {
      await api.runAction(runId, accept ? 'accept-file' : 'revert-file', { file })
      await load()
      onChanged?.()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy('')
    }
  }

  if (error) return <div className="text-[11px] text-red-300 px-2 py-1.5">{error}</div>
  if (!files) return <div className="flex items-center gap-2 text-[11px] text-white/35 px-2 py-2"><Loader2 size={11} className="animate-spin" /> lendo as alterações…</div>
  if (!files.length) return <div className="text-[11px] text-white/30 px-2 py-2">Nenhuma alteração pendente nesta execução.</div>

  return (
    <div className="space-y-1.5">
      {files.map(f => (
        <FileBlock key={f.path} file={f} busy={busy === f.path} onDecide={accept => decide(f.path, accept)} />
      ))}
    </div>
  )
}

function FileBlock({ file, busy, onDecide }: { file: FileDiff; busy: boolean; onDecide: (accept: boolean) => void }) {
  const [open, setOpen] = useState(file.hunks.length > 0 && file.added + file.removed <= 60)
  const Icon = file.created ? FilePlus2 : file.deleted ? FileX2 : FileCode2
  const label = file.created ? 'criado' : file.deleted ? 'apagado' : 'alterado'

  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-white/[0.08] bg-black/40 overflow-hidden">
      <div className="flex items-center gap-2 px-2.5 py-1.5 bg-white/[0.03]">
        <button onClick={() => setOpen(o => !o)} className="flex items-center gap-2 min-w-0 flex-1 text-left">
          {open ? <ChevronDown size={12} className="text-white/35 flex-shrink-0" /> : <ChevronRight size={12} className="text-white/35 flex-shrink-0" />}
          <Icon size={12} className="text-white/45 flex-shrink-0" />
          <span className="font-mono text-[12px] text-white/80 truncate">{file.path}</span>
          <span className="text-[10px] text-white/30 flex-shrink-0 hidden sm:inline">{label}</span>
          <span className="font-mono text-[10px] text-green-300/90 flex-shrink-0">+{file.added}</span>
          <span className="font-mono text-[10px] text-red-300/90 flex-shrink-0">−{file.removed}</span>
        </button>
        <button
          disabled={busy}
          onClick={() => onDecide(true)}
          title="Manter esta alteração"
          className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] bg-white text-black hover:bg-white/90 disabled:opacity-40 transition-colors flex-shrink-0"
        >
          {busy ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />} Manter
        </button>
        <button
          disabled={busy}
          onClick={() => onDecide(false)}
          title="Desfazer e voltar ao conteúdo original"
          className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] border border-white/15 text-white/65 hover:bg-white/5 disabled:opacity-40 transition-colors flex-shrink-0"
        >
          <Undo2 size={10} /> Desfazer
        </button>
      </div>

      {open && (
        file.binary
          ? <div className="px-3 py-2 text-[11px] text-white/35">Arquivo binário — não dá para mostrar linha a linha.</div>
          : (
            <div className="overflow-x-auto">
              {file.hunks.map((h, i) => (
                <div key={i}>
                  {i > 0 && <div className="px-3 py-0.5 text-[10px] font-mono text-white/20 bg-white/[0.02]">⋯</div>}
                  {h.lines.map((l, j) => (
                    <div
                      key={j}
                      className={`flex font-mono text-[11px] leading-[1.5] ${
                        l.kind === 'adicionada' ? 'bg-green-500/[0.08] text-green-100/90'
                          : l.kind === 'removida' ? 'bg-red-500/[0.08] text-red-100/80'
                            : 'text-white/45'
                      }`}
                    >
                      <span className="w-10 flex-shrink-0 text-right pr-1.5 text-white/20 select-none">{l.before ?? ''}</span>
                      <span className="w-10 flex-shrink-0 text-right pr-1.5 text-white/20 select-none">{l.after ?? ''}</span>
                      <span className="w-3 flex-shrink-0 select-none opacity-60">{l.kind === 'adicionada' ? '+' : l.kind === 'removida' ? '−' : ' '}</span>
                      <span className="whitespace-pre pr-3">{l.text || ' '}</span>
                    </div>
                  ))}
                </div>
              ))}
              {file.truncated && <div className="px-3 py-1 text-[10px] text-white/30">Diff grande — mostrando o começo.</div>}
            </div>
          )
      )}
    </motion.div>
  )
}
