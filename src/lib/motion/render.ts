import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import { SR } from './audio'
import type { Browser, Page } from './chrome'
import { VALIDATE_JS } from './template'

export interface RenderSize { width: number; height: number; fps: number; frames: number }

function muxerSource() {
  const file = path.join(process.cwd(), 'node_modules', 'mp4-muxer', 'build', 'mp4-muxer.js')
  if (!fs.existsSync(file)) throw new Error('Componente mp4-muxer não encontrado (rode npm install)')
  return fs.readFileSync(file, 'utf-8')
}

/** Opens a composition page with the network blocked (everything it needs is inlined). */
export async function openComposition(browser: Browser, htmlFile: string, size: RenderSize): Promise<Page> {
  const page = await browser.newPage('about:blank', size.width, size.height)
  await page.send('Network.enable')
  await page.send('Network.setBlockedURLs', { urls: ['http://*', 'https://*', 'ws://*', 'wss://*'] })
  await page.goto(pathToFileURL(htmlFile).href)
  return page
}

export async function validate(page: Page, size: RenderSize): Promise<{ errors: string[]; issues: string[] }> {
  const f = size.frames
  const samples = [...new Set([0, 1, Math.round(f * 0.1), Math.round(f * 0.25), Math.round(f * 0.4), Math.round(f * 0.55), Math.round(f * 0.7), Math.round(f * 0.85), f - 1].filter(n => n >= 0 && n < f))]
  return page.eval(VALIDATE_JS(samples), 60_000)
}

/** Full-size key frames (a contact sheet hides overflow and collisions). */
export async function previews(page: Page, size: RenderSize, dir: string, count = 6): Promise<Array<{ frame: number; file: string; bytes: number }>> {
  const out: Array<{ frame: number; file: string; bytes: number }> = []
  for (let i = 0; i < count; i++) {
    const n = Math.min(size.frames - 1, Math.round(((i + 0.5) / count) * size.frames))
    await page.eval(`window.renderFrame(${n})`)
    const data = Buffer.from(await page.screenshot('jpeg', 80), 'base64')
    const file = path.join(dir, `previa_${String(n).padStart(5, '0')}.jpg`)
    fs.writeFileSync(file, data)
    out.push({ frame: n, file, bytes: data.length })
  }
  return out
}

const ENCODER_JS = String.raw`
window.__enc = null;
window.encInit = async (cfg) => {
  const { Muxer, ArrayBufferTarget } = Mp4Muxer;
  let audioCodec = null;
  if (cfg.audio) {
    for (const c of [{ codec: 'mp4a.40.2', mux: 'aac' }, { codec: 'opus', mux: 'opus' }]) {
      try { if ((await AudioEncoder.isConfigSupported({ codec: c.codec, sampleRate: cfg.sampleRate, numberOfChannels: 1, bitrate: 160000 })).supported) { audioCodec = c; break } } catch {}
    }
  }
  let videoCodec = null;
  for (const codec of ['avc1.640033', 'avc1.4D4033', 'avc1.42E033']) {
    for (const hw of ['no-preference', 'prefer-software']) {
      const conf = { codec, width: cfg.width, height: cfg.height, framerate: cfg.fps, bitrate: cfg.bitrate, hardwareAcceleration: hw, avc: { format: 'avc' } };
      try { if ((await VideoEncoder.isConfigSupported(conf)).supported) { videoCodec = conf; break } } catch {}
    }
    if (videoCodec) break;
  }
  if (!videoCodec) throw new Error('Este navegador não codifica H.264');
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({ target, fastStart: 'in-memory', firstTimestampBehavior: 'offset',
    video: { codec: 'avc', width: cfg.width, height: cfg.height, frameRate: cfg.fps },
    audio: audioCodec ? { codec: audioCodec.mux, numberOfChannels: 1, sampleRate: cfg.sampleRate } : undefined });
  const state = { muxer, target, error: null, cfg, audioCodec, audio: [], audioLen: 0 };
  state.venc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: e => { state.error = String(e && e.message || e) } });
  state.venc.configure(videoCodec);
  window.__enc = state;
  return { video: videoCodec.codec, audio: audioCodec ? audioCodec.mux : null };
};
const b64bytes = b64 => { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
window.encFrame = async (b64, i) => {
  const st = window.__enc; if (st.error) throw new Error(st.error);
  const bmp = await createImageBitmap(new Blob([b64bytes(b64)], { type: 'image/jpeg' }));
  const us = 1e6 / st.cfg.fps;
  const vf = new VideoFrame(bmp, { timestamp: Math.round(i * us), duration: Math.round(us) });
  st.venc.encode(vf, { keyFrame: i % (st.cfg.fps * 2) === 0 });
  vf.close(); bmp.close();
  while (st.venc.encodeQueueSize > 6) await new Promise(r => setTimeout(r, 4));
  return 1;
};
window.encAudio = (b64) => { const st = window.__enc; const u = b64bytes(b64); const f = new Float32Array(u.buffer, u.byteOffset, u.byteLength / 4); st.audio.push(new Float32Array(f)); st.audioLen += f.length; return st.audioLen; };
window.encFinish = async () => {
  const st = window.__enc;
  await st.venc.flush();
  if (st.error) throw new Error(st.error);
  if (st.audioCodec && st.audioLen) {
    const all = new Float32Array(st.audioLen); let o = 0; for (const a of st.audio) { all.set(a, o); o += a.length; }
    const aenc = new AudioEncoder({ output: (chunk, meta) => st.muxer.addAudioChunk(chunk, meta), error: e => { st.error = String(e && e.message || e) } });
    aenc.configure({ codec: st.audioCodec.mux === 'aac' ? 'mp4a.40.2' : 'opus', sampleRate: st.cfg.sampleRate, numberOfChannels: 1, bitrate: 160000 });
    const step = 4800;
    for (let i = 0; i < all.length; i += step) {
      const part = all.subarray(i, Math.min(all.length, i + step));
      const ad = new AudioData({ format: 'f32-planar', sampleRate: st.cfg.sampleRate, numberOfFrames: part.length, numberOfChannels: 1, timestamp: Math.round(i / st.cfg.sampleRate * 1e6), data: part });
      aenc.encode(ad); ad.close();
      if (aenc.encodeQueueSize > 20) await new Promise(r => setTimeout(r, 2));
    }
    await aenc.flush();
    if (st.error) throw new Error(st.error);
  }
  st.muxer.finalize();
  st.out = new Uint8Array(st.target.buffer);
  return st.out.length;
};
window.encRead = (start, len) => { const u = window.__enc.out.subarray(start, start + len); let s = ''; for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768)); return btoa(s); };
`

