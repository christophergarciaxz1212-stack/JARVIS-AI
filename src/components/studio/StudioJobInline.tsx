'use client'

import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle, CheckCircle2, Circle, Clapperboard, Download, ExternalLink, FileAudio, FileJson, Image as ImageIcon,
  Loader2, MinusCircle, Send, Square, Subtitles, XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import type { Stage, StudioJob } from '@/lib/studio/types'

const ACTIVE = new Set(['queued', 'running'])
const SPEEDS = [0.75, 1, 1.25, 1.5, 2]

export const studioFileUrl = (id: string, name: string, download = false) =>
  `/api/studio?action=file&id=${encodeURIComponent(id)}&name=${encodeURIComponent(name)}${download ? '&download=1' : ''}`

const fmtSec = (s: number) => (s < 60 ? `${Math.round(s)} s` : `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, '0')} s`)
const fmtMb = (b?: number) => (b ? `${(b / 1048576).toFixed(1).replace('.', ',')} MB` : '')

function StageRow({ s }: { s: Stage }) {
  const icon = s.status === 'concluido' ? <CheckCircle2 size={13} className="text-emerald-300" />
    : s.status === 'executando' ? <Loader2 size={13} className="animate-spin text-cyan-300" />
      : s.status === 'falhou' ? <XCircle size={13} className="text-red-300" />
        : s.status === 'pulado' ? <MinusCircle size={13} className="text-white/25" />
          : <Circle size={13} className="text-white/20" />
  const dur = s.startedAt && s.endedAt ? ` · ${fmtSec((s.endedAt - s.startedAt) / 1000)}` : ''
  return (
    <li className="flex items-start gap-2 text-[11.5px] leading-snug">
      <span className="mt-[1px] flex-shrink-0">{icon}</span>
      <span className={s.status === 'aguardando' ? 'text-white/35' : 'text-white/80'}>{s.label}</span>
      {(s.detail || dur) && <span className="truncate text-white/40">{s.detail ? `— ${s.detail}` : ''}{dur}</span>}
    </li>
  )
}

/** Progresso real: etapas concluídas + fração do render medida em quadros. */
function progresso(job: StudioJob): number {
  const peso = { roteiro: 0.1, imagens: 0.3, narracao: 0.15, trilha: 0.05, montagem: 0.05, render: 0.35 } as const
  let p = 0
  for (const s of job.stages) {
    const w = peso[s.id]
    if (s.status === 'concluido' || s.status === 'pulado') p += w
    else if (s.status === 'executando' && s.id === 'render' && job.framesTotal) p += w * Math.min(1, (job.framesDone || 0) / job.framesTotal)
  }
  return Math.min(1, p)
}

/**
 * Cartão ao vivo de uma produção do estúdio dentro da conversa: etapas reais
 * enquanto produz; pronto, o player com velocidade, os downloads e o campo para
 * pedir ajuste (que vira mensagem na conversa e gera uma revisão).
 */
