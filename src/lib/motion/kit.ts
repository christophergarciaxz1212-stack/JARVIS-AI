/**
 * Kits visuais dos modelos de vídeo do JARVIS (motion graphics desenhado por código, vertical 1080×1920).
 *
 * Cada modelo foi desenhado a partir de referências de vídeos de tecnologia/negócios que performam bem
 * no TikTok/Reels. O kit dá à IA peças prontas e testadas (fundo, legenda karaokê, tags, cards, ícones,
 * terminal, código, chips, contador, curva, linha do tempo…) no visual do modelo: ela só compõe as cenas.
 * Isso deixa o resultado consistente mesmo com modelos de IA gratuitos.
 *
 * Tudo é função pura do quadro n (sem relógio, sem Math.random) — igual ao resto do motor.
 */
import type { Composition } from './types'
import type { WordTime } from './audio'

export type KitStyle = 'tech-passos' | 'tech-news' | 'minimal-dados' | 'tech-analogia'
export const KIT_STYLES: KitStyle[] = ['tech-passos', 'tech-news', 'minimal-dados', 'tech-analogia']

export const KIT_INFO: Record<KitStyle, { label: string; hint: string; grammar: string }> = {
  'tech-passos': {
    label: 'Explicador tech em passos',
    hint: 'lista numerada, terminais, ícones, diagramas',
    grammar: 'Explicador de tecnologia em PASSOS (lista "5 ferramentas/projetos/dicas"): fundo quase preto com grade de pontos; no topo a barra de passos K.steps e um título FIXO em caixa alta com 1–2 palavras de destaque amarelo (a 2ª em itálico serifado); embaixo do título uma linha mono pequena (subtítulo). Cada passo é uma cena: rótulo mono "② NOME DO ITEM" em destaque, nome grande no centro, e um visual que EXPLICA (card de terminal digitando, grade de ícones de apps acendendo, diagrama de nós com o item no centro ligado a 2–3 ícones, card de código). Badge "nível" no canto (K.badge) que muda a cada passo. Mascote opcional no canto inferior esquerdo. Legenda karaokê em caixa com a palavra-chave destacada (K.caption). Ritmo: algo entra a cada ~0,8 s.',
  },
  'tech-news': {
    label: 'Notícia tech neon',
    hint: 'manchete, apps em vidro, comando, onda de voz',
    grammar: 'NOTÍCIA de tecnologia/IA em tom de urgência: fundo azul-marinho profundo com partículas desfocadas e um feixe de luz vertical; marca no canto superior esquerdo e tagline mono no direito (K.brand). Abertura: pílula "ATENÇÃO" (K.pill) e manchete grande com a palavra-chave em azul (K.title), com ícones de apps em vidro lado a lado (K.appIcon, um com selo "RIP"/"NOVO"). Cenas seguintes: chip de comando mono tipo "/nome-da-skill" (K.pill variante cmd) aparecendo com o feixe, card de vidro com onda de voz (K.wave) ou grade de apps (K.grid), números/benefícios em pílulas, mascote reagindo. Legenda karaokê grande na base: palavra falada dentro de uma pílula azul, próximas apagadas (K.caption). Fecho com CTA "segue para mais".',
  },
  'minimal-dados': {
    label: 'Minimalista de dados',
    hint: 'preto e branco, contadores, curvas, linha do tempo',
    grammar: 'Storytelling MINIMALISTA de números (dinheiro, hábitos, crescimento, tempo): fundo preto puro com estrelas quase invisíveis, só branco e cinza, linhas finas de 2–3 px e pontos com leve brilho. Títulos curtos em caixa alta com letras bem espaçadas (K.label), números grandes e finos que contam (K.counter com barra de progresso), curva exponencial se desenhando com o ponto "VOCÊ ESTÁ AQUI" (K.curve), linha do tempo vertical com marcos (K.timeline), figuras simples (círculo + corpo) empurrando/subindo. Muito respiro, uma ideia por cena, movimentos lentos e elegantes. Sem cores, sem cards pesados. Legenda discreta (K.caption) na base.',
  },
  'tech-analogia': {
    label: 'Explicador por analogia',
    hint: 'analogia do dia a dia, telas neon, chips, alerta',
    grammar: 'Explicação técnica por ANALOGIA do dia a dia (ex.: "o Supabase é um prédio: portaria = login, depósito = storage"): fundo azul-noite com contornos neon azuis; marca no canto superior esquerdo e etiqueta "TEMA · ficha técnica" no direito (K.brand). Manchete revelada palavra a palavra com a palavra-chave em laranja (K.typedTitle). Cenas: moldura de celular/janela neon (K.device) mostrando o conceito com ícone grande; abaixo, grade de chips com o item atual aceso e contador "3 de 8" (K.chips); comparações "X = Y" lado a lado. Uma cena de ALERTA com fundo laranja listrado (K.bg com alert), pílula preta "⚠ CUIDADO" e bloco de código com a linha perigosa destacada (K.code). Faixa de legenda mono na base (K.caption).',
  },
}

/** Variáveis de cor/tipo e peças visuais por modelo. */
const THEMES: Record<KitStyle, string> = {
  'tech-passos': '--bg:#09090b;--bg2:#121214;--fg:#f6f5ef;--acc:#facc15;--acc2:#fb923c;--muted:#8e8c80;--card:#121214;--cardline:#2c2b26;--glow:rgba(250,204,21,.45);--dot:rgba(255,255,255,.07)',
  'tech-news': '--bg:#020617;--bg2:#0b1d42;--fg:#f8fafc;--acc:#3b82f6;--acc2:#60a5fa;--muted:#8fa3c4;--card:rgba(148,190,255,.07);--cardline:rgba(148,190,255,.28);--glow:rgba(59,130,246,.55);--dot:rgba(147,197,253,.10)',
  'minimal-dados': '--bg:#000;--bg2:#050505;--fg:#fff;--acc:#fff;--acc2:#d4d4d4;--muted:rgba(255,255,255,.55);--card:transparent;--cardline:rgba(255,255,255,.35);--glow:rgba(255,255,255,.6);--dot:rgba(255,255,255,.05)',
  'tech-analogia': '--bg:#040a1c;--bg2:#0a1638;--fg:#f8fafc;--acc:#f97316;--acc2:#3b82f6;--muted:#93a4c6;--card:rgba(10,22,56,.75);--cardline:#3b82f6;--glow:rgba(59,130,246,.6);--dot:rgba(96,165,250,.08)',
}

