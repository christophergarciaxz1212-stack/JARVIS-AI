/**
 * Controle de qualidade automático antes da entrega:
 * frames amostrados (preto/branco), silêncio da narração, duração real vs. planejada.
 * Sem surpresas: o relatório entra no log e no JSON do trabalho.
 */
import type { Page } from '../motion/chrome'

export interface FrameSample { frame: number; luma: number; stdev: number }
export interface QaReport {
  ok: boolean
  issues: string[]
  warnings: string[]
  samples: FrameSample[]
  blackFrames: number[]
  blankFrames: number[]
  durationSec: number
  plannedSec: number
  narrationSilenceRatio: number
  rmsDbfs: number
}

const QA_FRAME_JS = String.raw`
window.__qaSample = function(frame) {
  window.renderFrame(frame);
  var W = WIDTH, H = HEIGHT;
  var cw = 160, ch = Math.max(1, Math.round(160 * H / W));
  var cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
  var ctx = cv.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cw, ch);
  var imgs = Array.from(document.querySelectorAll('.scene'));
  imgs.sort(function (a, b) { return (parseFloat(a.style.zIndex) || 0) - (parseFloat(b.style.zIndex) || 0); });
  var kx = cw / W, ky = ch / H;
  for (var i = 0; i < imgs.length; i++) {
    var el = imgs[i];
    var op = parseFloat(el.style.opacity);
    if (!(op > 0.01)) continue;
    var iw = el.naturalWidth || cw, ih = el.naturalHeight || ch;
    // object-fit: cover
    var scale = Math.max(cw / iw, ch / ih);
    var dw = iw * scale, dh = ih * scale;
    // Replica o transform CSS da cena: scale + translate (em px do palco, já dividido pela escala)
    var tr = el.style.transform || '';
    var ms = /scale\(([\d.]+)\)/.exec(tr);
    var mt = /translate\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px\s*\)/.exec(tr);
    var sc = ms ? parseFloat(ms[1]) : 1;
    var tx = (mt ? parseFloat(mt[1]) : 0) * sc * kx;
    var ty = (mt ? parseFloat(mt[2]) : 0) * sc * ky;
    ctx.globalAlpha = clamp01(op);
    ctx.drawImage(el, (cw - dw * sc) / 2 + tx, (ch - dh * sc) / 2 + ty, dw * sc, dh * sc);
  }
  ctx.globalAlpha = 1;
  var data = ctx.getImageData(0, 0, cw, ch).data;
  var sum = 0, sumSq = 0, n = 0;
  for (var p = 0; p < data.length; p += 4) {
    var l = 0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2];
    sum += l; sumSq += l * l; n++;
  }
  var mean = sum / n;
  return { frame: frame, luma: mean, stdev: Math.sqrt(Math.max(0, sumSq / n - mean * mean)) };
}
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
`

export async function sampleFrames(page: Page, totalFrames: number, samples = 14): Promise<FrameSample[]> {
  await page.eval(QA_FRAME_JS)
  const points = [...new Set(Array.from({ length: samples }, (_, i) => Math.round(((i + 0.5) / samples) * (totalFrames - 1))))]
  const out: FrameSample[] = []
  for (const p of points) {
    const r = await page.eval<FrameSample>(`window.__qaSample(${p})`, 30_000)
    out.push({ frame: p, luma: Number(r.luma) || 0, stdev: Number(r.stdev) || 0 })
  }
  return out
}

export interface AudioAudit { silenceRatio: number; rmsDbfs: number }
export function auditAudio(narration: Float32Array | null): AudioAudit {
  if (!narration || !narration.length) return { silenceRatio: 1, rmsDbfs: -Infinity }
  const SR = 48000
  const win = Math.round(0.05 * SR)
  let silent = 0, total = 0, sum = 0
  for (let i = 0; i + win <= narration.length; i += win) {
    let s = 0
    for (let k = i; k < i + win; k++) s += narration[k] * narration[k]
    const rms = Math.sqrt(s / win)
    sum += s / win
    if (rms < Math.pow(10, -45 / 20)) silent++
    total++
  }
  const rmsAll = total ? Math.sqrt(sum / total) : 0
  return { silenceRatio: total ? silent / total : 1, rmsDbfs: rmsAll > 0 ? 20 * Math.log10(rmsAll) : -Infinity }
}

export function verdict(input: {
  samples: FrameSample[]
  durationSec: number
  plannedSec: number
  narrationPlanned: boolean
  audio: AudioAudit
  failedImages: number
  expectedImages: number
}): QaReport {
  const issues: string[] = []
  const warnings: string[] = []
  const blackFrames = input.samples.filter(s => s.luma < 8).map(s => s.frame)
  const blankFrames = input.samples.filter(s => s.stdev < 3 && s.luma < 45).map(s => s.frame)
  if (blackFrames.length) issues.push(`${blackFrames.length} quadro(s) com tela praticamente preta (${blackFrames.slice(0, 4).join(', ')})`)
  if (blankFrames.length > Math.ceil(input.samples.length / 3)) warnings.push(`${blankFrames.length} quadro(s) com pouquíssimo detalhe visual`)
  if (input.failedImages > 0) warnings.push(`${input.failedImages}/${input.expectedImages} imagem(ns) de cena vieram de reserva`)
  if (input.expectedImages > 0 && input.failedImages >= input.expectedImages) issues.push('Nenhuma imagem de cena foi gerada — o vídeo ficou sem recursos visuais (geração de imagens indisponível?)')
  if (input.narrationPlanned && input.audio.silenceRatio > 0.65) issues.push('A narração está quase toda em silêncio (verifique a síntese de voz)')
  if (Math.abs(input.durationSec - input.plannedSec) > 0.9) warnings.push(`Duração real (${input.durationSec.toFixed(1)}s) difere do planejado (${input.plannedSec.toFixed(1)}s)`)
  if (input.audio.rmsDbfs !== -Infinity && input.audio.rmsDbfs < -38) warnings.push('Áudio muito baixo (abaixo de -38 dBFS)')
  return {
    ok: issues.length === 0,
    issues,
    warnings,
    samples: input.samples,
    blackFrames,
    blankFrames,
    durationSec: input.durationSec,
    plannedSec: input.plannedSec,
    narrationSilenceRatio: input.audio.silenceRatio,
    rmsDbfs: input.audio.rmsDbfs,
  }
}
