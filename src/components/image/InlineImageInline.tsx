'use client'

import { useEffect, useState } from 'react'
import { Download, Loader2, AlertTriangle, Image as ImageIcon } from 'lucide-react'

/**
 * Cartão inline de uma imagem gerada, referenciada por ID via marcador [[imagem:<uuid>]].
 */
export default function InlineImageInline({ jobId }: { jobId: string }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const url = `/api/media?image=${encodeURIComponent(jobId)}`

  useEffect(() => {
    // Verify the image exists
    fetch(url, { method: 'HEAD' })
      .then(r => { if (!r.ok) throw new Error('Imagem não encontrada'); setLoading(false) })
      .catch(e => { setError((e as Error).message || 'Erro'); setLoading(false) })
  }, [url])

  if (error) {
    return (
      <div className="my-2 flex items-center gap-3 rounded-2xl border border-red-400/25 bg-red-500/[0.06] p-4 text-xs text-red-200">
        <AlertTriangle size={16} className="flex-shrink-0" />
        <div>
          <div className="font-semibold text-red-100">Imagem não encontrada</div>
          <p className="mt-0.5 text-red-200/80">{error}</p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="my-2 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-xs text-white/50">
        <Loader2 size={16} className="animate-spin text-cyan-300" /> Carregando imagem…
      </div>
    )
  }

  return (
    <div className="my-2 overflow-hidden rounded-2xl border border-cyan-400/20 bg-black/40">
      <div className="flex items-center gap-2 border-b border-white/5 px-4 py-2 text-[11px] text-cyan-200/80">
        <ImageIcon size={13} /> Imagem gerada
      </div>
      <div className="bg-black p-2 flex justify-center">
        <img
          src={url}
          alt="Imagem gerada"
          className="max-h-[400px] max-w-full rounded-xl object-contain"
          loading="lazy"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <a href={url} download className="flex items-center gap-1.5 rounded-lg bg-cyan-500/15 px-3 py-2 text-[11px] font-medium text-cyan-100 transition-colors hover:bg-cyan-500/25 border border-cyan-500/25">
          <Download size={13} /> Baixar
        </a>
      </div>
    </div>
  )
}