/** Encoder page: WebCodecs H.264 + AAC inside Chrome, muxed to MP4 (no ffmpeg). */
async function openEncoder(browser: Browser, dir: string, size: RenderSize, withAudio: boolean) {
  // WebCodecs needs a secure context: a local file page is one
  const blank = path.join(dir, 'encoder.html')
  fs.writeFileSync(blank, '<!doctype html><meta charset="utf-8"><title>encoder</title>')
  const page = await browser.newPage(pathToFileURL(blank).href, 64, 64)
  await page.eval(`${muxerSource()};\n${ENCODER_JS};\n1`)
  const bitrate = Math.round(size.width * size.height * size.fps * 0.11)
  const codecs = await page.eval<{ video: string; audio: string | null }>(`window.encInit(${JSON.stringify({ width: size.width, height: size.height, fps: size.fps, bitrate, audio: withAudio, sampleRate: SR })})`)
  return { page, codecs }
}

export async function renderVideo(
  browser: Browser, comp: Page, size: RenderSize, audio: Float32Array | null, outFile: string,
  onProgress: (done: number) => void, signal?: AbortSignal,
): Promise<{ bytes: number; codecs: { video: string; audio: string | null } }> {
  const { page: enc, codecs } = await openEncoder(browser, path.dirname(outFile), size, !!audio)
  let inFlight: Promise<unknown> = Promise.resolve()
  for (let n = 0; n < size.frames; n++) {
    if (signal?.aborted) throw new Error('Cancelado')
    await comp.eval(`window.renderFrame(${n})`)
    const shot = await comp.screenshot('jpeg', 90)
    await inFlight
    inFlight = enc.eval(`window.encFrame(${JSON.stringify(shot)}, ${n})`, 120_000)
    if (n % 15 === 0) onProgress(n)
  }
  await inFlight
  if (audio && codecs.audio) {
    const bytes = Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength)
    const step = 4 * SR * 4 // 4 seconds per message
    for (let i = 0; i < bytes.length; i += step) await enc.eval(`window.encAudio(${JSON.stringify(bytes.subarray(i, i + step).toString('base64'))})`)
  }
  const total = await enc.eval<number>('window.encFinish()', 300_000)
  const parts: Buffer[] = []
  const chunk = 3 * 1024 * 1024
  for (let i = 0; i < total; i += chunk) parts.push(Buffer.from(await enc.eval<string>(`window.encRead(${i}, ${chunk})`, 120_000), 'base64'))
  fs.writeFileSync(outFile, Buffer.concat(parts))
  onProgress(size.frames)
  return { bytes: total, codecs }
}

/** Decodes any audio file Chrome understands (mp3, m4a, ogg, wav…) to mono 48 kHz PCM. */
export async function decodeAudioFile(browser: Browser, file: string, dir: string): Promise<Float32Array> {
  const stat = fs.statSync(file)
  if (stat.size > 60 * 1024 * 1024) throw new Error('Áudio muito grande (máximo 60 MB)')
  const blank = path.join(dir, 'decoder.html')
  fs.writeFileSync(blank, '<!doctype html><meta charset="utf-8">')
  const page = await browser.newPage(pathToFileURL(blank).href, 64, 64)
  const b64 = fs.readFileSync(file).toString('base64')
  await page.eval(`window.__a = ${JSON.stringify(b64)}; 1`)
  const len = await page.eval<number>(`(async () => {
    const s = atob(window.__a); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    const ctx = new OfflineAudioContext(1, 48000, ${SR});
    const buf = await ctx.decodeAudioData(u.buffer);
    const off = new OfflineAudioContext(1, Math.ceil(buf.duration * ${SR}), ${SR});
    const src = off.createBufferSource(); src.buffer = buf; src.connect(off.destination); src.start();
    const out = await off.startRendering();
    window.__pcm = out.getChannelData(0); window.__a = null;
    return window.__pcm.length;
  })()`, 120_000)
  const parts: Buffer[] = []
  const step = 1_000_000
  for (let i = 0; i < len; i += step) {
    const b = await page.eval<string>(`(() => { const f = window.__pcm.subarray(${i}, ${i + step}); const u = new Uint8Array(f.buffer, f.byteOffset, f.byteLength); let s = ''; for (let k = 0; k < u.length; k += 32768) s += String.fromCharCode.apply(null, u.subarray(k, k + 32768)); return btoa(s); })()`)
    parts.push(Buffer.from(b, 'base64'))
  }
  const all = Buffer.concat(parts)
  return new Float32Array(all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength))
}
