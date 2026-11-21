/**
 * Página de composição do vídeo: o renderizador abre esta página num Chrome
 * sem rede e chama `window.renderFrame(n)` quadro a quadro.
 *
 * Cada quadro é função pura do número do quadro — nada depende de relógio ou
 * de animação CSS rodando sozinha. É isso que torna o vídeo reproduzível e a
 * renderização exata (o quadro 1800 sai igual em qualquer máquina).
 *
 * O que cada cena tem:
 *  - fundo: a própria imagem ampliada, desfocada e escurecida — preenche a tela
 *    mesmo quando a imagem não tem a proporção do vídeo (uma imagem 16:9 num
 *    vídeo 9:16 não vira tarja preta);
 *  - primeiro plano: a imagem com movimento de câmera (zoom, pan, parallax), e o
 *    fundo andando mais devagar e em sentido oposto — profundidade;
 *  - luz: vinheta, granulação de filme e um feixe de luz que cruza a cena;
 *  - texto animado palavra por palavra, legenda karaokê, título e cartão final.
 *
 * Dados vão como JSON num <script>; nada do texto do usuário vira HTML cru.
 */
import type { Camera, ProductionPlan, SceneTiming, Transition } from './types'
import { legiblePalette } from './plan'
import type { WordTime } from './timeline'

export interface CompositionScene {
  image: string
  camera: Camera
  transition: Transition
  onScreen?: string
  /** A imagem não tem a proporção do vídeo: o primeiro plano encaixa em vez de cortar. */
  fit: 'cover' | 'contain'
}

export interface CompositionInput {
  width: number
  height: number
  fps: number
  duration: number
  plan: Pick<ProductionPlan, 'title' | 'palette' | 'font' | 'cta'>
  scenes: CompositionScene[]
  timings: SceneTiming[]
  /** Legendas: grupos de palavras com tempo absoluto. Vazio = sem legenda. */
  cues: Array<{ start: number; end: number; words: WordTime[] }>
  endCardFrom?: number
  /** Pedido em preto e branco: aplica a gradação monocromática nas imagens. */
  monochrome?: boolean
}

/** Duração das transições entre cenas, em segundos. */
export const TRANSITION_SECONDS = 0.7

const FONTS: Record<CompositionInput['plan']['font'], string> = {
  // Só fontes do sistema: a página roda com a rede bloqueada
  display: '"Segoe UI Black", "Arial Black", "Segoe UI", Arial, sans-serif',
  sans: '"Segoe UI", "Helvetica Neue", Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'Consolas, "Cascadia Mono", "Courier New", monospace',
}

/** JSON seguro dentro de <script>: um "</script>" no texto não fecha a tag. */
function safeJson(v: unknown): string {
  return JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
}

export function buildComposition(input: CompositionInput): string {
  // Contraste calculado, não confiado à IA (ver legiblePalette)
  const { bg, accent, text, onAccent } = legiblePalette(input.plan.palette)
  const data = {
    W: input.width,
    H: input.height,
    fps: input.fps,
    duration: input.duration,
    trans: TRANSITION_SECONDS,
    title: input.plan.title,
    cta: input.plan.cta || '',
    accent,
    text,
    scenes: input.scenes.map(s => ({ camera: s.camera, transition: s.transition, onScreen: s.onScreen || '', fit: s.fit })),
    timings: input.timings,
    cues: input.cues.map(c => ({ start: c.start, end: c.end, words: c.words.map(w => ({ w: w.word, s: w.start, e: w.end })) })),
    endCardFrom: input.endCardFrom ?? null,
    mono: !!input.monochrome,
  }
  const imagens = input.scenes.map((s, i) => `<img id="src${i}" src="${s.image}" alt="">`).join('')

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${input.width}px;height:${input.height}px;overflow:hidden;background:${bg}}
  body{font-family:${FONTS[input.plan.font]};color:${text};-webkit-font-smoothing:antialiased}
  #fontes{display:none}
  .cena{position:absolute;inset:0;overflow:hidden;display:none;will-change:transform,opacity,filter}
  .fundo,.frente{position:absolute;left:50%;top:50%;transform-origin:50% 50%}
  .fundo{filter:blur(${Math.round(input.width / 50)}px) brightness(.5) saturate(1.1)}
  .vinheta{position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse at 50% 45%,rgba(0,0,0,0) 45%,rgba(0,0,0,.55) 100%)}
  .feixe{position:absolute;inset:-20%;pointer-events:none;mix-blend-mode:screen;background:linear-gradient(105deg,rgba(255,255,255,0) 40%,rgba(255,255,255,.10) 50%,rgba(255,255,255,0) 60%)}
  #grao{position:absolute;inset:-64px;pointer-events:none;opacity:.07;mix-blend-mode:overlay;z-index:40}
  #texto{position:absolute;left:8%;right:8%;z-index:20;text-align:center}
  #texto .p{display:inline-block;margin:0 .14em;font-weight:800;text-shadow:0 .05em .25em rgba(0,0,0,.85),0 0 .9em rgba(0,0,0,.55)}
  #barra{height:.12em;background:${accent};margin:.35em auto 0;border-radius:2px}
  #titulo{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:30;text-align:center;padding:0 8%;background:radial-gradient(ellipse at 50% 50%,rgba(0,0,0,.55) 0%,rgba(0,0,0,.25) 45%,rgba(0,0,0,0) 75%)}
  #titulo h1{font-weight:900;line-height:1.02;text-shadow:0 .05em .35em rgba(0,0,0,.65)}
  #titulo .linha{height:.09em;background:${accent};margin-top:.4em}
  #legenda{position:absolute;left:6%;right:6%;z-index:25;text-align:center}
  #legenda span{display:inline-block;padding:.12em .36em;margin:.08em .04em;border-radius:.28em;font-weight:800;background:rgba(0,0,0,.55);text-shadow:0 .04em .18em rgba(0,0,0,.6)}
  #legenda span.atual{background:${accent};color:${onAccent}}
  #final{position:absolute;inset:0;z-index:35;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 10%;opacity:0}
  #final .t{opacity:.75;font-weight:600;letter-spacing:.08em;text-transform:uppercase}
  #final .cta{font-weight:900;line-height:1.05;margin-top:.25em}
  #final .linha{height:.09em;background:${accent};margin-top:.5em}
