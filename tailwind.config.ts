import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      // `/8` (ex.: border-white/8) é usado no app inteiro, mas não existe na escala padrão do Tailwind:
      // sem isto a classe era ignorada e a borda caía no cinza claro padrão (contorno branco nos cartões)
      opacity: { 8: '0.08' },
      colors: {
        // The whole UI's accent: every `cyan-*` class follows the accent chosen in Configurações › Aparência
        cyan: Object.fromEntries(['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'].map(s => [s, `rgb(var(--acc-${s}) / <alpha-value>)`])),
        jarvis: {
          bg: '#000000',
          surface: '#0a0a0a',
          panel: '#0f0f0f',
          border: 'rgba(255,255,255,0.08)',
          cyan: '#00d4ff',
          'cyan-dim': 'rgba(0,212,255,0.15)',
          purple: '#7c3aed',
          text: '#f0f0f0',
          muted: '#6b7280',
          dim: '#1a1a1a',
        },
      },
      backgroundImage: {
        'grid-pattern': `
          linear-gradient(rgba(0,212,255,0.03) 1px, transparent 1px),
          linear-gradient(90deg, rgba(0,212,255,0.03) 1px, transparent 1px)
        `,
      },
      backgroundSize: {
        grid: '40px 40px',
      },
      boxShadow: {
        'glow-cyan': '0 0 20px rgba(0,212,255,0.15)',
        'glow-cyan-lg': '0 0 40px rgba(0,212,255,0.25)',
        'glow-purple': '0 0 20px rgba(124,58,237,0.2)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4,0,0.6,1) infinite',
        'spin-slow': 'spin 3s linear infinite',
        'fade-in': 'fadeIn 0.3s ease',
        'slide-up': 'slideUp 0.3s ease',
        blink: 'blink 1s step-end infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' },
        },
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
}

export default config
