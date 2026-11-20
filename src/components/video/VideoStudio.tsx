'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle, Clapperboard, Download, FileAudio, Loader2, RotateCcw, Search, Music2, Film, Clock, Gauge,
  Sparkles, Square, Trash2, Play, Wand2, X, Mic2, PencilLine, ChevronDown, ChevronRight, ShieldCheck, RectangleHorizontal, Square as SquareIcon, RectangleVertical, GalleryVerticalEnd, Copy,
  CheckCircle2, XCircle, Ban, Repeat, ScrollText, Lightbulb, SlidersHorizontal, Keyboard,
} from 'lucide-react'
import { toast } from 'sonner'
import { get, post } from '@/components/agents/api'
import { ConfirmDialog, Modal } from '@/components/agents/shared'
import type { MusicMood } from '@/lib/video/audioMix'
import type { VideoJob, VideoNarration, VoiceSelection } from '@/lib/video/types'
import type { VideoFormat } from '@/lib/video/formats'
import type { MotionJob, MotionStyle } from '@/lib/motion/types'
import { KIT_INFO, KIT_STYLES, type KitStyle } from '@/lib/motion/kit'

type VoiceItem = { id: string; label: string; gender: string }
type Scene = { name: string; vo: string; visual: string; camera: string; durationSec: number }
type Fps = 24 | 25 | 30 | 50 | 60
type Filter = 'all' | 'running' | 'done' | 'failed'

const ASPECT_ICON: Record<string, React.ReactNode> = {
  '16:9': <RectangleHorizontal size={16} />,
  '9:16': <RectangleVertical size={16} />,
  '1:1': <SquareIcon size={15} />,
  '4:5': <GalleryVerticalEnd size={15} />,
}

const DURATIONS = [10, 15, 30, 45, 60]
const FPS_OPTIONS: Array<{ v: Fps; hint: string }> = [
  { v: 24, hint: 'cinema' }, { v: 25, hint: 'PAL' }, { v: 30, hint: 'padrão' }, { v: 50, hint: 'TV' }, { v: 60, hint: 'suave' },
]
const MUSIC_OPTIONS: Array<{ id: 'auto' | MusicMood; label: string }> = [
  { id: 'auto', label: 'Automática (a IA escolhe pela história)' },
  { id: 'epico', label: 'Épica (grandes temas)' },
  { id: 'inspirador', label: 'Inspiradora (marcas e pessoas)' },
  { id: 'atmosferico', label: 'Atmosférica (contemplativa)' },
  { id: 'tenso', label: 'Tensa (investigação)' },
  { id: 'documental', label: 'Documental (neutra)' },
  { id: 'publicitario', label: 'Publicitária (comercial)' },
  { id: 'nenhum', label: 'Sem trilha (só narração e efeitos)' },
]
/**
 * Os 3 modelos do Estúdio:
 * - Modelo dos vídeos: explicadores de tecnologia no estilo TikTok (4 variações visuais, animação por código);
 * - Comercial: produto/app à venda, com benefícios, oferta e CTA (animação por código);
 * - Publicitário: campanha de marca cinematográfica (imagens de IA, narração, trilha e legendas).
 */
type StudioModel = 'videos' | 'comercial' | 'publicitario'
type Variant = 'auto' | KitStyle
const MODELS: Array<{ id: StudioModel; label: string; desc: string; tech: string }> = [
  { id: 'videos', label: 'Modelo dos vídeos', desc: 'Explicadores de tecnologia no estilo TikTok: passos, notícia, dados ou analogia', tech: 'animação por código · vertical' },
  { id: 'comercial', label: 'Comercial', desc: 'Produto ou app à venda: benefícios, números, oferta e CTA', tech: 'animação 3D por código · vertical' },
  { id: 'publicitario', label: 'Publicitário', desc: 'Campanha de marca cinematográfica com cenas, narração e trilha', tech: 'imagens de IA · todos os formatos' },
]
const EXAMPLES: Record<StudioModel, Array<{ tag: string; text: string }>> = {
  videos: [
    { tag: '5 ferramentas', text: '5 projetos do GitHub que transformam o Claude Code numa operação inteira: HyperFrames, Google Workspace CLI, Apify, Agent Skills e Playwright CLI' },
    { tag: 'Notícia', text: 'Notícia: o Claude acabou de matar o Instagram? Um repositório grátis com 52 skills escreve reels, monta carrosséis e responde comentários' },
    { tag: 'Dados', text: 'Os primeiros 100 mil: por que o começo parece lento e quem continua vê a curva exponencial dos juros compostos' },
    { tag: 'Analogia', text: 'Supabase explicado como um prédio: arquivo central é o banco Postgres, portaria é o login, depósito é o storage e interfone é o realtime' },
  ],
  comercial: [
    { tag: 'App', text: 'Comercial do app de finanças Poupa+: organize seus gastos em 2 minutos, metas automáticas e alertas. Baixe grátis' },
    { tag: 'Produto', text: 'Comercial do fone sem fio Pulse X: 40 horas de bateria, cancelamento de ruído e carregamento rápido. Garanta o seu' },
  ],
  publicitario: [
    { tag: 'Marca', text: 'Filme publicitário para a minha cafeteria de café especial: do grão à xícara, aconchego e tradição' },
    { tag: 'Campanha', text: 'Campanha de lançamento de uma marca de roupas sustentáveis: natureza, pessoas reais e o futuro da moda' },
  ],
}
const MOTION_DURATIONS = [15, 30, 45, 60]
/** Etapas reais do pipeline (limiares de progresso usados em lib/video/produce.ts) */
const PIPELINE: Array<[string, number]> = [
  ['Roteiro', 0.05], ['Narração', 0.2], ['Imagens', 0.3], ['Trilha', 0.55], ['Montagem', 0.62], ['QA', 0.68], ['Render', 0.74],
]
// Fala em pt-BR gira em torno de 150 palavras por minuto
const WORDS_PER_SEC = 2.5
const PREFS_KEY = 'jarvis.studio.prefs.v1'

