// Shared by Paint and Paint Pro: opening and saving pictures (shared folders or this device),
// flood fill, colours, image encoders (BMP), OpenRaster (.ora) zip files, menus and dialogs.

import { h, toast, toastError } from '../ui.js';
import { pickFile, fileUrl, filesEnabled, joinPath } from '../fileapi.js';

export const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp|ico|svg|avif|ora)$/i;

// ---- Colours ----

export function hexToRgba(hex, a = 255) {
  const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex || '');
  if (!m) return [0, 0, 0, a];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, m[2] ? parseInt(m[2], 16) : a];
}
export const rgbaToHex = ([r, g, b]) => `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
export const rgbaCss = ([r, g, b, a = 255]) => `rgba(${r}, ${g}, ${b}, ${Math.round((a / 255) * 1000) / 1000})`;

export function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let hh = 0;
  if (d) hh = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(hh * 60 + 360) % 360, max ? d / max : 0, max];
}
export function hsvToRgb(hh, s, v) {
  const c = v * s, x = c * (1 - Math.abs(((hh / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = hh < 60 ? [c, x, 0] : hh < 120 ? [x, c, 0] : hh < 180 ? [0, c, x] : hh < 240 ? [0, x, c] : hh < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let hh = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [hh * 60, s, l];
}
export function hslToRgb(hh, s, l) {
  if (!s) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => { t = ((t % 1) + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  const k = hh / 360;
  return [f(k + 1 / 3) * 255, f(k) * 255, f(k - 1 / 3) * 255];
}

// ---- Canvases ----

export function makeCanvas(w, hgt) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(hgt));
  return c;
}
export const ctx2d = (c) => c.getContext('2d', { willReadFrequently: true });
export function cloneCanvas(src) {
  const c = makeCanvas(src.width, src.height);
  ctx2d(c).drawImage(src, 0, 0);
  return c;
}

// Pixels matching the colour at (x, y) within `tolerance` (0–100): contiguous (flood) or
// everywhere (global). Returns a mask (1 = matched) the size of the image.
export function colorMask(img, x, y, tolerance = 0, contiguous = true) {
  const { width: w, height: hgt, data } = img;
  const mask = new Uint8Array(w * hgt);
  x = Math.floor(x); y = Math.floor(y);
  if (x < 0 || y < 0 || x >= w || y >= hgt) return mask;
  const i0 = (y * w + x) * 4;
  const t = data.slice(i0, i0 + 4);
  const tol = (tolerance / 100) ** 2 * 4 * 255 * 255;
  const near = (i) => {
    const dr = data[i] - t[0], dg = data[i + 1] - t[1], db = data[i + 2] - t[2], da = data[i + 3] - t[3];
    return dr * dr + dg * dg + db * db + da * da <= tol;
  };
  if (!contiguous) {
    for (let p = 0; p < w * hgt; p++) if (near(p * 4)) mask[p] = 1;
    return mask;
  }
  // Scanline fill.
  const stack = [[x, y]];
  while (stack.length) {
    let [cx, cy] = stack.pop();
    let p = cy * w + cx;
    while (cx >= 0 && !mask[p] && near(p * 4)) { cx--; p--; }
    cx++; p++;
    let up = false, down = false;
    while (cx < w && !mask[p] && near(p * 4)) {
      mask[p] = 1;
      if (cy > 0) { const q = p - w; if (!mask[q] && near(q * 4)) { if (!up) { stack.push([cx, cy - 1]); up = true; } } else up = false; }
      if (cy < hgt - 1) { const q = p + w; if (!mask[q] && near(q * 4)) { if (!down) { stack.push([cx, cy + 1]); down = true; } } else down = false; }
      cx++; p++;
    }
  }
  return mask;
}

// Paint `rgba` into the pixels of a mask.
export function fillMask(img, mask, [r, g, b, a = 255], blend = false) {
  const d = img.data;
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p]) continue;
    const i = p * 4;
    if (!blend || a === 255) { d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a; continue; }
    const sa = a / 255, da = d[i + 3] / 255, oa = sa + da * (1 - sa);
    if (!oa) continue;
    d[i] = (r * sa + d[i] * da * (1 - sa)) / oa; d[i + 1] = (g * sa + d[i + 1] * da * (1 - sa)) / oa; d[i + 2] = (b * sa + d[i + 2] * da * (1 - sa)) / oa; d[i + 3] = oa * 255;
  }
}

// ---- Files ----

// Ask where to open a picture from; resolves to { image (canvas), name, file: { root, path } | null } or null.
export function openPicture({ title = 'Open', accept = IMAGE_RE } = {}) {
  return new Promise((resolve) => {
    const fromDevice = () => {
      const input = h('input', { type: 'file', accept: 'image/*,.ora', style: { display: 'none' } });
      input.onchange = async () => {
        const f = input.files?.[0];
        input.remove();
        if (!f) return resolve(null);
        try { resolve({ ...(await decodePicture(f, f.name)), name: f.name, file: null }); } catch (err) { toastError(err, 'Couldn’t open that picture'); resolve(null); }
      };
      document.body.append(input);
      input.click();
    };
    if (!filesEnabled()) return fromDevice();
    choice(title, 'Where is the picture?', [['shared', 'Shared folders'], ['device', 'This device']]).then(async (v) => {
      if (v === 'device') return fromDevice();
      if (v !== 'shared') return resolve(null);
      const pick = await pickFile({ title, accept: (e) => accept.test(e.name) });
      if (!pick) return resolve(null);
      try {
        const r = await fetch(fileUrl(pick.root, pick.path), { credentials: 'same-origin' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        resolve({ ...(await decodePicture(await r.blob(), pick.name)), name: pick.name, file: { root: pick.root, path: pick.path } });
      } catch (err) { toastError(err, 'Couldn’t open that picture'); resolve(null); }
    });
  });
}

// A file or blob → { image: canvas, layers?: [...] } (OpenRaster files keep their layers).
export async function decodePicture(blob, name = '') {
  if (/\.ora$/i.test(name)) return readOra(blob);
  const bmp = await createImageBitmap(blob).catch(async () => {
    // Some formats (SVG) only load through an <img>.
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  });
  const c = makeCanvas(bmp.width || bmp.naturalWidth, bmp.height || bmp.naturalHeight);
  ctx2d(c).drawImage(bmp, 0, 0);
  return { image: c };
}

// Where to save: { root, path, dir, name } in the shared folders, or { device: true, name }.
export function chooseSaveTarget(title, name) {
  return new Promise((resolve) => {
    if (!filesEnabled()) return resolve({ device: true, name });
    choice(title, 'Save to:', [['shared', 'Shared folders'], ['device', 'Download to this device']]).then(async (v) => {
      if (v === 'device') return resolve({ device: true, name });
      if (v !== 'shared') return resolve(null);
      const pick = await pickFile({ mode: 'save', title, name });
      resolve(pick || null);
    });
  });
}

export async function writeFile(target, blob) {
  if (target.device) return downloadBlob(blob, target.name);
  const dir = target.dir ?? target.path.split('/').slice(0, -1).join('/');
  const qs = new URLSearchParams({ root: target.root, path: dir, name: target.name, overwrite: '1' });
  const r = await fetch(`/portal/files/upload?${qs}`, { method: 'POST', credentials: 'same-origin', headers: { 'X-MediaDesk': '1', 'Content-Type': 'application/octet-stream' }, body: blob });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
  return { root: target.root, path: joinPath(dir, target.name) };
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30e3);
  return null;
}

export const FORMATS = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', bmp: 'image/bmp' };
export const extOf = (name) => (/\.([a-z0-9]+)$/i.exec(name || '')?.[1] || '').toLowerCase();

// A flattened canvas → a file blob in the format the name asks for.
export function encodeCanvas(canvas, name, quality = 0.92) {
  const ext = extOf(name);
  if (ext === 'bmp') return Promise.resolve(encodeBmp(canvas));
  const type = FORMATS[ext] || 'image/png';
  let src = canvas;
  // JPEG has no transparency: put it on white, as image editors do.
  if (type === 'image/jpeg') {
    src = makeCanvas(canvas.width, canvas.height);
    const x = ctx2d(src);
    x.fillStyle = '#fff'; x.fillRect(0, 0, src.width, src.height); x.drawImage(canvas, 0, 0);
  }
  return new Promise((resolve, reject) => src.toBlob((b) => (b ? resolve(b) : reject(new Error('Couldn’t encode the picture'))), type, quality));
}

// 24-bit Windows bitmap (what MS Paint saves by default).
export function encodeBmp(canvas) {
  const { width: w, height: hgt } = canvas;
  const d = ctx2d(canvas).getImageData(0, 0, w, hgt).data;
  const row = Math.ceil((w * 3) / 4) * 4;
  const size = 54 + row * hgt;
  const buf = new ArrayBuffer(size), v = new DataView(buf), u8 = new Uint8Array(buf);
  u8[0] = 0x42; u8[1] = 0x4d;
  v.setUint32(2, size, true); v.setUint32(10, 54, true); v.setUint32(14, 40, true);
  v.setInt32(18, w, true); v.setInt32(22, hgt, true); v.setUint16(26, 1, true); v.setUint16(28, 24, true);
  v.setUint32(34, row * hgt, true); v.setInt32(38, 2835, true); v.setInt32(42, 2835, true);
  for (let y = 0; y < hgt; y++) {
    let o = 54 + (hgt - 1 - y) * row;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, a = d[i + 3] / 255;
      // Transparent areas become white.
      u8[o++] = Math.round(d[i + 2] * a + 255 * (1 - a)); u8[o++] = Math.round(d[i + 1] * a + 255 * (1 - a)); u8[o++] = Math.round(d[i] * a + 255 * (1 - a));
    }
  }
  return new Blob([buf], { type: 'image/bmp' });
}

// ---- OpenRaster (.ora): a zip of PNG layers with a stack.xml, Pinta's own format ----

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (u8) => { let c = 0xffffffff; for (const b of u8) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

// Stored (uncompressed) zip: PNGs are compressed already, and "mimetype" must be stored.
export function makeZip(files) {
  const enc = new TextEncoder();
  const parts = [], central = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nameB = enc.encode(name), crc = crc32(data);
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true); head.setUint16(4, 20, true); head.setUint16(8, 0, true);
    head.setUint32(14, crc, true); head.setUint32(18, data.length, true); head.setUint32(22, data.length, true); head.setUint16(26, nameB.length, true);
    parts.push(new Uint8Array(head.buffer), nameB, data);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true);
    cen.setUint32(16, crc, true); cen.setUint32(20, data.length, true); cen.setUint32(24, data.length, true); cen.setUint16(28, nameB.length, true); cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), nameB);
    offset += 30 + nameB.length + data.length;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}

export async function readZip(blob) {
  const u8 = new Uint8Array(await blob.arrayBuffer());
  const v = new DataView(u8.buffer);
  let e = u8.length - 22;
  while (e >= 0 && v.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('Not a zip file');
  const count = v.getUint16(e + 10, true);
  let p = v.getUint32(e + 16, true);
  const out = new Map();
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    const method = v.getUint16(p + 10, true), csize = v.getUint32(p + 20, true);
    const nlen = v.getUint16(p + 28, true), xlen = v.getUint16(p + 30, true), clen = v.getUint16(p + 32, true), local = v.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const raw = u8.subarray(start, start + csize);
    out.set(name, method === 0 ? raw : method === 8 ? new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()) : null);
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

export async function readOra(blob) {
  const files = await readZip(blob);
  const xml = new DOMParser().parseFromString(new TextDecoder().decode(files.get('stack.xml')), 'application/xml');
  const imgEl = xml.querySelector('image');
  const w = Number(imgEl.getAttribute('w')), hgt = Number(imgEl.getAttribute('h'));
  const layers = [];
  // stack.xml lists layers top first.
  for (const el of [...xml.querySelectorAll('stack > layer')].reverse()) {
    const data = files.get(el.getAttribute('src'));
    const c = makeCanvas(w, hgt);
    if (data) ctx2d(c).drawImage(await createImageBitmap(new Blob([data], { type: 'image/png' })), Number(el.getAttribute('x') || 0), Number(el.getAttribute('y') || 0));
    const op = (el.getAttribute('composite-op') || 'svg:src-over').replace(/^(svg|pinta):/, '');
    layers.push({ canvas: c, name: el.getAttribute('name') || 'Layer', opacity: Number(el.getAttribute('opacity') ?? 1), visible: el.getAttribute('visibility') !== 'hidden', blend: ORA_TO_BLEND[op] || 'normal' });
  }
  const merged = makeCanvas(w, hgt);
  for (const l of layers) if (l.visible) { const x = ctx2d(merged); x.globalAlpha = l.opacity; x.drawImage(l.canvas, 0, 0); }
  return { image: merged, layers };
}
const BLEND_TO_ORA = { normal: 'src-over', multiply: 'multiply', screen: 'screen', overlay: 'overlay', darken: 'darken', lighten: 'lighten', 'color-dodge': 'color-dodge', 'color-burn': 'color-burn', 'hard-light': 'hard-light', 'soft-light': 'soft-light', difference: 'difference', exclusion: 'exclusion', hue: 'hue', saturation: 'saturation', color: 'color', luminosity: 'luminosity', lighter: 'plus', xor: 'xor' };
const ORA_TO_BLEND = Object.fromEntries(Object.entries(BLEND_TO_ORA).map(([k, v]) => [v, k]));

export async function writeOra(layers, w, hgt, merged) {
  const png = (c) => new Promise((r) => c.toBlob(async (b) => r(new Uint8Array(await b.arrayBuffer())), 'image/png'));
  const esc = (s) => String(s).replace(/[<>&"]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));
  const files = [['mimetype', new TextEncoder().encode('image/openraster')]];
  const entries = [];
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i];
    files.push([`data/layer${i}.png`, await png(l.canvas)]);
    entries.unshift(`<layer name="${esc(l.name)}" src="data/layer${i}.png" x="0" y="0" opacity="${l.opacity}" visibility="${l.visible ? 'visible' : 'hidden'}" composite-op="svg:${BLEND_TO_ORA[l.blend] || 'src-over'}"/>`);
  }
  files.push(['stack.xml', new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>\n<image version="0.0.3" w="${w}" h="${hgt}">\n<stack>\n${entries.join('\n')}\n</stack>\n</image>\n`)]);
  files.push(['mergedimage.png', await png(merged)]);
  const t = makeCanvas(Math.min(256, w), Math.min(256, hgt));
  const s = Math.min(t.width / w, t.height / hgt);
  const thumb = makeCanvas(Math.max(1, Math.round(w * s)), Math.max(1, Math.round(hgt * s)));
  ctx2d(thumb).drawImage(merged, 0, 0, thumb.width, thumb.height);
  files.push(['Thumbnails/thumbnail.png', await png(thumb)]);
  return makeZip(files);
}

