'use client'

import { useState, useEffect } from 'react'
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion'

// ─── Hero title with glitch ──────────────────────────────────────────────────

export function HeroTitle() {
  const [glitch, setGlitch] = useState(false)
  const [intensity, setIntensity] = useState(1)
  useEffect(() => {
    let off: ReturnType<typeof setTimeout> | undefined
    const t = setInterval(() => { setGlitch(true); off = setTimeout(() => setGlitch(false), 260) }, 3200)
    const i = setInterval(() => setIntensity(Math.random() > 0.85 ? 1.15 : 1), 4500)
    return () => { clearInterval(t); clearTimeout(off); clearInterval(i) }
  }, [])
  return (
    <h2 className={`flex gap-1.5 text-3xl font-extrabold tracking-[0.18em] mb-1 ${glitch ? 'glitching' : ''} jarvis-float-slow`} style={{ filter: intensity > 1 ? 'drop-shadow(0 0 14px rgba(0,212,255,0.6))' : 'none' }}>
      {'JARVIS'.split('').map((ch, i) => (
        <motion.span
          key={i}
          className="shimmer-letter"
          initial={false}
          animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
          transition={{ delay: 0.25 + i * 0.09, duration: 0.6, ease: [0.2, 0.9, 0.2, 1] }}
        >
          {ch}
        </motion.span>
      ))}
    </h2>
  )
}

const TAGLINES = [
  'O que devo executar agora?',
  'Dê a ordem — eu entrego o resultado.',
  'Eu leio, edito, rodo e verifico.',
  'Arquivos, comandos e código sob seu comando.',
  'Agente ligado. Sem perguntas desnecessárias.',
]

export function TypedTagline() {
  const [text, setText] = useState('')
  useEffect(() => {
    let line = 0, i = 0, deleting = false
    let timer: ReturnType<typeof setTimeout>
    const step = () => {
      const full = TAGLINES[line]
      if (!deleting) {
        i++
        setText(full.slice(0, i))
        if (i === full.length) { deleting = true; timer = setTimeout(step, 2600); return }
        timer = setTimeout(step, 38)
      } else {
        i--
        setText(full.slice(0, i))
        if (i === 0) { deleting = false; line = (line + 1) % TAGLINES.length; timer = setTimeout(step, 300); return }
        timer = setTimeout(step, 18)
      }
    }
    timer = setTimeout(step, 900)
    return () => clearTimeout(timer)
  }, [])
  return <p className="type-caret text-white/40 text-xs mb-6 h-4 font-mono tracking-wide">{text}</p>
}

export function TiltCard({ children, onClick, delay }: { children: React.ReactNode; onClick: () => void; delay: number }) {
  const mx = useMotionValue(0.5)
  const my = useMotionValue(0.5)
  const rotateX = useSpring(useTransform(my, [0, 1], [10, -10]), { stiffness: 300, damping: 25 })
  const rotateY = useSpring(useTransform(mx, [0, 1], [-12, 12]), { stiffness: 300, damping: 25 })
  return (
    <motion.button
      initial={{ opacity: 0, y: 12, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay, duration: 0.55, ease: [0.2, 0.9, 0.2, 1] }}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.96 }}
      style={{ rotateX, rotateY, transformPerspective: 700 }}
      onMouseMove={e => {
        const r = e.currentTarget.getBoundingClientRect()
        const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height
        mx.set(x); my.set(y)
        e.currentTarget.style.setProperty('--mx', `${x * 100}%`)
        e.currentTarget.style.setProperty('--my', `${y * 100}%`)
      }}
      onMouseLeave={() => { mx.set(0.5); my.set(0.5) }}
      onClick={onClick}
      className="tilt-card p-3 rounded-xl text-left group jarvis-sheen jarvis-core-pulse"
    >
      {children}
    </motion.button>
  )
}
