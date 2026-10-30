// Paint: the classic Windows 98 Paint, after jspaint — the 16-tool box with its option panes,
// the 28-colour box (left click foreground, right click background), File / Edit / View /
// Image / Colors menus, floating selections, and drag handles to resize the picture.
// Pictures open from and save to the shared folders or this device.

import { h, clear, toast, toastError, confirmDialog } from '../ui.js';
import { appIcon } from '../icons.js';
import { useCustomWallpaper } from '../desktop.js';
import {
  makeCanvas, ctx2d, cloneCanvas, colorMask, fillMask, hexToRgba, rgbaToHex, openPicture, chooseSaveTarget, writeFile, encodeCanvas,
  menuBar, dialog, decodePicture, extOf,
} from './paint-common.js';

let cssLoaded = false;
const loadCss = () => {
  if (cssLoaded) return;
  cssLoaded = true;
  document.head.append(h('link', { rel: 'stylesheet', href: new URL('../../css/paint.css', import.meta.url).href }));
};

export const paintApp = {
  id: 'paint', name: 'Paint', icon: appIcon.paint, size: [900, 660], description: 'Classic Windows Paint',
  open(win, opts = {}) {
    loadCss();
    const p = new Paint(win);
    if (opts.root != null && opts.path) p.openShared(Number(opts.root), opts.path);
    win.on('reopen', (o) => { if (o?.root != null && o.path) p.openShared(Number(o.root), o.path); });
    win.on('close', () => p.destroy());
  },
};

// The Windows 98 palette.
const PALETTE = [
  '#000000', '#808080', '#800000', '#808000', '#008000', '#008080', '#000080', '#800080', '#808040', '#004040', '#0080ff', '#004080', '#8000ff', '#804000',
  '#ffffff', '#c0c0c0', '#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff', '#ffff80', '#00ff80', '#80ffff', '#8080ff', '#ff0080', '#ff8040',
];

// Tool icons, drawn on a 16 × 16 grid like the originals.
const ic = (d) => `<svg viewBox="0 0 16 16" shape-rendering="crispEdges">${d}</svg>`;
const TOOLS = [
  { id: 'freeselect', name: 'Free-Form Select', help: 'Selects a free-form part of the picture to move, copy, or edit.', icon: ic('<path d="M3 4c3-3 9-2 10 1s-3 5-6 5-4 2-2 4" fill="none" stroke="#000" stroke-dasharray="2 1"/>') },
  { id: 'select', name: 'Select', help: 'Selects a rectangular part of the picture to move, copy, or edit.', icon: ic('<rect x="2.5" y="3.5" width="11" height="9" fill="none" stroke="#000" stroke-dasharray="2 1"/>') },
  { id: 'eraser', name: 'Eraser/Color Eraser', help: 'Erases a portion of the picture, using the selected eraser shape. Right-drag replaces only the foreground colour.', icon: ic('<path d="M3 10l5-6h5l-5 6z" fill="#fff" stroke="#000"/><path d="M3 10h5v3H3z" fill="#ff8" stroke="#000"/>') },
  { id: 'fill', name: 'Fill With Color', help: 'Fills an area with the current drawing color.', icon: ic('<path d="M3 8l5-5 5 5-5 5z" fill="#ccc" stroke="#000"/><path d="M12 9c1 2 2 3 1 4s-2-1-1-4" fill="#00f"/>') },
  { id: 'picker', name: 'Pick Color', help: 'Picks up a color from the picture for drawing.', icon: ic('<path d="M3 13l6-6 2 2-6 6H3z" fill="#fff" stroke="#000"/><path d="M10 4l2-2 2 2-2 2z" fill="#000"/>') },
  { id: 'magnifier', name: 'Magnifier', help: 'Changes the magnification.', icon: ic('<circle cx="6.5" cy="6.5" r="4" fill="#cef" stroke="#000"/><path d="M9.5 9.5l4 4" stroke="#000" stroke-width="2"/>') },
  { id: 'pencil', name: 'Pencil', help: 'Draws a free-form line one pixel wide.', icon: ic('<path d="M3 13l1-3 7-7 2 2-7 7z" fill="#fc6" stroke="#000"/><path d="M3 13l1-3 2 2z" fill="#000"/>') },
  { id: 'brush', name: 'Brush', help: 'Draws using a brush with the selected shape and size.', icon: ic('<path d="M10 2l3 3-5 5-2-2z" fill="#a52" stroke="#000"/><path d="M6 8l2 2c-1 3-3 4-5 4 0-2 1-4 3-6z" fill="#00c"/>') },
  { id: 'airbrush', name: 'Airbrush', help: 'Draws using an airbrush of the selected size.', icon: ic('<path d="M7 6h5v6H7z" fill="#ccc" stroke="#000"/><path d="M9 4h1v2H9z" fill="#000"/><g fill="#00f"><rect x="2" y="3" width="1" height="1"/><rect x="4" y="2" width="1" height="1"/><rect x="3" y="5" width="1" height="1"/><rect x="5" y="4" width="1" height="1"/><rect x="2" y="7" width="1" height="1"/></g>') },
  { id: 'text', name: 'Text', help: 'Inserts text into the picture.', icon: ic('<path d="M3 13L7 3h2l4 10M5 9h6" fill="none" stroke="#000" stroke-width="1.6"/>') },
  { id: 'line', name: 'Line', help: 'Draws a straight line with the selected line width.', icon: ic('<path d="M3 13L13 3" stroke="#000" stroke-width="1.6"/>') },
  { id: 'curve', name: 'Curve', help: 'Draws a curved line with the selected line width.', icon: ic('<path d="M2 12C5 0 9 16 14 4" fill="none" stroke="#000" stroke-width="1.4"/>') },
  { id: 'rect', name: 'Rectangle', help: 'Draws a rectangle with the selected fill style.', icon: ic('<rect x="2.5" y="4.5" width="11" height="8" fill="#888" stroke="#000"/>') },
  { id: 'polygon', name: 'Polygon', help: 'Draws a polygon with the selected fill style. Double-click to finish.', icon: ic('<path d="M3 13l2-9 8 2-3 3 3 4z" fill="#888" stroke="#000"/>') },
  { id: 'ellipse', name: 'Ellipse', help: 'Draws an ellipse with the selected fill style.', icon: ic('<ellipse cx="8" cy="8.5" rx="6" ry="4.5" fill="#888" stroke="#000"/>') },
  { id: 'roundrect', name: 'Rounded Rectangle', help: 'Draws a rounded rectangle with the selected fill style.', icon: ic('<rect x="2.5" y="4.5" width="11" height="8" rx="3" fill="#888" stroke="#000"/>') },
];
const TOOL = Object.fromEntries(TOOLS.map((t) => [t.id, t]));

// Brush shapes: [kind, size] in rows of three sizes.
const BRUSHES = [['circle', 7], ['circle', 4], ['circle', 1], ['square', 8], ['square', 5], ['square', 2], ['slash', 8], ['slash', 5], ['slash', 3], ['backslash', 8], ['backslash', 5], ['backslash', 3]];

class Paint {
  constructor(win) {
    this.win = win;
    this.canvas = makeCanvas(640, 400);
    this.g = ctx2d(this.canvas);
    this.g.fillStyle = '#ffffff';
    this.g.fillRect(0, 0, 640, 400);
    this.fg = '#000000';
    this.bg = '#ffffff';
    this.palette = [...PALETTE];
    this.tool = 'pencil';
    this.prevTool = 'pencil';
    this.opt = { brush: 1, eraser: 8, line: 1, fillMode: 0, zoomPick: 4, air: 1, transparent: false };
    this.zoom = 1;
    this.undoStack = [];
    this.redoStack = [];
    this.sel = null;
    this.file = null;          // { root, path } when it came from / was saved to the shared folders
    this.name = 'untitled.png';
    this.dirty = false;
    this.show = { toolbox: true, colorbox: true, statusbar: true, grid: false, textbar: true };
    this.build();
    this.render();
    this.setTool('pencil');
    this.updateTitle();
  }

  destroy() { clearInterval(this.airTimer); removeEventListener('keydown', this.onKey, true); this.menu.close(); }

  // ---- Layout ----

