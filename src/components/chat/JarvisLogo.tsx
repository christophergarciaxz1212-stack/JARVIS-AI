'use client'

import { useId } from 'react'

const ORBIT = 'M 2.5,16 a 13.5,5.2 0 1,0 27,0 a 13.5,5.2 0 1,0 -27,0'

export default function JarvisLogo({ size = 32, animated = true, speed = 1 }: { size?: number; animated?: boolean; speed?: number }) {
  const uid = useId().replace(/:/g, '')
  const orbits = [
    { angle: 0, dur: `${2.4 / speed}s`, color: '#00d4ff' },
    { angle: 60, dur: `${3.1 / speed}s`, color: '#a78bfa' },
    { angle: 120, dur: `${3.8 / speed}s`, color: '#38bdf8' },
  ]
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id={`g${uid}`} x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#00d4ff" />
          <stop offset="1" stopColor="#7c3aed" />
        </linearGradient>
        <radialGradient id={`n${uid}`}>
          <stop stopColor="#ffffff" />
          <stop offset="0.45" stopColor="#00d4ff" />
          <stop offset="1" stopColor="#00d4ff" stopOpacity="0" />
        </radialGradient>
      </defs>
      {orbits.map(o => (
        <g key={o.angle} transform={`rotate(${o.angle} 16 16)`}>
          <path d={ORBIT} stroke={`url(#g${uid})`} strokeWidth="1.1" opacity="0.85" />
          <circle r="1.6" cx={animated ? 0 : 29.5} cy={animated ? 0 : 16} fill={o.color} style={{ filter: `drop-shadow(0 0 2px ${o.color})` }}>
            {animated && <animateMotion dur={o.dur} repeatCount="indefinite" path={ORBIT} />}
          </circle>
        </g>
      ))}
      <circle cx="16" cy="16" r="5" fill={`url(#n${uid})`} opacity="0.6">
        {animated && <animate attributeName="r" values="4.2;5.6;4.2" dur="2.2s" repeatCount="indefinite" />}
      </circle>
      <circle cx="16" cy="16" r="2.4" fill="#e0faff" />
    </svg>
  )
}
