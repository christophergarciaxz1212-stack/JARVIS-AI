'use client'

/**
 * JARVIS — Assistente de Primeira Configuração.
 * Mostra de verdade o que o computador tem (detecção via /api/setup) e o que falta,
 * com instalação explícita via WinGet (nunca automática). Escreve o marcador
 * data/logs/.first-run-done quando o usuário conclui.
 */
import { useCallback, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Monitor, Cpu, MemoryStick, HardDrive, Wifi, KeyRound, CheckCircle2, AlertTriangle,
  X, Download, RefreshCw, ChevronDown, Chrome, Bot, GitBranch, Wrench, FolderOpen, ShieldCheck, Sparkles,
} from 'lucide-react'

interface SetupReport {
  platform: { label: string; version: string; build?: string; arch: string }
  cpu: { model: string; cores: number; load: number }
  memory: { totalGB: number; freeGB: number }
  disk: { freeGB: number | null; totalGB: number | null }
  gpu: { name: string | null; vendor: string; vramMB: number | null }
  admin: boolean
  internet: { ok: boolean; latencyMs: number | null }
  tools: {
    chrome: { ok: boolean; detail: string }
    ollama: { ok: boolean; detail: string; models: string[] }
    git: { ok: boolean; detail: string }
    winget: { ok: boolean; detail: string }
    node: { ok: boolean; detail: string }
  }
  keys: { configured: string[]; missing: string[] }
  directories: { ok: boolean; detail: string; created: string[] }
  video: { browser: boolean; codecH264: boolean }
  ready: boolean
  warnings: string[]
}

type Phase = 'detecting' | 'ready'

