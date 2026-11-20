'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, Download, Loader2, Trash2 } from 'lucide-react'

export type ImageJobStatus = 'queued' | 'running' | 'done' | 'failed' | 'canceled'

export interface ImageJobData {
  id: string
  prompt: string
  aspect: string
  status: ImageJobStatus
  progress: number
  createdAt: number
  imageId?: string
}

export interface InlineImageInlineProps {
  jobId: string
}

export default function InlineImageInline({ jobId }: InlineImageInlineProps) {
  const [image, setImage] = useState<any>(null)
  const [status, setStatus] = useState<ImageJobStatus>('queued')
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    let stopped = false
    let timerId: number | null = null
    const poll = async () => {
      try {
        const r = await fetch(`/api/media?action=image/job&id=${encodeURIComponent(jobId)}`, {
          cache: 'no-store',
        })
        if (!r.ok) {
          const d = await r.json().catch(() => ({} as { error?: string }))
          throw new Error(d.error || 'Imagem não encontrada')
        }
        const d = (await r.json()) as { status: ImageJobStatus; progress: number; imageId?: string }
        if (!stopped) setStatus(d.status)
        setProgress(d.progress || 0)
        if (d.imageId && !stopped) {
          // Buscar a imagem gerada
          const imgR = await fetch(`/api/media?image=${d.imageId}`, { cache: 'no-store' })
          if (imgR.ok) {
            const img = await imgR.json()
            if (!stopped) setImage(img)
          }
        }
        if (['done', 'failed', 'canceled'].includes(d.status) && !stopped) {
          clearTimeout(timerId!)
        } else if (!stopped) {
          timerId = window.setTimeout(poll, 2000)
        }
      } catch (e) {
        if (!stopped) setStatus('failed')
        console.error('Erro ao acompanhar geração de imagem:', e)
      }
    }
    void poll()
    return () => {
      stopped = true
      if (timerId !== null) clearTimeout(timerId)
    }
  }, [jobId])

  const done = status === 'done'
  const failed = status === 'failed' || status === 'canceled'

  if (failed) {
    return (
      <div className="my-2 flex items-center gap-3 rounded-2xl border border-red-400/25 bg-red-500/[0.06] p-4 text-xs text-red-200">
        <AlertTriangle size={16} className="flex-shrink-0" />
        <div>
          <div className="font-semibold text-red-100">Não foi possível gerar a imagem</div>
          <p className="mt-0.5 text-red-200/80">Tente novamente ou escolha outro estilo</p>
        </div>
      </div>
    )
  }

  if (!image) {
    return (
      <div className="my-2 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-xs text-white/50">
        <Loader2 size={16} className="animate-spin text-cyan-300" /> Gerando imagem…
      </div>
    )
  }

  // Pronto - exibe a imagem
  const src = `/api/media?image=${image.file}`

  return (
    <div className="my-2 rounded-2xl border border-cyan-400/20 bg-black/40 p-4 flex items-center gap-4">
      <img
        className="w-16 h-16 object-cover rounded-lg"
        src={src}
        alt={image?.prompt?.slice(0, 30) + (image?.prompt.length > 30 ? '…' : '')}
        width={256}
        height={256}
      />
      <div className="min-w-0">
        <div className="text-xs font-semibold text-cyan-100">
          {image?.prompt?.slice(0, 30)}{image?.prompt.length > 30 ? '…' : ''}
        </div>
        <div className="text-[10px] text-white/50">Por {image?.provider}</div>
      </div>
      <div className="mt-2 flex text-xs text-white/50">
        <span>{progress}%</span>
      </div>
    </div>
  )
}