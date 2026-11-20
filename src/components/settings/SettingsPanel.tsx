'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Bot, Clapperboard, Database, GraduationCap, HelpCircle, ImageIcon, KeyRound, Mic, Monitor, Palette, RotateCcw, Settings, Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import { Modal, ModelPicker } from '@/components/agents/shared'
import { savePrefs, usePrefs, type Prefs } from './usePrefs'
import VoiceSettings from './VoiceSettings'
import ImageSettings from './ImageSettings'

type Section = 'geral' | 'ia' | 'voz' | 'imagens' | 'agente' | 'aparencia' | 'desktop' | 'hub' | 'motion' | 'dados' | 'ajuda'

const ACCENT_SWATCHES: Array<[Prefs['appearance']['accent'], string, string]> = [
  ['cyan', 'Ciano', '#22d3ee'], ['mono', 'Preto e branco', 'linear-gradient(135deg,#fff 50%,#111 50%)'], ['blue', 'Azul', '#60a5fa'],
  ['violet', 'Violeta', '#a78bfa'], ['emerald', 'Verde', '#34d399'], ['amber', 'Âmbar', '#fbbf24'], ['rose', 'Rosa', '#fb7185'],
]

const SECTIONS: Array<{ id: Section; label: string; icon: typeof Settings }> = [
  { id: 'geral', label: 'Geral', icon: Settings },
  { id: 'ia', label: 'Inteligência artificial', icon: Sparkles },
  { id: 'voz', label: 'Voz', icon: Mic },
  { id: 'imagens', label: 'Imagens', icon: ImageIcon },
  { id: 'agente', label: 'Modo agente', icon: Bot },
  { id: 'aparencia', label: 'Aparência', icon: Palette },
  { id: 'desktop', label: 'Desktop e desempenho', icon: Monitor },
  { id: 'hub', label: 'Hub Escolar', icon: GraduationCap },
  { id: 'motion', label: 'Estúdio Motion', icon: Clapperboard },
  { id: 'dados', label: 'Dados e privacidade', icon: Database },
  { id: 'ajuda', label: 'Ajuda e atalhos', icon: HelpCircle },
]

const EXAMPLES = [
  'Crie um projeto de software completo, com testes e README.',
  'Corrija os erros do meu projeto e rode os testes.',
  'Analise os dados que eu enviar e gere um relatório com insights.',
  'Crie um calendário de conteúdo para redes sociais e escreva os posts.',
]

