'use client'

import { useCallback, useEffect, useState } from 'react'

const LINES: Array<[string, string]> = [
  ['Núcleo neural ..............', 'online'],
  ['Catálogo de modelos ........', 'sincronizado'],
  ['Canal seguro ...............', 'estabelecido'],
  ['Memória de longo prazo .....', 'carregada'],
  ['Interface holográfica ......', 'ativa'],
]

/**
 * Boot holográfico: o reator se desenha, as linhas de subsistema aparecem em sequência
 * e a interface cede lugar ao app sozinha em 2,3 s. Aparece uma vez por sessão;
 * clique ou qualquer tecla pulam; movimento reduzido/desligado não mostra o boot.
 * (Sem o temporizador, a camada ficava na frente do app até alguém clicar.)
 */
export default function BootSequence() {
  const [leaving, setLeaving] = useState(false)
  const [gone, setGone] = useState(false)

  const finish = useCallback(() => {
    try { sessionStorage.setItem('jarvis.booted', '1') } catch {}
    setLeaving(true)
    window.setTimeout(() => setGone(true), 600)
  }, [])

  useEffect(() => {
    try {
      if (sessionStorage.getItem('jarvis.booted') === '1') { setGone(true); return }
    } catch {}
    const motion = document.documentElement.dataset.motion
    const reduced = motion === 'off' || motion === 'reduced' || window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      try { sessionStorage.setItem('jarvis.booted', '1') } catch {}
      setGone(true)
      return
    }
    const timer = window.setTimeout(finish, 2300)
    window.addEventListener('keydown', finish)
    return () => { window.clearTimeout(timer); window.removeEventListener('keydown', finish) }
  }, [finish])

  if (gone) return null
  return (
    <div className={`boot-overlay${leaving ? ' leaving' : ''}`} onClick={finish} role="presentation" aria-hidden>
      <svg className="boot-reactor" viewBox="0 0 120 120" aria-hidden>
        <circle className="draw faint" cx="60" cy="60" r="54" pathLength={100} transform="rotate(-90 60 60)" />
        <circle className="draw" cx="60" cy="60" r="42" pathLength={100} transform="rotate(-90 60 60)" />
        <circle className="draw violet" cx="60" cy="60" r="29" pathLength={100} transform="rotate(-90 60 60)" />
        <circle className="core" cx="60" cy="60" r="12.5" />
      </svg>
      <div className="boot-lines">
        {LINES.map(([label, ok], i) => (
          <div key={label} className="boot-line" style={{ animationDelay: `${0.3 + i * 0.24}s` }}>
            {label} <span className="ok">{ok}</span>
          </div>
        ))}
      </div>
      <div className="boot-title">JARVIS<small>SISTEMA ONLINE</small></div>
      <div className="boot-skip">CLIQUE PARA PULAR</div>
    </div>
  )
}
