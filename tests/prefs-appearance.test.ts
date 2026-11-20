import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFS, sanitize } from '@/lib/prefs'

describe('configurações de aparência e desktop', () => {
  it('aceita só valores que a interface sabe aplicar', () => {
    const p = sanitize({ appearance: { theme: 'light', accent: 'mono', font: 'system', zoom: 400, chatWidth: 'full', panels: 'translucent', fontSize: 'small' } as never, desktop: { gpu: 'software', backgroundOnClose: true, autoStart: 'sim' } as never })
    expect(p.appearance).toMatchObject({ theme: 'light', accent: 'mono', font: 'system', zoom: 150, chatWidth: 'full', panels: 'translucent', fontSize: 'small' })
    expect(p.desktop).toEqual({ gpu: 'software', backgroundOnClose: true, autoStart: false })
  })

  it('valores desconhecidos voltam ao padrão (arquivo antigo ou editado à mão)', () => {
    const p = sanitize({ appearance: { theme: 'neon', accent: 'pink', font: 'comic', zoom: 'x', chatWidth: 'huge' } as never })
    expect(p.appearance).toMatchObject({ theme: 'dark', accent: 'cyan', font: 'inter', zoom: 100, chatWidth: 'wide', panels: 'solid' })
    expect(p.desktop).toEqual(DEFAULT_PREFS.desktop)
  })
})
