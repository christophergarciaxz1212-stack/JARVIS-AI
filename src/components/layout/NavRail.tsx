'use client'

import { motion } from 'framer-motion'
import { Clapperboard, GraduationCap, KeyRound, MessageCircle, MessageSquare, Package, Settings, TrendingUp, Users } from 'lucide-react'
import JarvisLogo from '@/components/chat/JarvisLogo'

export type RailItem = 'chat' | 'team' | 'hub' | 'social' | 'motion' | 'skills' | 'whatsapp'

const ITEMS: Array<{ id: RailItem; label: string; hint: string; icon: typeof MessageSquare }> = [
  { id: 'chat', label: 'Chat', hint: 'Nova conversa (Ctrl+N)', icon: MessageSquare },
  { id: 'team', label: 'Equipe', hint: 'Sessão com equipe de agentes', icon: Users },
  { id: 'hub', label: 'Faculdade', hint: 'Hub Escolar: disciplinas, provas e trabalhos', icon: GraduationCap },
  { id: 'social', label: 'Social', hint: 'Instagram e TikTok (Metricool)', icon: TrendingUp },
  { id: 'motion', label: 'Estúdio', hint: 'Estúdio de Vídeo: produção audiovisual com IA', icon: Clapperboard },
  { id: 'skills', label: 'Skills', hint: 'Skill Engine: skills, plugins e MCP', icon: Package },
  { id: 'whatsapp', label: 'WhatsApp', hint: 'WhatsApp Center: integração oficial Meta', icon: MessageCircle },
]

/** Fixed left navigation: one place for every area of JARVIS (no duplicated buttons in the top bar). */
export default function NavRail({ active, onSelect, onKeys, onSettings, keysMissing }: {
  active: RailItem
  onSelect: (item: RailItem) => void
  onKeys: () => void
  onSettings: () => void
  keysMissing: boolean
}) {
  return (
    <nav className="relative z-20 w-[64px] flex-shrink-0 flex flex-col items-center py-3 gap-1 border-r border-cyan-500/10 bg-[rgba(3,7,13,0.94)]" aria-label="Navegação">
      <div className="mb-3 rail-logo" title="JARVIS">
        <JarvisLogo size={30} speed={1.6} />
      </div>
      {ITEMS.map(({ id, label, hint, icon: Icon }) => {
        const on = active === id
        return (
          <button key={id} onClick={() => onSelect(id)} title={hint} aria-current={on ? 'page' : undefined}
            className={`rail-btn group relative w-[52px] py-2 rounded-xl flex flex-col items-center gap-1 ${on ? 'text-cyan-100' : 'text-white/45 hover:text-white/85'}`}>
            {on && <motion.span layoutId="rail-active" className="absolute inset-0 rounded-xl bg-cyan-500/[.12] border border-cyan-400/25" transition={{ type: 'spring', stiffness: 520, damping: 38 }} />}
            {on && <motion.span layoutId="rail-bar" className="absolute -left-[6px] top-2 bottom-2 w-[3px] rounded-full bg-cyan-400" transition={{ type: 'spring', stiffness: 520, damping: 38 }} />}
            <Icon size={18} className="relative" />
            <span className="relative text-[9.5px] font-medium tracking-wide leading-none">{label}</span>
          </button>
        )
      })}
      <div className="flex-1" />
      <button onClick={onKeys} title="Chaves de API" className="rail-btn relative w-[52px] py-2 rounded-xl flex flex-col items-center gap-1 text-white/45 hover:text-white/85">
        <KeyRound size={17} />
        <span className="text-[9.5px] leading-none">Chaves</span>
        {keysMissing && <span className="absolute top-1 right-2.5 w-2 h-2 rounded-full bg-amber-400" />}
      </button>
      <button onClick={onSettings} title="Configurações (Ctrl+,)" className="rail-btn w-[52px] py-2 rounded-xl flex flex-col items-center gap-1 text-white/45 hover:text-white/85">
        <Settings size={17} />
        <span className="text-[9.5px] leading-none">Ajustes</span>
      </button>
    </nav>
  )
}