  build() {
    const m = (label, action, shortcut, extra = {}) => ({ label, action, shortcut, ...extra });
    this.menu = menuBar([
      { label: 'File', items: [m('New', () => this.newImage(), 'Ctrl+N'), m('Open…', () => this.open(), 'Ctrl+O'), m('Save', () => this.save(), 'Ctrl+S'), m('Save As…', () => this.save(true)), '-',
        m('Set As Wallpaper (Tiled)', () => this.wallpaper('tile')), m('Set As Wallpaper (Centered)', () => this.wallpaper('center')), '-', m('Exit', () => this.win.close(), 'Alt+F4')] },
      { label: 'Edit', items: [m('Undo', () => this.undo(), 'Ctrl+Z', { disabled: () => !this.undoStack.length }), m('Repeat', () => this.redo(), 'Ctrl+Y', { disabled: () => !this.redoStack.length }), '-',
        m('Cut', () => this.cut(), 'Ctrl+X', { disabled: () => !this.sel }), m('Copy', () => this.copy(), 'Ctrl+C', { disabled: () => !this.sel }), m('Paste', () => this.paste(), 'Ctrl+V'),
        m('Clear Selection', () => this.clearSelection(), 'Del', { disabled: () => !this.sel }), m('Select All', () => this.selectAll(), 'Ctrl+A'), '-',
        m('Copy To…', () => this.copyTo(), '', { disabled: () => !this.sel }), m('Paste From…', () => this.pasteFrom())] },
      { label: 'View', items: [m('Tool Box', () => this.toggle('toolbox'), 'Ctrl+T', { checked: () => this.show.toolbox }), m('Color Box', () => this.toggle('colorbox'), 'Ctrl+L', { checked: () => this.show.colorbox }),
        m('Status Bar', () => this.toggle('statusbar'), '', { checked: () => this.show.statusbar }), m('Text Toolbar', () => this.toggle('textbar'), '', { checked: () => this.show.textbar }), '-',
        m('Normal Size', () => this.setZoom(1), 'Ctrl+PgUp', { checked: () => this.zoom === 1 }), m('Large Size', () => this.setZoom(4), 'Ctrl+PgDn', { checked: () => this.zoom === 4 }),
        m('Custom…', () => this.customZoom()), m('Show Grid', () => this.toggle('grid'), 'Ctrl+G', { checked: () => this.show.grid, disabled: () => this.zoom < 4 }), '-',
        m('View Bitmap', () => this.viewBitmap(), 'Ctrl+F')] },
      { label: 'Image', items: [m('Flip/Rotate…', () => this.flipRotate(), 'Ctrl+R'), m('Stretch/Skew…', () => this.stretchSkew(), 'Ctrl+W'), m('Invert Colors', () => this.invert(), 'Ctrl+I'),
        m('Attributes…', () => this.attributes(), 'Ctrl+E'), m('Clear Image', () => this.clearImage(), 'Ctrl+Shft+N'), m('Draw Opaque', () => { this.opt.transparent = !this.opt.transparent; this.drawOptions(); this.renderSel(); }, '', { checked: () => !this.opt.transparent })] },
      { label: 'Colors', items: [m('Edit Colors…', () => this.editColors())] },
      { label: 'Help', items: [m('About Paint', () => dialog('About Paint', h('div', { class: 'p98-about' }, h('div', { html: appIcon.paint }), h('p', {}, h('strong', {}, 'Paint'), h('br'), 'A MediaDesk homage to Microsoft Paint for Windows 98, after jspaint by Isaiah Odhner.')), { buttons: [['OK', true, true]], cls: 'p98' }))] },
    ], 'p98');

    // Tool box
    this.toolsEl = h('div', { class: 'p98-tools' }, TOOLS.map((t) => h('button', {
      class: 'p98-tool', type: 'button', title: t.name, 'data-tool': t.id, html: t.icon,
      onclick: () => this.setTool(t.id), onpointerenter: () => this.setStatus(t.help), onpointerleave: () => this.setStatus(''),
    })));
    this.optEl = h('div', { class: 'p98-opts' });
    this.toolbox = h('div', { class: 'p98-toolbox' }, this.toolsEl, this.optEl);

    // Canvas area
    this.view = h('canvas', { class: 'p98-canvas' });
    this.overlay = makeCanvas(1, 1);
    this.overlay.className = 'p98-overlay';
    this.selBox = h('div', { class: 'p98-sel', hidden: true });
    this.gridEl = h('div', { class: 'p98-grid', hidden: true });
    this.handles = ['e', 's', 'se'].map((d) => {
      const el = h('div', { class: `p98-handle p98-h-${d}`, title: 'Drag to resize the picture' });
      el.addEventListener('pointerdown', (e) => this.resizeDrag(e, d));
      return el;
    });
    this.page = h('div', { class: 'p98-page' }, this.view, this.overlay, this.gridEl, this.selBox, ...this.handles);
    this.area = h('div', { class: 'p98-area', tabindex: '0' }, this.page);
    for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) this.page.addEventListener(ev, (e) => this.pointer(e));
    this.page.addEventListener('dblclick', (e) => this.dbl(e));
    this.page.addEventListener('contextmenu', (e) => e.preventDefault());
    this.page.addEventListener('pointerleave', () => { this.posEl.textContent = ''; });

    // Text toolbar (fonts), shown while typing
    this.font = { family: 'Arial', size: 12, bold: false, italic: false, underline: false };
    const fam = h('select', { onchange: (e) => { this.font.family = e.target.value; this.styleText(); } }, ['Arial', 'Times New Roman', 'Courier New', 'Comic Sans MS', 'Verdana', 'Georgia', 'Tahoma', 'Impact', 'Trebuchet MS'].map((f) => h('option', { value: f }, f)));
    const size = h('select', { onchange: (e) => { this.font.size = Number(e.target.value); this.styleText(); } }, [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72].map((s) => h('option', { value: s, selected: s === 12 }, String(s))));
    const tog = (k, label, cls) => h('button', { class: `p98-btn p98-tog ${cls}`, type: 'button', onclick: (e) => { this.font[k] = !this.font[k]; e.currentTarget.classList.toggle('on', this.font[k]); this.styleText(); } }, label);
    this.textbar = h('div', { class: 'p98-textbar', hidden: true }, h('span', { class: 'p98-tb-title' }, 'Fonts'), fam, size, tog('bold', 'B', 'b'), tog('italic', 'I', 'i'), tog('underline', 'U', 'u'));

    // Colour box
    this.fgEl = h('div', { class: 'p98-fg' });
    this.bgEl = h('div', { class: 'p98-bg' });
    this.paletteEl = h('div', { class: 'p98-palette' });
    this.colorbox = h('div', { class: 'p98-colorbox' }, h('div', { class: 'p98-current', title: 'Foreground and background colours' }, this.bgEl, this.fgEl), this.paletteEl);
    this.drawPalette();

    // Status bar
    this.statusEl = h('span', { class: 'p98-status-text' }, 'For Help, click Help Topics on the Help Menu.');
    this.posEl = h('span', { class: 'p98-status-cell' });
    this.sizeEl = h('span', { class: 'p98-status-cell' });
    this.statusbar = h('div', { class: 'p98-status' }, this.statusEl, this.posEl, this.sizeEl);

