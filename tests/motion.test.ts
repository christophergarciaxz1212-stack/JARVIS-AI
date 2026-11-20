import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { alignScript, mix, readWav, SR, speechSegments, Track, writeWav } from '@/lib/motion/audio'
import { findBrowser } from '@/lib/motion/chrome'
import { normalizeScenes, parseComposition, setMotionLlm, snapScenes } from '@/lib/motion/compose'
import { createJob, getJob, jobDir } from '@/lib/motion/jobs'
import { buildPage, staticIssues } from '@/lib/motion/template'
import type { ChatMessage } from '@/lib/agents/models'
import { mediaCommandRunner } from '@/lib/media/commands'
import { imageFile, listImages, setImageFetch } from '@/lib/media/images'
import { slashSkill } from '@/lib/engine/chat'
import { completion, tempProject, until } from './helpers'

const GOOD_JS = `
function renderFrame(n) {
  const t = T(n), s = sceneAt(n);
  const u = spring(s.local / FPS - 0.1, 5, 0.55);
  const w = wordAt(n);
  stage.innerHTML = '<div class="bg" style="transform:scale(' + (1 + 0.04 * t) + ')"></div>' +
    '<div class="title" style="transform:translateY(' + ((1 - u) * 200) + 'px);opacity:' + clamp(u * 1.5) + '">' + esc(s.name) + '</div>' +
    '<div class="word">' + (w ? esc(w.text) : '') + '</div>';
}`
const block = (lang: string, body: string) => '```' + lang + '\n' + body + '\n```'
const COMP = (js: string) => [
  block('css', '.bg{position:absolute;inset:-5%;background:radial-gradient(circle at 50% 30%,#3b82f6,#0b0b0f 70%)} .title{position:absolute;top:40%;width:100%;text-align:center;font:800 120px Segoe UI;color:#fff} .word{position:absolute;bottom:20%;width:100%;text-align:center;font:700 80px Segoe UI;color:#93c5fd}'),
  block('html', ''),
  block('js', js),
  block('json', JSON.stringify({ sfx: [{ frame: 0, type: 'impact' }, { frame: 6, type: 'pop' }, { frame: 12, type: 'whoosh' }, { frame: 30, type: 'nope' }], pad: { freqs: [110, 220], start: 0, end: 3, vol: 0.04 } })),
].join('\n')

describe('Motion: peças', () => {
  it('efeitos sonoros caem no quadro certo e a mixagem não estoura', () => {
    const tr = new Track(1, 60)
    tr.pop(30)
    const i = Math.round(0.5 * SR)
    expect(Math.abs(tr.buf[i - 10])).toBe(0)
    expect(Math.max(...Array.from(tr.buf.subarray(i, i + 2000)).map(Math.abs))).toBeGreaterThan(0.05)
    const loud = new Float32Array(SR).fill(3)
    const out = mix(1, [{ pcm: loud, gain: 1 }])
    expect(Math.max(...Array.from(out.subarray(0, 1000)))).toBeLessThanOrEqual(0.9)
  })

  it('WAV ida e volta e reamostragem', () => {
    const dir = tempProject()
    const pcm = new Float32Array(SR / 2).map((_, k) => Math.sin(k / 10) * 0.5)
    writeWav(path.join(dir, 'a.wav'), pcm)
    const back = readWav(path.join(dir, 'a.wav'))
    expect(back.length).toBe(pcm.length)
    expect(Math.abs(back[100] - pcm[100])).toBeLessThan(0.001)
  })

  it('acha os trechos de fala e distribui o roteiro neles', () => {
    const pcm = new Float32Array(SR * 3)
    for (const [a, b] of [[0.2, 1.0], [1.8, 2.6]]) for (let k = Math.round(a * SR); k < b * SR; k++) pcm[k] = Math.sin(k / 7) * 0.4
    const segs = speechSegments(pcm)
    expect(segs).toHaveLength(2)
    expect(segs[0].start).toBeCloseTo(0.2, 1)
    expect(segs[1].end).toBeCloseTo(2.6, 1)
    const words = alignScript('Olá turma hoje tem prova', segs)
    expect(words).toHaveLength(5)
    expect(words[0].start).toBeCloseTo(0.2, 1)
    expect(words[4].end).toBeCloseTo(2.6, 1)
    expect(words.every((w, i) => i === 0 || w.start >= words[i - 1].start)).toBe(true)
  })

  it('cenas sem buracos e presas às palavras da narração', () => {
    const scenes = normalizeScenes([{ name: 'b', start: 3, end: 5 }, { name: 'a', start: 0.5, end: 2 }], 6)
    expect(scenes.map(s => [s.name, s.start, s.end])).toEqual([['a', 0, 2], ['b', 2, 6]])
    const snapped = snapScenes(scenes, [{ word: 'oi', start: 0.1, end: 0.5 }, { word: 'prova', start: 2.3, end: 2.8 }])
    expect(snapped[1].start).toBe(2.3)
    expect(snapped[0].end).toBe(2.3)
  })

  it('recusa código que quebra o determinismo ou acessa a rede', () => {
    expect(staticIssues('function renderFrame(n){ stage.style.opacity = Math.random() }')[0]).toMatch(/Math\.random/)
    expect(staticIssues('function renderFrame(n){ fetch("https://x") }').join()).toMatch(/rede/)
    expect(staticIssues('const a = 1')).toEqual(['Falta a função renderFrame(n)'])
    expect(staticIssues(GOOD_JS)).toEqual([])
    const comp = parseComposition(COMP(GOOD_JS), [{ name: 'x', start: 0, end: 2 }], 't', 120)
    expect(comp.sfx.map(s => s.type)).toEqual(['impact', 'pop', 'whoosh'])
    const html = buildPage(comp, { width: 1080, height: 1920, fps: 60, frames: 120, words: [] })
    expect(html).toContain("default-src 'none'")
    expect(html).toContain('function renderFrame')
  })
})

