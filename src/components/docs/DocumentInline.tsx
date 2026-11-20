'use client'

import { useEffect, useState } from 'react'
import { FileArchive, FileCode2, FileSpreadsheet, FileText, FileDown, File } from 'lucide-react'

interface Meta {
  file: string
  title: string
  kind: 'xlsx' | 'pdf' | 'md' | 'csv' | 'docx' | 'yml' | 'unl' | 'gns3' | 'zip'
  size: number
  at: number
}

const ICON = {
  xlsx: FileSpreadsheet,
  pdf: FileText,
  md: FileText,
  csv: FileSpreadsheet,
  docx: FileText,
  yml: FileCode2,
  unl: FileCode2,
  gns3: FileCode2,
  zip: FileArchive,
} as const

const ACCENT = {
  docx: 'text-blue-200 border-blue-400/25 bg-blue-500/[0.07]',
  yml: 'text-amber-200 border-amber-400/25 bg-amber-500/[0.07]',
  unl: 'text-orange-200 border-orange-400/25 bg-orange-500/[0.07]',
  gns3: 'text-teal-200 border-teal-400/25 bg-teal-500/[0.07]',
  zip: 'text-slate-200 border-slate-400/25 bg-slate-500/[0.07]',
  xlsx: 'text-emerald-300 border-emerald-400/25 bg-emerald-500/[0.07]',
  pdf: 'text-fuchsia-200 border-fuchsia-400/25 bg-fuchsia-500/[0.07]',
  md: 'text-sky-200 border-sky-400/25 bg-sky-500/[0.07]',
  csv: 'text-lime-200 border-lime-400/25 bg-lime-500/[0.07]',
} as const

const fmtKb = (bytes: number) => (bytes >= 1_000_000 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)

/** Inline card for a generated document: icon, title, size and a one-click download. */
export default function DocumentInline({ file }: { file: string }) {
  const [meta, setMeta] = useState<Meta | null>(null)

  useEffect(() => {
    let stopped = false
    fetch(`/api/documents?action=info&file=${encodeURIComponent(file)}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => { if (!stopped) setMeta(d.document || null) })
      .catch(() => {})
    return () => { stopped = true }
  }, [file])

  const ext = file.split('.').pop()?.toLowerCase() || ''
  const kind = meta?.kind || ((ext in ICON ? ext : 'pdf') as Meta['kind'])
  const Icon = ICON[kind] || File
  const accent = ACCENT[kind] || ACCENT.pdf

  return (
    <div className={`my-2 flex items-center gap-3 rounded-2xl border p-3.5 ${accent}`}>
      <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-white/10 bg-black/30">
        <Icon size={20} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-semibold text-white/90">{meta?.title || file.replace(/\.[^.]+$/, '').replace(/-[0-9a-f]{8}$/, '').replace(/-/g, ' ')}</div>
        <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wide text-white/35">{meta ? `${meta.kind.toUpperCase()} · ${fmtKb(meta.size)}` : kind.toUpperCase()}</div>
      </div>
      <a
        href={`/api/documents?file=${encodeURIComponent(file)}`}
        download
        className="flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-cyan-500/25 bg-cyan-500/15 px-3 py-2 text-[11px] font-medium text-cyan-100 transition-colors hover:bg-cyan-500/25"
      >
        <FileDown size={13} /> Baixar
      </a>
    </div>
  )
}
