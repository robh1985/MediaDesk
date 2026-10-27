// In-browser previews of Office documents, used when LibreOffice isn't installed on the server
// (and always for spreadsheets). The libraries run in office-worker.js; their HTML is shown in a
// sandboxed frame with scripts and remote loading disabled. PowerPoint slides are laid out here
// from the slide XML using only safe DOM building (no HTML strings from the file).

import { h, clear } from '../ui.js';

export function runOfficeWorker(kind, buffer, timeout = 90e3) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./office-worker.js', import.meta.url));
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('The document took too long to open')); }, timeout);
    worker.onmessage = (e) => { clearTimeout(timer); worker.terminate(); if (e.data.error) reject(new Error(e.data.error)); else resolve(e.data); };
    worker.onerror = (e) => { clearTimeout(timer); worker.terminate(); reject(new Error(e.message || 'Could not read the document')); };
    worker.postMessage({ kind, buffer }, [buffer]);
  });
}

const FRAME_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:";
function frame(body, css) {
  return h('iframe', {
    class: 'office-frame', sandbox: '', referrerpolicy: 'no-referrer',
    srcdoc: `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}"><base target="_blank"><style>${css}</style></head><body>${body}</body></html>`,
  });
}

const DOC_CSS = `
html { background: #e9ebef; }
body { box-sizing: border-box; max-width: 816px; min-height: 1056px; margin: 24px auto; padding: 72px 80px; background: #fff; color: #111;
  font: 11pt/1.45 Calibri, Carlito, "Segoe UI", Arial, sans-serif; box-shadow: 0 2px 12px rgba(0,0,0,.18); overflow-wrap: anywhere; }
@media (max-width: 700px) { body { margin: 0; padding: 24px 18px; min-height: 0; box-shadow: none; } }
h1, h2, h3, h4 { font-family: "Calibri Light", Carlito, "Segoe UI", Arial, sans-serif; color: #1f3864; line-height: 1.2; }
h1 { font-size: 20pt; } h2 { font-size: 16pt; } h3 { font-size: 13pt; }
p { margin: 0 0 8pt; } img { max-width: 100%; height: auto; }
table { border-collapse: collapse; margin: 8pt 0; } td, th { border: 1px solid #999; padding: 3pt 6pt; vertical-align: top; }
a { color: #0563c1; }
h1.doc-title { font-size: 26pt; color: #17365d; border-bottom: 1px solid #4f81bd; padding-bottom: 4pt; }
.doc-subtitle { font-size: 13pt; color: #4f81bd; font-style: italic; }
blockquote { margin: 8pt 24pt; font-style: italic; color: #444; }`;

const SHEET_CSS = `
html, body { margin: 0; background: #fff; color: #111; font: 13px/1.35 Calibri, Carlito, "Segoe UI", Arial, sans-serif; }
table { border-collapse: collapse; }
td, th { border: 1px solid #d4d7dc; padding: 2px 6px; white-space: nowrap; max-width: 420px; overflow: hidden; text-overflow: ellipsis; height: 20px; }
tr:first-child td { background: #f3f5f7; font-weight: 600; position: sticky; top: 0; }
td[t="n"], td[data-t="n"] { text-align: right; }`;

export async function showDocx(container, buffer) {
  const { html } = await runOfficeWorker('docx', buffer);
  clear(container, frame(html || '<p><em>This document is empty.</em></p>', DOC_CSS));
}

export async function showSheet(container, buffer) {
  const { sheets } = await runOfficeWorker('sheet', buffer);
  const view = h('div', { class: 'office-sheet-view' });
  const tabs = h('div', { class: 'office-tabs' });
  const show = (i) => {
    const s = sheets[i];
    tabs.querySelectorAll('button').forEach((b, j) => b.classList.toggle('active', i === j));
    clear(view, frame(s.html || '<p style="padding:12px;color:#666">This sheet is empty.</p>', SHEET_CSS),
      s.truncated ? h('div', { class: 'office-note small' }, 'Showing the first 3,000 rows and 120 columns. Download the file to see everything.') : null);
  };
  sheets.forEach((s, i) => tabs.append(h('button', { class: 'office-tab', onclick: () => show(i) }, s.name)));
  clear(container, h('div', { class: 'office-sheet' }, view, sheets.length > 1 ? tabs : null));
  if (sheets.length) show(0); else clear(view, h('div', { class: 'empty' }, 'No sheets in this workbook'));
}

