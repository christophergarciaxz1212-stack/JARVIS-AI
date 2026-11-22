'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { AlertTriangle, FolderOpen, X } from 'lucide-react'
import { toast } from 'sonner'
import { api } from './api'
import type { Project } from '@/lib/agents/types'
import type { Provider } from '@/types'
import { usePortalTarget } from '@/components/usePortalTarget'

// Modais abertos, do mais antigo ao mais recente: Esc fecha só o de cima (antes, um ConfirmDialog
// aberto dentro do Estúdio fechava o diálogo e o Estúdio inteiro de uma vez)
const modalStack: symbol[] = []

export function Modal({ children, onClose, width = 'max-w-lg' }: { children: React.ReactNode; onClose: () => void; width?: string }) {
  const target = usePortalTarget()
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const me = Symbol('modal')
    modalStack.push(me)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || modalStack[modalStack.length - 1] !== me) return
      e.stopPropagation()
      closeRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      const i = modalStack.indexOf(me)
      if (i >= 0) modalStack.splice(i, 1)
    }
  }, [])
  if (!target) return null
  return createPortal(
    <motion.div
      initial={false}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0 }, pointerEvents: 'none' }}
      className="mo-backdrop fixed inset-0 z-[60] bg-black/[.83] flex items-center justify-center p-4"
      onMouseDown={onClose}
    >
      <motion.div
        initial={false}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0, transition: { duration: 0 } }}
        className={`glass modal-pop rounded-2xl w-full ${width} max-h-[88vh] overflow-y-auto flex flex-col`}
        onMouseDown={e => e.stopPropagation()}
      >
        {children}
      </motion.div>
    </motion.div>,
    target,
  )
}

export function ConfirmDialog({
  title, children, confirmLabel, danger = true, onConfirm, onClose,
}: { title: string; children: React.ReactNode; confirmLabel: string; danger?: boolean; onConfirm: () => Promise<void> | void; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  return (
    <Modal onClose={onClose}>
      <div className="p-6">
        <div className="flex items-start gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${danger ? 'bg-red-500/15' : 'bg-cyan-500/15'}`}>
            <AlertTriangle size={18} className={danger ? 'text-red-300' : 'text-cyan-300'} />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-semibold text-white">{title}</h3>
            <div className="text-sm text-white/60 mt-2 space-y-2">{children}</div>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-white/60 hover:bg-white/5">Cancelar</button>
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try { await onConfirm(); onClose() } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
            }}
            className={`px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 ${danger ? 'bg-red-500/80 hover:bg-red-500 text-white' : 'bg-cyan-500/80 hover:bg-cyan-500 text-black'}`}
          >
            {busy ? 'Aguarde…' : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Models (shared cache so many pickers don't refetch) ─────────────────────

type HealthMap = Record<string, { state: 'ok' | 'cooling' | 'unavailable'; lastError?: string }>
let modelCache: { at: number; providers: Provider[]; health: HealthMap } | null = null

export function useModels() {
  const [data, setData] = useState(modelCache)
  useEffect(() => {
    if (modelCache && Date.now() - modelCache.at < 20_000) return
    Promise.all([api.models(), api.health().catch(() => ({ models: [] }))]).then(([providers, health]) => {
      const map: HealthMap = {}
      for (const m of health.models) map[m.model] = { state: m.state, lastError: m.lastError }
      modelCache = { at: Date.now(), providers, health: map }
      setData(modelCache)
    }).catch(() => {})
  }, [])
  return data
}

export function ModelPicker({ value, onChange, compact = false, disabled = false }: { value: string; onChange: (id: string) => void; compact?: boolean; disabled?: boolean }) {
  const data = useModels()
  const connected = (data?.providers || []).filter(p => p.status === 'connected' && p.models.length)
  const known = connected.some(p => p.models.some(m => m.id === value))
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={e => onChange(e.target.value)}
      className={`input-jarvis rounded-lg font-mono ${compact ? 'text-[10px] px-1.5 py-1 max-w-[150px]' : 'text-xs px-2 py-1.5 w-full'} disabled:opacity-50`}
      title="Modelo deste agente"
    >
      <option value="auto">⚡ Automático (mais rápido disponível)</option>
      {!known && value !== 'auto' && <option value={value}>{value.split('|').pop()} (não conectado)</option>}
      {connected.map(p => (
        <optgroup key={p.id} label={`${p.name}`}>
          {p.models.map(m => {
            const h = data?.health[m.id]
            const flag = h?.state === 'unavailable' ? ' ⛔ indisponível' : h?.state === 'cooling' ? ' ⏳ limite atingido' : ''
            return (
              <option key={m.id} value={m.id} disabled={h?.state === 'unavailable'}>
                {m.name}{m.free ? ' · grátis' : ' · pago'}{flag}
              </option>
            )
          })}
        </optgroup>
      ))}
    </select>
  )
}

// ─── New project ─────────────────────────────────────────────────────────────

export function ProjectDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (p: Project) => void }) {
  const [name, setName] = useState('')
  const [folder, setFolder] = useState('')
  const [busy, setBusy] = useState(false)
  const canPick = typeof window !== 'undefined' && !!window.electron?.pickFolder

  const pick = async () => {
    const f = await window.electron!.pickFolder!()
    if (f) { setFolder(f); if (!name) setName(f.split(/[\\/]/).pop() || '') }
  }

  return (
    <Modal onClose={onClose}>
      <div className="p-6 border-b border-white/5 flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold jarvis-title">NOVO PROJETO</h3>
          <p className="text-xs text-white/40 mt-0.5">Cada projeto tem seu próprio histórico de sessões. A equipe de agentes trabalha na pasta escolhida.</p>
        </div>
        <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/5"><X size={16} className="text-white/50" /></button>
      </div>
      <div className="p-6 space-y-4">
        <label className="block">
          <span className="text-xs text-white/50">Pasta do projeto</span>
          <div className="flex gap-2 mt-1">
            <input value={folder} onChange={e => setFolder(e.target.value)} placeholder="C:\Users\voce\Documents\meu-projeto" className="input-jarvis flex-1 px-3 py-2 rounded-lg text-sm font-mono" />
            {canPick && (
              <button onClick={pick} className="flex items-center gap-1.5 px-3 rounded-lg text-xs bg-cyan-500/15 text-cyan-200 hover:bg-cyan-500/25">
                <FolderOpen size={14} /> Escolher
              </button>
            )}
          </div>
        </label>
        <label className="block">
          <span className="text-xs text-white/50">Nome</span>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Meu projeto" className="input-jarvis w-full mt-1 px-3 py-2 rounded-lg text-sm" />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-white/60 hover:bg-white/5">Cancelar</button>
          <button
            disabled={!folder.trim() || busy}
            onClick={async () => {
              setBusy(true)
              try { const p = await api.createProject(name, folder.trim()); toast.success(`Projeto "${p.name}" pronto`); onCreated(p); onClose() }
              catch (e) { toast.error((e as Error).message) }
              finally { setBusy(false) }
            }}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-cyan-500/80 hover:bg-cyan-500 text-black disabled:opacity-40"
          >
            Criar projeto
          </button>
        </div>
      </div>
    </Modal>
  )
}

