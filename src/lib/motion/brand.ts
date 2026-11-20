import type { Brand } from './types'

const LOCAL = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[?::1|\[?f[cd])/i
const UA ='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

async function get(url: string, max = 3_000_000, accept = '*/*'): Promise<{ buf: Buffer; type: string } | null> {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    // Never reach into the local machine or network from a page we were pointed at
    if (LOCAL.test(u.hostname)) return null
    const res = await fetch(u, { headers: { 'User-Agent': UA, Accept: accept }, signal: AbortSignal.timeout(12_000), redirect: 'follow' })
    if (!res.ok || LOCAL.test(new URL(res.url || url).hostname)) return null
    const len = Number(res.headers.get('content-length') || 0)
    if (len > max) return null
    const buf = Buffer.from(await res.arrayBuffer())
    return buf.length > max ? null : { buf, type: res.headers.get('content-type') || '' }
  } catch {
    return null
  }
}

const GENERIC = /^(inherit|initial|unset|sans-serif|serif|monospace|system-ui|-apple-system|blinkmacsystemfont|segoe ui|roboto|helvetica|helvetica neue|arial|ui-sans-serif|ui-serif|ui-monospace|apple color emoji|segoe ui emoji|var\(.*)$/i

function hexes(css: string): Map<string, number> {
  const m = new Map<string, number>()
  for (const x of css.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
    let h = x[1].toLowerCase()
    if (h.length === 3) h = h.split('').map(c => c + c).join('')
    m.set(`#${h}`, (m.get(`#${h}`) || 0) + 1)
  }
  for (const x of css.matchAll(/rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/gi)) {
    const h = `#${[x[1], x[2], x[3]].map(v => Math.min(255, Number(v)).toString(16).padStart(2, '0')).join('')}`
    m.set(h, (m.get(h) || 0) + 1)
  }
  return m
}

function saturation(hex: string) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  return max === 0 ? 0 : (max - min) / max
}

/** Real identity from the product's site: name, palette, font (inlined) and logo (data URI). */
export async function brandFromSite(url: string): Promise<{ brand: Brand; fontCss: string }> {
  const notes: string[] = []
  const page = await get(url, 4_000_000, 'text/html')
  if (!page) throw new Error('Não consegui abrir o site da marca')
  const html = page.buf.toString('utf-8')
  const base = new URL(url)
  const abs = (h: string) => { try { return new URL(h, base).href } catch { return '' } }
  const attr = (re: RegExp) => html.match(re)?.[1]?.trim()

  const name = (attr(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)/i) || attr(/<title[^>]*>([^<]{1,80})/i) || base.hostname).replace(/\s+[|–-].*$/, '').trim()
  const description = (attr(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{1,300})/i) || attr(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{1,300})/i) || '').slice(0, 300)

  // CSS: inline styles + up to 4 stylesheets
  let css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]).join('\n') + [...html.matchAll(/style=["']([^"']+)["']/gi)].map(m => m[1]).join(';')
  const sheets = [...html.matchAll(/<link[^>]+rel=["'][^"']*stylesheet[^"']*["'][^>]*>/gi)].map(m => m[0].match(/href=["']([^"']+)/i)?.[1]).filter(Boolean).map(h => abs(h!)).filter(Boolean)
  const googleFonts = sheets.filter(h => /fonts\.googleapis\.com/.test(h))
  for (const s of sheets.filter(h => !/fonts\.googleapis\.com/.test(h)).slice(0, 4)) {
    const r = await get(s, 2_000_000, 'text/css')
    if (r) css += '\n' + r.buf.toString('utf-8')
  }

  // Palette: theme-color first, then the most used saturated colours
  const counts = hexes(css)
  const theme = attr(/<meta[^>]+name=["']theme-color["'][^>]+content=["'](#[0-9a-f]{3,6})/i)
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([h]) => h)
  const accents = ranked.filter(h => saturation(h) > 0.35).slice(0, 4)
  const neutrals = ranked.filter(h => saturation(h) <= 0.35).slice(0, 2)
  const colors = [...new Set([...(theme ? [theme.toLowerCase()] : []), ...accents, ...neutrals])].slice(0, 6)
  if (!colors.length) notes.push('Não encontrei cores no site; o vídeo usa uma paleta própria.')

  // Font: first non-generic family; Google Fonts are inlined so the render never needs the network
  const families = [...css.matchAll(/font-family\s*:\s*([^;}]+)/gi)].flatMap(m => m[1].split(',')).map(f => f.trim().replace(/^["']|["']$/g, '')).filter(f => f && !GENERIC.test(f))
  const freq = new Map<string, number>()
  for (const f of families) freq.set(f, (freq.get(f) || 0) + 1)
  let font = [...freq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  let fontCss = ''
  const gf = googleFonts[0] || (font ? `https://fonts.googleapis.com/css2?family=${encodeURIComponent(font)}:wght@400;600;800&display=swap` : '')
  if (gf) {
    const r = await get(gf, 500_000, 'text/css')
    if (r) {
      const sheet = r.buf.toString('utf-8')
      const fam = sheet.match(/font-family:\s*['"]?([^;'"]+)/)?.[1]
      const faces = [...sheet.matchAll(/@font-face\s*{[^}]+}/g)].map(m => m[0]).filter(f => /latin/.test(f) || !/unicode-range/.test(f)).slice(0, 6)
      let n = 0
      for (const face of faces) {
        const src = face.match(/url\(([^)]+)\)/)?.[1]?.replace(/["']/g, '')
        const file = src ? await get(src, 600_000) : null
        if (!file) continue
        fontCss += face.replace(/src:[^;]+;/, `src: url(data:font/woff2;base64,${file.buf.toString('base64')}) format("woff2");`) + '\n'
        n++
      }
      if (n && fam) font = fam.trim()
      else if (font) notes.push(`A fonte "${font}" não está no Google Fonts; usei uma fonte parecida do sistema.`)
    }
  }

  // Logo: SVG/PNG logo image, then apple-touch-icon, then og:image
  const imgs = [...html.matchAll(/<img[^>]+>/gi)].map(m => m[0]).filter(t => /logo/i.test(t)).map(t => t.match(/src=["']([^"']+)/i)?.[1]).filter(Boolean) as string[]
  const icons = [
    ...imgs,
    attr(/<link[^>]+rel=["']apple-touch-icon[^"']*["'][^>]+href=["']([^"']+)/i),
    attr(/<link[^>]+rel=["']icon["'][^>]+type=["']image\/svg\+xml["'][^>]+href=["']([^"']+)/i),
    attr(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i),
  ].filter(Boolean).map(h => abs(h!)).filter(Boolean)
  let logoDataUri: string | undefined
  for (const src of icons.slice(0, 5)) {
    const r = await get(src, 1_500_000, 'image/*')
    if (!r) continue
    const type = r.type.split(';')[0] || (/\.svg/i.test(src) ? 'image/svg+xml' : 'image/png')
    if (!/^image\/(png|jpeg|webp|svg\+xml|gif)$/.test(type)) continue
    logoDataUri = `data:${type};base64,${r.buf.toString('base64')}`
    break
  }
  if (!logoDataUri) notes.push('Não encontrei a logo no site.')

  return { brand: { url, name, description, colors, font, logoDataUri, notes }, fontCss }
}
