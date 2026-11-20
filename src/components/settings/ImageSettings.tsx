'use client'

import { useEffect, useState } from 'react'
import { KeyRound, Loader2, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import type { Prefs } from './usePrefs'
import type { Aspect, GeneratedImage } from '@/lib/media/images'

type Status = Record<'nvidia' | 'gemini' | 'pollinations', { configured: boolean; blocked?: string }>

const PROVIDERS: Array<{ id: Prefs['images']['provider']; label: string; hint: string }> = [
  { id: 'auto', label: 'Automático', hint: 'FLUX da NVIDIA quando houver chave; depois Gemini; por último o gerador grátis. Nunca gasta créditos pagos sozinho.' },
  { id: 'nvidia', label: 'NVIDIA FLUX', hint: 'Imagens nítidas e sem marca d’água (FLUX.1-dev), com a mesma chave nvapi- do chat. Grátis.' },
  { id: 'gemini', label: 'Google Gemini', hint: 'Melhor qualidade e texto legível nas imagens. Grátis (há cota diária no AI Studio).' },
  { id: 'pollinations', label: 'Grátis (Pollinations)', hint: 'Sem chave e sem custo, qualidade média e com marca d’água.' },
]
const STYLES = ['fotorrealista', 'cinematográfico', 'anime', '3D estilo Pixar', 'aquarela', 'ilustração flat minimalista', 'cyberpunk neon']
const ASPECTS: Array<[Aspect, string]> = [['1:1', 'Quadrado'], ['4:5', 'Feed'], ['9:16', 'Stories/Reels'], ['16:9', 'Horizontal']]

export default function ImageSettings({ prefs, set, onOpenKeys }: { prefs: Prefs; set: (patch: Partial<Prefs>) => Promise<void>; onOpenKeys: () => void }) {
  const im = prefs.images
  const [status, setStatus] = useState<Status | null>(null)
  const [style, setStyle] = useState(im.style)
  const [prompt, setPrompt] = useState('um astronauta tomando café numa cafeteria em Belém do Pará, fim de tarde')
  const [aspect, setAspect] = useState<Aspect>('4:5')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<GeneratedImage | null>(null)
  const load = () => fetch('/api/media?action=providers', { cache: 'no-store' }).then(r => r.json()).then(d => setStatus(d.providers)).catch(() => {})
  useEffect(() => { load() }, [])
  useEffect(() => setStyle(im.style), [im.style])
  const images = (patch: Partial<Prefs['images']>) => set({ images: { ...im, ...patch } })

  const state = (id: Prefs['images']['provider']) => {
    if (!status || id === 'auto') return null
    const s = status[id]
    if (!s.configured) return <span className="text-amber-300/80">sem chave</span>
    if (s.blocked) return <span className="text-amber-300/80" title={s.blocked}>sem cota agora</span>
    return <span className="text-emerald-300/80">pronto</span>
  }

  const test = async () => {
    setBusy(true)
    setResult(null)
    try {
      const res = await fetch('/api/media', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, aspect }) })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setResult(d.image)
      load()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="text-[11px] text-white/45">No chat: “gere uma imagem de…”, “crie 4 variações de…”, “imagem vertical para stories…”, “banner horizontal do YouTube…”.</div>
      <div>
        <div className="text-xs text-white/80 mb-1.5">Gerador de imagens</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {PROVIDERS.map(p => (
            <button key={p.id} onClick={() => p.id !== im.provider && images({ provider: p.id })} className={`text-left rounded-lg border px-3 py-2 ${im.provider === p.id ? 'border-cyan-400/50 bg-cyan-500/10' : 'border-white/10 hover:border-white/25'}`}>
              <div className="flex items-center gap-2 text-xs text-white">{p.label}<span className="ml-auto text-[10px]">{state(p.id)}</span></div>
              <div className="text-[10px] text-white/40 mt-0.5">{p.hint}</div>
            </button>
          ))}
        </div>
        {status?.gemini.blocked && <div className="text-[11px] text-amber-200/80 mt-1.5">Gemini: {status.gemini.blocked}.</div>}
        {!status?.gemini.configured && (
          <button onClick={onOpenKeys} className="mt-2 flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px] bg-white/5 text-white/70 hover:bg-white/10"><KeyRound size={12} /> Gerenciar chaves</button>
        )}
      </div>

      <div>
        <div className="text-xs text-white/80 mb-1.5">Estilo padrão (opcional)</div>
        <input value={style} onChange={e => setStyle(e.target.value)} onBlur={() => style !== im.style && images({ style })} placeholder="Ex.: fotorrealista, cores vibrantes" maxLength={200} className="input-jarvis w-full px-3 py-2 rounded-lg text-sm" />
        <div className="flex flex-wrap gap-1 mt-1.5">
          {STYLES.map(s => <button key={s} onClick={() => { setStyle(s); images({ style: s }) }} className="px-2 py-0.5 rounded-full text-[10px] bg-white/5 text-white/55 hover:text-white hover:bg-white/10">{s}</button>)}
          {im.style && <button onClick={() => { setStyle(''); images({ style: '' }) }} className="px-2 py-0.5 rounded-full text-[10px] text-white/35 hover:text-white">limpar</button>}
        </div>
        <div className="text-[11px] text-white/35 mt-1">O JARVIS reescreve o seu pedido como um prompt detalhado (assunto, luz, composição, estilo) antes de gerar.</div>
      </div>

      <div className="rounded-xl border border-white/10 p-3 space-y-2">
        <div className="text-xs text-white/80">Gerar uma imagem de teste</div>
        <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={2} className="input-jarvis w-full px-3 py-2 rounded-lg text-sm resize-none" />
        <div className="flex flex-wrap items-center gap-1.5">
          {ASPECTS.map(([a, label]) => <button key={a} onClick={() => setAspect(a)} className={`px-2 py-1 rounded text-[11px] ${aspect === a ? 'bg-cyan-500/20 text-cyan-100' : 'text-white/45 hover:text-white'}`}>{label} {a}</button>)}
          <button onClick={test} disabled={busy || !prompt.trim()} className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-cyan-500/15 text-cyan-100 border border-cyan-500/25 hover:bg-cyan-500/25 disabled:opacity-40">{busy ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />} Gerar</button>
        </div>
        {result && (
          <div className="flex gap-3 items-start">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/media?image=${result.id}`} alt={result.prompt} className="w-40 rounded-lg border border-white/10" />
            <div className="text-[11px] text-white/50 space-y-1 min-w-0">
              <div className="text-white/80">{result.provider} · {result.width}×{result.height}</div>
              {result.fallbacks?.map(f => <div key={f} className="text-amber-200/70">pulado — {f}</div>)}
              <div className="break-words">Prompt: “{result.englishPrompt}”</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