    clear(this.win.body, h('div', { class: 'p98 p98-root' }, this.menu, h('div', { class: 'p98-main' }, this.toolbox, this.area), this.textbar, this.colorbox, this.statusbar));
    this.onKey = (e) => this.key(e);
    addEventListener('keydown', this.onKey, true);
    // Paste a picture copied elsewhere.
    this.win.body.addEventListener('paste', (e) => {
      const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
      if (item) { e.preventDefault(); this.pasteBlob(item.getAsFile()); }
    });
  }

  updateTitle() { this.win.setTitle?.(`${this.name.replace(/\.[^.]+$/, '')} - Paint`); }
  setStatus(t) { this.statusEl.textContent = t || 'For Help, click Help Topics on the Help Menu.'; }
  toggle(k) {
    this.show[k] = !this.show[k];
    this.toolbox.hidden = !this.show.toolbox;
    this.colorbox.hidden = !this.show.colorbox;
    this.statusbar.hidden = !this.show.statusbar;
    this.render();
  }

  drawPalette() {
    this.fgEl.style.background = this.fg;
    this.bgEl.style.background = this.bg;
    clear(this.paletteEl, this.palette.map((c, i) => h('button', {
      class: 'p98-swatch', type: 'button', style: { background: c }, title: c,
      onpointerdown: (e) => { e.preventDefault(); if (e.button === 2) this.bg = c; else this.fg = c; this.drawPalette(); },
      ondblclick: () => this.editColors(i),
      oncontextmenu: (e) => e.preventDefault(),
    })));
  }

  // ---- Tools and their option panes ----

  setTool(id) {
    if (this.tool !== id) this.commitAll();
    if (id !== 'picker' && id !== 'magnifier') this.prevTool = id;
    this.tool = id;
    this.toolsEl.querySelectorAll('.p98-tool').forEach((b) => b.classList.toggle('on', b.dataset.tool === id));
    this.page.dataset.tool = id;
    this.drawOptions();
  }

  drawOptions() {
    const o = this.opt;
    const pane = (items) => clear(this.optEl, h('div', { class: 'p98-optgrid' }, items));
    const pick = (key, val) => () => { o[key] = val; this.drawOptions(); this.renderSel(); };
    const t = this.tool;
    if (t === 'select' || t === 'freeselect' || t === 'text') {
      pane([h('button', { class: `p98-opt p98-opt-wide ${!o.transparent ? 'on' : ''}`, title: 'Opaque', onclick: pick('transparent', false), html: '<svg viewBox="0 0 30 18"><rect x="3" y="3" width="13" height="12" fill="#fff" stroke="#000"/><circle cx="20" cy="9" r="5" fill="#f00"/><rect x="3" y="3" width="13" height="12" fill="#ccc" stroke="#000" opacity=".9"/></svg>' }),
        h('button', { class: `p98-opt p98-opt-wide ${o.transparent ? 'on' : ''}`, title: 'Transparent', onclick: pick('transparent', true), html: '<svg viewBox="0 0 30 18"><circle cx="20" cy="9" r="5" fill="#f00"/><rect x="3" y="3" width="13" height="12" fill="none" stroke="#000"/></svg>' })]);
    } else if (t === 'eraser') {
      pane([4, 6, 8, 10].map((s) => h('button', { class: `p98-opt p98-opt-wide ${o.eraser === s ? 'on' : ''}`, onclick: pick('eraser', s), html: `<svg viewBox="0 0 30 14"><rect x="${15 - s / 2}" y="${7 - s / 2}" width="${s}" height="${s}" fill="#000"/></svg>` })));
    } else if (t === 'magnifier') {
      pane([1, 2, 6, 8].map((z) => h('button', { class: `p98-opt p98-opt-wide ${this.zoom === z ? 'on' : ''}`, onclick: () => this.setZoom(z) }, `${z}x`)));
    } else if (t === 'brush') {
      pane(BRUSHES.map(([k, s], i) => h('button', { class: `p98-opt ${o.brush === i ? 'on' : ''}`, onclick: pick('brush', i), html: `<svg viewBox="0 0 12 12">${brushIcon(k, s)}</svg>` })));
    } else if (t === 'airbrush') {
      pane([0, 1, 2].map((i) => h('button', { class: `p98-opt p98-opt-wide ${o.air === i ? 'on' : ''}`, onclick: pick('air', i), html: `<svg viewBox="0 0 30 22">${sprayIcon([4, 7, 10][i])}</svg>` })));
    } else if (t === 'line' || t === 'curve') {
      pane([1, 2, 3, 4, 5].map((w) => h('button', { class: `p98-opt p98-opt-wide ${o.line === w ? 'on' : ''}`, onclick: pick('line', w), html: `<svg viewBox="0 0 30 10"><rect x="4" y="${5 - w / 2}" width="22" height="${w}" fill="#000"/></svg>` })));
    } else if (['rect', 'ellipse', 'roundrect', 'polygon'].includes(t)) {
      pane([0, 1, 2].map((m) => h('button', { class: `p98-opt p98-opt-wide ${o.fillMode === m ? 'on' : ''}`, title: ['Outline', 'Outline and fill', 'Fill'][m], onclick: pick('fillMode', m),
        html: `<svg viewBox="0 0 30 16"><rect x="5" y="3" width="20" height="10" fill="${m === 0 ? 'none' : '#888'}" stroke="${m === 2 ? '#888' : '#000'}"/></svg>` })));
    } else clear(this.optEl);
  }

  // ---- Drawing helpers ----

  colorFor(btn) { return btn === 2 ? this.bg : this.fg; }
  otherColor(btn) { return btn === 2 ? this.fg : this.bg; }
  pos(e) {
    const r = this.view.getBoundingClientRect();
    return { x: (e.clientX - r.left) / this.zoom, y: (e.clientY - r.top) / this.zoom };
  }

  pushUndo() {
    this.undoStack.push(this.g.getImageData(0, 0, this.canvas.width, this.canvas.height));
    if (this.undoStack.length > 50) this.undoStack.shift();
    this.redoStack = [];
    this.dirty = true;
  }
  undo() {
    if (this.text) return this.cancelText();
    if (this.sel && this.sel.lifted) { this.dropSel(false); }
    const img = this.undoStack.pop();
    if (!img) return;
    this.redoStack.push(this.g.getImageData(0, 0, this.canvas.width, this.canvas.height));
    this.restore(img);
  }
  redo() {
    const img = this.redoStack.pop();
    if (!img) return;
    this.undoStack.push(this.g.getImageData(0, 0, this.canvas.width, this.canvas.height));
    this.restore(img);
  }
  restore(img) {
    this.sel = null;
    if (img.width !== this.canvas.width || img.height !== this.canvas.height) { this.canvas.width = img.width; this.canvas.height = img.height; }
    this.g.putImageData(img, 0, 0);
    this.render();
  }

  // Pixel-exact line (Bresenham), calling fn for each point.
  static line(x0, y0, x1, y1, fn) {
    x0 = Math.floor(x0); y0 = Math.floor(y0); x1 = Math.floor(x1); y1 = Math.floor(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      fn(x0, y0);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
  stamp(g, x, y, color) {
    const [kind, s] = BRUSHES[this.opt.brush];
    g.fillStyle = color;
    if (kind === 'circle') {
      if (s <= 1) { g.fillRect(x, y, 1, 1); return; }
      const r = s / 2;
      for (let dy = -Math.floor(r); dy <= Math.floor(r); dy++) {
        const half = Math.floor(Math.sqrt(r * r - dy * dy));
        g.fillRect(x - half, y + dy, half * 2 + 1, 1);
      }
    } else if (kind === 'square') g.fillRect(x - Math.floor(s / 2), y - Math.floor(s / 2), s, s);
    else {
      const dir = kind === 'slash' ? 1 : -1;
      for (let i = 0; i < s; i++) g.fillRect(x - Math.floor(s / 2) + i, y + dir * (Math.floor(s / 2) - i), 1, 1);
    }
  }

  // Shapes (preview on the overlay, final on the canvas)
  shape(g, kind, a, b, btn, shift) {
    let { x: x0, y: y0 } = a, { x: x1, y: y1 } = b;
    x0 = Math.floor(x0); y0 = Math.floor(y0); x1 = Math.floor(x1); y1 = Math.floor(y1);
    if (shift && kind !== 'line') { const d = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)); x1 = x0 + Math.sign(x1 - x0 || 1) * d; y1 = y0 + Math.sign(y1 - y0 || 1) * d; }
    if (shift && kind === 'line') {
      const ang = Math.round(Math.atan2(y1 - y0, x1 - x0) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(x1 - x0, y1 - y0);
      x1 = Math.round(x0 + Math.cos(ang) * len); y1 = Math.round(y0 + Math.sin(ang) * len);
    }
    const lw = this.opt.line;
    const stroke = this.colorFor(btn), fillC = this.otherColor(btn);
    g.imageSmoothingEnabled = false;
    if (kind === 'line') {
      g.fillStyle = stroke;
      Paint.line(x0, y0, x1, y1, (x, y) => g.fillRect(x - Math.floor((lw - 1) / 2), y - Math.floor((lw - 1) / 2), lw, lw));
      return;
    }
    const l = Math.min(x0, x1), t = Math.min(y0, y1), w = Math.abs(x1 - x0) + 1, hh = Math.abs(y1 - y0) + 1;
    const mode = this.opt.fillMode;
    const path = new Path2D();
    if (kind === 'rect') path.rect(l + lw / 2, t + lw / 2, Math.max(0, w - lw), Math.max(0, hh - lw));
    else if (kind === 'ellipse') path.ellipse(l + w / 2, t + hh / 2, Math.max(0.5, w / 2 - lw / 2), Math.max(0.5, hh / 2 - lw / 2), 0, 0, Math.PI * 2);
    else if (kind === 'roundrect') path.roundRect(l + lw / 2, t + lw / 2, Math.max(0, w - lw), Math.max(0, hh - lw), Math.min(8, w / 2, hh / 2));
    const { width: cw, height: ch } = this.canvas;
    if (mode > 0) aliased(g, cw, ch, mode === 2 ? stroke : fillC, (x) => x.fill(path));
    if (mode < 2) aliased(g, cw, ch, stroke, (x) => { x.lineWidth = lw; x.stroke(path); });
  }
  polygonPath(g, pts, btn, closed) {
    const lw = this.opt.line, mode = this.opt.fillMode;
    const stroke = this.colorFor(btn), fillC = this.otherColor(btn);
    const path = new Path2D();
    pts.forEach((p, i) => (i ? path.lineTo(Math.floor(p.x) + 0.5, Math.floor(p.y) + 0.5) : path.moveTo(Math.floor(p.x) + 0.5, Math.floor(p.y) + 0.5)));
    if (closed) path.closePath();
    const { width: cw, height: ch } = this.canvas;
    if (closed && mode > 0) aliased(g, cw, ch, mode === 2 ? stroke : fillC, (x) => x.fill(path));
    if (!closed || mode < 2) aliased(g, cw, ch, stroke, (x) => { x.lineWidth = lw; x.lineJoin = 'round'; x.stroke(path); });
  }

  // ---- Pointer ----

  pointer(e) {
    if (e.target.classList.contains('p98-handle')) return;
    const p = this.pos(e);
    const inside = p.x >= 0 && p.y >= 0 && p.x < this.canvas.width && p.y < this.canvas.height;
    if (e.type === 'pointermove') this.posEl.textContent = inside ? `${Math.floor(p.x)},${Math.floor(p.y)}` : '';
    const t = this.tool;
    if (e.type === 'pointerdown') {
      if (e.button === 1) return;
      this.area.focus({ preventScroll: true });
      try { this.page.setPointerCapture(e.pointerId); } catch { /* fine */ }
      this.drag = { start: p, last: p, btn: e.button, shift: e.shiftKey, ctrl: e.ctrlKey };
    }
    const d = this.drag;
    if (!d && t !== 'polygon' && t !== 'curve') return;
    const fn = this[`tool_${t}`];
    if (fn) fn.call(this, e.type, p, d || {}, e);
    if (d) d.last = p;
    if (e.type === 'pointerup' || e.type === 'pointercancel') this.drag = null;
  }
  dbl() { if (this.tool === 'polygon' && this.poly) this.finishPolygon(); }

  tool_pencil(type, p, d) {
    if (type === 'pointerdown') { this.pushUndo(); this.g.fillStyle = this.colorFor(d.btn); this.g.fillRect(Math.floor(p.x), Math.floor(p.y), 1, 1); }
    else if (type === 'pointermove') { this.g.fillStyle = this.colorFor(d.btn); Paint.line(d.last.x, d.last.y, p.x, p.y, (x, y) => this.g.fillRect(x, y, 1, 1)); }
    this.render();
  }
  tool_brush(type, p, d) {
    const c = this.colorFor(d.btn);
    if (type === 'pointerdown') { this.pushUndo(); this.stamp(this.g, Math.floor(p.x), Math.floor(p.y), c); }
    else if (type === 'pointermove') Paint.line(d.last.x, d.last.y, p.x, p.y, (x, y) => this.stamp(this.g, x, y, c));
    this.render();
  }
  tool_eraser(type, p, d) {
    const s = this.opt.eraser;
    const erase = (x, y) => {
      x -= Math.floor(s / 2); y -= Math.floor(s / 2);
      if (d.btn === 2) {
        // Colour eraser: only the foreground colour becomes the background colour.
        const img = this.g.getImageData(x, y, s, s);
        const [fr, fg, fb] = hexToRgba(this.fg), [br, bgc, bb] = hexToRgba(this.bg);
        for (let i = 0; i < img.data.length; i += 4) if (img.data[i] === fr && img.data[i + 1] === fg && img.data[i + 2] === fb) { img.data[i] = br; img.data[i + 1] = bgc; img.data[i + 2] = bb; img.data[i + 3] = 255; }
        this.g.putImageData(img, x, y);
      } else { this.g.fillStyle = this.bg; this.g.fillRect(x, y, s, s); }
    };
    if (type === 'pointerdown') { this.pushUndo(); erase(Math.floor(p.x), Math.floor(p.y)); }
    else if (type === 'pointermove') Paint.line(d.last.x, d.last.y, p.x, p.y, erase);
    this.render();
    // Show the eraser square.
    this.clearOverlay();
    if (type !== 'pointerup') { const o = ctx2d(this.overlay); o.strokeStyle = '#000'; o.strokeRect(Math.floor(p.x) - Math.floor(s / 2) + 0.5, Math.floor(p.y) - Math.floor(s / 2) + 0.5, s - 1, s - 1); }
  }
  tool_airbrush(type, p, d) {
    const r = [4, 8, 12][this.opt.air];
    const spray = () => {
      const q = this.drag?.last || p;
      this.g.fillStyle = this.colorFor(d.btn);
      for (let i = 0; i < r * 1.5; i++) {
        const a = Math.random() * Math.PI * 2, rr = Math.random() * r;
        this.g.fillRect(Math.floor(q.x + Math.cos(a) * rr), Math.floor(q.y + Math.sin(a) * rr), 1, 1);
      }
      this.render();
    };
    if (type === 'pointerdown') { this.pushUndo(); spray(); clearInterval(this.airTimer); this.airTimer = setInterval(spray, 30); }
    if (type === 'pointerup' || type === 'pointercancel') clearInterval(this.airTimer);
  }
  tool_fill(type, p, d) {
    if (type !== 'pointerdown') return;
    const img = this.g.getImageData(0, 0, this.canvas.width, this.canvas.height);
    const mask = colorMask(img, p.x, p.y, 0, true);
    if (!mask.some(Boolean)) return;
    this.pushUndo();
    fillMask(img, mask, hexToRgba(this.colorFor(d.btn)));
    this.g.putImageData(img, 0, 0);
    this.render();
  }
  tool_picker(type, p, d) {
    if (type === 'pointerup') { this.setTool(this.prevTool); return; }
    const px = this.g.getImageData(Math.max(0, Math.min(this.canvas.width - 1, Math.floor(p.x))), Math.max(0, Math.min(this.canvas.height - 1, Math.floor(p.y))), 1, 1).data;
    const c = rgbaToHex(px);
    if (d.btn === 2) this.bg = c; else this.fg = c;
    this.drawPalette();
  }
  tool_magnifier(type, p, d) {
    if (type !== 'pointerdown') return;
    const z = this.zoom === 1 ? (this.opt.zoomPick || 4) : 1;
    if (d.btn === 2) return this.setZoom(1);
    this.setZoom(z, p);
  }
  tool_line(type, p, d) { this.previewShape('line', type, p, d); }
  tool_rect(type, p, d) { this.previewShape('rect', type, p, d); }
  tool_ellipse(type, p, d) { this.previewShape('ellipse', type, p, d); }
  tool_roundrect(type, p, d) { this.previewShape('roundrect', type, p, d); }
  previewShape(kind, type, p, d) {
    this.clearOverlay();
    const shift = d.shift || this.shiftDown;
    if (type === 'pointermove') this.shape(ctx2d(this.overlay), kind, d.start, p, d.btn, shift);
    if (type === 'pointerup') { this.pushUndo(); this.shape(this.g, kind, d.start, p, d.btn, shift); this.render(); }
    if (type === 'pointermove' || type === 'pointerup') this.sizeEl.textContent = `${Math.abs(Math.floor(p.x) - Math.floor(d.start.x)) + 1}x${Math.abs(Math.floor(p.y) - Math.floor(d.start.y)) + 1}`;
  }

  // Curve: drag a line, then click (or drag) twice to bend it.
  tool_curve(type, p, d) {
    const c = this.curve;
    const draw = (g, pts, btn) => aliased(g, this.canvas.width, this.canvas.height, this.colorFor(btn), (x) => {
      x.lineWidth = this.opt.line; x.lineCap = 'round';
      const [a, b, c1, c2] = pts;
      x.beginPath(); x.moveTo(a.x, a.y); x.bezierCurveTo((c1 || a).x, (c1 || a).y, (c2 || c1 || b).x, (c2 || c1 || b).y, b.x, b.y); x.stroke();
    });
    if (!c) {
      if (type === 'pointerdown') this.curve = { pts: [p, p], stage: 0, btn: d.btn };
      return;
    }
    if (type === 'pointerdown' && c.stage > 0) c.dragging = true;
    if (type === 'pointermove' && (this.drag || c.dragging)) {
      if (c.stage === 0) c.pts[1] = p; else c.pts[c.stage + 1] = p;
    }
    if (type === 'pointerup' || type === 'pointercancel') {
      if (c.stage === 0) c.pts[1] = p; else c.pts[c.stage + 1] = p;
      c.dragging = false;
      c.stage++;
      if (c.stage > 2) { this.pushUndo(); draw(this.g, c.pts, c.btn); this.curve = null; this.clearOverlay(); this.render(); return; }
    }
    this.clearOverlay();
    draw(ctx2d(this.overlay), c.pts, c.btn);
  }

  // Polygon: drag the first side, then click for each corner; double-click (or click the start) to close.
  tool_polygon(type, p, d) {
    const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) * this.zoom < 6;
    if (type === 'pointerdown') {
      if (!this.poly) this.poly = { pts: [p, p], btn: d.btn };
      else if (this.poly.pts.length > 2 && near(p, this.poly.pts[0])) return this.finishPolygon();
      else this.poly.pts.push(p);
    }
    if (!this.poly) return;
    if (type === 'pointermove') this.poly.pts[this.poly.pts.length - 1] = p;
    this.clearOverlay();
    this.polygonPath(ctx2d(this.overlay), this.poly.pts, this.poly.btn, false);
  }
  finishPolygon() {
    const pl = this.poly;
    this.poly = null;
    this.clearOverlay();
    if (!pl || pl.pts.length < 3) return;
    this.pushUndo();
    this.polygonPath(this.g, pl.pts, pl.btn, true);
    this.render();
  }

  // ---- Selections ----

  tool_select(type, p, d) {
    if (type === 'pointerdown' && this.sel && this.inSel(p)) return this.startMoveSel(p, d);
    if (this.selMove) return this.moveSel(type, p);
    if (type === 'pointerdown') this.commitSel();
    const x0 = Math.max(0, Math.min(this.canvas.width, Math.floor(Math.min(d.start.x, p.x))));
    const y0 = Math.max(0, Math.min(this.canvas.height, Math.floor(Math.min(d.start.y, p.y))));
    const x1 = Math.max(0, Math.min(this.canvas.width, Math.ceil(Math.max(d.start.x, p.x))));
    const y1 = Math.max(0, Math.min(this.canvas.height, Math.ceil(Math.max(d.start.y, p.y))));
    this.showSelBox(x0, y0, x1 - x0, y1 - y0);
    this.sizeEl.textContent = `${x1 - x0}x${y1 - y0}`;
    if (type === 'pointerup' && x1 - x0 > 0 && y1 - y0 > 0) this.makeSel(x0, y0, x1 - x0, y1 - y0, null);
    else if (type === 'pointerup') this.selBox.hidden = true;
  }
  tool_freeselect(type, p, d) {
    if (type === 'pointerdown' && this.sel && this.inSel(p)) return this.startMoveSel(p, d);
    if (this.selMove) return this.moveSel(type, p);
    if (type === 'pointerdown') { this.commitSel(); this.lasso = [p]; }
    if (!this.lasso) return;
    if (type === 'pointermove') this.lasso.push(p);
    this.clearOverlay();
    const o = ctx2d(this.overlay);
    o.strokeStyle = '#000'; o.setLineDash([2, 2]); o.lineWidth = 1 / Math.max(1, this.zoom);
    o.beginPath(); this.lasso.forEach((q, i) => (i ? o.lineTo(q.x, q.y) : o.moveTo(q.x, q.y))); o.stroke();
    if (type === 'pointerup') {
      const pts = this.lasso;
      this.lasso = null;
      this.clearOverlay();
      if (pts.length < 3) return;
      const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
      const x0 = Math.max(0, Math.floor(Math.min(...xs))), y0 = Math.max(0, Math.floor(Math.min(...ys)));
      const x1 = Math.min(this.canvas.width, Math.ceil(Math.max(...xs))), y1 = Math.min(this.canvas.height, Math.ceil(Math.max(...ys)));
      if (x1 - x0 < 1 || y1 - y0 < 1) return;
      this.makeSel(x0, y0, x1 - x0, y1 - y0, pts.map((q) => ({ x: q.x - x0, y: q.y - y0 })));
    }
  }
  makeSel(x, y, w, hh, shape) {
    this.sel = { x, y, w, h: hh, shape, lifted: false, canvas: null };
    this.showSelBox(x, y, w, hh);
    this.sizeEl.textContent = `${w}x${hh}`;
  }
  inSel(p) { const s = this.sel; return s && p.x >= s.x && p.y >= s.y && p.x < s.x + s.w && p.y < s.y + s.h; }
  // Take the selected pixels off the picture into a floating piece (leaving the background colour).
  lift(leaveHole = true) {
    const s = this.sel;
    if (s.lifted) return;
    const c = makeCanvas(s.w, s.h), cg = ctx2d(c);
    cg.drawImage(this.canvas, -s.x, -s.y);
    if (s.shape) { cg.globalCompositeOperation = 'destination-in'; cg.fill(polyPath(s.shape)); cg.globalCompositeOperation = 'source-over'; }
    if (leaveHole) {
      this.pushUndo();
      this.g.save();
      if (s.shape) { this.g.translate(s.x, s.y); this.g.clip(polyPath(s.shape)); this.g.translate(-s.x, -s.y); }
      this.g.fillStyle = this.bg; this.g.fillRect(s.x, s.y, s.w, s.h);
      this.g.restore();
    }
    s.canvas = c; s.lifted = true;
    this.render();
  }
  startMoveSel(p, d) {
    const s = this.sel;
    if (d.ctrl && s.lifted) this.stampSel();          // Ctrl+drag leaves a copy behind
    if (!s.lifted) this.lift(!d.ctrl);
    this.selMove = { dx: p.x - s.x, dy: p.y - s.y, smear: d.shift };
  }
  moveSel(type, p) {
    const s = this.sel, m = this.selMove;
    if (type === 'pointermove') {
      s.x = Math.round(p.x - m.dx); s.y = Math.round(p.y - m.dy);
      if (m.smear) this.stampSel();
      this.renderSel();
    }
    if (type === 'pointerup' || type === 'pointercancel') this.selMove = null;
  }
  // The floating piece, with the background colour see-through in transparent mode.
  selImage() {
    const s = this.sel;
    if (!this.opt.transparent) return s.canvas;
    const c = cloneCanvas(s.canvas), cg = ctx2d(c);
    const img = cg.getImageData(0, 0, c.width, c.height), [r, g, b] = hexToRgba(this.bg);
    for (let i = 0; i < img.data.length; i += 4) if (img.data[i] === r && img.data[i + 1] === g && img.data[i + 2] === b) img.data[i + 3] = 0;
    cg.putImageData(img, 0, 0);
    return c;
  }
  stampSel() { this.g.drawImage(this.selImage(), this.sel.x, this.sel.y, this.sel.w, this.sel.h); this.render(); }
  renderSel() {
    this.clearOverlay();
    const s = this.sel;
    if (!s) { this.selBox.hidden = true; return; }
    if (s.lifted) ctx2d(this.overlay).drawImage(this.selImage(), s.x, s.y, s.w, s.h);
    this.showSelBox(s.x, s.y, s.w, s.h);
  }
  showSelBox(x, y, w, hh) {
    Object.assign(this.selBox.style, { left: `${x * this.zoom}px`, top: `${y * this.zoom}px`, width: `${w * this.zoom}px`, height: `${hh * this.zoom}px` });
    this.selBox.hidden = false;
  }
  commitSel() {
    const s = this.sel;
    if (!s) return;
    if (s.lifted) this.stampSel();
    this.sel = null;
    this.selBox.hidden = true;
    this.clearOverlay();
    this.sizeEl.textContent = '';
  }
  dropSel() { this.sel = null; this.selBox.hidden = true; this.clearOverlay(); }
  commitAll() {
    if (this.text) this.commitText();
    if (this.poly) this.finishPolygon();
    this.curve = null;
    this.commitSel();
  }
  selectAll() { this.setTool('select'); this.commitSel(); this.makeSel(0, 0, this.canvas.width, this.canvas.height, null); }
  clearSelection() {
    if (!this.sel) return;
    if (this.sel.lifted) { this.dropSel(); this.render(); return; }
    this.lift(true);
    this.dropSel();
    this.render();
  }

  // ---- Clipboard ----

  selectionCanvas() {
    const s = this.sel;
    if (s.lifted) return this.selImage();
    const c = makeCanvas(s.w, s.h), cg = ctx2d(c);
    cg.drawImage(this.canvas, -s.x, -s.y);
    if (s.shape) { cg.globalCompositeOperation = 'destination-in'; cg.fill(polyPath(s.shape)); }
    return c;
  }
  async copy() {
    if (!this.sel) return;
    const c = this.selectionCanvas();
    Paint.clip = c;
    try { const blob = await new Promise((r) => c.toBlob(r, 'image/png')); await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); } catch { /* the browser keeps it to itself */ }
  }
  async cut() { await this.copy(); this.clearSelection(); }
  async paste() {
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((t) => t.startsWith('image/'));
        if (type) return this.pasteBlob(await item.getType(type));
      }
    } catch { /* not allowed: use what was copied here */ }
    if (Paint.clip) this.pasteCanvas(Paint.clip);
  }
  async pasteBlob(blob) { this.pasteCanvas((await decodePicture(blob)).image); }
  async pasteCanvas(src) {
    this.commitAll();
    this.setTool('select');
    // A pasted picture larger than the canvas can grow it, as Paint offers.
    if (src.width > this.canvas.width || src.height > this.canvas.height) {
      const ok = await confirmDialog({ title: 'Paint', message: 'The image in the clipboard is larger than the bitmap. Would you like the bitmap enlarged?', confirm: 'Yes' });
      if (ok) this.resizeTo(Math.max(src.width, this.canvas.width), Math.max(src.height, this.canvas.height));
    }
    const vx = Math.floor(this.area.scrollLeft / this.zoom), vy = Math.floor(this.area.scrollTop / this.zoom);
    this.pushUndo();
    this.sel = { x: vx, y: vy, w: src.width, h: src.height, shape: null, lifted: true, canvas: cloneCanvas(src) };
    this.renderSel();
  }
  async copyTo() {
    if (!this.sel) return;
    const target = await chooseSaveTarget('Copy To', 'selection.png');
    if (!target) return;
    try { await writeFile(target, await encodeCanvas(this.selectionCanvas(), target.name)); toast('Saved', { body: target.name, timeout: 1500 }); } catch (err) { toastError(err, 'Couldn’t save'); }
  }
  async pasteFrom() {
    const pic = await openPicture({ title: 'Paste From' });
    if (pic) this.pasteCanvas(pic.image);
  }

  // ---- Text ----

  tool_text(type, p, d) {
    if (this.text) { if (type === 'pointerdown') this.commitText(); return; }
    const x0 = Math.floor(Math.min(d.start.x, p.x)), y0 = Math.floor(Math.min(d.start.y, p.y));
    const w = Math.max(40, Math.abs(Math.floor(p.x - d.start.x))), hh = Math.max(this.font.size + 8, Math.abs(Math.floor(p.y - d.start.y)));
    this.showSelBox(x0, y0, w, hh);
    if (type !== 'pointerup') return;
    const ta = h('textarea', { class: 'p98-textarea', spellcheck: 'false' });
    this.text = { x: x0, y: y0, w, h: hh, ta, color: this.colorFor(d.btn), back: this.otherColor(d.btn) };
    this.page.append(ta);
    this.styleText();
    this.textbar.hidden = !this.show.textbar;
    ta.focus();
    requestAnimationFrame(() => ta.focus());
  }
  styleText() {
    const t = this.text;
    if (!t) return;
    const f = this.font;
    Object.assign(t.ta.style, {
      left: `${t.x * this.zoom}px`, top: `${t.y * this.zoom}px`, width: `${t.w * this.zoom}px`, height: `${t.h * this.zoom}px`,
      font: `${f.italic ? 'italic ' : ''}${f.bold ? 'bold ' : ''}${f.size * this.zoom * (96 / 72)}px "${f.family}"`, color: t.color,
      background: this.opt.transparent ? 'transparent' : t.back, textDecoration: f.underline ? 'underline' : 'none',
    });
  }
  commitText() {
    const t = this.text;
    if (!t) return;
    this.text = null;
    this.textbar.hidden = true;
    this.selBox.hidden = true;
    const value = t.ta.value;
    t.ta.remove();
    if (!value.trim()) return;
    this.pushUndo();
    const f = this.font, px = f.size * (96 / 72);
    const g = this.g;
    g.save();
    g.beginPath(); g.rect(t.x, t.y, t.w, t.h); g.clip();
    if (!this.opt.transparent) { g.fillStyle = t.back; g.fillRect(t.x, t.y, t.w, t.h); }
    g.font = `${f.italic ? 'italic ' : ''}${f.bold ? 'bold ' : ''}${px}px "${f.family}"`;
    g.fillStyle = t.color;
    g.textBaseline = 'top';
    // Wrap like the text box did.
    let y = t.y + 2;
    for (const para of value.split('\n')) {
      let line = '';
      for (const word of para.split(/(\s+)/)) {
        if (line && g.measureText(line + word).width > t.w - 4) { this.textLine(g, line, t.x + 2, y, px, f.underline); y += px * 1.15; line = word.trimStart(); }
        else line += word;
      }
      this.textLine(g, line, t.x + 2, y, px, f.underline);
      y += px * 1.15;
    }
    g.restore();
    this.render();
  }
  textLine(g, s, x, y, px, underline) {
    g.fillText(s, x, y);
    if (underline && s) g.fillRect(x, y + px * 1.02, g.measureText(s).width, Math.max(1, px / 14));
  }
  cancelText() { if (this.text) { this.text.ta.remove(); this.text = null; this.textbar.hidden = true; this.selBox.hidden = true; } }

  // ---- View ----

  render() {
    const { width: w, height: hh } = this.canvas;
    if (this.view.width !== w || this.view.height !== hh) { this.view.width = w; this.view.height = hh; }
    ctx2d(this.view).drawImage(this.canvas, 0, 0);
    if (this.overlay.width !== w || this.overlay.height !== hh) { this.overlay.width = w; this.overlay.height = hh; this.renderSel(); }
    const css = { width: `${w * this.zoom}px`, height: `${hh * this.zoom}px` };
    Object.assign(this.view.style, css);
    Object.assign(this.overlay.style, css);
    Object.assign(this.page.style, css);
    this.gridEl.hidden = !(this.show.grid && this.zoom >= 4);
    this.gridEl.style.backgroundSize = `${this.zoom}px ${this.zoom}px`;
    this.sizeEl.textContent ||= '';
  }
  clearOverlay() { ctx2d(this.overlay).clearRect(0, 0, this.overlay.width, this.overlay.height); }
  setZoom(z, at) {
    const old = this.zoom;
    this.zoom = z;
    this.render();
    this.renderSel();
    this.styleText();
    if (at) {
      this.area.scrollLeft = at.x * z - this.area.clientWidth / 2;
      this.area.scrollTop = at.y * z - this.area.clientHeight / 2;
    } else if (old !== z) { this.area.scrollLeft *= z / old; this.area.scrollTop *= z / old; }
    if (this.tool === 'magnifier') this.drawOptions();
  }
  async customZoom() {
    const sel = h('div', { class: 'p98-radios' }, [1, 2, 4, 6, 8].map((z) => h('label', {}, h('input', { type: 'radio', name: 'zoom', value: z, checked: this.zoom === z }), ` ${z * 100}%`)));
    const v = await dialog('Custom Zoom', h('div', {}, h('p', {}, `Current zoom: ${this.zoom * 100}%`), h('fieldset', {}, h('legend', {}, 'Zoom to'), sel)), { cls: 'p98', onOk: () => Number(sel.querySelector('input:checked').value) });
    if (v) this.setZoom(v);
  }
  viewBitmap() {
    const c = cloneCanvas(this.canvas);
    c.className = 'p98-fullview';
    const ov = h('div', { class: 'p98-fullscreen', onclick: () => ov.remove() }, c);
    addEventListener('keydown', () => ov.remove(), { once: true, capture: true });
    document.body.append(ov);
  }

  // ---- Picture size ----

  resizeTo(w, hh, anchorFill = true) {
    w = Math.max(1, Math.min(8192, Math.round(w))); hh = Math.max(1, Math.min(8192, Math.round(hh)));
    const old = cloneCanvas(this.canvas);
    this.canvas.width = w; this.canvas.height = hh;
    if (anchorFill) { this.g.fillStyle = this.bg; this.g.fillRect(0, 0, w, hh); }
    this.g.drawImage(old, 0, 0);
    this.dirty = true;
    this.render();
  }
  resizeDrag(e, dir) {
    e.preventDefault(); e.stopPropagation();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    this.commitAll();
    const start = { x: e.clientX, y: e.clientY, w: this.canvas.width, h: this.canvas.height };
    const ghost = h('div', { class: 'p98-ghost' });
    this.page.append(ghost);
    const calc = (ev) => ({ w: dir === 's' ? start.w : Math.max(1, Math.round(start.w + (ev.clientX - start.x) / this.zoom)), h: dir === 'e' ? start.h : Math.max(1, Math.round(start.h + (ev.clientY - start.y) / this.zoom)) });
    const mv = (ev) => { const s = calc(ev); Object.assign(ghost.style, { width: `${s.w * this.zoom}px`, height: `${s.h * this.zoom}px` }); this.sizeEl.textContent = `${s.w}x${s.h}`; };
    const up = (ev) => {
      el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up);
      ghost.remove();
      const s = calc(ev);
      if (s.w !== start.w || s.h !== start.h) { this.pushUndo(); this.resizeTo(s.w, s.h); }
      this.sizeEl.textContent = '';
    };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
  }

  // ---- Image menu (works on the selection if there is one) ----

  // Run fn(canvas) → new canvas, on the selection or the whole picture.
  transform(fn) {
    if (this.sel) {
      if (!this.sel.lifted) this.lift(true); else this.pushUndo();
      const out = fn(this.sel.canvas);
      this.sel.canvas = out; this.sel.w = out.width; this.sel.h = out.height;
      this.renderSel();
      return;
    }
    this.commitAll();
    this.pushUndo();
    const out = fn(cloneCanvas(this.canvas));
    this.canvas.width = out.width; this.canvas.height = out.height;
    this.g.drawImage(out, 0, 0);
    this.render();
  }
  async flipRotate() {
    const opts = [['h', 'Flip horizontal'], ['v', 'Flip vertical'], ['r90', 'Rotate by angle 90°'], ['r180', 'Rotate by angle 180°'], ['r270', 'Rotate by angle 270°']];
    const box = h('fieldset', { class: 'p98-radios' }, h('legend', {}, 'Flip or rotate'), opts.map(([v, l], i) => h('label', {}, h('input', { type: 'radio', name: 'fr', value: v, checked: i === 0 }), ` ${l}`)));
    const v = await dialog('Flip and Rotate', box, { cls: 'p98', onOk: () => box.querySelector('input:checked').value });
    if (!v) return;
    this.transform((src) => {
      const rot = v.startsWith('r') ? Number(v.slice(1)) : 0;
      const out = makeCanvas(rot % 180 ? src.height : src.width, rot % 180 ? src.width : src.height), g = ctx2d(out);
      g.translate(out.width / 2, out.height / 2);
      if (v === 'h') g.scale(-1, 1);
      if (v === 'v') g.scale(1, -1);
      if (rot) g.rotate((rot * Math.PI) / 180);
      g.drawImage(src, -src.width / 2, -src.height / 2);
      return out;
    });
  }
  async stretchSkew() {
    const f = (label, value, unit) => { const i = h('input', { type: 'number', value, class: 'p98-num' }); return [i, h('label', { class: 'p98-line' }, h('span', {}, label), i, unit)]; };
    const [sh, shEl] = f('Horizontal:', 100, '%'), [sv, svEl] = f('Vertical:', 100, '%'), [kh, khEl] = f('Horizontal:', 0, 'Degrees'), [kv, kvEl] = f('Vertical:', 0, 'Degrees');
    const v = await dialog('Stretch and Skew', h('div', {}, h('fieldset', {}, h('legend', {}, 'Stretch'), shEl, svEl), h('fieldset', {}, h('legend', {}, 'Skew'), khEl, kvEl)), {
      cls: 'p98', onOk: () => {
        const r = { sh: Number(sh.value), sv: Number(sv.value), kh: Number(kh.value), kv: Number(kv.value) };
        if (!(r.sh >= 1 && r.sh <= 500 && r.sv >= 1 && r.sv <= 500)) throw new Error('Please enter a percentage between 1 and 500.');
        if (Math.abs(r.kh) > 89 || Math.abs(r.kv) > 89) throw new Error('Please enter an angle between -89 and 89.');
        return r;
      },
    });
    if (!v) return;
    this.transform((src) => {
      const w = Math.max(1, Math.round(src.width * v.sh / 100)), hh = Math.max(1, Math.round(src.height * v.sv / 100));
      const tx = Math.tan((v.kh * Math.PI) / 180), ty = Math.tan((v.kv * Math.PI) / 180);
      const out = makeCanvas(w + Math.abs(tx) * hh, hh + Math.abs(ty) * w), g = ctx2d(out);
      if (!this.sel) { g.fillStyle = this.bg; g.fillRect(0, 0, out.width, out.height); }
      g.imageSmoothingEnabled = false;
      g.setTransform(1, ty, tx, 1, tx < 0 ? -tx * hh : 0, ty < 0 ? -ty * w : 0);
      g.drawImage(src, 0, 0, w, hh);
      return out;
    });
  }
  invert() {
    this.transform((src) => {
      const g = ctx2d(src), img = g.getImageData(0, 0, src.width, src.height);
      for (let i = 0; i < img.data.length; i += 4) { img.data[i] = 255 - img.data[i]; img.data[i + 1] = 255 - img.data[i + 1]; img.data[i + 2] = 255 - img.data[i + 2]; }
      g.putImageData(img, 0, 0);
      return src;
    });
  }
  async attributes() {
    const w = h('input', { type: 'number', value: this.canvas.width, min: 1, max: 8192, class: 'p98-num' });
    const hh = h('input', { type: 'number', value: this.canvas.height, min: 1, max: 8192, class: 'p98-num' });
    const v = await dialog('Attributes', h('div', {}, h('p', {}, `File: ${this.name}`), h('fieldset', {}, h('legend', {}, 'Size (pixels)'),
      h('label', { class: 'p98-line' }, h('span', {}, 'Width:'), w), h('label', { class: 'p98-line' }, h('span', {}, 'Height:'), hh))), {
      cls: 'p98', onOk: () => { const r = { w: Number(w.value), h: Number(hh.value) }; if (!(r.w >= 1 && r.h >= 1 && r.w <= 8192 && r.h <= 8192)) throw new Error('Please enter a size between 1 and 8192.'); return r; },
    });
    if (!v) return;
    this.commitAll();
    this.pushUndo();
    this.resizeTo(v.w, v.h);
  }
  clearImage() {
    if (this.sel) return this.clearSelection();
    this.commitAll();
    this.pushUndo();
    this.g.fillStyle = this.bg;
    this.g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.render();
  }
  async editColors(i) {
    const input = h('input', { type: 'color', value: i != null ? this.palette[i] : this.fg, class: 'p98-color' });
    const v = await dialog('Edit Colors', h('div', {}, h('p', {}, 'Choose a colour. It becomes the foreground colour', i != null ? ' and replaces that palette colour.' : '.'), input), { cls: 'p98', onOk: () => input.value });
    if (!v) return;
    this.fg = v;
    if (i != null) this.palette[i] = v;
    this.drawPalette();
  }

  // ---- Files ----

  async confirmDiscard() {
    if (!this.dirty) return true;
    return Boolean(await confirmDialog({ title: 'Paint', message: `Save changes to ${this.name}?`, confirm: 'Discard changes', danger: true }));
  }
  async newImage() {
    if (!(await this.confirmDiscard())) return;
    this.commitAll();
    this.canvas.width = 640; this.canvas.height = 400;
    this.g.fillStyle = '#ffffff'; this.g.fillRect(0, 0, 640, 400);
    this.undoStack = []; this.redoStack = [];
    this.file = null; this.name = 'untitled.png'; this.dirty = false;
    this.render(); this.updateTitle();
  }
  load(canvas, name, file) {
    this.commitAll();
    this.canvas.width = canvas.width; this.canvas.height = canvas.height;
    // Transparent areas show white, as in Paint.
    this.g.fillStyle = '#ffffff'; this.g.fillRect(0, 0, canvas.width, canvas.height);
    this.g.drawImage(canvas, 0, 0);
    this.undoStack = []; this.redoStack = [];
    this.name = name; this.file = file; this.dirty = false;
    this.setZoom(1);
    this.render(); this.updateTitle();
  }
  async open() {
    if (!(await this.confirmDiscard())) return;
    const pic = await openPicture();
    if (pic) this.load(pic.image, pic.name.replace(/\.ora$/i, '.png'), pic.name.endsWith('.ora') ? null : pic.file);
  }
  async openShared(root, path) {
    try {
      const { fileUrl } = await import('../fileapi.js');
      const r = await fetch(fileUrl(root, path), { credentials: 'same-origin' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const name = path.split('/').pop();
      const pic = await decodePicture(await r.blob(), name);
      this.load(pic.image, name, /\.(png|jpe?g|bmp|webp)$/i.test(name) ? { root, path } : null);
    } catch (err) { toastError(err, 'Couldn’t open the picture'); }
  }
  async save(as = false) {
    this.commitAll();
    let target = this.file && !as ? { root: this.file.root, path: this.file.path, name: this.file.path.split('/').pop() } : null;
    if (!target) {
      const base = this.name.replace(/\.[^.]+$/, '');
      target = await chooseSaveTarget('Save As', `${base}.${['png', 'jpg', 'jpeg', 'bmp', 'webp'].includes(extOf(this.name)) ? extOf(this.name) : 'png'}`);
      if (!target) return;
      if (!/\.(png|jpe?g|bmp|webp)$/i.test(target.name)) target.name += '.png';
    }
    try {
      const saved = await writeFile(target, await encodeCanvas(this.canvas, target.name));
      if (saved) this.file = saved;
      this.name = target.name;
      this.dirty = false;
      this.updateTitle();
      toast('Saved', { body: target.name, icon: appIcon.paint, timeout: 1500 });
    } catch (err) { toastError(err, 'Couldn’t save'); }
  }
  async wallpaper(mode) {
    this.commitAll();
    try {
      const blob = await encodeCanvas(this.canvas, 'wallpaper.png');
      const r = await fetch(`/portal/wallpapers/upload?${new URLSearchParams({ name: `${this.name.replace(/\.[^.]+$/, '')}.png` })}`, { method: 'POST', credentials: 'same-origin', headers: { 'X-MediaDesk': '1', 'Content-Type': 'image/png' }, body: blob });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      await useCustomWallpaper(data, mode === 'tile' ? 'tile' : 'center');
      toast('Wallpaper changed', { icon: appIcon.paint, timeout: 1500 });
    } catch (err) { toastError(err, 'Couldn’t set the wallpaper'); }
  }

  // ---- Keys ----

  key(e) {
    if (!this.win.el.classList.contains('focused') || e.target.closest?.('.pd') || e.target.closest?.('.dialog')) return;
    this.shiftDown = e.shiftKey;
    if (this.text && e.target === this.text.ta) { if (e.key === 'Escape') { e.preventDefault(); this.commitText(); } return; }
    const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
    const run = (fn) => { e.preventDefault(); e.stopPropagation(); fn(); };
    if (mod && e.shiftKey && k === 'n') return run(() => this.clearImage());
    if (mod && k === 'z') return run(() => this.undo());
    if (mod && k === 'y') return run(() => this.redo());
    if (mod && k === 'x') return run(() => this.cut());
    if (mod && k === 'c') return run(() => this.copy());
    if (mod && k === 'v') return run(() => this.paste());
    if (mod && k === 'a') return run(() => this.selectAll());
    if (mod && k === 'n') return run(() => this.newImage());
    if (mod && k === 'o') return run(() => this.open());
    if (mod && k === 's') return run(() => this.save());
    if (mod && k === 'e') return run(() => this.attributes());
    if (mod && k === 'r') return run(() => this.flipRotate());
    if (mod && k === 'w') return run(() => this.stretchSkew());
    if (mod && k === 'i') return run(() => this.invert());
    if (mod && k === 'g') return run(() => this.toggle('grid'));
    if (mod && k === 't') return run(() => this.toggle('toolbox'));
    if (mod && k === 'l') return run(() => this.toggle('colorbox'));
    if (mod && k === 'f') return run(() => this.viewBitmap());
    if (mod && e.key === 'PageUp') return run(() => this.setZoom(1));
    if (mod && e.key === 'PageDown') return run(() => this.setZoom(4));
    if (e.key === 'Delete' && this.sel) return run(() => this.clearSelection());
    if (e.key === 'Escape') return run(() => { this.poly = null; this.curve = null; this.clearOverlay(); if (this.sel?.lifted) this.commitSel(); else this.dropSel(); });
    if (e.key === 'Enter' && this.poly) return run(() => this.finishPolygon());
  }
}

// Classic Paint has no smoothing: draw onto a scratch canvas, then keep only pixels at least
// half covered, in exactly the colour asked for.
function aliased(g, w, hgt, color, draw) {
  const c = makeCanvas(w, hgt), cg = ctx2d(c);
  cg.fillStyle = '#000'; cg.strokeStyle = '#000';
  draw(cg);
  const img = cg.getImageData(0, 0, w, hgt), d = img.data, [r, gr, b] = hexToRgba(color);
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] >= 128) { d[i] = r; d[i + 1] = gr; d[i + 2] = b; d[i + 3] = 255; } else d[i + 3] = 0;
  }
  cg.putImageData(img, 0, 0);
  g.drawImage(c, 0, 0);
}

