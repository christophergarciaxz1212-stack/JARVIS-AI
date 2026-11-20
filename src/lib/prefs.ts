import path from 'path'
import { dataDir, readJson, writeJsonAtomic } from './agents/fsutil'
import { DEFAULT_PERMISSION_MODE, PERMISSION_MODES, type PermissionMode } from './agents/permissions'

export const ACCENTS = ['cyan', 'mono', 'blue', 'violet', 'emerald', 'amber', 'rose'] as const
export type Accent = typeof ACCENTS[number]

/** App preferences edited in ⚙️ Configurações (no secrets here: API keys live in keys.json). */
export interface Prefs {
  userName: string
  agentModeDefault: boolean
  showTips: boolean
  agent: {
    allowCommands: boolean; maxSteps: number; maxParallel: number; fixRounds: number
    /** Autonomia do agente: restrito (só lê), supervisionado (pede aprovação), autônomo. */
    permissionMode: PermissionMode
    /** Plan Mode ligado por padrão: apresenta o plano e espera aprovação antes de executar. */
    planFirst: boolean
  }
  appearance: {
    motion: 'full' | 'reduced' | 'off'; particles: boolean; fontSize: 'small' | 'normal' | 'large'
    theme: 'dark' | 'light'; accent: Accent; font: 'inter' | 'system' | 'mono'
    /** Overall zoom in percent, on top of the automatic fit-to-screen scale. */
    zoom: number
    chatWidth: 'normal' | 'wide' | 'full'
    panels: 'solid' | 'translucent'
  }
  /** Read by electron/main.js. */
  desktop: { gpu: 'auto' | 'software'; backgroundOnClose: boolean; autoStart: boolean }
  hub: { autoSync: boolean; syncMinutes: number; notifications: boolean }
  motion: { seconds: number; fps: 30 | 60; narration: 'none' | 'jarvis' }
  /** Voice used to read answers and narrate videos. */
  voice: { provider: 'gemini' | 'windows' | 'piper'; model: string; voice: string; style: string; autoRead: boolean }
  images: { provider: 'auto' | 'nvidia' | 'gemini' | 'pollinations'; style: string }
}

export const DEFAULT_PREFS: Prefs = {
  userName: '',
  agentModeDefault: true,
  showTips: true,
  agent: { allowCommands: true, maxSteps: 16, maxParallel: 3, fixRounds: 1, permissionMode: DEFAULT_PERMISSION_MODE, planFirst: false },
  appearance: { motion: 'full', particles: true, fontSize: 'normal', theme: 'dark', accent: 'cyan', font: 'inter', zoom: 100, chatWidth: 'wide', panels: 'solid' },
  desktop: { gpu: 'auto', backgroundOnClose: false, autoStart: false },
  hub: { autoSync: true, syncMinutes: 30, notifications: true },
  motion: { seconds: 12, fps: 60, narration: 'none' },
  voice: { provider: 'gemini', model: 'gemini-3.8-flash-tts', voice: 'Kore', style: '', autoRead: false },
  images: { provider: 'auto', style: '' },
}

const file = () => path.join(dataDir(), 'prefs.json')
const int = (v: unknown, min: number, max: number, def: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : def }

