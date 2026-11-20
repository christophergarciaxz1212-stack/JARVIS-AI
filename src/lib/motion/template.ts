import type { Brand, Composition } from './types'
import type { WordTime } from './audio'
import { KIT_JS, kitCss } from './kit'

/**
 * Helpers every composition gets. Motion is a pure function of the frame number:
 * no clock, no unseeded randomness, no accumulated state.
 */
export const HELPERS = String.raw`
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, u) => a + (b - a) * u;
const T = n => n / FPS;
const F = s => Math.round(s * FPS);
const seg = (n, a, b) => clamp((n - a) / Math.max(1e-9, b - a));
const easeOutCubic = u => 1 - Math.pow(1 - clamp(u), 3);
const easeInCubic = u => Math.pow(clamp(u), 3);
const easeInOutCubic = u => { u = clamp(u); return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; };
const easeOutExpo = u => { u = clamp(u); return u >= 1 ? 1 : 1 - Math.pow(2, -10 * u); };
const easeOutBack = (u, s = 1.70158) => { u = clamp(u); return 1 + (s + 1) * Math.pow(u - 1, 3) + s * Math.pow(u - 1, 2); };
/* Underdamped analytic spring: 0 -> 1 with overshoot, t in seconds since the event */
const spring = (t, freq = 6, damp = 0.62) => {
  if (t <= 0) return 0;
  const w = freq * Math.PI * 2, z = Math.min(0.99, damp), wd = w * Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + (z * w / wd) * Math.sin(wd * t));
};
/* Deterministic pseudo-random in [0,1) */
const hash = i => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const mixColor = (a, b, u) => {
  const p = c => { c = c.replace('#', ''); if (c.length === 3) c = c.split('').map(x => x + x).join(''); return [0, 2, 4].map(i => parseInt(c.slice(i, i + 2), 16)); };
  const A = p(a), B = p(b); u = clamp(u);
  return 'rgb(' + A.map((v, i) => Math.round(lerp(v, B[i], u))).join(',') + ')';
};
/* Text typed from frame 'start' at 'cps' characters per second */
const typed = (text, n, start, cps = 18) => text.slice(0, Math.max(0, Math.floor((n - start) / FPS * cps)));
/* Number counting from 'from' to 'to' between frames a and b */
const countUp = (n, a, b, from, to, decimals = 0) => (lerp(from, to, easeOutCubic(seg(n, a, b)))).toFixed(decimals);
/* SVG draw-on: stroke-dashoffset for a path of length 'len' drawn between frames a and b */
const dash = (n, a, b, len) => len * (1 - easeInOutCubic(seg(n, a, b)));
/* Narration: WORDS = [{word, text, start, end, index}] in frames. Word being spoken at n (or null). */
const wordIndex = n => { for (let i = WORDS.length - 1; i >= 0; i--) if (n >= WORDS[i].start) return i; return -1; };
const wordAt = n => { const i = wordIndex(n); return i >= 0 ? WORDS[i] : null; };
/* Scene of frame n: {name, start, end, index, local (frames since the scene began), progress 0..1} */
const sceneIndex = n => { for (let i = SCENES.length - 1; i >= 0; i--) if (n >= SCENES[i].start) return i; return 0; };
const sceneAt = n => { const s = SCENES[sceneIndex(n)] || { name: '', start: 0, end: TOTAL, index: 0 }; return Object.assign({}, s, { local: n - s.start, progress: clamp((n - s.start) / Math.max(1, s.end - s.start)) }); };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
`

/**
 * Safety net when the model can't deliver a working scene: kinetic typography synced word by word
 * with the narration (or the scene titles), in the brand colours. Always renders, never blank.
 */
