// Calculator: basic, scientific and graphing modes. The maths lives in calc-math.js.

import { h, clear } from '../ui.js';
import { icon, appIcon } from '../icons.js';
import { compile, evaluate, autoClose, format, pretty, ANGLE_FACTORS } from './calc-math.js';

const STORE = 'mediadesk.calculator';
const SIZES = { basic: [340, 560], scientific: [760, 560], graphing: [980, 660] };
const COLORS = ['#3b82f6', '#ef4444', '#16a34a', '#a855f7', '#f59e0b', '#0ea5e9', '#ec4899', '#64748b'];

function load() {
  try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; }
}
function save(patch) {
  try { localStorage.setItem(STORE, JSON.stringify({ ...load(), ...patch })); } catch { /* ignore */ }
}

export const calculatorApp = {
  id: 'calculator', name: 'Calculator', icon: appIcon.calculator, size: SIZES[load().mode || 'basic'], description: 'Basic, scientific and graphing calculator',
  open(win) { new Calculator(win); },
};

class Calculator {
  constructor(win) {
    this.win = win;
    const s = load();
    this.mode = s.mode || 'basic';
    this.angle = s.angle || 'deg';
    this.history = s.history || [];
    this.memory = s.memory || 0;
    this.ans = s.ans || 0;
    this.second = false;
    this.justEvaluated = false;
    this.build();
    this.setMode(this.mode, false);
  }