describe('Chat: /video, /imagem e pedidos em português', () => {
  it('reconhece pedidos de vídeo e imagem sem pegar perguntas comuns', () => {
    expect(mediaCommandRunner('Jarvis, crie um vídeo sobre o meu app de estudos')).toBeTypeOf('function')
    expect(mediaCommandRunner('gere uma imagem de um gato astronauta')).toBeTypeOf('function')
    expect(mediaCommandRunner('/imagem logo minimalista azul')).toBeTypeOf('function')
    expect(mediaCommandRunner('/video promo da loja')).toBeTypeOf('function')
    expect(mediaCommandRunner('como criar um vídeo no CapCut?')).toBeNull()
    expect(mediaCommandRunner('qual a melhor imagem para perfil?')).toBeNull()
    expect(mediaCommandRunner('crie um vídeo')).toBeNull()
  })

  it('gera a imagem, guarda no JARVIS e responde com ela no chat', async () => {
    setMotionLlm(async () => { throw new Error('sem IA') })
    let asked = ''
    setImageFetch((async (url: string) => { asked = url; return new Response(new Uint8Array(5000).fill(7), { headers: { 'Content-Type': 'image/jpeg' } }) }) as unknown as typeof fetch)
    const reply = await mediaCommandRunner('Gere uma imagem de um gato astronauta, vertical')!()
    expect(asked).toMatch(/^https:\/\/image\.pollinations\.ai\/prompt\/.+width=768&height=1344/)
    const id = reply.match(/\/api\/media\?image=([\w-]+)/)![1]
    expect(listImages()[0]).toMatchObject({ id, prompt: 'um gato astronauta, vertical' })
    expect(fs.existsSync(imageFile(id)!.file)).toBe(true)
  })

  it('/skill sem extensão instalada segue como mensagem normal', () => {
    expect(slashSkill('/naoexiste faça algo')).toBeNull()
    expect(slashSkill('texto normal')).toBeNull()
  })
})