export function fallbackComposition(input: { title: string; scenes: Composition['scenes']; captions: string[]; words: WordTime[]; fps: number; seconds: number }): Composition {
  const json = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c')
  const captions = input.captions.map(c => c.trim()).filter(Boolean).slice(0, 12)
  const phrases: number[] = []
  let count = 0
  for (const w of input.words) {
    if (count === 0) phrases.push(w.start)
    count = count + 1 >= 4 || /[.!?,;:]$/.test(w.word) ? 0 : count + 1
  }
  const sfx = [
    { frame: 0, type: 'impact' as const },
    ...(phrases.length ? phrases : input.scenes.map(s => s.start)).slice(1, 20).map(s => ({ frame: Math.round(s * input.fps), type: 'whoosh' as const, vol: 0.08 })),
    { frame: Math.max(1, Math.round((input.seconds - 1.2) * input.fps)), type: 'shimmer' as const },
  ]
  const js = `
const TITLE = ${json(input.title || '')};
const CAPTIONS = ${json(captions.length ? captions : [input.title || ''])};
const P = (BRAND.colors && BRAND.colors[0]) || '#22d3ee';
const A = (BRAND.colors && BRAND.colors[1]) || '#a78bfa';
stage.innerHTML = '<div class="fb-bg"></div><div class="fb-orb fb-o1"></div><div class="fb-orb fb-o2"></div>' +
  (BRAND.logo ? '<img class="fb-logo" src="' + BRAND.logo + '" alt="">' : '<div class="fb-mark">' + esc((BRAND.name || TITLE).slice(0, 40)) + '</div>') +
  '<div class="fb-line" id="fbl"></div><div class="fb-sub" id="fbs"></div><div class="fb-bar"><i id="fbb"></i></div>';
const line = document.getElementById('fbl'), sub = document.getElementById('fbs'), bar = document.getElementById('fbb');
const o1 = stage.querySelector('.fb-o1'), o2 = stage.querySelector('.fb-o2');
o1.style.background = 'radial-gradient(circle, ' + P + ' 0%, transparent 65%)';
o2.style.background = 'radial-gradient(circle, ' + A + ' 0%, transparent 65%)';
bar.style.background = 'linear-gradient(90deg, ' + P + ', ' + A + ')';
const PH = [];
{ let cur = []; for (const w of WORDS) { cur.push(w); if (cur.length >= 4 || /[.!?,;:]$/.test(w.word)) { PH.push(cur); cur = []; } } if (cur.length) PH.push(cur); }
function renderFrame(n) {
  bar.style.width = (100 * n / Math.max(1, TOTAL - 1)).toFixed(2) + '%';
  o1.style.transform = 'translate(' + (Math.sin(n / 70) * 120).toFixed(1) + 'px,' + (Math.cos(n / 90) * 160).toFixed(1) + 'px)';
  o2.style.transform = 'translate(' + (Math.cos(n / 80) * 140).toFixed(1) + 'px,' + (Math.sin(n / 60) * 120).toFixed(1) + 'px)';
  let words, start;
  if (PH.length) {
    let k = 0; for (let i = PH.length - 1; i >= 0; i--) if (n >= PH[i][0].start) { k = i; break; }
    words = PH[k]; start = words[0].start;
  } else {
    const s = sceneAt(n); words = [{ word: CAPTIONS[s.index % CAPTIONS.length] }]; start = s.start;
  }
  const t = T(n - start);
  const sc = 0.82 + 0.18 * spring(t, 2.6, 0.55);
  line.style.opacity = clamp(t * 7).toFixed(3);
  line.style.transform = 'translate(-50%, -50%) translateY(' + ((1 - easeOutCubic(clamp(t * 3))) * 60).toFixed(1) + 'px) scale(' + sc.toFixed(4) + ')';
  line.innerHTML = words.map(w => '<span' + (w.start !== undefined && n >= w.start ? ' style="color:' + P + '"' : '') + '>' + esc(w.word) + '</span>').join(' ');
  const end = clamp((n - (TOTAL - FPS * 1.6)) / (FPS * 0.6));
  sub.textContent = TITLE;
  sub.style.opacity = (0.55 + 0.45 * end).toFixed(3);
  sub.style.transform = 'translateX(-50%) scale(' + (1 + 0.25 * easeOutBack(end)).toFixed(4) + ')';
}
`
  const css = `
.fb-bg { position:absolute; inset:0; background: linear-gradient(160deg, #070b14 0%, #0b1324 55%, #05070d 100%); }
.fb-orb { position:absolute; width:1100px; height:1100px; border-radius:50%; opacity:.28; filter: blur(40px); }
.fb-o1 { left:-380px; top:120px; } .fb-o2 { right:-420px; bottom:80px; }
.fb-mark, .fb-logo { position:absolute; top:150px; left:50%; transform:translateX(-50%); }
.fb-mark { font-size:44px; font-weight:800; letter-spacing:.32em; text-transform:uppercase; color: rgba(255,255,255,.85); white-space:nowrap; }
.fb-logo { max-width:360px; max-height:140px; }
.fb-line { position:absolute; left:50%; top:50%; width:940px; text-align:center; font-size:112px; line-height:1.08; font-weight:900; letter-spacing:-.02em; color:#fff; text-shadow: 0 10px 40px rgba(0,0,0,.45); white-space: normal; word-break: break-word; }
.fb-sub { position:absolute; left:50%; bottom:300px; width:920px; text-align:center; font-size:46px; font-weight:700; color: rgba(255,255,255,.9); }
.fb-bar { position:absolute; left:90px; right:90px; bottom:170px; height:10px; border-radius:6px; background: rgba(255,255,255,.12); overflow:hidden; }
.fb-bar i { display:block; height:100%; width:0; border-radius:6px; }
`
  return { title: input.title, scenes: input.scenes, css, html: '', js, sfx }
}