export function kitCss(style: KitStyle) {
  return `
#stage.k-${style} { ${THEMES[style]}; background: var(--bg); color: var(--fg); font-family: "Segoe UI", "Inter", Arial, sans-serif; }
.k-abs { position:absolute; }
.k-mono { font-family: "Cascadia Mono", "Consolas", "Courier New", monospace; }
.k-serif { font-family: Georgia, "Times New Roman", serif; font-style: italic; font-weight: 500; }
.k-bg { position:absolute; inset:0; overflow:hidden; }
.k-title { font-weight: 900; line-height: 1.04; letter-spacing: -.02em; color: var(--fg); text-transform: ${style === 'tech-passos' ? 'uppercase' : 'none'}; white-space: normal; word-break: break-word; }
.k-title .k-acc { color: var(--acc); ${style === 'tech-news' ? 'text-shadow: 0 0 40px var(--glow);' : ''} }
.k-title .k-acc2 { color: var(--acc); font-family: Georgia, "Times New Roman", serif; font-style: italic; font-weight: 500; text-transform: none; }
.k-label { font-size: 30px; font-weight: 600; letter-spacing: .38em; text-transform: uppercase; color: var(--muted); }
.k-pill { display:inline-flex; align-items:center; gap:14px; padding: 14px 30px; border-radius: 999px; font-size: 34px; font-weight: 800; letter-spacing: .06em; white-space: nowrap; }
.k-pill.tag { background: rgba(255,255,255,.06); border: 2px solid var(--cardline); color: var(--muted); font-size: 26px; letter-spacing: .22em; text-transform: uppercase; }
.k-pill.alert { background: #0a0a0a; color: #fff; border: 3px solid #0a0a0a; font-size: 44px; padding: 16px 38px; }
.k-pill.cmd { font-family: "Cascadia Mono", Consolas, monospace; font-weight: 600; background: rgba(59,130,246,.10); border: 2px solid var(--acc); color: var(--acc2); font-size: 36px; letter-spacing: 0; box-shadow: 0 0 40px -6px var(--glow); }
.k-pill.acc { background: var(--acc); color: ${style === 'minimal-dados' ? '#000' : '#0a0a0a'}; }
.k-card { border-radius: ${style === 'minimal-dados' ? '0' : style === 'tech-news' ? '36px' : '22px'}; background: var(--card); border: ${style === 'tech-analogia' ? '3px solid var(--cardline)' : '2px solid var(--cardline)'}; ${style === 'tech-analogia' ? 'box-shadow: 0 0 36px -4px var(--glow), inset 0 0 30px -10px var(--glow);' : style === 'tech-news' ? 'backdrop-filter: blur(6px); box-shadow: 0 30px 80px -30px rgba(0,0,0,.8);' : ''} overflow:hidden; }
.k-card-h { display:flex; align-items:center; gap:12px; padding: 18px 24px; border-bottom: 2px solid var(--cardline); font-size: 24px; color: var(--muted); }
.k-dots i { display:inline-block; width:14px; height:14px; border-radius:50%; margin-right:8px; }
.k-tagbox { margin-left:auto; padding: 6px 14px; border: 2px solid var(--acc2); border-radius: 8px; color: var(--acc2); font-size: 20px; letter-spacing: .12em; text-transform: uppercase; }
.k-app { display:flex; flex-direction:column; align-items:center; gap: 16px; color: var(--muted); font-size: 28px; }
.k-app-b { position:relative; display:flex; align-items:center; justify-content:center; border-radius: 30%; background: ${style === 'tech-news' ? 'linear-gradient(160deg, rgba(255,255,255,.14), rgba(255,255,255,.03))' : 'var(--card)'}; border: 2px solid var(--cardline); box-shadow: 0 20px 50px -20px rgba(0,0,0,.9); }
.k-badge { position:absolute; top:-18px; right:-22px; padding: 6px 16px; border-radius: 999px; font-size: 26px; font-weight: 900; background: #ef4444; color:#fff; transform: rotate(8deg); }
.k-term { font-family: "Cascadia Mono", Consolas, monospace; font-size: 30px; line-height: 1.55; padding: 24px 28px; color: var(--fg); white-space: pre-wrap; }
.k-term .p { color: var(--acc); } .k-term .c { color: var(--muted); }
.k-code { font-family: "Cascadia Mono", Consolas, monospace; font-size: 30px; line-height: 1.6; padding: 22px 26px; color: #e2e8f0; white-space: pre; }
.k-code .hl { outline: 3px solid var(--acc); outline-offset: 4px; border-radius: 6px; background: rgba(249,115,22,.14); }
.k-chips { display:grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
.k-chip { padding: 14px 10px; border-radius: 12px; border: 2px solid var(--cardline); color: var(--muted); font-size: 24px; text-align:center; font-family: "Cascadia Mono", Consolas, monospace; white-space: nowrap; overflow:hidden; text-overflow: ellipsis; }
.k-chip.on { color: #0a0a0a; background: var(--acc); border-color: var(--acc); box-shadow: 0 0 26px -4px var(--acc); font-weight: 700; }
.k-cap { display:flex; flex-wrap:wrap; justify-content:center; align-items:center; gap: 10px 14px; font-weight: 800; line-height: 1.15; }
.k-cap.box, .k-cap.strip, .k-cap.thin { flex-wrap: nowrap; white-space: nowrap; }
.k-cap.box { padding: 18px 30px; border-radius: 14px; border: 2px solid var(--acc); background: rgba(0,0,0,.55); font-size: 46px; }
.k-cap.box .on { color: var(--acc); }
.k-cap.pill { font-size: 66px; }
.k-cap.pill span { padding: 4px 16px; border-radius: 14px; color: rgba(255,255,255,.38); }
.k-cap.pill span.done { color: #fff; }
.k-cap.pill span.on { color: #fff; background: var(--acc); box-shadow: 0 0 30px -4px var(--glow); }
.k-cap.thin { font-size: 34px; font-weight: 500; letter-spacing: .12em; text-transform: uppercase; color: var(--muted); }
.k-cap.thin .on { color: #fff; }
.k-cap.strip { font-family: "Cascadia Mono", Consolas, monospace; font-size: 34px; font-weight: 600; padding: 14px 26px; background: rgba(0,0,0,.6); border-top: 2px solid var(--acc2); border-bottom: 2px solid var(--acc2); }
.k-cap.strip .on { color: var(--acc); }
.k-brand { display:flex; align-items:center; gap: 16px; font-size: 32px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
.k-brand small { display:block; font-size: 16px; letter-spacing: .3em; color: var(--muted); font-weight: 600; }
.k-steps { display:flex; gap: 12px; }
.k-steps i { flex:1; height: 8px; border-radius: 6px; background: rgba(255,255,255,.12); }
.k-steps i.on { background: var(--acc); box-shadow: 0 0 16px var(--glow); }
/* Cena de alerta (fundo laranja): destaque e etiquetas trocam para escuro para não sumir no laranja */
.k-bg:has(.k-alertbg) ~ * .k-acc, .k-bg:has(.k-alertbg) ~ * .k-acc2 { color: #0a0a0a; text-shadow: none; }
.k-bg:has(.k-alertbg) ~ * .k-pill.tag { color: #0a0a0a; border-color: rgba(0,0,0,.45); background: rgba(255,255,255,.25); }
.k-bg:has(.k-alertbg) ~ * .k-brand small { color: rgba(0,0,0,.6); }
.k-num { font-weight: 300; letter-spacing: -.02em; color: var(--fg); }
.k-bar { height: 6px; border-radius: 4px; background: rgba(255,255,255,.14); overflow:hidden; }
.k-bar i { display:block; height:100%; background: var(--fg); box-shadow: 0 0 14px var(--glow); }
`
}

/**
 * Funções do kit, disponíveis no objeto K. Strings sem crase (o arquivo é um template literal).
 */
