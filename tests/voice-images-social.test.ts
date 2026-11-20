import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chunkText, pcmToWav, setTtsFetch, speak, speakableText, toPcm, wavToPcm } from '@/lib/voice/gemini'
import { narrate } from '@/lib/voice/narrate'
import { savePrefs } from '@/lib/prefs'
import { generateImage, parseImageRequest, providerStatus, setImageFetch } from '@/lib/media/images'
import {
  buildPostBody, connect, createPost, getConfig, listBrands, overview, parseCsv, saveConfig, setMetricoolFetch, tiktokContent, uploadMedia,
} from '@/lib/social/metricool'
import { executeSocialTool } from '@/lib/social/agentTools'
import { mediaCommandRunner } from '@/lib/media/commands'

type Call = { url: string; init?: RequestInit; body?: unknown }
function recorder(handler: (url: string, init: RequestInit | undefined, n: number) => Response | Promise<Response>) {
  const calls: Call[] = []
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    let body: unknown
    if (typeof init?.body === 'string') { try { body = JSON.parse(init.body) } catch { body = init.body } }
    calls.push({ url, init, body })
    return handler(url, init, calls.length)
  }) as typeof fetch
  return { f, calls }
}
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } })
const tone = (seconds: number, rate = 24000) => {
  const pcm = Buffer.alloc(seconds * rate * 2)
  for (let i = 0; i < seconds * rate; i++) pcm.writeInt16LE(Math.round(Math.sin(i / 8) * (i % rate < rate * 0.7 ? 12000 : 10)), i * 2)
  return pcm
}

const OLD_ENV = { ...process.env }
afterEach(() => { process.env = { ...OLD_ENV } })

// ─── Gemini voices ───────────────────────────────────────────────────────────