/** Guard against code that would make frames non-deterministic or reach outside the page. */
export function staticIssues(source: string): string[] {
  // Comments and strings may mention forbidden APIs ("sem setTimeout") without using them
  const js = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1')
  const rules: Array<[RegExp, string]> = [
    [/\bDate\.now\b|\bnew Date\b|performance\.now/, 'Usa relógio (Date/performance.now): a animação deve depender só de n'],
    [/Math\.random/, 'Usa Math.random: use hash(i) para aleatoriedade determinística'],
    [/requestAnimationFrame|setInterval|setTimeout/, 'Usa temporizadores/rAF: o renderizador chama renderFrame(n) para cada quadro'],
    [/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|import\s*\(|navigator\.sendBeacon|\beval\s*\(|new Function/, 'Acessa rede ou executa código dinâmico: não é permitido'],
    [/localStorage|sessionStorage|indexedDB|document\.cookie/, 'Usa armazenamento do navegador: não é permitido'],
  ]
  const out = rules.filter(([re]) => re.test(js)).map(([, msg]) => msg)
  if (!/function\s+renderFrame\s*\(|renderFrame\s*=/.test(js)) out.push('Falta a função renderFrame(n)')
  return out
}

export function buildPage(c: Composition, opts: { width: number; height: number; fps: number; frames: number; words: WordTime[]; brand?: Brand; fontCss?: string }): string {
  const words = opts.words.map((w, index) => ({ word: w.word, text: w.word, start: Math.round(w.start * opts.fps), end: Math.round(w.end * opts.fps), index }))
  const scenes = (c.scenes || []).map((s, index) => ({ name: s.name, start: Math.round(s.start * opts.fps), end: Math.round(s.end * opts.fps), index }))
  const brand = opts.brand ? { name: opts.brand.name, colors: opts.brand.colors, font: opts.brand.font, logo: opts.brand.logoDataUri || '' } : { name: '', colors: [], font: '', logo: '' }
  const json = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c')
  const page = pageHtml(c, opts, brand, words, scenes, json)
  // Line numbers in error messages are made relative to the model's own js block.
  // Error line numbers count from the start of the script element that threw, so measure inside it
  const scriptStart = page.lastIndexOf('<script>', page.indexOf('/*__JS_START__*/'))
  const offset = page.slice(scriptStart, page.indexOf('/*__JS_START__*/')).split('\n').length
  return page.replace('__JS_LINE__', String(offset))
}

function pageHtml(
  c: Composition, opts: { width: number; height: number; fps: number; frames: number; fontCss?: string },
  brand: { name: string; colors: string[]; font?: string; logo: string },
  words: Array<{ word: string; start: number; end: number }>, scenes: Array<{ name: string; start: number; end: number }>,
  json: (v: unknown) => string,
) {
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; media-src data:">
<style>
${opts.fontCss || ''}
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: ${opts.width}px; height: ${opts.height}px; overflow: hidden; background: #0b0b0f; }
body { font-family: ${brand.font ? `"${brand.font}", ` : ''}"Segoe UI", "Inter", Arial, sans-serif; -webkit-font-smoothing: antialiased; color: #fff; }
#stage { position: absolute; inset: 0; overflow: hidden; }
${c.kit ? kitCss(c.kit) : ''}
${c.css || ''}
</style></head>
<body>
<div id="stage"${c.kit ? ` class="k-${c.kit}"` : ''}>${c.html || ''}</div>
${brand.logo ? `<img src="${brand.logo}" style="position:absolute;width:1px;height:1px;opacity:0" alt="">` : ''}
<script>
// Separate script: still runs when the composition has a syntax error, so the error is reported
window.__errors = [];
window.addEventListener('error', e => window.__errors.push(String(e.message || e) + (e.lineno ? ' (linha ' + Math.max(1, e.lineno - __JS_LINE__) + ' do js)' : '')));
</script>
<script>
"use strict";
const W =${opts.width}, H = ${opts.height}, FPS = ${opts.fps}, TOTAL = ${opts.frames};
const WORDS = ${json(words)};
const SCENES = ${json(scenes)};
const BRAND = ${json(brand)};
const stage = document.getElementById('stage');
${HELPERS}
${c.kit ? `const KIT = ${json(c.kit)};\n${KIT_JS}` : ''}
// The model's code runs in its own scope: redeclaring W, FPS or a helper just shadows it instead of
// being a fatal "already declared" error
(function () {
/*__JS_START__*/
${c.js || ''}
;if (typeof renderFrame === 'function') window.renderFrame = renderFrame;
})();
try { window.renderFrame(0) } catch (e) { window.__errors.push(String(e && e.message || e)) }
</script>
</body></html>`
}

/** Runs inside the page: renders sample frames and reports errors, overflow and determinism problems. */
export const VALIDATE_JS = (samples: number[]) => `(async () => {
  const issues = [];
  const errors = [...(Array.isArray(window.__errors) ? window.__errors : [])];
  if (typeof window.renderFrame !== 'function') return { errors: errors.length ? errors.map(e => 'O script não executou: ' + e) : ['renderFrame não foi definida'], issues };
  const snap = () => document.getElementById('stage').innerHTML.length + ':' + document.getElementById('stage').innerHTML.slice(0, 4000);
  const shots = {};
  for (const n of ${JSON.stringify(samples)}) {
    try { window.renderFrame(n) } catch (e) { errors.push('quadro ' + n + ': ' + (e && e.message || e)); continue }
    shots[n] = snap();
    // Text that leaves the frame horizontally (classic big-slogan bug)
    for (const el of document.querySelectorAll('#stage *')) {
      if (!el.childNodes.length || ![...el.childNodes].some(c => c.nodeType === 3 && c.textContent.trim())) continue;
      const cs = getComputedStyle(el);
      if (cs.opacity === '0' || cs.visibility === 'hidden' || cs.display === 'none') continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && (r.left < -8 || r.right > W + 8) && r.width > W * 0.5) issues.push('quadro ' + n + ': o texto "' + el.textContent.trim().slice(0, 40) + '" passa da largura do vídeo (' + Math.round(r.width) + 'px)');
    }
  }
  // The story must move: different scenes show different text, and the frame is used top to bottom
  const texts = {}, bottoms = {};
  for (const n of ${JSON.stringify(samples)}) {
    try { window.renderFrame(n) } catch { continue }
    let txt = '', low = 0;
    for (const el of document.querySelectorAll('#stage *')) {
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) < 0.2) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4 || (r.width >= W * 0.95 && r.height >= H * 0.95)) continue;
      if (r.bottom > 0 && r.top < H) low = Math.max(low, Math.min(H, r.bottom));
      for (const c of el.childNodes) if (c.nodeType === 3) txt += c.textContent.trim() + ' ';
    }
    texts[n] = txt.trim(); bottoms[n] = low;
  }
  // Something must be visible: legible text (chars x font size) or real graphics, in most sampled frames
  const weights = {};
  for (const n of ${JSON.stringify(samples)}) {
    try { window.renderFrame(n) } catch { continue }
    let w = 0;
    for (const el of document.querySelectorAll('#stage *')) {
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) < 0.2) continue;
      let op = 1; for (let p = el; p && p.id !== 'stage'; p = p.parentElement) op *= parseFloat(getComputedStyle(p).opacity);
      if (op < 0.2) continue;
      const r = el.getBoundingClientRect();
      if (r.right < 0 || r.left > W || r.bottom < 0 || r.top > H || r.width < 2 || r.height < 2) continue;
      if (/^(IMG|SVG|CANVAS|VIDEO)$/i.test(el.tagName) && r.width * r.height >= W * H * 0.02) w += 2000;
      let chars = 0; for (const c of el.childNodes) if (c.nodeType === 3) chars += c.textContent.trim().length;
      if (chars) w += chars * parseFloat(cs.fontSize || '0');
    }
    weights[n] = w;
  }
  const ws = Object.entries(weights);
  // Calibrated so fades, scene cuts and one short word don't count: only near-blank frames do
  const empty = ws.filter(([, w]) => w < 300);
  if (ws.length && empty.length >= Math.ceil(ws.length * 0.7)) issues.push('Quadros quase vazios: ' + empty.length + ' de ' + ws.length + ' amostras não mostram texto legível nem elementos visíveis (ex.: quadro ' + empty[0][0] + '). Cada cena precisa de conteúdo grande e visível: título de 72 a 120px no centro do quadro, elementos acima e abaixo, sempre dentro da tela e com opacidade alta.');
  const distinct = new Set(Object.values(texts).filter(Boolean));
  if (SCENES.length >= 3 && distinct.size <= 1) issues.push('As cenas não mudam: o mesmo texto aparece do começo ao fim. Cada cena de SCENES precisa mostrar o seu próprio conteúdo (troque título, cards, números, frases) e terminar com a frase/CTA final.');
  // Texto em cima de texto (título escondido atrás de um card/badge) e o meio do quadro vazio
  const overlaps = [], emptyMid = [];
  for (const n of ${JSON.stringify(samples)}) {
    try { window.renderFrame(n) } catch { continue }
    const boxes = [];
    let mid = false;
    for (const el of document.querySelectorAll('#stage *')) {
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      let op = 1; for (let p = el; p && p.id !== 'stage'; p = p.parentElement) op *= parseFloat(getComputedStyle(p).opacity);
      if (op < 0.5) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4 || (r.width >= W * 0.95 && r.height >= H * 0.95)) continue;
      if (r.bottom > H * 0.42 && r.top < H * 0.74 && r.width * r.height > 2500) mid = true;
      const own = [...el.childNodes].filter(c => c.nodeType === 3).map(c => c.textContent.trim()).join(' ').trim();
      if (own.length >= 3 && parseFloat(cs.fontSize) >= 40) boxes.push({ el, r, t: own });
    }
    if (!mid) emptyMid.push(n);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const ix = Math.max(0, Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left));
      const iy = Math.max(0, Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top));
      const small = Math.min(a.r.width * a.r.height, b.r.width * b.r.height);
      if (small > 0 && ix * iy > small * 0.25) overlaps.push('quadro ' + n + ': "' + a.t.slice(0, 30) + '" e "' + b.t.slice(0, 30) + '"');
    }
  }
  // Também vale para texto grande coberto por um card/badge (elemento opaco por cima)
  for (const n of ${JSON.stringify(samples)}) {
    try { window.renderFrame(n) } catch { continue }
    for (const el of document.querySelectorAll('#stage *')) {
      const own = [...el.childNodes].filter(c => c.nodeType === 3).map(c => c.textContent.trim()).join(' ').trim();
      if (own.length < 3 || parseFloat(getComputedStyle(el).fontSize) < 56) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4) continue;
      const pts = [[r.right - 12, r.top + r.height / 2], [r.left + r.width * 0.75, r.top + r.height / 2]];
      for (const [x, y] of pts) {
        if (x < 0 || y < 0 || x > W || y > H) continue;
        const top = document.elementFromPoint(x, y);
        if (top && top !== el && !el.contains(top) && !top.contains(el) && top.id !== 'stage' && !top.closest('.k-bg')) { overlaps.push('quadro ' + n + ': o texto "' + own.slice(0, 30) + '" fica escondido atrás de outro elemento'); break; }
      }
    }
  }
  if (overlaps.length) issues.push('Texto sobreposto/escondido: ' + [...new Set(overlaps)].slice(0, 3).join(' · ') + '. Separe as faixas: nenhum título grande pode dividir a mesma faixa vertical com card, badge ou outro texto; reduza a fonte ou mude o y.');
  if (emptyMid.length >= Math.ceil(${JSON.stringify(samples)}.length * 0.5)) issues.push('O meio do quadro (y 800–1420) fica vazio em ' + emptyMid.length + ' amostras: coloque o visual da cena (terminal, diagrama, cards, gráfico) nessa faixa.');
  const lows = Object.values(bottoms);
  if (lows.length && lows.filter(b => b < H * 0.58).length >= Math.ceil(lows.length * 0.7)) issues.push('A metade de baixo do vídeo fica vazia na maior parte do tempo: distribua a composição pela altura toda (1920 px) — texto principal no centro, elementos acima e abaixo.');
  // Same frame twice must give the same DOM (pure function of n)
  const probe = ${JSON.stringify(samples)}.filter(n => shots[n])[1];
  if (probe !== undefined) { try { window.renderFrame(probe); if (snap() !== shots[probe]) issues.push('o quadro ' + probe + ' muda quando renderizado de novo: a cena guarda estado entre quadros'); } catch {} }
  return { errors: errors.concat((window.__errors || []).filter(e => !errors.includes(e))).slice(0, 12), issues: [...new Set(issues)].slice(0, 12) };
})()`