export const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  waiting: { label: 'Aguardando', cls: 'bg-white/5 text-white/50' },
  planning: { label: 'Planejando', cls: 'bg-violet-500/15 text-violet-300 animate-pulse' },
  executing: { label: 'Executando', cls: 'bg-cyan-500/15 text-cyan-300 animate-pulse' },
  communicating: { label: 'Comunicando-se', cls: 'bg-sky-500/15 text-sky-300 animate-pulse' },
  reviewing: { label: 'Revisando', cls: 'bg-amber-500/15 text-amber-300 animate-pulse' },
  paused: { label: 'Pausado', cls: 'bg-orange-500/15 text-orange-300' },
  done: { label: 'Concluído', cls: 'bg-green-500/15 text-green-300' },
  failed: { label: 'Falhou', cls: 'bg-red-500/15 text-red-300' },
}

export const RUN_STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  queued: { label: 'Na fila', cls: 'text-white/50' },
  awaiting_plan: { label: 'Aguardando aprovação', cls: 'text-amber-300 animate-pulse' },
  analyzing: { label: 'Analisando', cls: 'text-violet-300' },
  planning: { label: 'Planejando', cls: 'text-violet-300' },
  running: { label: 'Executando', cls: 'text-cyan-300' },
  paused: { label: 'Pausada', cls: 'text-orange-300' },
  integrating: { label: 'Integrando', cls: 'text-sky-300' },
  completed: { label: 'Concluída', cls: 'text-green-300' },
  failed: { label: 'Falhou', cls: 'text-red-300' },
  cancelled: { label: 'Cancelada', cls: 'text-white/50' },
  interrupted: { label: 'Interrompida', cls: 'text-orange-300' },
}
