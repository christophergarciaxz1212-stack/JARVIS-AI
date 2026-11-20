'use client'

import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'

interface Item { cmd: string; label: string; hint: string }

const BUILTIN: Item[] = [
  { cmd: 'video', label: '🎬 /video', hint: 'cria um vídeo de motion design (Estúdio Motion)' },
  { cmd: 'imagem', label: '🖼️ /imagem', hint: 'gera uma imagem grátis' },
  { cmd: 'council', label: '🏛️ /council', hint: 'vários modelos respondem; o árbitro consolida' },
  { cmd: 'self-improve', label: '🔍 /self-improve', hint: 'varredura do próprio código + 5 melhorias medidas' },
]

const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/** Appears while the message is "/algo": built-in commands + installed Skills. Tab or click completes. */
export default function SlashMenu({ input, onPick }: { input: string; onPick: (text: string) => void }) {
  const [skills, setSkills] = useState<Item[] | null>(null)
  const active = /^\/[\w.-]*$/.test(input)

  useEffect(() => {
    if (!active || skills) return
    fetch('/api/engine?action=catalog', { cache: 'no-store' }).then(r => r.json()).then(d => {
      const exts = (d.extensions || []) as Array<{ name: string; description: string; enabled: boolean; kind: string }>
      setSkills(exts.filter(e => e.enabled).map(e => ({ cmd: slug(e.name), label: `/${slug(e.name)}`, hint: `${e.kind === 'skill' ? 'skill' : e.kind} · ${e.description.slice(0, 80)}` })))
    }).catch(() => setSkills([]))
  }, [active, skills])

  const q = input.slice(1).toLowerCase()
  const items = useMemo(() => [...BUILTIN, ...(skills || [])].filter(i => i.cmd.startsWith(slug(q)) || i.cmd.includes(slug(q))).slice(0, 8), [q, skills])

  useEffect(() => {
    if (!active || !items.length) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab') { e.preventDefault(); onPick(`/${items[0].cmd} `) }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [active, items, onPick])

  if (!active) return null
  return (
    <motion.div initial={false} animate={{ opacity: 1, y: 0 }} className="mo-stagger absolute bottom-full left-0 right-0 mb-2 glass rounded-xl border border-cyan-500/20 p-1.5 z-30">
      {items.map(i => (
        <button key={i.cmd} onMouseDown={e => { e.preventDefault(); onPick(`/${i.cmd} `) }} className="w-full text-left flex items-baseline gap-2 px-2.5 py-1.5 rounded-lg hover:bg-cyan-500/10">
          <span className="text-xs font-mono text-cyan-200">{i.label}</span>
          <span className="text-[11px] text-white/40 truncate">{i.hint}</span>
        </button>
      ))}
      {!items.length && <div className="px-2.5 py-1.5 text-[11px] text-white/35">{skills === null ? 'Carregando skills…' : 'Nenhuma skill com esse nome. Instale skills em ⚡ Skills › Skill Engine.'}</div>}
      <div className="px-2.5 pt-1 text-[10px] text-white/25">Tab completa · a skill vale só para esta mensagem</div>
    </motion.div>
  )
}
