'use client'

/**
 * Primitivos de UI do JARVIS. Componentes pequenos, sem lógica de negócio,
 * construídos sobre Tailwind + tokens. Não introduzem nova dependência.
 */
import type { ReactNode } from 'react'
import type { ModuleStatus } from '@/lib/diagnostics/modules'
import { STATUS_META } from '@/lib/ui/tokens'

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ')

export function Button({ children, onClick, variant = 'ghost', size = 'md', disabled, title, type = 'button' }: {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
  disabled?: boolean
  title?: string
  type?: 'button' | 'submit'
}) {
  const variants = {
    primary: 'bg-white text-black hover:bg-white/90 border-white',
    ghost: 'bg-white/[0.04] text-white/80 hover:bg-white/[0.08] border-white/10',
    danger: 'bg-red-500/10 text-red-300 hover:bg-red-500/20 border-red-500/25',
  }
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title}
      className={cx('inline-flex items-center justify-center gap-1.5 rounded-lg border font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 disabled:opacity-40', variants[variant], size === 'sm' ? 'px-2 py-1 text-[11px]' : 'px-3 py-1.5 text-xs')}>
      {children}
    </button>
  )
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'ok' | 'error' | 'attention' }) {
  const tones = {
    neutral: 'bg-white/[0.06] text-white/70 border-white/10',
    ok: 'bg-white/10 text-white border-white/20',
    error: 'bg-red-500/15 text-red-300 border-red-500/20',
    attention: 'bg-amber-500/15 text-amber-300 border-amber-500/20',
  }
  return <span className={cx('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-medium', tones[tone])}>{children}</span>
}

export function StatusDot({ status, label = false }: { status: ModuleStatus; label?: boolean }) {
  const m = STATUS_META[status]
  return (
    <span className={cx('inline-flex items-center gap-1.5 text-xs', m.className)} role="status" aria-label={m.label}>
      <span aria-hidden className="font-mono">{m.icon}</span>
      {label && <span>{m.label}</span>}
    </span>
  )
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx('rounded-xl border border-white/[0.07] bg-white/[0.02] p-3', className)}>{children}</section>
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: Array<{ id: T; label: string }> }) {
  return (
    <div role="tablist" className="flex gap-1 p-0.5 rounded-lg bg-white/[0.03] border border-white/5">
      {items.map(item => (
        <button key={item.id} role="tab" aria-selected={value === item.id} onClick={() => onChange(item.id)}
          className={cx('flex-1 py-1.5 rounded-md text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40', value === item.id ? 'bg-white/10 text-white' : 'text-white/45 hover:text-white/75')}>
          {item.label}
        </button>
      ))}
    </div>
  )
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block text-[11px] font-medium text-white/70">{label}</span>
      {children}
      {error ? <span className="block text-[10.5px] text-red-400" role="alert">{error}</span> : hint ? <span className="block text-[10.5px] text-white/35">{hint}</span> : null}
    </label>
  )
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 py-10 text-center">
      <p className="text-sm text-white/70">{title}</p>
      {description && <p className="text-[11px] text-white/35 max-w-sm">{description}</p>}
      {action}
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx('animate-pulse rounded-md bg-white/[0.06]', className || 'h-3 w-full')} />
}