export const KIT_JS = String.raw`
const K = (function () {
  const S = typeof KIT === 'string' ? KIT : 'tech-passos';
  const px = v => (typeof v === 'number' ? v + 'px' : v);
  const ICONS = {
    mail: 'M3 6h18v12H3z M3 7l9 6 9-6',
    calendar: 'M4 6h16v14H4z M4 10h16 M8 3v4 M16 3v4',
    code: 'M9 7l-5 5 5 5 M15 7l5 5-5 5',
    globe: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z M3 12h18 M12 3c3 3 3 15 0 18 M12 3c-3 3-3 15 0 18',
    check: 'M5 12l5 5 9-10',
    bot: 'M6 9h12v10H6z M12 5v4 M9 14h.01 M15 14h.01 M3 13v3 M21 13v3',
    film: 'M4 5h16v14H4z M8 5v14 M16 5v14 M4 9h4 M4 15h4 M16 9h4 M16 15h4',
    lock: 'M6 11h12v9H6z M8 11V8a4 4 0 0 1 8 0v3',
    database: 'M4 6c0-2 16-2 16 0v12c0 2-16 2-16 0z M4 6c0 2 16 2 16 0 M4 12c0 2 16 2 16 0',
    user: 'M12 4a4 4 0 1 0 0 8a4 4 0 1 0 0-8z M4 21c1-5 15-5 16 0',
    bulb: 'M9 18h6 M10 21h4 M12 3a6 6 0 0 0-4 10c1 1 1 2 1 3h6c0-1 0-2 1-3a6 6 0 0 0-4-10z',
    phone: 'M7 2h10v20H7z M11 18h2',
    cloud: 'M7 18a5 5 0 1 1 1-9.9A6 6 0 0 1 19 10a4 4 0 0 1 0 8z',
    chart: 'M4 20V4 M4 20h16 M8 16v-4 M12 16V8 M16 16v-7',
    bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
    warning: 'M12 3L2 20h20z M12 9v5 M12 17h.01',
    folder: 'M3 6h6l2 2h10v11H3z',
    key: 'M8 14a4 4 0 1 1 3-3l9 9-2 2-2-2-2 2-2-2 1-1z',
    star: 'M12 3l3 6 6 1-4.5 4.5L18 21l-6-3-6 3 1.5-6.5L3 10l6-1z',
    search: 'M10 4a6 6 0 1 0 0 12a6 6 0 1 0 0-12z M15 15l6 6',
    gear: 'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2',
    terminal: 'M3 5h18v14H3z M7 10l3 2-3 2 M12 15h5',
    image: 'M3 5h18v14H3z M3 16l5-5 4 4 3-3 6 6 M15 9h.01',
    play: 'M7 4l13 8-13 8z',
    money: 'M3 7h18v10H3z M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z M6 10v4 M18 10v4',
    heart: 'M12 20s-8-5-8-11a4 4 0 0 1 8-1a4 4 0 0 1 8 1c0 6-8 11-8 11z',
    rocket: 'M12 2c4 3 5 8 3 13H9C7 10 8 5 12 2z M9 15l-3 3 M15 15l3 3 M12 9h.01 M10 19l2 3 2-3',
    instagram: 'M4 4h16v16H4z M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8z M17 7h.01',
    sparkle: 'M12 3v6 M12 15v6 M3 12h6 M15 12h6 M6 6l3 3 M15 15l3 3 M6 18l3-3 M15 9l3-3',
    building: 'M5 21V4h10v17 M15 9h4v12 M8 8h2 M8 12h2 M8 16h2 M3 21h18',
    door: 'M6 21V3h12v18 M3 21h18 M14 12h.01',
    box: 'M3 7l9-4 9 4v10l-9 4-9-4z M3 7l9 4 9-4 M12 11v10',
  };
  const icon = (name, size, color) => {
    const d = ICONS[name] || ICONS.sparkle;
    const s = size || 64;
    return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="' + (color || 'currentColor') + '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="' + d + '"/></svg>';
  };
  const enter = (n, start, kind, dur) => {
    if (n < start) return 'opacity:0;';
    const t = T(n - start), u = spring(t, 3, 0.62), o = clamp(t / (dur || 0.22));
    if (kind === 'scale') return 'opacity:' + o.toFixed(3) + ';transform:scale(' + (0.55 + 0.45 * u).toFixed(4) + ');';
    if (kind === 'left') return 'opacity:' + o.toFixed(3) + ';transform:translateX(' + ((1 - u) * -90).toFixed(1) + 'px);';
    if (kind === 'right') return 'opacity:' + o.toFixed(3) + ';transform:translateX(' + ((1 - u) * 90).toFixed(1) + 'px);';
    if (kind === 'fade') return 'opacity:' + clamp(t / 0.45).toFixed(3) + ';';
    return 'opacity:' + o.toFixed(3) + ';transform:translateY(' + ((1 - u) * 70).toFixed(1) + 'px);';
  };
  /* Coloca um bloco em (x, y). center: centraliza no eixo x. Entrada com mola a partir do quadro start. */
  const place = (html, o, n, start, kind) => {
    o = o || {};
    // Centralizado: left 50% deixaria só metade da largura disponível (o bloco encolheria e quebraria linhas)
    const pos = 'position:absolute;top:' + px(o.y || 0) + ';' + (o.center ? 'left:50%;translate:-50% 0;' + (o.w ? '' : 'width:max-content;max-width:1000px;') : 'left:' + px(o.x || 0) + ';') + (o.w ? 'width:' + px(o.w) + ';' : '') + (o.z ? 'z-index:' + o.z + ';' : '');
    return '<div style="' + pos + (start === undefined ? '' : enter(n, start, kind)) + '">' + html + '</div>';
  };
  const bg = (n, o) => {
    o = o || {};
    let h = '<div class="k-bg" style="background:var(--bg)">';
    if (o.alert) {
      h += '<div class="k-bg k-alertbg" style="background:#f97316"></div><div class="k-bg" style="opacity:.22;background:repeating-linear-gradient(-35deg,#000 0 26px,transparent 26px 70px);transform:translateX(' + ((n * 1.2) % 86).toFixed(1) + 'px) scale(1.2)"></div>';
      return h + '</div>';
    }
    if (S === 'tech-passos') {
      h += '<div class="k-bg" style="background-image:radial-gradient(var(--dot) 2px, transparent 2.5px);background-size:36px 36px;background-position:0 ' + (-(n * 0.4) % 36).toFixed(1) + 'px"></div>';
      h += '<div class="k-bg" style="background:radial-gradient(1100px 900px at 50% 40%, rgba(250,204,21,.06), transparent 70%), radial-gradient(circle at 50% 50%, transparent 55%, rgba(0,0,0,.65))"></div>';
    } else if (S === 'tech-news') {
      h += '<div class="k-bg" style="background:radial-gradient(1200px 1400px at 50% 30%, var(--bg2), var(--bg) 70%)"></div>';
      for (let i = 0; i < 26; i++) {
        const x = hash(i) * 1080, y = (hash(i + 50) * 1920 - n * (0.3 + hash(i + 9) * 0.6)) % 1920, r = 3 + hash(i + 7) * 10, a = 0.15 + 0.35 * hash(i + 3);
        h += '<i style="position:absolute;left:' + x.toFixed(0) + 'px;top:' + ((y + 1920) % 1920).toFixed(0) + 'px;width:' + r.toFixed(1) + 'px;height:' + r.toFixed(1) + 'px;border-radius:50%;background:rgba(147,197,253,' + a.toFixed(2) + ');filter:blur(' + (r > 9 ? 3 : 0.5) + 'px)"></i>';
      }
      const bx = 540 + Math.sin(n / 90) * 40;
      h += '<div style="position:absolute;top:-10%;bottom:-10%;left:' + bx.toFixed(0) + 'px;width:6px;background:linear-gradient(transparent, rgba(96,165,250,.9) 40%, rgba(96,165,250,.9) 60%, transparent);box-shadow:0 0 60px 18px rgba(59,130,246,.35);opacity:' + (0.55 + 0.25 * Math.sin(n / 25)).toFixed(3) + '"></div>';
    } else if (S === 'minimal-dados') {
      for (let i = 0; i < 40; i++) h += '<i style="position:absolute;left:' + (hash(i) * 1080).toFixed(0) + 'px;top:' + (hash(i + 99) * 1920).toFixed(0) + 'px;width:2px;height:2px;border-radius:50%;background:#fff;opacity:' + (0.08 + 0.18 * (0.5 + 0.5 * Math.sin(n / 40 + i))).toFixed(3) + '"></i>';
    } else {
      h += '<div class="k-bg" style="background:radial-gradient(1200px 1300px at 50% 35%, var(--bg2), var(--bg) 72%)"></div>';
      h += '<div class="k-bg" style="background-image:linear-gradient(var(--dot) 1px, transparent 1px), linear-gradient(90deg, var(--dot) 1px, transparent 1px);background-size:60px 60px;opacity:.6"></div>';
    }
    return h + '</div>';
  };
  const brand = (n, tag) => {
    const name = (BRAND && BRAND.name) || 'JARVIS';
    const left = '<div class="k-brand">' + (BRAND && BRAND.logo ? '<img src="' + BRAND.logo + '" style="height:56px">' : icon('sparkle', 44, 'var(--acc)')) + '<div>' + esc(name) + '<small>' + (S === 'tech-news' ? 'PROJECTS' : 'IA · TECH') + '</small></div></div>';
    let h = place(left, { x: 70, y: 70 }, n, 0, 'fade');
    if (tag) h += '<div style="position:absolute;top:84px;right:70px;' + enter(n, 4, 'fade') + '"><span class="k-pill tag k-mono" style="font-size:22px;padding:10px 20px">' + esc(tag) + '</span></div>';
    return h;
  };
  const steps = (cur, total, y) => {
    let s = '';
    for (let i = 0; i < total; i++) s += '<i class="' + (i <= cur ? 'on' : '') + '"></i>';
    return '<div class="k-steps" style="position:absolute;left:70px;right:70px;top:' + px(y === undefined ? 44 : y) + '">' + s + '</div>';
  };
  /* Título com palavras de destaque: acc = palavras na cor de destaque; serif = palavras em itálico serifado */
  const title = (text, acc, size, o) => {
    o = o || {};
    // Pontuação não conta: destaque "instagram?" pega a palavra "Instagram?"
    const key = w => String(w).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    const a = (acc || []).map(key), sf = (o.serif || []).map(key);
    const words = String(text).split(/\s+/).filter(Boolean);
    const shown = o.count === undefined ? words.length : Math.max(0, Math.min(words.length, o.count));
    const body = words.slice(0, shown).map(w => {
      const k = key(w);
      return sf.includes(k) ? '<span class="k-acc2">' + esc(w) + '</span>' : a.includes(k) ? '<span class="k-acc">' + esc(w) + '</span>' : esc(w);
    }).join(' ');
    return '<div class="k-title" style="font-size:' + (size || 96) + 'px;text-align:' + (o.align || 'left') + ';max-width:' + px(o.w || 940) + '">' + body + '</div>';
  };
  /* Título revelado palavra a palavra a partir do quadro start (wps palavras por segundo) */
  const typedTitle = (text, acc, n, start, size, o) => {
    const c = n < start ? 0 : Math.floor(T(n - start) * ((o && o.wps) || 3)) + 1;
    return title(text, acc, size, Object.assign({}, o || {}, { count: c }));
  };
  const label = (text, o) => '<div class="k-label" style="text-align:' + ((o && o.align) || 'center') + '">' + esc(text) + '</div>';
  const pill = (text, variant, ic) => '<span class="k-pill ' + (variant || 'tag') + '">' + (ic ? icon(ic, 38) : '') + esc(text) + '</span>';
  const card = (inner, o) => {
    o = o || {};
    const dots = '<span class="k-dots"><i style="background:#ef4444"></i><i style="background:#f59e0b"></i><i style="background:#22c55e"></i></span>';
    return '<div class="k-card" style="width:' + px(o.w || 460) + '">' + (o.title !== false ? '<div class="k-card-h">' + dots + '<span class="k-mono">' + esc(o.title || '') + '</span>' + (o.tag ? '<span class="k-tagbox k-mono">' + esc(o.tag) + '</span>' : '') + '</div>' : '') + '<div style="padding:' + px(o.pad === undefined ? 24 : o.pad) + '">' + inner + '</div></div>';
  };
  const appIcon = (name, lbl, o) => {
    o = o || {};
    const s = o.size || 180;
    return '<div class="k-app"><div class="k-app-b" style="width:' + s + 'px;height:' + s + 'px;color:' + (o.color || 'var(--acc2)') + '">' + icon(name, Math.round(s * 0.5)) + (o.badge ? '<span class="k-badge">' + esc(o.badge) + '</span>' : '') + '</div>' + (lbl ? '<div>' + esc(lbl) + '</div>' : '') + '</div>';
  };
  /* Grade de ícones que acendem um a um (cada um com barrinha de progresso) */
  const grid = (names, n, start, o) => {
    o = o || {};
    const cols = o.cols || 3, s = o.size || 150, gap = 26;
    let h = '<div style="display:grid;grid-template-columns:repeat(' + cols + ',' + s + 'px);gap:' + gap + 'px">';
    names.forEach((nm, i) => {
      const t0 = start + i * F(0.18), on = n >= t0;
      const fill = clamp(T(n - t0) / 1.2);
      h += '<div style="' + enter(n, t0, 'scale') + '"><div class="k-app-b" style="width:' + s + 'px;height:' + s + 'px;flex-direction:column;gap:12px;color:' + (on ? 'var(--acc)' : 'var(--muted)') + '">' + icon(nm, Math.round(s * 0.42)) + '<div class="k-bar" style="width:60%"><i style="width:' + (fill * 100).toFixed(1) + '%;background:var(--acc)"></i></div></div></div>';
    });
    return h + '</div>';
  };
  /* Diagrama: nó central brilhante ligado a nós laterais por linhas tracejadas que se desenham */
  const nodes = (n, start, center, sides, o) => {
    o = o || {};
    const w = o.w || 940, hgt = o.h || 520, cx = w / 2, cy = hgt / 2, R = 120;
    const pts = sides.map((s, i) => { const ang = (sides.length === 2 ? [Math.PI, 0] : [Math.PI, 0, -Math.PI / 2, Math.PI / 2])[i] ?? (i * 2 * Math.PI / sides.length); return { x: cx + Math.cos(ang) * (w / 2 - 90), y: cy + Math.sin(ang) * (hgt / 2 - 90), s }; });
    let svg = '<svg width="' + w + '" height="' + hgt + '" style="position:absolute;left:0;top:0;overflow:visible">';
    pts.forEach((p, i) => { const len = Math.hypot(p.x - cx, p.y - cy); svg += '<line x1="' + cx + '" y1="' + cy + '" x2="' + p.x.toFixed(1) + '" y2="' + p.y.toFixed(1) + '" stroke="var(--acc2)" stroke-width="3" stroke-dasharray="10 12" opacity="' + clamp(T(n - start - F(0.3) - i * 6) * 3).toFixed(2) + '" stroke-dashoffset="' + (-(n * 1.5) % 22).toFixed(1) + '"/>'; void len; });
    svg += '</svg>';
    let h = '<div style="position:relative;width:' + w + 'px;height:' + hgt + 'px">' + svg;
    const glow = 0.6 + 0.4 * Math.sin(n / 12);
    h += '<div style="position:absolute;left:' + (cx - R) + 'px;top:' + (cy - R) + 'px;width:' + 2 * R + 'px;height:' + 2 * R + 'px;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;background:radial-gradient(circle, rgba(255,255,255,.08), rgba(0,0,0,.4));border:4px solid var(--acc);box-shadow:0 0 ' + (50 * glow).toFixed(0) + 'px var(--glow);color:var(--acc);' + enter(n, start, 'scale') + '">' + icon(center.icon || 'sparkle', 90) + '</div>';
    if (center.label) h += '<div class="k-mono" style="position:absolute;left:0;right:0;top:' + (cy + R + 18) + 'px;text-align:center;font-size:24px;letter-spacing:.2em;color:var(--muted);' + enter(n, start + 6, 'fade') + '">' + esc(center.label) + '</div>';
    pts.forEach((p, i) => { h += '<div style="position:absolute;left:' + (p.x - 70).toFixed(0) + 'px;top:' + (p.y - 70).toFixed(0) + 'px;width:140px;height:140px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:3px solid var(--acc2);background:var(--card);color:var(--acc2);' + enter(n, start + F(0.35) + i * 6, 'scale') + '">' + icon(p.s.icon || 'sparkle', 60) + '</div>' + (p.s.label ? '<div style="position:absolute;left:' + (p.x - 120).toFixed(0) + 'px;top:' + (p.y + 80).toFixed(0) + 'px;width:240px;text-align:center;font-size:26px;color:var(--muted);' + enter(n, start + F(0.5) + i * 6, 'fade') + '">' + esc(p.s.label) + '</div>' : ''); });
    return h + '</div>';
  };
  /* Terminal digitando linhas (linhas que começam com $ ganham prompt) */
  const terminal = (lines, n, start, o) => {
    o = o || {};
    let left = Math.max(0, Math.floor(T(n - start) * (o.cps || 30)));
    const out = lines.map(l => { const s = l.slice(0, left); left = Math.max(0, left - l.length - 4); return s; }).filter((s, i) => i === 0 || s.length);
    const body = out.map(s => s.startsWith('$') ? '<span class="p">$</span>' + esc(s.slice(1)) : s.startsWith('#') ? '<span class="c">' + esc(s) + '</span>' : esc(s)).join('\n') + (Math.floor(n / 15) % 2 ? '▍' : ' ');
    return card('<div class="k-term">' + body + '</div>', { w: o.w || 900, title: o.title || 'terminal', tag: o.tag, pad: 0 });
  };
  /* Bloco de código com a linha hl (0-based) destacada */
  const code = (lines, hl, n, start, o) => {
    o = o || {};
    const body = lines.map((l, i) => i === hl && n >= start + F(0.6) ? '<span class="hl">' + esc(l) + '</span>' : esc(l)).join('\n');
    return card('<div class="k-code">' + body + '</div>', { w: o.w || 920, title: o.title || 'codigo.js', tag: o.tag, pad: 0 });
  };
  /* Grade de chips com o item ativo aceso e contador "x de N" */
  const chips = (list, active, o) => {
    o = o || {};
    let h = '<div style="width:' + px(o.w || 940) + '">';
    if (o.counter !== false) h += '<div class="k-mono" style="display:flex;justify-content:space-between;font-size:24px;color:var(--muted);letter-spacing:.14em;margin-bottom:14px"><span>' + esc(o.label || 'TUDO NUM SÓ LUGAR') + '</span><span style="color:var(--acc)">' + (active + 1) + ' de ' + list.length + '</span></div>';
    h += '<div class="k-chips">' + list.map((c, i) => '<div class="k-chip' + (i === active ? ' on' : '') + '">' + (i === active ? '+ ' : '') + esc(c) + '</div>').join('') + '</div>';
    return h + '</div>';
  };
  /* Número grande contando + rótulo + barra de progresso */
  const counter = (n, a, b, from, to, o) => {
    o = o || {};
    const v = Number(countUp(n, a, b, from, to, o.dec || 0));
    const txt = (o.prefix || '') + v.toLocaleString('pt-BR', { minimumFractionDigits: o.dec || 0, maximumFractionDigits: o.dec || 0 }) + (o.suffix || '');
    const p = to === from ? 1 : clamp((v - from) / (to - from));
    return '<div style="text-align:center;width:' + px(o.w || 760) + '">' + (o.label ? '<div class="k-label" style="font-size:26px;margin-bottom:14px">' + esc(o.label) + '</div>' : '') + '<div class="k-num" style="font-size:' + (o.size || 120) + 'px">' + esc(txt) + '</div>' + (o.bar === false ? '' : '<div class="k-bar" style="margin:22px auto 0;width:70%"><i style="width:' + (p * 100).toFixed(1) + '%"></i></div>') + '</div>';
  };
  /* Curva que se desenha (exp = exponencial, line = reta, up = subida) com ponto brilhante e rótulo */
  const curve = (n, a, b, o) => {
    o = o || {};
    const w = o.w || 860, h = o.h || 560, u = easeInOutCubic(seg(n, a, b));
    const f = o.kind === 'line' ? x => x : o.kind === 'up' ? x => Math.sqrt(x) : x => (Math.exp(4.2 * x) - 1) / (Math.exp(4.2) - 1);
    let d = '';
    const steps = 80;
    for (let i = 0; i <= steps; i++) { const x = i / steps; if (x > u) break; d += (i ? 'L' : 'M') + (x * w).toFixed(1) + ' ' + (h - f(x) * h).toFixed(1) + ' '; }
    const dx = u * w, dy = h - f(u) * h;
    const at = o.at === undefined ? null : o.at;
    let s = '<div style="position:relative;width:' + w + 'px;height:' + h + 'px"><svg width="' + w + '" height="' + h + '" style="position:absolute;inset:0;overflow:visible"><line x1="0" y1="' + h + '" x2="' + w + '" y2="' + h + '" stroke="rgba(255,255,255,.35)" stroke-width="2"/><line x1="0" y1="0" x2="0" y2="' + h + '" stroke="rgba(255,255,255,.35)" stroke-width="2"/><path d="' + d + '" fill="none" stroke="#fff" stroke-width="4" style="filter:drop-shadow(0 0 8px rgba(255,255,255,.7))"/></svg>';
    s += '<div style="position:absolute;left:' + (dx - 12).toFixed(1) + 'px;top:' + (dy - 12).toFixed(1) + 'px;width:24px;height:24px;border-radius:50%;background:#fff;box-shadow:0 0 24px 6px rgba(255,255,255,.7)"></div>';
    if (at !== null && o.label) { const lx = at * w, ly = h - f(at) * h; s += '<div style="position:absolute;left:' + (lx - 10).toFixed(0) + 'px;top:' + (ly - 90).toFixed(0) + 'px;' + enter(n, a + F(0.3), 'fade') + '"><span class="k-pill" style="background:#fff;color:#000;font-size:24px;padding:8px 18px;letter-spacing:.14em">' + esc(o.label) + '</span></div>'; }
    return s + '</div>';
  };
  /* Linha do tempo vertical com marcos [{label, at}] (at = quadro em que o marco aparece) */
  const timeline = (n, items, o) => {
    o = o || {};
    const h = o.h || 900, gap = h / Math.max(1, items.length - 1);
    const first = items.length ? items[0].at : 0, last = items.length ? items[items.length - 1].at : 0;
    const grow = clamp((n - first) / Math.max(1, last - first + 1));
    let s = '<div style="position:relative;width:' + px(o.w || 700) + ';height:' + h + 'px"><div style="position:absolute;left:12px;top:0;width:2px;height:' + (grow * h).toFixed(1) + 'px;background:linear-gradient(#fff,rgba(255,255,255,.3))"></div>';
    items.forEach((it, i) => { s += '<div style="position:absolute;left:0;top:' + (i * gap - 13).toFixed(0) + 'px;display:flex;align-items:center;gap:24px;' + enter(n, it.at, 'left') + '"><i style="display:block;width:26px;height:26px;border-radius:50%;background:#fff;box-shadow:0 0 18px 4px rgba(255,255,255,.6)"></i><span class="k-label" style="font-size:28px;color:#fff">' + esc(it.label) + '</span></div>'; });
    return s + '</div>';
  };
  /* Onda de voz animada dentro de um card de vidro */
  const wave = (n, o) => {
    o = o || {};
    let bars = '';
    for (let i = 0; i < 34; i++) { const v = 0.25 + 0.75 * Math.abs(Math.sin(n / 5 + i * 0.7) * Math.sin(n / 11 + i * 0.31)); bars += '<i style="display:inline-block;width:12px;margin:0 4px;border-radius:6px;height:' + (20 + v * 120).toFixed(0) + 'px;background:linear-gradient(var(--acc2), var(--acc))"></i>'; }
    return card('<div class="k-mono" style="font-size:22px;letter-spacing:.2em;color:var(--muted);margin-bottom:14px">' + esc(o.label || 'SUA VOZ') + '</div><div style="display:flex;align-items:center;height:150px">' + bars + '</div>', { w: o.w || 900, title: false });
  };
  /* Mascote simples (robô) balançando — desenhado em SVG */
  const mascot = (n, o) => {
    o = o || {};
    const b = Math.sin(n / 9) * 8, s = o.size || 260;
    return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 120 120" style="transform:translateY(' + b.toFixed(1) + 'px)"><ellipse cx="60" cy="114" rx="30" ry="5" fill="rgba(0,0,0,.4)"/><rect x="30" y="58" width="60" height="44" rx="14" fill="var(--acc)"/><rect x="24" y="16" width="72" height="50" rx="18" fill="#e5e7eb"/><rect x="32" y="26" width="56" height="30" rx="10" fill="#0f172a"/><circle cx="47" cy="41" r="6" fill="var(--acc2)"/><circle cx="73" cy="41" r="6" fill="var(--acc2)"/><line x1="60" y1="16" x2="60" y2="6" stroke="#e5e7eb" stroke-width="4"/><circle cx="60" cy="5" r="4" fill="var(--acc)"/><rect x="14" y="64" width="12" height="28" rx="6" fill="#e5e7eb" transform="rotate(' + (Math.sin(n / 7) * 12).toFixed(1) + ' 20 66)"/><rect x="94" y="64" width="12" height="28" rx="6" fill="#e5e7eb"/></svg>';
  };
  /* Moldura de celular/janela neon com conteúdo */
  const device = (inner, o) => {
    o = o || {};
    const w = o.w || 520, h = o.h || 900;
    return '<div style="width:' + w + 'px;height:' + h + 'px;border-radius:56px;border:4px solid var(--acc2);box-shadow:0 0 40px -2px var(--glow), inset 0 0 40px -12px var(--glow);background:rgba(4,10,28,.85);position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:26px;padding:40px">' + '<i style="position:absolute;top:22px;left:50%;translate:-50% 0;width:120px;height:12px;border-radius:8px;background:rgba(96,165,250,.35)"></i>' + inner + '</div>';
  };
  /* Badge de "nível" (canto): rótulo pequeno + valor + barras */
  const badge = (lbl, value, level, total) => {
    let bars = '';
    for (let i = 0; i < (total || 4); i++) bars += '<i style="flex:1;height:8px;border-radius:4px;background:' + (i < (level || 1) ? 'var(--acc)' : 'rgba(255,255,255,.12)') + '"></i>';
    return '<div class="k-card" style="width:400px;padding:18px 22px"><div class="k-mono" style="font-size:18px;letter-spacing:.2em;color:var(--acc)">● ' + esc(lbl) + '</div><div style="font-size:34px;font-weight:900;margin:6px 0 14px;text-transform:uppercase">' + esc(value) + '</div><div style="display:flex;gap:8px">' + bars + '</div></div>';
  };
  /* Legenda karaokê sincronizada com a narração (some sozinha sem narração). y = topo da legenda. */
  const caption = (n, o) => {
    o = o || {};
    if (!WORDS.length) return '';
    const i = wordIndex(n);
    if (i < 0) return '';
    const per = o.words || (S === 'tech-news' ? 3 : 4);
    let a = i;
    while (a > 0 && i - a < per - 1 && !/[.!?,;:]$/.test(WORDS[a - 1].word)) a--;
    a = Math.max(0, i - ((i - a) % per));
    const group = WORDS.slice(a, a + per);
    const kind = S === 'tech-news' ? 'pill' : S === 'minimal-dados' ? 'thin' : S === 'tech-analogia' ? 'strip' : 'box';
    const html = group.map(w => '<span class="' + (w.index === i ? 'on' : w.index < i ? 'done' : '') + '">' + esc(w.word) + '</span>').join(kind === 'box' || kind === 'strip' || kind === 'thin' ? ' ' : '');
    const y = o.y === undefined ? (S === 'tech-news' ? 1560 : 1600) : o.y;
    return '<div style="position:absolute;left:50%;translate:-50% 0;top:' + y + 'px;width:max-content;max-width:980px;z-index:20"><div class="k-cap ' + kind + '">' + html + '</div></div>';
  };
  return { icon, enter, place, bg, brand, steps, title, typedTitle, label, pill, card, appIcon, grid, nodes, terminal, code, chips, counter, curve, timeline, wave, mascot, device, badge, caption, ICONS: Object.keys(ICONS) };
})();
`

