'use client'

import { useEffect, useMemo, useState } from 'react'
import { Check, KeyRound, Loader2, Play, Square, Volume2 } from 'lucide-react'
import { toast } from 'sonner'
import { useSpeech, type SpeakRequest } from '@/components/voice/useSpeech'
import type { Prefs } from './usePrefs'
import type { TtsModel, VoiceInfo as GeminiVoiceInfo } from '@/lib/voice/gemini'
import type { VoiceInfo as PiperVoiceInfo } from '@/lib/voice/piper'

const STYLE_IDEAS = ['animado e confiante', 'calmo e profissional', 'narrador de documentário', 'amigável, como numa conversa', 'locutor de rádio', 'sussurrando, misterioso', 'rápido e energético']

export default function VoiceSettings({ prefs, set, onOpenKeys }: { prefs: Prefs; set: (patch: Partial<Prefs>) => Promise<void>; onOpenKeys: () => void }) {
  const v = prefs.voice
  const [voices, setVoices] = useState<(GeminiVoiceInfo | PiperVoiceInfo)[]>([])
  const [models, setModels] = useState<TtsModel[]>([])
  const [configured, setConfigured] = useState(true)
  const [modelsError, setModelsError] = useState('')
  const [gender, setGender] = useState<'todas' | 'feminina' | 'masculina'>('todas')
  const [style, setStyle] = useState(v.style)
  const [sample, setSample] = useState('Bom dia! Hoje você tem duas provas e um trabalho para entregar. Quer que eu organize sua semana?')
  const speech = useSpeech()

  useEffect(() => {
    fetch('/api/voice', { cache: 'no-store' }).then(r => r.json()).then(d => {
      setVoices(d.voices || [])
      setModels(d.models || [])
      setConfigured(!!d.geminiConfigured)
      setModelsError(d.modelsError || '')
    }).catch(e => setModelsError((e as Error).message))
  }, [])
  useEffect(() => setStyle(v.style), [v.style])

  const shown = useMemo(() => voices.filter(x => gender === 'todas' || (x as GeminiVoiceInfo | PiperVoiceInfo).gender === gender), [voices, gender])
  const voice = (patch: Partial<Prefs['voice']>) => set({ voice: { ...v, ...patch } })
  const play = async (key: string, req: SpeakRequest) => {
    try {
      const r = await speech.toggle(key, { model: v.model, style: v.style, provider: v.provider, ...req })
      if (r?.note) toast.message(`Tocando com ${r.provider}`, { description: r.note })
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast.error((e as Error).message)
    }
  }
  const icon = (key: string, size = 12) => speech.key === key ? (speech.loading ? <Loader2 size={size} className="animate-spin" /> : <Square size={size} />) : <Play size={size} />

  return (
    <div className="space-y-4">
      <div className="text-[11px] text-white/45">A voz escolhida lê as respostas do chat (botão 🔊 em cada resposta) e narra os vídeos do Estúdio Motion.</div>

      <div>
        <div className="text-xs text-white/80 mb-1.5">Mecanismo de voz</div>
        <div className="flex gap-1.5 flex-wrap">
          {([['gemini', 'Vozes do Gemini (naturais)'], ['windows', 'Voz do Windows (offline)']] as const).map(([id, label]) => (
            <button key={id} onClick={() => id !== v.provider && voice({ provider: id })} className={`px-3 py-1.5 rounded-lg text-xs border ${v.provider === id ? 'border-cyan-400/50 bg-cyan-500/10 text-white' : 'border-white/10 text-white/50 hover:text-white/80'}`}>{label}</button>
          ))}
        </div>
        {v.provider === 'gemini' && !configured && (
          <button onClick={onOpenKeys} className="mt-2 flex items-center gap-2 px-3 py-2 rounded-lg text-xs bg-amber-500/10 text-amber-100 border border-amber-500/25"><KeyRound size={13} /> Conecte a chave do Gemini (grátis) para usar estas vozes</button>
        )}
        <div className="text-[11px] text-white/35 mt-1">Se o Gemini falhar ou a cota grátis acabar, o JARVIS usa a voz do Windows automaticamente.</div>
      </div>

      {v.provider === 'gemini' && <>
        <div>
          <div className="text-xs text-white/80 mb-1.5">Modelo de voz</div>
          <select value={v.model} onChange={e => voice({ model: e.target.value })} className="input-jarvis w-full px-3 py-2 rounded-lg text-sm">
            {!models.some(m => m.id === v.model) && <option value={v.model}>{v.model}</option>}
            {models.map(m => <option key={m.id} value={m.id}>{m.label} — {m.id}</option>)}
          </select>
          <div className="text-[11px] text-white/35 mt-1">{modelsError ? `Não consegui listar os modelos: ${modelsError}` : `${models.length} modelo(s) de voz disponíveis na sua chave. Os mais novos soam mais naturais; os "Lite" respondem mais rápido.`}</div>
        </div>

        <div>
          <div className="flex items-center gap-2 mb-2">
            <div className="text-xs text-white/80 flex-1">Voz — <span className="text-cyan-200">{v.voice}</span></div>
            {(['todas', 'feminina', 'masculina'] as const).map(g => (
              <button key={g} onClick={() => setGender(g)} className={`px-2 py-0.5 rounded text-[11px] ${gender === g ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/70'}`}>{g === 'todas' ? 'Todas' : g === 'feminina' ? 'Femininas' : 'Masculinas'}</button>
            ))}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-72 overflow-y-auto pr-1">
            {shown.map(x => {
              const selected = x.id === v.voice
              const key = `preview-${x.id}`
              return (
                <div key={x.id} className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 cursor-pointer transition-colors ${selected ? 'border-cyan-400/50 bg-cyan-500/10' : 'border-white/10 hover:border-white/25 bg-white/[0.02]'}`} onClick={() => !selected && voice({ voice: x.id })}>
                  <button onClick={e => { e.stopPropagation(); play(key, { preview: true, voice: x.id }) }} title={`Ouvir ${x.id}`} className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${speech.key === key ? 'bg-cyan-500 text-black' : 'bg-white/10 text-white/80 hover:bg-cyan-500/30'}`}>{icon(key)}</button>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-white truncate">{x.id}</div>
                    <div className="text-[10px] text-white/40 truncate">{'style' in x ? x.style : 'offline'} · {x.gender}</div>
                  </div>
                  {selected && <Check size={13} className="text-cyan-300 flex-shrink-0" />}
                </div>
              )
            })}
          </div>
        </div>

        <div>
          <div className="text-xs text-white/80 mb-1.5">Jeito de falar (opcional)</div>
          <input value={style} onChange={e => setStyle(e.target.value)} onBlur={() => style !== v.style && voice({ style })} placeholder="Ex.: animado e confiante" maxLength={200} className="input-jarvis w-full px-3 py-2 rounded-lg text-sm" />
          <div className="flex flex-wrap gap-1 mt-1.5">
            {STYLE_IDEAS.map(s => <button key={s} onClick={() => { setStyle(s); voice({ style: s }) }} className="px-2 py-0.5 rounded-full text-[10px] bg-white/5 text-white/55 hover:text-white hover:bg-white/10">{s}</button>)}
            {v.style && <button onClick={() => { setStyle(''); voice({ style: '' }) }} className="px-2 py-0.5 rounded-full text-[10px] text-white/35 hover:text-white">limpar</button>}
          </div>
          <div className="text-[11px] text-white/35 mt-1">O estilo muda a entonação; ele não é lido em voz alta.</div>
        </div>
      </>}

      <div>
        <div className="text-xs text-white/80 mb-1.5">Testar com o seu texto</div>
        <div className="flex gap-2">
          <textarea value={sample} onChange={e => setSample(e.target.value)} rows={2} maxLength={600} className="input-jarvis flex-1 px-3 py-2 rounded-lg text-sm resize-none" />
          <button onClick={() => play('sample', { text: sample, voice: v.voice })} disabled={!sample.trim()} className="px-3 rounded-lg text-xs bg-cyan-500/15 text-cyan-100 border border-cyan-500/25 hover:bg-cyan-500/25 flex items-center gap-1.5 disabled:opacity-40">{speech.key === 'sample' ? icon('sample', 13) : <Volume2 size={13} />} Ouvir</button>
        </div>
      </div>

      <button onClick={() => voice({ autoRead: !v.autoRead })} className="w-full flex items-start gap-3 text-left group">
        <div className="flex-1">
          <div className="text-xs text-white/80 group-hover:text-white">Ler as respostas em voz alta automaticamente</div>
          <div className="text-[11px] text-white/35 mt-0.5">Desligado: use o botão 🔊 em cada resposta quando quiser ouvir.</div>
        </div>
        <div className={`mt-0.5 w-9 h-5 rounded-full flex-shrink-0 transition-colors ${v.autoRead ? 'bg-cyan-500' : 'bg-white/10'}`}>
          <span className={`block w-4 h-4 rounded-full bg-white m-0.5 transition-all ${v.autoRead ? 'ml-[18px]' : ''}`} />
        </div>
      </button>
    </div>
  )
}
