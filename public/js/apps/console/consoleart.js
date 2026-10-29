// Pictures of the consoles, for the background of a console's section: a photo (downloaded by
// the server from Wikimedia Commons the first time), your own picture, or — offline, or if you
// prefer — a drawing of the console in its colours.

import { SYSTEMS } from './systems.js';

// Body and detail colours for the drawings.
const LOOK = {
  nes: ['#c7c7cc', '#2b2b2e', '#c0272d'], snes: ['#d6d6db', '#8f8f99', '#6a5acd'], n64: ['#2a2a2e', '#1a1a1d', '#1f8a3b'],
  segaMD: ['#1d1d1f', '#0f0f10', '#d4202a'], segaMS: ['#1a1a1a', '#0e0e0e', '#d4202a'], segaCD: ['#1d1d1f', '#0f0f10', '#3a6ea5'], sega32x: ['#1d1d1f', '#0f0f10', '#c9302c'],
  segaSaturn: ['#2b2b33', '#18181d', '#3a3f8f'], dreamcast: ['#ececef', '#c8c8cd', '#e05a0b'], psx: ['#cbcbcf', '#9a9aa0', '#5b6b7f'], pce: ['#f2f2f2', '#c9c9c9', '#e8762d'],
  atari2600: ['#1e1e1e', '#6b4423', '#8a5a2b'], atari5200: ['#1c1c1c', '#0e0e0e', '#c0a060'], atari7800: ['#1f1f1f', '#0f0f0f', '#c0c0c0'], jaguar: ['#141414', '#0a0a0a', '#9b111e'],
  coleco: ['#1f1f1f', '#3a3a3a', '#b8b8b8'], '3do': ['#202020', '#111', '#c9a227'], vb: ['#1a1a1a', '#0d0d0d', '#b3001b'],
  gb: ['#c9c6b8', '#8b9a2d', '#a3195b'], gba: ['#4b3fa6', '#2e2670', '#d9d9e8'], nds: ['#5f6b7a', '#3c4552', '#d9dde3'], segaGG: ['#2b2b2b', '#151515', '#1f4fa0'],
  lynx: ['#3a3a3a', '#1f1f1f', '#d48a00'], psp: ['#1e1e24', '#0f0f13', '#9aa3b5'], ngp: ['#1d5fa8', '#123d6e', '#e6e6e6'], ws: ['#2e8b8b', '#1d5d5d', '#e8e8e8'],
};

const WIDE_HANDHELDS = new Set(['gba', 'segaGG', 'lynx', 'psp', 'ws', 'ngp']);