/** Explicação do kit para a IA: funções, layout recomendado e um esqueleto que funciona. */
export function kitDoc(style: KitStyle): string {
  const common = `KIT VISUAL DO MODELO "${KIT_INFO[style].label}" (já carregado na página: objeto K; o #stage já tem a classe do modelo com as cores em variáveis CSS var(--bg) var(--fg) var(--acc) var(--acc2) var(--muted) var(--card) var(--cardline) var(--glow)). USE O KIT — ele garante o visual do modelo; não reinvente fundo nem legenda:
- K.bg(n[, {alert:true}]) → HTML do fundo animado do modelo (sempre o primeiro elemento).
- K.place(html, {x, y, w, center:true}, n, quadroInicio, 'up'|'scale'|'left'|'right'|'fade') → posiciona um bloco (absoluto) com entrada em mola. Coordenadas em px no quadro 1080×1920.
- K.brand(n, 'tag do canto') → marca no canto superior esquerdo e etiqueta mono no direito.
- K.steps(passoAtual0, total[, y]) → barra de passos no topo.
- K.title(texto, ['palavras','em','destaque'], tamanhoPx, {serif:['palavra-em-itálico'], align:'left'|'center', w}) e K.typedTitle(texto, destaques, n, quadroInicio, tamanhoPx, {wps}) → manchete (revelada palavra a palavra).
- K.label(texto) → título pequeno em caixa alta espaçada. K.pill(texto, 'tag'|'alert'|'cmd'|'acc', 'icone?') → pílula.
- K.card(htmlInterno, {title, tag, w}) → janela com 3 bolinhas. K.terminal(['$ comando','saída','# comentário'], n, inicio, {title, tag, w}) e K.code(['linha1','linha2'], indiceDestacado, n, inicio, {title, w}).
- K.icon(nome, tamanho, cor) com nomes: ${['mail', 'calendar', 'code', 'globe', 'check', 'bot', 'film', 'lock', 'database', 'user', 'bulb', 'phone', 'cloud', 'chart', 'bolt', 'warning', 'folder', 'key', 'star', 'search', 'gear', 'terminal', 'image', 'play', 'money', 'heart', 'rocket', 'instagram', 'sparkle', 'building', 'door', 'box'].join(', ')}.
- K.appIcon(icone, 'rótulo', {size, badge:'RIP'}) · K.grid(['mail','code',...], n, inicio, {cols, size}) · K.nodes(n, inicio, {icon, label}, [{icon, label}, ...], {w, h}) (diagrama de nós ligados).
- K.chips(['Postgres','Login',...], indiceAtivo, {label, w}) · K.counter(n, a, b, de, ate, {label, prefix:'R$ ', suffix, size}) · K.curve(n, a, b, {kind:'exp'|'line'|'up', at:0.15, label:'VOCÊ ESTÁ AQUI', w, h}) · K.timeline(n, [{label:'HOJE', at:quadro}, ...], {h})
- K.wave(n, {label}) (onda de voz) · K.mascot(n, {size}) (mascote robô) · K.device(htmlInterno, {w, h}) (celular neon) · K.badge('rótulo', 'valor', nivel, total).
- K.caption(n[, {y}]) → legenda karaokê sincronizada com a narração, no visual do modelo. Coloque-a SEMPRE por cima de tudo (último elemento) em todas as cenas; deixe livre a faixa y 1540–1720 para ela.
Regras: monte tudo com stage.innerHTML = K.bg(n) + ... + K.caption(n) a cada quadro (abordagem a). Use sceneAt(n) para escolher a cena e s.start como quadro de entrada dos elementos (s.start + F(0.4), s.start + F(0.8)...). Conteúdo REAL do tema (nomes de ferramentas, comandos, números do pedido), nada de "Lorem". Textos grandes com no máximo ~16 caracteres por linha em 96px.`
  const skeleton: Record<KitStyle, string> = {
    'tech-passos': `Esqueleto (adapte o conteúdo; mantenha a estrutura):
function renderFrame(n) {
  const s = sceneAt(n);
  let h = K.bg(n) + K.steps(s.index, SCENES.length);
  h += K.place(K.title('5 PROJETOS DO GITHUB PRO SEU CLAUDE VIRAR', ['github'], 64, { serif: ['claude'] }), { x: 70, y: 90, w: 940 }, n, 0, 'fade');
  h += K.place('<div class="k-mono" style="color:var(--acc);font-size:24px;letter-spacing:.2em">⚙ DE CHATBOT A OPERAÇÃO · ' + SCENES.length + ' PASSOS</div>', { x: 70, y: 260 }, n, 0, 'fade');
  const scenes = [
    () => K.place(K.badge('NÍVEL DO SEU CLAUDE', 'Chatbot', 1, 5), { x: 610, y: 330 }, n, s.start, 'right') + K.place(K.terminal(['$ claude', 'Oi! Como posso ajudar hoje?'], n, s.start + F(0.3), { title: 'passo A', tag: 'claude code', w: 940 }), { x: 70, y: 560 }, n, s.start, 'up') + K.place(K.mascot(n), { x: 80, y: 1180 }, n, s.start + F(0.6), 'scale'),
    () => K.place('<div class="k-mono" style="color:var(--acc);font-size:30px;letter-spacing:.12em">② GOOGLE WORKSPACE CLI</div>', { x: 70, y: 330 }, n, s.start, 'left') + K.place(K.title('Google Workspace CLI', ['workspace'], 92, { align: 'center', serif: ['workspace'] }), { center: true, y: 480, w: 940 }, n, s.start + F(0.2), 'up') + K.place(K.nodes(n, s.start + F(0.5), { icon: 'bot', label: 'CLAUDE CODE' }, [{ icon: 'mail', label: 'Gmail' }, { icon: 'calendar', label: 'Agenda' }]), { center: true, y: 820, w: 940 }),
    // ...uma função por cena de SCENES, cada uma com o seu passo
  ];
  h += (scenes[s.index] || scenes[scenes.length - 1])();
  stage.innerHTML = h + K.caption(n);
}`,
    'tech-news': `Esqueleto (adapte o conteúdo; mantenha a estrutura):
function renderFrame(n) {
  const s = sceneAt(n);
  let h = K.bg(n) + K.brand(n, 'SKILLS · BUILD · SCALE');
  const scenes = [
    () => K.place(K.pill('ATENÇÃO', 'tag'), { x: 70, y: 300 }, n, s.start, 'left') + K.place(K.title('O Claude matou o Instagram?', ['instagram?'], 104), { x: 70, y: 390, w: 940 }, n, s.start + F(0.2), 'up') + K.place(K.appIcon('sparkle', 'Claude'), { x: 150, y: 820 }, n, s.start + F(0.6), 'scale') + K.place(K.appIcon('instagram', 'Instagram', { badge: 'RIP' }), { x: 690, y: 820 }, n, s.start + F(0.9), 'scale') + K.place(K.mascot(n), { center: true, y: 1230 }, n, s.start + F(1.1), 'up'),
    () => K.place(K.pill('/viral-hook-writer', 'cmd'), { center: true, y: 420 }, n, s.start, 'scale') + K.place(K.wave(n, { label: 'SUA VOZ' }), { center: true, y: 760 }, n, s.start + F(0.5), 'up'),
    // ...uma função por cena
  ];
  h += (scenes[s.index] || scenes[scenes.length - 1])();
  stage.innerHTML = h + K.caption(n);
}`,
    'minimal-dados': `Esqueleto (adapte o conteúdo; mantenha a estrutura):
function renderFrame(n) {
  const s = sceneAt(n);
  let h = K.bg(n);
  const scenes = [
    () => K.place(K.label('OS PRIMEIROS'), { center: true, y: 520, w: 900 }, n, s.start, 'fade') + K.place('<div class="k-title" style="font-size:150px;text-align:center">R$ 100 MIL</div>', { center: true, y: 590, w: 1000 }, n, s.start + F(0.2), 'up') + K.place(K.counter(n, s.start + F(0.6), s.end, 0, 9939, { label: 'GUARDADO', prefix: 'R$ ', size: 72 }), { center: true, y: 860 }),
    () => K.place(K.label('O COMEÇO PARECE LENTO'), { center: true, y: 360, w: 900 }, n, s.start, 'fade') + K.place(K.curve(n, s.start + F(0.4), s.end - F(0.3), { kind: 'exp', at: 0.12, label: 'VOCÊ ESTÁ AQUI' }), { x: 110, y: 640 }),
    () => K.place(K.label('QUEM CONTINUA'), { center: true, y: 300, w: 900 }, n, s.start, 'fade') + K.place(K.timeline(n, [{ label: 'HOJE', at: s.start + F(0.4) }, { label: '1 ANO', at: s.start + F(1.2) }, { label: '5 ANOS', at: s.start + F(2) }], { h: 760 }), { x: 200, y: 520 }),
    // ...uma função por cena
  ];
  h += (scenes[s.index] || scenes[scenes.length - 1])();
  stage.innerHTML = h + K.caption(n);
}`,
    'tech-analogia': `Esqueleto (adapte o conteúdo; mantenha a estrutura):
function renderFrame(n) {
  const s = sceneAt(n);
  const alerta = s.name.toLowerCase().includes('cuidado') || s.name.toLowerCase().includes('alerta');
  let h = K.bg(n, { alert: alerta }) + K.brand(n, 'Supabase · ficha técnica');
  const scenes = [
    () => K.place(K.typedTitle('Você tem a ideia de um app', ['ideia'], n, s.start, 92), { x: 70, y: 260, w: 940 }) + K.place(K.device(K.icon('bulb', 160, 'var(--acc)') + '<div style="width:70%;height:22px;border-radius:12px;background:var(--acc)"></div>', { w: 460, h: 760 }), { center: true, y: 640 }, n, s.start + F(0.6), 'up'),
    () => K.place(K.title('banco Postgres', ['postgres'], 88), { x: 70, y: 250, w: 940 }, n, s.start, 'up') + K.place(K.device('<div style="color:var(--acc2)">' + K.icon('database', 170) + '</div><div style="font-size:52px;font-weight:800">Postgres</div><div class="k-mono" style="color:var(--muted)">banco de verdade</div>', { w: 520, h: 700 }), { center: true, y: 420 }, n, s.start + F(0.3), 'scale') + K.place(K.chips(['Postgres', 'Login', 'Storage', 'Realtime', 'Edge Fn', 'API', 'pgvector', 'RLS'], 0), { center: true, y: 1200 }, n, s.start + F(0.8), 'up'),
    () => K.place(K.pill('⚠ CUIDADO', 'alert'), { center: true, y: 260 }, n, s.start, 'scale') + K.place(K.title('a chave pública fica no navegador', ['pública'], 80, { align: 'center' }), { center: true, y: 400, w: 960 }, n, s.start + F(0.3), 'up') + K.place(K.code(['const supabase = createClient(', "  'https://xyz.supabase.co',", "  'sb_publishable_...'", ')'], 2, n, s.start + F(0.6)), { center: true, y: 760 }, n, s.start + F(0.6), 'up'),
    // ...uma função por cena
  ];
  h += (scenes[s.index] || scenes[scenes.length - 1])();
  stage.innerHTML = h + K.caption(n);
}`,
  }
  return `${common}\n\n${LAYOUT[style]}\n\n${skeleton[style]}`
}

