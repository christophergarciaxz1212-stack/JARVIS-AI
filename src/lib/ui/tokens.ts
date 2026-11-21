/**
 * Tokens visuais do JARVIS — uma única fonte de verdade para estados e categorias.
 *
 * Identidade: preto e branco com um acento gelo. Estados sempre vêm com texto e
 * símbolo, nunca apenas cor (acessibilidade e clareza em qualquer tema).
 */
import type { ModuleCategory, ModuleStatus } from '@/lib/diagnostics/modules'

export interface StatusMeta { label: string; icon: string; className: string }

export const STATUS_META: Record<ModuleStatus, StatusMeta> = {
  ok: { label: 'Funcionando', icon: '●', className: 'text-white' },
  error: { label: 'Erro', icon: '✕', className: 'text-red-400' },
  attention: { label: 'Atenção', icon: '!', className: 'text-amber-400' },
  unknown: { label: 'Desconhecido', icon: '?', className: 'text-white/40' },
}

export const MODULE_META: Record<ModuleStatus, { label: string; color: string; bg: string }> = {
  ok: { label: 'ok', color: 'text-white', bg: 'bg-white/10 border-white/15' },
  error: { label: 'erro', color: 'text-red-400', bg: 'bg-red-500/15 border-red-500/20' },
  attention: { label: 'atenção', color: 'text-amber-400', bg: 'bg-amber-500/15 border-amber-500/20' },
  unknown: { label: 'n/a', color: 'text-white/35', bg: 'bg-white/5 border-white/10' },
}

export const CATEGORY_LABELS: Record<ModuleCategory, string> = {
  nucleo: 'Núcleo',
  ia: 'IA',
  agentes: 'Agentes',
  integracoes: 'Integrações',
  dados: 'Dados',
  build: 'Build',
}

/** Mapa de status do diagnóstico rico (ok|warn|fail) para o mapa simples. */
export const LEVEL_TO_STATUS = { ok: 'ok', warn: 'attention', fail: 'error' } as const
