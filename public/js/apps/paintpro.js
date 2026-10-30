// Paint Pro: an image editor modelled on Pinta — several pictures in tabs, layers with
// opacity and blend modes, a history you can step back through, selections (rectangle,
// ellipse, lasso, magic wand) that limit what's changed, Pinta's 22 tools, its Adjustments and
// Effects with live preview, Image and Layers menus, and OpenRaster (.ora) files that keep
// the layers. Pictures open from and save to the shared folders or this device.

import { h, clear, toast, toastError, confirmDialog } from '../ui.js';
import { appIcon } from '../icons.js';
import {
  makeCanvas, ctx2d, cloneCanvas, colorMask, hexToRgba, rgbaToHex, rgbaCss, rgbToHsv, hsvToRgb, openPicture, chooseSaveTarget, writeFile,
  encodeCanvas, writeOra, decodePicture, menuBar, dialog, numberField, extOf,
} from './paint-common.js';
import { ADJUSTMENTS, EFFECTS, curveLut } from './paintpro-fx.js';

let cssLoaded = false;
const loadCss = () => {
  if (cssLoaded) return;
  cssLoaded = true;
  document.head.append(h('link', { rel: 'stylesheet', href: new URL('../../css/paint.css', import.meta.url).href }));
};

export const paintProApp = {
  id: 'paintpro', name: 'Paint Pro', icon: appIcon.paintpro, size: [1240, 800], description: 'Layers, effects and adjustments, like Pinta',
  open(win, opts = {}) {
    loadCss();
    const app = new PaintPro(win);
    if (opts.root != null && opts.path) app.openShared(Number(opts.root), opts.path);
    win.on('reopen', (o) => { if (o?.root != null && o.path) app.openShared(Number(o.root), o.path); });
    win.on('close', () => app.destroy());
  },
};