  build() {
    this.tabs = h('div', { class: 'seg calc-tabs' }, [['basic', 'Basic'], ['scientific', 'Scientific'], ['graphing', 'Graphing']].map(([id, label]) =>
      h('button', { class: 'seg-btn', dataset: { mode: id }, onclick: () => this.setMode(id) }, label)));
    this.input = h('input', { class: 'calc-input', spellcheck: 'false', autocomplete: 'off', inputmode: 'none', 'aria-label': 'Expression' });
    this.preview = h('div', { class: 'calc-preview', 'aria-live': 'polite' });
    this.flags = h('div', { class: 'calc-flags' });
    this.display = h('div', { class: 'calc-display' }, this.flags, this.input, this.preview);
    this.sciPad = h('div', { class: 'calc-pad calc-sci' });
    this.basicPad = h('div', { class: 'calc-pad calc-basic' });
    this.historyList = h('div', { class: 'calc-history-list' });
    this.historyPane = h('aside', { class: 'calc-history' },
      h('div', { class: 'calc-history-head' }, h('strong', {}, 'History'),
        h('button', { class: 'btn btn-sm btn-ghost', onclick: () => { this.history = []; save({ history: [] }); this.renderHistory(); } }, 'Clear')),
      this.historyList);
    this.calcView = h('div', { class: 'calc-calc' }, h('div', { class: 'calc-main' }, this.display, h('div', { class: 'calc-pads' }, this.sciPad, this.basicPad)), this.historyPane);
    this.graphView = h('div', { class: 'calc-graphview' });
    this.root = h('div', { class: 'calc' }, h('div', { class: 'calc-top' }, this.tabs), this.calcView, this.graphView);
    clear(this.win.body, this.root);

    this.renderBasicPad();
    this.renderSciPad();
    this.renderHistory();

    this.input.addEventListener('input', () => { this.normaliseInput(); this.justEvaluated = false; this.updatePreview(); });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || (e.key === '=' && !e.shiftKey)) { e.preventDefault(); this.equals(); }
      else if (e.key === 'Escape') { e.preventDefault(); this.clearAll(); }
      else if (this.justEvaluated && e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        // After "=", an operator continues from the answer; anything else starts afresh.
        if (!'+-*/^%!×÷−²'.includes(e.key)) { this.input.value = ''; }
        this.justEvaluated = false;
      }
    });
    // Typing anywhere in the window goes to the expression.
    this.win.body.addEventListener('keydown', (e) => {
      if (this.mode === 'graphing' || e.target === this.input || e.target.closest('input, textarea')) return;
      if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Enter' || e.key === 'Escape') { this.input.focus(); if (e.key === 'Enter') { e.preventDefault(); this.equals(); } }
    });
  }

  setMode(mode, resize = true) {
    this.mode = mode;
    save({ mode });
    this.root.dataset.mode = mode;
    this.tabs.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    this.win.setTitle(`Calculator — ${mode[0].toUpperCase()}${mode.slice(1)}`);
    if (resize) this.win.setSize?.(...SIZES[mode]);
    if (mode === 'graphing') {
      if (!this.graph) this.graph = new Grapher(this.graphView);
      this.graph.resize();
    } else {
      this.updateFlags();
      if (!matchMedia('(pointer: coarse)').matches) setTimeout(() => this.input.focus(), 0);
    }
  }

  // ---- Keypads ----

  key(label, action, cls = '', title) {
    return h('button', { class: `calc-key ${cls}`, title: title || undefined, 'aria-label': title || undefined, onclick: () => { action(); this.keepFocus(); } }, label);
  }
  keepFocus() {
    if (!matchMedia('(pointer: coarse)').matches) this.input.focus();
  }

  renderBasicPad() {
    const k = (label, fn, cls, title) => this.key(label, fn, cls, title);
    const ins = (t) => () => this.insert(t);
    clear(this.basicPad,
      k('C', () => this.clearAll(), 'fn', 'Clear'), k('⌫', () => this.backspace(), 'fn', 'Backspace'), k('%', ins('%'), 'fn', 'Percent'), k('÷', ins('÷'), 'op', 'Divide'),
      k('7', ins('7')), k('8', ins('8')), k('9', ins('9')), k('×', ins('×'), 'op', 'Multiply'),
      k('4', ins('4')), k('5', ins('5')), k('6', ins('6')), k('−', ins('−'), 'op', 'Subtract'),
      k('1', ins('1')), k('2', ins('2')), k('3', ins('3')), k('+', ins('+'), 'op', 'Add'),
      k('±', () => this.toggleSign(), '', 'Change sign'), k('0', ins('0')), k('.', ins('.')), k('=', () => this.equals(), 'eq', 'Equals'));
  }

  renderSciPad() {
    const s = this.second;
    const k = (label, fn, cls, title) => this.key(label, fn, cls, title);
    const ins = (t) => () => this.insert(t);
    const fnk = (name, label = name) => k(label, () => this.insert(`${name}(`), 'sci', `${name}`);
    clear(this.sciPad,
      k('2nd', () => { this.second = !this.second; this.renderSciPad(); }, `sci ${s ? 'on' : ''}`, 'Second functions'),
      k(this.angle.toUpperCase(), () => this.cycleAngle(), 'sci angle', 'Angle unit'),
      k('(', ins('('), 'sci'), k(')', ins(')'), 'sci'), k('n!', ins('!'), 'sci', 'Factorial'),
      s ? fnk('asin', 'sin⁻¹') : fnk('sin'), s ? fnk('acos', 'cos⁻¹') : fnk('cos'), s ? fnk('atan', 'tan⁻¹') : fnk('tan'),
      s ? fnk('sinh') : fnk('ln'), s ? fnk('cosh') : fnk('log'),
      s ? k('x³', ins('³'), 'sci', 'Cube') : k('x²', ins('²'), 'sci', 'Square'),
      k('xʸ', ins('^'), 'sci', 'Power'),
      s ? k('∛', ins('∛('), 'sci', 'Cube root') : k('√', ins('√('), 'sci', 'Square root'),
      s ? fnk('tanh') : k('eˣ', ins('e^('), 'sci', 'e to the power'),
      s ? fnk('log2', 'log₂') : k('10ˣ', ins('10^('), 'sci', '10 to the power'),
      k('π', ins('π'), 'sci', 'Pi'), k('e', ins('e'), 'sci', 'Euler’s number'), k('|x|', ins('abs('), 'sci', 'Absolute value'),
      k('1/x', () => this.reciprocal(), 'sci', 'Reciprocal'), k('mod', ins(' mod '), 'sci', 'Modulo'),
      k('EXP', ins('E'), 'sci', '×10 to the power'), k('Ans', ins('Ans'), 'sci', 'Last answer'),
      k('M+', () => this.memAdd(1), 'sci', 'Add to memory'), k('M−', () => this.memAdd(-1), 'sci', 'Subtract from memory'),
      k('MR', () => this.insert(format(this.memory)), 'sci', 'Recall memory'));
  }

  // ---- Editing ----

  insert(text) {
    const el = this.input;
    if (this.justEvaluated) {
      if (!/^[+×÷−^%!²³]|^ mod /.test(text)) el.value = '';
      this.justEvaluated = false;
    }
    const start = el.selectionStart ?? el.value.length, end = el.selectionEnd ?? el.value.length;
    el.setRangeText(text, start, end, 'end');
    this.updatePreview();
  }
  backspace() {
    const el = this.input;
    this.justEvaluated = false;
    let start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    if (start === end) {
      // Remove a whole function name like "sin(" at once.
      const m = /([a-z⁻¹₂]+\(|Ans| mod )$/.exec(el.value.slice(0, start));
      start = Math.max(0, start - (m ? m[0].length : 1));
    }
    el.setRangeText('', start, end, 'end');
    this.updatePreview();
  }
  clearAll() {
    this.input.value = '';
    this.justEvaluated = false;
    this.updatePreview();
  }
  toggleSign() {
    const el = this.input;
    if (this.justEvaluated) this.justEvaluated = false;
    const caret = el.selectionStart ?? el.value.length;
    const before = el.value.slice(0, caret);
    const m = /(^|[^\d.E])(−?)(\d*\.?\d+(?:E[+-]?\d+)?)$/.exec(before);
    if (!m) { this.insert('−'); return; }
    const numStart = before.length - m[3].length - m[2].length;
    const replacement = m[2] ? m[3] : `−${m[3]}`;
    el.setRangeText(replacement, numStart, caret, 'end');
    this.updatePreview();
  }
  reciprocal() {
    const v = this.input.value.trim();
    this.input.value = v ? `1/(${v})` : '1/';
    this.justEvaluated = false;
    this.updatePreview();
  }
  cycleAngle() {
    this.angle = { deg: 'rad', rad: 'grad', grad: 'deg' }[this.angle];
    save({ angle: this.angle });
    this.renderSciPad();
    this.updateFlags();
    this.updatePreview();
  }
  memAdd(sign) {
    const v = this.tryEval(this.input.value);
    if (v === null) return;
    this.memory += sign * v;
    save({ memory: this.memory });
    this.updateFlags();
  }
  normaliseInput() {
    const el = this.input;
    const caret = el.selectionStart;
    const v = el.value.replace(/\*/g, '×').replace(/\//g, '÷').replace(/-/g, '−');
    if (v !== el.value) { el.value = v; el.setSelectionRange(caret, caret); }
  }

  tryEval(text) {
    if (!text.trim()) return null;
    try {
      const v = evaluate(autoClose(text), { angle: this.angle, ans: this.ans });
      return typeof v === 'number' && !Number.isNaN(v) ? v : null;
    } catch { return null; }
  }

  updatePreview() {
    const text = this.input.value;
    const v = this.tryEval(text);
    const plain = /^\s*−?\d*\.?\d+(E[+-]?\d+)?\s*$/.test(text);
    this.preview.textContent = v !== null && !plain && !this.justEvaluated ? `= ${pretty(format(v))}` : '';
    this.root.classList.toggle('calc-long', text.length > 16);
  }

  updateFlags() {
    clear(this.flags,
      this.mode === 'scientific' ? h('span', {}, this.angle.toUpperCase()) : null,
      this.memory ? h('span', { title: `Memory: ${format(this.memory)}` }, 'M') : null);
  }

  equals() {
    const text = this.input.value;
    if (!text.trim()) return;
    let v;
    try { v = evaluate(autoClose(text), { angle: this.angle, ans: this.ans }); }
    catch (err) {
      this.preview.textContent = err.message === 'Empty' ? '' : err.message;
      this.preview.classList.add('error');
      setTimeout(() => this.preview.classList.remove('error'), 1500);
      return;
    }
    const result = format(v);
    if (result !== 'Error') this.ans = v;
    this.history.unshift({ expr: autoClose(text.trim()), result });
    this.history = this.history.slice(0, 50);
    save({ history: this.history, ans: this.ans });
    this.input.value = result === 'Error' ? 'Error' : result.replace(/-/g, '−');
    this.justEvaluated = true;
    this.preview.textContent = '';
    this.renderHistory();
  }

  renderHistory() {
    clear(this.historyList, this.history.length ? this.history.map((it) => h('button', {
      class: 'calc-history-item', title: 'Use this result',
      onclick: () => { this.input.value = it.result.replace(/-/g, '−'); this.justEvaluated = true; this.updatePreview(); this.keepFocus(); },
    }, h('span', { class: 'small muted' }, `${it.expr} =`), h('strong', {}, pretty(it.result))))
      : h('div', { class: 'small muted calc-history-empty' }, 'Calculations appear here.'));
  }
}

// ---------------------------------------------------------------------------
// Graphing
// ---------------------------------------------------------------------------

class Grapher {
  constructor(host) {
    const s = load();
    this.fns = (s.graphs || [{ expr: 'sin(x)' }, { expr: 'x^2/4 − 2' }]).map((f, i) => ({ expr: f.expr, color: COLORS[i % COLORS.length], on: f.on !== false }));
    this.view = { cx: 0, cy: 0, scale: 50 };
    this.pointers = new Map();
    this.list = h('div', { class: 'graph-fns' });
    this.canvas = h('canvas', { class: 'graph-canvas' });
    this.tip = h('div', { class: 'graph-tip', hidden: true });
    const tool = (glyph, title, fn) => h('button', { class: 'btn btn-icon btn-sm', title, 'aria-label': title, onclick: fn }, h('span', { html: glyph }));
    const plus = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
    const minus = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14"/></svg>';
    const home = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11l8-7 8 7v9H4z"/></svg>';
    this.stage = h('div', { class: 'graph-stage' }, this.canvas, this.tip,
      h('div', { class: 'graph-tools' }, tool(plus, 'Zoom in', () => this.zoom(1.5)), tool(minus, 'Zoom out', () => this.zoom(1 / 1.5)),
        tool(home, 'Reset view', () => { this.view = { cx: 0, cy: 0, scale: 50 }; this.draw(); })));
    clear(host, h('div', { class: 'graph' },
      h('div', { class: 'graph-side' }, this.list,
        h('button', { class: 'btn btn-sm graph-add', onclick: () => this.add() }, h('span', { html: plus }), 'Add function'),
        h('p', { class: 'small muted graph-help' }, 'Use x as the variable, e.g. 2x^2 − 3, sin(x)/x, √x, |x|, ln(x). Drag to move, scroll or pinch to zoom.')),
      this.stage));
    this.renderList();
    new ResizeObserver(() => this.resize()).observe(this.stage);
    this.bindPointer();
  }

  persist() { save({ graphs: this.fns.map((f) => ({ expr: f.expr, on: f.on })) }); }

  add() {
    if (this.fns.length >= COLORS.length) return;
    const used = new Set(this.fns.map((f) => f.color));
    this.fns.push({ expr: '', color: COLORS.find((c) => !used.has(c)) || COLORS[0], on: true });
    this.renderList();
    this.list.querySelector('.graph-fn:last-child input')?.focus();
  }

  renderList() {
    clear(this.list, this.fns.map((f, i) => {
      const err = h('div', { class: 'graph-err small' });
      const input = h('input', { class: 'input graph-input', value: f.expr, spellcheck: 'false', placeholder: 'e.g. x^2', 'aria-label': `Function ${i + 1}` });
      const check = () => {
        f.fn = null;
        err.textContent = '';
        const src = f.expr.replace(/^\s*(y|f\(x\))\s*=/i, '').trim();
        if (!src) return;
        try { const c = compile(src, { vars: ['x'] }); f.fn = (x) => c({ x, angle: ANGLE_FACTORS.rad }); }
        catch (e) { err.textContent = e.message; }
      };
      input.addEventListener('input', () => { f.expr = input.value; check(); this.persist(); this.draw(); });
      check();
      return h('div', { class: `graph-fn ${f.on ? '' : 'off'}` },
        h('button', { class: 'graph-swatch', style: { '--c': f.color }, title: f.on ? 'Hide' : 'Show', 'aria-label': f.on ? 'Hide graph' : 'Show graph',
          onclick: () => { f.on = !f.on; this.persist(); this.renderList(); this.draw(); } }),
        h('span', { class: 'graph-y' }, 'y ='),
        h('div', { class: 'grow' }, input, err),
        h('button', { class: 'btn btn-icon btn-sm btn-ghost', title: 'Remove', 'aria-label': 'Remove', html: icon.x, onclick: () => { this.fns.splice(i, 1); this.persist(); this.renderList(); this.draw(); } }));
    }));
    this.draw();
  }

  resize() {
    const r = this.stage.getBoundingClientRect();
    if (!r.width) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.w = r.width; this.h = r.height;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.ctx = this.canvas.getContext('2d');
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  toScreen(x, y) { return [this.w / 2 + (x - this.view.cx) * this.view.scale, this.h / 2 - (y - this.view.cy) * this.view.scale]; }
  toWorld(px, py) { return [this.view.cx + (px - this.w / 2) / this.view.scale, this.view.cy - (py - this.h / 2) / this.view.scale]; }

  zoom(factor, px = this.w / 2, py = this.h / 2) {
    const [wx, wy] = this.toWorld(px, py);
    this.view.scale = Math.min(1e6, Math.max(1e-4, this.view.scale * factor));
    // Keep the point under the cursor fixed.
    this.view.cx = wx - (px - this.w / 2) / this.view.scale;
    this.view.cy = wy + (py - this.h / 2) / this.view.scale;
    this.draw();
  }

  bindPointer() {
    const c = this.canvas;
    c.addEventListener('wheel', (e) => { e.preventDefault(); const r = c.getBoundingClientRect(); this.zoom(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.pinch = null;
    });
    c.addEventListener('pointermove', (e) => {
      const r = c.getBoundingClientRect();
      const prev = this.pointers.get(e.pointerId);
      if (!prev) { this.trace(e.clientX - r.left, e.clientY - r.top); return; }
      if (this.pointers.size === 2) {
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const [a, b] = [...this.pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.pinch) this.zoom(dist / this.pinch, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
        this.pinch = dist;
        return;
      }
      this.view.cx -= (e.clientX - prev.x) / this.view.scale;
      this.view.cy += (e.clientY - prev.y) / this.view.scale;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.draw();
      if (e.pointerType === 'touch') this.trace(e.clientX - r.left, e.clientY - r.top);
    });
    const up = (e) => { this.pointers.delete(e.pointerId); this.pinch = null; };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('pointerleave', () => { if (!this.pointers.size) { this.traceAt = null; this.tip.hidden = true; this.draw(); } });
  }

  // Follow the graph nearest the pointer and show its coordinates.
  trace(px, py) {
    const [wx] = this.toWorld(px, py);
    let best = null;
    for (const f of this.fns) {
      if (!f.on || !f.fn) continue;
      const y = f.fn(wx);
      if (!Number.isFinite(y)) continue;
      const sy = this.toScreen(wx, y)[1];
      if (!best || Math.abs(sy - py) < Math.abs(best.sy - py)) best = { f, x: wx, y, sy };
    }
    this.traceAt = best && Math.abs(best.sy - py) < 120 ? best : null;
    this.draw();
    if (!this.traceAt) { this.tip.hidden = true; return; }
    const step = 10 ** Math.floor(Math.log10(1 / this.view.scale) + 1);
    const round = (v) => format(Math.round(v / step) * step, 10);
    this.tip.hidden = false;
    this.tip.style.setProperty('--c', best.f.color);
    this.tip.textContent = `(${round(best.x)}, ${format(Number(best.y.toPrecision(6)))})`;
    const tx = Math.min(this.w - 140, px + 14), ty = Math.max(4, best.sy - 34);
    this.tip.style.transform = `translate(${tx}px, ${ty}px)`;
  }

  draw() {
    const g = this.ctx;
    if (!g || !this.w) return;
    const { w, h: H } = this;
    const css = getComputedStyle(this.stage);
    const fg = css.getPropertyValue('--text').trim() || '#111';
    const muted = css.getPropertyValue('--text-muted').trim() || '#888';
    g.clearRect(0, 0, w, H);

    // Grid: major lines every 1, 2 or 5 × 10ⁿ units, about 90px apart.
    const raw = 90 / this.view.scale, mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw);
    const minor = step / (String(step / mag).startsWith('2') ? 4 : 5);
    const [x0, y1] = this.toWorld(0, 0), [x1, y0] = this.toWorld(w, H);
    const lines = (s, style) => {
      g.strokeStyle = style; g.lineWidth = 1; g.beginPath();
      for (let x = Math.ceil(x0 / s) * s; x <= x1; x += s) { const px = Math.round(this.toScreen(x, 0)[0]) + 0.5; g.moveTo(px, 0); g.lineTo(px, H); }
      for (let y = Math.ceil(y0 / s) * s; y <= y1; y += s) { const py = Math.round(this.toScreen(0, y)[1]) + 0.5; g.moveTo(0, py); g.lineTo(w, py); }
      g.stroke();
    };
    g.globalAlpha = 0.07; lines(minor, fg);
    g.globalAlpha = 0.16; lines(step, fg);
    g.globalAlpha = 1;

    // Axes and labels.
    const [ax, ay] = this.toScreen(0, 0);
    g.strokeStyle = muted; g.lineWidth = 1.4; g.beginPath();
    g.moveTo(0, ay); g.lineTo(w, ay); g.moveTo(ax, 0); g.lineTo(ax, H); g.stroke();
    g.fillStyle = muted; g.font = '11px system-ui, sans-serif';
    const lx = Math.min(Math.max(ax, 4), w - 40), ly = Math.min(Math.max(ay, 4), H - 16);
    g.textAlign = 'center'; g.textBaseline = 'top';
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
      if (Math.abs(x) < step / 2) continue;
      g.fillText(format(Number(x.toPrecision(10)), 8), this.toScreen(x, 0)[0], ly + 3);
    }
    g.textAlign = ax > w - 40 ? 'right' : 'left'; g.textBaseline = 'middle';
    for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) {
      if (Math.abs(y) < step / 2) continue;
      g.fillText(format(Number(y.toPrecision(10)), 8), lx + (ax > w - 40 ? -4 : 5), this.toScreen(0, y)[1]);
    }

    // Functions, sampled once per pixel; lines break at gaps and asymptotes.
    for (const f of this.fns) {
      if (!f.on || !f.fn) continue;
      g.strokeStyle = f.color; g.lineWidth = 2.4; g.lineJoin = 'round';
      g.beginPath();
      let prev = null;
      for (let px = -1; px <= w + 1; px += 0.5) {
        const x = this.toWorld(px, 0)[0];
        let y;
        try { y = f.fn(x); } catch { y = NaN; }
        if (!Number.isFinite(y)) { prev = null; continue; }
        const py = this.toScreen(x, y)[1];
        if (prev === null || Math.abs(py - prev) > H * 1.5) g.moveTo(px, Math.max(-1e4, Math.min(1e4, py)));
        else g.lineTo(px, Math.max(-1e4, Math.min(1e4, py)));
        prev = py;
      }
      g.stroke();
    }

    if (this.traceAt) {
      const [px, py] = this.toScreen(this.traceAt.x, this.traceAt.y);
      g.fillStyle = this.traceAt.f.color;
      g.strokeStyle = '#fff'; g.lineWidth = 2;
      g.beginPath(); g.arc(px, py, 5, 0, Math.PI * 2); g.fill(); g.stroke();
    }
  }
}