describe('Gemini voices', () => {
  it('wraps and unwraps PCM, and reads L16 rates from the mime type', () => {
    const pcm = tone(1)
    const wav = pcmToWav(pcm, 24000)
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
    expect(wavToPcm(wav)).toEqual({ pcm, rate: 24000 })
    expect(toPcm(pcm, 'audio/L16;codec=pcm;rate=16000').rate).toBe(16000)
    expect(toPcm(wav, 'audio/wav').pcm.length).toBe(pcm.length)
  })

  it('speaks clean text: no code, links, markdown or JARVIS markers', () => {
    const t = speakableText('# Pronto\n**Feito!** Veja [o guia](https://x.com/a).\n```ts\nconst a = 1\n```\n[[motion:abc]] - item `npm test`')
    expect(t).not.toMatch(/```|\*\*|https|\[\[|#/)
    expect(t).toContain('trecho de código omitido')
    expect(t).toContain('o guia')
    expect(t).toContain('npm test')
  })

  it('splits long text at sentence boundaries', () => {
    const parts = chunkText('Frase um. '.repeat(300), 900)
    expect(parts.length).toBeGreaterThan(2)
    expect(parts.every(p => p.length <= 900)).toBe(true)
  })

  it('Gemini 3.x: style goes in speech_metadata (never spoken) via the Interactions API; result is cached', async () => {
    process.env.GEMINI_API_KEY = 'test-key'
    const { f, calls } = recorder(() => json({ steps: [{ type: 'model_output', content: [{ data: pcmToWav(tone(1)).toString('base64'), mime_type: 'audio/wav' }] }] }))
    setTtsFetch(f)
    const a = await speak('Olá, eu sou o JARVIS.', { model: 'gemini-3.8-flash-tts', voice: 'Puck', style: 'animado' })
    expect(calls[0].url).toMatch(/\/v1beta\/interactions$/)
    expect(calls[0].body).toMatchObject({
      model: 'gemini-3.8-flash-tts',
      input: [{ type: 'user_input', content: [{ type: 'text', text: 'Olá, eu sou o JARVIS.', annotations: [{ type: 'speech_metadata', style: 'animado' }] }] }],
      generation_config: { speech_config: [{ voice: 'Puck' }] },
    })
    expect(a.cached).toBe(false)
    expect(a.seconds).toBeCloseTo(1, 1)
    const b = await speak('Olá, eu sou o JARVIS.', { model: 'gemini-3.8-flash-tts', voice: 'Puck', style: 'animado' })
    expect(b.cached).toBe(true)
    expect(calls).toHaveLength(1)
  })

  it('Gemini 2.5: generateContent with the style as a prefix and raw L16 audio', async () => {
    process.env.GEMINI_API_KEY = 'test-key'
    const { f, calls } = recorder(() => json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: tone(1).toString('base64') } }] } }] }))
    setTtsFetch(f)
    const r = await speak('Teste dois.', { model: 'gemini-2.5-flash-preview-tts', voice: 'Kore', style: 'calmo' })
    expect(calls[0].url).toMatch(/models\/gemini-2\.5-flash-preview-tts:generateContent$/)
    expect(calls[0].body).toMatchObject({ contents: [{ parts: [{ text: 'calmo: Teste dois.' }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } } } })
    expect(r.wav.toString('ascii', 0, 4)).toBe('RIFF')
  })

  it('unknown voices fall back to the default and quota errors are explained', async () => {
    process.env.GEMINI_API_KEY = 'test-key'
    const { f, calls } = recorder(() => json({ error: { message: 'quota' } }, 429))
    setTtsFetch(f)
    await expect(speak('Oi de novo', { model: 'gemini-3.8-flash-tts', voice: 'NaoExiste' })).rejects.toThrow(/Cota de voz do Gemini/)
    expect(calls[0].body).toMatchObject({ generation_config: { speech_config: [{ voice: 'Kore' }] } })
  })

  it('video narration with a Gemini voice gets real audio and word timings spread over the speech', async () => {
    process.env.GEMINI_API_KEY = 'test-key'
    savePrefs({ voice: { provider: 'gemini', model: 'gemini-3.8-flash-tts', voice: 'Charon', style: '', autoRead: false } })
    setTtsFetch(recorder(() => json({ steps: [{ content: [{ data: pcmToWav(tone(3)).toString('base64'), mime_type: 'audio/wav' }] }] })).f)
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jv-narr-')), 'narracao.wav')
    const r = await narrate('Bem-vindo ao JARVIS, seu assistente pessoal.', out)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.provider).toMatch(/Gemini · Charon/)
      expect(r.words.map(w => w.word)).toEqual(['Bem-vindo', 'ao', 'JARVIS,', 'seu', 'assistente', 'pessoal.'])
      expect(r.words.at(-1)!.end).toBeGreaterThan(r.words[0].start)
    }
    expect(fs.readFileSync(out).toString('ascii', 0, 4)).toBe('RIFF')
  })
})

// ─── Images ──────────────────────────────────────────────────────────────────

describe('image generation', () => {
  // The prompt enhancer looks up a model in the live catalog: a running local Ollama would answer for real (slowly)
  beforeEach(() => { vi.stubGlobal('fetch', async () => { throw new Error('sem rede nos testes') }) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('understands format and number of variations in Portuguese', () => {
    expect(parseImageRequest('gere 4 variações de um logo')).toEqual({ aspect: '1:1', count: 4 })
    expect(parseImageRequest('imagem vertical para stories')).toMatchObject({ aspect: '9:16', count: 1 })
    expect(parseImageRequest('banner horizontal para o youtube')).toMatchObject({ aspect: '16:9' })
    expect(parseImageRequest('post para o feed do instagram')).toMatchObject({ aspect: '4:5' })
    expect(parseImageRequest('me dá três opções de capa')).toMatchObject({ count: 3 })
    for (const t of ['gere uma imagem de um gato', 'gere 4 imagens de um gato', 'crie três fotos de praia', 'faça variações de um logo'])
      expect(mediaCommandRunner(t), t).toBeTypeOf('function')
    expect(mediaCommandRunner('qual imagem fica melhor no perfil?')).toBeNull()
  })

  it('auto: tries Gemini, explains the missing quota, falls back to the free generator and stops retrying Gemini', async () => {
    process.env.GEMINI_API_KEY = 'test-key'
    const { f, calls } = recorder(url => url.includes('generativelanguage')
      ? json({ error: { message: 'You exceeded your current quota, please check your plan and billing details.' } }, 429)
      : new Response(new Uint8Array(5000).fill(9), { headers: { 'content-type': 'image/jpeg' } }))
    setImageFetch(f)
    const img = await generateImage('um farol na tempestade', { aspect: '16:9' })
    expect(img.provider).toMatch(/Pollinations/)
    expect(img.fallbacks?.[0]).toMatch(/gemini: .*cota/)
    expect(calls.some(c => /model=sana/.test(c.url) && /width=1344&height=768/.test(c.url))).toBe(true)
    expect(providerStatus().gemini.blocked).toMatch(/cota/)
    const before = calls.filter(c => c.url.includes('generativelanguage')).length
    await generateImage('outro farol', { aspect: '1:1' })
    expect(calls.filter(c => c.url.includes('generativelanguage')).length).toBe(before)
  })

  it('Pollinations when chosen (free, no key), honoring the requested size', async () => {
    delete process.env.OPENAI_API_KEY
    savePrefs({ images: { provider: 'pollinations', style: '' } })
    const { f, calls } = recorder(() => new Response(new Uint8Array(5000).fill(9), { headers: { 'content-type': 'image/jpeg' } }))
    setImageFetch(f)
    const img = await generateImage('capa de podcast', { aspect: '9:16' })
    expect(calls[0].url).toContain('image.pollinations.ai')
    expect(calls[0].url).toContain('width=768&height=1344')
    expect(img).toMatchObject({ provider: expect.stringMatching(/Pollinations/) })
    savePrefs({ images: { provider: 'auto', style: '' } })
  })
})

// ─── Metricool ───────────────────────────────────────────────────────────────

describe('Metricool', () => {
  const brands = [{ id: 42, label: 'Minha Marca', instagram: 'minhamarca', tiktok: 'minhamarca.tt', picture: 'https://x/p.png' }]

  it('connect validates the token by listing brands, then keeps it in the keys vault', async () => {
    const { f, calls } = recorder(url => url.includes('simpleProfiles') ? json(brands) : json({}))
    setMetricoolFetch(f)
    await expect(connect('tok', 'abc')).rejects.toThrow(/número/)
    const list = await connect('  mc-token-123  ', '987')
    expect(list).toEqual([expect.objectContaining({ blogId: '42', label: 'Minha Marca', instagram: 'minhamarca', tiktok: 'minhamarca.tt' })])
    const req = calls.at(-1)!
    expect(req.url).toMatch(/^https:\/\/app\.metricool\.com\/api\/admin\/simpleProfiles\?userId=987$/)
    expect((req.init!.headers as Record<string, string>)['X-Mc-Auth']).toBe('mc-token-123')
    expect(process.env.METRICOOL_API_TOKEN).toBe('mc-token-123')
    expect(getConfig()).toMatchObject({ userId: '987', blogId: '42', brandLabel: 'Minha Marca' })
  })

  it('a refused token is explained and not saved', async () => {
    delete process.env.METRICOOL_API_TOKEN
    setMetricoolFetch(recorder(() => new Response('{"message":"forbidden"}', { status: 403 })).f)
    await expect(connect('bad', '555')).rejects.toThrow(/Advanced e Custom/)
    expect(process.env.METRICOOL_API_TOKEN).toBeUndefined()
  })

  it('builds scheduled posts per the API contract and refuses invalid ones', () => {
    const future = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 16)
    const body = buildPostBody({ text: 'Novo vídeo! #ia', networks: ['instagram', 'tiktok'], when: future, instagramType: 'REEL', media: ['https://cdn/x.mp4'] }, 'America/Belem')
    expect(body).toMatchObject({
      publicationDate: { dateTime: `${future}:00`, timezone: 'America/Belem' },
      text: 'Novo vídeo! #ia',
      providers: [{ network: 'instagram' }, { network: 'tiktok' }],
      media: ['https://cdn/x.mp4'],
      autoPublish: true,
      draft: false,
      instagramData: { type: 'REEL', autoPublish: true },
      tiktokData: { privacyOption: 'PUBLIC_TO_EVERYONE' },
    })
    expect(() => buildPostBody({ text: 'x', networks: ['tiktok'], when: future }, 'UTC')).toThrow(/TikTok exige/)
    expect(() => buildPostBody({ text: 'x', networks: ['instagram'], when: '2020-01-01T10:00', media: ['m'] }, 'UTC')).toThrow(/futuro/)
    expect(() => buildPostBody({ text: 'x', networks: [], when: future }, 'UTC')).toThrow(/rede/)
    expect(buildPostBody({ text: 'ideia', networks: ['instagram'], when: future, draft: true }, 'UTC')).toMatchObject({ draft: true })
  })

  it('creates posts with userId/blogId on the query and the token in the header', async () => {
    process.env.METRICOOL_API_TOKEN = 'mc-token'
    saveConfig({ userId: '987', blogId: '42', timezone: 'America/Belem' })
    const { f, calls } = recorder(() => json({ data: { id: 777, text: 'oi' } }))
    setMetricoolFetch(f)
    const when = new Date(Date.now() + 86_400_000).toISOString().slice(0, 16)
    const post = await createPost({ text: 'oi', networks: ['instagram'], when, media: ['https://cdn/a.jpg'] })
    expect(post.id).toBe(777)
    expect(calls[0].url).toMatch(/\/v2\/scheduler\/posts\?userId=987&blogId=42$/)
    expect(calls[0].init!.method).toBe('POST')
  })

  it('uploads a local file through the presigned S3 flow (retrying without checksum when it is not signed)', async () => {
    process.env.METRICOOL_API_TOKEN = 'mc-token'
    saveConfig({ userId: '987', blogId: '42' })
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jv-up-')), 'video.mp4')
    fs.writeFileSync(file, Buffer.alloc(4096, 1))
    const { f, calls } = recorder((url, init) => {
      if (url.includes('upload-transactions') && init?.method === 'PUT') return json({ data: { presignedUrl: 'https://s3.example/put?sig=1', fileUrl: 'https://s3.example/planner/v.mp4', key: 'k', bucket: 'b', expiresAt: 'x', uploadType: 'SIMPLE' } })
      if (url.startsWith('https://s3.example') && (init?.headers as Record<string, string>)['x-amz-checksum-sha256']) return new Response('<Error><Code>SignatureDoesNotMatch</Code></Error>', { status: 403 })
      if (url.startsWith('https://s3.example')) return new Response('', { status: 200 })
      if (url.includes('upload-transactions') && init?.method === 'PATCH') return json({ data: { fileUrl: 'https://s3.example/planner/v.mp4', convertedFileUrl: 'https://cdn.metricool/v.mp4', key: 'k', bucket: 'b' } })
      return json({}, 404)
    })
    setMetricoolFetch(f)
    expect(await uploadMedia(file)).toBe('https://cdn.metricool/v.mp4')
    const tx = calls[0].body as { resourceType: string; contentType: string; parts: Array<{ size: number; endByte: number; hash: string }> }
    expect(tx).toMatchObject({ resourceType: 'planner', contentType: 'video/mp4', parts: [{ size: 4096, startByte: 0, endByte: 4096 }] })
    expect(Buffer.from(tx.parts[0].hash, 'base64')).toHaveLength(32)
    expect(calls.filter(c => c.url.startsWith('https://s3.example'))).toHaveLength(2)
    expect(calls.at(-1)!.body).toEqual({ simple: { fileUrl: 'https://s3.example/planner/v.mp4' } })
  })

  it('reads TikTok analytics delivered as CSV and keeps the dashboard working when one network fails', async () => {
    process.env.METRICOOL_API_TOKEN = 'mc-token'
    saveConfig({ userId: '987', blogId: '42' })
    expect(parseCsv('a;b\n"x;1";2\n')).toEqual([{ a: 'x;1', b: '2' }])
    setMetricoolFetch(recorder(url => {
      if (url.includes('/posts/tiktok')) return new Response('Video ID,Title,Published At,Views,Likes,Comments,Shares\n1,"Dica de IA, parte 1",2026-11-10T10:00:00,15200,900,40,12\n', { headers: { 'content-type': 'text/csv' } })
      if (url.includes('network=instagram')) return json({ error: 'não conectado' }, 400)
      if (url.includes('/timelines')) return json({ data: [{ metric: 'followers_count', values: [{ dateTime: '2026-11-01', value: 1000 }, { dateTime: '2026-11-14', value: 1200 }] }] })
      if (url.includes('/instagram')) return json({ data: [{ postId: 'p1', publishedAt: { dateTime: '2026-11-12T12:00:00' }, content: 'Post', likes: 50, comments: 3, views: 800, reach: 700, engagement: 7 }] })
      return json({ data: [] })
    }).f)
    const tt = await tiktokContent(30)
    expect(tt[0]).toMatchObject({ id: '1', text: 'Dica de IA, parte 1', views: 15200, likes: 900, comments: 40, shares: 12 })
    const o = await overview(30)
    expect(o.igFollowers.ok).toBe(false)
    expect(o.ttFollowers.ok && o.ttFollowers.value.values.at(-1)!.value).toBe(1200)
    expect(o.igContent.ok && o.igContent.value[0]).toMatchObject({ id: 'p1', likes: 50, publishedAt: '2026-11-12T12:00:00' })
  })

  it('the agent can only create DRAFTS — publishing stays with the user', async () => {
    process.env.METRICOOL_API_TOKEN = 'mc-token'
    saveConfig({ userId: '987', blogId: '42' })
    const { f, calls } = recorder(() => json({ data: { id: 9 } }))
    setMetricoolFetch(f)
    const r = await executeSocialTool({ agent: { name: 'Social' } as never, log: () => {} }, { tool: 'social_draft', args: { text: 'legenda', networks: ['instagram'] } })
    expect(r.output).toMatch(/Rascunho 9/)
    expect(calls[0].body).toMatchObject({ draft: true })
    expect(await listBrands()).toBeDefined()
  })
})
