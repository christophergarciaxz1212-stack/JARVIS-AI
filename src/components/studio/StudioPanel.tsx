'use client'

import { useCallback, useEffect, useState } from 'react'
import { Clapperboard, Loader2, Sparkles, Trash2, Wand2, X } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog, Modal } from '@/components/agents/shared'
import MotionStudio from '@/components/motion/MotionStudio'
import StudioJobInline, { studioFileUrl } from './StudioJobInline'
import type { StudioJob } from '@/lib/studio/types'

const ASPECTS = [
  { id: '', label: 'Automático' }, { id: '16:9', label: '16:9 horizontal' }, { id: '9:16', label: '9:16 vertical' }, { id: '1:1', label: '1:1 quadrado' },
]
const VOZES = [
  { id: '', label: 'Automática (pelo roteiro)' },
  { id: 'pt-BR-ThalitaMultilingualNeural', label: 'Thalita (feminina)' },
  { id: 'pt-BR-FranciscaNeural', label: 'Francisca (feminina)' },
  { id: 'pt-BR-AntonioNeural', label: 'Antonio (masculina)' },
]
const TRILHAS = [
  { id: 'auto', label: 'Automática' }, { id: 'epico', label: 'Épica' }, { id: 'inspirador', label: 'Inspiradora' },
  { id: 'atmosferico', label: 'Atmosférica' }, { id: 'tenso', label: 'Tensa' }, { id: 'documental', label: 'Documental' },
  { id: 'publicitario', label: 'Publicitária' }, { id: 'tecnologico', label: 'Tecnológica' }, { id: 'nenhuma', label: 'Sem trilha' },
]

const sel = 'w-full rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-2 text-[12px] text-white focus:border-cyan-400/40 focus:outline-none'

