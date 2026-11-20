'use client'

import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, ClipboardPaste, FileText, Layers, Loader2, X } from 'lucide-react'
import type { ContextChip, useChatContext } from './useChatContext'
import { shortModelName } from '@/lib/ai/status'

const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1).replace('.', ',')} mil` : String(n))

/** Faixa acima do campo de mensagem: o contexto da conversa, o painel "colar texto" e o aviso de corte. */
export default function ContextBar({ ctx, pasteOpen, onClosePaste }: {
  ctx: ReturnType<typeof useChatContext>
  pasteOpen: boolean
  onClosePaste: () => void
}) {
  const [text, setText] = useState('')
  const [name, setName] = useState('')
  const total = ctx.items.reduce((n, i) => n + i.chars, 0)

  const submitPaste = async () => {
    if (!text.trim()) return
    await ctx.addText(text, name)
    setText(''); setName(''); onClosePaste()
  }

  return (
    <>
      <AnimatePresence initial={false}>
        {pasteOpen && (
          <motion.div key="paste" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} className="mx-2 mb-2 rounded-xl border border-cyan-400/25 bg-[#0b1220]/95 backdrop-blur p-3 space-y-2">
            <div className="flex items-center gap-2">
              <ClipboardPaste size={13} className="text-cyan-300" />
              <span className="text-xs font-medium text-white/85 flex-1">Colar texto como contexto</span>
              <button onClick={onClosePaste} aria-label="Fechar" className="p-1 rounded hover:bg-white/5 text-white/40"><X size={13} /></button>
            </div>
            <input value={name} onChange={e => setName(e.target.value)} maxLength={120} placeholder="Nome (opcional) — ex.: Ata da reunião, Requisitos do cliente" className="input-jarvis w-full px-3 py-1.5 rounded-lg text-xs" />
            <textarea value={text} onChange={e => setText(e.target.value)} rows={5} autoFocus
              onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submitPaste() } }}
              placeholder="Cole aqui um documento, e-mail, log, código, transcrição… A IA vai usar isso em todas as mensagens desta conversa."
              className="input-jarvis w-full px-3 py-2 rounded-lg text-xs font-mono leading-relaxed" />
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10.5px] text-white/35">{text.trim() ? `${fmt(text.trim().length)} caracteres · Ctrl+Enter adiciona` : 'Até 300 mil caracteres por item'}</span>
              <button onClick={submitPaste} disabled={!text.trim()} className="px-3 py-1.5 rounded-lg text-xs bg-cyan-500/25 text-cyan-50 hover:bg-cyan-500/35 disabled:opacity-40">Adicionar ao contexto</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {(ctx.items.length > 0 || ctx.busy) && (
        <div className="px-2 pb-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="flex items-center gap-1 text-[10.5px] text-cyan-200/70 mr-0.5" title="Este material vai para a IA em todas as mensagens desta conversa">
              <Layers size={11} /> Contexto{total ? ` · ${fmt(total)} car.` : ''}
            </span>
            <AnimatePresence initial={false}>
              {ctx.items.map((c: ContextChip) => (
                <motion.span key={c.id} layout initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.85 }}
                  title={`${c.name}\n${c.chars.toLocaleString('pt-BR')} caracteres${c.truncated ? ' (cortado ao adicionar)' : ''}${c.preview ? `\n\n${c.preview}…` : ''}`}
                  className={`group inline-flex items-center gap-1.5 max-w-[240px] pl-2 pr-1 py-1 rounded-lg border text-[11px] ${c.pending ? 'border-dashed border-cyan-400/35 bg-cyan-500/[0.06] text-cyan-50/90' : 'border-cyan-400/25 bg-cyan-500/10 text-cyan-50'}`}>
                  {c.kind === 'text' ? <ClipboardPaste size={11} className="flex-shrink-0 text-cyan-300/80" /> : <FileText size={11} className="flex-shrink-0 text-cyan-300/80" />}
                  <span className="truncate">{c.name}</span>
                  <span className="text-[9.5px] text-white/40 flex-shrink-0">{fmt(c.chars)}</span>
                  {c.truncated && <AlertTriangle size={10} className="text-amber-300 flex-shrink-0" />}
                  <button onClick={() => ctx.remove(c)} aria-label={`Tirar ${c.name} do contexto`} className="p-0.5 rounded text-white/40 hover:text-white hover:bg-white/10"><X size={10} /></button>
                </motion.span>
              ))}
            </AnimatePresence>
            {ctx.busy && <span className="inline-flex items-center gap-1 text-[10.5px] text-white/45"><Loader2 size={11} className="animate-spin" /> lendo arquivo…</span>}
            {ctx.items.length > 1 && <button onClick={ctx.clear} className="text-[10px] text-white/35 hover:text-red-300 ml-1">limpar tudo</button>}
          </div>
          {ctx.note?.clipped && (
            <p className="mt-1 text-[10.5px] text-amber-200/90 flex items-center gap-1">
              <AlertTriangle size={10} /> {shortModelName(ctx.note.model)} recebeu {Math.round((ctx.note.usedChars / Math.max(1, ctx.note.totalChars)) * 100)}% do contexto ({fmt(ctx.note.usedChars)} de {fmt(ctx.note.totalChars)} caracteres) — o limite gratuito dele não comporta tudo. Um modelo do Gemini ou local cabe mais.
            </p>
          )}
          {ctx.items.some(i => i.pending) && <p className="mt-1 text-[10px] text-white/30">Vai junto com a sua próxima mensagem e fica valendo para a conversa inteira.</p>}
        </div>
      )}
    </>
  )
}