// ---- Icons ----
const sv = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
const I = {
  movesel: sv('<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/><rect x="8" y="8" width="8" height="8" fill="currentColor" stroke="none" opacity=".35"/>'),
  moveselection: sv('<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/><rect x="8" y="8" width="8" height="8" stroke-dasharray="2 2"/>'),
  zoom: sv('<circle cx="10.5" cy="10.5" r="6.5"/><path d="M20 20l-4.8-4.8M10.5 7.5v6M7.5 10.5h6"/>'),
  pan: sv('<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11V4.5a1.5 1.5 0 0 1 3 0V12M14 11V6.5a1.5 1.5 0 0 1 3 0V14c0 4-2.5 7-6 7s-5-2-6.5-4.5L3 13a1.5 1.5 0 0 1 2.6-1.5L8 14"/>'),
  rectsel: sv('<rect x="4" y="5" width="16" height="14" stroke-dasharray="3 2"/>'),
  ellipsesel: sv('<ellipse cx="12" cy="12" rx="9" ry="7" stroke-dasharray="3 2"/>'),
  lasso: sv('<path d="M7 17c-3-2-4-6-1-9s10-4 12 0-3 7-8 7" stroke-dasharray="3 2"/><path d="M7 17c-1 2 0 4 2 4"/>'),
  wand: sv('<path d="M4 20L15 9M15 9l2-2M13 7l4 4"/><path d="M18 3v2M21 6h-2M20 10l-1.4-1.4M14 4l1.4 1.4" stroke-width="1.5"/>'),
  brush: sv('<path d="M18 3l3 3-9 9-3-3z"/><path d="M9 12c-3 0-5 2-5 4 0 2-1 3-2 4 4 0 8-1 9-5"/>'),
  pencil: sv('<path d="M4 20l1-4L16 5l3 3L8 19z"/><path d="M14 7l3 3"/>'),
  eraser: sv('<path d="M8 20h12M5 14l8-8 6 6-6 6H9z"/><path d="M9 10l6 6"/>'),
  bucket: sv('<path d="M5 11l7-7 7 7-7 7z"/><path d="M5 11h14"/><path d="M20 15c1 2 1.5 3 0 4.5-1.5-1.5-1-2.5 0-4.5z" fill="currentColor"/>'),
  gradient: sv('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 14h18" opacity=".6"/><rect x="3" y="14" width="18" height="6" fill="currentColor" stroke="none" opacity=".4"/>'),
  picker: sv('<path d="M3 21l3-1 9-9-2-2-9 9z"/><path d="M14 8l2-2 3 3-2 2zM16 6l2-2a2 2 0 0 1 3 3l-2 2"/>'),
  text: sv('<path d="M5 6V4h14v2M12 4v16M9 20h6"/>'),
  line: sv('<path d="M4 20C8 4 16 20 20 4"/>'),
  rect: sv('<rect x="4" y="6" width="16" height="12"/>'),
  roundrect: sv('<rect x="4" y="6" width="16" height="12" rx="4"/>'),
  ellipse: sv('<ellipse cx="12" cy="12" rx="9" ry="6.5"/>'),
  freeform: sv('<path d="M5 17c-2-5 1-11 7-11s9 5 6 9-6 1-8 3-4 2-5-1z"/>'),
  clone: sv('<path d="M8 21h8M12 17v4M7 11h10l-1 6H8z"/><circle cx="12" cy="6" r="3"/>'),
  recolor: sv('<path d="M18 3l3 3-9 9-3-3z"/><path d="M9 12c-3 0-5 2-5 4 0 2-1 3-2 4 4 0 8-1 9-5"/><circle cx="19" cy="18" r="3" fill="currentColor" stroke="none" opacity=".5"/>'),
  new: sv('<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M12 11v6M9 14h6"/>'),
  open: sv('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  save: sv('<path d="M5 3h12l3 3v15H5z"/><path d="M8 3v5h8V3M8 21v-7h8v7"/>'),
  undo: sv('<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>'),
  redo: sv('<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>'),
  cut: sv('<circle cx="6" cy="18" r="3"/><circle cx="18" cy="18" r="3"/><path d="M8 16L18 4M16 16L6 4"/>'),
  copy: sv('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>'),
  paste: sv('<rect x="6" y="5" width="12" height="16" rx="2"/><path d="M9 5V3h6v2"/>'),
  crop: sv('<path d="M6 2v16h16M2 6h16v16"/>'),
  deselect: sv('<rect x="4" y="4" width="16" height="16" stroke-dasharray="3 2"/><path d="M8 8l8 8M16 8l-8 8"/>'),
  add: sv('<path d="M12 5v14M5 12h14"/>'),
  del: sv('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  dup: sv('<rect x="8" y="8" width="12" height="12" rx="2"/><rect x="4" y="4" width="12" height="12" rx="2"/>'),
  up: sv('<path d="M12 19V5M6 11l6-6 6 6"/>'),
  down: sv('<path d="M12 5v14M6 13l6 6 6-6"/>'),
  merge: sv('<path d="M7 4v6l5 5 5-5V4M12 15v5"/>'),
  props: sv('<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>'),
  eye: sv('<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: sv('<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 3.9M6.6 6.6C3.9 8.3 2 12 2 12s4 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/>'),
  fx: sv('<path d="M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>'),
  adjust: sv('<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>'),
  panels: sv('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>'),
};

// Pinta's tools, in its order.
const TOOLS = [
  ['movesel', 'Move Selected', 'M', 'Drag to move the selected pixels. Right-drag to rotate them.'],
  ['moveselection', 'Move Selection', 'M', 'Drag to move the selection outline.'],
  ['zoom', 'Zoom', 'Z', 'Click to zoom in, right-click to zoom out, drag a box to zoom to it.'],
  ['pan', 'Pan', 'H', 'Drag to move around the picture.'],
  ['rectsel', 'Rectangle Select', 'S', 'Drag to select a rectangle. Shift for a square.'],
  ['ellipsesel', 'Ellipse Select', 'S', 'Drag to select an ellipse. Shift for a circle.'],
  ['lasso', 'Lasso Select', 'S', 'Drag around an area to select it.'],
  ['wand', 'Magic Wand Select', 'S', 'Click to select an area of similar colour.'],
  ['brush', 'Paintbrush', 'B', 'Left click for the primary colour, right click for the secondary.'],
  ['pencil', 'Pencil', 'P', 'One-pixel lines, without smoothing.'],
  ['eraser', 'Eraser', 'E', 'Erases to transparency.'],
  ['bucket', 'Paint Bucket', 'F', 'Click to fill an area of similar colour.'],
  ['gradient', 'Gradient', 'G', 'Drag to draw a gradient from the primary to the secondary colour.'],
  ['picker', 'Color Picker', 'K', 'Left click picks the primary colour, right click the secondary.'],
  ['text', 'Text', 'T', 'Click to type. Click elsewhere or press Ctrl+Enter to finish, Esc to cancel.'],
  ['line', 'Line/Curve', 'O', 'Drag to draw a line; drag its middle handle to curve it. Enter to finish.'],
  ['rect', 'Rectangle', 'O', 'Drag to draw; adjust with the handles; Enter to finish. Shift for a square.'],
  ['roundrect', 'Rounded Rectangle', 'O', 'Drag to draw; adjust with the handles; Enter to finish.'],
  ['ellipse', 'Ellipse', 'O', 'Drag to draw; adjust with the handles; Enter to finish. Shift for a circle.'],
  ['freeform', 'Freeform Shape', 'O', 'Drag to draw a shape.'],
  ['clone', 'Clone Stamp', 'L', 'Ctrl+click to set the source, then paint to copy from it.'],
  ['recolor', 'Recolor', 'R', 'Paint over the secondary colour to replace it with the primary.'],
].map(([id, name, key, help]) => ({ id, name, key, help, icon: I[id] }));
const TOOL_BY_ID = Object.fromEntries(TOOLS.map((t) => [t.id, t]));

// Paint.NET / Pinta's default palette.
const PALETTE = ['#ffffff', '#000000', '#c0c0c0', '#808080', '#ff0000', '#800000', '#ff6a00', '#7f3300', '#ffd800', '#7f6a00', '#b6ff00', '#5b7f00', '#4cff00', '#267f00', '#00ff21', '#007f0e',
  '#00ff90', '#007f46', '#00ffff', '#007f7f', '#0094ff', '#004a7f', '#0026ff', '#00137f', '#4800ff', '#21007f', '#b200ff', '#57007f', '#ff00dc', '#7f006e', '#ff006e', '#7f0037',
  '#ffffff', '#404040', '#a0a0a0', '#303030', '#ff7f7f', '#7f3f3f', '#ffb27f', '#7f593f', '#ffe97f', '#7f743f', '#daff7f', '#6d7f3f', '#a5ff7f', '#527f3f', '#7fff8e', '#3f7f47'];

const BLENDS = [['normal', 'Normal'], ['multiply', 'Multiply'], ['color-burn', 'Color Burn'], ['color-dodge', 'Color Dodge'], ['overlay', 'Overlay'], ['lighten', 'Lighten'], ['darken', 'Darken'],
  ['screen', 'Screen'], ['xor', 'Xor'], ['hard-light', 'Hard Light'], ['soft-light', 'Soft Light'], ['difference', 'Difference'], ['exclusion', 'Exclusion'], ['lighter', 'Additive'],
  ['color', 'Color'], ['luminosity', 'Luminosity'], ['hue', 'Hue'], ['saturation', 'Saturation']];
const gco = (blend) => (blend === 'normal' ? 'source-over' : blend);
const ZOOMS = [0.05, 0.1, 0.125, 0.167, 0.25, 0.333, 0.5, 0.667, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32];

let nextId = 1;

// ---------------------------------------------------------------------------
// A document: its layers, selection and history
// ---------------------------------------------------------------------------

class Doc {
  constructor(w, hgt, { name = 'Untitled', fill = '#ffffff' } = {}) {
    this.w = w; this.h = hgt;
    this.layers = [];
    this.cur = 0;
    this.sel = null;          // { mask: canvas, path: Path2D outline, bounds }
    this.history = [];
    this.hpos = -1;
    this.snapCache = new Map();
    this.zoom = 1;
    this.name = name;
    this.file = null;
    this.dirty = false;
    const bg = this.addLayer('Background');
    if (fill) { const g = ctx2d(bg.canvas); g.fillStyle = fill; g.fillRect(0, 0, w, hgt); }
  }
  get layer() { return this.layers[this.cur]; }
  addLayer(name, at = this.layers.length) {
    const l = { id: nextId++, name: name || `Layer ${this.layers.length + 1}`, canvas: makeCanvas(this.w, this.h), visible: true, opacity: 1, blend: 'normal', rev: 0 };
    this.layers.splice(at, 0, l);
    this.cur = at;
    return l;
  }
  touch(l = this.layer) { l.rev++; this.dirty = true; }
  // A copy of everything, sharing unchanged layer pixels with earlier snapshots.
  snapshot() {
    return {
      w: this.w, h: this.h, cur: this.cur,
      layers: this.layers.map((l) => {
        const c = this.snapCache.get(l.id);
        let canvas;
        if (c && c.rev === l.rev && c.canvas.width === l.canvas.width && c.canvas.height === l.canvas.height) canvas = c.canvas;
        else { canvas = cloneCanvas(l.canvas); this.snapCache.set(l.id, { rev: l.rev, canvas }); }
        return { id: l.id, name: l.name, visible: l.visible, opacity: l.opacity, blend: l.blend, canvas, rev: l.rev };
      }),
      sel: this.sel ? cloneCanvas(this.sel.mask) : null,
    };
  }
  restore(s) {
    this.w = s.w; this.h = s.h; this.cur = s.cur;
    this.layers = s.layers.map((l) => ({ id: l.id, name: l.name, visible: l.visible, opacity: l.opacity, blend: l.blend, canvas: cloneCanvas(l.canvas), rev: l.rev }));
    for (const l of s.layers) this.snapCache.set(l.id, { rev: l.rev, canvas: l.canvas });
    this.setSelMask(s.sel ? cloneCanvas(s.sel) : null);
  }
  record(name, icon) {
    this.history.splice(this.hpos + 1);
    this.history.push({ name, icon, state: this.snapshot() });
    if (this.history.length > 40) this.history.splice(1, 1);
    this.hpos = this.history.length - 1;
    this.dirty = true;
  }
  composite(target = makeCanvas(this.w, this.h)) {
    const g = ctx2d(target);
    g.clearRect(0, 0, target.width, target.height);
    for (const l of this.layers) {
      if (!l.visible) continue;
      g.globalAlpha = l.opacity; g.globalCompositeOperation = gco(l.blend);
      g.drawImage(l.canvas, 0, 0);
    }
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    return target;
  }
  // ---- Selection ----
  setSelMask(mask) {
    if (!mask) { this.sel = null; return; }
    const g = ctx2d(mask), d = g.getImageData(0, 0, mask.width, mask.height).data, w = mask.width, hh = mask.height;
    const on = (x, y) => x >= 0 && y >= 0 && x < w && y < hh && d[(y * w + x) * 4 + 3] >= 128;
    const path = new Path2D();
    let any = false, l = w, t = hh, r = 0, b = 0;
    for (let y = 0; y <= hh; y++) {
      for (let x = 0; x <= w; x++) {
        const c = on(x, y);
        if (c) { any = true; if (x < l) l = x; if (y < t) t = y; if (x + 1 > r) r = x + 1; if (y + 1 > b) b = y + 1; }
        if (c !== on(x, y - 1)) { path.moveTo(x, y); path.lineTo(x + 1, y); }
        if (c !== on(x - 1, y)) { path.moveTo(x, y); path.lineTo(x, y + 1); }
      }
    }
    this.sel = any ? { mask, path, bounds: { x: l, y: t, w: r - l, h: b - t } } : null;
  }
  combineSel(shape, mode) {
    // shape: a canvas with the new area in alpha
    if (!this.sel || mode === 'replace') return this.setSelMask(shape);
    const m = cloneCanvas(this.sel.mask), g = ctx2d(m);
    g.globalCompositeOperation = { union: 'source-over', exclude: 'destination-out', intersect: 'destination-in', xor: 'xor' }[mode] || 'source-over';
    g.drawImage(shape, 0, 0);
    this.setSelMask(m);
  }
}

// ---------------------------------------------------------------------------
// The app
// ---------------------------------------------------------------------------

class PaintPro {
  constructor(win) {
    this.win = win;
    this.docs = [];
    this.doc = null;
    this.primary = [0, 0, 0, 255];
    this.secondary = [255, 255, 255, 255];
    this.palette = [...PALETTE];
    this.tool = 'brush';
    this.prevTool = 'brush';
    this.o = {
      width: 4, aa: true, brushType: 'normal', fillStyle: 'outline', radius: 20, dash: '', arrowStart: false, arrowEnd: false,
      tolerance: 50, floodMode: 'contiguous', sampling: 'layer', selMode: 'replace', gradType: 'linear', gradMode: 'color',
      pickSize: 1, pickLayer: 'layer', pickAfter: 'none', font: 'Sans-serif', fontSize: 24, bold: false, italic: false, underline: false, align: 'left', textFill: 'fill', outline: 2,
    };
    this.showGrid = false;
    this.build();
    this.newDoc(800, 600, { fill: '#ffffff', name: 'Untitled 1', record: true });
    this.setTool('brush');
    this.ants = setInterval(() => { if (this.doc?.sel) { this.antPhase = ((this.antPhase || 0) + 1) % 8; this.drawOverlay(); } }, 140);
  }

  destroy() {
    clearInterval(this.ants);
    removeEventListener('keydown', this.onKey, true);
    this.menu.close();
    this.ro?.disconnect();
  }

  // ---------------------------------------------------------------- layout

  build() {
    const m = (label, action, shortcut, extra = {}) => ({ label, action, shortcut, ...extra });
    const needSel = () => !this.doc?.sel;
    const hdr = (label) => ({ label: `— ${label} —`, disabled: () => true });
    this.menu = menuBar([
      { label: 'File', items: [m('New…', () => this.newDialog(), 'Ctrl+N'), m('New Screenshot…', () => this.screenshot()), m('Open…', () => this.open(), 'Ctrl+O'), '-',
        m('Save', () => this.save(), 'Ctrl+S'), m('Save As…', () => this.save(true), 'Ctrl+Shift+S'), '-', m('Close', () => this.closeDoc(this.doc), 'Ctrl+W')] },
      { label: 'Edit', items: [m('Undo', () => this.undo(), 'Ctrl+Z', { disabled: () => !(this.doc?.hpos > 0) }), m('Redo', () => this.redo(), 'Ctrl+Y', { disabled: () => !(this.doc && this.doc.hpos < this.doc.history.length - 1) }), '-',
        m('Cut', () => this.cut(), 'Ctrl+X'), m('Copy', () => this.copy(), 'Ctrl+C'), m('Copy Merged', () => this.copy(true), 'Ctrl+Shift+C'), m('Paste', () => this.paste(), 'Ctrl+V'),
        m('Paste Into New Layer', () => this.paste('layer'), 'Ctrl+Shift+V'), m('Paste Into New Image', () => this.paste('image'), 'Ctrl+Alt+V'), '-',
        m('Select All', () => this.selectAll(), 'Ctrl+A'), m('Deselect All', () => this.deselect(), 'Ctrl+Shift+A'), m('Erase Selection', () => this.eraseSelection(), 'Delete'),
        m('Fill Selection', () => this.fillSelection(), 'Backspace'), m('Invert Selection', () => this.invertSelection(), 'Ctrl+I'), '-', m('Reset Palette', () => { this.palette = [...PALETTE]; this.drawPalette(); })] },
      { label: 'View', items: [m('Zoom In', () => this.zoomStep(1), 'Ctrl++'), m('Zoom Out', () => this.zoomStep(-1), 'Ctrl+-'), m('Best Fit', () => this.bestFit(), 'Ctrl+B'), m('Actual Size', () => this.setZoom(1), 'Ctrl+0'), '-',
        m('Pixel Grid', () => { this.showGrid = !this.showGrid; this.drawOverlay(); }, '', { checked: () => this.showGrid }), m('Layers & History', () => this.root.classList.toggle('show-side'))] },
      { label: 'Image', items: [m('Crop to Selection', () => this.cropToSelection(), 'Ctrl+Shift+X', { disabled: needSel }), m('Auto Crop', () => this.autoCrop()), m('Resize Image…', () => this.resizeImage(), 'Ctrl+R'),
        m('Resize Canvas…', () => this.resizeCanvas(), 'Ctrl+Shift+R'), '-', m('Flip Horizontal', () => this.flipImage('h')), m('Flip Vertical', () => this.flipImage('v')),
        m('Rotate 90° Clockwise', () => this.rotateImage(90), 'Ctrl+H'), m('Rotate 90° Counter-Clockwise', () => this.rotateImage(-90), 'Ctrl+G'), m('Rotate 180°', () => this.rotateImage(180), 'Ctrl+J'), '-',
        m('Flatten', () => this.flatten(), 'Ctrl+Shift+F', { disabled: () => (this.doc?.layers.length || 0) < 2 })] },
      { label: 'Layers', items: [m('Add New Layer', () => this.addLayer(), 'Ctrl+Shift+N'), m('Delete Layer', () => this.deleteLayer(), 'Ctrl+Shift+Delete', { disabled: () => (this.doc?.layers.length || 0) < 2 }),
        m('Duplicate Layer', () => this.duplicateLayer(), 'Ctrl+Shift+D'), m('Merge Layer Down', () => this.mergeDown(), 'Ctrl+M', { disabled: () => !this.doc?.cur }), m('Import from File…', () => this.importLayer()), '-',
        m('Flip Horizontal', () => this.flipLayer('h')), m('Flip Vertical', () => this.flipLayer('v')), m('Rotate / Zoom Layer…', () => this.rotateZoomLayer()), '-',
        m('Move Layer Up', () => this.moveLayer(1)), m('Move Layer Down', () => this.moveLayer(-1)), m('Layer Properties…', () => this.layerProps(), 'F4')] },
      { label: 'Adjustments', items: ADJUSTMENTS.map((a) => m(a.name, () => this.runFx(a))) },
      { label: 'Effects', items: ['Artistic', 'Blurs', 'Distort', 'Noise', 'Photo', 'Render', 'Stylize'].flatMap((g) => [hdr(g), ...EFFECTS.filter((e) => e.group === g).map((e) => m(e.name, () => this.runFx(e)))]) },
      { label: 'Help', items: [m('About Paint Pro', () => dialog('About Paint Pro', h('div', {}, h('p', {}, h('strong', {}, 'Paint Pro'), ' — a MediaDesk image editor modelled on Pinta (pinta-project.com), the free and open-source program inspired by Paint.NET.'), h('p', {}, 'Layers, history, selections, 22 tools, 9 adjustments and 32 effects. Save as .ora (OpenRaster) to keep layers; Pinta and GIMP open those too.')), { buttons: [['OK', true, true]], cls: 'pp' }))] },
    ], 'pp');
    const ib = (icon, title, fn, disabled) => { const b = h('button', { class: 'pp-icon', type: 'button', title, 'aria-label': title, html: icon, onclick: fn }); b.isDisabled = disabled; return b; };
    this.headBtns = [
      ib(I.new, 'New image (Ctrl+N)', () => this.newDialog()), ib(I.open, 'Open (Ctrl+O)', () => this.open()), ib(I.save, 'Save (Ctrl+S)', () => this.save()),
      h('span', { class: 'pp-vsep' }),
      ib(I.undo, 'Undo (Ctrl+Z)', () => this.undo(), () => !(this.doc?.hpos > 0)), ib(I.redo, 'Redo (Ctrl+Y)', () => this.redo(), () => !(this.doc && this.doc.hpos < this.doc.history.length - 1)),
      h('span', { class: 'pp-vsep' }),
      ib(I.cut, 'Cut (Ctrl+X)', () => this.cut()), ib(I.copy, 'Copy (Ctrl+C)', () => this.copy()), ib(I.paste, 'Paste (Ctrl+V)', () => this.paste()),
      h('span', { class: 'pp-vsep' }),
      ib(I.crop, 'Crop to selection (Ctrl+Shift+X)', () => this.cropToSelection(), () => !this.doc?.sel), ib(I.deselect, 'Deselect all (Ctrl+Shift+A)', () => this.deselect(), () => !this.doc?.sel),
      h('span', { style: { flex: 1 } }),
      ib(I.panels, 'Layers and history', () => this.root.classList.toggle('show-side')),
    ];
    this.toolbar = h('div', { class: 'pp-toolbar' });
    this.toolsEl = h('div', { class: 'pp-tools' }, TOOLS.map((t) => h('button', { class: 'pp-tool', type: 'button', title: `${t.name} (${t.key})\n${t.help}`, 'aria-label': t.name, 'data-tool': t.id, html: t.icon, onclick: () => this.setTool(t.id) })));
    this.tabs = h('div', { class: 'pp-tabs' });
    this.view = h('canvas', { class: 'pp-view' });
    this.stage = h('div', { class: 'pp-stage' }, this.view);
    this.viewport = h('div', { class: 'pp-viewport', tabindex: '0' }, this.stage);
    this.overlay = h('canvas', { class: 'pp-overlay' });
    this.wrap = h('div', { style: { position: 'relative', flex: '1', minHeight: '0', display: 'flex' } }, this.viewport, this.overlay);
    this.layersEl = h('div', { class: 'pp-list' });
    this.histEl = h('div', { class: 'pp-list' });
    const pb = (icon, title, fn) => h('button', { class: 'pp-icon', type: 'button', title, 'aria-label': title, html: icon, onclick: fn });
    this.side = h('div', { class: 'pp-side' },
      h('div', { class: 'pp-panel layers' }, h('div', { class: 'pp-panel-head' }, 'Layers', h('div', { class: 'pp-panel-tools' },
        pb(I.add, 'Add new layer', () => this.addLayer()), pb(I.del, 'Delete layer', () => this.deleteLayer()), pb(I.dup, 'Duplicate layer', () => this.duplicateLayer()),
        pb(I.up, 'Move layer up', () => this.moveLayer(1)), pb(I.down, 'Move layer down', () => this.moveLayer(-1)), pb(I.merge, 'Merge layer down', () => this.mergeDown()), pb(I.props, 'Layer properties', () => this.layerProps()))), this.layersEl),
      h('div', { class: 'pp-panel history' }, h('div', { class: 'pp-panel-head' }, 'History'), this.histEl));
    this.primaryEl = h('button', { class: 'pp-primary', type: 'button', title: 'Primary colour (click to change)', onclick: () => this.pickColor('primary') }, h('span'));
    this.secondaryEl = h('button', { class: 'pp-secondary', type: 'button', title: 'Secondary colour (click to change)', onclick: () => this.pickColor('secondary') }, h('span'));
    this.paletteEl = h('div', { class: 'pp-palette' });
    this.posEl = h('span', {});
    this.selEl = h('span', {});
    this.zoomSel = h('select', { title: 'Zoom', onchange: (e) => this.setZoom(Number(e.target.value)) });
    this.bottom = h('div', { class: 'pp-bottom' },
      h('div', { class: 'pp-colors' }, this.secondaryEl, this.primaryEl, h('button', { class: 'pp-swap', type: 'button', title: 'Swap colours (X)', onclick: () => this.swapColors() }, '⇄')),
      this.paletteEl, h('div', { class: 'pp-status' }, this.posEl, this.selEl, this.zoomSel));
    this.root = h('div', { class: 'pp pp-root' },
      h('div', { class: 'pp-head' }, this.menu, ...this.headBtns),
      this.toolbar,
      h('div', { class: 'pp-main' }, this.toolsEl, h('div', { class: 'pp-center' }, this.tabs, this.wrap), this.side),
      this.bottom);
    clear(this.win.body, this.root);
    this.drawPalette();
    // Pointer input: on the whole viewport, so selections can start outside the picture.
    for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) this.viewport.addEventListener(ev, (e) => this.pointer(e));
    this.viewport.addEventListener('contextmenu', (e) => e.preventDefault());
    this.viewport.addEventListener('pointerleave', () => { this.posEl.textContent = ''; this.hover = null; this.drawOverlay(); });
    this.viewport.addEventListener('scroll', () => this.drawOverlay());
    this.viewport.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      this.zoomStep(e.deltaY < 0 ? 1 : -1, this.pos(e));
    }, { passive: false });
    this.viewport.addEventListener('dblclick', () => { if (this.shape) this.commitShape(); });
    this.ro = new ResizeObserver(() => this.sizeOverlay());
    this.ro.observe(this.wrap);
    this.onKey = (e) => this.key(e);
    addEventListener('keydown', this.onKey, true);
    this.win.body.addEventListener('paste', (e) => {
      const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
      if (item && !e.target.closest('textarea, input')) { e.preventDefault(); decodePicture(item.getAsFile()).then((p) => this.pasteCanvas(p.image)); }
    });
    // Drop pictures from this computer: each opens as a new image.
    this.viewport.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
    this.viewport.addEventListener('drop', async (e) => {
      e.preventDefault();
      for (const f of e.dataTransfer.files) { try { const p = await decodePicture(f, f.name); this.openDoc(p, f.name, null); } catch (err) { toastError(err, `Couldn’t open ${f.name}`); } }
    });
  }

  refreshChrome() {
    for (const b of this.headBtns) if (b.isDisabled) b.disabled = b.isDisabled();
    this.drawTabs();
    this.drawLayers();
    this.drawHistory();
    const d = this.doc;
    clear(this.zoomSel, ZOOMS.concat(d && !ZOOMS.includes(d.zoom) ? [d.zoom] : []).sort((a, b) => a - b).map((z) => h('option', { value: z, selected: d?.zoom === z }, `${Math.round(z * 1000) / 10}%`)));
    this.selEl.textContent = d?.sel ? `Selection ${d.sel.bounds.w} × ${d.sel.bounds.h}` : d ? `${d.w} × ${d.h}` : '';
    this.win.setTitle?.(d ? `${d.name}${d.dirty ? '*' : ''} - Paint Pro` : 'Paint Pro');
  }

  drawTabs() {
    clear(this.tabs, this.docs.map((d) => h('div', { class: `pp-tab ${d === this.doc ? 'on' : ''}`, onclick: () => this.switchDoc(d), title: d.name },
      h('span', {}, `${d.name}${d.dirty ? ' •' : ''}`), h('button', { class: 'pp-tab-x', type: 'button', 'aria-label': 'Close', onclick: (e) => { e.stopPropagation(); this.closeDoc(d); } }, '×'))));
  }

  drawLayers() {
    const d = this.doc;
    if (!d) return clear(this.layersEl);
    clear(this.layersEl, [...d.layers].map((l, i) => [l, i]).reverse().map(([l, i]) => {
      const thumb = makeCanvas(44, 33), tg = ctx2d(thumb);
      const s = Math.min(44 / d.w, 33 / d.h);
      tg.drawImage(l.canvas, (44 - d.w * s) / 2, (33 - d.h * s) / 2, d.w * s, d.h * s);
      const vis = h('button', { class: 'pp-icon', type: 'button', title: l.visible ? 'Hide layer' : 'Show layer', html: l.visible ? I.eye : I.eyeOff, style: { width: '22px', height: '22px' },
        onclick: (e) => { e.stopPropagation(); l.visible = !l.visible; d.record(l.visible ? 'Layer Shown' : 'Layer Hidden', I.eye); this.render(); } });
      return h('div', { class: `pp-layer ${i === d.cur ? 'on' : ''}`, onclick: () => { this.commitPending(); d.cur = i; this.refreshChrome(); }, ondblclick: () => this.layerProps() },
        vis, thumb, h('div', {}, h('div', { class: 'pp-layer-name' }, l.name), h('div', { class: 'pp-layer-sub' }, `${Math.round(l.opacity * 100)}% · ${BLENDS.find((b) => b[0] === l.blend)?.[1] || 'Normal'}`)));
    }));
  }

  drawHistory() {
    const d = this.doc;
    if (!d) return clear(this.histEl);
    clear(this.histEl, d.history.map((e, i) => h('div', { class: `pp-hist ${i === d.hpos ? 'on' : ''} ${i > d.hpos ? 'future' : ''}`, onclick: () => this.goHistory(i) }, h('span', { html: e.icon || I.props }), e.name)));
    this.histEl.querySelector('.pp-hist.on')?.scrollIntoView({ block: 'nearest' });
  }

  drawPalette() {
    this.primaryEl.firstChild.style.background = rgbaCss(this.primary);
    this.secondaryEl.firstChild.style.background = rgbaCss(this.secondary);
    clear(this.paletteEl, this.palette.map((c, i) => h('button', {
      class: 'pp-pal', type: 'button', style: { background: c }, title: `${c} — left click: primary, right click: secondary, Shift+click: set to the primary colour`,
      onpointerdown: (e) => {
        e.preventDefault();
        if (e.shiftKey) { this.palette[i] = rgbaToHex(this.primary); this.drawPalette(); return; }
        if (e.button === 2) this.secondary = hexToRgba(c); else this.primary = hexToRgba(c);
        this.drawPalette();
      },
      oncontextmenu: (e) => e.preventDefault(),
    })));
  }
  swapColors() { [this.primary, this.secondary] = [this.secondary, this.primary]; this.drawPalette(); }

  // ---------------------------------------------------------------- documents

  newDoc(w, hgt, { fill = '#ffffff', name, record = true } = {}) {
    const d = new Doc(w, hgt, { fill, name: name || `Untitled ${this.docs.length + 1}` });
    if (record) { d.record('New Image', I.new); d.dirty = false; }
    this.docs.push(d);
    this.switchDoc(d);
    this.bestFit(true);
    return d;
  }
  openDoc(pic, name, file) {
    const d = new Doc(pic.image.width, pic.image.height, { fill: null, name });
    if (pic.layers?.length) {
      d.layers = [];
      for (const l of pic.layers) { const nl = d.addLayer(l.name); ctx2d(nl.canvas).drawImage(l.canvas, 0, 0); Object.assign(nl, { visible: l.visible, opacity: l.opacity, blend: l.blend }); }
    } else ctx2d(d.layer.canvas).drawImage(pic.image, 0, 0);
    d.file = file;
    d.record('Open Image', I.open);
    d.dirty = false;
    // Replace a blank, untouched first document.
    const blank = this.docs.length === 1 && !this.docs[0].dirty && this.docs[0].history.length === 1 && !this.docs[0].file;
    if (blank) this.docs = [];
    this.docs.push(d);
    this.switchDoc(d);
    this.bestFit(true);
  }
  switchDoc(d) {
    this.commitPending();
    this.doc = d;
    this.sizeStage();
    this.render();
  }
  async closeDoc(d) {
    if (!d) return;
    if (d.dirty && !(await confirmDialog({ title: 'Close image', message: `Close “${d.name}” without saving? Your changes will be lost.`, confirm: 'Close without saving', danger: true }))) return;
    if (d === this.doc) this.commitPending();
    const i = this.docs.indexOf(d);
    this.docs.splice(i, 1);
    if (!this.docs.length) return this.newDoc(800, 600, { name: 'Untitled 1' });
    if (d === this.doc) this.switchDoc(this.docs[Math.max(0, i - 1)]);
    else this.refreshChrome();
  }

  // ---------------------------------------------------------------- view

  sizeStage() {
    const d = this.doc;
    if (!d) return;
    // Resizing a canvas clears it: draw the picture again afterwards.
    const resized = this.view.width !== d.w || this.view.height !== d.h;
    if (resized) { this.view.width = d.w; this.view.height = d.h; }
    this.view.style.width = `${d.w * d.zoom}px`;
    this.view.style.height = `${d.h * d.zoom}px`;
    this.view.classList.toggle('pixelated', d.zoom >= 2);
    this.stage.style.width = `${d.w * d.zoom}px`;
    this.stage.style.height = `${d.h * d.zoom}px`;
    // Centre the picture when it's smaller than the window.
    const vw = this.viewport.clientWidth, vh = this.viewport.clientHeight;
    this.stage.style.marginLeft = `${Math.max(24, (vw - d.w * d.zoom) / 2)}px`;
    this.stage.style.marginTop = `${Math.max(24, (vh - d.h * d.zoom) / 2)}px`;
    this.sizeOverlay();
    if (resized) this.render();
  }
  sizeOverlay() {
    const r = this.wrap.getBoundingClientRect();
    const dpr = devicePixelRatio || 1;
    this.overlay.width = Math.max(1, Math.round(r.width * dpr));
    this.overlay.height = Math.max(1, Math.round(r.height * dpr));
    this.overlay.style.width = `${r.width}px`;
    this.overlay.style.height = `${r.height}px`;
    this.drawOverlay();
  }
  setZoom(z, at) {
    const d = this.doc;
    if (!d) return;
    z = Math.max(0.02, Math.min(32, z));
    // Keep the point under the cursor (or the centre) still.
    const vp = this.viewport, vr = this.view.getBoundingClientRect(), wr = vp.getBoundingClientRect();
    const focus = at || { x: (wr.left + wr.width / 2 - vr.left) / d.zoom, y: (wr.top + wr.height / 2 - vr.top) / d.zoom };
    const screenX = vr.left - wr.left + focus.x * d.zoom, screenY = vr.top - wr.top + focus.y * d.zoom;
    d.zoom = z;
    this.sizeStage();
    const nr = this.view.getBoundingClientRect();
    vp.scrollLeft += (nr.left - wr.left + focus.x * z) - screenX;
    vp.scrollTop += (nr.top - wr.top + focus.y * z) - screenY;
    this.styleText();
    this.refreshChrome();
    this.drawOverlay();
  }
  zoomStep(dir, at) {
    const z = this.doc.zoom;
    const next = dir > 0 ? ZOOMS.find((v) => v > z + 1e-6) : [...ZOOMS].reverse().find((v) => v < z - 1e-6);
    if (next) this.setZoom(next, at);
  }
  bestFit(onlyShrink = false) {
    const d = this.doc;
    const vw = this.viewport.clientWidth - 48, vh = this.viewport.clientHeight - 48;
    if (vw <= 0 || vh <= 0) { d.zoom = 1; this.sizeStage(); return; }
    let z = Math.min(vw / d.w, vh / d.h);
    if (onlyShrink) z = Math.min(1, z);
    this.setZoom(Math.max(0.02, Math.floor(z * 100) / 100));
  }
  // Image coordinates of a pointer event.
  pos(e) {
    const r = this.view.getBoundingClientRect(), z = this.doc.zoom;
    return { x: (e.clientX - r.left) / z, y: (e.clientY - r.top) / z };
  }
  // Screen (overlay) transform for image coordinates.
  toScreen() {
    const r = this.view.getBoundingClientRect(), w = this.wrap.getBoundingClientRect();
    return { ox: r.left - w.left, oy: r.top - w.top, z: this.doc.zoom };
  }

  // Draw the picture: layers in order, with the current tool's work in progress.
  render() {
    const d = this.doc;
    if (!d) return;
    const g = ctx2d(this.view);
    g.clearRect(0, 0, d.w, d.h);
    d.layers.forEach((l, i) => {
      if (!l.visible) return;
      let src = l.canvas;
      if (i === d.cur && this.live) src = this.liveLayer();
      g.globalAlpha = l.opacity; g.globalCompositeOperation = gco(l.blend);
      g.drawImage(src, 0, 0);
    });
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    this.drawOverlay();
    this.refreshChrome();
  }
  // The current layer with the work in progress applied (what committing would produce).
  liveLayer() {
    const d = this.doc, l = d.layer, lv = this.live;
    if (lv.mode === 'replace') return lv.canvas;
    const out = this.scratch(d.w, d.h, 'live');
    const g = ctx2d(out);
    g.globalCompositeOperation = 'copy'; g.drawImage(l.canvas, 0, 0);
    g.globalCompositeOperation = lv.mode === 'erase' ? 'destination-out' : 'source-over';
    g.drawImage(this.masked(lv.canvas), 0, 0);
    g.globalCompositeOperation = 'source-over';
    return out;
  }
  // A canvas limited to the selection.
  masked(c) {
    const d = this.doc;
    if (!d.sel) return c;
    const out = this.scratch(c.width, c.height, 'mask'), g = ctx2d(out);
    g.globalCompositeOperation = 'copy'; g.drawImage(c, 0, 0);
    g.globalCompositeOperation = 'destination-in'; g.drawImage(d.sel.mask, 0, 0);
    g.globalCompositeOperation = 'source-over';
    return out;
  }
  scratch(w, hgt, key) {
    this.scratches ||= {};
    let c = this.scratches[key];
    if (!c || c.width !== w || c.height !== hgt) { c = makeCanvas(w, hgt); this.scratches[key] = c; }
    return c;
  }
  // Commit the work in progress to the current layer.
  commitLive(name, icon) {
    const d = this.doc, lv = this.live;
    if (!lv) return;
    const result = this.liveLayer();
    const g = ctx2d(d.layer.canvas);
    g.globalCompositeOperation = 'copy'; g.drawImage(result, 0, 0); g.globalCompositeOperation = 'source-over';
    this.live = null;
    d.touch();
    d.record(name, icon);
    this.render();
  }

  drawOverlay() {
    const c = this.overlay, g = c.getContext('2d'), dpr = devicePixelRatio || 1;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, c.width, c.height);
    const d = this.doc;
    if (!d) return;
    const { ox, oy, z } = this.toScreen();
    g.setTransform(dpr * z, 0, 0, dpr * z, dpr * ox, dpr * oy);
    // Pixel grid
    if (this.showGrid && z >= 6) {
      g.beginPath();
      for (let x = 0; x <= d.w; x++) { g.moveTo(x, 0); g.lineTo(x, d.h); }
      for (let y = 0; y <= d.h; y++) { g.moveTo(0, y); g.lineTo(d.w, y); }
      g.strokeStyle = 'rgba(128,128,128,.45)'; g.lineWidth = 1 / z; g.stroke();
    }
    const sel = this.moving?.selPath ? this.moving : d.sel;
    // Marching ants
    if (sel) {
      g.save();
      if (this.moving?.selPath) { g.translate(this.moving.dx, this.moving.dy); }
      const path = sel.selPath || sel.path;
      g.lineWidth = 1 / z;
      g.setLineDash([]); g.strokeStyle = '#fff'; g.stroke(path);
      g.setLineDash([4 / z, 4 / z]); g.lineDashOffset = -(this.antPhase || 0) / z; g.strokeStyle = '#000'; g.stroke(path);
      g.restore();
    }
    // Tool overlays
    g.setLineDash([]);
    this.toolOverlay?.(g, z);
    // Brush outline under the cursor
    if (this.hover && ['brush', 'eraser', 'clone', 'recolor'].includes(this.tool)) {
      g.beginPath(); g.arc(this.hover.x, this.hover.y, this.o.width / 2, 0, Math.PI * 2);
      g.lineWidth = 1 / z; g.strokeStyle = 'rgba(0,0,0,.7)'; g.stroke();
      g.beginPath(); g.arc(this.hover.x, this.hover.y, this.o.width / 2 + 1 / z, 0, Math.PI * 2); g.strokeStyle = 'rgba(255,255,255,.7)'; g.stroke();
    }
    if (this.cloneSrc && this.tool === 'clone') {
      const s = this.cloneSrc;
      g.lineWidth = 1.5 / z; g.strokeStyle = '#ff2d55';
      g.beginPath(); g.moveTo(s.x - 6 / z, s.y); g.lineTo(s.x + 6 / z, s.y); g.moveTo(s.x, s.y - 6 / z); g.lineTo(s.x, s.y + 6 / z); g.stroke();
    }
  }
  handle(g, p, z, color = '#3584e4') {
    g.beginPath(); g.arc(p.x, p.y, 4.5 / z, 0, Math.PI * 2);
    g.fillStyle = '#fff'; g.fill(); g.lineWidth = 1.5 / z; g.strokeStyle = color; g.stroke();
  }

  // ---------------------------------------------------------------- tools

  setTool(id) {
    if (id === this.tool && this.toolbarBuilt) return;
    this.commitPending();
    if (!['picker', 'zoom', 'pan'].includes(id)) this.prevTool = id;
    this.tool = id;
    this.toolOverlay = null;
    this.toolsEl.querySelectorAll('.pp-tool').forEach((b) => b.classList.toggle('on', b.dataset.tool === id));
    this.viewport.style.cursor = { pan: 'grab', zoom: 'zoom-in', text: 'text', movesel: 'move', moveselection: 'move', picker: 'crosshair' }[id] || 'crosshair';
    this.buildToolbar();
    this.toolbarBuilt = true;
    this.drawOverlay();
  }
  commitPending() {
    if (this.text) this.commitText();
    if (this.shape) this.commitShape();
    if (this.moving) this.finishMove();
    if (this.fxPreview) this.fxPreview.cancel();
  }

  buildToolbar() {
    const t = TOOL_BY_ID[this.tool], o = this.o;
    const label = (text, ...ctl) => h('label', {}, text, ...ctl);
    const numIn = (key, min, max, step = 1) => h('input', { type: 'number', min, max, step, value: o[key], onchange: (e) => { o[key] = Math.max(min, Math.min(max, Number(e.target.value) || min)); e.target.value = o[key]; this.onOptions(); } });
    const selIn = (key, opts) => h('select', { onchange: (e) => { o[key] = /^\d+$/.test(e.target.value) ? Number(e.target.value) : e.target.value; this.onOptions(); } }, opts.map(([v, l]) => h('option', { value: v, selected: String(o[key]) === String(v) }, l)));
    const seg = (key, opts) => h('div', { class: 'pp-seg' }, opts.map(([v, l, title]) => h('button', { type: 'button', class: o[key] === v ? 'on' : '', title: title || l, html: l.startsWith('<svg') ? l : null, onclick: (e) => { o[key] = v; e.currentTarget.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.currentTarget)); this.onOptions(); } }, l.startsWith('<svg') ? null : l)));
    const check = (key, text) => h('label', {}, h('input', { type: 'checkbox', checked: o[key], onchange: (e) => { o[key] = e.target.checked; this.onOptions(); } }), text);
    const width = () => label('Brush width', numIn('width', 1, 1000), h('input', { type: 'range', min: 1, max: 200, value: o.width, oninput: (e) => { o.width = Number(e.target.value); e.target.previousElementSibling.value = o.width; this.drawOverlay(); } }));
    const aa = () => seg('aa', [[true, 'Smooth', 'Antialiasing on'], [false, 'Jagged', 'Antialiasing off']]);
    const selMode = () => label('Selection mode', seg('selMode', [['replace', 'Replace'], ['union', 'Union'], ['exclude', 'Exclude'], ['xor', 'Xor'], ['intersect', 'Intersect']]));
    const flood = () => [label('Flood mode', seg('floodMode', [['contiguous', 'Contiguous'], ['global', 'Global']])), label('Tolerance', numIn('tolerance', 0, 100), '%'), label('Sampling', selIn('sampling', [['layer', 'Layer'], ['image', 'Image']]))];
    const fill = () => label('Fill style', seg('fillStyle', [['outline', 'Outline'], ['fill', 'Fill'], ['both', 'Outline + fill']]));
    const dash = () => label('Dash', selIn('dash', [['', 'Solid'], ['8 4', '— — —'], ['2 4', '· · · ·'], ['12 4 2 4', '— · — ·']]));
    const items = {
      movesel: [h('span', {}, 'Drag to move the selection’s pixels; right-drag to rotate. Hold Shift to move in straight lines.')],
      moveselection: [h('span', {}, 'Drag to move the selection outline.')],
      zoom: [h('span', {}, 'Click: zoom in · right-click: zoom out · drag: zoom to an area')],
      pan: [h('span', {}, 'Drag to move around. Tip: hold Space with any tool, or use the middle mouse button.')],
      rectsel: [selMode()], ellipsesel: [selMode()], lasso: [selMode()],
      wand: [selMode(), ...flood()],
      brush: [width(), aa(), label('Brush', selIn('brushType', [['normal', 'Normal'], ['circles', 'Circles'], ['grid', 'Grid'], ['splatter', 'Splatter'], ['squares', 'Squares']]))],
      pencil: [h('span', {}, 'One pixel wide, no smoothing. Shift+click draws a straight line from the last point.')],
      eraser: [width(), aa()],
      bucket: [...flood(), aa()],
      gradient: [label('Type', seg('gradType', [['linear', 'Linear'], ['reflected', 'Reflected'], ['diamond', 'Diamond'], ['radial', 'Radial'], ['conical', 'Conical']])),
        label('Mode', seg('gradMode', [['color', 'Color'], ['transparency', 'Transparency']]))],
      picker: [label('Sampling', selIn('pickSize', [[1, 'Single pixel'], [3, '3 × 3 region'], [5, '5 × 5 region'], [7, '7 × 7 region'], [9, '9 × 9 region']])), label('From', selIn('pickLayer', [['layer', 'Layer'], ['image', 'Image']])),
        label('After select', selIn('pickAfter', [['none', 'Do not switch tool'], ['previous', 'Switch to previous tool'], ['pencil', 'Switch to Pencil tool']]))],
      text: [label('Font', selIn('font', [['Sans-serif', 'Sans-serif'], ['Serif', 'Serif'], ['Monospace', 'Monospace'], ['Arial', 'Arial'], ['Helvetica', 'Helvetica'], ['Times New Roman', 'Times New Roman'], ['Georgia', 'Georgia'], ['Courier New', 'Courier New'], ['Verdana', 'Verdana'], ['Trebuchet MS', 'Trebuchet MS'], ['Impact', 'Impact'], ['Comic Sans MS', 'Comic Sans MS'], ['Cantarell', 'Cantarell']])),
        label('Size', numIn('fontSize', 4, 500)), seg('bold', [[true, 'B', 'Bold']]), seg('italic', [[true, 'I', 'Italic']]), seg('underline', [[true, 'U', 'Underline']]),
        label('Align', seg('align', [['left', 'Left'], ['center', 'Center'], ['right', 'Right']])), label('Fill', seg('textFill', [['fill', 'Fill'], ['outline', 'Outline'], ['both', 'Fill + outline']])), label('Outline width', numIn('outline', 1, 100)), aa()],
      line: [width(), aa(), dash(), check('arrowStart', 'Arrow at start'), check('arrowEnd', 'Arrow at end')],
      rect: [width(), fill(), aa(), dash()],
      roundrect: [width(), fill(), label('Radius', numIn('radius', 0, 1000)), aa(), dash()],
      ellipse: [width(), fill(), aa(), dash()],
      freeform: [width(), fill(), aa(), dash()],
      clone: [width(), aa(), h('span', {}, this.cloneSrc ? 'Source set — paint to copy.' : 'Ctrl+click to set the source.')],
      recolor: [width(), label('Tolerance', numIn('tolerance', 0, 100), '%'), aa()],
    }[t.id] || [];
    // Toggle buttons (B / I / U) behave as on/off.
    clear(this.toolbar, h('span', { class: 'pp-tool-title' }, t.name), items);
    this.toolbar.querySelectorAll('.pp-seg').forEach((s) => {
      if (s.children.length !== 1) return;
      const b = s.firstChild, key = ['B', 'I', 'U'].indexOf(b.textContent);
      if (key < 0) return;
      const k = ['bold', 'italic', 'underline'][key];
      b.classList.toggle('on', o[k]);
      b.onclick = () => { o[k] = !o[k]; b.classList.toggle('on', o[k]); this.onOptions(); };
    });
  }
  onOptions() {
    this.styleText();
    if (this.shape) this.drawShape();
    this.drawOverlay();
  }

  // ---------------------------------------------------------------- pointer

  pointer(e) {
    const d = this.doc;
    if (!d || this.fxPreview) return;
    const p = this.pos(e);
    if (e.type === 'pointermove') {
      this.hover = p;
      const inside = p.x >= 0 && p.y >= 0 && p.x < d.w && p.y < d.h;
      this.posEl.textContent = inside ? `${Math.floor(p.x)}, ${Math.floor(p.y)}` : '';
    }
    // Middle button or Space: pan with any tool.
    if (e.type === 'pointerdown' && (e.button === 1 || this.spaceDown)) {
      e.preventDefault();
      this.panning = { x: e.clientX, y: e.clientY, sl: this.viewport.scrollLeft, st: this.viewport.scrollTop };
      try { this.viewport.setPointerCapture(e.pointerId); } catch { /* fine */ }
      return;
    }
    if (this.panning) {
      if (e.type === 'pointermove') { this.viewport.scrollLeft = this.panning.sl - (e.clientX - this.panning.x); this.viewport.scrollTop = this.panning.st - (e.clientY - this.panning.y); }
      if (e.type === 'pointerup' || e.type === 'pointercancel') this.panning = null;
      return;
    }
    if (e.type === 'pointerdown') {
      if (e.button !== 0 && e.button !== 2) return;
      this.viewport.focus({ preventScroll: true });
      try { this.viewport.setPointerCapture(e.pointerId); } catch { /* fine */ }
      this.drag = { start: p, last: p, btn: e.button, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey };
    }
    const dr = this.drag;
    const fn = this[`t_${this.tool}`];
    if (fn && (dr || e.type === 'pointermove')) fn.call(this, e.type, p, dr, e);
    if (dr) dr.last = p;
    if (e.type === 'pointerup' || e.type === 'pointercancel') this.drag = null;
    if (e.type === 'pointermove' && !dr) this.drawOverlay();
  }
  color(btn) { return btn === 2 ? this.secondary : this.primary; }
  other(btn) { return btn === 2 ? this.primary : this.secondary; }

  // Pan / zoom
  t_pan(type, p, dr, e) {
    if (!dr) return;
    if (type === 'pointerdown') { dr.sl = this.viewport.scrollLeft; dr.st = this.viewport.scrollTop; dr.cx = e.clientX; dr.cy = e.clientY; this.viewport.style.cursor = 'grabbing'; }
    if (type === 'pointermove') { this.viewport.scrollLeft = dr.sl - (e.clientX - dr.cx); this.viewport.scrollTop = dr.st - (e.clientY - dr.cy); }
    if (type === 'pointerup') this.viewport.style.cursor = 'grab';
  }
  t_zoom(type, p, dr) {
    if (!dr) return;
    const box = () => ({ x: Math.min(dr.start.x, p.x), y: Math.min(dr.start.y, p.y), w: Math.abs(p.x - dr.start.x), h: Math.abs(p.y - dr.start.y) });
    if (type === 'pointermove') { const b = box(); this.toolOverlay = (g, z) => { g.lineWidth = 1 / z; g.strokeStyle = '#3584e4'; g.strokeRect(b.x, b.y, b.w, b.h); }; this.drawOverlay(); }
    if (type !== 'pointerup') return;
    this.toolOverlay = null;
    const b = box();
    if (b.w * this.doc.zoom > 8 && b.h * this.doc.zoom > 8) {
      const z = Math.min((this.viewport.clientWidth - 48) / b.w, (this.viewport.clientHeight - 48) / b.h);
      this.setZoom(Math.min(32, z), { x: b.x + b.w / 2, y: b.y + b.h / 2 });
    } else this.zoomStep(dr.btn === 2 || dr.alt ? -1 : 1, p);
  }

  // Selections
  selShape(drawFn) {
    const c = makeCanvas(this.doc.w, this.doc.h), g = ctx2d(c);
    g.fillStyle = '#fff';
    drawFn(g);
    return c;
  }
  selRect(dr, p, ellipse) {
    let x0 = dr.start.x, y0 = dr.start.y, x1 = p.x, y1 = p.y;
    if (dr.shift || this.shiftDown) { const s = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)); x1 = x0 + Math.sign(x1 - x0 || 1) * s; y1 = y0 + Math.sign(y1 - y0 || 1) * s; }
    if (!ellipse) { x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1); }
    return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
  }
  t_rectsel(type, p, dr) { this.boxSelect(type, p, dr, false); }
  t_ellipsesel(type, p, dr) { this.boxSelect(type, p, dr, true); }
  boxSelect(type, p, dr, ellipse) {
    if (!dr) return;
    const b = this.selRect(dr, p, ellipse);
    this.toolOverlay = (g, z) => {
      g.lineWidth = 1 / z; g.strokeStyle = '#3584e4'; g.setLineDash([4 / z, 3 / z]);
      g.beginPath(); if (ellipse) g.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2); else g.rect(b.x, b.y, b.w, b.h); g.stroke();
      g.setLineDash([]);
    };
    this.selEl.textContent = `Selection ${Math.round(b.w)} × ${Math.round(b.h)}`;
    this.drawOverlay();
    if (type !== 'pointerup') return;
    this.toolOverlay = null;
    if (b.w < 1 || b.h < 1) { if (this.o.selMode === 'replace') this.deselect(); else this.drawOverlay(); return; }
    this.doc.combineSel(this.selShape((g) => { if (ellipse) { g.beginPath(); g.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2); g.fill(); } else g.fillRect(b.x, b.y, b.w, b.h); }), this.o.selMode);
    this.doc.record(ellipse ? 'Ellipse Select' : 'Rectangle Select', ellipse ? I.ellipsesel : I.rectsel);
    this.render();
  }
  t_lasso(type, p, dr) {
    if (!dr) return;
    if (type === 'pointerdown') this.lassoPts = [p];
    if (type === 'pointermove') this.lassoPts.push(p);
    const pts = this.lassoPts;
    this.toolOverlay = (g, z) => { g.lineWidth = 1 / z; g.strokeStyle = '#3584e4'; g.beginPath(); pts.forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y))); g.stroke(); };
    this.drawOverlay();
    if (type !== 'pointerup') return;
    this.toolOverlay = null;
    if (pts.length < 3) return this.drawOverlay();
    this.doc.combineSel(this.selShape((g) => { g.beginPath(); pts.forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y))); g.closePath(); g.fill(); }), this.o.selMode);
    this.doc.record('Lasso Select', I.lasso);
    this.render();
  }
  sampleImage(which) { return which === 'image' ? ctx2d(this.doc.composite()).getImageData(0, 0, this.doc.w, this.doc.h) : ctx2d(this.doc.layer.canvas).getImageData(0, 0, this.doc.w, this.doc.h); }
  maskToCanvas(mask, rgba = [255, 255, 255, 255]) {
    const d = this.doc, c = makeCanvas(d.w, d.h), g = ctx2d(c), img = g.createImageData(d.w, d.h);
    for (let i = 0; i < mask.length; i++) if (mask[i]) { const j = i * 4; img.data[j] = rgba[0]; img.data[j + 1] = rgba[1]; img.data[j + 2] = rgba[2]; img.data[j + 3] = rgba[3]; }
    g.putImageData(img, 0, 0);
    return c;
  }
  t_wand(type, p, dr) {
    if (type !== 'pointerdown') return;
    const d = this.doc;
    if (p.x < 0 || p.y < 0 || p.x >= d.w || p.y >= d.h) return;
    const mask = colorMask(this.sampleImage(this.o.sampling), p.x, p.y, this.o.tolerance, this.o.floodMode === 'contiguous');
    // Right-click subtracts, Ctrl adds (as in Pinta).
    const mode = dr.btn === 2 ? 'exclude' : dr.ctrl ? 'union' : this.o.selMode;
    d.combineSel(this.maskToCanvas(mask), mode);
    d.record('Magic Wand Select', I.wand);
    this.render();
  }
  t_moveselection(type, p, dr) {
    const d = this.doc;
    if (!dr || !d.sel) return;
    if (type === 'pointerdown') this.moving = { selOnly: true, selPath: d.sel.path, dx: 0, dy: 0 };
    if (!this.moving) return;
    this.moving.dx = Math.round(p.x - dr.start.x); this.moving.dy = Math.round(p.y - dr.start.y);
    this.drawOverlay();
    if (type === 'pointerup') this.finishMove();
  }

  // Move Selected: lift the pixels, move (or rotate) them, drop them on release.
  t_movesel(type, p, dr) {
    const d = this.doc;
    if (!dr) return;
    if (type === 'pointerdown') {
      if (!this.moving || this.moving.selOnly) this.liftSelection();
      const m = this.moving;
      m.start = { dx: m.dx, dy: m.dy, angle: m.angle };
      m.rotate = dr.btn === 2;
    }
    const m = this.moving;
    if (!m) return;
    if (m.rotate) {
      const c = m.center, a0 = Math.atan2(dr.start.y - c.y - m.start.dy, dr.start.x - c.x - m.start.dx), a1 = Math.atan2(p.y - c.y - m.start.dy, p.x - c.x - m.start.dx);
      m.angle = m.start.angle + (a1 - a0);
      if (this.shiftDown) m.angle = Math.round(m.angle / (Math.PI / 12)) * (Math.PI / 12);
    } else {
      let dx = p.x - dr.start.x, dy = p.y - dr.start.y;
      if (this.shiftDown) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      m.dx = Math.round(m.start.dx + dx); m.dy = Math.round(m.start.dy + dy);
    }
    this.updateMove();
    if (type === 'pointerup') this.selEl.textContent = `Moved ${m.dx}, ${m.dy}${m.angle ? ` · ${Math.round((m.angle * 180) / Math.PI)}°` : ''}`;
  }
  liftSelection(floating) {
    const d = this.doc, l = d.layer;
    const base = cloneCanvas(l.canvas);
    let piece;
    if (floating) piece = floating;
    else {
      piece = cloneCanvas(this.masked(l.canvas));
      const g = ctx2d(base);
      if (d.sel) { g.globalCompositeOperation = 'destination-out'; g.drawImage(d.sel.mask, 0, 0); g.globalCompositeOperation = 'source-over'; } else g.clearRect(0, 0, d.w, d.h);
    }
    const b = d.sel?.bounds || { x: 0, y: 0, w: d.w, h: d.h };
    this.moving = { base, piece, mask: d.sel ? cloneCanvas(d.sel.mask) : null, dx: 0, dy: 0, angle: 0, center: { x: b.x + b.w / 2, y: b.y + b.h / 2 }, out: makeCanvas(d.w, d.h) };
    this.live = { mode: 'replace', canvas: this.moving.out };
    this.updateMove();
  }
  updateMove() {
    const m = this.moving, d = this.doc;
    const transform = (g) => { g.translate(m.center.x + m.dx, m.center.y + m.dy); g.rotate(m.angle); g.translate(-m.center.x, -m.center.y); };
    const g = ctx2d(m.out);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, d.w, d.h);
    g.drawImage(m.base, 0, 0);
    g.save(); transform(g); g.drawImage(m.piece, 0, 0); g.restore();
    // The selection travels with the pixels.
    if (m.mask) {
      const nm = makeCanvas(d.w, d.h), ng = ctx2d(nm);
      transform(ng); ng.drawImage(m.mask, 0, 0);
      m.newMask = nm;
      if (!m.angle) { m.selPath = d.sel?.path; } else m.selPath = null;
    }
    this.render();
    if (m.angle && m.newMask) { this.toolOverlay = (gg, z) => { gg.lineWidth = 1 / z; gg.strokeStyle = '#3584e4'; gg.save(); transform(gg); const b = d.sel?.bounds; if (b) gg.strokeRect(b.x, b.y, b.w, b.h); gg.restore(); }; }
  }
  finishMove() {
    const m = this.moving, d = this.doc;
    if (!m) return;
    this.moving = null;
    this.toolOverlay = null;
    if (m.selOnly) {
      if (m.dx || m.dy) {
        const nm = makeCanvas(d.w, d.h);
        ctx2d(nm).drawImage(d.sel.mask, m.dx, m.dy);
        d.setSelMask(nm);
        d.record('Move Selection', I.moveselection);
      }
      return this.render();
    }
    if (m.newMask) d.setSelMask(m.newMask);
    if (!m.dx && !m.dy && !m.angle && !m.pasted) { this.live = null; return this.render(); }
    this.commitLive(m.pasted ? 'Paste' : 'Move Selected', I.movesel);
  }

  // Painting: strokes go on a work-in-progress canvas, then onto the layer.
  beginStroke(mode = 'paint') {
    const d = this.doc;
    this.live = { mode, canvas: makeCanvas(d.w, d.h) };
    return ctx2d(this.live.canvas);
  }
  t_brush(type, p, dr) {
    if (!dr) return;
    const o = this.o;
    if (type === 'pointerdown') { this.strokeG = this.beginStroke('paint'); this.strokeLen = 0; }
    const g = this.strokeG;
    const col = rgbaCss(this.color(dr.btn));
    g.imageSmoothingEnabled = o.aa;
    if (o.brushType === 'normal') {
      g.strokeStyle = col; g.fillStyle = col; g.lineWidth = o.width; g.lineCap = 'round'; g.lineJoin = 'round';
      if (!o.aa) this.jaggedLine(g, dr.last, p, o.width, col);
      else if (type === 'pointerdown') { g.beginPath(); g.arc(p.x, p.y, o.width / 2, 0, Math.PI * 2); g.fill(); }
      else { g.beginPath(); g.moveTo(dr.last.x, dr.last.y); g.lineTo(p.x, p.y); g.stroke(); }
    } else {
      // Patterned brushes stamp along the path.
      const dist = Math.hypot(p.x - dr.last.x, p.y - dr.last.y), steps = Math.max(1, Math.ceil(dist / Math.max(2, o.width / 4)));
      for (let i = 0; i <= steps; i++) {
        const x = dr.last.x + ((p.x - dr.last.x) * i) / steps, y = dr.last.y + ((p.y - dr.last.y) * i) / steps;
        this.strokeLen++;
        g.fillStyle = col; g.strokeStyle = col; g.lineWidth = 1;
        const r = o.width / 2;
        if (o.brushType === 'circles' && this.strokeLen % 3 === 0) { g.beginPath(); g.arc(x, y, r * (0.4 + Math.random() * 0.6), 0, Math.PI * 2); g.stroke(); }
        else if (o.brushType === 'squares' && this.strokeLen % 3 === 0) g.strokeRect(x - r / 2, y - r / 2, r, r);
        else if (o.brushType === 'splatter') for (let k = 0; k < 3; k++) { const a = Math.random() * Math.PI * 2, rr = Math.random() * r; g.beginPath(); g.arc(x + Math.cos(a) * rr, y + Math.sin(a) * rr, Math.max(0.6, Math.random() * r * 0.18), 0, Math.PI * 2); g.fill(); }
        else if (o.brushType === 'grid') { const s = Math.max(2, Math.round(r / 2)); for (let gx = -r; gx <= r; gx += s) for (let gy = -r; gy <= r; gy += s) if (gx * gx + gy * gy <= r * r) g.fillRect(Math.round((x + gx) / s) * s, Math.round((y + gy) / s) * s, 1, 1); }
      }
    }
    this.render();
    if (type === 'pointerup') this.commitLive('Paintbrush', I.brush);
  }
  jaggedLine(g, a, b, w, col) {
    g.fillStyle = col;
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
    const r = w / 2;
    for (let i = 0; i <= n; i++) {
      const x = Math.round(a.x + ((b.x - a.x) * i) / n), y = Math.round(a.y + ((b.y - a.y) * i) / n);
      if (w <= 1) { g.fillRect(Math.floor(x), Math.floor(y), 1, 1); continue; }
      for (let dy = -Math.floor(r); dy <= Math.floor(r); dy++) { const half = Math.floor(Math.sqrt(Math.max(0, r * r - dy * dy))); g.fillRect(x - half, y + dy, half * 2 + 1, 1); }
    }
  }
  t_pencil(type, p, dr) {
    if (!dr) return;
    if (type === 'pointerdown') {
      this.strokeG = this.beginStroke('paint');
      // Shift+click: a straight line from where the last stroke ended.
      if (dr.shift && this.lastPencil) dr.last = this.lastPencil;
    }
    const col = this.color(dr.btn);
    const g = this.strokeG;
    g.fillStyle = rgbaCss(col);
    let { x: x0, y: y0 } = dr.last, x1 = p.x, y1 = p.y;
    x0 = Math.floor(x0); y0 = Math.floor(y0); x1 = Math.floor(x1); y1 = Math.floor(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) { g.fillRect(x0, y0, 1, 1); if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; } }
    this.render();
    if (type === 'pointerup') { this.lastPencil = p; this.commitLive('Pencil', I.pencil); }
  }
  t_eraser(type, p, dr) {
    if (!dr) return;
    const o = this.o;
    if (type === 'pointerdown') this.strokeG = this.beginStroke('erase');
    const g = this.strokeG;
    g.strokeStyle = '#000'; g.fillStyle = '#000'; g.lineWidth = o.width; g.lineCap = 'round'; g.lineJoin = 'round';
    if (!o.aa) this.jaggedLine(g, dr.last, p, o.width, '#000');
    else if (type === 'pointerdown') { g.beginPath(); g.arc(p.x, p.y, o.width / 2, 0, Math.PI * 2); g.fill(); } else { g.beginPath(); g.moveTo(dr.last.x, dr.last.y); g.lineTo(p.x, p.y); g.stroke(); }
    this.render();
    if (type === 'pointerup') this.commitLive('Eraser', I.eraser);
  }
  t_bucket(type, p, dr) {
    if (type !== 'pointerdown') return;
    const d = this.doc;
    if (p.x < 0 || p.y < 0 || p.x >= d.w || p.y >= d.h) return;
    const mask = colorMask(this.sampleImage(this.o.sampling), p.x, p.y, this.o.tolerance, this.o.floodMode === 'contiguous');
    const g = this.beginStroke('paint');
    g.drawImage(this.maskToCanvas(mask, this.color(dr.btn)), 0, 0);
    this.commitLive('Paint Bucket', I.bucket);
  }
  t_gradient(type, p, dr) {
    if (!dr) return;
    const d = this.doc, o = this.o;
    const a = dr.start, b = (this.shiftDown || dr.shift) ? snapAngle(a, p) : p;
    const c1 = this.color(dr.btn), c2 = this.other(dr.btn);
    const grad = makeCanvas(d.w, d.h), g = ctx2d(grad);
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const colorAt = o.gradMode === 'color' ? [rgbaCss(c1), rgbaCss(c2)] : ['rgba(0,0,0,1)', 'rgba(0,0,0,0)'];
    if (o.gradType === 'diamond') {
      const img = g.createImageData(d.w, d.h), A = o.gradMode === 'color' ? [c1, c2] : [[0, 0, 0, 255], [0, 0, 0, 0]];
      const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
      for (let y = 0; y < d.h; y++) for (let x = 0; x < d.w; x++) {
        const dx = x - a.x, dy = y - a.y, u = Math.abs(dx * ux + dy * uy), v = Math.abs(-dx * uy + dy * ux), t = Math.min(1, (u + v) / len), i = (y * d.w + x) * 4;
        for (let k = 0; k < 4; k++) img.data[i + k] = A[0][k] + (A[1][k] - A[0][k]) * t;
      }
      g.putImageData(img, 0, 0);
    } else {
      let gr;
      if (o.gradType === 'radial') gr = g.createRadialGradient(a.x, a.y, 0, a.x, a.y, len);
      else if (o.gradType === 'conical') gr = g.createConicGradient(Math.atan2(b.y - a.y, b.x - a.x), a.x, a.y);
      else if (o.gradType === 'reflected') gr = g.createLinearGradient(2 * a.x - b.x, 2 * a.y - b.y, b.x, b.y);
      else gr = g.createLinearGradient(a.x, a.y, b.x, b.y);
      if (o.gradType === 'reflected') { gr.addColorStop(0, colorAt[1]); gr.addColorStop(0.5, colorAt[0]); gr.addColorStop(1, colorAt[1]); }
      else if (o.gradType === 'conical') { gr.addColorStop(0, colorAt[0]); gr.addColorStop(0.5, colorAt[1]); gr.addColorStop(1, colorAt[0]); }
      else { gr.addColorStop(0, colorAt[0]); gr.addColorStop(1, colorAt[1]); }
      g.fillStyle = gr; g.fillRect(0, 0, d.w, d.h);
    }
    if (o.gradMode === 'color') this.live = { mode: 'paint', canvas: grad };
    else {
      // Transparency mode: the gradient becomes the layer's alpha.
      const out = cloneCanvas(d.layer.canvas), og = ctx2d(out);
      og.globalCompositeOperation = 'destination-in'; og.drawImage(grad, 0, 0);
      // Outside the selection the layer stays as it was.
      if (d.sel) { const keep = cloneCanvas(d.layer.canvas), kg = ctx2d(keep); kg.globalCompositeOperation = 'destination-out'; kg.drawImage(d.sel.mask, 0, 0); const m2 = this.masked(out); const res = makeCanvas(d.w, d.h), rg = ctx2d(res); rg.drawImage(keep, 0, 0); rg.drawImage(m2, 0, 0); this.live = { mode: 'replace', canvas: res }; }
      else this.live = { mode: 'replace', canvas: out };
    }
    this.toolOverlay = (gg, z) => { gg.lineWidth = 1.5 / z; gg.strokeStyle = '#3584e4'; gg.beginPath(); gg.moveTo(a.x, a.y); gg.lineTo(b.x, b.y); gg.stroke(); this.handle(gg, a, z); this.handle(gg, b, z); };
    this.render();
    if (type === 'pointerup') { this.toolOverlay = null; this.commitLive('Gradient', I.gradient); }
  }
  t_picker(type, p, dr) {
    if (!dr || type === 'pointermove' && !dr) return;
    const d = this.doc, n = this.o.pickSize, x0 = Math.floor(p.x) - Math.floor(n / 2), y0 = Math.floor(p.y) - Math.floor(n / 2);
    const src = this.o.pickLayer === 'image' ? d.composite() : d.layer.canvas;
    const x = Math.max(0, Math.min(d.w - n, x0)), y = Math.max(0, Math.min(d.h - n, y0));
    const px = ctx2d(src).getImageData(x, y, Math.min(n, d.w), Math.min(n, d.h)).data;
    const sum = [0, 0, 0, 0];
    for (let i = 0; i < px.length; i += 4) for (let k = 0; k < 4; k++) sum[k] += px[i + k];
    const c = sum.map((v) => Math.round(v / (px.length / 4)));
    if (dr.btn === 2) this.secondary = c; else this.primary = c;
    this.drawPalette();
    if (type === 'pointerup' && this.o.pickAfter !== 'none') this.setTool(this.o.pickAfter === 'pencil' ? 'pencil' : this.prevTool);
  }
  t_clone(type, p, dr) {
    if (!dr) return;
    if (type === 'pointerdown' && dr.ctrl) { this.cloneSrc = { x: p.x, y: p.y }; this.drag = null; this.buildToolbar(); this.drawOverlay(); return; }
    if (!this.cloneSrc) { if (type === 'pointerdown') toast('Ctrl+click to choose where to copy from', { timeout: 2000 }); return; }
    const o = this.o;
    if (type === 'pointerdown') { this.strokeG = this.beginStroke('paint'); this.cloneFrom = cloneCanvas(this.doc.layer.canvas); this.cloneOff = { x: this.cloneSrc.x - p.x, y: this.cloneSrc.y - p.y }; }
    const g = this.strokeG;
    const steps = Math.max(1, Math.ceil(Math.hypot(p.x - dr.last.x, p.y - dr.last.y) / Math.max(1, o.width / 6)));
    for (let i = 0; i <= steps; i++) {
      const x = dr.last.x + ((p.x - dr.last.x) * i) / steps, y = dr.last.y + ((p.y - dr.last.y) * i) / steps;
      g.save(); g.beginPath(); g.arc(x, y, o.width / 2, 0, Math.PI * 2); g.clip(); g.drawImage(this.cloneFrom, this.cloneOff.x * -1 + 0, this.cloneOff.y * -1 + 0); g.restore();
    }
    this.cloneSrc = { x: p.x + this.cloneOff.x, y: p.y + this.cloneOff.y };
    this.render();
    if (type === 'pointerup') { this.cloneSrc = { x: this.cloneOff.x + p.x, y: this.cloneOff.y + p.y }; this.commitLive('Clone Stamp', I.clone); }
  }
  t_recolor(type, p, dr) {
    if (!dr) return;
    const d = this.doc, o = this.o;
    if (type === 'pointerdown') this.live = { mode: 'replace', canvas: cloneCanvas(d.layer.canvas) };
    const g = ctx2d(this.live.canvas);
    const from = this.other(dr.btn), to = this.color(dr.btn), tol = (o.tolerance / 100) ** 2 * 3 * 255 * 255, r = o.width / 2;
    const steps = Math.max(1, Math.ceil(Math.hypot(p.x - dr.last.x, p.y - dr.last.y) / Math.max(1, r / 2)));
    for (let s = 0; s <= steps; s++) {
      const cx = dr.last.x + ((p.x - dr.last.x) * s) / steps, cy = dr.last.y + ((p.y - dr.last.y) * s) / steps;
      const x0 = Math.max(0, Math.floor(cx - r)), y0 = Math.max(0, Math.floor(cy - r)), x1 = Math.min(d.w, Math.ceil(cx + r)), y1 = Math.min(d.h, Math.ceil(cy + r));
      if (x1 <= x0 || y1 <= y0) continue;
      const img = g.getImageData(x0, y0, x1 - x0, y1 - y0), px = img.data;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 > r * r) continue;
        const i = ((y - y0) * (x1 - x0) + (x - x0)) * 4;
        const dist = (px[i] - from[0]) ** 2 + (px[i + 1] - from[1]) ** 2 + (px[i + 2] - from[2]) ** 2;
        if (dist <= tol) { px[i] = to[0]; px[i + 1] = to[1]; px[i + 2] = to[2]; }
      }
      g.putImageData(img, x0, y0);
    }
    if (d.sel) { const res = cloneCanvas(d.layer.canvas), rg = ctx2d(res); rg.globalCompositeOperation = 'destination-out'; rg.drawImage(d.sel.mask, 0, 0); rg.globalCompositeOperation = 'source-over'; rg.drawImage(this.masked(this.live.canvas), 0, 0); this.render(); this.liveView = res; }
    this.render();
    if (type === 'pointerup') {
      if (d.sel) this.live = { mode: 'replace', canvas: this.liveView };
      this.commitLive('Recolor', I.recolor);
    }
  }

  // ---- Shapes (editable until finished) ----
  t_line(type, p, dr) { this.shapeTool('line', type, p, dr); }
  t_rect(type, p, dr) { this.shapeTool('rect', type, p, dr); }
  t_roundrect(type, p, dr) { this.shapeTool('roundrect', type, p, dr); }
  t_ellipse(type, p, dr) { this.shapeTool('ellipse', type, p, dr); }
  t_freeform(type, p, dr) {
    if (!dr) return;
    if (type === 'pointerdown') this.free = { pts: [p], btn: dr.btn };
    if (type === 'pointermove') this.free.pts.push(p);
    const g = this.beginStroke('paint');
    this.paintPath(g, (path) => { this.free.pts.forEach((q, i) => (i ? path.lineTo(q.x, q.y) : path.moveTo(q.x, q.y))); if (type === 'pointerup') path.closePath(); }, this.free.btn, type === 'pointerup');
    this.render();
    if (type === 'pointerup') { this.free = null; this.commitLive('Freeform Shape', I.freeform); }
  }
  shapeTool(kind, type, p, dr) {
    if (!dr) return;
    const s = this.shape;
    if (type === 'pointerdown') {
      // Grab a handle of the shape being edited?
      if (s) {
        const hit = s.handles().findIndex((hp) => Math.hypot(hp.x - p.x, hp.y - p.y) * this.doc.zoom < 9);
        if (hit >= 0) { s.dragging = hit; return; }
        this.commitShape();
      }
      this.shape = this.newShape(kind, p, dr.btn);
      this.shape.dragging = 'create';
      return;
    }
    if (!s || s.dragging == null) return;
    if (s.dragging === 'create') s.setEnd(this.shiftDown || dr.shift ? (kind === 'line' ? snapAngle(s.a, p) : squareFrom(s.a, p)) : p);
    else s.moveHandle(s.dragging, p);
    this.drawShape();
    if (type === 'pointerup') { s.dragging = null; if (Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) < 1) { this.shape = null; this.live = null; this.toolOverlay = null; this.render(); } }
  }
  newShape(kind, p, btn) {
    const s = { kind, a: { ...p }, b: { ...p }, ctrl: null, btn };
    s.setEnd = (q) => { s.b = { ...q }; };
    s.handles = () => {
      if (kind === 'line') return [s.a, s.b, s.ctrl || { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 }];
      const l = Math.min(s.a.x, s.b.x), r = Math.max(s.a.x, s.b.x), t = Math.min(s.a.y, s.b.y), bt = Math.max(s.a.y, s.b.y), mx = (l + r) / 2, my = (t + bt) / 2;
      return [{ x: l, y: t }, { x: mx, y: t }, { x: r, y: t }, { x: r, y: my }, { x: r, y: bt }, { x: mx, y: bt }, { x: l, y: bt }, { x: l, y: my }];
    };
    s.moveHandle = (i, q) => {
      if (kind === 'line') { if (i === 0) s.a = { ...q }; else if (i === 1) s.b = { ...q }; else s.ctrl = { ...q }; return; }
      let l = Math.min(s.a.x, s.b.x), r = Math.max(s.a.x, s.b.x), t = Math.min(s.a.y, s.b.y), bt = Math.max(s.a.y, s.b.y);
      if ([0, 6, 7].includes(i)) l = q.x; if ([2, 3, 4].includes(i)) r = q.x;
      if ([0, 1, 2].includes(i)) t = q.y; if ([4, 5, 6].includes(i)) bt = q.y;
      s.a = { x: l, y: t }; s.b = { x: r, y: bt };
    };
    return s;
  }
  // Fill style: outline in the primary colour, fill in the secondary (swapped with the right button).
  paintPath(g, build, btn, closed = true) {
    const o = this.o, path = new Path2D();
    build(path);
    g.lineWidth = o.width; g.lineJoin = 'round'; g.lineCap = 'round';
    g.setLineDash(o.dash ? o.dash.split(' ').map((v) => Number(v) * Math.max(1, o.width / 2)) : []);
    g.imageSmoothingEnabled = o.aa;
    const outlineC = rgbaCss(this.color(btn)), fillC = rgbaCss(o.fillStyle === 'fill' ? this.color(btn) : this.other(btn));
    if (closed && (o.fillStyle === 'fill' || o.fillStyle === 'both')) { g.fillStyle = fillC; g.fill(path); }
    if (!closed || o.fillStyle !== 'fill') { g.strokeStyle = outlineC; g.stroke(path); }
    g.setLineDash([]);
    return path;
  }
  drawShape() {
    const s = this.shape, o = this.o;
    if (!s) return;
    const g = this.beginStroke('paint');
    if (!o.aa) g.translate(0.5, 0.5);
    const { a, b } = s;
    if (s.kind === 'line') {
      this.paintPath(g, (path) => { path.moveTo(a.x, a.y); if (s.ctrl) path.quadraticCurveTo(2 * s.ctrl.x - (a.x + b.x) / 2, 2 * s.ctrl.y - (a.y + b.y) / 2, b.x, b.y); else path.lineTo(b.x, b.y); }, s.btn, false);
      const arrow = (from, to) => {
        const ang = Math.atan2(to.y - from.y, to.x - from.x), len = Math.max(8, o.width * 3);
        g.fillStyle = rgbaCss(this.color(s.btn));
        g.beginPath(); g.moveTo(to.x, to.y); g.lineTo(to.x - len * Math.cos(ang - 0.45), to.y - len * Math.sin(ang - 0.45)); g.lineTo(to.x - len * Math.cos(ang + 0.45), to.y - len * Math.sin(ang + 0.45)); g.closePath(); g.fill();
      };
      const mid = s.ctrl ? { x: 2 * s.ctrl.x - (a.x + b.x) / 2, y: 2 * s.ctrl.y - (a.y + b.y) / 2 } : null;
      if (o.arrowEnd) arrow(mid || a, b);
      if (o.arrowStart) arrow(mid || b, a);
    } else {
      const l = Math.min(a.x, b.x), t = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), hh = Math.abs(b.y - a.y);
      this.paintPath(g, (path) => {
        if (s.kind === 'rect') path.rect(l, t, w, hh);
        else if (s.kind === 'roundrect') path.roundRect(l, t, w, hh, Math.min(o.radius, w / 2, hh / 2));
        else path.ellipse(l + w / 2, t + hh / 2, w / 2, hh / 2, 0, 0, Math.PI * 2);
      }, s.btn, true);
    }
    this.toolOverlay = (gg, z) => {
      if (s.kind !== 'line') { gg.lineWidth = 1 / z; gg.strokeStyle = 'rgba(53,132,228,.6)'; gg.setLineDash([3 / z, 3 / z]); gg.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y)); gg.setLineDash([]); }
      s.handles().forEach((hp, i) => this.handle(gg, hp, z, s.kind === 'line' && i === 2 ? '#e66100' : '#3584e4'));
    };
    this.render();
  }
  commitShape() {
    const s = this.shape;
    if (!s) return;
    this.shape = null;
    this.toolOverlay = null;
    const names = { line: 'Line/Curve', rect: 'Rectangle', roundrect: 'Rounded Rectangle', ellipse: 'Ellipse' };
    if (this.live) this.commitLive(names[s.kind], I[s.kind]); else this.render();
  }

  // ---- Text ----
  t_text(type, p, dr, e) {
    if (type !== 'pointerdown') return;
    // Keep the click from moving focus back to the picture: typing must go into the text box.
    e?.preventDefault();
    if (this.text) { this.commitText(); return; }
    const ta = h('textarea', { class: 'pp-textarea', spellcheck: 'false', rows: 1 });
    this.text = { x: p.x, y: p.y, ta, color: this.color(dr.btn), outlineColor: this.other(dr.btn) };
    this.wrap.append(ta);
    ta.addEventListener('input', () => this.styleText());
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.cancelText(); }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.commitText(); }
    });
    this.styleText();
    ta.focus();
    requestAnimationFrame(() => ta.focus());
  }
  textFont(scale = 1) { const o = this.o; return `${o.italic ? 'italic ' : ''}${o.bold ? 'bold ' : ''}${o.fontSize * scale}px "${o.font}", ${o.font.toLowerCase().includes('mono') ? 'monospace' : 'sans-serif'}`; }
  styleText() {
    const t = this.text;
    if (!t) return;
    const { ox, oy, z } = this.toScreen(), o = this.o;
    const lines = t.ta.value.split('\n');
    const m = ctx2d(this.scratch(1, 1, 'measure'));
    m.font = this.textFont(z);
    const w = Math.max(20, ...lines.map((l) => m.measureText(l || ' ').width)) + 8;
    Object.assign(t.ta.style, {
      left: `${ox + t.x * z - (o.align === 'center' ? w / 2 : o.align === 'right' ? w : 0)}px`, top: `${oy + t.y * z}px`, width: `${w}px`, height: `${lines.length * o.fontSize * z * 1.2 + 6}px`,
      font: this.textFont(z), color: rgbaCss(t.color), textAlign: o.align, textDecoration: o.underline ? 'underline' : 'none',
      WebkitTextStroke: o.textFill !== 'fill' ? `${o.outline * z / 2}px ${rgbaCss(t.outlineColor)}` : '',
    });
    if (o.textFill === 'outline') t.ta.style.color = 'transparent';
  }
  commitText() {
    const t = this.text;
    if (!t) return;
    this.text = null;
    t.ta.remove();
    if (!t.ta.value.trim()) return;
    const o = this.o, g = this.beginStroke('paint');
    g.font = this.textFont(); g.textAlign = o.align; g.textBaseline = 'top';
    g.lineJoin = 'round'; g.lineWidth = o.outline;
    t.ta.value.split('\n').forEach((line, i) => {
      const y = t.y + i * o.fontSize * 1.2 + 2, x = t.x + (o.align === 'left' ? 3 : 0);
      if (o.textFill !== 'fill') { g.strokeStyle = rgbaCss(t.outlineColor); g.strokeText(line, x, y); }
      if (o.textFill !== 'outline') { g.fillStyle = rgbaCss(t.color); g.fillText(line, x, y); }
      if (o.underline && line) {
        const w = g.measureText(line).width, ux = o.align === 'center' ? x - w / 2 : o.align === 'right' ? x - w : x;
        g.fillStyle = rgbaCss(t.color); g.fillRect(ux, y + o.fontSize * 1.02, w, Math.max(1, o.fontSize / 14));
      }
    });
    this.commitLive('Text', I.text);
  }
  cancelText() { if (this.text) { this.text.ta.remove(); this.text = null; } }

  // ---------------------------------------------------------------- history

  undo() { this.commitPending(); const d = this.doc; if (d.hpos > 0) this.goHistory(d.hpos - 1); }
  redo() { const d = this.doc; if (d.hpos < d.history.length - 1) this.goHistory(d.hpos + 1); }
  goHistory(i) {
    const d = this.doc;
    if (this.text) this.cancelText();
    if (this.shape) { this.shape = null; this.toolOverlay = null; }
    this.moving = null; this.live = null;
    d.hpos = i;
    d.restore(d.history[i].state);
    d.dirty = true;
    this.sizeStage();
    this.render();
  }
  // Apply fn to the document (all layers or the current one), then record it.
  act(name, icon, fn) {
    this.commitPending();
    fn(this.doc);
    this.doc.touch();
    for (const l of this.doc.layers) l.rev++;
    this.doc.record(name, icon);
    this.sizeStage();
    this.render();
  }

  // ---------------------------------------------------------------- edit

  selectAll() { this.commitPending(); const d = this.doc; d.setSelMask(this.selShape((g) => g.fillRect(0, 0, d.w, d.h))); d.record('Select All', I.rectsel); this.render(); }
  deselect() { this.commitPending(); const d = this.doc; if (!d.sel) return; d.setSelMask(null); d.record('Deselect All', I.deselect); this.render(); }
  invertSelection() {
    this.commitPending();
    const d = this.doc, m = this.selShape((g) => g.fillRect(0, 0, d.w, d.h));
    if (d.sel) { const g = ctx2d(m); g.globalCompositeOperation = 'destination-out'; g.drawImage(d.sel.mask, 0, 0); }
    d.setSelMask(m); d.record('Invert Selection', I.rectsel); this.render();
  }
  eraseSelection() {
    const d = this.doc;
    if (!d.sel) return;
    this.commitPending();
    const g = ctx2d(d.layer.canvas);
    g.globalCompositeOperation = 'destination-out'; g.drawImage(d.sel.mask, 0, 0); g.globalCompositeOperation = 'source-over';
    d.touch(); d.record('Erase Selection', I.eraser); this.render();
  }
  fillSelection() {
    const d = this.doc;
    this.commitPending();
    const g = this.beginStroke('paint');
    g.fillStyle = rgbaCss(this.primary); g.fillRect(0, 0, d.w, d.h);
    this.commitLive('Fill Selection', I.bucket);
  }
  selectionPixels(merged) {
    const d = this.doc, b = d.sel?.bounds || { x: 0, y: 0, w: d.w, h: d.h };
    const src = this.masked(merged ? d.composite() : d.layer.canvas);
    const c = makeCanvas(b.w, b.h);
    ctx2d(c).drawImage(src, -b.x, -b.y);
    return c;
  }
  async copy(merged = false) {
    this.commitPending();
    const c = this.selectionPixels(merged);
    PaintPro.clip = c;
    try { const blob = await new Promise((r) => c.toBlob(r, 'image/png')); await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); } catch { /* kept inside MediaDesk */ }
  }
  async cut() { await this.copy(); this.eraseSelection(); }
  async paste(where) {
    let img = null;
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((t) => t.startsWith('image/'));
        if (type) { img = (await decodePicture(await item.getType(type))).image; break; }
      }
    } catch { /* not allowed */ }
    img ||= PaintPro.clip;
    if (!img) return toast('Nothing to paste', { body: 'Copy a picture first.', timeout: 2000 });
    this.pasteCanvas(img, where);
  }
  async pasteCanvas(img, where) {
    this.commitPending();
    if (where === 'image') { const d = this.newDoc(img.width, img.height, { fill: null, name: 'Pasted image' }); ctx2d(d.layer.canvas).drawImage(img, 0, 0); d.touch(); d.history = []; d.record('Paste Into New Image', I.paste); this.render(); return; }
    let d = this.doc;
    if (img.width > d.w || img.height > d.h) {
      const ok = await confirmDialog({ title: 'Image larger than canvas', message: 'The pasted picture is larger than the canvas. Expand the canvas to fit it?', confirm: 'Expand canvas' });
      if (ok) this.act('Resize Canvas', I.crop, (doc) => resizeCanvasTo(doc, Math.max(doc.w, img.width), Math.max(doc.h, img.height), 0, 0));
      d = this.doc;
    }
    if (where === 'layer') { d.addLayer(); d.record('Add New Layer', I.add); }
    // Top-left of what's visible.
    const r = this.view.getBoundingClientRect(), vr = this.viewport.getBoundingClientRect();
    const x = Math.max(0, Math.min(d.w - img.width, Math.round((vr.left - r.left) / d.zoom))), y = Math.max(0, Math.min(d.h - img.height, Math.round((vr.top - r.top) / d.zoom)));
    const piece = makeCanvas(d.w, d.h);
    ctx2d(piece).drawImage(img, x, y);
    d.setSelMask(this.selShape((g) => g.fillRect(x, y, img.width, img.height)));
    this.setTool('movesel');
    this.liftSelection(piece);
    this.moving.base = cloneCanvas(d.layer.canvas);
    this.moving.pasted = true;
    this.updateMove();
  }

  // ---------------------------------------------------------------- image & layers

  cropToSelection() {
    const d = this.doc;
    if (!d.sel) return;
    const b = d.sel.bounds;
    this.act('Crop to Selection', I.crop, (doc) => {
      for (const l of doc.layers) { const c = makeCanvas(b.w, b.h), g = ctx2d(c); g.drawImage(this.masked(l.canvas), -b.x, -b.y); l.canvas = c; }
      doc.w = b.w; doc.h = b.h;
      doc.setSelMask(null);
    });
  }
  autoCrop() {
    const d = this.doc, img = ctx2d(d.composite()).getImageData(0, 0, d.w, d.h).data;
    // Trim edges that match the top-left pixel.
    const same = (i) => Math.abs(img[i] - img[0]) + Math.abs(img[i + 1] - img[1]) + Math.abs(img[i + 2] - img[2]) + Math.abs(img[i + 3] - img[3]) < 8;
    let l = d.w, t = d.h, r = -1, b = -1;
    for (let y = 0; y < d.h; y++) for (let x = 0; x < d.w; x++) if (!same((y * d.w + x) * 4)) { if (x < l) l = x; if (x > r) r = x; if (y < t) t = y; if (y > b) b = y; }
    if (r < 0) return toast('Nothing to crop', { timeout: 1500 });
    this.act('Auto Crop', I.crop, (doc) => resizeCanvasTo(doc, r - l + 1, b - t + 1, -l, -t));
  }
  async resizeImage() {
    const d = this.doc;
    let keep = true;
    const by = h('select', {}, h('option', { value: 'pct' }, 'By percentage'), h('option', { value: 'abs' }, 'By absolute size'));
    const pct = h('input', { type: 'number', value: 100, min: 1, max: 1000 });
    const w = h('input', { type: 'number', value: d.w, min: 1, max: 16384 }), hh = h('input', { type: 'number', value: d.h, min: 1, max: 16384 });
    const k = h('input', { type: 'checkbox', checked: true, onchange: (e) => { keep = e.target.checked; } });
    w.oninput = () => { if (keep) hh.value = Math.max(1, Math.round((Number(w.value) * d.h) / d.w)); };
    hh.oninput = () => { if (keep) w.value = Math.max(1, Math.round((Number(hh.value) * d.w) / d.h)); };
    const pctRow = h('label', { class: 'pd-field' }, h('span', {}, 'Percentage'), pct), absRows = h('div', { hidden: true }, h('div', { class: 'pd-grid2' }, h('label', { class: 'pd-field' }, h('span', {}, 'Width'), w), h('label', { class: 'pd-field' }, h('span', {}, 'Height'), hh)), h('label', { class: 'pd-check' }, k, 'Maintain aspect ratio'));
    by.onchange = () => { pctRow.hidden = by.value !== 'pct'; absRows.hidden = by.value === 'pct'; };
    const v = await dialog('Resize Image', h('div', {}, h('label', { class: 'pd-field' }, h('span', {}, 'Resize'), by), pctRow, absRows), {
      cls: 'pp', onOk: () => {
        const nw = by.value === 'pct' ? Math.round((d.w * Number(pct.value)) / 100) : Number(w.value), nh = by.value === 'pct' ? Math.round((d.h * Number(pct.value)) / 100) : Number(hh.value);
        if (!(nw >= 1 && nh >= 1 && nw <= 16384 && nh <= 16384)) throw new Error('Choose a size between 1 and 16384 pixels.');
        return { w: nw, h: nh };
      },
    });
    if (!v) return;
    this.act('Resize Image', I.crop, (doc) => {
      for (const l of doc.layers) l.canvas = resample(l.canvas, v.w, v.h);
      doc.w = v.w; doc.h = v.h;
      doc.setSelMask(null);
    });
  }
  async resizeCanvas() {
    const d = this.doc;
    let anchor = 4;
    const w = h('input', { type: 'number', value: d.w, min: 1, max: 16384 }), hh = h('input', { type: 'number', value: d.h, min: 1, max: 16384 });
    const grid = h('div', { class: 'pp-anchor' }, Array.from({ length: 9 }, (_, i) => h('button', { type: 'button', class: i === 4 ? 'on' : '', onclick: (e) => { anchor = i; grid.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.currentTarget)); } }, '•')));
    const v = await dialog('Resize Canvas', h('div', {}, h('div', { class: 'pd-grid2' }, h('label', { class: 'pd-field' }, h('span', {}, 'Width'), w), h('label', { class: 'pd-field' }, h('span', {}, 'Height'), hh)), h('div', { class: 'pd-field' }, h('span', {}, 'Anchor'), grid)), {
      cls: 'pp', onOk: () => { const r = { w: Number(w.value), h: Number(hh.value) }; if (!(r.w >= 1 && r.h >= 1 && r.w <= 16384 && r.h <= 16384)) throw new Error('Choose a size between 1 and 16384 pixels.'); return r; },
    });
    if (!v) return;
    const ax = anchor % 3, ay = Math.floor(anchor / 3);
    this.act('Resize Canvas', I.crop, (doc) => resizeCanvasTo(doc, v.w, v.h, Math.round(((v.w - doc.w) * ax) / 2), Math.round(((v.h - doc.h) * ay) / 2)));
  }
  flipImage(dir) { this.act(dir === 'h' ? 'Flip Image Horizontal' : 'Flip Image Vertical', I.movesel, (doc) => { for (const l of doc.layers) l.canvas = flip(l.canvas, dir); if (doc.sel) doc.setSelMask(flip(doc.sel.mask, dir)); }); }
  rotateImage(deg) {
    this.act(`Rotate ${deg === 180 ? '180°' : deg > 0 ? '90° Clockwise' : '90° Counter-Clockwise'}`, I.movesel, (doc) => {
      for (const l of doc.layers) l.canvas = rotate(l.canvas, deg);
      if (doc.sel) doc.setSelMask(rotate(doc.sel.mask, deg));
      if (deg !== 180) [doc.w, doc.h] = [doc.h, doc.w];
    });
  }
  flatten() {
    this.act('Flatten', I.merge, (doc) => {
      const c = doc.composite();
      const l = { id: nextId++, name: 'Background', canvas: c, visible: true, opacity: 1, blend: 'normal', rev: 0 };
      doc.layers = [l]; doc.cur = 0;
    });
  }
  addLayer() { this.commitPending(); this.doc.addLayer(null, this.doc.cur + 1); this.doc.record('Add New Layer', I.add); this.render(); }
  deleteLayer() {
    const d = this.doc;
    if (d.layers.length < 2) return;
    this.commitPending();
    d.layers.splice(d.cur, 1); d.cur = Math.max(0, d.cur - 1);
    d.record('Delete Layer', I.del); this.render();
  }
  duplicateLayer() {
    this.commitPending();
    const d = this.doc, l = d.layer;
    const n = { ...l, id: nextId++, name: `${l.name} copy`, canvas: cloneCanvas(l.canvas), rev: 0 };
    d.layers.splice(d.cur + 1, 0, n); d.cur++;
    d.record('Duplicate Layer', I.dup); this.render();
  }
  mergeDown() {
    const d = this.doc;
    if (!d.cur) return;
    this.commitPending();
    const top = d.layer, below = d.layers[d.cur - 1], g = ctx2d(below.canvas);
    if (top.visible) { g.globalAlpha = top.opacity; g.globalCompositeOperation = gco(top.blend); g.drawImage(top.canvas, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; }
    d.layers.splice(d.cur, 1); d.cur--; d.touch(below);
    d.record('Merge Layer Down', I.merge); this.render();
  }
  moveLayer(dir) {
    const d = this.doc, j = d.cur + dir;
    if (j < 0 || j >= d.layers.length) return;
    this.commitPending();
    [d.layers[d.cur], d.layers[j]] = [d.layers[j], d.layers[d.cur]]; d.cur = j;
    d.record(dir > 0 ? 'Move Layer Up' : 'Move Layer Down', dir > 0 ? I.up : I.down); this.render();
  }
  flipLayer(dir) { this.commitPending(); const d = this.doc; d.layer.canvas = flip(d.layer.canvas, dir); d.touch(); d.record(dir === 'h' ? 'Flip Layer Horizontal' : 'Flip Layer Vertical', I.movesel); this.render(); }
  async importLayer() {
    const pic = await openPicture({ title: 'Import from File' });
    if (!pic) return;
    this.commitPending();
    const d = this.doc, l = d.addLayer(pic.name.replace(/\.[^.]+$/, ''), d.cur + 1);
    ctx2d(l.canvas).drawImage(pic.image, 0, 0);
    d.touch(l); d.record('Import from File', I.open); this.render();
  }
  async rotateZoomLayer() {
    this.commitPending();
    const d = this.doc, orig = cloneCanvas(d.layer.canvas);
    const state = { angle: 0, zoom: 100, panX: 0, panY: 0 };
    const apply = () => {
      const c = makeCanvas(d.w, d.h), g = ctx2d(c);
      g.translate(d.w / 2 + state.panX, d.h / 2 + state.panY); g.rotate((state.angle * Math.PI) / 180); g.scale(state.zoom / 100, state.zoom / 100);
      g.drawImage(orig, -d.w / 2, -d.h / 2);
      this.live = { mode: 'replace', canvas: c };
      this.render();
    };
    const body = h('div', {}, numberField('Angle', { min: -180, max: 180, value: 0, onInput: (v) => { state.angle = v; apply(); } }), numberField('Zoom (%)', { min: 1, max: 1000, value: 100, onInput: (v) => { state.zoom = v; apply(); } }),
      numberField('Pan X', { min: -d.w, max: d.w, value: 0, onInput: (v) => { state.panX = v; apply(); } }), numberField('Pan Y', { min: -d.h, max: d.h, value: 0, onInput: (v) => { state.panY = v; apply(); } }));
    const ok = await dialog('Rotate / Zoom Layer', body, { cls: 'pp' });
    if (ok && this.live) this.commitLive('Rotate / Zoom Layer', I.movesel); else { this.live = null; this.render(); }
  }
  async layerProps() {
    this.commitPending();
    const d = this.doc, l = d.layer, before = { name: l.name, visible: l.visible, blend: l.blend, opacity: l.opacity };
    const name = h('input', { type: 'text', value: l.name, oninput: (e) => { l.name = e.target.value; this.drawLayers(); } });
    const vis = h('input', { type: 'checkbox', checked: l.visible, onchange: (e) => { l.visible = e.target.checked; this.render(); } });
    const blend = h('select', { onchange: (e) => { l.blend = e.target.value; this.render(); } }, BLENDS.map(([v, n]) => h('option', { value: v, selected: l.blend === v }, n)));
    const op = numberField('Opacity', { min: 0, max: 100, value: Math.round(l.opacity * 100), onInput: (v) => { l.opacity = v / 100; this.render(); } });
    const ok = await dialog('Layer Properties', h('div', {}, h('label', { class: 'pd-field' }, h('span', {}, 'Name'), name), h('label', { class: 'pd-check' }, vis, 'Visible'), h('label', { class: 'pd-field' }, h('span', {}, 'Blend mode'), blend), op), { cls: 'pp' });
    if (!ok) { Object.assign(l, before); this.render(); return; }
    if (JSON.stringify(before) !== JSON.stringify({ name: l.name, visible: l.visible, blend: l.blend, opacity: l.opacity })) { d.record('Layer Properties', I.props); this.render(); }
  }

  // ---------------------------------------------------------------- adjustments & effects

  // Runs an adjustment or effect on the current layer (inside the selection), with a live
  // preview while its settings are open.
  async runFx(fx) {
    this.commitPending();
    const d = this.doc, l = d.layer;
    const src = ctx2d(l.canvas).getImageData(0, 0, d.w, d.h);
    const p = Object.fromEntries((fx.params || []).map((q) => [q.key, Array.isArray(q.value) ? q.value.map((x) => [...x]) : q.value]));
    const ctx = { primary: this.primary, secondary: this.secondary };
    const compute = () => {
      const dst = new ImageData(d.w, d.h);
      fx.run(src, dst, p, ctx);
      const c = makeCanvas(d.w, d.h);
      ctx2d(c).putImageData(dst, 0, 0);
      if (!d.sel) return c;
      // Inside the selection only.
      const out = cloneCanvas(l.canvas), g = ctx2d(out);
      g.globalCompositeOperation = 'destination-out'; g.drawImage(d.sel.mask, 0, 0);
      g.globalCompositeOperation = 'source-over'; g.drawImage(this.masked(c), 0, 0);
      return out;
    };
    const preview = () => { this.live = { mode: 'replace', canvas: compute() }; this.render(); };
    if (fx.instant || !fx.params?.length) { preview(); this.commitLive(fx.name, fx.group ? I.fx : I.adjust); return; }
    let timer = 0;
    const schedule = () => { clearTimeout(timer); timer = setTimeout(preview, 90); };
    const fields = fx.params.map((q) => {
      if (q.type === 'select') return h('label', { class: 'pd-field' }, h('span', {}, q.label), h('select', { onchange: (e) => { p[q.key] = e.target.value; schedule(); } }, q.options.map(([v, n]) => h('option', { value: v, selected: q.value === v }, n))));
      if (q.type === 'check') return h('label', { class: 'pd-check' }, h('input', { type: 'checkbox', checked: q.value, onchange: (e) => { p[q.key] = e.target.checked; schedule(); } }), q.label);
      if (q.type === 'curve') return curveEditor(p, q.key, schedule);
      return numberField(q.label, { min: q.min, max: q.max, step: q.step, value: q.value, onInput: (v) => { p[q.key] = v; schedule(); } });
    });
    this.fxPreview = { cancel: () => {} };
    preview();
    const ok = await dialog(fx.name, h('div', {}, fields, h('p', { class: 'pp-preview-note' }, d.sel ? 'Applies inside the selection.' : 'Applies to the current layer.')), { cls: 'pp' });
    clearTimeout(timer);
    this.fxPreview = null;
    if (ok) { preview(); this.commitLive(fx.name, fx.group ? I.fx : I.adjust); } else { this.live = null; this.render(); }
  }

  // ---------------------------------------------------------------- colours

  async pickColor(which) {
    const start = which === 'primary' ? this.primary : this.secondary;
    let [hh, s, v] = rgbToHsv(start[0], start[1], start[2]), a = start[3];
    const sv = h('div', { class: 'pp-sv' }, h('i')), hue = h('div', { class: 'pp-hue' }, h('i'));
    const hex = h('input', { type: 'text', maxlength: 9, spellcheck: 'false' });
    const rgb = ['R', 'G', 'B'].map((n) => h('input', { type: 'number', min: 0, max: 255 }));
    const alpha = numberField('Alpha', { min: 0, max: 255, value: a, onInput: (x) => { a = x; paint(false); } });
    const sw = h('div', { style: { height: '30px', borderRadius: '6px', background: 'repeating-conic-gradient(#ccc 0 25%, #fff 0 50%) 0 0 / 10px 10px' } }, h('div', { style: { height: '100%', borderRadius: '6px' } }));
    const cur = () => [...hsvToRgb(hh, s, v).map(Math.round), a];
    const paint = (fields = true) => {
      sv.style.background = `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hh}, 100%, 50%))`;
      sv.firstChild.style.left = `${s * 100}%`; sv.firstChild.style.top = `${(1 - v) * 100}%`;
      hue.firstChild.style.top = `${(hh / 360) * 100}%`;
      const c = cur();
      sw.firstChild.style.background = rgbaCss(c);
      if (fields) { hex.value = rgbaToHex(c) + (a < 255 ? a.toString(16).padStart(2, '0') : ''); rgb.forEach((el, i) => { el.value = c[i]; }); }
    };
    const dragOn = (el, fn) => el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      const mv = (ev) => { const r = el.getBoundingClientRect(); fn(Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height))); paint(); };
      mv(e);
      el.addEventListener('pointermove', mv);
      el.addEventListener('pointerup', () => el.removeEventListener('pointermove', mv), { once: true });
    });
    dragOn(sv, (x, y) => { s = x; v = 1 - y; });
    dragOn(hue, (x, y) => { hh = y * 360; });
    hex.onchange = () => { const c = hexToRgba(hex.value.startsWith('#') ? hex.value : `#${hex.value}`); [hh, s, v] = rgbToHsv(c[0], c[1], c[2]); a = c[3]; alpha.querySelectorAll('input').forEach((i) => { i.value = a; }); paint(); };
    rgb.forEach((el) => { el.onchange = () => { [hh, s, v] = rgbToHsv(...rgb.map((x) => Number(x.value) || 0)); paint(); }; });
    paint();
    const body = h('div', {}, h('div', { class: 'pp-picker' }, sv, hue),
      h('div', { class: 'pd-grid2', style: { marginTop: '10px' } }, h('label', { class: 'pd-field' }, h('span', {}, 'Hex'), hex), h('div', { class: 'pd-field' }, h('span', {}, 'Colour'), sw)),
      h('div', { class: 'pd-row', style: { margin: '6px 0' } }, rgb.map((el, i) => h('label', { class: 'pd-field', style: { margin: 0 } }, h('span', {}, ['Red', 'Green', 'Blue'][i]), el))), alpha);
    const ok = await dialog(which === 'primary' ? 'Primary Color' : 'Secondary Color', body, { cls: 'pp' });
    if (!ok) return;
    this[which] = cur();
    this.drawPalette();
  }

  // ---------------------------------------------------------------- files

  async newDialog() {
    const w = h('input', { type: 'number', value: 800, min: 1, max: 16384 }), hh = h('input', { type: 'number', value: 600, min: 1, max: 16384 });
    if (PaintPro.clip) { w.value = PaintPro.clip.width; hh.value = PaintPro.clip.height; }
    const bg = h('select', {}, h('option', { value: 'white' }, 'White'), h('option', { value: 'secondary' }, 'Secondary color'), h('option', { value: 'transparent' }, 'Transparent'));
    const presets = h('select', { onchange: (e) => { const [a, b] = e.target.value.split('x'); if (a) { w.value = a; hh.value = b; } } }, [['', 'Preset…'], ['640x480', '640 × 480'], ['800x600', '800 × 600'], ['1024x768', '1024 × 768'], ['1280x720', '1280 × 720 (HD)'], ['1920x1080', '1920 × 1080 (Full HD)'], ['3840x2160', '3840 × 2160 (4K)'], ['1080x1080', '1080 × 1080 (square)'], ['2480x3508', 'A4 at 300 dpi']].map(([v, n]) => h('option', { value: v }, n)));
    const v = await dialog('New Image', h('div', {}, presets, h('div', { class: 'pd-grid2', style: { marginTop: '8px' } }, h('label', { class: 'pd-field' }, h('span', {}, 'Width'), w), h('label', { class: 'pd-field' }, h('span', {}, 'Height'), hh)), h('label', { class: 'pd-field' }, h('span', {}, 'Background'), bg)), {
      cls: 'pp', onOk: () => { const r = { w: Number(w.value), h: Number(hh.value), bg: bg.value }; if (!(r.w >= 1 && r.h >= 1 && r.w <= 16384 && r.h <= 16384)) throw new Error('Choose a size between 1 and 16384 pixels.'); return r; },
    });
    if (!v) return;
    this.newDoc(v.w, v.h, { fill: v.bg === 'white' ? '#ffffff' : v.bg === 'secondary' ? rgbaCss(this.secondary) : null });
  }
  async screenshot() {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const video = h('video', { muted: true, playsinline: true });
      video.srcObject = stream;
      await video.play();
      await new Promise((r) => setTimeout(r, 300));
      const c = makeCanvas(video.videoWidth, video.videoHeight);
      ctx2d(c).drawImage(video, 0, 0);
      stream.getTracks().forEach((t) => t.stop());
      this.openDoc({ image: c }, 'Screenshot', null);
    } catch (err) { if (err?.name !== 'NotAllowedError') toastError(err, 'Couldn’t take a screenshot'); }
  }
  async open() {
    const pic = await openPicture();
    if (pic) this.openDoc(pic, pic.name, pic.file);
  }
  async openShared(root, path) {
    try {
      const { fileUrl } = await import('../fileapi.js');
      const r = await fetch(fileUrl(root, path), { credentials: 'same-origin' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const name = path.split('/').pop();
      this.openDoc(await decodePicture(await r.blob(), name), name, { root, path });
    } catch (err) { toastError(err, 'Couldn’t open the picture'); }
  }
  async save(as = false) {
    this.commitPending();
    const d = this.doc;
    const canSave = /\.(png|jpe?g|webp|bmp|ora)$/i.test(d.name);
    let target = d.file && canSave && !as ? { root: d.file.root, path: d.file.path, name: d.file.path.split('/').pop() } : null;
    if (!target) {
      const base = d.name.replace(/\.[^.]+$/, '');
      target = await chooseSaveTarget('Save Image As', `${base}.${canSave ? extOf(d.name) : d.layers.length > 1 ? 'ora' : 'png'}`);
      if (!target) return;
      if (!/\.(png|jpe?g|webp|bmp|ora)$/i.test(target.name)) target.name += '.png';
    }
    const ext = extOf(target.name);
    let quality = 0.92;
    if (ext !== 'ora' && d.layers.length > 1 && !(await confirmDialog({ title: 'Flatten image', message: `${ext.toUpperCase()} files can’t keep layers, so the saved picture will be flattened (your layers stay here). Save as .ora to keep them.`, confirm: 'Save flattened' }))) return;
    if (ext === 'jpg' || ext === 'jpeg' || ext === 'webp') {
      const q = numberField('Quality', { min: 1, max: 100, value: 92 });
      const v = await dialog(`${ext.toUpperCase()} Quality`, q, { cls: 'pp', onOk: () => q.value() });
      if (!v) return;
      quality = v / 100;
    }
    try {
      const merged = d.composite();
      const blob = ext === 'ora' ? await writeOra(d.layers, d.w, d.h, merged) : await encodeCanvas(merged, target.name, quality);
      const saved = await writeFile(target, blob);
      if (saved) d.file = saved;
      d.name = target.name;
      d.dirty = false;
      this.refreshChrome();
      toast('Saved', { body: target.name, icon: appIcon.paintpro, timeout: 1500 });
    } catch (err) { toastError(err, 'Couldn’t save'); }
  }

  // ---------------------------------------------------------------- keys

  key(e) {
    if (!this.win.el.classList.contains('focused') || e.target.closest?.('.pd') || e.target.closest?.('.dialog') || e.target.closest?.('.fp')) return;
    this.shiftDown = e.shiftKey;
    if (e.type === 'keydown' && e.key === ' ' && !this.text && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) { this.spaceDown = true; addEventListener('keyup', (ev) => { if (ev.key === ' ') this.spaceDown = false; }, { once: true }); }
    if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
    const run = (fn) => { e.preventDefault(); e.stopPropagation(); fn(); };
    if (mod) {
      if (e.shiftKey && k === 's') return run(() => this.save(true));
      if (e.shiftKey && k === 'a') return run(() => this.deselect());
      if (e.shiftKey && k === 'c') return run(() => this.copy(true));
      if (e.shiftKey && k === 'v') return run(() => this.paste('layer'));
      if (e.altKey && k === 'v') return run(() => this.paste('image'));
      if (e.shiftKey && k === 'x') return run(() => this.cropToSelection());
      if (e.shiftKey && k === 'r') return run(() => this.resizeCanvas());
      if (e.shiftKey && k === 'f') return run(() => this.flatten());
      if (e.shiftKey && k === 'n') return run(() => this.addLayer());
      if (e.shiftKey && k === 'd') return run(() => this.duplicateLayer());
      if (e.shiftKey && e.key === 'Delete') return run(() => this.deleteLayer());
      const map = { z: () => this.undo(), y: () => this.redo(), x: () => this.cut(), c: () => this.copy(), v: () => this.paste(), a: () => this.selectAll(), i: () => this.invertSelection(), n: () => this.newDialog(), o: () => this.open(), s: () => this.save(), w: () => this.closeDoc(this.doc), r: () => this.resizeImage(), h: () => this.rotateImage(90), g: () => this.rotateImage(-90), j: () => this.rotateImage(180), m: () => this.mergeDown(), b: () => this.bestFit(), 0: () => this.setZoom(1), '+': () => this.zoomStep(1), '=': () => this.zoomStep(1), '-': () => this.zoomStep(-1) };
      if (map[k]) return run(map[k]);
      return;
    }
    if (e.key === 'Delete') return run(() => this.eraseSelection());
    if (e.key === 'Backspace') return run(() => this.fillSelection());
    if (e.key === 'Enter') return run(() => this.commitPending());
    if (e.key === 'Escape') return run(() => { if (this.shape) { this.shape = null; this.live = null; this.toolOverlay = null; this.render(); } else if (this.moving) this.finishMove(); else this.deselect(); });
    if (e.key === 'F4') return run(() => this.layerProps());
    if (k === 'x') return run(() => this.swapColors());
    if (k === '[') return run(() => { this.o.width = Math.max(1, this.o.width - (this.o.width > 10 ? 5 : 1)); this.buildToolbar(); this.drawOverlay(); });
    if (k === ']') return run(() => { this.o.width = Math.min(1000, this.o.width + (this.o.width >= 10 ? 5 : 1)); this.buildToolbar(); this.drawOverlay(); });
    // Tool keys: pressing again cycles through the tools sharing that key.
    const group = TOOLS.filter((t) => t.key.toLowerCase() === k);
    if (group.length && !e.altKey) {
      const i = group.findIndex((t) => t.id === this.tool);
      return run(() => this.setTool(group[(i + 1) % group.length].id));
    }
    if (e.key.startsWith('Arrow') && this.tool === 'movesel' && this.doc.sel) {
      const step = e.shiftKey ? 10 : 1, dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      return run(() => { if (!this.moving) this.liftSelection(); this.moving.dx += dx; this.moving.dy += dy; this.updateMove(); });
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function snapAngle(a, p) {
  const ang = Math.round(Math.atan2(p.y - a.y, p.x - a.x) / (Math.PI / 12)) * (Math.PI / 12), len = Math.hypot(p.x - a.x, p.y - a.y);
  return { x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len };
}
function squareFrom(a, p) {
  const s = Math.max(Math.abs(p.x - a.x), Math.abs(p.y - a.y));
  return { x: a.x + Math.sign(p.x - a.x || 1) * s, y: a.y + Math.sign(p.y - a.y || 1) * s };
}
function flip(src, dir) {
  const c = makeCanvas(src.width, src.height), g = ctx2d(c);
  g.translate(dir === 'h' ? src.width : 0, dir === 'v' ? src.height : 0); g.scale(dir === 'h' ? -1 : 1, dir === 'v' ? -1 : 1);
  g.drawImage(src, 0, 0);
  return c;
}
function rotate(src, deg) {
  const c = makeCanvas(deg === 180 ? src.width : src.height, deg === 180 ? src.height : src.width), g = ctx2d(c);
  g.translate(c.width / 2, c.height / 2); g.rotate((deg * Math.PI) / 180); g.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}
// High-quality resize: halve repeatedly when shrinking a lot.
function resample(src, w, hgt) {
  let cur = src;
  while (cur.width / 2 >= w && cur.height / 2 >= hgt) {
    const half = makeCanvas(Math.round(cur.width / 2), Math.round(cur.height / 2)), g = ctx2d(half);
    g.imageSmoothingQuality = 'high'; g.drawImage(cur, 0, 0, half.width, half.height);
    cur = half;
  }
  const out = makeCanvas(w, hgt), g = ctx2d(out);
  g.imageSmoothingQuality = 'high'; g.drawImage(cur, 0, 0, w, hgt);
  return out;
}
function resizeCanvasTo(doc, w, hgt, ox, oy) {
  for (const l of doc.layers) { const c = makeCanvas(w, hgt); ctx2d(c).drawImage(l.canvas, ox, oy); l.canvas = c; }
  if (doc.sel) { const m = makeCanvas(w, hgt); ctx2d(m).drawImage(doc.sel.mask, ox, oy); doc.w = w; doc.h = hgt; doc.setSelMask(m); }
  doc.w = w; doc.h = hgt;
}

// The Curves editor: drag the points; click to add one; drag a point off the graph to remove it.
function curveEditor(p, key, onChange) {
  const c = h('canvas', { class: 'pp-curves', width: 256, height: 256 });
  const draw = () => {
    const g = c.getContext('2d');
    g.clearRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(128,128,128,.3)';
    for (let i = 64; i < 256; i += 64) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.moveTo(0, i); g.lineTo(256, i); g.stroke(); }
    const lut = curveLut(p[key]);
    g.strokeStyle = '#3584e4'; g.lineWidth = 2; g.beginPath();
    for (let x = 0; x < 256; x++) (x ? g.lineTo(x, 255 - lut[x]) : g.moveTo(x, 255 - lut[x]));
    g.stroke();
    for (const [x, y] of p[key]) { g.beginPath(); g.arc(x, 255 - y, 5, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill(); g.strokeStyle = '#3584e4'; g.stroke(); }
  };
  c.addEventListener('pointerdown', (e) => {
    const r = c.getBoundingClientRect(), at = (ev) => [Math.round(((ev.clientX - r.left) / r.width) * 255), Math.round(255 - ((ev.clientY - r.top) / r.height) * 255)];
    const [x, y] = at(e);
    const pts = p[key];
    let i = pts.findIndex(([px, py]) => Math.hypot(px - x, py - y) < 10);
    if (i < 0) { pts.push([x, y]); i = pts.length - 1; }
    c.setPointerCapture(e.pointerId);
    const mv = (ev) => {
      let [nx, ny] = at(ev);
      const off = nx < -20 || nx > 275 || ny < -20 || ny > 275;
      if (off && pts.length > 2) { pts.splice(i, 1); c.removeEventListener('pointermove', mv); draw(); onChange(); return; }
      nx = Math.max(0, Math.min(255, nx)); ny = Math.max(0, Math.min(255, ny));
      pts[i] = [nx, ny];
      draw(); onChange();
    };
    c.addEventListener('pointermove', mv);
    c.addEventListener('pointerup', () => c.removeEventListener('pointermove', mv), { once: true });
    draw(); onChange();
  });
  draw();
  return h('div', { class: 'pd-field' }, h('span', {}, 'Curve (drag points; click to add; drag off to remove)'), c);
}