</style></head>
<body>
<div id="fontes">${imagens}</div>
<div id="palco"></div>
<canvas id="grao"></canvas>
<div id="texto"></div>
<div id="titulo"><h1></h1><div class="linha"></div></div>
<div id="legenda"></div>
<div id="final"><div class="t"></div><div class="cta"></div><div class="linha"></div></div>
<script>
const D = ${safeJson(data)};
const W = D.W, H = D.H, U = Math.min(W, H) / 100;
const palco = document.getElementById('palco');
const ease = t => t <= 0 ? 0 : t >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * t);
const easeOut = t => t <= 0 ? 0 : t >= 1 ? 1 : 1 - Math.pow(1 - t, 3);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Cada cena: fundo desfocado + primeiro plano + luz
const cenas = D.scenes.map((s, i) => {
  const el = document.createElement('div'); el.className = 'cena';
  const src = document.getElementById('src' + i);
  const fundo = new Image(); fundo.className = 'fundo'; fundo.src = src.src;
  const frente = new Image(); frente.className = 'frente'; frente.src = src.src;
  const vin = document.createElement('div'); vin.className = 'vinheta';
  const feixe = document.createElement('div'); feixe.className = 'feixe';
  el.append(fundo, frente, vin, feixe); palco.append(el);
  // O filtro inline substitui o da folha de estilo: no fundo, repete o desfoque
  if (D.mono) { frente.style.filter = 'grayscale(1) contrast(1.12)'; fundo.style.filter = 'blur(' + Math.round(W / 50) + 'px) brightness(.5) grayscale(1)'; }
  else frente.style.filter = 'contrast(1.06) saturate(1.06)';
  return { el, fundo, frente, feixe, src, s, i };
});

// Tamanho de cada camada a partir das dimensões reais da imagem
function dimensiona(c) {
  const iw = c.src.naturalWidth || W, ih = c.src.naturalHeight || H;
  const cobrir = Math.max(W / iw, H / ih), caber = Math.min(W / iw, H / ih);
  const k = c.s.fit === 'contain' ? caber : cobrir;
  c.fw = iw * k; c.fh = ih * k;
  c.bw = iw * cobrir * 1.18; c.bh = ih * cobrir * 1.18;
  c.frente.style.width = c.fw + 'px'; c.frente.style.height = c.fh + 'px';
  c.fundo.style.width = c.bw + 'px'; c.fundo.style.height = c.bh + 'px';
}

// Granulação: ruído gerado uma vez, deslocado por quadro (barato e determinístico)
const grao = document.getElementById('grao');
grao.width = W + 128; grao.height = H + 128;
(function () {
  const g = grao.getContext('2d'), tile = 256, t = g.createImageData(tile, tile);
  let x = 1234567;
  for (let k = 0; k < t.data.length; k += 4) { x = (x * 1103515245 + 12345) & 0x7fffffff; const v = x & 255; t.data[k] = t.data[k+1] = t.data[k+2] = v; t.data[k+3] = 255; }
  const c = document.createElement('canvas'); c.width = c.height = tile; c.getContext('2d').putImageData(t, 0, 0);
  g.fillStyle = g.createPattern(c, 'repeat'); g.fillRect(0, 0, grao.width, grao.height);
})();

