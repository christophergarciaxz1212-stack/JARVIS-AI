import { spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

export const SR = 48000

// ─── Sound effects tied to frame numbers (synthesised, no samples, no Python) ─

export type SfxType = 'pop' | 'tick' | 'whoosh' | 'shimmer' | 'impact' | 'rise'
export interface SfxEvent { frame: number; type: SfxType; vol?: number }
export interface PadSpec { freqs: number[]; start: number; end: number; vol?: number }

export class Track {
  readonly buf: Float32Array
  // Nenhum efeito usa ruído branco (era a origem do chiado): o seed fica só pela compatibilidade da assinatura
  constructor(readonly seconds: number, readonly fps: number, readonly seed = 7) {
    this.buf = new Float32Array(Math.ceil(seconds * SR))
  }

  private place(frame: number, sig: Float32Array) {
    const i = Math.round((frame / this.fps) * SR)
    for (let k = 0; k < sig.length && i + k < this.buf.length; k++) if (i + k >= 0) this.buf[i + k] += sig[k]
  }

  /** Elastic click whose pitch drops fast: buttons, cards, big words. */
  pop(frame: number, vol = 0.22) {
    const n = Math.round(0.09 * SR)
    const sig = new Float32Array(n)
    let phase = 0
    for (let k = 0; k < n; k++) {
      const t = k / SR
      const f = 210 + (640 - 210) * Math.exp(-t * 46)
      phase += (2 * Math.PI * f) / SR
      sig[k] = Math.sin(phase) * Math.exp(-t / 0.02) * vol
    }
    this.place(frame, sig)
  }

  /** Short dry tick: typing, counters, bars. */
  tick(frame: number, vol = 0.06, freq = 2200) {
    const n = Math.round(0.022 * SR)
    const sig = new Float32Array(n)
    for (let k = 0; k < n; k++) sig[k] = Math.sin((2 * Math.PI * freq * k) / SR) * Math.exp(-k / SR / 0.005) * vol
    this.place(frame, sig)
  }

  /**
   * Transition swoosh: a soft tonal sweep (three detuned sines gliding up and back down).
   * It used to be filtered white noise, which came out as audible hiss ("xiado") on every scene change.
   */
  whoosh(frame: number, vol = 0.11, dur = 0.36) {
    const n = Math.round(dur * SR)
    const sig = new Float32Array(n)
    const phases = [0, 0, 0]
    const ratios = [1, 1.5, 2.01]
    for (let k = 0; k < n; k++) {
      const u = k / n
      const f = 170 + 520 * Math.sin(Math.PI * u)
      let s = 0
      for (let j = 0; j < 3; j++) { phases[j] += (2 * Math.PI * f * ratios[j]) / SR; s += Math.sin(phases[j]) / (j + 1) }
      sig[k] = (s / 1.83) * Math.pow(Math.sin(Math.PI * u), 2) * vol * 0.9
    }
    this.place(frame, sig)
  }

  /** Bright confirmation: high sines with a long tail. */
  shimmer(frame: number, vol = 0.05) {
    const n = Math.round(0.5 * SR)
    const sig = new Float32Array(n)
    for (let k = 0; k < n; k++) {
      const t = k / SR
      sig[k] = ((Math.sin(2 * Math.PI * 1568 * t) + Math.sin(2 * Math.PI * 2093 * t)) / 2) * Math.exp(-t / 0.16) * vol
    }
    this.place(frame, sig)
  }

  /** Low thump: logo hits, heavy words landing. */
  impact(frame: number, vol = 0.3) {
    const n = Math.round(0.35 * SR)
    const sig = new Float32Array(n)
    let phase = 0
    for (let k = 0; k < n; k++) {
      const t = k / SR
      phase += (2 * Math.PI * (48 + 90 * Math.exp(-t * 18))) / SR
      // Only the low thump; the old noise transient added a burst of hiss on every impact
      sig[k] = Math.sin(phase) * Math.exp(-t / 0.12) * vol
    }
    this.place(frame, sig)
  }

  /** Rising tension before a reveal: tonal upward glide (no noise, so no hiss). */
  rise(frame: number, vol = 0.07, dur = 0.8) {
    const n = Math.round(dur * SR)
    const sig = new Float32Array(n)
    let p1 = 0, p2 = 0
    for (let k = 0; k < n; k++) {
      const u = k / n
      const f = 220 * Math.pow(4, u)
      p1 += (2 * Math.PI * f) / SR
      p2 += (2 * Math.PI * f * 1.5) / SR
      sig[k] = (Math.sin(p1) + 0.4 * Math.sin(p2)) * u * u * (1 - Math.pow(u, 12)) * vol * 1.6
    }
    // Ends on the event frame
    this.place(frame - Math.round(dur * this.fps), sig)
  }

  /** Discreet harmonic bed with fade in/out. */
  pad(freqs: number[], startS: number, endS: number, vol = 0.045) {
    const n = Math.max(0, Math.round((endS - startS) * SR))
    const dur = n / SR
    const i0 = Math.round(startS * SR)
    for (let k = 0; k < n && i0 + k < this.buf.length; k++) {
      const t = k / SR
      const env = Math.pow(Math.max(0, Math.min(1, t / 1.4, (dur - t) / 1.6)), 1.5)
      let s = 0
      for (const f of freqs) s += Math.sin(2 * Math.PI * f * t) + 0.22 * Math.sin(4 * Math.PI * f * t) + 0.08 * Math.sin(6 * Math.PI * f * t)
      this.buf[i0 + k] += (s / freqs.length) * env * vol
    }
  }

  add(e: SfxEvent) {
    const v = typeof e.vol === 'number' && e.vol > 0 && e.vol <= 1 ? e.vol : undefined
    switch (e.type) {
      case 'pop': return this.pop(e.frame, v)
      case 'tick': return this.tick(e.frame, v)
      case 'whoosh': return this.whoosh(e.frame, v)
      case 'shimmer': return this.shimmer(e.frame, v)
      case 'impact': return this.impact(e.frame, v)
      case 'rise': return this.rise(e.frame, v)
    }
  }
}

/** Voice on top, effects under it, soft-clipped and normalised. */
export function mix(seconds: number, layers: Array<{ pcm: Float32Array; gain: number; offsetS?: number }>): Float32Array {
  const out = new Float32Array(Math.ceil(seconds * SR))
  for (const l of layers) {
    const off = Math.round((l.offsetS || 0) * SR)
    for (let k = 0; k < l.pcm.length && k + off < out.length; k++) if (k + off >= 0) out[k + off] += l.pcm[k] * l.gain
  }
  let peak = 1e-9
  for (let k = 0; k < out.length; k++) { out[k] = Math.tanh(out[k] * 1.1); peak = Math.max(peak, Math.abs(out[k])) }
  const g = peak > 0.89 ? 0.89 / peak : 1
  if (g !== 1) for (let k = 0; k < out.length; k++) out[k] *= g
  return out
}

// ─── WAV ─────────────────────────────────────────────────────────────────────

export function writeWav(file: string, pcm: Float32Array) {
  const data = Buffer.alloc(pcm.length * 2)
  for (let k = 0; k < pcm.length; k++) data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(pcm[k] * 32767))), k * 2)
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8)
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22)
  h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34)
  h.write('data', 36); h.writeUInt32LE(data.length, 40)
  fs.writeFileSync(file, Buffer.concat([h, data]))
}

