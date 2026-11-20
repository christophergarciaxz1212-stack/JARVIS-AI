'use client'

import { useState } from 'react'
import { Loader2, Settings2 } from 'lucide-react'
import { toast } from 'sonner'
import type { Extension } from '@/lib/engine/types'

/** Form for what an extension needs to start (keys, folders, connection strings). Secrets go to the keys vault. */
export default function ExtensionSetupForm({ ext, post, onSaved }: {
  ext: Extension
  post: (action: string, payload?: Record<string, unknown>) => Promise<{ test?: { ok: boolean; output: string } }>
  onSaved: () => Promise<void> | void
}) {
  const fields = ext.setup?.fields || []
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.filter(f => !f.secret).map(f => [f.name, ext.setup?.values[f.name] ?? f.suggestion ?? ''])),
  )
  const [busy, setBusy] = useState(false)
  if (!fields.length) return null

  const save = async () => {
    setBusy(true)
    try {
      // Empty secret fields are left out so a saved key isn't erased by accident
      const values = Object.fromEntries(Object.entries(draft).filter(([k, v]) => !fields.find(f => f.name === k)?.secret || v.trim()))
      const r = await post('setup', { id: ext.id, values })
      if (r.test?.ok) toast.success(`${ext.name} configurada e funcionando`)
      else toast.error(`Configuração salva, mas o teste falhou: ${r.test?.output?.slice(0, 220) || 'sem detalhe'}`)
      await onSaved()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.04] p-2.5 space-y-2">
      <div className="text-[10px] uppercase tracking-wider text-amber-200/70 flex items-center gap-1"><Settings2 size={11} /> Configuração necessária</div>
      {fields.map(f => (
        <label key={f.name} className="block">
          <span className="text-[11px] text-white/70">{f.label}{f.optional ? ' (opcional)' : ''}{f.secret ? ' 🔒' : ''}</span>
          {f.multiline ? (
            <textarea rows={2} value={draft[f.name] ?? ''} onChange={e => setDraft(d => ({ ...d, [f.name]: e.target.value }))} placeholder={f.placeholder}
              className="mt-0.5 w-full px-2 py-1 rounded bg-white/5 border border-white/10 text-[11px] text-white/80 font-mono focus:outline-none focus:border-amber-400/40" />
          ) : (
            <input type={f.secret ? 'password' : 'text'} autoComplete="off" value={draft[f.name] ?? ''} onChange={e => setDraft(d => ({ ...d, [f.name]: e.target.value }))}
              placeholder={f.secret ? (f.suggestion || 'cole aqui (fica guardado só neste PC)') : f.placeholder}
              className="mt-0.5 w-full px-2 py-1 rounded bg-white/5 border border-white/10 text-[11px] text-white/80 focus:outline-none focus:border-amber-400/40" />
          )}
          {f.help && <span className="text-[10px] text-white/35">{f.help}</span>}
        </label>
      ))}
      <button onClick={() => void save()} disabled={busy} className="px-2.5 py-1 rounded bg-amber-500/15 hover:bg-amber-500/25 text-amber-100 text-[11px] flex items-center gap-1 disabled:opacity-40">
        {busy ? <Loader2 size={11} className="animate-spin" /> : <Settings2 size={11} />} Salvar e testar
      </button>
    </div>
  )
}
