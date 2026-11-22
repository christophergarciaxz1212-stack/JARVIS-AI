'use client'

import { useCallback, useEffect, useState } from 'react'
import { Activity, Loader2, Play, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

/** Uma linha real, medida pelo módulo src/lib/ai/audit.ts — nada é simulado. */
interface AuditRow {
  provider: string
  model: string
  ok: boolean
  ms: number
  level: number
  reached: number
  capability: {
    stream: boolean | null
    json: boolean | null
    reasoning: boolean | null
    code: boolean | null
    tools: boolean | null
  }
  error?: string
  sample?: string
  at: number
}

function Capability({ label, value }: { label: string; value: boolean | null | undefined }) {
  const text = value == null ? '—' : value ? 'sim' : 'não'
  const cls = value == null ? 'text-white/30' : value ? 'text-emerald-300' : 'text-amber-300'
  return <span className={`tabular-nums ${cls}`} title={`${label}: ${text}`}>{text}</span>
}

export default function AuditPanel() {
  const [rows, setRows] = useState<AuditRow[]>([])
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [level, setLevel] = useState(3)
  const [limit, setLimit] = useState(20)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/audit', { cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Não foi possível carregar a auditoria')
      setRows(Array.isArray(data.results) ? data.results : [])
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const run = async () => {
    setRunning(true)
    setError(null)
    try {
      const res = await fetch('/api/audit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ level, limit }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Não foi possível auditar os modelos')
      await load()
      toast.success(`${data.ran || 0} modelo(s) auditado(s)`)
    } catch (e) {
      const msg = (e as Error).message
      setError(msg)
      toast.error(msg)
    } finally {
      setRunning(false)
    }
  }

  const latest = rows.length ? new Date(rows[0].at).toLocaleString('pt-BR') : null
  const passed = rows.filter(r => r.ok).length

  return (
    <div className="space-y-4">
      <div className="text-[11px] text-white/45">
        Cada modelo é chamado de verdade, com o mesmo cliente do chat. N1 comunicação · N2 raciocínio · N3 código · N4 engenharia (JSON) · N5 autonomia (ferramenta). Nada é marcado como “não” por cota, rede ou sobrecarga — esses casos ficam como “—”.
      </div>

      <div className="rounded-xl border border-white/10 p-3 space-y-3">
        <div className="flex items-center gap-2 text-xs text-white/80"><Activity size={13} className="text-cyan-300" /> Nova auditoria</div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-[11px] text-white/50">
            Nível alvo
            <select value={level} onChange={e => setLevel(Number(e.target.value))} disabled={running} className="input-jarvis px-2 py-1.5 rounded-lg text-xs">
              {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>N{n}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-white/50">
            Modelos (gratuitos)
            <input type="number" min={1} max={50} value={limit} onChange={e => setLimit(Math.max(1, Math.min(50, Number(e.target.value) || 1)))} disabled={running} className="input-jarvis w-20 px-2 py-1.5 rounded-lg text-xs" />
          </label>
          <button onClick={run} disabled={running} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-cyan-500/15 text-cyan-100 border border-cyan-500/25 hover:bg-cyan-500/25 disabled:opacity-40">
            {running ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} Auditar
          </button>
          <button onClick={() => void load()} disabled={loading || running} title="Recarregar resultados salvos" aria-label="Recarregar resultados salvos" className="p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/5 disabled:opacity-40">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
        <div className="text-[10px] text-white/30">Pode levar alguns minutos: cada nível faz uma chamada real por modelo. Nenhuma chave é enviada para outros provedores ou modelos.</div>
      </div>

      {error && <div role="alert" className="rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200/90">{error}</div>}

      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-white/70">
          <span>Resultados salvos neste computador</span>
          {latest && <span className="text-[10px] text-white/35">{rows.length} modelo(s) · {passed} ok · {latest}</span>}
        </div>

        {loading && <div className="flex items-center gap-2 text-[11px] text-white/40"><Loader2 size={12} className="animate-spin" /> Carregando…</div>}

        {!loading && !rows.length && (
          <div className="rounded-xl border border-white/10 p-4 text-center text-[11px] text-white/40">
            Nenhuma auditoria registrada ainda. Clique em <span className="text-cyan-200">Auditar</span> para medir os modelos conectados.
          </div>
        )}

        {!loading && rows.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full text-[11px] border-collapse">
              <thead>
                <tr className="text-white/40 text-left border-b border-white/10">
                  <th className="px-2 py-1.5 font-normal">Modelo</th>
                  <th className="px-2 py-1.5 font-normal">Nível</th>
                  <th className="px-2 py-1.5 font-normal">ms</th>
                  <th className="px-2 py-1.5 font-normal" title="Comunicação">N1</th>
                  <th className="px-2 py-1.5 font-normal" title="Raciocínio">N2</th>
                  <th className="px-2 py-1.5 font-normal" title="Código">N3</th>
                  <th className="px-2 py-1.5 font-normal" title="Engenharia (JSON)">N4</th>
                  <th className="px-2 py-1.5 font-normal" title="Autonomia (ferramenta)">N5</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={`${r.model}-${r.at}`} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                    <td className="px-2 py-1.5 max-w-[220px] truncate text-white/80" title={r.model}>{r.model}</td>
                    <td className="px-2 py-1.5 tabular-nums text-white/60">{r.reached}/{r.level}</td>
                    <td className="px-2 py-1.5 tabular-nums text-white/50">{r.ms}</td>
                    <td className="px-2 py-1.5"><Capability label="Comunicação" value={r.capability.stream} /></td>
                    <td className="px-2 py-1.5"><Capability label="Raciocínio" value={r.capability.reasoning} /></td>
                    <td className="px-2 py-1.5"><Capability label="Código" value={r.capability.code} /></td>
                    <td className="px-2 py-1.5"><Capability label="Engenharia" value={r.capability.json} /></td>
                    <td className="px-2 py-1.5"><Capability label="Autonomia" value={r.capability.tools} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && rows.some(r => r.error) && (
          <div className="space-y-1">
            <div className="text-[11px] text-white/45">Problemas observados (sem segredos):</div>
            {rows.filter(r => r.error).slice(0, 8).map(r => (
              <div key={`err-${r.model}-${r.at}`} className="text-[10px] text-amber-200/75 break-words"><span className="text-white/50">{r.model}:</span> {r.error}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