/** Reads 16-bit PCM WAV (any rate/channels) as mono 48 kHz. */
export function readWav(file: string): Float32Array {
  const b = fs.readFileSync(file)
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error('WAV inválido')
  let off = 12
  let channels = 1, rate = SR, bits = 16, data: Buffer | null = null
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4)
    const size = b.readUInt32LE(off + 4)
    if (id === 'fmt ') { channels = b.readUInt16LE(off + 10); rate = b.readUInt32LE(off + 12); bits = b.readUInt16LE(off + 22) }
    if (id === 'data') { data = b.subarray(off + 8, off + 8 + size); break }
    off += 8 + size + (size % 2)
  }
  if (!data || bits !== 16) throw new Error('Use WAV PCM 16 bits')
  const frames = Math.floor(data.length / (2 * channels))
  const mono = new Float32Array(frames)
  for (let i = 0; i < frames; i++) {
    let s = 0
    for (let c = 0; c < channels; c++) s += data.readInt16LE((i * channels + c) * 2)
    mono[i] = s / channels / 32768
  }
  return resample(mono, rate)
}

export function resample(pcm: Float32Array, rate: number): Float32Array {
  if (rate === SR) return pcm
  const n = Math.round((pcm.length * SR) / rate)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = (i * rate) / SR
    const a = Math.floor(x)
    const f = x - a
    out[i] = (pcm[a] || 0) * (1 - f) + (pcm[a + 1] || 0) * f
  }
  return out
}

