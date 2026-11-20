import fs from 'fs'
import os from 'os'
import path from 'path'
import { describe, expect, it, afterAll } from 'vitest'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-social-video-'))
process.env.JARVIS_DATA_DIR = path.join(tmp, 'data')
process.env.VITEST = '1'
const prevSocialAutopost = process.env.SOCIAL_AUTOPOST
delete process.env.SOCIAL_AUTOPOST

import { saveConfig, setMetricoolFetch, TOKEN_ENV } from '@/lib/social/metricool'
import { SOCIAL_TOOL_SPECS, executeSocialTool } from '@/lib/social/agentTools'
import { setCaptionLlm } from '@/lib/social/caption'

const makeVideo = () => {
  const dir = path.join(process.env.JARVIS_DATA_DIR!, 'video', 'vid-test-1')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'video.mp4'), Buffer.alloc(128_000, 1))
  fs.writeFileSync(path.join(dir, 'script.json'), JSON.stringify({ request: { prompt: 'Crie um vídeo curto explicando recursão' }, brief: { title: 'Recursão em 60 segundos' }, scenes: [{ name: 'abertura', vo: 'Recursão é quando uma função chama a si mesma' }] }))
  fs.writeFileSync(path.join(process.env.JARVIS_DATA_DIR!, 'video', 'jobs.json'), JSON.stringify([{ id: 'vid-test-1', status: 'done', title: 'Recursão em 60 segundos', output: path.join(dir, 'video.mp4'), finishedAt: Date.now(), createdAt: Date.now(), request: { prompt: 'Crie um vídeo curto explicando recursão' } }]))
  return dir
}

describe('social_video no Metricool', () => {
  afterAll(() => { try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}; process.env.SOCIAL_AUTOPOST = prevSocialAutopost })

  it('social_video está presente nas specs do agente', () => {
    const spec = SOCIAL_TOOL_SPECS.find(t => t.name === 'social_video')
    expect(spec).toBeDefined()
    expect(spec!.name).toBe('social_video')
    expect(spec!.parameters.required).toEqual(['networks'])
    expect(spec!.parameters.properties).toHaveProperty('video_id')
    expect(spec!.parameters.properties).toHaveProperty('caption')
    expect(spec!.parameters.properties).toHaveProperty('when')
  })

  it('gera legenda pela IA e envia rascunho pro Metricool com o vídeo anexado', async () => {
    makeVideo()
    // Provedor falso de caption: evita chamar rede de verdade nos testes
    setCaptionLlm(async () => ({ text: JSON.stringify({ hook: 'Recursão explicada em 60 segundos', body: 'Da base ao infinito.', cta: 'Salva para a prova', hashtags: ['IA', 'TCC', 'algoritmos'] }), usage: { inputTokens: 10, outputTokens: 10 } } as never), async () => ['fake|gpt-fake'])
    const posts: Array<Record<string, unknown>> = []
    setMetricoolFetch(async (url, init) => {
      const u = String(url)
      if (u.includes('upload-transactions') && init?.method === 'PUT') {
        return new Response(JSON.stringify({ data: { presignedUrl: 'https://example.com/upload', fileUrl: 'https://s3.example.com/planner/v.mp4' } }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (u === 'https://example.com/upload' && init?.method === 'PUT') return new Response('', { status: 200 })
      if (u.includes('upload-transactions') && init?.method === 'PATCH') {
        return new Response(JSON.stringify({ data: { convertedFileUrl: 'https://cdn.metricool/v.mp4' } }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (u.includes('/v2/scheduler/posts') && init?.method === 'POST') {
        const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
        posts.push(body)
        return new Response(JSON.stringify({ data: { id: 987654, text: body.text, media: body.media, publicationDate: body.publicationDate } }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    process.env[TOKEN_ENV] = 'fake-token'
    saveConfig({ userId: '987', blogId: '42', timezone: 'America/Sao_Paulo' })
    const host = { agent: { id: 'agent-test', name: 'Agente Social' }, log: () => undefined } as never
    const result = await executeSocialTool(host, { tool: 'social_video', args: { networks: ['instagram', 'tiktok'], video_id: 'vid-test-1', when: '2027-01-01T19:30:00Z' } } as never)
    expect(posts.length).toBe(1)
    expect(posts[0].text).toContain('Recursão explicada')
    expect(posts[0].media).toEqual(['https://cdn.metricool/v.mp4'])
    expect(posts[0].draft).toBe(true)
    expect(posts[0].publicationDate).toMatchObject({ dateTime: '2027-01-01T19:30:00' })
    expect(result.output).toMatch(/Rascunho/)
  })
})
