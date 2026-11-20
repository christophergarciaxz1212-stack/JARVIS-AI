'use client'

import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Clapperboard, Download, FileAudio, Loader2, RotateCcw, Sparkles, Square, Trash2, Volume2, Wand2, X } from 'lucide-react'
import { usePrefs } from '@/components/settings/usePrefs'
import { useSpeech } from '@/components/voice/useSpeech'
import { toast } from 'sonner'
import { get, post } from '@/components/agents/api'
import { ConfirmDialog, Modal, ModelPicker } from '@/components/agents/shared'
import type { MotionJob, MotionStyle, NarrationMode } from '@/lib/motion/types'
import { KIT_INFO, KIT_STYLES } from '@/lib/motion/kit'

const STYLES: Array<{ id: MotionStyle; label: string; hint: string }> = [
  { id: 'auto', label: 'Modelo dos vídeos (automático)', hint: 'a IA escolhe a variação pelo tema' },
  ...KIT_STYLES.map(s => ({ id: s as MotionStyle, label: KIT_INFO[s].label, hint: KIT_INFO[s].hint })),
  { id: 'app-promo', label: 'Comercial', hint: 'produto/app, benefícios, oferta, CTA' },
]

const file = (j: MotionJob, name: string, download = false) => `/api/motion?action=file&id=${j.id}&name=${encodeURIComponent(name)}${download ? '&download=1' : ''}`

