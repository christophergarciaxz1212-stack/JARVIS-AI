'use client'

import { get, post } from '@/components/agents/api'
import type { AcademicTask, Alert, Conflict, Connection, Course, Exam, HubItem, HubSource, Origin, PendingAction, SearchHit, StudyEntry } from '@/lib/hub/types'

export interface Dashboard {
  alerts: Alert[]
  weekTasks: AcademicTask[]
  undatedTasks: AcademicTask[]
  upcomingExams: Exam[]
  courses: Array<Course & { pending: number; nextExam?: Exam; items: number }>
  needsAction: HubItem[]
  conflicts: Conflict[]
  totals: { items: number; tasks: number; exams: number; courses: number }
}

export interface Dossier {
  course: Course
  tasks: AcademicTask[]
  exams: Exam[]
  professorMessages: HubItem[]
  messages: HubItem[]
  materials: HubItem[]
  github: HubItem[]
  studies: StudyEntry[]
  conversations: HubItem[]
}

export type WhatsAppLiveStatus = 'disconnected' | 'pairing' | 'connected' | 'error'
export interface WhatsAppLive { status: WhatsAppLiveStatus; qr?: string; error?: string; me?: string; chats: Array<{ jid: string; name: string; participants: number; academic: boolean; suggested: boolean }>; stats: { received: number; ingested: number; skipped: number }; academicJids: string[]; startedAt?: number }

export const hub = {
  dashboard: () => get<Dashboard>('/api/hub?action=dashboard'),
  course: (id: string) => get<Dossier>(`/api/hub?action=course&id=${id}`),
  tasks: () => get<{ tasks: AcademicTask[]; exams: Exam[]; courses: Course[] }>('/api/hub?action=tasks'),
  items: (q: Record<string, string>) => get<{ items: HubItem[]; total: number }>(`/api/hub?action=items&${new URLSearchParams(q)}`),
  search: (q: string, sources: HubSource[]) => get<{ hits: SearchHit[] }>(`/api/hub?action=search&q=${encodeURIComponent(q)}&sources=${sources.join(',')}`),
  connections: () => get<{ connections: Connection[]; teamsLogin?: { user_code: string; verification_uri: string; status: string; error?: string }; whatsappLive?: WhatsAppLive }>('/api/hub?action=connections'),
  actions: () => get<{ actions: PendingAction[] }>('/api/hub?action=actions'),
  log: () => get<{ log: Array<{ at: number; source?: string; message: string }> }>('/api/hub?action=log'),
  act: <T = Record<string, unknown>>(action: string, body: Record<string, unknown> = {}) => post<T>('/api/hub', { action, ...body }),
}

export const SOURCE_META: Record<HubSource, { label: string; icon: string; color: string }> = {
  portal: { label: 'Portal', icon: '🏫', color: '#22d3ee' },
  whatsapp: { label: 'WhatsApp', icon: '🟢', color: '#25d366' },
  teams: { label: 'Teams', icon: '🟣', color: '#7b83eb' },
  github: { label: 'GitHub', icon: '🐙', color: '#e5e7eb' },
  chatgpt: { label: 'ChatGPT', icon: '⚪', color: '#10a37f' },
  gemini: { label: 'Gemini', icon: '🔵', color: '#4f8df5' },
  calendar: { label: 'Calendário', icon: '📅', color: '#f59e0b' },
  files: { label: 'Arquivos', icon: '📁', color: '#a78bfa' },
  manual: { label: 'Você', icon: '✍️', color: '#94a3b8' },
}

export function originText(o: Origin) {
  return `${SOURCE_META[o.source]?.label || o.source} › ${o.where}${o.author ? ` · ${o.author}` : ''}${o.at ? ` · ${new Date(o.at).toLocaleString('pt-BR')}` : ''}`
}

export function when(ms?: number) {
  if (!ms) return 'sem data'
  const d = new Date(ms)
  const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(new Date().setHours(0, 0, 0, 0)).getTime()) / 86400_000)
  const rel = diff === 0 ? 'hoje' : diff === 1 ? 'amanhã' : diff === -1 ? 'ontem' : diff > 1 && diff < 7 ? `em ${diff} dias` : diff < 0 ? `há ${-diff} dias` : ''
  const time = d.getHours() === 23 && d.getMinutes() === 59 ? '' : ` ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return `${d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })}${time}${rel ? ` · ${rel}` : ''}`
}