// ─── Narration timing ────────────────────────────────────────────────────────

export interface WordTime { word: string; start: number; end: number }

/**
 * Speech segments in a recording (energy + hangover). Used to time the user's own narration
 * without speech recognition: script sentences are spread over the detected speech.
 */
export function speechSegments(pcm: Float32Array, minSilence = 0.28): Array<{ start: number; end: number }> {
  const win = Math.round(0.02 * SR)
  const rms: number[] = []
  for (let i = 0; i + win <= pcm.length; i += win) {
    let s = 0
    for (let k = i; k < i + win; k++) s += pcm[k] * pcm[k]
    rms.push(Math.sqrt(s / win))
  }
  const sorted = [...rms].sort((a, b) => a - b)
  const floor = sorted[Math.floor(sorted.length * 0.1)] || 0
  const loud = sorted[Math.floor(sorted.length * 0.9)] || 0
  const thr = Math.max(0.01, floor + (loud - floor) * 0.12)
  const segs: Array<{ start: number; end: number }> = []
  let start = -1, quiet = 0
  const hang = Math.round(minSilence / 0.02)
  rms.forEach((v, i) => {
    if (v >= thr) { if (start < 0) start = i; quiet = 0 }
    else if (start >= 0 && ++quiet > hang) { segs.push({ start: start * 0.02, end: (i - quiet + 1) * 0.02 }); start = -1; quiet = 0 }
  })
  if (start >= 0) segs.push({ start: start * 0.02, end: rms.length * 0.02 })
  return segs.filter(s => s.end - s.start > 0.12)
}

/** Distributes the script's words over the speech segments, proportionally to word length. */
export function alignScript(script: string, segs: Array<{ start: number; end: number }>): WordTime[] {
  const words = script.split(/\s+/).filter(Boolean)
  if (!words.length || !segs.length) return []
  const total = segs.reduce((s, x) => s + (x.end - x.start), 0)
  const weights = words.map(w => w.length + 2)
  const sum = weights.reduce((a, b) => a + b, 0)
  // Speech time -> wall time across segments
  const at = (speech: number) => {
    let left = speech
    for (const s of segs) {
      const d = s.end - s.start
      if (left <= d) return s.start + left
      left -= d
    }
    return segs[segs.length - 1].end
  }
  let acc = 0
  return words.map((w, i) => {
    const a = (acc / sum) * total
    acc += weights[i]
    const b = (acc / sum) * total
    return { word: w, start: at(a), end: at(b) }
  })
}

/**
 * Narration with the Windows voice (offline, System.Speech), with real per-word timings.
 * Only used when the user picks "voz do JARVIS"; their own recording is never replaced.
 */