// Movimento de câmera: escala e deslocamento (em fração da tela) ao longo da cena
function camera(tipo, u) {
  const p = ease(u);
  switch (tipo) {
    case 'zoom-in': return { s: 1.0 + 0.16 * p, x: 0, y: 0, bx: 0, by: 0 };
    case 'zoom-out': return { s: 1.16 - 0.16 * p, x: 0, y: 0, bx: 0, by: 0 };
    case 'pan-left': return { s: 1.14, x: 0.045 - 0.09 * p, y: 0, bx: -0.02 + 0.04 * p, by: 0 };
    case 'pan-right': return { s: 1.14, x: -0.045 + 0.09 * p, y: 0, bx: 0.02 - 0.04 * p, by: 0 };
    case 'pan-up': return { s: 1.14, x: 0, y: 0.04 - 0.08 * p, bx: 0, by: -0.02 + 0.04 * p };
    case 'pan-down': return { s: 1.14, x: 0, y: -0.04 + 0.08 * p, bx: 0, by: 0.02 - 0.04 * p };
    // Parallax: frente e fundo andam em sentidos opostos e velocidades diferentes
    case 'parallax': return { s: 1.08 + 0.08 * p, x: 0.03 - 0.06 * p, y: 0.008 - 0.016 * p, bx: -0.05 + 0.1 * p, by: 0 };
    default: return { s: 1.02 + 0.03 * p, x: 0, y: 0, bx: 0, by: 0 };
  }
}

function posiciona(c, t) {
  const tm = D.timings[c.i];
  // O movimento cobre a cena inteira mais a transição de entrada: não "trava" no corte
  const ini = tm.start - (c.i ? D.trans : 0), u = clamp((t - ini) / Math.max(0.1, tm.end - ini), 0, 1);
  const k = camera(c.s.camera, u);
  c.frente.style.transform = 'translate(-50%,-50%) translate(' + (k.x * W) + 'px,' + (k.y * H) + 'px) scale(' + k.s + ')';
  c.fundo.style.transform = 'translate(-50%,-50%) translate(' + (k.bx * W) + 'px,' + (k.by * H) + 'px) scale(' + (1 + 0.05 * ease(u)) + ')';
  // Feixe de luz cruza a cena uma vez, devagar
  const f = clamp((t - tm.start) / Math.max(1, tm.end - tm.start), 0, 1);
  c.feixe.style.transform = 'translateX(' + ((-1 + 2.2 * f) * W) + 'px)';
}

// Transição de entrada: devolve estilos da cena que entra e da que sai
function transicao(tipo, p) {
  const e = easeOut(p);
  switch (tipo) {
    case 'cut': return { entra: { o: 1 }, sai: { o: p > 0 ? 0 : 1 } };
    case 'zoom': return { entra: { o: e, s: 1.22 - 0.22 * e }, sai: { o: 1 - e * 0.6, s: 1 + 0.12 * e } };
    case 'slide': return { entra: { o: 1, x: (1 - e) * W }, sai: { o: 1, x: -0.32 * e * W } };
    case 'blur': return { entra: { o: e, b: 16 * (1 - e) }, sai: { o: 1 - e, b: 16 * e } };
    default: return { entra: { o: e }, sai: { o: 1 } };
  }
}

function aplica(el, st) {
  el.style.opacity = st.o == null ? 1 : st.o;
  const tr = [];
  if (st.x) tr.push('translateX(' + st.x + 'px)');
  if (st.s) tr.push('scale(' + st.s + ')');
  el.style.transform = tr.join(' ');
  el.style.filter = st.b ? 'blur(' + st.b + 'px)' : '';
}

// Texto da cena, palavra por palavra
const texto = document.getElementById('texto');
const temLegenda = D.cues.length > 0;
texto.style.fontSize = (W > H ? 6.2 : 7.6) * U + 'px';
// Com legenda embaixo, o destaque sobe para o terço de cima
texto.style.top = temLegenda ? (W > H ? '12%' : '14%') : '40%';
let textoCena = -1;
function textoDa(i) {
  if (textoCena === i) return;
  textoCena = i; texto.innerHTML = '';
  const frase = D.scenes[i] ? D.scenes[i].onScreen : '';
  if (!frase) return;
  for (const w of frase.split(/\\s+/)) { const s = document.createElement('span'); s.className = 'p'; s.textContent = w; texto.append(s); }
  const b = document.createElement('div'); b.id = 'barra'; texto.append(b);
}
function animaTexto(i, t) {
  const tm = D.timings[i];
  // Na primeira cena o título ocupa o começo: o destaque entra depois dele
  const ini = tm.start + (i === 0 ? 2.6 : 0.35), fim = tm.end - 0.35;
  const ps = texto.querySelectorAll('.p');
  ps.forEach((s, k) => {
    const u = clamp((t - ini - k * 0.08) / 0.38, 0, 1), e = easeOut(u);
    const saida = clamp((t - fim) / 0.3, 0, 1);
    s.style.opacity = e * (1 - saida);
    s.style.transform = 'translateY(' + ((1 - e) * 0.5) + 'em)';
  });
  const b = document.getElementById('barra');
  if (b) { const u = clamp((t - ini - ps.length * 0.08) / 0.5, 0, 1); b.style.width = (easeOut(u) * 22) + '%'; b.style.opacity = 1 - clamp((t - fim) / 0.3, 0, 1); }
}

