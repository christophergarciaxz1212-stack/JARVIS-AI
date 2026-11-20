'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowDown, ArrowUp, CornerDownLeft, Loader2, Search, Sparkles } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Provider } from '@/types'

export interface PaletteCommand {
  id: string
  label: string
  hint?: string
  group: string
  icon: LucideIcon
  keywords?: string
  shortcut?: string
  run: () => void
}

interface PaletteItem {
  id: string
  label: string
  hint?: string
  group: string
  icon: LucideIcon
  shortcut?: string
  active?: boolean
  run: () => void
}

const GROUP_ORDER = ['Ações', 'Navegação', 'Painéis', 'Modelos']

function normalize(text: string) {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

function matches(query: string, ...fields: Array<string | undefined>) {
  const terms = normalize(query).split(/\s+/).filter(Boolean)
  if (!terms.length) return true
  const haystack = normalize(fields.filter(Boolean).join(' '))
  return terms.every(term => haystack.includes(term))
}

/**
 * Central de comandos (Ctrl+K): executa ações reais da tela e troca de modelo
 * sem passar pelo gerenciador. Os modelos vêm do catálogo ao vivo, não de uma
 * lista simulada.
 */
export default function CommandPalette({
  open,
  onClose,
  commands,
  currentModel,
  onSelectModel,
}: {
  open: boolean
  onClose: () => void
  commands: PaletteCommand[]
  currentModel: string
  onSelectModel: (id: string) => void
}) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [providers, setProviders] = useState<Provider[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setSelected(0)
    const timer = setTimeout(() => inputRef.current?.focus(), 30)
    let cancelled = false
    setLoadingModels(true)
    fetch('/api/models')
      .then(r => r.json())
      .then(d => { if (!cancelled) setProviders(Array.isArray(d.providers) ? d.providers : []) })
      .catch(() => { if (!cancelled) setProviders([]) })
      .finally(() => { if (!cancelled) setLoadingModels(false) })
    return () => { cancelled = true; clearTimeout(timer) }
  }, [open])

  const items = useMemo<PaletteItem[]>(() => {
    const base: PaletteItem[] = commands
      .filter(c => matches(query, c.label, c.hint, c.keywords, c.group))
      .map(c => ({ ...c, icon: c.icon }))

    const models: PaletteItem[] = providers
      .filter(p => p.status === 'connected' && p.models.length)
      .flatMap(p => p.models)
      .filter(m => matches(query, m.id, m.name, m.providerName))
      .slice(0, query ? 10 : 0)
      .map(m => ({
        id: `model:${m.id}`,
        label: m.name,
        hint: `${m.providerName}${m.multimodal ? ' · visão' : ''}${m.toolSupport ? ' · ferramentas' : ''}`,
        group: 'Modelos',
        icon: Sparkles,
        active: m.id === currentModel,
        shortcut: m.free ? 'grátis' : undefined,
        run: () => onSelectModel(m.id),
      }))

    // Sem busca, os modelos não ocupam a lista inteira: o gerenciador continua a um comando.
    const order = (group: string) => {
      const i = GROUP_ORDER.indexOf(group)
      return i === -1 ? GROUP_ORDER.length : i
    }
    return [...base, ...models].sort((a, b) => order(a.group) - order(b.group))
  }, [commands, currentModel, onSelectModel, providers, query])

  useEffect(() => { setSelected(0) }, [query])

  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${selected}"]`)
    node?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const run = (item: PaletteItem) => {
    onClose()
    // Deixa o overlay sair antes de abrir um painel de tela cheia
    setTimeout(item.run, 10)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(i => Math.min(items.length - 1, i + 1)); return }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(i => Math.max(0, i - 1)); return }
    if (e.key === 'Enter' && items[selected]) { e.preventDefault(); run(items[selected]) }
  }

  let lastGroup = ''

  return (
    <AnimatePresence>
      {open && (
      <motion.div
        className="cmd-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.16 }}
        onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
      >
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label="Central de comandos"
          className="cmd-panel"
          initial={{ opacity: 0, y: -10, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.99 }}
          transition={{ type: 'spring', stiffness: 520, damping: 38, mass: 0.7 }}
        >
          <div className="cmd-search">
            <Search size={16} className="text-white/35 flex-shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Buscar ação ou modelo…"
              aria-label="Buscar comando"
              spellCheck={false}
            />
            {loadingModels && <Loader2 size={13} className="animate-spin text-white/25" />}
            <kbd className="kbd">ESC</kbd>
          </div>

          <div ref={listRef} className="cmd-list" role="listbox">
            {items.map((item, i) => {
              const header = item.group !== lastGroup ? item.group : ''
              lastGroup = item.group
              const Icon = item.icon
              return (
                <div key={item.id}>
                  {header && <div className="cmd-group">{header}</div>}
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === selected}
                    data-index={i}
                    onMouseEnter={() => setSelected(i)}
                    onClick={() => run(item)}
                    className={`cmd-item ${i === selected ? 'is-active' : ''}`}
                  >
                    <span className="cmd-icon"><Icon size={15} /></span>
                    <span className="min-w-0 flex-1 text-left">
                      <span className="block truncate text-[13px] text-white/85">{item.label}</span>
                      {item.hint && <span className="block truncate text-[10.5px] text-white/35">{item.hint}</span>}
                    </span>
                    {item.active && <span className="cmd-current">atual</span>}
                    {item.shortcut && <span className="cmd-tag">{item.shortcut}</span>}
                  </button>
                </div>
              )
            })}

            {!items.length && (
              <div className="px-5 py-10 text-center text-xs text-white/35">
                {loadingModels ? 'Carregando catálogo…' : `Nada encontrado para “${query}”.`}
              </div>
            )}
          </div>

          <div className="cmd-footer">
            <span><ArrowUp size={10} /><ArrowDown size={10} /> navegar</span>
            <span><CornerDownLeft size={10} /> executar</span>
            <span className="ml-auto text-white/20">{items.length} comandos</span>
          </div>
        </motion.div>
      </motion.div>
      )}
    </AnimatePresence>
  )
}
