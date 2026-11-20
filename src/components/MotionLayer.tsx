'use client'

import { useEffect } from 'react'

/**
 * Parte JS da linguagem de movimento (o resto está em app/motion.css):
 * - pressão proporcional ao tamanho: um ícone de 32 px afunda 6%, uma linha de 400 px só 1,5%
 *   (a mesma distância em pixels, em vez de um "scale" fixo que deforma botões largos);
 * - onda de clique nascendo do ponto exato do clique, recortada no formato do botão;
 * - brilho que segue o cursor nos elementos .mo-spot (--mx/--my em %, imune ao zoom da UI).
 * Um único conjunto de ouvintes delegados no documento; nada roda enquanto o mouse está parado.
 */
// Links com cara de botão (arredondados e com padding: "Baixar MP4", "Pegar chave", PNG/SVG) também
// ganham a onda e a pressão; links de texto comuns (markdown do chat) não
const PRESSABLE = 'button, [role="button"], [role="tab"], [role="menuitem"], [role="radio"], summary, [data-ripple], a[href][class*="rounded"][class*="px-"], a[href][class*="rounded"][class*="p-"]'
const TYPING = 'input, textarea, select, [contenteditable="true"]'

function motionAllowed(reduceQuery: MediaQueryList | null) {
  const m = document.documentElement.dataset.motion
  return m !== 'off' && m !== 'reduced' && !reduceQuery?.matches
}

function pressTarget(e: Event): HTMLElement | null {
  const t = e.target as Element | null
  if (!t?.closest || t.closest(TYPING)) return null
  const el = t.closest<HTMLElement>(PRESSABLE)
  if (!el || el.tagName === 'INPUT' || el.matches(':disabled, [aria-disabled="true"], [data-no-ripple], [data-mo-still]')) return null
  return el
}

const positioned = new WeakMap<HTMLElement, number>()

function ripple(el: HTMLElement, clientX: number, clientY: number) {
  const r = el.getBoundingClientRect()
  if (r.width < 12 || r.height < 12) return
  // Frações do próprio elemento: o mesmo cálculo vale com qualquer zoom de interface
  const fx = (clientX - r.left) / r.width
  const fy = (clientY - r.top) / r.height
  const reach = 2 * Math.hypot(Math.max(clientX - r.left, r.right - clientX), Math.max(clientY - r.top, r.bottom - clientY))

  // A hospedeira precisa de um bloco de contenção: um botão "static" vira "relative" só durante a onda
  if (getComputedStyle(el).position === 'static') {
    positioned.set(el, (positioned.get(el) || 0) + 1)
    el.style.position = 'relative'
  }
  const host = document.createElement('span')
  host.className = 'mo-ripple-host'
  host.setAttribute('aria-hidden', 'true')
  const dot = document.createElement('span')
  dot.className = 'mo-ripple'
  dot.style.cssText = `left:${(fx * 100).toFixed(2)}%;top:${(fy * 100).toFixed(2)}%;width:${((reach / r.width) * 100).toFixed(2)}%;aspect-ratio:1;translate:-50% -50%`
  host.appendChild(dot)
  el.appendChild(host)

  const done = () => {
    host.remove()
    const n = positioned.get(el)
    if (n) {
      if (n <= 1) { positioned.delete(el); el.style.position = '' }
      else positioned.set(el, n - 1)
    }
  }
  const anim = dot.animate(
    [{ transform: 'scale(0)', opacity: 1 }, { transform: 'scale(1)', opacity: 1, offset: 0.55 }, { transform: 'scale(1)', opacity: 0 }],
    { duration: Math.min(900, 480 + reach * 0.45), easing: 'cubic-bezier(.22,1,.36,1)' },
  )
  anim.onfinish = done
  anim.oncancel = done
}

export default function MotionLayer() {
  useEffect(() => {
    const reduceQuery = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || !motionAllowed(reduceQuery)) return
      const el = pressTarget(e)
      if (!el) return
      const size = Math.max(el.offsetWidth, el.offsetHeight) || 40
      el.style.setProperty('--mo-press', Math.min(0.985, Math.max(0.94, 1 - 6 / size)).toFixed(3))
      ripple(el, e.clientX, e.clientY)
    }

    // Brilho que segue o cursor: no máximo uma atualização por quadro
    let frame = 0
    let last: PointerEvent | null = null
    const paint = () => {
      frame = 0
      const e = last
      if (!e) return
      const spot = (e.target as Element | null)?.closest?.<HTMLElement>('.mo-spot')
      if (!spot) return
      const r = spot.getBoundingClientRect()
      if (!r.width || !r.height) return
      spot.style.setProperty('--mx', `${(((e.clientX - r.left) / r.width) * 100).toFixed(1)}%`)
      spot.style.setProperty('--my', `${(((e.clientY - r.top) / r.height) * 100).toFixed(1)}%`)
    }
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      last = e
      if (!frame) frame = requestAnimationFrame(paint)
    }

    document.addEventListener('pointerdown', onDown, { passive: true })
    document.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('pointermove', onMove)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])
  return null
}