export default function MotionStudio({ onClose, initialPrompt = '' }: { onClose: () => void; initialPrompt?: string }) {
  const [jobs, setJobs] = useState<MotionJob[]>([])
  const [hasBrowser, setHasBrowser] = useState(true)
  const [prompt, setPrompt] = useState(initialPrompt)
  const [brandUrl, setBrandUrl] = useState('')
  const [style, setStyle] = useState<MotionStyle>('auto')
  const [seconds, setSeconds] = useState(12)
  const [fps, setFps] = useState<30 | 60>(60)
  const [prefs] = usePrefs()
  const speech = useSpeech()
  const [narration, setNarration] = useState<NarrationMode>(prefs?.motion.narration === 'jarvis' ? 'jarvis' : 'none')
  const [narrationText, setNarrationText] = useState('')
  const voiceLabel = prefs ? (prefs.voice.provider === 'gemini' ? `Gemini · ${prefs.voice.voice}${prefs.voice.style ? ` (${prefs.voice.style})` : ''}` : 'Voz do Windows') : '…'
  const [audioPath, setAudioPath] = useState('')
  const [model, setModel] = useState('auto')
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [feedback, setFeedback] = useState('')
  const [remove, setRemove] = useState<MotionJob | null>(null)

  const load = useCallback(async () => {
    try {
      const d = await get<{ jobs: MotionJob[]; browser: boolean }>('/api/motion?action=list')
      setJobs(d.jobs)
      setHasBrowser(d.browser)
    } catch (e) { toast.error((e as Error).message) }
  }, [])
  useEffect(() => { load() }, [load])
  const active = jobs.some(j => j.status === 'running' || j.status === 'queued')
  useEffect(() => {
    if (!active) return
    const t = setInterval(load, 1500)
    return () => clearInterval(t)
  }, [active, load])

  const create = async (extra: Record<string, unknown> = {}) => {
    setBusy(true)
    try {
      const r = await post<{ job: MotionJob }>('/api/motion', {
        action: 'create', prompt, brandUrl: brandUrl.trim() || undefined, style, seconds, fps, narration,
        narrationText: narrationText.trim() || undefined, audioPath: narration === 'file' ? audioPath : undefined,
        model: model === 'auto' ? undefined : model, ...extra,
      })
      setOpen(r.job.id)
      toast.success('Produção iniciada')
      load()
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }

  const pickAudio = async () => {
    const f = await window.electron?.pickFile?.([{ name: 'Áudio', extensions: ['mp3', 'wav', 'm4a', 'ogg', 'aac', 'webm'] }])
    if (f) setAudioPath(f)
    else if (!window.electron?.pickFile) toast.error('Escolher arquivos só funciona no aplicativo JARVIS')
  }

  return (
    <Modal onClose={onClose} width="max-w-6xl">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-white/5">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-fuchsia-500/30 to-cyan-400/30 border border-fuchsia-400/30 flex items-center justify-center"><Clapperboard size={17} className="text-fuchsia-200" /></div>
        <div className="flex-1">
          <div className="text-sm font-semibold text-white">Estúdio Motion</div>
          <div className="text-[11px] text-white/40">Vídeos de motion design 1080×1920 quadro a quadro, com efeitos sonoros e narração · método Motion Frames</div>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5 text-white/40"><X size={16} /></button>
      </div>

      <div className="flex-1 overflow-y-auto grid grid-cols-1 lg:grid-cols-[380px_1fr]">
        {/* Form */}
        <div className="p-5 space-y-3 border-r border-white/5">
          {!hasBrowser && <p className="text-xs text-amber-200 bg-amber-400/10 rounded-lg p-2">Instale o Google Chrome ou o Microsoft Edge para renderizar os vídeos.</p>}
          <label className="block text-[11px] text-white/50">O que o vídeo deve mostrar
            <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={4} placeholder="Ex.: anúncio do meu app de estudos que organiza provas e trabalhos, tom jovem, termina com 'baixe agora'" className="input-jarvis mt-1 w-full px-3 py-2 rounded-xl text-xs" />
          </label>
          <label className="block text-[11px] text-white/50">Site da marca (opcional — logo, cores e fontes reais)
            <input value={brandUrl} onChange={e => setBrandUrl(e.target.value)} placeholder="https://…" className="input-jarvis mt-1 w-full px-3 py-2 rounded-xl text-xs font-mono" />
          </label>
          <div>
            <div className="text-[11px] text-white/50 mb-1">Estilo</div>
            <div className="grid grid-cols-2 gap-1.5">
              {STYLES.map(s => (
                <button key={s.id} onClick={() => setStyle(s.id)} className={`text-left px-2.5 py-2 rounded-lg border text-xs ${style === s.id ? 'border-fuchsia-400/50 bg-fuchsia-500/10 text-white' : 'border-white/5 text-white/55 hover:border-white/15'}`}>
                  <div>{s.label}</div><div className="text-[10px] text-white/35">{s.hint}</div>
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] text-white/50">Duração
              <select value={seconds} onChange={e => setSeconds(Number(e.target.value))} className="input-jarvis mt-1 w-full px-2 py-1.5 rounded-lg text-xs">
                {[6, 8, 12, 15, 20, 30, 45, 60].map(s => <option key={s} value={s}>{s} segundos</option>)}
              </select>
            </label>
            <label className="text-[11px] text-white/50">Fluidez
              <select value={fps} onChange={e => setFps(Number(e.target.value) === 30 ? 30 : 60)} className="input-jarvis mt-1 w-full px-2 py-1.5 rounded-lg text-xs">
                <option value={60}>60 fps (mais suave)</option><option value={30}>30 fps (2× mais rápido)</option>
              </select>
            </label>
          </div>
          <div>
            <div className="text-[11px] text-white/50 mb-1">Narração</div>
            <div className="flex gap-1.5">
              {([['none', 'Sem voz'], ['jarvis', 'Voz do JARVIS'], ['file', 'Minha gravação']] as const).map(([id, label]) => (
                <button key={id} onClick={() => setNarration(id)} className={`flex-1 px-2 py-1.5 rounded-lg text-xs border ${narration === id ? 'border-cyan-400/50 bg-cyan-500/10 text-white' : 'border-white/5 text-white/50'}`}>{label}</button>
              ))}
            </div>
            {narration !== 'none' && (
              <textarea value={narrationText} onChange={e => setNarrationText(e.target.value)} rows={3}
                placeholder={narration === 'jarvis' ? 'Texto da narração (vazio = a IA escreve)' : 'Texto do que você fala na gravação (ajuda a sincronizar palavra por palavra)'}
                className="input-jarvis mt-2 w-full px-3 py-2 rounded-xl text-xs" />
            )}
            {narration === 'file' && (
              <button onClick={pickAudio} className="mt-1.5 w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs bg-white/5 text-white/70 hover:bg-white/10">
                <FileAudio size={13} /> <span className="truncate">{audioPath ? audioPath.split(/[\\/]/).pop() : 'Escolher arquivo de áudio (mp3, wav, m4a…)'}</span>
              </button>
            )}
            {narration === 'jarvis' && (
              <div className="flex items-center gap-2 mt-1">
                <button onClick={() => speech.toggle('motion-voice', { text: narrationText.trim() || undefined, preview: !narrationText.trim() }).catch(e => { if ((e as Error).name !== 'AbortError') toast.error((e as Error).message) })} className="p-1 rounded-full bg-white/10 hover:bg-cyan-500/30 text-white/80" title="Ouvir a voz">
                  {speech.key === 'motion-voice' ? (speech.loading ? <Loader2 size={10} className="animate-spin" /> : <Square size={10} />) : <Volume2 size={10} />}
                </button>
                <p className="text-[10px] text-white/40">Voz: {voiceLabel}. O vídeo dura o tempo da fala. Troque em Configurações › Voz.</p>
              </div>
            )}
          </div>
          <label className="block text-[11px] text-white/50">IA que escreve a animação
            <div className="mt-1"><ModelPicker value={model} onChange={setModel} /></div>
          </label>
          <motion.button whileTap={{ scale: 0.97 }} disabled={busy || !prompt.trim() || !hasBrowser || (narration === 'file' && !audioPath)} onClick={() => create()}
            className="sweepable glow-cta w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium bg-gradient-to-r from-fuchsia-500/70 to-cyan-500/70 text-white disabled:opacity-40">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />} Criar vídeo
          </motion.button>
        </div>

        {/* Jobs */}
        <div className="p-5 space-y-3">
          {!jobs.length && <div className="h-full flex flex-col items-center justify-center text-center text-white/30 text-xs py-16"><Sparkles className="mb-2 text-fuchsia-300/50" />Seus vídeos aparecem aqui.<br />No chat você também pode pedir: “crie um vídeo sobre…”.</div>}
          {jobs.map(j => {
            const expanded = open === j.id
            const running = j.status === 'running' || j.status === 'queued'
            return (
              <motion.div key={j.id} layout className="rounded-2xl border border-white/[0.07] bg-white/[0.02] overflow-hidden">
                <button onClick={() => setOpen(expanded ? null : j.id)} className="w-full text-left px-4 py-3 flex items-center gap-3">
                  <div className="w-10 h-16 rounded-md bg-black/50 overflow-hidden flex-shrink-0 border border-white/5">
                    {/* eslint-disable-next-line @next/next/no-img-element -- local render previews from /api/motion, not optimized web assets */}
                    {j.previews[0] && <img src={file(j, j.previews[Math.min(1, j.previews.length - 1)])} alt="" className="w-full h-full object-cover" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white truncate">{j.title || j.request.prompt}</div>
                    <div className={`text-[11px] ${j.status === 'failed' ? 'text-red-300' : j.status === 'done' ? 'text-green-300/80' : 'text-white/45'}`}>{j.status === 'failed' ? `Falhou: ${j.error}` : j.stage}{j.model ? ` · ${j.model.split('|').pop()}` : ''}</div>
                    {running && <div className="mt-1.5 h-1 rounded-full bg-white/5 overflow-hidden"><motion.div className="h-full bg-gradient-to-r from-fuchsia-400 to-cyan-400" animate={{ width: `${Math.round(j.progress * 100)}%` }} /></div>}
                  </div>
                  <span className="text-[10px] text-white/30">{new Date(j.createdAt).toLocaleString('pt-BR')}</span>
                </button>
                <AnimatePresence>
                  {expanded && (
                    <motion.div initial={false} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
                      <div className="px-4 pb-4 grid grid-cols-1 md:grid-cols-[240px_1fr] gap-4">
                        <div>
                          {j.status === 'done' && j.output
                            ? <video key={j.id} src={file(j, j.output)} controls className="w-full rounded-xl bg-black aspect-[9/16]" />
                             /* eslint-disable-next-line @next/next/no-img-element -- local render previews from /api/motion, not optimized web assets */
                            : <div className="grid grid-cols-3 gap-1">{j.previews.map(p => <img key={p} src={file(j, p)} alt="" className="rounded-md aspect-[9/16] object-cover bg-black" />)}</div>}
                        </div>
                        <div className="space-y-2 min-w-0">
                          <div className="flex gap-1.5 flex-wrap">
                            {j.status === 'done' && <a href={file(j, 'video.mp4', true)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs bg-cyan-500/15 text-cyan-100"><Download size={12} /> Baixar MP4</a>}
                            {running && <button onClick={async () => { await post('/api/motion', { action: 'cancel', id: j.id }); load() }} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs bg-white/5 text-white/70"><Square size={12} /> Cancelar</button>}
                            {!running && <button onClick={() => { setPrompt(j.request.prompt); setStyle(j.request.style); setSeconds(j.request.seconds); setBrandUrl(j.request.brandUrl || '') }} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs bg-white/5 text-white/70"><RotateCcw size={12} /> Usar como base</button>}
                            {!running && <button onClick={() => setRemove(j)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-red-300/70 hover:bg-red-500/10"><Trash2 size={12} /> Apagar</button>}
                          </div>
                          {j.status === 'done' && (
                            <div className="flex gap-2">
                              <input value={feedback} onChange={e => setFeedback(e.target.value)} placeholder="Ajuste: ex. título maior, fundo mais escuro, logo no final…" className="input-jarvis flex-1 min-w-0 px-3 py-1.5 rounded-lg text-xs" />
                              <button disabled={!feedback.trim() || busy} onClick={() => { void create({ parentId: j.id, feedback, prompt: j.request.prompt }); setFeedback('') }} className="px-3 rounded-lg text-xs bg-fuchsia-500/20 text-fuchsia-100 disabled:opacity-40">Ajustar</button>
                            </div>
                          )}
                          <div className="rounded-lg bg-black/40 p-2 max-h-48 overflow-y-auto font-mono text-[10px] text-white/50 space-y-0.5">
                            {j.log.map((l, i) => <div key={i}><span className="text-white/25">{new Date(l.at).toLocaleTimeString('pt-BR')}</span> {l.text}</div>)}
                            {!j.log.length && <div>Aguardando…</div>}
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )
          })}
        </div>
      </div>

      <AnimatePresence>
        {remove && (
          <ConfirmDialog title="Apagar este vídeo?" confirmLabel="Apagar" onClose={() => setRemove(null)}
            onConfirm={async () => { await post('/api/motion', { action: 'delete', id: remove.id }); load() }}>
            <p>O MP4, as prévias e a cena salva de “{remove.title || remove.request.prompt.slice(0, 60)}” serão apagados do JARVIS. Isso não pode ser desfeito.</p>
            {remove.request.audioPath && <p className="text-white/40">Sua gravação original não é apagada.</p>}
          </ConfirmDialog>
        )}
      </AnimatePresence>
    </Modal>
  )
}