async function post<T>(body: Record<string, unknown>): Promise<T> {
  const r = await fetch('/api/studio', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error((d as { error?: string }).error || 'Falhou')
  return d as T
}

/**
 * Painel do estúdio: criar um vídeo escolhendo formato, duração, voz e trilha à
 * mão (no chat o diretor decide sozinho), ver as produções e apagar as antigas.
 * Os modelos animados do usuário continuam no Estúdio Motion.
 */
export default function StudioPanel({ onClose }: { onClose: () => void }) {
  const [jobs, setJobs] = useState<StudioJob[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState<string | null>(null)
  const [motion, setMotion] = useState(false)
  const [remove, setRemove] = useState<StudioJob | null>(null)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ prompt: '', aspect: '', seconds: '', quality: '1080p', voice: '', music: 'auto', narration: true, captions: true })

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/studio?action=list', { cache: 'no-store' })
      const d = await r.json() as { jobs: StudioJob[] }
      setJobs(d.jobs || [])
    } catch { /* lista some só até a próxima atualização */ } finally { setLoading(false) }
  }, [])

  const ativo = jobs.some(j => j.status === 'queued' || j.status === 'running')
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!ativo) return
    const t = setInterval(load, 3000)
    return () => clearInterval(t)
  }, [ativo, load])

  const criar = async () => {
    if (!form.prompt.trim()) return toast.error('Descreva o vídeo')
    setBusy(true)
    try {
      const body: Record<string, unknown> = { action: 'create', prompt: form.prompt.trim(), quality: form.quality, music: form.music, narration: form.narration, captions: form.captions }
      if (form.aspect) body.aspect = form.aspect
      if (form.voice) body.voice = form.voice
      const s = Number(form.seconds)
      if (s) body.seconds = s
      const { job } = await post<{ job: StudioJob }>(body)
      setForm(f => ({ ...f, prompt: '' }))
      setOpen(job.id)
      toast.success('Produção iniciada')
      void load()
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }

  if (motion) return <MotionStudio onClose={() => setMotion(false)} />

  return (
    <Modal onClose={onClose} width="max-w-5xl">
      <div className="flex items-center gap-3 border-b border-white/5 px-5 py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-400/30 bg-gradient-to-br from-cyan-500/25 to-fuchsia-500/25"><Clapperboard size={17} className="text-cyan-100" /></div>
        <div className="flex-1">
          <div className="text-sm font-semibold text-white">Estúdio de vídeo</div>
          <div className="text-[11px] text-white/40">Roteiro, imagens com câmera, narração em português, trilha, legendas e render — grátis, no seu computador</div>
        </div>
        <button onClick={() => setMotion(true)} className="flex items-center gap-1.5 rounded-lg border border-fuchsia-400/25 bg-fuchsia-500/10 px-3 py-1.5 text-[11.5px] text-fuchsia-100 hover:bg-fuchsia-500/20">
          <Sparkles size={12} /> Modelos animados
        </button>
        <button onClick={onClose} aria-label="Fechar" className="rounded-lg p-1.5 text-white/50 hover:bg-white/5 hover:text-white"><X size={16} /></button>
      </div>

      <div className="grid max-h-[75vh] grid-cols-1 gap-0 overflow-hidden md:grid-cols-[300px_1fr]">
        <form onSubmit={e => { e.preventDefault(); void criar() }} className="space-y-3 overflow-y-auto border-b border-white/5 p-4 md:border-b-0 md:border-r">
          <label className="block">
            <span className="mb-1 block text-[11px] text-white/50">O que o vídeo deve mostrar</span>
            <textarea value={form.prompt} onChange={e => setForm({ ...form, prompt: e.target.value })} rows={5}
              placeholder="Ex.: vídeo para o Instagram da minha cafeteria, clima aconchegante, chamada para visitar no fim de semana"
              className={`${sel} resize-none`} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block"><span className="mb-1 block text-[11px] text-white/50">Formato</span>
              <select value={form.aspect} onChange={e => setForm({ ...form, aspect: e.target.value })} className={sel}>{ASPECTS.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}</select></label>
            <label className="block"><span className="mb-1 block text-[11px] text-white/50">Duração (s)</span>
              <input type="number" min={8} max={180} value={form.seconds} onChange={e => setForm({ ...form, seconds: e.target.value })} placeholder="auto" className={sel} /></label>
            <label className="block"><span className="mb-1 block text-[11px] text-white/50">Qualidade</span>
              <select value={form.quality} onChange={e => setForm({ ...form, quality: e.target.value })} className={sel}><option value="1080p">1080p</option><option value="720p">720p (mais rápido)</option></select></label>
            <label className="block"><span className="mb-1 block text-[11px] text-white/50">Trilha</span>
              <select value={form.music} onChange={e => setForm({ ...form, music: e.target.value })} className={sel}>{TRILHAS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</select></label>
          </div>
          <label className="block"><span className="mb-1 block text-[11px] text-white/50">Voz</span>
            <select value={form.voice} onChange={e => setForm({ ...form, voice: e.target.value })} disabled={!form.narration} className={sel}>{VOZES.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}</select></label>
          <div className="flex flex-wrap gap-4 text-[12px] text-white/70">
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={form.narration} onChange={e => setForm({ ...form, narration: e.target.checked })} /> Narração</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={form.captions} onChange={e => setForm({ ...form, captions: e.target.checked })} /> Legendas</label>
          </div>
          <button type="submit" disabled={busy || !form.prompt.trim()} className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500/80 to-fuchsia-500/80 px-3 py-2.5 text-[13px] font-semibold text-white disabled:opacity-40">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />} Produzir vídeo
          </button>
          <p className="text-[10.5px] leading-snug text-white/35">No chat é só pedir: “crie um vídeo para o Instagram sobre…”. Para ajustar, escreva “troque a voz”, “deixe com 30s” ou “imagem nova na cena 2”.</p>
        </form>

        <div className="space-y-2 overflow-y-auto p-4">
          {loading && <div className="flex items-center gap-2 text-xs text-white/40"><Loader2 size={14} className="animate-spin" /> Carregando…</div>}
          {!loading && !jobs.length && <div className="py-10 text-center text-xs text-white/35">Nenhum vídeo ainda. Descreva o primeiro ao lado.</div>}
          {jobs.map(j => (
            <div key={j.id}>
              {open === j.id ? (
                <div className="relative">
                  <button onClick={() => setOpen(null)} className="absolute right-2 top-2 z-10 rounded-md bg-black/40 px-2 py-0.5 text-[10.5px] text-white/60 hover:text-white">fechar</button>
                  <StudioJobInline jobId={j.id} />
                </div>
              ) : (
                <div className="group flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2.5 hover:border-white/15">
                  <button onClick={() => setOpen(j.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                    <div className="h-10 w-16 flex-shrink-0 overflow-hidden rounded-md border border-white/5 bg-black/50">
                      {/* eslint-disable-next-line @next/next/no-img-element -- capa local do render */}
                      {j.status === 'done' ? <img src={studioFileUrl(j.id, 'capa.jpg')} alt="" className="h-full w-full object-cover" /> : null}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-[12.5px] font-medium text-white">{j.title || j.request.prompt}</div>
                      <div className="truncate text-[10.5px] text-white/40">
                        {{ queued: 'Na fila', running: 'Produzindo', done: 'Pronto', failed: 'Falhou', canceled: 'Cancelado' }[j.status]} · {j.aspect} · {new Date(j.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}{j.parentId ? ' · revisão' : ''}
                      </div>
                    </div>
                  </button>
                  <button onClick={() => setRemove(j)} aria-label="Apagar produção" className="rounded-md p-1.5 text-white/30 opacity-0 hover:bg-red-500/10 hover:text-red-300 group-hover:opacity-100"><Trash2 size={13} /></button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {remove && (
        <ConfirmDialog
          title="Apagar produção?"
          confirmLabel="Apagar"
          danger
          onClose={() => setRemove(null)}
          onConfirm={async () => {
            try { await post({ action: 'delete', id: remove.id }); if (open === remove.id) setOpen(null); toast.success('Produção apagada'); void load() } catch (e) { toast.error((e as Error).message) }
          }}
        >
          “{remove.title || remove.request.prompt.slice(0, 60)}” e todos os arquivos dela (vídeo, narração, legenda, imagens) serão apagados do disco. Não dá para desfazer.
        </ConfirmDialog>
      )}
    </Modal>
  )
}