// ---- Menus and dialogs ----

// defs: [{ label, items: [{ label, shortcut, action, disabled: () => bool, checked: () => bool } | '-'] }]
export function menuBar(defs, cls = '') {
  const bar = h('div', { class: `pm-bar ${cls}`, role: 'menubar' });
  let open = null;
  const close = () => { open?.menu.remove(); open?.btn.classList.remove('open'); open = null; removeEventListener('pointerdown', outside, true); };
  const outside = (e) => { if (!e.target.closest('.pm-menu') && !e.target.closest('.pm-top')) close(); };
  const show = (btn, def) => {
    close();
    const menu = h('div', { class: `pm-menu ${cls}`, role: 'menu' }, def.items.filter(Boolean).map((it) => {
      if (it === '-') return h('div', { class: 'pm-sep' });
      const dis = it.disabled?.();
      return h('button', { class: `pm-item ${it.checked?.() ? 'checked' : ''}`, disabled: dis, role: 'menuitem', onclick: () => { close(); it.action?.(); } },
        h('span', { class: 'pm-check' }, it.checked?.() ? '✓' : ''), h('span', { class: 'pm-label' }, it.label), h('span', { class: 'pm-key' }, it.shortcut || ''));
    }));
    const r = btn.getBoundingClientRect();
    Object.assign(menu.style, { left: `${r.left}px`, top: `${r.bottom}px` });
    document.body.append(menu);
    const mr = menu.getBoundingClientRect();
    if (mr.right > innerWidth - 4) menu.style.left = `${Math.max(4, innerWidth - mr.width - 4)}px`;
    if (mr.bottom > innerHeight - 4) { menu.style.maxHeight = `${innerHeight - r.bottom - 8}px`; menu.style.overflowY = 'auto'; }
    btn.classList.add('open');
    open = { btn, menu };
    addEventListener('pointerdown', outside, true);
  };
  for (const def of defs) {
    const btn = h('button', { class: 'pm-top', type: 'button' }, def.label);
    btn.onclick = () => (open?.btn === btn ? close() : show(btn, def));
    btn.onpointerenter = () => { if (open && open.btn !== btn) show(btn, def); };
    bar.append(btn);
  }
  bar.close = close;
  return bar;
}