function polyPath(pts) {
  const p = new Path2D();
  pts.forEach((q, i) => (i ? p.lineTo(q.x, q.y) : p.moveTo(q.x, q.y)));
  p.closePath();
  return p;
}
function brushIcon(kind, s) {
  const c = 6;
  if (kind === 'circle') return `<circle cx="${c}" cy="${c}" r="${Math.max(0.6, s / 2)}" fill="#000"/>`;
  if (kind === 'square') return `<rect x="${c - s / 2}" y="${c - s / 2}" width="${s}" height="${s}" fill="#000"/>`;
  const d = s / 2;
  return kind === 'slash' ? `<path d="M${c - d} ${c + d}L${c + d} ${c - d}" stroke="#000" stroke-width="1.2"/>` : `<path d="M${c - d} ${c - d}L${c + d} ${c + d}" stroke="#000" stroke-width="1.2"/>`;
}
function sprayIcon(r) {
  let s = '';
  for (let i = 0; i < r * 2; i++) { const a = (i * 2.4) % (Math.PI * 2), d = ((i * 37) % 10) / 10 * r; s += `<rect x="${(15 + Math.cos(a) * d).toFixed(1)}" y="${(11 + Math.sin(a) * d).toFixed(1)}" width="1" height="1" fill="#000"/>`; }
  return s;
}