export default function StudioJobInline({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<StudioJob | null>(null)
  const [error, setError] = useState('')
  const [speed, setSpeed] = useState(1)
  const [ajuste, setAjuste] = useState('')
  const [canceling, setCanceling] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const poll = async () => {
      try {
        const r = await fetch(`/api/studio?action=job&id=${encodeURIComponent(jobId)}`, { cache: 'no-store' })
        const d = await r.json().catch(() => ({})) as { job?: StudioJob; error?: string }
        if (!r.ok || !d.job) throw new Error(d.error || 'Vídeo não encontrado')
        if (stopped) return
        setJob(d.job)
        setError('')
        if (ACTIVE.has(d.job.status)) timer = setTimeout(poll, 1500)
      } catch (e) {
        if (!stopped) setError((e as Error).message || 'Não foi possível acompanhar a produção')
      }
    }
    void poll()
    return () => { stopped = true; if (timer) clearTimeout(timer) }
  }, [jobId])

  useEffect(() => { if (videoRef.current) videoRef.current.playbackRate = speed }, [speed, job?.status])

  if (error) {
    return (
      <div className="my-2 flex items-center gap-3 rounded-2xl border border-red-400/25 bg-red-500/[0.06] p-4 text-xs text-red-200">
        <AlertTriangle size={16} className="flex-shrink-0" />
        <div>
          <div className="font-semibold text-red-100">Não consegui acompanhar este vídeo</div>
          <p className="mt-0.5 text-red-200/80">{error}</p>
        </div>
      </div>
    )
  }
  if (!job) {
    return (
      <div className="my-2 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-xs text-white/50">
        <Loader2 size={16} className="animate-spin text-cyan-300" /> Conectando ao estúdio…
      </div>
    )
  }

  const ativo = ACTIVE.has(job.status)
  const pronto = job.status === 'done'
  const pct = Math.round(progresso(job) * 100)
  const vertical = job.aspect === '9:16'
  const meta = [
    job.aspect, `${job.width}×${job.height}`, job.durationSec ? fmtSec(job.durationSec) : '', job.voiceLabel ? `voz ${job.voiceLabel}` : '', fmtMb(job.sizeBytes),
  ].filter(Boolean).join(' · ')
  const render = job.stages.find(s => s.id === 'render')

  const cancelar = async () => {
    setCanceling(true)
    try {
      const r = await fetch('/api/studio', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cancel', id: job.id }) })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Não deu para cancelar')
      toast('Produção cancelada')
    } catch (e) { toast.error((e as Error).message) } finally { setCanceling(false) }
  }

  const pedirAjuste = () => {
    const texto = ajuste.trim()
    if (!texto) return
    const titulo = job.title ? ` “${job.title}”` : ''
    window.dispatchEvent(new CustomEvent('jarvis:send', { detail: { text: `Ajuste o vídeo${titulo}: ${texto}` } }))
    setAjuste('')
  }

  return (
    <div className="my-2 w-full max-w-[640px] overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
      <div className="flex items-center gap-3 border-b border-white/5 px-4 py-3">
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-cyan-400/25 bg-cyan-500/10">
          <Clapperboard size={15} className="text-cyan-200" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-white">{job.title || job.request.prompt.slice(0, 90) || 'Vídeo'}</div>
          <div className="truncate text-[11px] text-white/45">{meta}{job.parentId ? ' · revisão' : ''}</div>
        </div>
        {ativo && (
          <button onClick={cancelar} disabled={canceling} className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] text-white/70 hover:bg-white/10 disabled:opacity-50">
            <Square size={11} /> Cancelar
          </button>
        )}
      </div>

      {ativo && (
        <div className="space-y-3 px-4 py-3">
          <div>
            <div className="mb-1 flex justify-between text-[11px] text-white/50">
              <span>{job.status === 'queued' ? 'Na fila — uma produção por vez' : 'Produzindo'}</span>
              <span>{pct}%{render?.status === 'executando' && job.framesTotal ? ` · quadro ${job.framesDone || 0} de ${job.framesTotal}` : ''}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
              <div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-fuchsia-400 transition-[width] duration-700" style={{ width: `${pct}%` }} />
            </div>
          </div>
          <ul className="space-y-1">{job.stages.map(s => <StageRow key={s.id} s={s} />)}</ul>
        </div>
      )}

      {pronto && job.output && (
        <div className="space-y-3 px-4 py-3">
          <div className={`overflow-hidden rounded-xl border border-white/5 bg-black ${vertical ? 'mx-auto max-w-[300px]' : ''}`}>
            <video
              ref={videoRef}
              src={studioFileUrl(job.id, 'video.mp4')}
              poster={studioFileUrl(job.id, 'capa.jpg')}
              controls
              playsInline
              preload="metadata"
              className="block h-auto w-full"
              aria-label={job.title || 'Vídeo produzido'}
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[11px] text-white/40">Velocidade</span>
            {SPEEDS.map(v => (
              <button key={v} onClick={() => setSpeed(v)} aria-pressed={speed === v}
                className={`rounded-md px-2 py-0.5 text-[11px] ${speed === v ? 'bg-cyan-500/20 text-cyan-100' : 'bg-white/5 text-white/55 hover:bg-white/10'}`}>
                {String(v).replace('.', ',')}×
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <a href={studioFileUrl(job.id, 'video.mp4', true)} className="flex items-center gap-1.5 rounded-lg bg-cyan-500/15 px-3 py-1.5 text-[11.5px] font-medium text-cyan-100 hover:bg-cyan-500/25"><Download size={12} /> MP4</a>
            {job.request.narration !== false && <a href={studioFileUrl(job.id, 'legendas.srt', true)} className="flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-1.5 text-[11.5px] text-white/70 hover:bg-white/10"><Subtitles size={12} /> Legenda .srt</a>}
            {job.request.narration !== false && <a href={studioFileUrl(job.id, 'narracao.wav', true)} className="flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-1.5 text-[11.5px] text-white/70 hover:bg-white/10"><FileAudio size={12} /> Narração</a>}
            <a href={studioFileUrl(job.id, 'capa.jpg', true)} className="flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-1.5 text-[11.5px] text-white/70 hover:bg-white/10"><ImageIcon size={12} /> Capa</a>
            <a href={studioFileUrl(job.id, 'projeto.json', true)} className="flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-1.5 text-[11.5px] text-white/70 hover:bg-white/10"><FileJson size={12} /> Projeto</a>
            <a href={studioFileUrl(job.id, 'video.mp4')} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-1.5 text-[11.5px] text-white/70 hover:bg-white/10"><ExternalLink size={12} /> Abrir</a>
          </div>
        </div>
      )}

      {(job.status === 'failed' || job.status === 'canceled') && (
        <div className="space-y-2 px-4 py-3">
          <div className={`flex items-start gap-2 text-xs ${job.status === 'failed' ? 'text-red-200' : 'text-white/55'}`}>
            {job.status === 'failed' ? <XCircle size={14} className="mt-[1px] flex-shrink-0" /> : <MinusCircle size={14} className="mt-[1px] flex-shrink-0" />}
            <span>{job.status === 'failed' ? (job.error || 'A produção falhou') : 'Produção cancelada'}</span>
          </div>
          <ul className="space-y-1">{job.stages.filter(s => s.status !== 'aguardando').map(s => <StageRow key={s.id} s={s} />)}</ul>
        </div>
      )}

      {job.notes.length > 0 && (
        <ul className="space-y-0.5 border-t border-white/5 px-4 py-2 text-[11px] text-amber-200/75">
          {job.notes.map((n, i) => <li key={i}>• {n}</li>)}
        </ul>
      )}

      {!ativo && job.plan && (
        <form onSubmit={e => { e.preventDefault(); pedirAjuste() }} className="flex items-center gap-2 border-t border-white/5 px-3 py-2">
          <input
            value={ajuste}
            onChange={e => setAjuste(e.target.value)}
            placeholder="Pedir ajuste: troque a voz, deixe com 30s, imagem nova na cena 2…"
            aria-label="Pedir ajuste neste vídeo"
            className="min-w-0 flex-1 bg-transparent px-1 py-1 text-[12px] text-white placeholder:text-white/30 focus:outline-none"
          />
          <button type="submit" disabled={!ajuste.trim()} className="flex items-center gap-1 rounded-lg bg-white/5 px-2.5 py-1.5 text-[11px] text-white/70 hover:bg-white/10 disabled:opacity-40">
            <Send size={11} /> Ajustar
          </button>
        </form>
      )}
    </div>
  )
}
