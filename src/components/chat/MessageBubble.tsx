'use client'

import { useEffect, useRef, useState } from 'react'
import { Copy, Loader2, Pencil, RefreshCw, Square, Volume2 } from 'lucide-react'
import { toast } from 'sonner'
import { playSpeech, useSpeech } from '@/components/voice/useSpeech'
import { usePrefs } from '@/components/settings/usePrefs'
import JarvisLogo from './JarvisLogo'
import Markdown from './Markdown'
import ReasoningPanel from './ReasoningPanel'

const fmtMs = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1).replace('.', ',')} s`)
import MotionJobInline from '@/components/motion/MotionJobInline'
import VideoJobInline from '@/components/video/VideoJobInline'
import DocumentInline from '@/components/docs/DocumentInline'
import TopologyInline from '@/components/netlab/TopologyInline'
import { extractAll } from '@/lib/motion/inline'
import { extractAllTags } from '@/lib/ai/inline'
import InlineImageInline from '@/components/chat/InlineImageInline'
import type { Message } from '@/types'

export default function MessageBubble({ msg, onCopy, streaming = false, onEdit, onRegenerate }: {
  msg: Message
  onCopy: (t: string) => void
  streaming?: boolean
  /** Só vem quando a mensagem pode ser editada (tem id real no servidor). */
  onEdit?: (msg: Message, texto: string) => void
  /** Só vem na última resposta, quando dá para refazê-la. */
  onRegenerate?: (msg: Message) => void
}) {
  const [editando, setEditando] = useState(false)
  const [rascunho, setRascunho] = useState(msg.content)
  const isUser = msg.role === 'user'
  const isUserMsg = msg.role === 'user'
  const { clean: extractedClean, videoJobs, imageJobs } = extractAllTags(msg.content)
  const { motionJobs, documents, topologies } = extractAll(msg.content)
  const clean = isUserMsg ? msg.content : extractedClean
  const videoJobsFromMsg = isUserMsg ? [] as string[] : videoJobs
  const imageJobsFromMsg = isUserMsg ? [] as string[] : imageJobs
  const motionJobsFromMsg = isUserMsg ? [] as string[] : motionJobs
  const documentsFromMsg = isUserMsg ? [] as string[] : documents
  const topologiesFromMsg = isUserMsg ? [] as string[] : topologies
  const speech = useSpeech()
  const [prefs] = usePrefs()
  const speechKey = `msg-${msg.id}`
  const wasStreaming = useRef(streaming)
  // Auto-read: only an answer that just finished streaming (never old messages on reload)
  useEffect(() => {
    if (wasStreaming.current && !streaming && !isUser && clean.trim() && prefs?.voice.autoRead) {
      playSpeech(speechKey, { text: clean }).catch(e => { if ((e as Error).name !== 'AbortError') toast.error(`Voz: ${(e as Error).message}`) })
    }
    wasStreaming.current = streaming
  }, [streaming, isUser, clean, prefs?.voice.autoRead, speechKey])
  const listen = () => speech.toggle(speechKey, { text: clean }).then(r => { if (r?.note) toast.message(`Usei ${r.provider}`, { description: r.note }) }).catch(e => { if ((e as Error).name !== 'AbortError') toast.error(`Voz: ${(e as Error).message}`) })
  return (
    <div
      className={`flex ${isUser ? 'justify-end' : 'justify-start'} px-4 py-1.5`}
    >
      {!isUser && (
        <div className={`w-8 h-8 rounded-full flex items-center justify-center mr-2 mt-1 flex-shrink-0 bg-black/60 border border-cyan-500/30 transition-shadow ${streaming ? 'avatar-glow' : ''}`}>
          <JarvisLogo size={22} speed={streaming ? 3 : 0.6} />
        </div>
      )}
      <div className={`max-w-[80%] group relative ${isUser ? 'msg-user' : 'msg-assistant'} px-4 py-3 rounded-xl`}>
        {isUser && editando ? (
          <div className="min-w-[260px]">
            <textarea
              value={rascunho}
              autoFocus
              rows={Math.min(10, Math.max(2, rascunho.split('\n').length))}
              onChange={e => setRascunho(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') { setEditando(false); setRascunho(msg.content) }
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && rascunho.trim()) { setEditando(false); onEdit?.(msg, rascunho.trim()) }
              }}
              className="w-full bg-black/30 rounded-lg px-2 py-1.5 text-sm text-white/90 outline-none border border-white/10 resize-y"
            />
            <div className="flex items-center gap-2 mt-1.5">
              <span className="text-[10px] text-white/35 flex-1">As respostas depois desta mensagem serão refeitas.</span>
              <button onClick={() => { setEditando(false); setRascunho(msg.content) }} className="px-2 py-0.5 rounded-lg text-[11px] border border-white/15 text-white/65 hover:bg-white/5">Cancelar</button>
              <button
                disabled={!rascunho.trim() || rascunho.trim() === msg.content.trim()}
                onClick={() => { setEditando(false); onEdit?.(msg, rascunho.trim()) }}
                className="px-2 py-0.5 rounded-lg text-[11px] bg-white text-black hover:bg-white/90 disabled:opacity-40"
              >
                Enviar
              </button>
            </div>
          </div>
        ) : isUser ? (
          <p className="text-sm text-white/90 leading-relaxed whitespace-pre-wrap">{msg.content}</p>
        ) : (
          <>
            {msg.reasoning && <ReasoningPanel text={msg.reasoning} live={streaming && !clean} />}
            <Markdown className={`text-sm leading-relaxed ${streaming && clean ? 'stream-caret' : ''}`}>{clean}</Markdown>
          </>
        )}
        {!isUser && motionJobsFromMsg.map((id: string) => <MotionJobInline key={id} jobId={id} />)}
        {!isUser && videoJobsFromMsg.map((id: string) => <VideoJobInline key={id} jobId={id} />)}
        {!isUser && imageJobsFromMsg.map((id: string) => <InlineImageInline key={id} jobId={id} />)}
        {!isUser && documentsFromMsg.map(f => <DocumentInline key={f} file={f} />)}
        {!isUser && topologiesFromMsg.map(id => <TopologyInline key={id} id={id} />)}
        <button
          onClick={() => onCopy(clean)}
          className="absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 p-1 rounded-full bg-white/10 hover:bg-white/20 transition-all"
          title="Copiar texto"
        >
          <Copy size={10} />
        </button>
        {isUser && onEdit && !editando && (
          <button
            onClick={() => { setRascunho(msg.content); setEditando(true) }}
            className="absolute -top-2 right-5 opacity-0 group-hover:opacity-100 p-1 rounded-full bg-white/10 hover:bg-white/20 transition-all"
            title="Editar e reenviar"
          >
            <Pencil size={10} />
          </button>
        )}
        {!isUser && onRegenerate && !streaming && (
          <button
            onClick={() => onRegenerate(msg)}
            className="absolute -top-2 right-12 opacity-0 group-hover:opacity-100 p-1 rounded-full bg-white/10 hover:bg-white/20 transition-all"
            title="Gerar outra resposta"
          >
            <RefreshCw size={10} />
          </button>
        )}
        {!isUser && !streaming && clean.trim() && (
          <button
            onClick={listen}
            className={`absolute -top-2 right-5 p-1 rounded-full transition-all ${speech.key === speechKey ? 'opacity-100 bg-cyan-500/30 text-cyan-100' : 'opacity-0 group-hover:opacity-100 bg-white/10 hover:bg-white/20'}`}
            title={speech.key === speechKey ? 'Parar' : 'Ouvir a resposta'}
          >
            {speech.key === speechKey ? (speech.loading ? <Loader2 size={10} className="animate-spin" /> : <Square size={10} />) : <Volume2 size={10} />}
          </button>
        )}
        {msg.model && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-white/25 font-mono" title={msg.model}>
            <span className="inline-block w-1 h-1 rounded-full bg-cyan-400/60" />
            {msg.model.split('|').pop()}
            {msg.stats?.firstMs !== undefined && <span title="Tempo até a primeira palavra">· 1ª palavra {fmtMs(msg.stats.firstMs)}</span>}
            {msg.stats?.totalMs !== undefined && <span title="Tempo total da resposta">· total {fmtMs(msg.stats.totalMs)}</span>}
            {(() => {
              const usage = msg.metadata?.usage as { inputTokens?: number; outputTokens?: number; estimated?: boolean } | undefined
              const total = (usage?.inputTokens || 0) + (usage?.outputTokens || 0)
              if (!total) return null
              return <span title={`${usage?.inputTokens || 0} de entrada + ${usage?.outputTokens || 0} de saída`}>· {usage?.estimated ? '~' : ''}{total.toLocaleString('pt-BR')} tokens</span>
            })()}
          </div>
        )}
      </div>
      {isUser && (
        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center ml-2 mt-1 flex-shrink-0 text-xs font-bold text-white" title={prefs?.userName || 'Você'}>
          {(prefs?.userName?.trim()[0] || 'U').toUpperCase()}
        </div>
      )}
    </div>
  )
}