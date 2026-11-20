import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { generateImage, setImageFetch } from '@/lib/media/images'

// JPEG mínimo com cabeçalho SOF0 1344×768 (para o leitor de tamanho)
function fakeJpeg(w: number, h: number) {
  const b = Buffer.alloc(2000, 0)
  b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; b[3] = 0xc0; b.writeUInt16BE(17, 4); b[6] = 8
  b.writeUInt16BE(h, 7); b.writeUInt16BE(w, 9)
  return b
}

describe('imagens: FLUX da NVIDIA primeiro', () => {
  const OLD = { dir: process.env.JARVIS_DATA_DIR, nv: process.env.NVIDIA_API_KEY, gm: process.env.GEMINI_API_KEY }
  let dir = ''
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jv-img-'))
    process.env.JARVIS_DATA_DIR = dir
    process.env.NVIDIA_API_KEY = 'nvapi-test'
    delete process.env.GEMINI_API_KEY
  })
  afterAll(() => {
    for (const [k, v] of [['JARVIS_DATA_DIR', OLD.dir], ['NVIDIA_API_KEY', OLD.nv], ['GEMINI_API_KEY', OLD.gm]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('usa o FLUX.1-dev, cai no schnell se o dev falhar e nunca manda "seed"', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = []
    setImageFetch((async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}'))
      calls.push({ url, body })
      if (url.includes('flux.1-dev')) return new Response('{"detail":"overloaded"}', { status: 503 })
      return new Response(JSON.stringify({ artifacts: [{ base64: fakeJpeg(1344, 768).toString('base64'), finishReason: 'SUCCESS' }] }), { status: 200 })
    }) as unknown as typeof fetch)
    const img = await generateImage('aerial photo of a turquoise bay with volcanic cliffs, golden hour', { aspect: '16:9', provider: 'auto', skipEnhance: true, seed: 42 })
    expect(img.provider).toMatch(/NVIDIA FLUX \(flux\.1-schnell\)/)
    expect([img.width, img.height]).toEqual([1344, 768])
    expect(calls.map(c => c.url.split('/').pop())).toEqual(['flux.1-dev', 'flux.1-schnell'])
    expect(calls.every(c => !('seed' in c.body))).toBe(true)
    expect(calls[0].body).toMatchObject({ width: 1344, height: 768 })
  })

  it('imagem barrada pelo filtro de conteúdo não é aceita', async () => {
    let n = 0
    setImageFetch((async (url: string) => {
      n++
      if (url.includes('nvidia')) return new Response(JSON.stringify({ artifacts: [{ base64: fakeJpeg(8, 8).toString('base64'), finishReason: 'CONTENT_FILTERED' }] }), { status: 200 })
      return new Response(fakeJpeg(1344, 768), { status: 200, headers: { 'content-type': 'image/jpeg' } })
    }) as unknown as typeof fetch)
    const img = await generateImage('a calm beach at sunrise, photorealistic', { aspect: '16:9', provider: 'auto', skipEnhance: true })
    expect(img.provider).toMatch(/Pollinations/)
    expect(img.fallbacks?.[0]).toMatch(/nvidia: .*CONTENT_FILTERED/)
    expect(n).toBeGreaterThanOrEqual(3)
  })
})