export async function synthesize(text: string, outWav: string, opts: { voice?: string; rate?: number } = {}): Promise<WordTime[]> {
  // Work in %TEMP%: Windows' controlled folder access may stop PowerShell from writing into Documents
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-tts-'))
  const textFile = path.join(dir, 'narracao.txt')
  const script = path.join(dir, 'tts.ps1')
  const tmpWav = path.join(dir, 'narracao.wav')
  fs.writeFileSync(textFile, text, 'utf-8')
  fs.writeFileSync(script, TTS_PS1, 'utf-8')
  // No fake fallback here: a failure must surface (the caller tries another voice or skips narration),
  // never turn into synthetic tones that would ship inside the video as if they were speech.
  try {
    const marks = await runTts(script, textFile, tmpWav, opts)
    fs.mkdirSync(path.dirname(outWav), { recursive: true })
    fs.copyFileSync(tmpWav, outWav)
    fs.writeFileSync(path.join(path.dirname(outWav), 'narracao.txt'), text, 'utf-8')
    return marks
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

async function runTts(script: string, textFile: string, outWav: string, opts: { voice?: string; rate?: number }): Promise<WordTime[]> {
  const out = await new Promise<string>((resolve, reject) => {
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, textFile, outWav, opts.voice || '', String(opts.rate ?? 1)], { windowsHide: true })
    let so = '', se = ''
    p.stdout.on('data', d => { so += d.toString('utf8') })
    p.stderr.on('data', d => { se += d.toString('utf8') })
    const timer = setTimeout(() => { p.kill(); reject(new Error('A voz demorou demais')) }, 120_000)
    p.on('exit', code => { clearTimeout(timer); code === 0 ? resolve(so) : reject(new Error(`Falha na voz do Windows: ${se.slice(0, 300)}`)) })
  })
  const marks = out.split(/\r?\n/).map(l => l.split('\t')).filter(p => p.length >= 4).map(p => ({ ms: Number(p[0]), word: p.slice(3).join(' ').trim() })).filter(m => m.word && !isNaN(m.ms))
  const dur = readWav(outWav).length / SR
  return marks.map((m, i) => ({ word: m.word, start: m.ms / 1000, end: i + 1 < marks.length ? marks[i + 1].ms / 1000 : dur }))
}

const TTS_PS1 = `param([string]$TextFile, [string]$OutWav, [string]$Voice, [int]$Rate)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$code = @"
using System; using System.Collections.Generic; using System.Globalization; using System.Speech.Synthesis; using System.Speech.AudioFormat;
public static class JarvisTts {
  public static string Run(string text, string wav, string voice, int rate) {
    var marks = new List<string>();
    using (var s = new SpeechSynthesizer()) {
      bool chosen = false;
      if (!string.IsNullOrEmpty(voice)) { try { s.SelectVoice(voice); chosen = true; } catch {} }
      if (!chosen) { try { s.SelectVoiceByHints(VoiceGender.NotSet, VoiceAge.NotSet, 0, new CultureInfo("pt-BR")); } catch {} }
      s.Rate = Math.Max(-10, Math.Min(10, rate));
      s.SetOutputToWaveFile(wav, new SpeechAudioFormatInfo(48000, AudioBitsPerSample.Sixteen, AudioChannel.Mono));
      s.SpeakProgress += (o, e) => marks.Add(e.AudioPosition.TotalMilliseconds.ToString(CultureInfo.InvariantCulture) + "\\t" + e.CharacterPosition + "\\t" + e.CharacterCount + "\\t" + e.Text.Replace("\\t", " ").Replace("\\r", " ").Replace("\\n", " "));
      s.Speak(text);
      s.SetOutputToNull();
    }
    return string.Join("\\n", marks);
  }
}
"@
Add-Type -TypeDefinition $code -ReferencedAssemblies System.Speech
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[JarvisTts]::Run([System.IO.File]::ReadAllText($TextFile, [System.Text.Encoding]::UTF8), $OutWav, $Voice, $Rate)
`
