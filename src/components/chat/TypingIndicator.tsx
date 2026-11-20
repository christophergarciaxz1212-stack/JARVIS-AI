'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import JarvisLogo from './JarvisLogo'
import { shortModelName, type StreamStatus } from '@/lib/ai/status'

/**
 * Indicador honesto: mostra o modelo, o tempo real decorrido e a etapa que o
 * servidor informou. Nada de "raciocinando" quando o provedor não expõe isso.
 */
export default function TypingIndicator({ model, status }: { model?: string; status?: StreamStatus | null }) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const started = Date.now()
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [])

  const local = Boolean(model?.startsWith('ollama|') || model?.startsWith('lmstudio|'))
  const label = status?.phase === 'retry'
    ? 'Reconectando ao provedor'
    : status?.phase === 'fallback'
      ? 'Trocando de modelo'
      : elapsed >= 8
        ? 'Aguardando o modelo'
        : 'Pensando'

  const detail = status?.phase === 'retry'
    ? `Tentativa ${status.attempt ?? 1} em ${Math.max(1, Math.round((status.delayMs ?? 300) / 1000))}s · ${status.reason || 'falha transitória'}`
    : status?.phase === 'fallback'
      ? 'O modelo anterior não respondeu; o contexto da tarefa foi mantido.'
      : elapsed >= 4
        ? local
          ? 'Carregando na GPU — o primeiro token de um modelo local pode demorar.'
          : 'O provedor ainda não enviou o primeiro token.'
        : model
          ? shortModelName(model)
          : 'Conectando ao modelo.'

  return (
    <motion.div
      role="status"
      aria-live="polite"
      initial={false}
      animate={{ opacity: 1, y: 0 }}
      className="typing-shell"
    >
      <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 avatar-glow bg-black/60 border border-cyan-500/30">
        <JarvisLogo size={22} speed={3} />
      </div>
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="thinking-text text-[13px] font-medium tracking-wide">{label}…</span>
          <span className="text-[10px] font-mono tabular-nums text-white/25">{elapsed}s</span>
        </div>
        <div className="text-[10.5px] text-white/30 mt-0.5 truncate max-w-[420px]" title={status?.message}>{detail}</div>
        <div className="thinking-wave mt-2" aria-hidden="true">
          {[0, 1, 2, 3, 4, 5].map(i => <span key={i} style={{ animationDelay: `${i * 90}ms` }} />)}
        </div>
      </div>
    </motion.div>
  )
}
