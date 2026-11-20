'use client'

import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Check, ExternalLink, KeyRound, RefreshCw, Trash2, X, Zap } from 'lucide-react'
import CustomProviders from './CustomProviders'
interface KeyEntry {
  id: string
  name: string
  icon: string
  envKey: string
  keyUrl: string
  help: string
  group: 'free' | 'paid' | 'tool'
  configured: boolean
  hint: string
}

const KEY_GROUPS = [
  { id: 'free', title: 'Gratuitos', subtitle: 'Comece por estes: crie a conta, copie a chave e cole aqui' },
  { id: 'paid', title: 'Pagos', subtitle: 'Precisam de créditos na conta do provedor' },
  { id: 'tool', title: 'Ferramentas', subtitle: 'Recursos extras para o JARVIS' },
] as const

export default function ApiKeysModal({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<KeyEntry[]>([])
  const [ollama, setOllama] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState('')
  const [results, setResults] = useState<Record<string, { ok: boolean; message: string }>>({})

  const load = useCallback(async () => {
    try {
      const d = await fetch('/api/settings').then(r => r.json())
      setEntries(d.entries || [])
      setOllama(!!d.ollama)
    } catch {}
  }, [])

  useEffect(() => { load() }, [load])

  const act = async (e: KeyEntry, action: 'save' | 'test' | 'remove') => {
    setBusy(e.envKey)
    try {
      const d = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, envKey: e.envKey, value: drafts[e.envKey] }),
      }).then(r => r.json())
      setResults(r => ({ ...r, [e.envKey]: d }))
      if (action === 'save' && d.ok) setDrafts(x => ({ ...x, [e.envKey]: '' }))
      await load()
    } catch {
      setResults(r => ({ ...r, [e.envKey]: { ok: false, message: 'Falha de conexão com o JARVIS' } }))
    } finally {
      setBusy('')
    }
  }

  const connected = entries.filter(e => e.configured && e.group !== 'tool').length

  return (
    <motion.div
      initial={false}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0 }, pointerEvents: 'none' }}
      className="mo-backdrop fixed inset-0 bg-black/[.88] z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={false}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, transition: { duration: 0 } }}
        className="glass modal-pop rounded-2xl w-full max-w-3xl max-h-[88vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-6 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
              <KeyRound size={18} className="text-cyan-300" />
            </div>
            <div>
              <h2 className="text-lg font-semibold jarvis-title">CHAVES DE API</h2>
              <p className="text-xs text-white/40 mt-0.5">
                {connected} provedor{connected === 1 ? '' : 'es'} de IA conectado{connected === 1 ? '' : 's'} · as chaves ficam salvas só neste computador
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/5 transition-colors">
            <X size={18} className="text-white/50" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-6">
          {KEY_GROUPS.map(g => {
            const list = entries.filter(e => e.group === g.id)
            if (!list.length) return null
            return (
              <section key={g.id}>
                <h3 className="text-xs uppercase tracking-wider text-cyan-300/70">{g.title}</h3>
                <p className="text-[11px] text-white/30 mb-3">{g.subtitle}</p>
                <div className="space-y-2">
                  {list.map(e => {
                    const result = results[e.envKey]
                    const draft = drafts[e.envKey] || ''
                    const isBusy = busy === e.envKey
                    return (
                      <div key={e.envKey} className={`p-4 rounded-xl border transition-colors ${e.configured ? 'border-green-500/20 bg-green-500/[0.03]' : 'border-white/5 bg-white/[0.02]'}`}>
                        <div className="flex items-start gap-3">
                          <span className="text-xl leading-none mt-0.5">{e.icon}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium text-white">{e.name}</span>
                              {e.configured
                                ? <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-300">CONECTADO {e.hint}</span>
                                : <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/5 text-white/40">SEM CHAVE</span>}
                            </div>
                            <p className="text-xs text-white/40 mt-1">{e.help}</p>
                          </div>
                          {e.keyUrl && (
                            <a
                              href={e.keyUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 transition-colors"
                            >
                              Pegar chave <ExternalLink size={11} />
                            </a>
                          )}
                        </div>
                        <div className="mt-3 flex gap-2">
                          <input
                            type="password"
                            autoComplete="off"
                            spellCheck={false}
                            className="input-jarvis flex-1 min-w-0 px-3 py-2 rounded-lg text-xs font-mono"
                            placeholder={e.configured ? 'Cole uma nova chave para substituir' : `Cole aqui a chave (${e.envKey})`}
                            value={draft}
                            onChange={ev => setDrafts(x => ({ ...x, [e.envKey]: ev.target.value }))}
                            onKeyDown={ev => { if (ev.key === 'Enter' && draft.trim() && !busy) act(e, 'save') }}
                          />
                          <button
                            onClick={() => act(e, 'save')}
                            disabled={!draft.trim() || !!busy}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs bg-cyan-500/20 text-cyan-200 hover:bg-cyan-500/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                          >
                            {isBusy ? <RefreshCw size={12} className="animate-spin" /> : <Check size={12} />}
                            Salvar
                          </button>
                          {e.configured && (
                            <>
                              <button
                                onClick={() => act(e, 'test')}
                                disabled={!!busy}
                                title="Testar chave"
                                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs bg-white/5 text-white/60 hover:bg-white/10 disabled:opacity-30 transition-colors"
                              >
                                <Zap size={12} /> Testar
                              </button>
                              <button
                                onClick={() => act(e, 'remove')}
                                disabled={!!busy}
                                title="Remover chave"
                                className="px-2.5 py-2 rounded-lg text-xs bg-white/5 text-white/40 hover:text-red-300 hover:bg-red-500/10 disabled:opacity-30 transition-colors"
                              >
                                <Trash2 size={12} />
                              </button>
                            </>
                          )}
                        </div>
                        {result && (
                          <p className={`mt-2 text-xs break-words ${result.ok ? 'text-green-400' : 'text-red-400'}`}>
                            {result.ok ? '✓' : '✗'} {result.message}
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
              </section>
            )
          })}

          <CustomProviders />

          <section>
            <h3 className="text-xs uppercase tracking-wider text-cyan-300/70">Modelos locais</h3>
            <p className="text-[11px] text-white/30 mb-3">Rodam no seu PC, sem chave e sem internet</p>
            <div className="p-4 rounded-xl border border-white/5 bg-white/[0.02] flex items-start gap-3">
              <span className="text-xl leading-none mt-0.5">🦙</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white">Ollama / LM Studio</span>
                  {ollama
                    ? <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-300">OLLAMA RODANDO</span>
                    : <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/5 text-white/40">NÃO DETECTADO</span>}
                </div>
                <p className="text-xs text-white/40 mt-1">
                  Instale o Ollama, depois rode <code className="text-cyan-300/80">ollama pull llama3.2</code> no terminal. Os modelos aparecem sozinhos no JARVIS.
                </p>
              </div>
              <a
                href="https://ollama.com/download"
                target="_blank"
                rel="noopener noreferrer"
                className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 transition-colors"
              >
                Baixar <ExternalLink size={11} />
              </a>
            </div>
          </section>
        </div>
      </motion.div>
    </motion.div>
  )
}
