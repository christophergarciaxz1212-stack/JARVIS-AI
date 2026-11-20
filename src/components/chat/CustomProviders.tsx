'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronDown, Pencil, Plus, RefreshCw, Search, Trash2, X, Zap, ExternalLink, Boxes } from 'lucide-react'

type Style = 'openai' | 'anthropic'
interface Preset { id: string; name: string; baseUrl: string; style: Style; keyUrl?: string; needsKey: boolean; note: string }
interface Custom { id: string; name: string; baseUrl: string; style: Style; manualModels: string[]; freeOnly: boolean; hasKey: boolean; keyHint: string }
interface Found { id: string; name?: string; contextWindow?: number; paid?: boolean }
type Result = { ok: boolean; message: string }

const EMPTY = { id: '', name: '', baseUrl: '', style: 'openai' as Style, apiKey: '', manual: '', freeOnly: true }

async function call<T>(body: Record<string, unknown>): Promise<T & { ok: boolean; error?: string }> {
  const res = await fetch('/api/providers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return res.json()
}

/**
 * Provedores extras cadastrados pelo usuário: qualquer API no formato OpenAI ou Anthropic.
 * Os modelos são buscados na própria API; a chave vai para o cofre local e nunca volta para a tela.
 */
export default function CustomProviders() {
  const [list, setList] = useState<Custom[]>([])
  const [presets, setPresets] = useState<Preset[]>([])
  const [form, setForm] = useState<typeof EMPTY | null>(null)
  const [preset, setPreset] = useState<Preset | null>(null)
  const [found, setFound] = useState<Found[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState('')
  const [formMsg, setFormMsg] = useState<Result | null>(null)
  const [results, setResults] = useState<Record<string, Result>>({})
  const [confirmRemove, setConfirmRemove] = useState('')

  const load = useCallback(async () => {
    try {
      const d = await fetch('/api/providers').then(r => r.json()) as { providers: Custom[]; presets: Preset[] }
      setList(d.providers || [])
      setPresets(d.presets || [])
    } catch { /* a seção fica vazia; o resto da janela continua funcionando */ }
  }, [])
  useEffect(() => { load() }, [load])

  const startNew = (p?: Preset) => {
    setPreset(p || null)
    setForm({ ...EMPTY, name: p?.name || '', baseUrl: p?.baseUrl || '', style: p?.style || 'openai' })
    setFound(null); setPicked(new Set()); setFormMsg(null); setFilter('')
  }
  const startEdit = (c: Custom) => {
    setPreset(null)
    setForm({ id: c.id, name: c.name, baseUrl: c.baseUrl, style: c.style, apiKey: '', manual: c.manualModels.join('\n'), freeOnly: c.freeOnly })
    setFound(null); setPicked(new Set(c.manualModels)); setFormMsg(null); setFilter('')
  }

  const discover = async () => {
    if (!form) return
    setBusy('discover'); setFormMsg(null)
    try {
      const d = await call<{ baseUrl: string; models: Found[] }>({ action: 'discover', baseUrl: form.baseUrl, style: form.style, apiKey: form.apiKey || undefined, id: form.id || undefined })
      if (!d.ok) { setFound(null); setFormMsg({ ok: false, message: `${d.error} — você ainda pode digitar os modelos à mão.` }); return }
      setFound(d.models)
      setForm(f => (f ? { ...f, baseUrl: d.baseUrl } : f))
      const paid = d.models.filter(m => m.paid).length
      setFormMsg({ ok: true, message: `${d.models.length} modelos encontrados${paid ? ` (${paid} pagos${form.freeOnly ? ', ficarão ocultos' : ''})` : ''}. Marque alguns para usar só esses, ou deixe tudo desmarcado para usar todos.` })
    } catch { setFormMsg({ ok: false, message: 'Falha de conexão com o JARVIS' }) } finally { setBusy('') }
  }

  const save = async () => {
    if (!form) return
    setBusy('save'); setFormMsg(null)
    try {
      const manual = found ? [...picked] : form.manual.split(/[\n,]+/).map(s => s.trim()).filter(Boolean)
      const d = await call<{ provider: Custom; models: string[]; modelsError: string }>({
        action: 'save', id: form.id || undefined, name: form.name, baseUrl: form.baseUrl, style: form.style,
        apiKey: form.apiKey ? form.apiKey : undefined, manualModels: manual, freeOnly: form.freeOnly,
      })
      if (!d.ok) { setFormMsg({ ok: false, message: d.error || 'Não foi possível salvar' }); return }
      setResults(r => ({ ...r, [d.provider.id]: d.models.length
        ? { ok: true, message: `Salvo · ${d.models.length} modelo${d.models.length === 1 ? '' : 's'} no seletor do chat` }
        : { ok: false, message: `Salvo, mas sem modelos: ${d.modelsError || 'a API não listou nenhum'}. Edite e digite os modelos à mão.` } }))
      setForm(null)
      await load()
    } catch { setFormMsg({ ok: false, message: 'Falha de conexão com o JARVIS' }) } finally { setBusy('') }
  }

  const test = async (c: Custom) => {
    setBusy(`test:${c.id}`)
    try {
      const d = await call<{ model: string; latencyMs: number; answer: string }>({ action: 'test', id: c.id })
      setResults(r => ({ ...r, [c.id]: d.ok
        ? { ok: true, message: `Conversa OK com ${d.model} em ${(d.latencyMs / 1000).toFixed(1).replace('.', ',')} s` }
        : { ok: false, message: `${d.model ? `${d.model}: ` : ''}${d.error}` } }))
    } catch { setResults(r => ({ ...r, [c.id]: { ok: false, message: 'Falha de conexão com o JARVIS' } })) } finally { setBusy('') }
  }

  const remove = async (id: string) => {
    setBusy(`rm:${id}`)
    try { await call({ action: 'remove', id }); setConfirmRemove(''); await load() } finally { setBusy('') }
  }

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return (found || []).filter(m => !q || m.id.toLowerCase().includes(q)).slice(0, 300)
  }, [found, filter])

  return (
    <section>
      <div className="flex items-end justify-between gap-3">
        <div>
          <h3 className="text-xs uppercase tracking-wider text-cyan-300/70 flex items-center gap-1.5"><Boxes size={12} /> Outros provedores</h3>
          <p className="text-[11px] text-white/30 mb-3">Qualquer API no formato OpenAI ou Anthropic — os modelos são buscados na própria API</p>
        </div>
        {!form && (
          <button onClick={() => startNew()} className="mb-3 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-cyan-500/15 text-cyan-200 border border-cyan-500/25 hover:bg-cyan-500/25 transition-colors">
            <Plus size={12} /> Adicionar provedor
          </button>
        )}
      </div>

      <AnimatePresence initial={false}>
        {form && (
          <motion.div key="form" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="mb-3 p-4 rounded-xl border border-cyan-500/25 bg-cyan-500/[0.04] space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-white">{form.id ? `Editar ${form.name}` : 'Novo provedor'}</span>
                <button onClick={() => setForm(null)} aria-label="Fechar formulário" className="p-1 rounded hover:bg-white/5 text-white/40"><X size={14} /></button>
              </div>

              {!form.id && presets.length > 0 && (
                <div>
                  <div className="text-[10.5px] text-white/40 mb-1.5">Atalhos (preenchem o endereço)</div>
                  <div className="flex flex-wrap gap-1.5">
                    {presets.map(p => (
                      <button key={p.id} onClick={() => startNew(p)} title={p.note}
                        className={`text-[10.5px] px-2 py-1 rounded-full border transition-colors ${preset?.id === p.id ? 'border-cyan-400/50 bg-cyan-500/15 text-white' : 'border-white/10 text-white/55 hover:text-white hover:border-white/25'}`}>
                        {p.name}
                      </button>
                    ))}
                  </div>
                  {preset && (
                    <p className="text-[10.5px] text-white/45 mt-1.5 flex items-center gap-2 flex-wrap">
                      {preset.note}
                      {preset.keyUrl && <a href={preset.keyUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-cyan-300 hover:underline">Pegar chave <ExternalLink size={10} /></a>}
                    </p>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
                <label className="text-[10.5px] text-white/45">Nome
                  <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} maxLength={40} placeholder="Ex.: Meu servidor vLLM" className="input-jarvis mt-1 w-full px-3 py-2 rounded-lg text-xs" />
                </label>
                <div className="text-[10.5px] text-white/45">Formato da API
                  <div role="radiogroup" aria-label="Formato da API" className="mt-1 flex gap-1">
                    {(['openai', 'anthropic'] as const).map(s => (
                      <button key={s} role="radio" aria-checked={form.style === s} onClick={() => setForm({ ...form, style: s })}
                        className={`px-3 py-2 rounded-lg text-xs border transition-colors ${form.style === s ? 'border-cyan-400/50 bg-cyan-500/15 text-white' : 'border-white/10 text-white/50 hover:text-white/80'}`}>
                        {s === 'openai' ? 'OpenAI' : 'Anthropic'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <label className="block text-[10.5px] text-white/45">Endereço da API
                <input value={form.baseUrl} onChange={e => setForm({ ...form, baseUrl: e.target.value })} spellCheck={false} placeholder="https://api.exemplo.com/v1  (pode colar com /chat/completions)" className="input-jarvis mt-1 w-full px-3 py-2 rounded-lg text-xs font-mono" />
              </label>
              <label className="block text-[10.5px] text-white/45">Chave da API {form.id ? '(vazio = manter a atual)' : '(deixe vazio se o servidor não pede)'}
                <input type="password" autoComplete="off" spellCheck={false} value={form.apiKey} onChange={e => setForm({ ...form, apiKey: e.target.value })} placeholder="Cole a chave" className="input-jarvis mt-1 w-full px-3 py-2 rounded-lg text-xs font-mono" />
              </label>

              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={discover} disabled={!form.baseUrl.trim() || !!busy} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs bg-white/5 text-white/75 hover:bg-white/10 disabled:opacity-40 transition-colors">
                  {busy === 'discover' ? <RefreshCw size={12} className="animate-spin" /> : <Search size={12} />} Buscar modelos
                </button>
                <label className="flex items-center gap-1.5 text-[11px] text-white/55 cursor-pointer select-none">
                  <input type="checkbox" checked={form.freeOnly} onChange={e => setForm({ ...form, freeOnly: e.target.checked })} className="accent-cyan-400" />
                  Esconder modelos que a API marca como pagos
                </label>
              </div>

              {found && (
                <div className="rounded-lg border border-white/8 bg-black/25">
                  <div className="flex items-center gap-2 px-2 py-1.5 border-b border-white/5">
                    <Search size={11} className="text-white/30" />
                    <input value={filter} onChange={e => setFilter(e.target.value)} placeholder={`Filtrar ${found.length} modelos`} aria-label="Filtrar modelos" className="flex-1 bg-transparent text-[11px] text-white/80 outline-none" />
                    <span className="text-[10px] text-white/35">{picked.size ? `${picked.size} marcados` : 'todos'}</span>
                    {picked.size > 0 && <button onClick={() => setPicked(new Set())} className="text-[10px] text-cyan-300 hover:underline">limpar</button>}
                  </div>
                  <div className="max-h-44 overflow-y-auto p-1 grid grid-cols-1 sm:grid-cols-2 gap-x-2">
                    {shown.map(m => (
                      <label key={m.id} className={`flex items-center gap-1.5 px-1.5 py-1 rounded text-[10.5px] font-mono cursor-pointer hover:bg-white/5 ${m.paid && form.freeOnly ? 'opacity-40' : ''}`}>
                        <input type="checkbox" checked={picked.has(m.id)} onChange={e => setPicked(prev => { const n = new Set(prev); if (e.target.checked) n.add(m.id); else n.delete(m.id); return n })} className="accent-cyan-400" />
                        <span className="truncate text-white/75" title={m.id}>{m.id}</span>
                        {m.paid && <span className="text-[9px] text-amber-300/80 flex-shrink-0">pago</span>}
                      </label>
                    ))}
                  </div>
                </div>
              )}
              {!found && (
                <label className="block text-[10.5px] text-white/45">Modelos à mão (opcional — um por linha; vazio = buscar na API)
                  <textarea value={form.manual} onChange={e => setForm({ ...form, manual: e.target.value })} rows={2} spellCheck={false} placeholder="ex.: llama-3.3-70b&#10;qwen3-32b" className="input-jarvis mt-1 w-full px-3 py-2 rounded-lg text-xs font-mono" />
                </label>
              )}

              {formMsg && <p role="status" className={`text-xs break-words ${formMsg.ok ? 'text-green-400' : 'text-amber-300'}`}>{formMsg.ok ? '✓' : '!'} {formMsg.message}</p>}

              <div className="flex justify-end gap-2">
                <button onClick={() => setForm(null)} className="px-3 py-2 rounded-lg text-xs text-white/55 hover:bg-white/5">Cancelar</button>
                <button onClick={save} disabled={!form.name.trim() || !form.baseUrl.trim() || !!busy} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs bg-cyan-500/25 text-cyan-50 hover:bg-cyan-500/35 disabled:opacity-40 transition-colors">
                  {busy === 'save' ? <RefreshCw size={12} className="animate-spin" /> : <Check size={12} />} Salvar e conectar
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="space-y-2">
        {!list.length && !form && (
          <div className="p-4 rounded-xl border border-dashed border-white/10 text-xs text-white/35 text-center">
            Nenhum provedor extra. Use <b className="text-white/60">Adicionar provedor</b> para ligar Cerebras, Hugging Face, um servidor vLLM/LiteLLM ou qualquer API compatível.
          </div>
        )}
        {list.map(c => {
          const r = results[c.id]
          return (
            <div key={c.id} className="p-4 rounded-xl border border-white/5 bg-white/[0.02]">
              <div className="flex items-start gap-3">
                <span className="text-xl leading-none mt-0.5">{c.style === 'anthropic' ? '🅰️' : '🧩'}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-white">{c.name}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/5 text-white/50">{c.style === 'anthropic' ? 'Anthropic' : 'OpenAI'}</span>
                    {c.hasKey ? <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-300">CHAVE {c.keyHint}</span> : <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/5 text-white/40">SEM CHAVE</span>}
                    {c.manualModels.length > 0 && <span className="text-[10px] text-white/35">{c.manualModels.length} modelo{c.manualModels.length === 1 ? '' : 's'} escolhido{c.manualModels.length === 1 ? '' : 's'}</span>}
                  </div>
                  <p className="text-[11px] text-white/35 mt-1 font-mono truncate" title={c.baseUrl}>{c.baseUrl}</p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button onClick={() => test(c)} disabled={!!busy} title="Conversa de teste com um modelo" className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-white/5 text-white/65 hover:bg-white/10 disabled:opacity-40">
                    {busy === `test:${c.id}` ? <RefreshCw size={12} className="animate-spin" /> : <Zap size={12} />} Testar
                  </button>
                  <button onClick={() => startEdit(c)} disabled={!!busy} title="Editar" aria-label={`Editar ${c.name}`} className="p-2 rounded-lg text-xs bg-white/5 text-white/55 hover:bg-white/10 disabled:opacity-40"><Pencil size={12} /></button>
                  <button onClick={() => setConfirmRemove(confirmRemove === c.id ? '' : c.id)} disabled={!!busy} title="Remover" aria-label={`Remover ${c.name}`} className="p-2 rounded-lg text-xs bg-white/5 text-white/40 hover:text-red-300 hover:bg-red-500/10 disabled:opacity-40"><Trash2 size={12} /></button>
                </div>
              </div>
              {confirmRemove === c.id && (
                <div className="mt-3 flex items-center gap-2 text-xs text-red-200 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                  <span className="flex-1">Remover {c.name} e apagar a chave dele deste computador?</span>
                  <button onClick={() => setConfirmRemove('')} className="px-2 py-1 rounded text-white/60 hover:bg-white/5">Cancelar</button>
                  <button onClick={() => remove(c.id)} className="px-2.5 py-1 rounded bg-red-500/25 text-red-100 hover:bg-red-500/35">{busy === `rm:${c.id}` ? 'Removendo…' : 'Remover'}</button>
                </div>
              )}
              {r && <p className={`mt-2 text-xs break-words ${r.ok ? 'text-green-400' : 'text-red-400'}`}>{r.ok ? '✓' : '✗'} {r.message}</p>}
            </div>
          )
        })}
      </div>
      {list.length > 0 && <p className="text-[10.5px] text-white/30 mt-2 flex items-center gap-1"><ChevronDown size={10} /> Os modelos destes provedores aparecem no seletor de modelos do chat e entram no modo automático.</p>}
    </section>
  )
}