export default function SettingsPanel({ onClose, onOpenKeys, model, onModel, autoModel, onAutoModel, onExample }: {
  onClose: () => void
  onOpenKeys: () => void
  model: string
  onModel: (id: string) => void
  autoModel: boolean
  onAutoModel: (v: boolean) => void
  onExample?: (text: string) => void
}) {
  const [prefs, update] = usePrefs()
  const [section, setSection] = useState<Section>('geral')
  const [info, setInfo] = useState<{ dataDir: string; platform: string; node: string } | null>(null)
  useEffect(() => { fetch('/api/prefs').then(r => r.json()).then(d => setInfo(d.info)).catch(() => {}) }, [])

  const set = async (patch: Partial<Prefs>) => {
    try { await update(patch); toast.success('Salvo', { duration: 900 }) } catch (e) { toast.error((e as Error).message) }
  }

  return (
    <Modal onClose={onClose} width="max-w-4xl">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-white/5">
        <div className="w-9 h-9 rounded-xl bg-cyan-500/15 border border-cyan-500/25 flex items-center justify-center"><Settings size={17} className="text-cyan-200" /></div>
        <div className="flex-1">
          <div className="text-sm font-semibold text-white">Configurações</div>
          <div className="text-[11px] text-white/40">Tudo é salvo na hora, só neste computador. Atalho: Ctrl+,</div>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5 text-white/40"><X size={16} /></button>
      </div>
      <div className="flex-1 min-h-0 grid grid-cols-[200px_1fr]">
        <nav className="p-2 border-r border-white/5 space-y-0.5 overflow-y-auto">
          {SECTIONS.map(s => (
            <button key={s.id} onClick={() => setSection(s.id)} className={`relative w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-left ${section === s.id ? 'text-cyan-100' : 'text-white/50 hover:text-white/80 hover:bg-white/[0.03]'}`}>
              {section === s.id && <motion.span layoutId="settings-nav" className="absolute inset-0 rounded-lg bg-cyan-500/[.12] border border-cyan-500/20" />}
              <s.icon size={14} className="relative" /> <span className="relative">{s.label}</span>
            </button>
          ))}
        </nav>
        <div className="p-5 overflow-y-auto max-h-[70vh]">
          {!prefs ? <p className="text-xs text-white/40">Carregando…</p> : (
            <motion.div key={section} initial={false} animate={{ opacity: 1, x: 0 }} className="space-y-4">
              {section === 'geral' && <>
                <Field label="Como o JARVIS deve te chamar" hint="Usado nas saudações.">
                  <input defaultValue={prefs.userName} onBlur={e => e.target.value !== prefs.userName && set({ userName: e.target.value })} placeholder="Seu nome" className="input-jarvis w-full px-3 py-2 rounded-lg text-sm" />
                </Field>
                <Toggle label="Começar com o modo agente ligado" hint="O JARVIS executa as tarefas (arquivos e comandos) e você acompanha cada passo ao vivo." value={prefs.agentModeDefault} onChange={v => set({ agentModeDefault: v })} />
                <Toggle label="Mostrar dicas na tela inicial" value={prefs.showTips} onChange={v => set({ showTips: v })} />
              </>}

              {section === 'ia' && <>
                <Field label="Modelo padrão do chat" hint="⚡ Automático usa o mais rápido conectado. Modelos marcados como pagos gastam créditos da sua conta.">
                  <ModelPicker value={model || 'auto'} onChange={id => { onModel(id === 'auto' ? '' : id); toast.success('Modelo alterado') }} />
                </Field>
                <Toggle label="Melhor IA automática por tarefa" hint="Escolhe o modelo pelo tipo de pedido (código, raciocínio, criação…)." value={autoModel} onChange={onAutoModel} />
                <button onClick={() => { onClose(); onOpenKeys() }} className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs bg-cyan-500/10 text-cyan-100 border border-cyan-500/20 hover:bg-cyan-500/20"><KeyRound size={13} /> Gerenciar chaves de API</button>
              </>}

              {section === 'voz' && <VoiceSettings prefs={prefs} set={set} onOpenKeys={() => { onClose(); onOpenKeys() }} />}

              {section === 'imagens' && <ImageSettings prefs={prefs} set={set} onOpenKeys={() => { onClose(); onOpenKeys() }} />}

              {section === 'agente' && <>
                <Toggle label="Começar com o modo agente ligado" hint="Recomendado. O JARVIS executa de verdade: lê e edita arquivos, roda comandos e mostra cada passo ao vivo." value={prefs.agentModeDefault} onChange={v => set({ agentModeDefault: v })} />
                <Toggle label="Permitir que os agentes executem comandos no terminal" hint="Desligado: eles só leem e editam arquivos. Comandos perigosos (formatar, apagar o sistema…) são sempre bloqueados." value={prefs.agent.allowCommands} onChange={v => set({ agent: { ...prefs.agent, allowCommands: v } })} />
                <Range label="Passos por tarefa" hint="Quantas ações cada agente pode fazer antes de concluir." value={prefs.agent.maxSteps} min={4} max={40} onChange={v => set({ agent: { ...prefs.agent, maxSteps: v } })} />
                <Range label="Agentes trabalhando ao mesmo tempo" value={prefs.agent.maxParallel} min={1} max={8} onChange={v => set({ agent: { ...prefs.agent, maxParallel: v } })} />
                <Range label="Rodadas de correção depois da revisão" value={prefs.agent.fixRounds} min={0} max={3} onChange={v => set({ agent: { ...prefs.agent, fixRounds: v } })} />
                <p className="text-[11px] text-white/35">Sem uma pasta de projeto escolhida, o modo agente trabalha em Documentos › JARVIS Projetos. Toda alteração pode ser revertida na tela da execução.</p>
              </>}

              {section === 'aparencia' && <>
                <Field label="Animações">
                  <Choice value={prefs.appearance.motion} options={[['full', 'Completas'], ['reduced', 'Suaves'], ['off', 'Desligadas']]} onChange={v => set({ appearance: { ...prefs.appearance, motion: v as Prefs['appearance']['motion'] } })} />
                </Field>
                <Toggle label="Fundo com partículas animadas" hint="Desligar deixa o app mais leve em computadores mais simples." value={prefs.appearance.particles} onChange={v => set({ appearance: { ...prefs.appearance, particles: v } })} />
                <Field label="Tema">
                  <Choice value={prefs.appearance.theme} options={[['dark', 'Escuro'], ['light', 'Claro']]} onChange={v => set({ appearance: { ...prefs.appearance, theme: v as Prefs['appearance']['theme'] } })} />
                </Field>
                <Field label="Cor de destaque" hint="“Preto e branco” deixa a interface monocromática e minimalista.">
                  <div className="flex gap-2 flex-wrap">
                    {ACCENT_SWATCHES.map(([id, label, color]) => (
                      <button key={id} onClick={() => id !== prefs.appearance.accent && set({ appearance: { ...prefs.appearance, accent: id } })} title={label}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs border ${prefs.appearance.accent === id ? 'border-white/50 bg-white/10 text-white' : 'border-white/10 text-white/50 hover:text-white/80'}`}>
                        <span className="w-3 h-3 rounded-full border border-white/20" style={{ background: color }} /> {label}
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label="Fonte">
                  <Choice value={prefs.appearance.font} options={[['inter', 'Inter'], ['system', 'Do sistema'], ['mono', 'Monoespaçada']]} onChange={v => set({ appearance: { ...prefs.appearance, font: v as Prefs['appearance']['font'] } })} />
                </Field>
                <Field label="Tamanho do texto">
                  <Choice value={prefs.appearance.fontSize} options={[['small', 'Pequeno'], ['normal', 'Normal'], ['large', 'Grande']]} onChange={v => set({ appearance: { ...prefs.appearance, fontSize: v as Prefs['appearance']['fontSize'] } })} />
                </Field>
                <Range label="Zoom geral (%)" hint="Aumenta ou diminui tudo: textos, botões, ícones e painéis." value={prefs.appearance.zoom} min={70} max={150} step={5} onChange={v => set({ appearance: { ...prefs.appearance, zoom: v } })} />
                <Field label="Largura do chat">
                  <Choice value={prefs.appearance.chatWidth} options={[['normal', 'Estreita'], ['wide', 'Larga'], ['full', 'Tela inteira']]} onChange={v => set({ appearance: { ...prefs.appearance, chatWidth: v as Prefs['appearance']['chatWidth'] } })} />
                </Field>
                <Field label="Painéis" hint="Translúcido deixa o fundo aparecer atrás dos painéis (sem desfoque, para manter os 60 fps).">
                  <Choice value={prefs.appearance.panels} options={[['solid', 'Sólidos'], ['translucent', 'Translúcidos']]} onChange={v => set({ appearance: { ...prefs.appearance, panels: v as Prefs['appearance']['panels'] } })} />
                </Field>
              </>}

              {section === 'desktop' && <>
                <Toggle label="Continuar rodando em segundo plano ao fechar" hint="Fechar a janela esconde o JARVIS na bandeja (perto do relógio); agentes, monitoramento e backups continuam. Para sair de vez: clique direito no ícone › Sair." value={prefs.desktop.backgroundOnClose} onChange={v => set({ desktop: { ...prefs.desktop, backgroundOnClose: v } })} />
                <Toggle label="Iniciar com o Windows" hint="Abre o JARVIS quando você entra no Windows." value={prefs.desktop.autoStart} onChange={v => set({ desktop: { ...prefs.desktop, autoStart: v } })} />
                <Field label="Placa de vídeo (GPU)" hint="Automático usa a GPU para animações a 60 fps e volta sozinho para o modo sem GPU se o driver travar. Vale na próxima abertura.">
                  <Choice value={prefs.desktop.gpu} options={[['auto', 'Automático (GPU)'], ['software', 'Sem GPU (compatibilidade)']]} onChange={v => set({ desktop: { ...prefs.desktop, gpu: v as Prefs['desktop']['gpu'] } })} />
                </Field>
                {typeof window !== 'undefined' && window.electron?.relaunch
                  ? <button onClick={() => window.electron?.relaunch?.()} className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs bg-white/5 text-white/70 hover:bg-white/10"><RotateCcw size={13} /> Reiniciar o JARVIS agora</button>
                  : <p className="text-[11px] text-amber-200/70">Estas opções valem no app desktop (atalho JARVIS AI); você está numa janela de navegador.</p>}
              </>}

              {section === 'hub' && <>
                <Toggle label="Sincronizar automaticamente com o app aberto" hint="Teams, GitHub, calendários e pasta de materiais." value={prefs.hub.autoSync} onChange={v => set({ hub: { ...prefs.hub, autoSync: v } })} />
                <Range label="Intervalo (minutos)" value={prefs.hub.syncMinutes} min={10} max={240} step={10} onChange={v => set({ hub: { ...prefs.hub, syncMinutes: v } })} />
                <Toggle label="Notificações do Windows para prazos urgentes" value={prefs.hub.notifications} onChange={v => set({ hub: { ...prefs.hub, notifications: v } })} />
              </>}

              {section === 'motion' && <>
                <Range label="Duração padrão dos vídeos (segundos)" value={prefs.motion.seconds} min={4} max={60} onChange={v => set({ motion: { ...prefs.motion, seconds: v } })} />
                <Field label="Fluidez padrão">
                  <Choice value={String(prefs.motion.fps)} options={[['60', '60 fps (mais suave)'], ['30', '30 fps (mais rápido)']]} onChange={v => set({ motion: { ...prefs.motion, fps: v === '30' ? 30 : 60 } })} />
                </Field>
                <Field label="Narração padrão">
                  <Choice value={prefs.motion.narration} options={[['none', 'Sem voz'], ['jarvis', `Voz escolhida (${prefs.voice.provider === 'gemini' ? `Gemini · ${prefs.voice.voice}` : 'Windows'})`]]} onChange={v => set({ motion: { ...prefs.motion, narration: v as Prefs['motion']['narration'] } })} />
                </Field>
                <button onClick={() => setSection('voz')} className="text-[11px] text-cyan-300/80 hover:text-cyan-200">Trocar a voz da narração →</button>
              </>}

              {section === 'ajuda' && <>
                <div className="text-xs text-white/70">O JARVIS é um agente: descreva o resultado que você quer e ele executa — você acompanha cada passo.</div>
                <div className="space-y-2">
                  {[
                    ['1', 'Conecte uma IA', 'Abra Chaves de API e cole uma chave grátis (Gemini, Groq ou Cerebras).'],
                    ['2', 'Dê uma ordem', 'Fale o resultado: “crie”, “corrija”, “instale”, “investigue”.'],
                    ['3', 'Acompanhe', 'Com o modo AGENTE ligado, arquivos e comandos aparecem no painel ao vivo.'],
                  ].map(([n, title, text]) => (
                    <div key={n} className="flex items-start gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/5">
                      <div className="w-6 h-6 rounded-full bg-cyan-500/15 border border-cyan-500/25 text-cyan-200 text-[11px] flex items-center justify-center flex-shrink-0">{n}</div>
                      <div>
                        <div className="text-xs text-white/85">{title}</div>
                        <div className="text-[11px] text-white/40 mt-0.5">{text}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <Field label="Exemplos — clique para usar">
                  <div className="flex flex-col gap-1.5">
                    {EXAMPLES.map(ex => (
                      <button key={ex} onClick={() => onExample?.(ex)} className="text-left px-3 py-2 rounded-lg text-xs text-white/70 bg-white/[0.03] border border-white/10 hover:border-cyan-500/30 hover:text-white transition-colors">
                        “{ex}”
                      </button>
                    ))}
                  </div>
                </Field>
                <div className="text-[11px] text-white/35">Atalhos: Ctrl+, abre Configurações · Ctrl+K foca a caixa de texto · Esc fecha janelas.</div>
                <button onClick={() => { onClose(); onOpenKeys() }} className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs bg-cyan-500/10 text-cyan-100 border border-cyan-500/20 hover:bg-cyan-500/20"><KeyRound size={13} /> Conectar uma IA agora</button>
              </>}

              {section === 'dados' && <>
                <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5 text-xs text-white/60 space-y-1">
                  <div>Seus dados ficam só neste computador:</div>
                  <div className="font-mono text-[11px] text-cyan-200/80 break-all">{info?.dataDir || '…'}</div>
                  <div className="text-white/35">Conversas, memória, Hub Escolar, vídeos, imagens e chaves de API (as chaves nunca são enviadas para a IA).</div>
                </div>
                <div className="text-[11px] text-white/30">{info ? `${info.platform} · Node ${info.node}` : ''}</div>
                <button onClick={async () => { await savePrefs({ reset: true }); toast.success('Configurações restauradas') }} className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-white/60 bg-white/5 hover:bg-white/10"><RotateCcw size={13} /> Restaurar configurações padrão</button>
              </>}
            </motion.div>
          )}
        </div>
      </div>
    </Modal>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-white/80 mb-1.5">{label}</div>
      {children}
      {hint && <div className="text-[11px] text-white/35 mt-1">{hint}</div>}
    </div>
  )
}

function Toggle({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!value)} className="w-full flex items-start gap-3 text-left group">
      <div className="flex-1">
        <div className="text-xs text-white/80 group-hover:text-white">{label}</div>
        {hint && <div className="text-[11px] text-white/35 mt-0.5">{hint}</div>}
      </div>
      <div className={`mt-0.5 w-9 h-5 rounded-full flex-shrink-0 transition-colors ${value ? 'bg-cyan-500' : 'bg-white/10'}`}>
        <motion.span layout className={`block w-4 h-4 rounded-full bg-white m-0.5 ${value ? 'ml-[18px]' : ''}`} />
      </div>
    </button>
  )
}

function Range({ label, hint, value, min, max, step = 1, onChange }: { label: string; hint?: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return (
    <Field label={`${label}: ${v}`} hint={hint}>
      <input type="range" min={min} max={max} step={step} value={v} onChange={e => setV(Number(e.target.value))} onMouseUp={() => v !== value && onChange(v)} onKeyUp={() => v !== value && onChange(v)} className="w-full accent-cyan-400" />
    </Field>
  )
}

function Choice({ value, options, onChange }: { value: string; options: Array<[string, string]>; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {options.map(([id, label]) => (
        <button key={id} onClick={() => id !== value && onChange(id)} className={`px-3 py-1.5 rounded-lg text-xs border ${value === id ? 'border-cyan-400/50 bg-cyan-500/10 text-white' : 'border-white/10 text-white/50 hover:text-white/80'}`}>{label}</button>
      ))}
    </div>
  )
}