export default function FirstRunSetup({ onDone, onSkip }: { onDone: () => void; onSkip: () => void }) {
  const [phase, setPhase] = useState<Phase>('detecting')
  const [report, setReport] = useState<SetupReport | null>(null)
  const [detecting, setDetecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [installing, setInstalling] = useState<string | null>(null)
  const [installResult, setInstallResult] = useState<Record<string, string>>({})
  const [repairing, setRepairing] = useState<string | null>(null)
  const [repairResult, setRepairResult] = useState<Record<string, string>>({})
  const [finishing, setFinishing] = useState(false)

  const detect = useCallback(async () => {
    setDetecting(true)
    setError(null)
    try {
      const r = await fetch('/api/setup?action=detect', { cache: 'no-store' })
      const data = (await r.json()) as { report?: SetupReport; error?: string }
      if (!r.ok || !data.report) throw new Error(data.error || 'Falha na detecção')
      setReport(data.report)
      setPhase('ready')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setDetecting(false)
    }
  }, [])

  useEffect(() => { void detect() }, [detect])

  const install = async (id: string) => {
    setInstalling(id)
    setInstallResult(prev => ({ ...prev, [id]: '' }))
    try {
      const r = await fetch('/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'winget', id }) })
      const data = (await r.json()) as { ok: boolean; detail: string }
      setInstallResult(prev => ({ ...prev, [id]: data.detail }))
      // Atualiza o diagnóstico após a instalação
      void detect()
    } catch (e) {
      setInstallResult(prev => ({ ...prev, [id]: `Falha: ${(e as Error).message}` }))
    } finally {
      setInstalling(null)
    }
  }

  const repair = async (fix: string) => {
    setRepairing(fix)
    try {
      const r = await fetch('/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'repair', fix }) })
      const data = (await r.json()) as { ok: boolean; detail: string }
      setRepairResult(prev => ({ ...prev, [fix]: data.detail }))
      void detect()
    } catch (e) {
      setRepairResult(prev => ({ ...prev, [fix]: `Falha: ${(e as Error).message}` }))
    } finally {
      setRepairing(null)
    }
  }

  const finish = async () => {
    setFinishing(true)
    try {
      await fetch('/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'ack' }) })
      onDone()
    } finally {
      setFinishing(false)
    }
  }

  const missing = report ? [
    ...(report.tools.chrome.ok ? [] : [{ id: 'Google.Chrome', icon: Chrome, label: 'Google Chrome', note: report.tools.chrome.detail }]),
    ...(report.tools.ollama.ok ? [] : [{ id: 'Ollama.Ollama', icon: Bot, label: 'Ollama', note: 'Modelos de IA locais grátis (opcional)' }]),
    ...(report.tools.git.ok ? [] : [{ id: 'Git.Git', icon: GitBranch, label: 'Git', note: 'Fluxos de repositório (opcional)' }]),
  ] : []

  return (
    <div className="mo-backdrop fixed inset-0 z-[100] flex items-center justify-center bg-black/85 backdrop-blur-md p-4" role="dialog" aria-modal="true" aria-label="Assistente de Primeira Configuração do JARVIS">
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#0e0e11] shadow-2xl shadow-black/60"
      >
        {/* Cabeçalho */}
        <div className="flex items-center justify-between border-b border-white/5 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-fuchsia-500/30 to-cyan-500/30 border border-fuchsia-400/25">
              <Sparkles size={16} className="text-fuchsia-200" />
            </div>
            <div>
              <div className="text-sm font-semibold tracking-wide text-white/90">JARVIS <span className="text-white/35 font-normal">· Assistente de Primeira Configuração</span></div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-white/30">primeira execução</div>
            </div>
          </div>
          <button onClick={onSkip} title="Pular por agora (você será perguntado de novo na próxima abertura)" className="rounded-lg p-2 text-white/35 hover:bg-white/5 hover:text-white/70 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* ── Detectando ─────────────────────────────────────────── */}
          {phase === 'detecting' && (
            <div className="py-8 flex flex-col items-center gap-4 text-center">
              <RefreshCw size={26} className="animate-spin text-cyan-300" />
              <div>
                <div className="text-sm font-medium text-white/85">Analisando seu computador de verdade…</div>
                <div className="mt-1 text-[11px] text-white/40">SO, CPU, RAM, disco, GPU, internet, Chrome, Ollama e chaves de IA</div>
              </div>
              {error && <p className="text-xs text-red-300/90 max-w-md">Falha na detecção: {error}</p>}
              {error && <button onClick={detect} className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-xs text-white/80 hover:bg-white/10"><RefreshCw size={12} /> Tentar de novo</button>}
            </div>
          )}

          {/* ── Diagnóstico ────────────────────────────────────────── */}
          {phase === 'ready' && report && (
            <>
              {/* Grade de hardware/software */}
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <Cell icon={Monitor} label="Sistema" value={`${report.platform.label}${report.platform.build ? ` (build ${report.platform.build})` : ''} · ${report.platform.arch}`} ok={true} />
                <Cell icon={Cpu} label="Processador" value={`${report.cpu.model.length > 42 ? report.cpu.model.slice(0, 42) + '…' : report.cpu.model} · ${report.cpu.cores} núcleos`} ok={true} />
                <Cell icon={MemoryStick} label="Memória RAM" value={`${report.memory.totalGB} GB (${report.memory.freeGB} GB livres)`} ok={report.memory.totalGB >= 4} />
                <Cell icon={HardDrive} label="Disco livre" value={report.disk.freeGB === null ? 'não medido' : `${report.disk.freeGB} GB livres${report.disk.totalGB ? ` de ${report.disk.totalGB} GB` : ''}`} ok={report.disk.freeGB === null || report.disk.freeGB >= 2} />
                <Cell icon={Download} label="Placa de vídeo" value={report.gpu.name ? `${report.gpu.name}${report.gpu.vramMB ? ` · ${Math.round(report.gpu.vramMB / 1024)} GB VRAM` : ''}` : 'não detectada (o JARVIS roda sem GPU)'} ok={true} />
                <Cell icon={Wifi} label="Internet" value={report.internet.ok ? `online · ${report.internet.latencyMs}ms` : 'sem conexão (IA em nuvem indisponível)'} ok={report.internet.ok} />
                <Cell icon={Chrome} label="Chrome/Edge" value={report.tools.chrome.ok ? 'encontrado — motor de vídeo (WebCodecs) pronto' : 'não encontrado'} ok={report.tools.chrome.ok} />
                <Cell icon={Bot} label="Ollama" value={report.tools.ollama.ok ? report.tools.ollama.detail : 'não ativo (opcional)'} ok={true} />
                <Cell icon={GitBranch} label="Git" value={report.tools.git.ok ? report.tools.git.detail : 'não encontrado (opcional)'} ok={true} />
                <Cell icon={KeyRound} label="Chaves de IA" value={report.keys.configured.length ? `${report.keys.configured.length} configurada(s): ${report.keys.configured.join(', ')}` : 'nenhuma configurada ainda'} ok={report.keys.configured.length > 0} />
                <Cell icon={FolderOpen} label="Diretórios de dados" value={report.directories.ok ? `criados e graváveis${report.directories.created.length ? ` (${report.directories.created.join(', ')})` : ''}` : 'falha ao preparar'} ok={report.directories.ok} />
                <Cell icon={ShieldCheck} label="Node do JARVIS" value={report.tools.node.detail} ok={true} />
              </div>

              {/* Avisos honestos */}
              {report.warnings.length > 0 && (
                <div className="rounded-xl border border-amber-400/20 bg-amber-500/[0.06] px-4 py-2.5">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-200"><AlertTriangle size={12} /> Pontos de atenção</div>
                  <ul className="mt-1.5 list-disc pl-5 text-[11px] text-amber-100/85 space-y-0.5">
                    {report.warnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </div>
              )}

              {/* O que falta + instalação explícita */}
              {missing.length > 0 && (
                <div className="rounded-xl border border-cyan-400/20 bg-cyan-500/[0.06] px-4 py-3">
                  <div className="text-[11px] font-semibold text-cyan-200">Componentes faltantes (instalação só com o seu clique — nada é feito automaticamente)</div>
                  <div className="mt-2 space-y-1.5">
                    {missing.map(m => (
                      <div key={m.id} className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-black/30 px-3 py-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <m.icon size={14} className="shrink-0 text-white/50" />
                          <div className="min-w-0">
                            <div className="text-[11px] font-medium text-white/85">{m.label}</div>
                            <div className="truncate text-[9.5px] text-white/40">{m.note}</div>
                          </div>
                        </div>
                        <button
                          onClick={() => install(m.id)}
                          disabled={installing !== null}
                          className="flex shrink-0 items-center gap-1.5 rounded-md border border-cyan-400/30 bg-cyan-500/15 px-2.5 py-1.5 text-[10px] font-semibold text-cyan-100 hover:bg-cyan-500/25 disabled:opacity-40"
                        >
                          {installing === m.id ? <RefreshCw size={11} className="animate-spin" /> : <Download size={11} />} Instalar (WinGet)
                        </button>
                      </div>
                    ))}
                  </div>
                  {Object.entries(installResult).filter(([, v]) => v).map(([k, v]) => (
                    <p key={k} className="mt-1.5 text-[10px] text-cyan-100/70">{k.split('.')[1]}: {v}</p>
                  ))}
                  {!report.tools.winget.ok && <p className="mt-1.5 text-[10px] text-white/40">WinGet não encontrado — instale o “App Installer” pela Microsoft Store ou baixe cada componente pelo site oficial.</p>}
                </div>
              )}

              {/* Reparos */}
              <div className="flex flex-wrap gap-1.5">
                <RepairButton label="Recriar diretórios de dados" fix="dirs" current={repairResult['dirs']} busy={repairing === 'dirs'} onClick={repair} />
                <RepairButton label="Criar keys.json" fix="keys-file" current={repairResult['keys-file']} busy={repairing === 'keys-file'} onClick={repair} />
                <RepairButton label="Criar prefs.json" fix="prefs" current={repairResult['prefs']} busy={repairing === 'prefs'} onClick={repair} />
                <RepairButton label="Criar .env.local do exemplo" fix="env-example" current={repairResult['env-example']} busy={repairing === 'env-example'} onClick={repair} />
                <button onClick={detect} className="flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-[10px] text-white/70 hover:bg-white/10"><RefreshCw size={10} /> Verificar novamente</button>
              </div>
              {Object.entries(repairResult).filter(([, v]) => v).map(([k, v]) => (
                <p key={k} className="text-[10px] text-emerald-200/75">{k}: {v}</p>
              ))}

              {/* Detalhes técnicos expansíveis */}
              <details className="group rounded-xl border border-white/5 bg-black/30">
                <summary className="flex cursor-pointer items-center justify-between px-4 py-2.5 text-[11px] text-white/50 hover:text-white/75">
                  Detalhes técnicos (JSON real desta máquina)
                  <ChevronDown size={12} className="transition-transform group-open:rotate-180" />
                </summary>
                <pre className="max-h-48 overflow-auto border-t border-white/5 px-4 py-3 text-[9.5px] leading-relaxed text-white/45">{JSON.stringify(report, null, 1)}</pre>
              </details>

              {/* Ações finais */}
              <div className="flex items-center justify-between gap-3 border-t border-white/5 pt-4">
                <button onClick={onSkip} className="text-[11px] text-white/40 hover:text-white/70">Pular por agora</button>
                <button
                  onClick={finish}
                  disabled={finishing}
                  className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-fuchsia-500 to-cyan-500 px-5 py-2.5 text-[12px] font-semibold text-white shadow-lg shadow-fuchsia-500/20 hover:brightness-110 disabled:opacity-50"
                >
                  {finishing ? <RefreshCw size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                  Concluir — começar a usar o JARVIS
                </button>
              </div>
            </>
          )}
        </div>
      </motion.div>
    </div>
  )
}

function Cell({ icon: Icon, label, value, ok }: { icon: typeof Monitor; label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2">
      <Icon size={14} className={`mt-0.5 shrink-0 ${ok ? 'text-emerald-300/80' : 'text-amber-300/90'}`} />
      <div className="min-w-0">
        <div className="text-[9px] uppercase tracking-wider text-white/35">{label}</div>
        <div className="mt-0.5 text-[10.5px] leading-snug text-white/80 break-words">{value}</div>
      </div>
    </div>
  )
}

function RepairButton({ label, fix, current, busy, onClick }: { label: string; fix: string; current?: string; busy: boolean; onClick: (fix: string) => void }) {
  return (
    <button onClick={() => onClick(fix)} disabled={busy} className="flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-[10px] text-white/70 hover:bg-white/10 disabled:opacity-40">
      {busy ? <RefreshCw size={10} className="animate-spin" /> : <Wrench size={10} />} {label}{current ? '' : ''}
    </button>
  )
}