const file = (j: VideoJob, name: string, download = false) => `/api/video?action=file&id=${j.id}&name=${encodeURIComponent(name)}${download ? '&download=1' : ''}`
const fmtDate = (t: number) => new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const fmtMB = (b?: number) => (b ? `${(b / 1_048_576).toFixed(1).replace('.', ',')} MB` : '')
const fmtSpan = (ms: number) => { const s = Math.round(ms / 1000); return s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s` }
const isRunning = (j: { status: string }) => j.status === 'running' || j.status === 'queued'
const isFailed = (j: { status: string }) => j.status === 'failed' || j.status === 'canceled'

const motionFile = (j: MotionJob, name: string, download = false) => `/api/motion?action=file&id=${j.id}&name=${encodeURIComponent(name)}${download ? '&download=1' : ''}`
/** Rótulo do modelo de uma produção animada (Modelo dos vídeos · variação, ou Comercial). */
function motionModelLabel(style: MotionStyle) {
  if (style === 'app-promo') return 'Comercial'
  if (style === 'auto') return 'Modelo dos vídeos'
  return `Modelo dos vídeos · ${KIT_INFO[style as KitStyle]?.label.replace(/^Explicador /, '') || style}`
}

/** Card de uma produção animada (Modelo dos vídeos ou Comercial): prévia, vídeo, ajuste por pedido, download. */
function MotionCard({ job: j, expanded, onToggle, onCancel, onDelete, onReuse, onRevise }: {
  job: MotionJob; expanded: boolean; onToggle: () => void; onCancel: () => void; onDelete: () => void; onReuse: () => void; onRevise: (feedback: string) => Promise<void>
}) {
  const [feedback, setFeedback] = useState('')
  const [sending, setSending] = useState(false)
  const running = isRunning(j)
  const meta = [motionModelLabel(j.request.style), j.frames ? `${(j.frames / j.request.fps).toFixed(1).replace('.', ',')} s` : '', fmtMB(j.sizeBytes), j.model ? j.model.split('|').pop() : ''].filter(Boolean)
  return (
    <motion.div layout="position" className={`rounded-2xl border overflow-hidden transition-colors ${expanded ? 'border-cyan-400/25 bg-white/[0.035] shadow-[0_8px_40px_-20px_rgba(34,211,238,.45)]' : 'border-white/[0.07] bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.03]'}`}>
      <button onClick={onToggle} aria-expanded={expanded} className="w-full text-left px-3.5 py-3 flex items-center gap-3">
        <div className="relative w-10 h-[68px] rounded-lg bg-black/50 overflow-hidden flex-shrink-0 border border-white/5">
          {/* eslint-disable-next-line @next/next/no-img-element -- prévias locais do render */}
          {j.previews[0] ? <img src={motionFile(j, j.previews[0])} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-white/15"><Film size={16} /></div>}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium text-white truncate">{j.title || j.request.prompt}</div>
          <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
            <StatusBadge job={j} />
            <span className={`text-[10.5px] truncate ${j.status === 'failed' ? 'text-red-300/90' : 'text-white/45'}`}>{j.status === 'failed' ? j.error : running ? j.stage : meta.join(' · ')}</span>
          </div>
          {running && <div className="mt-2 h-1 rounded-full bg-white/5 overflow-hidden"><motion.div className="h-full bg-gradient-to-r from-cyan-400 to-fuchsia-400" animate={{ width: `${Math.round(j.progress * 100)}%` }} /></div>}
        </div>
        <span className="text-[10px] text-white/30 text-right leading-tight flex-shrink-0">{fmtDate(j.createdAt)}{j.finishedAt && j.status === 'done' ? <><br />em {fmtSpan(j.finishedAt - j.createdAt)}</> : null}</span>
        <ChevronDown size={14} className={`text-white/30 flex-shrink-0 transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`} />
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }} className="overflow-hidden">
            <div className="px-3.5 pb-4 pt-3 grid grid-cols-1 md:grid-cols-[minmax(0,250px)_1fr] gap-4 border-t border-white/[0.05]">
              <div>
                {j.status === 'done' && j.output
                  ? <video key={j.id} src={motionFile(j, j.output)} controls className="w-full rounded-xl bg-black border border-white/5 aspect-[9/16] max-h-[460px] mx-auto" />
                  : j.previews.length
                    ? <div className="grid grid-cols-3 gap-1">{j.previews.map(p => (
                        /* eslint-disable-next-line @next/next/no-img-element -- prévias locais do render */
                        <img key={p} src={motionFile(j, p)} alt="" className="rounded-md object-cover bg-black aspect-[9/16]" />
                      ))}</div>
                    : <div className="rounded-xl bg-black/40 border border-white/5 flex flex-col items-center justify-center gap-2 text-[11px] text-white/35 aspect-[9/16] max-h-[300px]">{running ? <Loader2 size={18} className="animate-spin text-cyan-300/70" /> : <Film size={18} />}{running ? 'As prévias aparecem aqui assim que os quadros forem testados' : 'Sem prévia'}</div>}
                <div className="flex gap-1.5 mt-2.5 flex-wrap">
                  {j.status === 'done' && <a href={motionFile(j, 'video.mp4', true)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-gradient-to-r from-cyan-500/25 to-fuchsia-500/20 border border-cyan-400/25 text-white hover:brightness-125"><Download size={12} /> Baixar MP4</a>}
                  {running && <button onClick={onCancel} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] bg-white/5 text-white/70 hover:bg-red-500/15 hover:text-red-200"><Square size={12} /> Cancelar</button>}
                  <button onClick={onReuse} title="Copia o pedido e o modelo desta produção para o painel" className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] bg-white/5 text-white/70 hover:bg-white/10"><Repeat size={12} /> Reusar configurações</button>
                  {!running && <button onClick={onDelete} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] text-red-300/75 hover:bg-red-500/10"><Trash2 size={12} /> Apagar</button>}
                </div>
              </div>
              <div className="space-y-2.5 min-w-0">
                {j.status === 'done' && (
                  <div className="rounded-xl border border-white/8 bg-black/30 p-2.5 space-y-2">
                    <div className="text-[10px] uppercase tracking-wider text-white/50 flex items-center gap-1.5"><PencilLine size={10} /> Pedir um ajuste</div>
                    <textarea value={feedback} onChange={e => setFeedback(e.target.value)} rows={3} aria-label="Ajuste pedido"
                      placeholder="Ex.: deixe o título maior, troque o destaque para verde, acrescente um card com o comando npm install…"
                      className="input-jarvis w-full px-2.5 py-2 rounded-lg text-[11px]" />
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[9.5px] text-white/35">A IA ajusta a animação mantendo a narração e o tempo das cenas.</span>
                      <button disabled={!feedback.trim() || sending} onClick={async () => { setSending(true); try { await onRevise(feedback.trim()); setFeedback('') } finally { setSending(false) } }}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] bg-cyan-500/20 text-cyan-50 hover:bg-cyan-500/30 disabled:opacity-40">
                        {sending ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />} Ajustar
                      </button>
                    </div>
                  </div>
                )}
                <details open={j.status !== 'done'} className="group/log rounded-xl border border-white/5 bg-black/40">
                  <summary className="cursor-pointer select-none list-none px-2.5 py-1.5 text-[10px] uppercase tracking-wider text-white/45 flex items-center gap-1.5 hover:text-white/70">
                    <ScrollText size={10} /> Registro da produção <span className="text-white/25 normal-case tracking-normal">({j.log.length})</span>
                    <ChevronDown size={11} className="ml-auto transition-transform group-open/log:rotate-180" />
                  </summary>
                  <div className="px-2.5 pb-2 max-h-44 overflow-y-auto font-mono text-[10px] text-white/55 space-y-0.5">
                    {j.log.map((l, i) => <div key={i}><span className="text-white/25">{new Date(l.at).toLocaleTimeString('pt-BR')}</span> {l.text}</div>)}
                    {!j.log.length && <div>Aguardando…</div>}
                  </div>
                </details>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

/** Miniatura do visual de cada modelo no seletor. */
function ModelThumb({ id }: { id: StudioModel }) {
  if (id === 'videos') return (
    <div className="h-12 rounded-lg bg-[#09090b] border border-white/5 p-1.5 flex flex-col gap-1 overflow-hidden">
      <div className="flex gap-0.5">{[0, 1, 2].map(i => <i key={i} className={`flex-1 h-0.5 rounded ${i === 0 ? 'bg-yellow-400' : 'bg-white/15'}`} />)}</div>
      <div className="text-[7px] font-black text-white leading-none">5 <span className="text-yellow-400">TOOLS</span></div>
      <div className="mt-auto mx-auto px-1 rounded border border-yellow-400/70 text-[6px] text-white">karaokê</div>
    </div>
  )
  if (id === 'comercial') return (
    <div className="h-12 rounded-lg bg-gradient-to-br from-indigo-900 to-black border border-white/5 flex items-center justify-center gap-1">
      <div className="w-4 h-8 rounded-[4px] border border-cyan-300/70 bg-cyan-500/10 [transform:perspective(60px)_rotateY(-18deg)]" />
      <div className="text-[7px] font-bold text-cyan-100 leading-tight">BAIXE<br />AGORA</div>
    </div>
  )
  return (
    <div className="h-12 rounded-lg border border-white/5 overflow-hidden bg-gradient-to-br from-amber-700/60 via-rose-900/50 to-black flex items-end p-1">
      <div className="text-[7px] text-white/90 italic">cena cinematográfica</div>
    </div>
  )
}

function StatusBadge({ job }: { job: { status: VideoJob['status']; progress: number } }) {
  const map = {
    queued: { cls: 'bg-white/8 text-white/60 border-white/10', icon: <Clock size={10} />, label: 'Na fila' },
    running: { cls: 'bg-fuchsia-500/15 text-fuchsia-100 border-fuchsia-400/30', icon: <Loader2 size={10} className="animate-spin" />, label: `${Math.round(job.progress * 100)}%` },
    done: { cls: 'bg-emerald-500/15 text-emerald-200 border-emerald-400/30', icon: <CheckCircle2 size={10} />, label: 'Pronto' },
    failed: { cls: 'bg-red-500/15 text-red-200 border-red-400/30', icon: <XCircle size={10} />, label: 'Falhou' },
    canceled: { cls: 'bg-white/5 text-white/45 border-white/10', icon: <Ban size={10} />, label: 'Cancelado' },
  }[job.status]
  return <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[9.5px] font-medium ${map.cls}`}>{map.icon}{map.label}</span>
}

function PipelineSteps({ progress }: { progress: number }) {
  const current = PIPELINE.reduce((acc, [, at], i) => (progress >= at ? i : acc), -1)
  return (
    <div className="flex items-center gap-1 mt-2" aria-label="Etapas da produção">
      {PIPELINE.map(([label], i) => {
        const done = i < current
        const now = i === current
        return (
          <div key={label} className="flex-1 min-w-0" title={label}>
            <div className={`h-1 rounded-full transition-colors duration-500 ${done ? 'bg-gradient-to-r from-fuchsia-400 to-cyan-400' : now ? 'bg-fuchsia-400/70 animate-pulse' : 'bg-white/8'}`} />
            <div className={`mt-1 text-[8.5px] truncate text-center ${now ? 'text-fuchsia-100' : done ? 'text-white/45' : 'text-white/25'}`}>{label}</div>
          </div>
        )
      })}
    </div>
  )
}