// ---------------------------------------------------------------------------
// PowerPoint
// ---------------------------------------------------------------------------

const EMU_PER_IN = 914400;
const SLIDE_W = 960;                                  // slides are laid out at this width, then scaled

const kids = (el, name) => (el ? [...el.children].filter((c) => c.localName === name) : []);
const kid = (el, name) => kids(el, name)[0] || null;
const path1 = (el, ...names) => names.reduce((e, n) => kid(e, n), el);
const attr = (el, name) => (el ? el.getAttribute(name) : null);
const relAttr = (el, name) => (el ? el.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', name) : null);
const HEX = /^[0-9a-f]{6}$/i;

function resolvePath(base, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const seg of target.split('/')) { if (seg === '..') parts.pop(); else if (seg !== '.') parts.push(seg); }
  return parts.join('/');
}

function hexToHsl(hex) {
  const r = parseInt(hex.slice(0, 2), 16) / 255, g = parseInt(hex.slice(2, 4), 16) / 255, b = parseInt(hex.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const hh = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [hh / 6, s, l];
}
function hslToHex([hh, s, l]) {
  const f = (n) => { const k = (n + hh * 12) % 12; const a = s * Math.min(l, 1 - l); return Math.round((l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255).toString(16).padStart(2, '0'); };
  return `${f(0)}${f(8)}${f(4)}`;
}

class Deck {
  constructor(xml, media) {
    this.xml = xml;
    this.media = media;
    this.docs = new Map();
    const pres = this.doc('ppt/presentation.xml');
    if (!pres) throw new Error('This is not a PowerPoint file');
    const sz = path1(pres.documentElement, 'sldSz');
    this.cx = Number(attr(sz, 'cx')) || 9144000;
    this.cy = Number(attr(sz, 'cy')) || 6858000;
    this.scale = SLIDE_W / (this.cx / EMU_PER_IN);                 // px per inch
    const rels = this.rels('ppt/presentation.xml');
    this.slides = kids(path1(pres.documentElement, 'sldIdLst'), 'sldId').map((s) => rels[relAttr(s, 'id')]).filter(Boolean);
    const themePath = Object.keys(xml).find((k) => /^ppt\/theme\/theme\d+\.xml$/.test(k));
    this.colors = {};
    const scheme = themePath && path1(this.doc(themePath).documentElement, 'themeElements', 'clrScheme');
    for (const c of scheme ? [...scheme.children] : []) {
      const v = attr(kid(c, 'srgbClr'), 'val') || attr(kid(c, 'sysClr'), 'lastClr');
      if (v) this.colors[c.localName] = v;
    }
    Object.assign(this.colors, { tx1: this.colors.dk1, bg1: this.colors.lt1, tx2: this.colors.dk2, bg2: this.colors.lt2 });
  }

  doc(p) {
    if (!this.docs.has(p)) this.docs.set(p, this.xml[p] ? new DOMParser().parseFromString(this.xml[p], 'application/xml') : null);
    return this.docs.get(p);
  }
  rels(p) {
    const dir = p.split('/').slice(0, -1).join('/');
    const d = this.doc(`${dir}/_rels/${p.split('/').pop()}.rels`);
    const out = {};
    for (const r of d ? [...d.documentElement.children] : []) out[attr(r, 'Id')] = resolvePath(p, attr(r, 'Target'));
    return out;
  }

  color(fillParent) {
    if (!fillParent) return null;
    const c = kid(fillParent, 'srgbClr') || kid(fillParent, 'schemeClr') || kid(fillParent, 'sysClr') || kid(fillParent, 'prstClr');
    if (!c) return null;
    let hex = c.localName === 'srgbClr' ? attr(c, 'val') : c.localName === 'schemeClr' ? this.colors[attr(c, 'val')] : c.localName === 'sysClr' ? attr(c, 'lastClr') : ({ black: '000000', white: 'ffffff', red: 'ff0000', blue: '0000ff', green: '008000' })[attr(c, 'val')];
    if (!hex || !HEX.test(hex)) return null;
    const mod = (n) => Number(attr(kid(c, n), 'val')) / 100000;
    if (kid(c, 'lumMod') || kid(c, 'lumOff')) {
      const hsl = hexToHsl(hex);
      hsl[2] = Math.max(0, Math.min(1, hsl[2] * (kid(c, 'lumMod') ? mod('lumMod') : 1) + (kid(c, 'lumOff') ? mod('lumOff') : 0)));
      hex = hslToHex(hsl);
    }
    const alpha = kid(c, 'alpha') ? mod('alpha') : 1;
    return alpha < 1 ? `rgba(${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)}, ${alpha.toFixed(2)})` : `#${hex}`;
  }

  image(base, rid) {
    const target = this.rels(base)[rid];
    const b64 = target && this.media[target];
    if (!b64) return null;
    const ext = target.split('.').pop().toLowerCase();
    const mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml' }[ext];
    return mime ? `data:${mime};base64,${b64}` : null;
  }

  // Placeholder positions by type/index from a layout or master.
  placeholders(p) {
    const out = {};
    const tree = p && path1(this.doc(p)?.documentElement, 'cSld', 'spTree');
    for (const sp of tree ? kids(tree, 'sp') : []) {
      const ph = path1(sp, 'nvSpPr', 'nvPr', 'ph');
      const xfrm = path1(sp, 'spPr', 'xfrm');
      if (!ph || !xfrm) continue;
      const type = attr(ph, 'type') || 'body';
      out[`type:${type}`] = out[`type:${type}`] || xfrm;
      if (attr(ph, 'idx')) out[`idx:${attr(ph, 'idx')}`] = xfrm;
    }
    return out;
  }

  background(p) {
    const bg = path1(this.doc(p)?.documentElement, 'cSld', 'bg');
    const pr = kid(bg, 'bgPr');
    if (pr) {
      const blip = path1(pr, 'blipFill', 'blip');
      if (blip) { const src = this.image(p, relAttr(blip, 'embed')); if (src) return { image: src }; }
      const solid = kid(pr, 'solidFill');
      if (solid) return { color: this.color(solid) };
      const grad = path1(pr, 'gradFill', 'gsLst');
      if (grad) { const stops = kids(grad, 'gs').map((g) => this.color(g)).filter(Boolean); if (stops.length) return { gradient: stops }; }
    }
    const ref = kid(bg, 'bgRef');
    if (ref) return { color: this.color(ref) };
    return null;
  }

  render(index) {
    const slidePath = this.slides[index];
    const rels = this.rels(slidePath);
    const layout = Object.values(rels).find((t) => /slideLayouts\//.test(t));
    const master = layout && Object.values(this.rels(layout)).find((t) => /slideMasters\//.test(t));
    const ph = { ...this.placeholders(master), ...this.placeholders(layout) };
    const el = h('div', { class: 'pptx-slide' });
    el.style.width = `${SLIDE_W}px`;
    el.style.height = `${SLIDE_W * (this.cy / this.cx)}px`;
    const bg = this.background(slidePath) || (layout && this.background(layout)) || (master && this.background(master)) || { color: '#ffffff' };
    if (bg.image) { el.style.backgroundImage = `url("${bg.image}")`; el.style.backgroundSize = 'cover'; }
    else if (bg.gradient) el.style.background = `linear-gradient(${bg.gradient.join(', ')})`;
    else el.style.background = bg.color || '#ffffff';

    const slideRoot = this.doc(slidePath).documentElement;
    const showMaster = attr(slideRoot, 'showMasterSp') !== '0';
    // Decorations from the master and layout (not their placeholders), then the slide itself.
    if (showMaster && master) this.tree(el, master, path1(this.doc(master).documentElement, 'cSld', 'spTree'), null, {}, true);
    if (showMaster && layout) this.tree(el, layout, path1(this.doc(layout).documentElement, 'cSld', 'spTree'), null, {}, true);
    this.tree(el, slidePath, path1(slideRoot, 'cSld', 'spTree'), null, ph, false);
    return el;
  }

  // Draw a shape tree. `map` converts child coordinates for groups.
  tree(el, base, tree, map, ph, decorationsOnly) {
    for (const node of tree ? [...tree.children] : []) {
      const isPh = Boolean(path1(node, 'nvSpPr', 'nvPr', 'ph') || path1(node, 'nvPicPr', 'nvPr', 'ph'));
      if (decorationsOnly && isPh) continue;
      if (node.localName === 'grpSp') {
        const x = path1(node, 'grpSpPr', 'xfrm');
        if (!x) continue;
        const off = kid(x, 'off'), ext = kid(x, 'ext'), chOff = kid(x, 'chOff'), chExt = kid(x, 'chExt');
        const n = (e, a) => Number(attr(e, a)) || 0;
        const sx = n(chExt, 'cx') ? n(ext, 'cx') / n(chExt, 'cx') : 1, sy = n(chExt, 'cy') ? n(ext, 'cy') / n(chExt, 'cy') : 1;
        const inner = (b) => ({ x: n(off, 'x') + (b.x - n(chOff, 'x')) * sx, y: n(off, 'y') + (b.y - n(chOff, 'y')) * sy, w: b.w * sx, h: b.h * sy });
        this.tree(el, base, node, map ? (b) => map(inner(b)) : inner, ph, decorationsOnly);
      } else if (node.localName === 'sp' || node.localName === 'cxnSp') this.shape(el, base, node, map, ph);
      else if (node.localName === 'pic') this.picture(el, base, node, map);
      else if (node.localName === 'graphicFrame') this.table(el, base, node, map);
    }
  }

  box(xfrm, map) {
    if (!xfrm) return null;
    const off = kid(xfrm, 'off'), ext = kid(xfrm, 'ext');
    let b = { x: Number(attr(off, 'x')) || 0, y: Number(attr(off, 'y')) || 0, w: Number(attr(ext, 'cx')) || 0, h: Number(attr(ext, 'cy')) || 0 };
    if (map) b = map(b);
    return { ...b, rot: (Number(attr(xfrm, 'rot')) || 0) / 60000, flipH: attr(xfrm, 'flipH') === '1', flipV: attr(xfrm, 'flipV') === '1' };
  }
  place(div, b) {
    const px = (emu) => (emu / EMU_PER_IN) * this.scale;
    Object.assign(div.style, { left: `${px(b.x)}px`, top: `${px(b.y)}px`, width: `${px(b.w)}px`, height: `${px(b.h)}px` });
    const t = [b.rot ? `rotate(${b.rot}deg)` : '', b.flipH ? 'scaleX(-1)' : '', b.flipV ? 'scaleY(-1)' : ''].join(' ').trim();
    if (t) div.style.transform = t;
  }

  shape(el, base, sp, map, ph) {
    const spPr = kid(sp, 'spPr');
    const phEl = path1(sp, 'nvSpPr', 'nvPr', 'ph');
    let xfrm = kid(spPr, 'xfrm');
    if (!xfrm && phEl) xfrm = ph[`idx:${attr(phEl, 'idx')}`] || ph[`type:${attr(phEl, 'type') || 'body'}`];
    const b = this.box(xfrm, map);
    if (!b) return;
    const div = h('div', { class: 'pptx-shape' });
    this.place(div, b);
    const fill = kid(spPr, 'solidFill');
    if (fill) div.style.background = this.color(fill) || '';
    const grad = path1(spPr, 'gradFill', 'gsLst');
    if (grad) { const stops = kids(grad, 'gs').map((g) => this.color(g)).filter(Boolean); if (stops.length > 1) div.style.background = `linear-gradient(${stops.join(', ')})`; }
    const ln = kid(spPr, 'ln');
    if (ln && !kid(ln, 'noFill')) {
      const c = this.color(kid(ln, 'solidFill'));
      if (c) div.style.border = `${Math.max(1, ((Number(attr(ln, 'w')) || 12700) / EMU_PER_IN) * this.scale)}px solid ${c}`;
    }
    const geom = attr(kid(spPr, 'prstGeom'), 'prst');
    if (geom === 'ellipse') div.style.borderRadius = '50%';
    else if (geom === 'roundRect') div.style.borderRadius = '10px';
    if (sp.localName === 'cxnSp' || geom === 'line') { div.style.border = ''; div.style.borderTop = `${Math.max(1, ((Number(attr(ln, 'w')) || 12700) / EMU_PER_IN) * this.scale)}px solid ${this.color(kid(ln, 'solidFill')) || '#000'}`; div.style.height = '0'; }
    const phType = attr(phEl, 'type');
    const defaultSize = phType === 'title' || phType === 'ctrTitle' ? 40 : phType === 'subTitle' ? 24 : phEl ? 22 : 18;
    const body = kid(sp, 'txBody');
    if (body) div.append(this.text(body, defaultSize, phType));
    el.append(div);
  }

  text(body, defaultSize, phType) {
    const bodyPr = kid(body, 'bodyPr');
    const anchor = attr(bodyPr, 'anchor') || (phType === 'title' || phType === 'ctrTitle' ? 'ctr' : 't');
    const ins = (a, d) => ((Number(attr(bodyPr, a) ?? d)) / EMU_PER_IN) * this.scale;
    const box = h('div', { class: 'pptx-text' });
    Object.assign(box.style, {
      justifyContent: anchor === 'ctr' ? 'center' : anchor === 'b' ? 'flex-end' : 'flex-start',
      padding: `${ins('tIns', 45720)}px ${ins('rIns', 91440)}px ${ins('bIns', 45720)}px ${ins('lIns', 91440)}px`,
    });
    if (attr(bodyPr, 'wrap') === 'none') box.style.whiteSpace = 'nowrap';
    const pt = (n) => `${(n / 72) * this.scale}px`;
    for (const p of kids(body, 'p')) {
      const pPr = kid(p, 'pPr');
      const para = h('div', { class: 'pptx-p' });
      const algn = attr(pPr, 'algn');
      para.style.textAlign = algn === 'ctr' ? 'center' : algn === 'r' ? 'right' : algn === 'just' ? 'justify' : (phType === 'ctrTitle' || phType === 'subTitle' ? 'center' : 'left');
      const lvl = Number(attr(pPr, 'lvl')) || 0;
      const marL = Number(attr(pPr, 'marL'));
      if (marL || lvl) para.style.paddingLeft = `${((marL || lvl * 342900) / EMU_PER_IN) * this.scale}px`;
      const bu = attr(kid(pPr, 'buChar'), 'char');
      const endSize = Number(attr(kid(p, 'endParaRPr'), 'sz')) / 100;
      let size = defaultSize;
      if (bu && !kid(pPr, 'buNone')) para.append(h('span', { class: 'pptx-bullet' }, `${bu} `));
      else if (phType === 'body' && !kid(pPr, 'buNone') && kids(p, 'r').length) para.append(h('span', { class: 'pptx-bullet' }, '• '));
      for (const r of [...p.children]) {
        if (r.localName === 'br') { para.append(h('br')); continue; }
        if (r.localName !== 'r' && r.localName !== 'fld') continue;
        const rPr = kid(r, 'rPr');
        const span = h('span', {}, kid(r, 't')?.textContent || '');
        const sz = Number(attr(rPr, 'sz')) / 100;
        if (sz) size = sz;
        span.style.fontSize = pt(sz || defaultSize);
        if (attr(rPr, 'b') === '1') span.style.fontWeight = '700';
        if (attr(rPr, 'i') === '1') span.style.fontStyle = 'italic';
        if (attr(rPr, 'u') && attr(rPr, 'u') !== 'none') span.style.textDecoration = 'underline';
        const c = this.color(kid(rPr, 'solidFill'));
        if (c) span.style.color = c;
        const font = attr(kid(rPr, 'latin'), 'typeface');
        if (font && /^[\w\s-]+$/.test(font) && !font.startsWith('+')) span.style.fontFamily = `"${font}", Calibri, Carlito, Arial, sans-serif`;
        para.append(span);
      }
      para.style.fontSize = pt(size || endSize || defaultSize);
      if (!para.textContent) para.append(h('br'));
      box.append(para);
    }
    return box;
  }

  picture(el, base, pic, map) {
    const b = this.box(path1(pic, 'spPr', 'xfrm'), map);
    const blip = path1(pic, 'blipFill', 'blip');
    const src = blip && this.image(base, relAttr(blip, 'embed'));
    if (!b || !src) return;
    const img = h('img', { class: 'pptx-pic', src, alt: '' });
    this.place(img, b);
    el.append(img);
  }

  table(el, base, frameEl, map) {
    const tbl = path1(frameEl, 'graphic', 'graphicData', 'tbl');
    const b = this.box(kid(frameEl, 'xfrm'), map);
    if (!tbl || !b) return;
    const wrap = h('div', { class: 'pptx-shape' });
    this.place(wrap, b);
    const t = h('table', { class: 'pptx-table' });
    for (const tr of kids(tbl, 'tr')) {
      const row = h('tr');
      for (const tc of kids(tr, 'tc')) {
        if (attr(tc, 'hMerge') === '1' || attr(tc, 'vMerge') === '1') continue;
        const td = h('td', { colspan: attr(tc, 'gridSpan') || undefined, rowspan: attr(tc, 'rowSpan') || undefined });
        const fill = this.color(path1(tc, 'tcPr', 'solidFill'));
        if (fill) td.style.background = fill;
        const body = kid(tc, 'txBody');
        if (body) td.append(this.text(body, 14, null));
        row.append(td);
      }
      t.append(row);
    }
    wrap.append(t);
    el.append(wrap);
  }
}

export async function showPptx(container, buffer) {
  const { xml, media } = await runOfficeWorker('zip', buffer);
  const deck = new Deck(xml, media);
  if (!deck.slides.length) { clear(container, h('div', { class: 'empty' }, 'This presentation has no slides')); return; }
  const list = h('div', { class: 'pptx-list' });
  const items = deck.slides.map((_, i) => {
    const holder = h('div', { class: 'pptx-holder' });
    const item = h('div', { class: 'pptx-item' }, holder, h('div', { class: 'small muted pptx-num' }, `Slide ${i + 1}`));
    item.holder = holder;
    return item;
  });
  list.append(...items);
  const fitAll = () => {
    const w = Math.min(list.clientWidth - 32, 1200);
    const s = w / SLIDE_W;
    items.forEach((it) => {
      it.holder.style.width = `${w}px`;
      it.holder.style.height = `${w * (deck.cy / deck.cx)}px`;
      const slide = it.holder.firstChild;
      if (slide) slide.style.transform = `scale(${s})`;
    });
  };
  // Lay out slides as they come into view.
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const it = e.target;
      if (it.holder.firstChild) continue;
      const i = items.indexOf(it);
      try { it.holder.append(deck.render(i)); } catch (err) { it.holder.append(h('div', { class: 'empty' }, `Couldn’t draw this slide (${err.message})`)); }
      fitAll();
    }
  }, { root: list, rootMargin: '800px 0px' });
  items.forEach((it) => io.observe(it));
  const show = h('button', { class: 'btn btn-sm', onclick: () => slideshow(deck) }, 'Play slideshow');
  clear(container, h('div', { class: 'pptx' }, h('div', { class: 'pptx-bar' }, h('span', { class: 'small muted' }, `${deck.slides.length} slide${deck.slides.length === 1 ? '' : 's'}`), show), list));
  new ResizeObserver(fitAll).observe(list);
  fitAll();
}

function slideshow(deck) {
  let i = 0;
  const stage = h('div', { class: 'pptx-show-stage' });
  const overlay = h('div', { class: 'pptx-show', tabindex: '0' }, stage, h('div', { class: 'pptx-show-hint' }, 'Click or → for next · ← back · Esc to exit'));
  const draw = () => {
    const s = deck.render(i);
    const sc = Math.min(innerWidth / SLIDE_W, innerHeight / (SLIDE_W * (deck.cy / deck.cx)));
    s.style.transform = `scale(${sc})`;
    stage.style.width = `${SLIDE_W * sc}px`;
    stage.style.height = `${SLIDE_W * (deck.cy / deck.cx) * sc}px`;
    clear(stage, s);
  };
  const close = () => { overlay.remove(); removeEventListener('resize', draw); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); };
  const step = (d) => { const n = i + d; if (n < 0) return; if (n >= deck.slides.length) { close(); return; } i = n; draw(); };
  overlay.addEventListener('click', () => step(1));
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
    else if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); step(1); }
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); step(-1); }
  });
  addEventListener('resize', draw);
  document.body.append(overlay);
  overlay.requestFullscreen?.().catch(() => {});
  draw();
  overlay.focus();
}