// Título na abertura
const titulo = document.getElementById('titulo'), h1 = titulo.querySelector('h1'), linhaT = titulo.querySelector('.linha');
h1.textContent = D.title;
h1.style.fontSize = (W > H ? 8.5 : 10) * U + 'px';
function animaTitulo(t) {
  const entra = easeOut(clamp(t / 0.8, 0, 1)), sai = clamp((t - 2.1) / 0.5, 0, 1);
  titulo.style.opacity = entra * (1 - sai);
  h1.style.letterSpacing = (0.12 - 0.12 * entra) + 'em';
  h1.style.transform = 'translateY(' + ((1 - entra) * 0.3) + 'em)';
  linhaT.style.width = (easeOut(clamp((t - 0.3) / 0.7, 0, 1)) * 18) + '%';
}

// Legenda karaokê: a palavra falada agora fica destacada
const legenda = document.getElementById('legenda');
legenda.style.fontSize = (W > H ? 3.9 : 5.2) * U + 'px';
legenda.style.bottom = W > H ? '7%' : '17%';
let cueAtual = -1;
function animaLegenda(t) {
  let idx = -1;
  for (let i = 0; i < D.cues.length; i++) if (t >= D.cues[i].start - 0.05 && t <= D.cues[i].end + 0.25) idx = i;
  if (idx !== cueAtual) {
    cueAtual = idx; legenda.innerHTML = '';
    if (idx >= 0) for (const w of D.cues[idx].words) { const s = document.createElement('span'); s.textContent = w.w; legenda.append(s); }
  }
  if (idx < 0) return;
  const spans = legenda.children;
  D.cues[idx].words.forEach((w, k) => spans[k] && spans[k].classList.toggle('atual', t >= w.s && t < w.e + 0.05));
}

// Cartão final
const fim = document.getElementById('final');
fim.querySelector('.t').textContent = D.title;
fim.querySelector('.cta').textContent = D.cta || D.title;
fim.querySelector('.t').style.fontSize = (W > H ? 2.6 : 3.4) * U + 'px';
fim.querySelector('.cta').style.fontSize = (W > H ? 7.5 : 9) * U + 'px';
function animaFinal(t) {
  if (D.endCardFrom == null) return;
  const u = easeOut(clamp((t - D.endCardFrom) / 0.6, 0, 1));
  fim.style.opacity = u;
  fim.style.background = 'rgba(0,0,0,' + (0.72 * u) + ')';
  fim.querySelector('.linha').style.width = (u * 20) + '%';
}

let pronto = false;
window.ready = Promise.all(cenas.map(c => c.src.decode().catch(() => null))).then(() => { cenas.forEach(dimensiona); pronto = true; return 1; });

window.renderFrame = function (n) {
  if (!pronto) cenas.forEach(dimensiona);
  const t = n / D.fps;
  // Cena atual e, durante a transição, a anterior
  let atual = 0;
  for (let i = 0; i < D.timings.length; i++) if (D.timings[i].start <= t) atual = i;
  const tm = D.timings[atual];
  const p = atual > 0 ? clamp((t - tm.start) / D.trans, 0, 1) : 1;

  cenas.forEach(c => { c.el.style.display = 'none'; });
  const ca = cenas[atual];
  ca.el.style.display = 'block'; ca.el.style.zIndex = 2; posiciona(ca, t);
  if (p < 1) {
    const cs = cenas[atual - 1];
    cs.el.style.display = 'block'; cs.el.style.zIndex = 1; posiciona(cs, t);
    const tr = transicao(D.scenes[atual].transition, p);
    aplica(ca.el, tr.entra); aplica(cs.el, tr.sai);
  } else aplica(ca.el, { o: 1 });

  textoDa(atual); animaTexto(atual, t);
  animaTitulo(t);
  if (temLegenda) animaLegenda(t);
  animaFinal(t);
  grao.style.transform = 'translate(' + (-((n * 37) % 64)) + 'px,' + (-((n * 53) % 64)) + 'px)';
  return n;
};
</script>
</body></html>`
}