/** Zonas fixas do quadro 1080×1920 por modelo: evita texto sobreposto e o meio da tela vazio. */
const LAYOUT: Record<KitStyle, string> = {
  'tech-passos': `LAYOUT OBRIGATÓRIO (y em px; nada fora destas faixas, nada se sobrepondo):
- 40–330: cabeçalho FIXO igual em todas as cenas (K.steps em y 40, título da série em y 90 com no máximo 2 linhas de 64px, subtítulo mono em y 260).
- 350–430: rótulo do passo em mono à esquerda (x 70, ex.: "③ APIFY") e, se usar, K.badge à direita (x 610, w 400). O badge NUNCA fica na mesma faixa do nome do item.
- 460–700: nome do item grande e centralizado (K.title com align center, w 940, no máximo 84px e 2 linhas — nomes longos em 64–72px).
- 740–1460: o visual que explica o item, ocupando a largura (K.terminal / K.nodes / K.grid / K.code / K.card com w 900–940). Esta faixa NUNCA fica vazia.
- 1180–1460 (opcional, à esquerda, x 70): K.mascot pequeno, só se não cobrir o visual.
- 1540–1720: reservado para K.caption.`,
  'tech-news': `LAYOUT OBRIGATÓRIO (y em px; nada se sobrepondo):
- 60–140: K.brand (marca e etiqueta).
- 280–360: pílula (ATENÇÃO / NOVO / comando) à esquerda.
- 380–700: manchete (até 3 linhas de 96–104px, w 940).
- 760–1460: o visual da cena (apps em vidro lado a lado, K.wave, K.grid, card de comando, números em pílulas, K.mascot centralizado embaixo). Esta faixa NUNCA fica vazia.
- 1540–1720: reservado para K.caption.`,
  'minimal-dados': `LAYOUT OBRIGATÓRIO (y em px; muito respiro, nada se sobrepondo):
- 300–420: K.label (título pequeno espaçado, centralizado).
- 460–760: número ou frase principal grande (centralizado).
- 800–1460: o gráfico da cena (K.counter, K.curve com w 860 h 560, K.timeline com h 760). Esta faixa NUNCA fica vazia.
- 1580–1700: reservado para K.caption.`,
  'tech-analogia': `LAYOUT OBRIGATÓRIO (y em px; nada se sobrepondo):
- 60–140: K.brand (marca e etiqueta "TEMA · ficha técnica").
- 230–520: manchete (K.typedTitle ou K.title, até 3 linhas de 80–92px, w 940).
- 560–1460: o visual (K.device centralizado com h 600–760, comparação "X = Y" em dois cards, K.code, e K.chips na parte de baixo desta faixa). Esta faixa NUNCA fica vazia.
- 1540–1720: reservado para K.caption.`,
}