describe.runIf(!!findBrowser())('Motion: vídeo de verdade (Chrome + voz do Windows + WebCodecs)', () => {
  it('roteiro → narração → cena com erro → correção → MP4 com áudio', async () => {
    const calls: string[] = []
    setMotionLlm(async (model, messages: ChatMessage[]) => {
      const sys = messages[0].content
      if (sys.includes('diretor de motion design')) {
        calls.push('plano')
        return completion(JSON.stringify({ title: 'Teste JARVIS', style: 'app-promo', narration: 'Olá! Este é o JARVIS.', scenes: [{ name: 'Abertura', start: 0, end: 1.2, idea: 'título' }, { name: 'Fecho', start: 1.2, end: 3, idea: 'logo' }] }), model)
      }
      if (sys.includes('corrige')) {
        calls.push('correção')
        expect(messages[1].content).toMatch(/naoExiste/)
        return completion(COMP(GOOD_JS), model)
      }
      calls.push('cena')
      return completion(COMP(GOOD_JS.replace('const w = wordAt(n);', 'const w = wordAt(n); if (n > 20) naoExiste();')), model)
    }, async () => ['groq|fake'])

    const job = createJob({ prompt: 'vídeo de teste', seconds: 3, fps: 30, narration: 'jarvis', style: 'app-promo' })
    await until(() => ['done', 'failed', 'canceled'].includes(getJob(job.id)!.status), 170_000)
    const done = getJob(job.id)!
    console.log('JOB LOGS:\n' + done.log.map(l => l.text).join('\n'))
    expect(done.error).toBeUndefined()
    expect(done.status).toBe('done')
    expect(calls).toEqual(['plano', 'cena', 'correção'])
    expect(done.words?.map(w => w.word.replace(/[^\wÀ-ú]/g, ''))).toEqual(['Olá', 'Este', 'é', 'o', 'JARVIS'])

    const mp4 = fs.readFileSync(path.join(jobDir(job.id), 'video.mp4'))
    expect(mp4.toString('ascii', 4, 8)).toBe('ftyp')
    expect(mp4.includes(Buffer.from('avc1'))).toBe(true)
    expect(mp4.includes(Buffer.from('mp4a')) || mp4.includes(Buffer.from('Opus'))).toBe(true)
    expect(done.frames).toBeGreaterThanOrEqual(60)
    expect(done.previews.length).toBe(6)
    expect(done.log.some(l => /Teste: todos os quadros ok/.test(l.text))).toBe(true)
  }, 180_000)

  it('modelo dos vídeos (Notícia tech): o kit K.* renderiza de verdade no Chrome', async () => {
    let sysCena = ''
    const KIT_JS_SCENE = [
      'function renderFrame(n) {',
      '  const s = sceneAt(n);',
      "  let h = K.bg(n) + K.brand(n, 'TESTE · IA');",
      "  const cenas = [",
      "    () => K.place(K.pill('ATENÇÃO', 'tag'), { x: 70, y: 300 }, n, s.start, 'left') + K.place(K.title('O JARVIS faz vídeos', ['vídeos'], 104), { x: 70, y: 400, w: 940 }, n, s.start, 'up') + K.place(K.appIcon('sparkle', 'JARVIS', { badge: 'NOVO' }), { x: 150, y: 820 }, n, s.start, 'scale') + K.place(K.mascot(n), { center: true, y: 1150 }, n, s.start, 'up'),",
      "    () => K.place(K.pill('/modelo-dos-videos', 'cmd'), { center: true, y: 420 }, n, s.start, 'scale') + K.place(K.wave(n, { label: 'SUA VOZ' }), { center: true, y: 700 }, n, s.start, 'up') + K.place(K.chips(['Passos', 'Notícia', 'Dados', 'Analogia'], 1), { center: true, y: 1100 }),",
      '  ];',
      '  stage.innerHTML = h + cenas[s.index % cenas.length]() + K.caption(n);',
      '}',
    ].join('\n')
    setMotionLlm(async (model, messages: ChatMessage[]) => {
      const sys = messages[0].content
      if (sys.includes('diretor de motion design')) return completion(JSON.stringify({ title: 'JARVIS em notícia', style: 'tech-news', narration: 'Atenção! O JARVIS agora faz vídeos.', scenes: [{ name: 'Manchete', start: 0, end: 1.5, idea: 'título' }, { name: 'Comando', start: 1.5, end: 3, idea: 'cmd' }] }), model)
      sysCena = sys
      return completion(COMP(KIT_JS_SCENE), model)
    }, async () => ['groq|fake'])

    const job = createJob({ prompt: 'notícia: o JARVIS faz vídeos', seconds: 3, fps: 30, narration: 'jarvis', style: 'tech-news' })
    await until(() => ['done', 'failed', 'canceled'].includes(getJob(job.id)!.status), 170_000)
    const done = getJob(job.id)!
    expect(done.error).toBeUndefined()
    expect(done.status).toBe('done')
    // A IA recebeu a documentação do kit do modelo
    expect(sysCena).toMatch(/KIT VISUAL DO MODELO "Notícia tech neon"/)
    expect(done.log.some(l => /Teste: todos os quadros ok/.test(l.text))).toBe(true)
    const comp = JSON.parse(fs.readFileSync(path.join(jobDir(job.id), 'composition.json'), 'utf8'))
    expect(comp.kit).toBe('tech-news')
    const page = fs.readFileSync(path.join(jobDir(job.id), 'composition.html'), 'utf8')
    expect(page).toContain('class="k-tech-news"')
    expect(page).toContain('const K = (function')
  }, 180_000)
})
