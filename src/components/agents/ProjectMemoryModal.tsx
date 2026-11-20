'use client'

import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { Brain, FileText, Loader2, Trash2, X } from 'lucide-react'
// Só o tipo: `projectMemory.ts` lê o disco, e importar o módulo aqui puxaria
// `fs` para o pacote do navegador. A importação de tipo some na compilação.
import type { ProjectMemory } from '@/lib/agents/projectMemory'
import { get, post } from './api'

const EMPTY_MEMORY: ProjectMemory = {
  objetivo: '', arquitetura: '', tecnologias: '', convencoes: '',
  decisoes: [], pendencias: [], preferencias: '', updatedAt: 0,
}

interface Instructions { file: string; content: string }

const CAMPOS: Array<{ key: keyof ProjectMemory; label: string; hint: string; rows: number }> = [
  { key: 'objetivo', label: 'Objetivo', hint: 'Para que serve este projeto', rows: 2 },
  { key: 'arquitetura', label: 'Arquitetura', hint: 'Como está montado: camadas, pastas, fluxo', rows: 3 },
  { key: 'tecnologias', label: 'Tecnologias', hint: 'Linguagens, frameworks e serviços', rows: 2 },
  { key: 'convencoes', label: 'Convenções de código', hint: 'Padrões e nomes a respeitar', rows: 3 },
  { key: 'preferencias', label: 'Suas preferências', hint: 'Como você quer que o JARVIS trabalhe aqui', rows: 2 },
]

/**
 * O que o JARVIS sabe sobre um projeto — e que ele lê antes de começar qualquer
 * trabalho nele. Fica separado por projeto: nada vaza de um para outro.
 */
export default function ProjectMemoryModal({ projectId, projectName, onClose }: {
  projectId: string
  projectName: string
  onClose: () => void
}) {
  const [memory, setMemory] = useState<ProjectMemory>(EMPTY_MEMORY)
  const [instructions, setInstructions] = useState<Instructions | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await get<{ memory: ProjectMemory; instructions: Instructions | null }>(`/api/projects?memory=${projectId}`)
      setMemory(d.memory)
      setInstructions(d.instructions)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => { void load() }, [load])

  const save = async () => {
    setSaving(true)
    try {
      const d = await post<{ memory: ProjectMemory }>('/api/projects', { action: 'memory-save', id: projectId, memory })
      setMemory(d.memory)
      toast.success('Memória do projeto salva — o JARVIS vai usar isso nas próximas execuções')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const removeItem = async (field: 'decisoes' | 'pendencias', text: string) => {
    try {
      const d = await post<{ memory: ProjectMemory }>('/api/projects', { action: 'memory-remove', id: projectId, field, text })
      setMemory(d.memory)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const clear = async () => {
    try {
      const d = await post<{ memory: ProjectMemory }>('/api/projects', { action: 'memory-clear', id: projectId, confirm: true })
      setMemory(d.memory)
      toast.success('Memória apagada')
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  // Portal para o <body>: o modal nasce dentro da barra lateral, que é um
  // contexto de empilhamento próprio — lá dentro, nenhum z-index o levanta
  // acima da tela inicial. Fora dela, z-[60] basta.
  if (typeof document === 'undefined') return null

  return createPortal(
    <div className="mo-backdrop fixed inset-0 z-[60] flex items-center justify-center bg-black/[.83] p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-2xl max-h-[88vh] flex flex-col rounded-2xl border border-white/10 bg-[#0a0f1a] overflow-hidden"
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10">
          <Brain size={15} className="text-white/60" />
          <div className="min-w-0 flex-1">
            <div className="text-sm text-white/90">Memória do projeto</div>
            <div className="text-[11px] text-white/35 truncate">{projectName}</div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-white/40 hover:text-white/80 hover:bg-white/5"><X size={15} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-white/35 py-6"><Loader2 size={12} className="animate-spin" /> carregando…</div>
          ) : (
            <>
              <p className="text-[11px] text-white/35 leading-relaxed">
                O JARVIS lê tudo isto antes de trabalhar neste projeto, para não redescobrir o
                mesmo a cada conversa. O agente também anota decisões aqui sozinho.
              </p>

              {instructions && (
                <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
                  <div className="flex items-center gap-1.5 text-[11px] text-white/60 mb-1">
                    <FileText size={11} /> Instruções na pasta do projeto · <span className="font-mono">{instructions.file}</span>
                  </div>
                  <pre className="text-[11px] font-mono text-white/45 whitespace-pre-wrap max-h-28 overflow-y-auto">{instructions.content.slice(0, 1200)}</pre>
                  <div className="text-[10px] text-white/25 mt-1">Este arquivo fica no seu repositório — edite-o por lá.</div>
                </div>
              )}

              {CAMPOS.map(c => (
                <label key={c.key} className="block">
                  <div className="text-[11px] text-white/55 mb-1">{c.label} <span className="text-white/25">— {c.hint}</span></div>
                  <textarea
                    value={String(memory[c.key] ?? '')}
                    rows={c.rows}
                    onChange={e => setMemory(m => ({ ...m, [c.key]: e.target.value }))}
                    className="input-jarvis w-full px-2.5 py-1.5 rounded-lg text-[12px] resize-y"
                  />
                </label>
              ))}

              {(['decisoes', 'pendencias'] as const).map(field => (
                <div key={field}>
                  <div className="text-[11px] text-white/55 mb-1">
                    {field === 'decisoes' ? 'Decisões técnicas' : 'Pendências'}
                    <span className="text-white/25"> — anotadas pelo agente enquanto trabalha</span>
                  </div>
                  {memory[field].length === 0
                    ? <div className="text-[11px] text-white/25">Nada registrado ainda.</div>
                    : (
                      <ul className="space-y-1">
                        {memory[field].map(item => (
                          <li key={item} className="flex items-start gap-2 text-[12px] text-white/70 rounded-lg bg-white/[0.03] px-2.5 py-1.5">
                            <span className="flex-1">{item}</span>
                            <button
                              onClick={() => removeItem(field, item)}
                              title="Apagar este registro"
                              className="text-white/25 hover:text-red-300 flex-shrink-0"
                            >
                              <Trash2 size={11} />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                </div>
              ))}
            </>
          )}
        </div>

        <div className="flex items-center gap-2 px-4 py-3 border-t border-white/10">
          <button onClick={clear} className="text-[11px] text-white/35 hover:text-red-300 transition-colors">Apagar tudo</button>
          <div className="flex-1" />
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-[12px] border border-white/15 text-white/65 hover:bg-white/5">Fechar</button>
          <button
            onClick={save}
            disabled={saving || loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-white text-black hover:bg-white/90 disabled:opacity-40"
          >
            {saving && <Loader2 size={11} className="animate-spin" />} Salvar
          </button>
        </div>
      </motion.div>
    </div>,
    document.body,
  )
}