function Section({ n, title, icon, children, aside }: { n: number; title: string; icon: React.ReactNode; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/[0.07] bg-gradient-to-b from-white/[0.035] to-white/[0.01] p-3.5">
      <div className="flex items-center gap-2 mb-2.5">
        <span className="w-5 h-5 rounded-md bg-gradient-to-br from-fuchsia-500/40 to-cyan-500/40 border border-white/10 text-[10px] font-bold text-white flex items-center justify-center">{n}</span>
        <span className="text-white/45">{icon}</span>
        <h3 className="text-[12px] font-semibold text-white/85 tracking-wide flex-1">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

function Segmented<T extends string | number>({ value, options, onChange, accent = 'fuchsia', label }: {
  value: T; options: Array<{ v: T; label: React.ReactNode; hint?: string }>; onChange: (v: T) => void; accent?: 'fuchsia' | 'cyan'; label: string
}) {
  const on = accent === 'cyan' ? 'border-cyan-400/55 bg-cyan-500/15 text-white shadow-[0_0_14px_-4px_rgba(34,211,238,.6)]' : 'border-fuchsia-400/55 bg-fuchsia-500/15 text-white shadow-[0_0_14px_-4px_rgba(217,70,239,.6)]'
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1">
      {options.map(o => (
        <button key={String(o.v)} type="button" role="radio" aria-checked={value === o.v} onClick={() => onChange(o.v)}
          className={`flex-1 min-w-0 px-1.5 py-1.5 rounded-lg border text-[11px] leading-tight transition-all duration-200 ${value === o.v ? on : 'border-white/[0.06] bg-black/20 text-white/55 hover:text-white/85 hover:border-white/15'}`}>
          <span className="block truncate">{o.label}</span>
          {o.hint && <span className={`block text-[8.5px] ${value === o.v ? 'text-white/60' : 'text-white/30'}`}>{o.hint}</span>}
        </button>
      ))}
    </div>
  )
}

export default function VideoStudio({ onClose, initialPrompt = '' }: { onClose: () => void; initialPrompt?: string }) {
  const [jobs, setJobs] = useState<VideoJob[]>([])
  const [formats, setFormats] = useState<VideoFormat[]>([])
  const [browser, setBrowser] = useState(true)
  const [voices, setVoices] = useState<{ edge: VoiceItem[]; gemini: VoiceItem[]; windows: VoiceItem[] }>({ edge: [], gemini: [], windows: [] })
  const [prompt, setPrompt] = useState(initialPrompt)
  const [formatId, setFormatId] = useState('youtube')
  const [seconds, setSeconds] = useState(30)
  const [fps, setFps] = useState<Fps>(30)
  const [narration, setNarration] = useState<VideoNarration>('auto')
  const [narrationText, setNarrationText] = useState('')
  const [audioPath, setAudioPath] = useState('')
  const [voice, setVoice] = useState<VoiceSelection>({ provider: 'edge', id: 'pt-BR-AntonioNeural' })
  const [music, setMusic] = useState<'auto' | MusicMood>('auto')
  const [direction, setDirection] = useState('')
  const [showDirection, setShowDirection] = useState(false)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [remove, setRemove] = useState<VideoJob | null>(null)
  const [script, setScript] = useState<{ id: string; scenes: Scene[] } | null>(null)
  const [scriptDirty, setScriptDirty] = useState(false)
  const [savingScript, setSavingScript] = useState(false)
  const [pendingOpen, setPendingOpen] = useState<{ next: string | null } | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [studioModel, setStudioModel] = useState<StudioModel>('videos')
  const [variant, setVariant] = useState<Variant>('auto')
  const [brandUrl, setBrandUrl] = useState('')
  const [motionJobs, setMotionJobs] = useState<MotionJob[]>([])
  const [removeMotion, setRemoveMotion] = useState<MotionJob | null>(null)
  const isMotion = studioModel !== 'publicitario'
  const formRef = useRef<HTMLDivElement>(null)
  const prefsReady = useRef(false)

  // Lembra as últimas escolhas do estúdio neste computador (o pedido e os textos não são guardados)
  useEffect(() => {
    try {
      const p = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null') as null | { formatId?: string; seconds?: number; fps?: Fps; narration?: VideoNarration; voice?: VoiceSelection; music?: 'auto' | MusicMood; studioModel?: StudioModel; variant?: Variant }
      if (p) {
        if (p.studioModel && MODELS.some(m => m.id === p.studioModel)) setStudioModel(p.studioModel)
        if (p.variant && (p.variant === 'auto' || KIT_STYLES.includes(p.variant))) setVariant(p.variant)
        if (p.formatId) setFormatId(p.formatId)
        if (p.seconds) setSeconds(p.seconds)
        if (p.fps) setFps(p.fps)
        if (p.narration && p.narration !== 'file') setNarration(p.narration)
        if (p.voice?.provider) setVoice(p.voice)
        if (p.music) setMusic(p.music)
      }
    } catch { /* armazenamento indisponível: usa os padrões */ }
    prefsReady.current = true
  }, [])
  useEffect(() => {
    if (!prefsReady.current) return
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ formatId, seconds, fps, narration, voice, music, studioModel, variant })) } catch { /* ignora */ }
  }, [formatId, seconds, fps, narration, voice, music, studioModel, variant])

  const load = useCallback(async () => {
    try {
      const [d, m] = await Promise.all([
        get<{ jobs: VideoJob[]; browser: boolean; formats: VideoFormat[] }>('/api/video?action=list'),
        get<{ jobs: MotionJob[] }>('/api/motion?action=list').catch(() => ({ jobs: [] as MotionJob[] })),
      ])
      setJobs(d.jobs)
      setMotionJobs(m.jobs)
      setBrowser(d.browser)
      setFormats(d.formats)
    } catch (e) { toast.error((e as Error).message) } finally { setLoaded(true) }
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    get<{ edge: VoiceItem[]; gemini: VoiceItem[]; windows: VoiceItem[] }>('/api/video?action=voices').then(d => setVoices(d)).catch(() => {})
  }, [])
  const active = jobs.some(isRunning) || motionJobs.some(isRunning)
  useEffect(() => {
    if (!active) return
    const t = setInterval(load, 1500)
    return () => clearInterval(t)
  }, [active, load])

  const selectedVoiceOptions = voice.provider === 'edge' ? voices.edge : voice.provider === 'gemini' ? voices.gemini : voices.windows
  const voiceGroups = useMemo(() => {
    const groups = new Map<string, VoiceItem[]>()
    for (const v of selectedVoiceOptions) groups.set(v.gender, [...(groups.get(v.gender) || []), v])
    return [...groups.entries()]
  }, [selectedVoiceOptions])
  const voiceLabel = selectedVoiceOptions.find(v => v.id === voice.id)?.label.replace(/^\w+ · /, '')
    || voice.id.replace(/^pt-BR-/, '').replace(/Neural$/, '') || 'voz do Windows'
  const format = formats.find(f => f.id === formatId)

  // Teste de voz: toca a voz escolhida com o mesmo motor que narra o vídeo
  const [previewText, setPreviewText] = useState('')
  const [previewing, setPreviewing] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewInfo, setPreviewInfo] = useState('')
  const previewRef = useRef<{ audio?: HTMLAudioElement; url?: string; ctrl?: AbortController }>({})
  const stopPreview = useCallback(() => {
    const p = previewRef.current
    p.ctrl?.abort()
    p.audio?.pause()
    if (p.url) URL.revokeObjectURL(p.url)
    previewRef.current = {}
    setPreviewing(false)
    setPreviewLoading(false)
  }, [])
  useEffect(() => stopPreview, [stopPreview])
  const playPreview = useCallback(async () => {
    if (previewing || previewLoading) { stopPreview(); return }
    const ctrl = new AbortController()
    previewRef.current = { ctrl }
    setPreviewLoading(true)
    setPreviewInfo('')
    const t0 = performance.now()
    try {
      const sample = previewText.trim() || narrationText.trim().slice(0, 300) || prompt.trim().slice(0, 160) || ''
      const res = await fetch('/api/video', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'voicePreview', voice, text: sample }), signal: ctrl.signal })
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || `HTTP ${res.status}`)
      const url = URL.createObjectURL(await res.blob())
      const audio = new Audio(url)
      previewRef.current = { ...previewRef.current, audio, url }
      audio.onended = () => setPreviewing(false)
      await audio.play()
      setPreviewing(true)
      setPreviewInfo(`Tocando: ${decodeURIComponent(res.headers.get('X-Voice-Provider') || '')} · pronta em ${((performance.now() - t0) / 1000).toFixed(1).replace('.', ',')} s`)
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setPreviewInfo(`Falhou: ${(e as Error).message}`)
      setPreviewing(false)
    } finally {
      setPreviewLoading(false)
    }
  }, [previewing, previewLoading, stopPreview, previewText, narrationText, prompt, voice])

  // Estimativa da fala escrita: a narração define o tempo das cenas, então um texto longo alonga o vídeo
  const narrationWords = narrationText.trim() ? narrationText.trim().split(/\s+/).length : 0
  const narrationSec = Math.round(narrationWords / WORDS_PER_SEC)
  const narrationLong = narration !== 'none' && narrationWords > 0 && narrationSec > seconds * 1.15

  const canCreate = !busy && !!prompt.trim() && browser && !(narration === 'file' && !audioPath)
  const create = async (extra: Record<string, unknown> = {}) => {
    if (!canCreate) return
    setBusy(true)
    try {
      if (isMotion) {
        // Modelo dos vídeos / Comercial: animação desenhada por código (vertical 1080×1920), com a voz escolhida aqui
        const style: MotionStyle = studioModel === 'comercial' ? 'app-promo' : variant
        const r = await post<{ job: MotionJob }>('/api/motion', {
          action: 'create',
          prompt: direction.trim() ? `${prompt.trim()}\n\nDireção: ${direction.trim()}` : prompt.trim(),
          style, seconds, fps: fps === 60 ? 60 : 30,
          narration: narration === 'auto' ? 'jarvis' : narration,
          narrationText: narrationText.trim() || undefined, audioPath: narration === 'file' ? audioPath : undefined,
          voice: narration === 'auto' ? voice : undefined,
          brandUrl: studioModel === 'comercial' && /^https?:\/\//i.test(brandUrl.trim()) ? brandUrl.trim() : undefined,
        })
        stopPreview()
        setOpen(r.job.id)
        setFilter('all')
        toast.success(studioModel === 'comercial' ? 'Comercial iniciado — roteiro, animação, narração e render' : 'Vídeo iniciado no modelo dos vídeos — roteiro, animação, narração e legenda')
        load()
        return
      }
      const r = await post<{ job: VideoJob }>('/api/video', {
        action: 'create', prompt, formatId, seconds, fps, narration,
        narrationText: narrationText.trim() || undefined, audioPath: narration === 'file' ? audioPath : undefined,
        voice, music: 'nenhum', direction: direction.trim() || undefined, ...extra,
      })
      stopPreview()
      setOpen(r.job.id)
      setFilter('all')
      toast.success('Produção publicitária iniciada — o diretor de IA está cuidando de tudo')
      load()
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }

  const reuseMotion = (j: MotionJob) => {
    const r = j.request
    setStudioModel(r.style === 'app-promo' ? 'comercial' : 'videos')
    if (r.style !== 'app-promo') setVariant(r.style as Variant)
    setPrompt(r.prompt.split('\n\nDireção: ')[0])
    const dir = r.prompt.split('\n\nDireção: ')[1] || ''
    setDirection(dir)
    setShowDirection(!!dir)
    setSeconds(r.seconds)
    setFps(r.fps === 60 ? 60 : 30)
    setNarration(r.narration === 'jarvis' ? 'auto' : r.narration)
    setNarrationText(r.narrationText || '')
    setAudioPath(r.audioPath || '')
    if (r.voice) setVoice(r.voice)
    setBrandUrl(r.brandUrl || '')
    formRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    toast.success('Pedido e modelo copiados para o painel — ajuste e produza de novo')
  }

  const reviseMotion = async (j: MotionJob, feedback: string) => {
    try {
      const r = await post<{ job: MotionJob }>('/api/motion', { action: 'create', parentId: j.id, feedback, prompt: j.request.prompt, style: j.request.style, seconds: j.request.seconds, fps: j.request.fps, narration: 'none' })
      setOpen(r.job.id)
      toast.success('Ajuste pedido — a IA está corrigindo a animação')
      load()
    } catch (e) { toast.error((e as Error).message) }
  }

  const cancelMotion = async (id: string) => {
    try { await post('/api/motion', { action: 'cancel', id }); toast('Produção cancelada') } catch (e) { toast.error((e as Error).message) }
    load()
  }

  const reuse = (j: VideoJob) => {
    setStudioModel('publicitario')
    const r = j.request
    setPrompt(r.prompt)
    setFormatId(r.formatId)
    setSeconds(r.seconds)
    setFps(r.fps)
    setNarration(r.narration)
    setNarrationText(r.narrationText || '')
    setAudioPath(r.audioPath || '')
    setVoice(r.voice)
    setMusic(r.music)
    setDirection(r.direction || '')
    setShowDirection(!!r.direction)
    formRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    toast.success('Configurações copiadas para o painel — ajuste e produza de novo')
  }

  const loadScript = async (id: string) => {
    try {
      const d = await get<{ script: { scenes: Scene[] } }>(`/api/video?action=script&id=${id}`)
      setScript({ id, scenes: d.script.scenes })
      setScriptDirty(false)
    } catch (e) { toast.error((e as Error).message) }
  }

  // Uma produção que termina com o card aberto mostra o roteiro sem precisar fechar e abrir de novo
  const scriptTried = useRef(new Set<string>())
  const openJobDone = jobs.some(j => j.id === open && j.status === 'done')
  useEffect(() => {
    if (!open || !openJobDone || script?.id === open || scriptTried.current.has(open)) return
    scriptTried.current.add(open)
    loadScript(open)
  }, [open, openJobDone, script?.id])

  const doOpen = (next: string | null) => {
    if (next) scriptTried.current.add(next)
    setOpen(next)
    if (next && jobs.find(j => j.id === next)?.status === 'done') loadScript(next)
  }
  // Fechar um card com o roteiro editado e não salvo pede confirmação, em vez de perder as edições
  const requestOpen = (next: string | null) => {
    if (scriptDirty && script && script.id !== next) { setPendingOpen({ next }); return }
    doOpen(next)
  }

  const saveScript = async () => {
    if (!script) return
    setSavingScript(true)
    try {
      await post('/api/video', { action: 'saveScript', id: script.id, scenes: script.scenes })
      setScriptDirty(false)
      toast.success('Roteiro salvo. Regere o vídeo para aplicar as mudanças.')
      load()
    } catch (e) { toast.error((e as Error).message) } finally { setSavingScript(false) }
  }

  const regenerate = async (id: string, scene?: number) => {
    try {
      const r = await post<{ job: VideoJob }>('/api/video', { action: 'regenerate', id, scene })
      toast.success(scene !== undefined ? `Regerando a cena ${scene + 1}…` : 'Regerando o vídeo…')
      scriptTried.current.delete(r.job.id)
      setOpen(r.job.id)
      setScript(null)
      setScriptDirty(false)
      load()
    } catch (e) { toast.error((e as Error).message) }
  }

  const cancel = async (id: string) => {
    try { await post('/api/video', { action: 'cancel', id }); toast('Produção cancelada') } catch (e) { toast.error((e as Error).message) }
    load()
  }

  const sceneAction = async (id: string, action: 'moveScene' | 'deleteScene' | 'duplicateScene', payload: Record<string, number>) => {
    try {
      await post('/api/video', { action, id, ...payload })
      toast.success(action === 'moveScene' ? 'Cena reordenada — regere o vídeo para aplicar' : action === 'deleteScene' ? 'Cena excluída — regere o vídeo para aplicar' : 'Cena duplicada — regere o vídeo para gerar a imagem própria')
      setScriptDirty(false)
      await loadScript(id)
      load()
    } catch (e) { toast.error((e as Error).message) }
  }

  const editScene = (i: number, patch: Partial<Scene>) => {
    if (!script) return
    const scenes = script.scenes.slice()
    scenes[i] = { ...scenes[i], ...patch }
    setScript({ ...script, scenes })
    setScriptDirty(true)
  }

  const pickAudio = async () => {
    const f = await window.electron?.pickFile?.([{ name: 'Áudio', extensions: ['mp3', 'wav', 'm4a', 'ogg', 'aac', 'webm'] }])
    if (f) setAudioPath(f)
    else if (!window.electron?.pickFile) toast.error('Escolher arquivos só funciona no aplicativo JARVIS')
  }

  // Produções publicitárias (cinema) e animadas (modelo dos vídeos / comercial) numa lista só, mais recentes primeiro
  type Entry = { kind: 'cinema'; job: VideoJob } | { kind: 'motion'; job: MotionJob }
  const entries = useMemo<Entry[]>(() => [
    ...jobs.map(job => ({ kind: 'cinema' as const, job })),
    ...motionJobs.map(job => ({ kind: 'motion' as const, job })),
  ].sort((a, b) => b.job.createdAt - a.job.createdAt), [jobs, motionJobs])
  const counts = useMemo(() => ({
    all: entries.length,
    running: entries.filter(e => isRunning(e.job)).length,
    done: entries.filter(e => e.job.status === 'done').length,
    failed: entries.filter(e => isFailed(e.job)).length,
  }), [entries])
  const visibleEntries = useMemo(() => {
    const q = query.trim().toLowerCase()
    return entries.filter(({ job: j }) =>
      (filter === 'all' || (filter === 'running' ? isRunning(j) : filter === 'done' ? j.status === 'done' : isFailed(j)))
      && (!q || `${j.title || ''} ${j.request.prompt}`.toLowerCase().includes(q)))
  }, [entries, filter, query])

  const musicLabel = MUSIC_OPTIONS.find(m => m.id === music)?.label.split(' (')[0] || 'Automática'
  const narrationSummary = narration === 'none' ? 'sem voz' : narration === 'file' ? 'sua gravação' : voiceLabel.split(' (')[0]

  return (
    <Modal onClose={onClose} width="max-w-7xl h-[88vh]">
      {/* ── Cabeçalho ─────────────────────────────────── */}
      <div className="relative flex items-center gap-3 px-5 py-3.5 border-b border-white/5 overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute -top-16 left-10 w-72 h-32 rounded-full bg-fuchsia-500/15 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -top-16 right-40 w-72 h-32 rounded-full bg-cyan-500/10 blur-3xl" />
        <div className="relative w-10 h-10 rounded-xl bg-gradient-to-br from-fuchsia-500/35 to-amber-400/30 border border-fuchsia-400/30 flex items-center justify-center shadow-[0_0_24px_-6px_rgba(217,70,239,.7)]"><Clapperboard size={18} className="text-fuchsia-100" /></div>
        <div className="relative flex-1 min-w-0">
          <div className="text-[15px] font-semibold text-white">Estúdio de Vídeo</div>
          <div className="text-[11px] text-white/45 truncate">3 modelos: vídeos explicativos estilo TikTok, comercial e publicitário — roteiro, narração, legenda e render pela IA</div>
        </div>
        <div className="relative hidden md:flex items-center gap-1.5 text-[10.5px]">
          {counts.running > 0 && <span className="flex items-center gap-1 px-2 py-1 rounded-full bg-fuchsia-500/15 border border-fuchsia-400/25 text-fuchsia-100"><Loader2 size={10} className="animate-spin" /> {counts.running} em produção</span>}
          <span className="flex items-center gap-1 px-2 py-1 rounded-full bg-white/5 border border-white/8 text-white/55"><Film size={10} /> {counts.done} {counts.done === 1 ? 'vídeo pronto' : 'vídeos prontos'}</span>
        </div>
        <button onClick={onClose} aria-label="Fechar o estúdio" className="relative p-1.5 rounded-lg hover:bg-white/5 text-white/45 hover:text-white"><X size={16} /></button>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[430px_1fr] lg:grid-rows-[minmax(0,1fr)] overflow-y-auto lg:overflow-hidden">
        {/* ── Painel de produção ─────────────────────────── */}
        <div className="flex flex-col min-h-0 border-r border-white/5 bg-black/10">
          <div ref={formRef} className="flex-1 min-h-0 lg:overflow-y-auto p-4 space-y-3">
            {!browser && <p className="flex items-start gap-2 text-xs text-amber-100 bg-amber-400/10 border border-amber-400/25 rounded-xl p-2.5"><AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />Instale o Google Chrome ou o Microsoft Edge: eles renderizam os quadros do vídeo.</p>}

            <Section n={1} title="Modelo" icon={<Clapperboard size={12} />}>
              <div role="radiogroup" aria-label="Modelo do vídeo" className="grid grid-cols-3 gap-1.5">
                {MODELS.map(m => (
                  <button key={m.id} role="radio" aria-checked={studioModel === m.id} onClick={() => { setStudioModel(m.id); if (m.id !== 'publicitario' && fps !== 60) setFps(30) }} title={m.desc}
                    className={`text-left rounded-xl border p-2 transition-all duration-200 ${studioModel === m.id ? 'border-fuchsia-400/55 bg-fuchsia-500/15 shadow-[0_0_18px_-6px_rgba(217,70,239,.7)]' : 'border-white/[0.06] bg-black/20 hover:border-white/15'}`}>
                    <ModelThumb id={m.id} />
                    <div className={`mt-1.5 text-[11px] font-semibold leading-tight ${studioModel === m.id ? 'text-white' : 'text-white/70'}`}>{m.label}</div>
                    <div className="text-[9px] text-white/35 leading-tight mt-0.5">{m.tech}</div>
                  </button>
                ))}
              </div>
              <p className="text-[10.5px] text-white/45 mt-2">{MODELS.find(m => m.id === studioModel)!.desc}.</p>
              {studioModel === 'videos' && (
                <div className="mt-2">
                  <div className="text-[10.5px] text-white/45 mb-1">Variação visual</div>
                  <div className="flex flex-wrap gap-1">
                    {(['auto', ...KIT_STYLES] as Variant[]).map(v => (
                      <button key={v} role="radio" aria-checked={variant === v} onClick={() => setVariant(v)} title={v === 'auto' ? 'A IA escolhe pela ideia' : KIT_INFO[v].hint}
                        className={`px-2 py-1 rounded-lg border text-[10.5px] transition-colors ${variant === v ? 'border-cyan-400/55 bg-cyan-500/15 text-white' : 'border-white/[0.06] text-white/55 hover:text-white/85'}`}>
                        {v === 'auto' ? 'Automática' : ({ 'tech-passos': 'Passos', 'tech-news': 'Notícia', 'minimal-dados': 'Dados', 'tech-analogia': 'Analogia' } as const)[v]}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-white/35 mt-1">{variant === 'auto' ? 'A IA escolhe entre passos, notícia, dados e analogia pelo tema.' : KIT_INFO[variant].hint}</p>
                </div>
              )}
              {studioModel === 'comercial' && (
                <label className="block mt-2 text-[10.5px] text-white/45">Site da marca (opcional — cores, fonte e logo)
                  <input value={brandUrl} onChange={e => setBrandUrl(e.target.value)} placeholder="https://suamarca.com.br" spellCheck={false} className="input-jarvis mt-1 w-full px-2.5 py-1.5 rounded-lg text-[11px] font-mono" />
                </label>
              )}
            </Section>

            <Section n={2} title="Ideia" icon={<Lightbulb size={12} />} aside={<span className="text-[9.5px] text-white/30 tabular-nums">{prompt.length} caracteres</span>}>
              <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={4}
                onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); create() } }}
                aria-label="O que você quer produzir"
                placeholder={studioModel === 'videos' ? 'Ex.: 5 ferramentas de IA que todo programador deveria usar, com os comandos para instalar' : studioModel === 'comercial' ? 'Ex.: comercial do app Poupa+: organize os gastos em 2 minutos, metas automáticas. Baixe grátis' : 'Ex.: filme publicitário para a minha cafeteria, do grão à xícara, tom acolhedor'}
                className="input-jarvis w-full px-3 py-2 rounded-xl text-[12.5px] leading-relaxed resize-y min-h-[88px]" />
              <div className="flex flex-wrap gap-1.5 mt-2">
                {EXAMPLES[studioModel].map(ex => (
                  <button key={ex.tag} onClick={() => setPrompt(ex.text)} title={ex.text}
                    className="group flex items-center gap-1 text-[10px] px-2 py-1 rounded-full border border-white/8 bg-white/[0.02] text-white/50 hover:text-white hover:border-fuchsia-400/40 hover:bg-fuchsia-500/10 transition-colors">
                    <Sparkles size={9} className="text-fuchsia-300/60 group-hover:text-fuchsia-200" /> {ex.tag}
                  </button>
                ))}
              </div>
            </Section>

            <Section n={3} title="Formato e tempo" icon={<SlidersHorizontal size={12} />}>
              {isMotion ? (
                <div className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-black/20 px-3 py-2 text-[11px] text-white/70">
                  <RectangleVertical size={16} className="text-fuchsia-200" />
                  <span><b className="text-white">Vertical 1080×1920</b> · TikTok, Reels e Shorts</span>
                </div>
              ) : (
              <div className="grid grid-cols-3 gap-1.5">
                {formats.map(f => (
                  <button key={f.id} onClick={() => setFormatId(f.id)} aria-pressed={formatId === f.id}
                    className={`flex flex-col items-center gap-0.5 px-1 py-2 rounded-xl border text-[10px] transition-all duration-200 ${formatId === f.id ? 'border-fuchsia-400/55 bg-fuchsia-500/15 text-white shadow-[0_0_16px_-6px_rgba(217,70,239,.7)]' : 'border-white/[0.06] bg-black/20 text-white/55 hover:border-white/15 hover:text-white/85'}`}>
                    <span className={formatId === f.id ? 'text-fuchsia-200' : 'text-white/45'}>{ASPECT_ICON[f.aspect]}</span>
                    <span className="leading-tight text-center font-medium">{f.label}</span>
                    <span className="text-[8.5px] text-white/35">{f.hint}</span>
                  </button>
                ))}
                {!formats.length && Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-[62px] rounded-xl bg-white/[0.03] animate-pulse" />)}
              </div>
              )}
              <div className="mt-3 text-[10.5px] text-white/45 mb-1 flex items-center gap-1.5"><Clock size={10} /> Duração</div>
              {(() => { const list = isMotion ? MOTION_DURATIONS : DURATIONS; return (
                <Segmented label="Duração" value={seconds} onChange={setSeconds}
                  options={[...list, ...(list.includes(seconds) ? [] : [seconds])].map(s => ({ v: s, label: `${s}s` }))} />
              ) })()}
              {isMotion && narration === 'auto' && <p className="text-[10px] text-white/35 mt-1">Com narração, o vídeo acompanha o tempo da fala (até 90 s).</p>}
              <div className="mt-2.5 text-[10.5px] text-white/45 mb-1 flex items-center gap-1.5"><Gauge size={10} /> Quadros por segundo</div>
              <Segmented label="Quadros por segundo" value={fps} onChange={setFps} accent="cyan"
                options={(isMotion ? FPS_OPTIONS.filter(o => o.v === 30 || o.v === 60) : FPS_OPTIONS).map(o => ({ v: o.v, label: o.v, hint: o.hint }))} />
            </Section>

            <Section n={4} title={isMotion ? 'Narração' : 'Narração e trilha'} icon={<Mic2 size={12} />}>
              <Segmented label="Narração" value={narration} onChange={v => { setNarration(v); if (v !== 'auto') stopPreview() }} accent="cyan"
                options={[{ v: 'auto' as VideoNarration, label: 'Voz da IA' }, { v: 'none' as VideoNarration, label: 'Sem voz' }, { v: 'file' as VideoNarration, label: 'Minha gravação' }]} />

              {narration === 'auto' && (
                <div className="mt-2.5 rounded-xl border border-cyan-400/15 bg-cyan-500/[0.04] p-2.5 space-y-1.5">
                  <div className="flex gap-1.5">
                    <select aria-label="Motor de voz" value={voice.provider} onChange={e => { stopPreview(); setVoice({ provider: e.target.value as VoiceSelection['provider'], id: e.target.value === 'edge' ? 'pt-BR-AntonioNeural' : e.target.value === 'gemini' ? 'Kore' : '' }) }} className="input-jarvis w-[112px] px-2 py-1.5 rounded-lg text-[11px]">
                      <option value="edge">Edge (grátis)</option>
                      <option value="gemini">Gemini</option>
                      <option value="windows">Windows</option>
                    </select>
                    <select aria-label="Voz" value={voice.id} onChange={e => { stopPreview(); setVoice(v => ({ ...v, id: e.target.value })) }} className="input-jarvis flex-1 min-w-0 px-2 py-1.5 rounded-lg text-[11px]">
                      {!selectedVoiceOptions.some(x => x.id === voice.id) && <option value={voice.id}>{voice.id || 'Padrão do sistema'}</option>}
                      {voiceGroups.map(([gender, list]) => (
                        <optgroup key={gender} label={gender === 'feminina' ? 'Vozes femininas' : gender === 'masculina' ? 'Vozes masculinas' : 'Outras'}>
                          {list.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
                        </optgroup>
                      ))}
                    </select>
                    <motion.button
                      whileTap={{ scale: 0.92 }}
                      onClick={playPreview}
                      title={previewing ? 'Parar o teste' : 'Ouvir esta voz'}
                      aria-label={previewing ? 'Parar o teste de voz' : 'Testar a voz'}
                      className={`relative shrink-0 w-9 rounded-lg border flex items-center justify-center transition-colors ${previewing ? 'border-cyan-300/60 bg-cyan-500/30 text-white' : 'border-cyan-400/40 bg-cyan-500/10 text-cyan-100 hover:bg-cyan-500/25'}`}
                    >
                      {previewing && <span aria-hidden className="absolute inset-0 rounded-lg border border-cyan-300/50 animate-ping" />}
                      {previewLoading ? <Loader2 size={13} className="animate-spin" /> : previewing ? <Square size={11} /> : <Play size={13} />}
                    </motion.button>
                  </div>
                  <input
                    value={previewText}
                    onChange={e => setPreviewText(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') playPreview() }}
                    aria-label="Frase do teste de voz"
                    placeholder="Frase do teste de voz (Enter para ouvir)"
                    className="input-jarvis w-full px-2 py-1.5 rounded-lg text-[11px]"
                  />
                  {previewInfo
                    ? <p role="status" className={`text-[10px] ${previewInfo.startsWith('Falhou') ? 'text-red-300' : 'text-cyan-200/80'}`}>{previewInfo}</p>
                    : <p className="text-[10px] text-white/35">A voz do Edge (grátis) soa natural em pt-BR. A legenda karaokê acompanha palavra por palavra.</p>}
                </div>
              )}

              {narration !== 'none' && (
                <>
                  <textarea value={narrationText} onChange={e => setNarrationText(e.target.value)} rows={2}
                    aria-label="Texto da narração"
                    placeholder={narration === 'auto' ? 'Texto exato da narração (vazio = a IA escreve)' : 'Texto do que você fala na gravação (ajuda a sincronizar)'}
                    className="input-jarvis mt-2 w-full px-3 py-2 rounded-xl text-xs" />
                  {narrationWords > 0 && (
                    <p className={`text-[10px] mt-1 ${narrationLong ? 'text-amber-200' : 'text-white/35'}`}>
                      {narrationWords} palavras · ≈ {narrationSec} s de fala
                      {narrationLong && ` — mais longa que os ${seconds}s escolhidos; a narração dita o tempo, então o vídeo deve ficar mais longo`}
                    </p>
                  )}
                </>
              )}
              {narration === 'file' && (
                <button onClick={pickAudio} className={`mt-2 w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs border transition-colors ${audioPath ? 'border-cyan-400/30 bg-cyan-500/10 text-cyan-50' : 'border-dashed border-white/15 bg-white/[0.03] text-white/65 hover:bg-white/[0.07]'}`}>
                  <FileAudio size={13} /> <span className="truncate">{audioPath ? audioPath.split(/[\\/]/).pop() : 'Escolher arquivo de áudio (mp3, wav, m4a…)'}</span>
                </button>
              )}

              <p className="mt-3 text-[10px] text-white/35 flex items-center gap-1.5"><Music2 size={10} /> Som: só a voz e os efeitos especiais nas transições — sem música de fundo (sem chiado).</p>
            </Section>

            <Section n={5} title="Direção para a IA" icon={<PencilLine size={12} />}
              aside={<button onClick={() => setShowDirection(v => !v)} aria-expanded={showDirection} className="flex items-center gap-1 text-[10px] text-white/45 hover:text-white/80">{showDirection ? <ChevronDown size={11} /> : <ChevronRight size={11} />} {showDirection ? 'ocultar' : direction.trim() ? 'editar' : 'opcional'}</button>}>
              <AnimatePresence initial={false}>
                {showDirection ? (
                  <motion.div key="dir" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                    <textarea value={direction} onChange={e => setDirection(e.target.value)} rows={3}
                      aria-label="Direção para a IA"
                      placeholder="Ex.: público jovem, tom inspirador, sem jargão, termine com 'baixe agora', use metáforas visuais…"
                      className="input-jarvis w-full px-3 py-2 rounded-xl text-xs" />
                  </motion.div>
                ) : (
                  <p className="text-[10px] text-white/35">{direction.trim() ? `“${direction.trim().slice(0, 90)}${direction.trim().length > 90 ? '…' : ''}”` : 'Tom, público-alvo, frases obrigatórias ou o que evitar.'}</p>
                )}
              </AnimatePresence>
            </Section>
          </div>

          {/* ── Resumo + ação ─────────────────────────────── */}
          <div className="p-4 pt-3 border-t border-white/5 bg-gradient-to-t from-black/40 to-transparent space-y-2">
            <div className="flex flex-wrap gap-1 text-[10px]">
              {(isMotion
                ? [studioModel === 'comercial' ? 'Comercial' : variant === 'auto' ? 'Modelo dos vídeos' : KIT_INFO[variant].label, 'Vertical 9:16', `${seconds}s`, `${fps} fps`, narrationSummary]
                : ['Publicitário', format ? `${format.label} · ${format.aspect}` : formatId, `${seconds}s`, `${fps} fps`, narrationSummary, 'voz + efeitos']).map(t => (
                <span key={t} className="px-2 py-0.5 rounded-full bg-white/[0.05] border border-white/[0.07] text-white/60">{t}</span>
              ))}
            </div>
            <motion.button whileTap={{ scale: 0.97 }} disabled={!canCreate} onClick={() => create()}
              className="sweepable glow-cta w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold bg-gradient-to-r from-fuchsia-500 via-purple-500 to-cyan-500 text-white disabled:opacity-40">
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />} Produzir vídeo completo
            </motion.button>
            <p className="text-[9.5px] text-white/30 text-center flex items-center justify-center gap-1.5">
              <Keyboard size={10} /> Ctrl+Enter no campo da ideia também produz
              {!prompt.trim() ? ' · descreva a ideia primeiro' : narration === 'file' && !audioPath ? ' · escolha o arquivo de áudio' : ''}
            </p>
          </div>
        </div>

        {/* ── Produções ─────────────────────────────────── */}
        <div className="flex flex-col min-h-0">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-white/5">
            <div role="tablist" aria-label="Filtrar produções" className="flex gap-1 p-0.5 rounded-xl bg-black/30 border border-white/[0.06]">
              {([['all', 'Todas'], ['running', 'Em produção'], ['done', 'Prontas'], ['failed', 'Falhas']] as const).map(([id, label]) => (
                <button key={id} role="tab" aria-selected={filter === id} onClick={() => setFilter(id)}
                  className={`relative px-2.5 py-1 rounded-lg text-[11px] transition-colors ${filter === id ? 'text-white' : 'text-white/45 hover:text-white/75'}`}>
                  {filter === id && <motion.span layoutId="studio-filter" className="absolute inset-0 rounded-lg bg-white/[0.09] border border-white/10" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
                  <span className="relative">{label} <span className="text-white/35 tabular-nums">{counts[id]}</span></span>
                </button>
              ))}
            </div>
            <div className="relative flex-1 min-w-[160px]">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/30" />
              <input value={query} onChange={e => setQuery(e.target.value)} aria-label="Buscar produções" placeholder="Buscar por título ou pedido"
                className="input-jarvis w-full pl-7 pr-2 py-1.5 rounded-lg text-[11px]" />
            </div>
          </div>

          <div className="flex-1 min-h-0 lg:overflow-y-auto p-4 space-y-2.5">
            {!loaded && Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-[76px] rounded-2xl bg-white/[0.03] animate-pulse" />)}
            {loaded && !entries.length && (
              <div className="h-full min-h-[280px] flex flex-col items-center justify-center text-center text-white/35 text-xs">
                <div className="relative mb-3">
                  <div aria-hidden className="absolute inset-0 rounded-full bg-fuchsia-500/20 blur-xl" />
                  <Clapperboard className="relative text-fuchsia-200/70" size={34} />
                </div>
                <div className="text-sm text-white/70 font-medium mb-1">Nenhuma produção ainda</div>
                Descreva a ideia ao lado ou peça um vídeo no chat.<br />Cada produção fica aqui com MP4, legendas e roteiro editável.
              </div>
            )}
            {loaded && entries.length > 0 && !visibleEntries.length && (
              <div className="py-16 text-center text-xs text-white/35">Nenhuma produção neste filtro{query.trim() ? ` com “${query.trim()}”` : ''}.</div>
            )}
            {visibleEntries.map(entry => {
              if (entry.kind === 'motion') {
                const mj = entry.job
                return <MotionCard key={mj.id} job={mj} expanded={open === mj.id} onToggle={() => requestOpen(open === mj.id ? null : mj.id)}
                  onCancel={() => cancelMotion(mj.id)} onDelete={() => setRemoveMotion(mj)} onReuse={() => reuseMotion(mj)} onRevise={fb => reviseMotion(mj, fb)} />
              }
              const j = entry.job
              const expanded = open === j.id
              const running = isRunning(j)
              const jobFormat = formats.find(f => f.id === j.formatId)
              const wide = (jobFormat?.aspect ?? '16:9') === '16:9'
              const meta = [jobFormat?.label, j.durationSec ? `${j.durationSec.toFixed(1).replace('.', ',')} s` : '', fmtMB(j.sizeBytes), j.model ? j.model.split('|').pop() : ''].filter(Boolean)
              return (
                <motion.div key={j.id} layout="position"
                  className={`rounded-2xl border overflow-hidden transition-colors ${expanded ? 'border-fuchsia-400/25 bg-white/[0.035] shadow-[0_8px_40px_-20px_rgba(217,70,239,.5)]' : 'border-white/[0.07] bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.03]'}`}>
                  <button onClick={() => requestOpen(expanded ? null : j.id)} aria-expanded={expanded} className="w-full text-left px-3.5 py-3 flex items-center gap-3">
                    <div className={`relative ${wide ? 'w-24 h-[54px]' : 'w-10 h-[68px]'} rounded-lg bg-black/50 overflow-hidden flex-shrink-0 border border-white/5`}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- local render previews */}
                      {j.previews[0] ? <img src={file(j, j.previews[0])} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-white/15"><Film size={16} /></div>}
                      {j.status === 'done' && <div className="absolute inset-0 flex items-center justify-center bg-black/25 opacity-0 hover:opacity-100 transition-opacity"><Play size={16} className="text-white drop-shadow" /></div>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[13px] font-medium text-white truncate">{j.title || j.request.prompt}</span>
                        {j.qa && (j.qa.ok
                          ? <span title="QA aprovado"><ShieldCheck size={13} className="text-emerald-400 flex-shrink-0" /></span>
                          : <span title={j.qa.issues.join('\n')}><AlertTriangle size={13} className="text-amber-400 flex-shrink-0" /></span>)}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
                        <StatusBadge job={j} />
                        <span className={`text-[10.5px] truncate ${j.status === 'failed' ? 'text-red-300/90' : 'text-white/45'}`}>
                          {j.status === 'failed' ? j.error : running ? j.stage : meta.join(' · ')}
                        </span>
                      </div>
                      {running && <PipelineSteps progress={j.progress} />}
                    </div>
                    <span className="text-[10px] text-white/30 text-right leading-tight flex-shrink-0">{fmtDate(j.createdAt)}{j.finishedAt && j.status === 'done' ? <><br />em {fmtSpan(j.finishedAt - j.createdAt)}</> : null}</span>
                    <ChevronDown size={14} className={`text-white/30 flex-shrink-0 transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`} />
                  </button>
                  <AnimatePresence initial={false}>
                    {expanded && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }} className="overflow-hidden">
                        <div className={`px-3.5 pb-4 pt-1 grid grid-cols-1 ${wide ? 'md:grid-cols-[minmax(0,360px)_1fr]' : 'md:grid-cols-[minmax(0,250px)_1fr]'} gap-4 border-t border-white/[0.05]`}>
                          <div className="pt-3">
                            {j.status === 'done' && j.output
                              ? <video key={j.id} src={file(j, j.output)} controls className={`w-full rounded-xl bg-black border border-white/5 ${wide ? 'aspect-video' : 'aspect-[9/16] max-h-[460px] mx-auto'}`} />
                              : j.previews.length
                                ? <div className="grid grid-cols-3 gap-1">{j.previews.map(p => (
                                    /* eslint-disable-next-line @next/next/no-img-element -- local render previews */
                                    <img key={p} src={file(j, p)} alt="" className={`rounded-md object-cover bg-black ${wide ? 'aspect-video' : 'aspect-[9/16]'}`} />
                                  ))}</div>
                                : <div className={`rounded-xl bg-black/40 border border-white/5 flex flex-col items-center justify-center gap-2 text-[11px] text-white/35 ${wide ? 'aspect-video' : 'aspect-[9/16] max-h-[300px]'}`}>
                                    {running ? <Loader2 size={18} className="animate-spin text-fuchsia-300/70" /> : <Film size={18} />}
                                    {running ? 'As cenas aparecem aqui assim que forem geradas' : 'Sem cenas geradas'}
                                  </div>}
                            <div className="flex gap-1.5 mt-2.5 flex-wrap">
                              {j.status === 'done' && <a href={file(j, 'video.mp4', true)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-gradient-to-r from-cyan-500/25 to-fuchsia-500/20 border border-cyan-400/25 text-white hover:brightness-125"><Download size={12} /> Baixar MP4</a>}
                              {j.status === 'done' && <a href={file(j, 'legendas.srt', true)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] bg-white/5 text-white/70 hover:bg-white/10"><Download size={12} /> .srt</a>}
                              {j.status === 'done' && <a href={file(j, 'legendas.vtt', true)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] bg-white/5 text-white/70 hover:bg-white/10"><Download size={12} /> .vtt</a>}
                              {j.status === 'done' && <a href={file(j, 'qa.json')} target="_blank" rel="noreferrer" className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] bg-white/5 text-white/70 hover:bg-white/10"><ShieldCheck size={12} /> Relatório QA</a>}
                              {running && <button onClick={() => cancel(j.id)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] bg-white/5 text-white/70 hover:bg-red-500/15 hover:text-red-200"><Square size={12} /> Cancelar</button>}
                              {!running && <button onClick={() => regenerate(j.id)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] bg-fuchsia-500/15 text-fuchsia-100 hover:bg-fuchsia-500/25"><RotateCcw size={12} /> Regerar vídeo</button>}
                              <button onClick={() => reuse(j)} title="Copia o pedido e as configurações desta produção para o painel" className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] bg-white/5 text-white/70 hover:bg-white/10"><Repeat size={12} /> Reusar configurações</button>
                              {!running && <button onClick={() => setRemove(j)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] text-red-300/75 hover:bg-red-500/10"><Trash2 size={12} /> Apagar</button>}
                            </div>
                            {j.status === 'done' && j.qa && (j.qa.issues.length > 0 || j.qa.warnings.length > 0) && (
                              <div className="mt-2.5 rounded-xl border border-amber-500/20 bg-amber-500/5 p-2.5 text-[10.5px] text-amber-100/90 space-y-0.5">
                                <div className="text-[9.5px] uppercase tracking-wider text-amber-200/70 mb-1">Revisão automática</div>
                                {j.qa.issues.map((x, i) => <div key={`i${i}`}>⚠ {x}</div>)}
                                {j.qa.warnings.map((x, i) => <div key={`w${i}`} className="text-amber-200/60">• {x}</div>)}
                              </div>
                            )}
                          </div>
                          <div className="pt-3 space-y-2.5 min-w-0">
                            {j.status === 'done' && script && script.id === j.id && (
                              <div className="rounded-xl border border-white/8 bg-black/30 p-2.5 space-y-2 max-h-[380px] overflow-y-auto">
                                <div className="sticky -top-2.5 z-10 -mx-2.5 -mt-2.5 px-3.5 py-2 flex items-center justify-between bg-[#0b1220]/95 backdrop-blur border-b border-white/5">
                                  <div className="text-[10px] uppercase tracking-wider text-white/50 flex items-center gap-1.5"><PencilLine size={10} /> Roteiro editável · {script.scenes.length} cenas</div>
                                  <div className="flex items-center gap-1.5">
                                    {scriptDirty && <span className="text-[9.5px] text-amber-300">alterações não salvas</span>}
                                    <button onClick={saveScript} disabled={!scriptDirty || savingScript} className="text-[10px] px-2.5 py-1 rounded-md bg-cyan-500/20 text-cyan-50 hover:bg-cyan-500/30 disabled:opacity-40">{savingScript ? 'Salvando…' : 'Salvar roteiro'}</button>
                                  </div>
                                </div>
                                {script.scenes.map((s, i) => (
                                  <div key={i} className="group rounded-lg border border-white/5 bg-white/[0.02] p-2 hover:border-white/10 transition-colors">
                                    <div className="flex items-center justify-between gap-2 mb-1">
                                      <span className="text-[9.5px] uppercase tracking-wider text-fuchsia-200/80 truncate"><span className="text-white/40">{i + 1}.</span> {s.name} · {s.camera}{s.durationSec ? ` · ${s.durationSec}s` : ''}</span>
                                      <div className="flex items-center gap-0.5 flex-shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
                                        <button onClick={() => sceneAction(j.id, 'moveScene', { from: i, to: i - 1 })} disabled={i === 0} title="Mover para cima" aria-label={`Mover a cena ${i + 1} para cima`} className="text-[11px] text-white/45 hover:text-white disabled:opacity-20 px-1">↑</button>
                                        <button onClick={() => sceneAction(j.id, 'moveScene', { from: i, to: i + 1 })} disabled={i === script.scenes.length - 1} title="Mover para baixo" aria-label={`Mover a cena ${i + 1} para baixo`} className="text-[11px] text-white/45 hover:text-white disabled:opacity-20 px-1">↓</button>
                                        <button onClick={() => sceneAction(j.id, 'duplicateScene', { index: i })} title="Duplicar esta cena" aria-label={`Duplicar a cena ${i + 1}`} className="text-white/45 hover:text-cyan-200 px-1"><Copy size={10} /></button>
                                        <button onClick={() => sceneAction(j.id, 'deleteScene', { index: i })} title="Excluir esta cena" aria-label={`Excluir a cena ${i + 1}`} className="text-white/45 hover:text-red-300 px-1"><Trash2 size={10} /></button>
                                        <button onClick={() => regenerate(j.id, i)} title="Gerar uma nova imagem para esta cena" className="text-[9.5px] text-white/50 hover:text-fuchsia-200 flex items-center gap-1 px-1"><RotateCcw size={9} /> nova imagem</button>
                                      </div>
                                    </div>
                                    <textarea rows={2} value={s.vo} onChange={e => editScene(i, { vo: e.target.value })} aria-label={`Narração da cena ${i + 1}`}
                                      className="input-jarvis w-full px-2 py-1 rounded-md text-[11px] mb-1" />
                                    <textarea rows={1} value={s.visual} onChange={e => editScene(i, { visual: e.target.value })} aria-label={`Prompt visual da cena ${i + 1}`}
                                      placeholder="prompt visual (inglês)" className="input-jarvis w-full px-2 py-1 rounded-md text-[10px] text-white/60" />
                                  </div>
                                ))}
                                <p className="text-[9.5px] text-white/35 px-1">Editar a narração refaz a voz e as legendas. Editar o prompt visual gera uma nova imagem. Depois clique em “Regerar vídeo”.</p>
                              </div>
                            )}
                            <details open={j.status !== 'done'} className="group/log rounded-xl border border-white/5 bg-black/40">
                              <summary className="cursor-pointer select-none list-none px-2.5 py-1.5 text-[10px] uppercase tracking-wider text-white/45 flex items-center gap-1.5 hover:text-white/70">
                                <ScrollText size={10} /> Registro da produção <span className="text-white/25 normal-case tracking-normal">({j.log.length})</span>
                                <ChevronDown size={11} className="ml-auto transition-transform group-open/log:rotate-180" />
                              </summary>
                              <div className="px-2.5 pb-2 max-h-44 overflow-y-auto font-mono text-[10px] text-white/55 space-y-0.5">
                                {j.log.map((l, i) => <div key={i}><span className="text-white/25">{new Date(l.at).toLocaleTimeString('pt-BR')}</span> {l.text}</div>)}
                                {!j.log.length && <div>Aguardando…</div>}
                              </div>
                            </details>
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
      </div>

      <AnimatePresence>
        {removeMotion && (
          <ConfirmDialog title="Apagar esta produção?" confirmLabel="Apagar" onClose={() => setRemoveMotion(null)}
            onConfirm={async () => {
              try { await post('/api/motion', { action: 'delete', id: removeMotion.id }); if (open === removeMotion.id) setOpen(null); toast.success('Produção apagada') } catch (e) { toast.error((e as Error).message) }
              load()
            }}>
            <p>O MP4 e a animação de “{removeMotion.title || removeMotion.request.prompt.slice(0, 60)}” serão apagados. Isso não pode ser desfeito.</p>
          </ConfirmDialog>
        )}
        {remove && (
          <ConfirmDialog title="Apagar esta produção?" confirmLabel="Apagar" onClose={() => setRemove(null)}
            onConfirm={async () => {
              try { await post('/api/video', { action: 'delete', id: remove.id }); if (open === remove.id) setOpen(null); toast.success('Produção apagada') } catch (e) { toast.error((e as Error).message) }
              load()
            }}>
            <p>O MP4, as cenas, as legendas e o roteiro de “{remove.title || remove.request.prompt.slice(0, 60)}” serão apagados. Isso não pode ser desfeito.</p>
          </ConfirmDialog>
        )}
        {pendingOpen && (
          <ConfirmDialog title="Descartar as edições do roteiro?" confirmLabel="Descartar" onClose={() => setPendingOpen(null)}
            onConfirm={() => { const next = pendingOpen.next; setScriptDirty(false); setScript(null); setPendingOpen(null); doOpen(next) }}>
            <p>Você alterou o roteiro e não salvou. Se continuar, essas mudanças serão perdidas. Para mantê-las, cancele e clique em “Salvar roteiro”.</p>
          </ConfirmDialog>
        )}
      </AnimatePresence>
    </Modal>
  )
}