export function drawConsole(system) {
  const sys = SYSTEMS[system] || { color: '#555', kind: 'home' };
  const [body, dark, accent] = LOOK[system] || [mix(sys.color, '#000', 0.6), mix(sys.color, '#000', 0.8), sys.color];
  const top = mix(body, '#fff', 0.18);
  const defs = `<defs><linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${mix(body, '#000', 0.25)}"/></linearGradient>
    <radialGradient id="s" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#000" stop-opacity=".45"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient></defs>`;
  let art;
  if (sys.kind === 'arcade') art = arcade(accent);
  else if (sys.kind === 'handheld') art = system === 'nds' ? dsArt(body, dark, accent) : WIDE_HANDHELDS.has(system) ? wideHandheld(body, dark, accent) : tallHandheld(body, dark, accent);
  else art = homeConsole(body, dark, accent, Boolean(sys.disc));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500">${defs}<ellipse cx="400" cy="440" rx="330" ry="34" fill="url(#s)"/>${art}</svg>`;
}

function homeConsole(body, dark, accent, disc) {
  const pad = `<g transform="translate(520 352)">
    <path d="M150 40 C 210 30 250 60 268 80" stroke="${dark}" stroke-width="4" fill="none"/>
    <rect x="0" y="0" width="210" height="84" rx="38" fill="url(#b)" stroke="${dark}" stroke-width="2"/>
    <path d="M38 30h16v12h12v16H54v12H38V58H26V42h12z" fill="${dark}"/>
    <circle cx="158" cy="36" r="11" fill="${accent}"/><circle cx="182" cy="52" r="11" fill="${accent}"/>
    <rect x="92" y="50" width="22" height="7" rx="3.5" fill="${dark}"/></g>`;
  const slot = disc
    ? `<ellipse cx="380" cy="246" rx="128" ry="34" fill="${mix(body, '#000', 0.12)}" stroke="${dark}" stroke-width="2"/><ellipse cx="380" cy="246" rx="34" ry="9" fill="${dark}" opacity=".5"/>`
    : `<rect x="300" y="196" width="160" height="58" rx="6" fill="#4a4a4f" stroke="#2a2a2e" stroke-width="2"/><rect x="318" y="206" width="124" height="34" rx="3" fill="${accent}"/><rect x="290" y="240" width="180" height="16" rx="4" fill="${dark}"/>`;
  return `<path d="M120 250 Q120 228 142 228 H618 Q640 228 640 250 V372 Q640 392 620 392 H140 Q120 392 120 372z" fill="url(#b)" stroke="${dark}" stroke-width="2"/>
    <path d="M120 300 H640" stroke="${dark}" stroke-opacity=".35" stroke-width="2"/>
    ${slot}
    <rect x="150" y="320" width="54" height="18" rx="6" fill="${dark}"/><rect x="214" y="320" width="54" height="18" rx="6" fill="${dark}"/>
    <circle cx="590" cy="268" r="7" fill="${accent}"/>
    <rect x="150" y="352" width="34" height="22" rx="4" fill="${dark}" opacity=".85"/><rect x="194" y="352" width="34" height="22" rx="4" fill="${dark}" opacity=".85"/>
    <rect x="128" y="372" width="504" height="8" rx="4" fill="${accent}" opacity=".7"/>
    ${pad}`;
}

function tallHandheld(body, dark, accent) {
  return `<g transform="translate(270 40)">
    <path d="M0 24 Q0 0 24 0 H236 Q260 0 260 24 V360 Q260 400 200 400 H24 Q0 400 0 376z" fill="url(#b)" stroke="${dark}" stroke-width="2"/>
    <rect x="22" y="24" width="216" height="168" rx="12" fill="#5a5a66"/><rect x="52" y="44" width="156" height="128" fill="${dark}"/>
    <path d="M58 250h18v18h18v18H76v18H58v-18H40v-18h18z" fill="#2a2a2e"/>
    <circle cx="190" cy="262" r="17" fill="${accent}"/><circle cx="224" cy="242" r="17" fill="${accent}"/>
    <rect x="86" y="330" width="34" height="9" rx="4.5" fill="#777" transform="rotate(-25 103 334)"/><rect x="134" y="330" width="34" height="9" rx="4.5" fill="#777" transform="rotate(-25 151 334)"/>
    <g stroke="${mix(body, '#000', 0.3)}" stroke-width="5" stroke-linecap="round"><path d="M180 360l40-20M190 374l40-20M200 388l36-18"/></g></g>`;
}

function wideHandheld(body, dark, accent) {
  return `<g transform="translate(110 120)">
    <path d="M60 0 H520 Q580 0 580 70 V190 Q580 260 510 260 H70 Q0 260 0 190 V70 Q0 0 60 0z" fill="url(#b)" stroke="${dark}" stroke-width="2"/>
    <rect x="160" y="34" width="260" height="190" rx="14" fill="#2a2a30"/><rect x="180" y="52" width="220" height="154" fill="${dark}"/>
    <path d="M64 112h18v18h18v18H82v18H64v-18H46v-18h18z" fill="#2a2a2e"/>
    <circle cx="488" cy="132" r="17" fill="${accent}"/><circle cx="526" cy="112" r="17" fill="${accent}"/>
    <rect x="470" y="190" width="44" height="12" rx="6" fill="#2a2a2e"/></g>`;
}

function dsArt(body, dark, accent) {
  return `<g transform="translate(220 20)">
    <rect x="0" y="0" width="360" height="200" rx="22" fill="url(#b)" stroke="${dark}" stroke-width="2"/><rect x="80" y="22" width="200" height="156" rx="6" fill="#26262c"/>
    <rect x="0" y="212" width="360" height="200" rx="22" fill="url(#b)" stroke="${dark}" stroke-width="2"/><rect x="92" y="236" width="176" height="140" rx="4" fill="#26262c"/>
    <path d="M30 288h14v14h14v14H44v14H30v-14H16v-14h14z" fill="#2a2a2e"/>
    <circle cx="316" cy="290" r="11" fill="${accent}"/><circle cx="336" cy="310" r="11" fill="${accent}"/><circle cx="296" cy="310" r="11" fill="${accent}"/><circle cx="316" cy="330" r="11" fill="${accent}"/></g>`;
}

function arcade(accent) {
  return `<g transform="translate(280 10)">
    <path d="M20 0 H220 L240 120 L210 250 L250 290 V420 H-10 V290 L30 250 L0 120z" fill="#1d1d22" stroke="#000" stroke-width="2"/>
    <rect x="10" y="12" width="220" height="56" rx="6" fill="${accent}"/>
    <rect x="30" y="92" width="180" height="140" rx="8" fill="#0a0a0d"/><rect x="42" y="104" width="156" height="116" fill="#16324a"/>
    <path d="M30 250 H210 L250 290 H-10z" fill="#2c2c33"/>
    <circle cx="60" cy="270" r="9" fill="${accent}"/><path d="M60 270 V246" stroke="#ccc" stroke-width="5"/>
    <circle cx="130" cy="272" r="8" fill="#e8e8e8"/><circle cx="156" cy="268" r="8" fill="#e8e8e8"/><circle cx="182" cy="272" r="8" fill="#e8e8e8"/>
    <rect x="80" y="330" width="80" height="40" rx="4" fill="#0a0a0d"/><rect x="110" y="340" width="20" height="20" fill="${accent}"/></g>`;
}

function mix(a, b, t) {
  const p = (x) => [1, 3, 5].map((i) => parseInt(x.slice(i, i + 2), 16));
  if (!/^#[0-9a-f]{6}$/i.test(a) || !/^#[0-9a-f]{6}$/i.test(b)) return a;
  const [x, y] = [p(a), p(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

export const drawingUrl = (system) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(drawConsole(system))}`;

// The colour around a photo's edges, so it can fill the rest of the screen and the photo's own
// backdrop (usually white or grey) disappears into it.
function edgeColor(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = 48; c.height = 48;
        const x = c.getContext('2d', { willReadFrequently: true });
        x.drawImage(img, 0, 0, 48, 48);
        const px = [];
        for (let i = 0; i < 48; i += 4) px.push(...[[i, 0], [i, 47], [0, i], [47, i]]);
        const sum = [0, 0, 0];
        for (const [a, b] of px) { const d = x.getImageData(a, b, 1, 1).data; sum[0] += d[0]; sum[1] += d[1]; sum[2] += d[2]; }
        resolve(`rgb(${sum.map((v) => Math.round(v / px.length)).join(', ')})`);
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

// What to show behind a console's section, per its "background" setting:
//   auto: the photo, or the drawing when there isn't one; photo / drawn / custom / none.
// Resolves to { url, edge, credit, kind } or null. Remembered for the session.
const cache = new Map();
export function sectionBackground(system, cfg = {}) {
  const mode = cfg.background || 'auto';
  const key = `${system}:${mode}:${cfg.backgroundV || 0}`;
  if (cache.has(key)) return cache.get(key);
  const p = (async () => {
    if (mode === 'none') return null;
    if (mode === 'drawn') return { url: drawingUrl(system), kind: 'drawn' };
    if (mode === 'custom') {
      const url = `/portal/games/console-art/${system}?kind=custom&v=${cfg.backgroundV || 0}`;
      const edge = await edgeColor(url);
      return edge ? { url, edge, kind: 'custom' } : { url: drawingUrl(system), kind: 'drawn' };
    }
    try {
      const r = await (await fetch(`/portal/games/console-art/${system}/photo`, { credentials: 'same-origin' })).json();
      if (r.ok) {
        const url = `/portal/games/console-art/${system}?kind=photo&v=${r.v || 0}`;
        const edge = await edgeColor(url);
        if (edge) return { url, edge, kind: 'photo', credit: `Photo: ${r.credit}${r.license ? ` (${r.license})` : ''}, Wikimedia Commons` };
      }
    } catch { /* offline: drawing */ }
    return { url: drawingUrl(system), kind: 'drawn' };
  })();
  cache.set(key, p);
  return p;
}
export const peekBackground = (system, cfg = {}) => cache.get(`${system}:${cfg.background || 'auto'}:${cfg.backgroundV || 0}`);
export const forgetBackgrounds = () => cache.clear();