/**
 * Cena de reserva no visual do modelo: quando a IA não entrega uma cena válida, o vídeo sai mesmo
 * assim — fundo do modelo, nome de cada cena como manchete, ícone e legenda karaokê.
 */
export function kitFallback(style: KitStyle, input: { title: string; scenes: Composition['scenes']; words: WordTime[]; fps: number; seconds: number }): Composition {
  const json = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c')
  const icons = ['bolt', 'code', 'globe', 'database', 'rocket', 'chart', 'check', 'star']
  const js = `
const TITLE = ${json(input.title || '')};
const ICONS_F = ${json(icons)};
function renderFrame(n) {
  const s = sceneAt(n);
  let h = K.bg(n) + (KIT === 'tech-passos' ? K.steps(s.index, SCENES.length) : KIT === 'minimal-dados' ? '' : K.brand(n, TITLE.slice(0, 28)));
  if (KIT === 'minimal-dados') {
    h += K.place(K.label(TITLE.slice(0, 40)), { center: true, y: 420, w: 940 }, n, 0, 'fade');
    h += K.place('<div class="k-title" style="font-size:110px;text-align:center">' + esc(s.name) + '</div>', { center: true, y: 640, w: 980 }, n, s.start, 'up');
    h += K.place(K.curve(n, s.start, s.end, { kind: 'exp', w: 760, h: 420 }), { center: true, y: 980 });
  } else {
    h += K.place(K.title(s.name, [s.name.split(' ').slice(-1)[0]], 96, { align: 'center' }), { center: true, y: 520, w: 960 }, n, s.start, 'up');
    h += K.place('<div style="color:var(--acc)">' + K.icon(ICONS_F[s.index % ICONS_F.length], 260) + '</div>', { center: true, y: 900 }, n, s.start + F(0.4), 'scale');
  }
  stage.innerHTML = h + K.caption(n);
}
`
  const sfx = [
    { frame: 0, type: 'impact' as const },
    ...input.scenes.slice(1).map(s => ({ frame: Math.round(s.start * input.fps), type: 'whoosh' as const, vol: 0.1 })),
    { frame: Math.max(1, Math.round((input.seconds - 1.2) * input.fps)), type: 'shimmer' as const },
  ]
  return { title: input.title, scenes: input.scenes, css: '', html: '', js, sfx, kit: style }
}
