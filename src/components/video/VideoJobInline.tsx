'use client'

import { useEffect, useState } from 'react'
import { Download, Loader2, Square, Clapperboard, AlertTriangle, Clapperboard as StudioIcon, ShieldCheck } from 'lucide-react'
import { VIDEO_FORMATS } from '@/lib/video/formats'
import type { VideoJob } from '@/lib/video/types'

const ACTIVE = new Set(['queued', 'running'])

/**
 * Cartão ao vivo de uma produção do Estúdio embutido na conversa:
 * progresso durante a produção; ao terminar, o MP4 jogável com downloads e QA.
 */
export default function VideoJobInline({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<VideoJob | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const poll = async () => {
      try {
        const r = await fetch(`/api/video?action=job&id=${encodeURIComponent(jobId)}`, { cache: 'no-store' })
        if (!r.ok) {
          const d = await r.json().catch(() => ({} as { error?: string }))
          throw new Error(d.error || 'Vídeo não encontrado')
        }
        const d = (await r.json()) as { job: VideoJob }
        if (!stopped) setJob(d.job)
        if (!stopped && ACTIVE.has(d.job.status)) timer = setTimeout(poll, 2000)
      } catch (e) {
        if (!stopped) setError((e as Error).message || 'Não foi possível acompanhar a produção')
      }
    }
    void poll()
    return () => { stopped = true; if (timer) clearTimeout(timer) }
  }, [jobId])

  const playing = !!job && ACTIVE.has(job.status)
  const done = job?.status === 'done'
  const failed = job?.status === 'failed' || job?.status === 'canceled'
  const wide = (VIDEO_FORMATS.find(f => f.id === job?.formatId)?.aspect ?? '16:9') === '16:9'

  if (error) {
    return (
      <div className="my-2 flex items-center gap-3 rounded-2xl border border-red-400/25 bg-red-500/[0.06] p-4 text-xs text-red-200">
        <AlertTriangle size={16} className="flex-shrink-0" />
        <div>
          <div className="font-semibold text-red-100">Não foi possível acompanhar a produção</div>
          <p className="mt-0.5 text-red-200/80">{error}</p>
        </div>
      </div>
    )
  }

  if (!job) {
    return (
      <div className="my-2 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-xs text-white/50">
        <Loader2 size={16} className="animate-spin text-cyan-300" /> Conectando ao Estúdio de Vídeo…
      </div>
    )
  }

  if (failed) {
    return (
      <div className="my-2 rounded-2xl border border-amber-400/25 bg-amber-500/[0.06] p-4 text-xs text-amber-100">
        <div className="flex items-center gap-2 font-semibold text-amber-50"><AlertTriangle size={15} /> A produção falhou</div>
        <p className="mt-1 text-amber-100/85">{job.error || 'Erro desconhecido'}</p>
        <button onClick={() => window.dispatchEvent(new CustomEvent('jarvis:open-motion'))} className="mt-2 flex items-center gap-1.5 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-100 hover:bg-amber-500/20">
          <StudioIcon size={12} /> Ver no Estúdio de Vídeo
        </button>
      </div>
    )
  }

  if (playing) {
    const pct = Math.round((job.progress || 0) * 100)
    return (
      <div className="my-2 rounded-2xl border border-fuchsia-400/20 bg-gradient-to-br from-fuchsia-500/[0.07] to-cyan-500/[0.05] p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-fuchsia-400/30 bg-fuchsia-500/15">
            <Clapperboard size={18} className="text-fuchsia-200" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-xs font-semibold text-fuchsia-100"><Loader2 size={12} className="animate-spin" /> {job.title || 'Produzindo seu vídeo…'}</div>
            <div className="mt-0.5 truncate text-[10px] text-white/45">{job.stage}{job.model ? ` · ${job.model.split('|').pop()}` : ''}</div>
          </div>
          <button
            title="Cancelar produção"
            onClick={() => { fetch('/api/video', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cancel', id: job.id }) }) }}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-white/40 hover:bg-red-500/10 hover:text-red-300"
          >
            <Square size={13} />
          </button>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
          <div className="h-full rounded-full bg-gradient-to-r from-fuchsia-400 to-cyan-400 transition-all duration-700" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-1 text-right font-mono text-[10px] text-white/35">{pct}% · diretor de IA</div>
      </div>
    )
  }

  // Pronto
  const mb = job.sizeBytes ? (job.sizeBytes / 1e6).toFixed(1) : null
  const src = `/api/video?action=file&id=${encodeURIComponent(job.id)}&name=video.mp4`
  const poster = job.previews?.length ? `/api/video?action=file&id=${encodeURIComponent(job.id)}&name=${encodeURIComponent(job.previews[0])}` : undefined
  return (
    <div className="my-2 overflow-hidden rounded-2xl border border-cyan-400/20 bg-black/40">
      <div className="flex items-center gap-2 border-b border-white/5 px-4 py-2 text-[11px] text-cyan-200/80">
        <Clapperboard size={13} /> Seu vídeo está pronto
        {job.qa?.ok && <ShieldCheck size={13} className="text-emerald-400" />}
        <span className="ml-auto font-mono text-white/30">{job.durationSec?.toFixed(0)}s{mb ? ` · ${mb} MB` : ''}</span>
      </div>
      <div className="bg-black p-2">
        <video
          key={job.id}
          controls
          playsInline
          preload="metadata"
          poster={poster}
          src={src}
          className={`mx-auto w-full rounded-xl bg-black object-contain ${wide ? 'max-h-[300px] max-w-[540px] aspect-video' : 'max-h-[480px] max-w-[270px] aspect-[9/16]'}`}
        >
          Seu navegador não suporta o player de vídeo.
        </video>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <a href={`/api/video?action=file&id=${encodeURIComponent(job.id)}&name=video.mp4&download=1`} download className="flex items-center gap-1.5 rounded-lg bg-cyan-500/15 px-3 py-2 text-[11px] font-medium text-cyan-100 transition-colors hover:bg-cyan-500/25 border border-cyan-500/25">
          <Download size={13} /> MP4
        </a>
        <a href={`/api/video?action=file&id=${encodeURIComponent(job.id)}&name=legendas.srt&download=1`} download className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[11px] text-white/70 hover:bg-white/10">
          <Download size={13} /> .srt
        </a>
        <button onClick={() => window.dispatchEvent(new CustomEvent('jarvis:open-motion'))} className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[11px] text-white/60 hover:bg-white/10 hover:text-white">
          <StudioIcon size={13} /> Estúdio de Vídeo
        </button>
        <span className="ml-auto hidden font-mono text-[9px] text-white/25 sm:inline">ia: {job.model?.split('|').pop() || 'auto'}</span>
      </div>
    </div>
  )
}
