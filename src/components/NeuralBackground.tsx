'use client'

import { useEffect, useRef } from 'react'

type P = { x: number; y: number; vx: number; vy: number; r: number; violet: boolean }
type Wave = { x: number; y: number; t: number }

/** Pre-rendered glow dot: drawImage is cheap, shadowBlur per particle per frame is not. */
function glowSprite(rgb: string, size: number) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  grad.addColorStop(0, `rgba(${rgb},1)`)
  grad.addColorStop(0.22, `rgba(${rgb},0.85)`)
  grad.addColorStop(0.45, `rgba(${rgb},0.25)`)
  grad.addColorStop(1, `rgba(${rgb},0)`)
  g.fillStyle = grad
  g.fillRect(0, 0, size, size)
  return c
}

/** Interactive particle network behind the whole app: links to the cursor, clicks send a shockwave. */
export default function NeuralBackground({ intensity = 1 }: { intensity?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const intensityRef = useRef(intensity)
  intensityRef.current = intensity

  useEffect(() => {
    const cv = ref.current!
    const ctx = cv.getContext('2d', { alpha: true, desynchronized: true })!
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let dpr = 1
    let W = 0, H = 0
    let pts: P[] = []
    const waves: Wave[] = []
    const mouse = { x: -9999, y: -9999 }
    let raf = 0
    let last = performance.now()
    const cyan = glowSprite('0,212,255', 32)
    const violet = glowSprite('167,139,250', 32)

    const resize = () => {
      // A background doesn't need retina resolution: 1.25x keeps lines crisp at a fraction of the pixels
      dpr = Math.min(window.devicePixelRatio || 1, 1.25)
      W = cv.width = Math.round(window.innerWidth * dpr)
      H = cv.height = Math.round(window.innerHeight * dpr)
      const count = Math.round(Math.min(70, (window.innerWidth * window.innerHeight) / 24000))
      pts = Array.from({ length: count }, () => ({
        x: Math.random() * W,
        y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.3 * dpr,
        vy: (Math.random() - 0.5) * 0.3 * dpr,
        r: (Math.random() * 1.3 + 0.5) * dpr,
        violet: Math.random() < 0.3,
      }))
    }

    const onMove = (e: MouseEvent) => { mouse.x = e.clientX * dpr; mouse.y = e.clientY * dpr }
    const onLeave = () => { mouse.x = mouse.y = -9999 }
    const onClick = (e: MouseEvent) => waves.push({ x: e.clientX * dpr, y: e.clientY * dpr, t: 0 })

    const LINK = 120
    const MOUSE_LINK = 170
    const BUCKETS = 4
    const linkPaths: Path2D[] = []

    const frame = (now: number) => {
      // Frame-rate independent: the same speed at 60, 120 or 144 Hz, and no jump after a hiccup
      const step = Math.min(3, (now - last) / 16.667)
      last = now
      const k = intensityRef.current * step
      ctx.clearRect(0, 0, W, H)

      for (const w of waves) w.t += step
      while (waves.length && waves[0].t > 60) waves.shift()

      const decay = Math.pow(0.985, step)
      for (const p of pts) {
        const dx = mouse.x - p.x, dy = mouse.y - p.y
        const d2 = dx * dx + dy * dy
        const ml = MOUSE_LINK * dpr
        if (d2 < ml * ml && d2 > 1) { const d = Math.sqrt(d2); p.vx += (dx / d) * 0.012 * dpr * step; p.vy += (dy / d) * 0.012 * dpr * step }
        for (const w of waves) {
          const wx = p.x - w.x, wy = p.y - w.y
          const wd = Math.hypot(wx, wy)
          const front = w.t * 9 * dpr
          if (Math.abs(wd - front) < 30 * dpr && wd > 1) { p.vx += (wx / wd) * 0.9 * dpr; p.vy += (wy / wd) * 0.9 * dpr }
        }
        p.vx *= decay; p.vy *= decay
        const speed = Math.hypot(p.vx, p.vy), min = 0.12 * dpr * intensityRef.current
        if (speed < min) { p.vx += (Math.random() - 0.5) * 0.05 * dpr; p.vy += (Math.random() - 0.5) * 0.05 * dpr }
        p.x += p.vx * k; p.y += p.vy * k
        if (p.x < 0) { p.x = 0; p.vx *= -1 } else if (p.x > W) { p.x = W; p.vx *= -1 }
        if (p.y < 0) { p.y = 0; p.vy *= -1 } else if (p.y > H) { p.y = H; p.vy *= -1 }
      }

      // Links grouped by opacity: 4 strokes per frame instead of one per link
      for (let b = 0; b < BUCKETS; b++) linkPaths[b] = new Path2D()
      const link = LINK * dpr, link2 = link * link
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i]
        for (let j = i + 1; j < pts.length; j++) {
          const bp = pts[j]
          const dx = a.x - bp.x, dy = a.y - bp.y
          const d2 = dx * dx + dy * dy
          if (d2 < link2) {
            const bucket = Math.min(BUCKETS - 1, Math.floor((Math.sqrt(d2) / link) * BUCKETS))
            linkPaths[bucket].moveTo(a.x, a.y)
            linkPaths[bucket].lineTo(bp.x, bp.y)
          }
        }
      }
      ctx.lineWidth = 0.7 * dpr
      for (let b = 0; b < BUCKETS; b++) {
        ctx.strokeStyle = `rgba(0,212,255,${(0.13 * (1 - (b + 0.5) / BUCKETS)).toFixed(3)})`
        ctx.stroke(linkPaths[b])
      }

      const ml = MOUSE_LINK * dpr
      for (const a of pts) {
        const md = Math.hypot(a.x - mouse.x, a.y - mouse.y)
        if (md < ml) {
          ctx.strokeStyle = `rgba(120,230,255,${(0.35 * (1 - md / ml)).toFixed(3)})`
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(mouse.x, mouse.y); ctx.stroke()
        }
      }

      for (const p of pts) {
        const s = p.r * 7
        ctx.drawImage(p.violet ? violet : cyan, p.x - s / 2, p.y - s / 2, s, s)
      }

      for (const w of waves) {
        ctx.strokeStyle = `rgba(0,212,255,${(0.5 * (1 - w.t / 60)).toFixed(3)})`
        ctx.lineWidth = 2 * dpr
        ctx.beginPath(); ctx.arc(w.x, w.y, w.t * 9 * dpr, 0, Math.PI * 2); ctx.stroke()
      }

      raf = requestAnimationFrame(frame)
    }

    const onVisibility = () => {
      cancelAnimationFrame(raf)
      if (!document.hidden && !reduced) { last = performance.now(); raf = requestAnimationFrame(frame) }
    }

    resize()
    window.addEventListener('resize', resize)
    window.addEventListener('mousemove', onMove, { passive: true })
    document.addEventListener('mouseleave', onLeave)
    window.addEventListener('mousedown', onClick, { passive: true })
    document.addEventListener('visibilitychange', onVisibility)
    if (reduced) frame(performance.now())
    else raf = requestAnimationFrame(frame)
    if (reduced) cancelAnimationFrame(raf)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      window.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseleave', onLeave)
      window.removeEventListener('mousedown', onClick)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  return (
    <div className="jarvis-bg" aria-hidden>
      {/* CSS layers stay inexpensive while the canvas handles interaction. */}
      <div className="jarvis-bg-stars" />
      <div className="jarvis-bg-aurora a1" />
      <div className="jarvis-bg-aurora a2" />
      <div className="jarvis-bg-orbit orbit-a" />
      <div className="jarvis-bg-orbit orbit-b" />
      <div className="jarvis-bg-floor" />
      <canvas ref={ref} className="jarvis-bg-canvas" />
      <div className="jarvis-bg-scan" />
      <div className="jarvis-bg-sweep" />
    </div>
  )
}
