'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Ban, Copy, Loader2, Plus, Send, Terminal as TerminalIcon, Trash2, X } from 'lucide-react'
import type { TerminalChunk, TerminalInfo } from '@/lib/terminal'

/**
 * Terminal do JARVIS: sessões que ficam vivas no servidor.
 *
 * Como o shell não morre entre comandos, `cd` vale para os próximos e as
 * variáveis continuam. O campo de baixo serve tanto para digitar um comando
 * quanto para responder a um programa que perguntou algo — para o shell é a
 * mesma coisa.
 *
 * Sem PTY não há cores nem controle de cursor: barras de progresso aparecem
 * como texto. É o preço de não depender de módulo nativo, e é dito na tela.
 */
export default function TerminalPanel({ cwd }: { cwd?: string }) {
  const [sessions, setSessions] = useState<TerminalInfo[]>([])
  const [activeId, setActiveId] = useState('')
  const [chunks, setChunks] = useState<TerminalChunk[]>([])
  const [linha, setLinha] = useState('')
  const [criando, setCriando] = useState(false)
  const [historico, setHistorico] = useState<string[]>([])
  const [posHist, setPosHist] = useState(-1)
  const caixa = useRef<HTMLDivElement>(null)
  const entrada = useRef<HTMLInputElement>(null)

  const api = useCallback(async <T,>(body: Record<string, unknown>): Promise<T> => {
    const r = await fetch('/api/terminal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const d = await r.json().catch(() => ({}))
    if (!r.ok || d.error) throw new Error(d.error || `Erro ${r.status}`)
    return d as T
  }, [])

  const recarregar = useCallback(async () => {
    try {
      const d = await fetch('/api/terminal?action=list', { cache: 'no-store' }).then(r => r.json())
      const lista: TerminalInfo[] = d.sessions || []
      setSessions(lista)
      setActiveId(cur => (cur && lista.some(s => s.id === cur) ? cur : lista[0]?.id || ''))
    } catch { /* servidor fora do ar: a interface continua */ }
  }, [])

  useEffect(() => { void recarregar() }, [recarregar])

  // Saída ao vivo da sessão escolhida
  useEffect(() => {
    if (!activeId) { setChunks([]); return }
    setChunks([])
    const es = new EventSource(`/api/terminal?action=stream&id=${encodeURIComponent(activeId)}`)
    es.addEventListener('chunk', e => {
      const c = JSON.parse((e as MessageEvent).data) as TerminalChunk
      setChunks(prev => (prev.length > 1200 ? [...prev.slice(-1000), c] : [...prev, c]))
    })
    es.onerror = () => es.close()
    return () => es.close()
  }, [activeId])

  useEffect(() => {
    if (caixa.current) caixa.current.scrollTop = caixa.current.scrollHeight
  }, [chunks])

  const criar = async (shell: 'powershell' | 'cmd') => {
    setCriando(true)
    try {
      const d = await api<{ session: TerminalInfo }>({ action: 'create', shell, cwd })
      await recarregar()
      setActiveId(d.session.id)
      entrada.current?.focus()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setCriando(false)
    }
  }

  const enviar = async () => {
    const texto = linha
    if (!texto.trim() || !activeId) return
    setLinha('')
    setHistorico(h => [...h.filter(x => x !== texto), texto].slice(-80))
    setPosHist(-1)
    try {
      await api({ action: 'write', id: activeId, line: texto })
    } catch (e) {
      toast.error((e as Error).message)
      setLinha(texto)
    }
  }

  const interromper = async () => {
    if (!activeId) return
    try {
      // O servidor devolve quantos processos pararam de verdade; se nenhum,
      // o aviso já aparece na saída e não damos a operação como feita.
      const d = await api<{ killed: number }>({ action: 'interrupt', id: activeId })
      if (d.killed > 0) toast.success(d.killed === 1 ? 'Processo interrompido' : `${d.killed} processos interrompidos`)
    } catch (e) { toast.error((e as Error).message) }
  }

  const copiarSaida = async () => {
    if (!chunks.length) return
    try {
      await navigator.clipboard.writeText(chunks.map(c => (c.kind === 'comando' ? `> ${c.text}` : c.text)).join('\n'))
      toast.success('Saída do terminal copiada')
    } catch (e) { toast.error((e as Error).message) }
  }

  const fechar = async (id: string) => {
    try { await api({ action: 'close', id }); await recarregar() } catch (e) { toast.error((e as Error).message) }
  }

  /** Setas percorrem o que já foi digitado nesta sessão da interface. */
  const navegarHistorico = (delta: number) => {
    if (!historico.length) return
    const novo = posHist < 0 ? historico.length - 1 : Math.min(historico.length - 1, Math.max(0, posHist + delta))
    setPosHist(novo)
    setLinha(historico[novo])
  }

  const ativa = sessions.find(s => s.id === activeId)

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Sessões */}
      <div className="flex items-center gap-1 p-1.5 border-b border-white/5 overflow-x-auto">
        {sessions.map(s => (
          <div
            key={s.id}
            className={`group flex items-center gap-1 pl-2 pr-1 py-1 rounded-lg text-[11px] flex-shrink-0 cursor-pointer transition-colors ${s.id === activeId ? 'bg-white/[0.08] text-white/85' : 'text-white/40 hover:bg-white/[0.04]'}`}
            onClick={() => setActiveId(s.id)}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${s.alive ? 'bg-green-400/70' : 'bg-white/20'}`} />
            <span className="font-mono">{s.title}</span>
            <button
              onClick={e => { e.stopPropagation(); void fechar(s.id) }}
              aria-label={`Fechar ${s.title}`}
              className="opacity-0 group-hover:opacity-100 text-white/30 hover:text-red-300 transition-opacity"
            >
              <X size={10} />
            </button>
          </div>
        ))}
        <button
          onClick={() => criar('powershell')}
          disabled={criando}
          title="Nova sessão PowerShell"
          className="jv-btn jv-btn-icon jv-btn-ghost flex-shrink-0"
        >
          {criando ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
        </button>
        <button onClick={() => criar('cmd')} disabled={criando} title="Nova sessão CMD" className="jv-btn jv-btn-sm jv-btn-ghost flex-shrink-0"><TerminalIcon size={10} /> CMD</button>
        <div className="flex-1" />
        {activeId && (
          <>
            <button onClick={() => void copiarSaida()} title="Copiar saída visível" className="jv-btn jv-btn-icon jv-btn-ghost flex-shrink-0"><Copy size={11} /></button>
            <button onClick={() => setChunks([])} title="Limpar a tela (o histórico do shell continua)" className="jv-btn jv-btn-icon jv-btn-ghost flex-shrink-0">
              <Trash2 size={11} />
            </button>
          </>
        )}
      </div>

      {!activeId ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 px-4 text-center">
          <p className="text-[11px] text-white/35">Nenhum terminal aberto.</p>
          <div className="flex gap-2">
            <button onClick={() => criar('powershell')} className="px-2.5 py-1 rounded-lg text-[11px] bg-white text-black hover:bg-white/90">PowerShell</button>
            <button onClick={() => criar('cmd')} className="px-2.5 py-1 rounded-lg text-[11px] border border-white/15 text-white/65 hover:bg-white/5">CMD</button>
          </div>
          <p className="text-[10px] text-white/25 max-w-[260px] leading-relaxed">
            A sessão fica viva: <span className="font-mono">cd</span> vale para os próximos comandos e você pode responder a programas que perguntam algo.
          </p>
        </div>
      ) : (
        <>
          <div ref={caixa} className="flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed">
            {chunks.length === 0 && <div className="text-white/25">{ativa?.title} · aberto em <span className="text-white/40">{ativa?.cwd}</span></div>}
            {chunks.map(c => (
              <div
                key={c.id}
                className={`whitespace-pre-wrap break-words ${
                  c.kind === 'comando' ? 'text-cyan-200/90' : c.kind === 'erro' ? 'text-red-300/85' : c.kind === 'aviso' ? 'text-amber-200/70' : 'text-white/70'
                }`}
              >
                {c.kind === 'comando' ? `> ${c.text}` : c.text}
              </div>
            ))}
          </div>

          <div className="p-2 border-t border-white/5">
            <div className="flex items-center gap-2 bg-black/50 rounded-lg px-2.5 py-1.5 border border-white/5">
              <span className="text-cyan-400/80 font-mono text-[11px] flex-shrink-0">{ativa?.shell === 'cmd' ? '>' : 'PS >'}</span>
              <input
                ref={entrada}
                value={linha}
                onChange={e => setLinha(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); void enviar() }
                  else if (e.key === 'ArrowUp') { e.preventDefault(); navegarHistorico(-1) }
                  else if (e.key === 'ArrowDown') { e.preventDefault(); navegarHistorico(1) }
                  else if (e.key === 'c' && e.ctrlKey) { e.preventDefault(); void interromper() }
                }}
                placeholder="Comando — ou a resposta a uma pergunta do programa"
                className="flex-1 bg-transparent text-[11px] font-mono text-white/85 outline-none placeholder-white/20"
              />
              <button onClick={interromper} title="Interromper (Ctrl+C)" className="text-white/30 hover:text-amber-300 transition-colors flex-shrink-0">
                <Ban size={12} />
              </button>
              <button onClick={enviar} disabled={!linha.trim()} className="text-cyan-400/60 hover:text-cyan-400 transition-colors disabled:opacity-30 flex-shrink-0">
                <Send size={12} />
              </button>
            </div>
            <div className="text-[9px] text-white/20 mt-1 px-1">
              Sem cores nem barras de progresso: a saída chega como texto.
            </div>
          </div>
        </>
      )}
    </div>
  )
}
