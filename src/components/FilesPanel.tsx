'use client'

import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, FileText, Folder, RefreshCw, Save } from 'lucide-react'
import { toast } from 'sonner'

interface Entry {
  name: string
  dir: boolean
  size: number
  rel: string
}

const formatSize = (size: number) => {
  if (!size) return ''
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} kB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

export default function FilesPanel() {
  const [path, setPath] = useState('.')
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState<{ file: string; content: string } | null>(null)

  const load = useCallback(async (nextPath: string) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/fs?path=${encodeURIComponent(nextPath)}`)
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setEntries(data.entries || [])
      setPath(data.path || '.')
      setOpen(null)
    } catch (error) {
      toast.error(`Arquivos: ${(error as Error).message}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load('.')
  }, [load])

  async function openFile(rel: string) {
    try {
      const res = await fetch(`/api/fs?file=${encodeURIComponent(rel)}`)
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setOpen({ file: data.file, content: data.content })
    } catch (error) {
      toast.error((error as Error).message)
    }
  }

  async function save() {
    if (!open) return
    const res = await fetch('/api/fs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: open.file, content: open.content }),
    })
    const data = await res.json()
    if (data.error) toast.error(data.error)
    else toast.success('Arquivo salvo')
  }

  function up() {
    const parts = path.split('/').filter(Boolean)
    parts.pop()
    load(parts.length ? parts.join('/') : '.')
  }

  if (open) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden p-3 gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-mono text-white/40 truncate">{open.file}</span>
          <div className="flex gap-1">
            <button onClick={save} className="p-1 rounded hover:bg-white/5" title="Salvar">
              <Save size={11} className="text-cyan-400/70" />
            </button>
            <button onClick={() => setOpen(null)} className="p-1 rounded hover:bg-white/5" title="Fechar">
              <ChevronLeft size={11} className="text-white/40" />
            </button>
          </div>
        </div>
        <textarea
          value={open.content}
          onChange={e => setOpen({ ...open, content: e.target.value })}
          spellCheck={false}
          className="flex-1 min-h-0 resize-none rounded-lg border border-white/5 bg-black/50 p-2 font-mono text-[11px] leading-relaxed text-white/70 outline-none focus:border-cyan-500/30"
        />
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
        <span className="text-[10px] font-mono text-white/40 truncate">{path}</span>
        <div className="flex gap-1">
          {path !== '.' && (
            <button onClick={up} className="p-1 rounded hover:bg-white/5" title="Voltar">
              <ChevronLeft size={11} className="text-white/40" />
            </button>
          )}
          <button onClick={() => load(path)} className="p-1 rounded hover:bg-white/5" title="Atualizar">
            <RefreshCw size={11} className={`text-white/40 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {entries.map(entry => (
          <button
            key={entry.rel}
            onClick={() => (entry.dir ? load(entry.rel) : openFile(entry.rel))}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-white/60 hover:bg-white/5 hover:text-white/90 transition-colors text-left"
          >
            {entry.dir ? (
              <Folder size={12} className="text-cyan-400/60 flex-shrink-0" />
            ) : (
              <FileText size={12} className="text-white/25 flex-shrink-0" />
            )}
            <span className="flex-1 truncate">{entry.name}</span>
            <span className="text-[9px] text-white/20">{formatSize(entry.size)}</span>
          </button>
        ))}
        {!entries.length && !loading && (
          <p className="text-center py-12 text-white/20 text-xs">Pasta vazia</p>
        )}
      </div>
    </div>
  )
}