export function sanitize(p: Partial<Prefs> & Record<string, unknown>): Prefs {
  const d = DEFAULT_PREFS
  const a = (p.agent || {}) as Partial<Prefs['agent']>
  const ap = (p.appearance || {}) as Partial<Prefs['appearance']>
  const h = (p.hub || {}) as Partial<Prefs['hub']>
  const m = (p.motion || {}) as Partial<Prefs['motion']>
  const v = (p.voice || {}) as Partial<Prefs['voice']>
  const im = (p.images || {}) as Partial<Prefs['images']>
  const dk = (p.desktop || {}) as Partial<Prefs['desktop']>
  return {
    userName: String(p.userName ?? d.userName).slice(0, 60),
    agentModeDefault: typeof p.agentModeDefault === 'boolean' ? p.agentModeDefault : d.agentModeDefault,
    showTips: typeof p.showTips === 'boolean' ? p.showTips : d.showTips,
    agent: {
      allowCommands: typeof a.allowCommands === 'boolean' ? a.allowCommands : d.agent.allowCommands,
      maxSteps: int(a.maxSteps, 4, 40, d.agent.maxSteps),
      maxParallel: int(a.maxParallel, 1, 8, d.agent.maxParallel),
      fixRounds: int(a.fixRounds, 0, 3, d.agent.fixRounds),
      permissionMode: PERMISSION_MODES.find(x => x === a.permissionMode) || d.agent.permissionMode,
      planFirst: typeof a.planFirst === 'boolean' ? a.planFirst : d.agent.planFirst,
    },
    appearance: {
      motion: (['full', 'reduced', 'off'] as const).find(x => x === ap.motion) || d.appearance.motion,
      particles: typeof ap.particles === 'boolean' ? ap.particles : d.appearance.particles,
      fontSize: (['small', 'normal', 'large'] as const).find(x => x === ap.fontSize) || 'normal',
      theme: ap.theme === 'light' ? 'light' : 'dark',
      accent: ACCENTS.find(x => x === ap.accent) || d.appearance.accent,
      font: (['inter', 'system', 'mono'] as const).find(x => x === ap.font) || 'inter',
      zoom: int(ap.zoom, 70, 150, d.appearance.zoom),
      chatWidth: (['normal', 'wide', 'full'] as const).find(x => x === ap.chatWidth) || d.appearance.chatWidth,
      panels: ap.panels === 'translucent' ? 'translucent' : 'solid',
    },
    desktop: {
      gpu: dk.gpu === 'software' ? 'software' : 'auto',
      backgroundOnClose: typeof dk.backgroundOnClose === 'boolean' ? dk.backgroundOnClose : d.desktop.backgroundOnClose,
      autoStart: typeof dk.autoStart === 'boolean' ? dk.autoStart : d.desktop.autoStart,
    },
    hub: {
      autoSync: typeof h.autoSync === 'boolean' ? h.autoSync : d.hub.autoSync,
      syncMinutes: int(h.syncMinutes, 10, 240, d.hub.syncMinutes),
      notifications: typeof h.notifications === 'boolean' ? h.notifications : d.hub.notifications,
    },
    motion: {
      seconds: int(m.seconds, 4, 90, d.motion.seconds),
      fps: Number(m.fps) === 30 ? 30 : 60,
      narration: m.narration === 'jarvis' ? 'jarvis' : 'none',
    },
    voice: {
      provider: (['gemini', 'windows', 'piper'] as const).find(x => x === v.provider) || 'gemini',
      model: typeof v.model === 'string' && /^[\w.-]{3,80}$/.test(v.model) ? v.model : d.voice.model,
      voice: typeof v.voice === 'string' && /^[A-Za-z]{2,30}$/.test(v.voice) ? v.voice : d.voice.voice,
      style: String(v.style ?? d.voice.style).slice(0, 200),
      autoRead: typeof v.autoRead === 'boolean' ? v.autoRead : d.voice.autoRead,
    },
    images: {
      provider: (['auto', 'nvidia', 'gemini', 'pollinations'] as const).find(x => x === im.provider) || d.images.provider,
      style: String(im.style ?? d.images.style).slice(0, 200),
    },
  }
}

export function getPrefs(): Prefs {
  return sanitize(readJson<Partial<Prefs> & Record<string, unknown>>(file(), {}))
}

export function savePrefs(patch: Partial<Prefs>): Prefs {
  const cur = getPrefs()
  const next = sanitize({
    ...cur, ...patch,
    agent: { ...cur.agent, ...(patch.agent || {}) },
    appearance: { ...cur.appearance, ...(patch.appearance || {}) },
    hub: { ...cur.hub, ...(patch.hub || {}) },
    motion: { ...cur.motion, ...(patch.motion || {}) },
    voice: { ...cur.voice, ...(patch.voice || {}) },
    images: { ...cur.images, ...(patch.images || {}) },
    desktop: { ...cur.desktop, ...(patch.desktop || {}) },
  } as Partial<Prefs> & Record<string, unknown>)
  writeJsonAtomic(file(), next)
  return next
}