// A modal dialog. buttons: [[label, value, primary?]]. onOk may throw to keep it open.
export function dialog(title, body, { buttons = [['Cancel', null], ['OK', true, true]], cls = '', onOk, onOpen } = {}) {
  return new Promise((resolve) => {
    const err = h('div', { class: 'pd-error' });
    const close = (v) => { overlay.remove(); removeEventListener('keydown', key, true); resolve(v); };
    const act = async (v) => {
      if (v !== null && v !== undefined && onOk) {
        try { const r = await onOk(v); if (r === false) return; close(r === undefined ? v : r); } catch (e) { err.textContent = e.message; }
      } else close(v);
    };
    const box = h('div', { class: `pd ${cls}`, role: 'dialog' },
      h('div', { class: 'pd-title' }, h('span', {}, title), h('button', { class: 'pd-x', type: 'button', 'aria-label': 'Close', onclick: () => close(null) }, '×')),
      h('div', { class: 'pd-body' }, body), err,
      h('div', { class: 'pd-buttons' }, buttons.map(([label, v, primary]) => h('button', { type: 'button', class: `pd-btn ${primary ? 'primary' : ''}`, onclick: () => act(v) }, label))));
    const overlay = h('div', { class: `pd-overlay ${cls}` }, box);
    const key = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(null); }
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); e.stopPropagation(); const p = buttons.find((b) => b[2]); if (p) act(p[1]); }
    };
    addEventListener('keydown', key, true);
    document.body.append(overlay);
    onOpen?.(box);
    (box.querySelector('input, select, textarea') || box.querySelector('.pd-btn.primary'))?.focus();
  });
}

export function choice(title, text, options) {
  return dialog(title, h('p', {}, text), { buttons: [['Cancel', null], ...options.map(([v, l], i) => [l, v, i === 0])] });
}

// A labelled number input with a slider, for effect and adjustment settings.
export function numberField(label, { min, max, step = 1, value, onInput }) {
  const num = h('input', { type: 'number', min, max, step, value, class: 'pd-num' });
  const slider = h('input', { type: 'range', min, max, step, value, class: 'pd-range' });
  const set = (v, from) => {
    v = Math.max(min, Math.min(max, Number(v)));
    if (Number.isNaN(v)) return;
    if (from !== num) num.value = String(v);
    if (from !== slider) slider.value = String(v);
    onInput?.(v);
  };
  num.oninput = () => set(num.value, num);
  slider.oninput = () => set(slider.value, slider);
  const el = h('label', { class: 'pd-field' }, h('span', {}, label), h('div', { class: 'pd-row' }, slider, num));
  el.value = () => Number(num.value);
  return el;
}

export const notify = (text) => toast(text, { timeout: 1800 });

