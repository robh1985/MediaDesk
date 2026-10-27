// Getting around The Game Console with a controller, the keyboard, a mouse or touch.
// Anything marked data-nav can be focused; arrow keys / D-pad / left stick move to the nearest
// one in that direction, Enter / A picks it, Esc / Backspace / B goes back.

import { pads } from './controls.js';

// Standard gamepad buttons -> actions. (On Nintendo pads the browser still reports the
// bottom button as 0, so "A" here is always the bottom face button, like on the consoles.)
const PAD_ACTIONS = { 0: 'select', 1: 'back', 2: 'details', 3: 'favorite', 4: 'prev', 5: 'next', 8: 'menu', 9: 'menu', 12: 'up', 13: 'down', 14: 'left', 15: 'right', 16: 'menu' };
const KEY_ACTIONS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'select', ' ': 'select', Escape: 'back', Backspace: 'back', f: 'favorite', i: 'details', m: 'menu', PageUp: 'prev', PageDown: 'next', '[': 'prev', ']': 'next' };

export class Nav {
  constructor(root, { onAction, isActive }) {
    this.root = root;
    this.onAction = onAction;
    this.isActive = isActive || (() => true);
    this.current = null;
    this.handlers = [];
    this.mode = 'pointer';
    this.onKey = (e) => {
      if (!this.isActive() || e.defaultPrevented) return;
      if (e.target.closest?.('input, textarea, select') && !['Escape', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      const action = KEY_ACTIONS[e.key.length === 1 ? e.key.toLowerCase() : e.key];
      if (!action) return;
      e.preventDefault();
      this.setMode('keys');
      this.act(action);
    };
    document.addEventListener('keydown', this.onKey);
    root.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      this.setMode('pointer');
      const el = e.target.closest?.('[data-nav]');
      if (el && el !== this.current && this.root.contains(el)) this.focus(el, { scroll: false, silent: true });
    });
    root.addEventListener('click', (e) => {
      const el = e.target.closest?.('[data-nav]');
      if (!el || !this.root.contains(el)) return;
      this.focus(el, { scroll: false });
      this.onAction('select', el, e);
    });
    this.pollPads();
  }

  setMode(m) { if (this.mode !== m) { this.mode = m; this.root.dataset.input = m; } }

  items() { return [...this.root.querySelectorAll('[data-nav]')].filter((el) => el.offsetParent !== null && !el.closest('[inert]')); }

  focus(el, { scroll = true, silent = false } = {}) {
    if (!el) return;
    this.current?.classList.remove('focused');
    this.current = el;
    el.classList.add('focused');
    if (scroll) el.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    if (!silent) this.onAction('focus', el);
    else this.onAction('hover', el);
  }

  // Focus by key (after a re-render), or the first item.
  restore(key) {
    const items = this.items();
    const el = (key && items.find((x) => x.dataset.nav === key)) || items.find((x) => x.hasAttribute('data-nav-default')) || items[0];
    if (el) this.focus(el, { scroll: true });
  }

  act(action) {
    if (['up', 'down', 'left', 'right'].includes(action)) return this.move(action);
    this.onAction(action, this.current);
  }

  move(dir) {
    if (!this.current || !this.current.isConnected) { this.restore(); return; }
    // A theme can take over moves (e.g. a carousel that wraps around).
    if (this.onAction('move', this.current, dir) === true) return;
    const from = this.current.getBoundingClientRect();
    const fx = from.left + from.width / 2, fy = from.top + from.height / 2;
    let best = null, bestScore = Infinity;
    for (const el of this.items()) {
      if (el === this.current) continue;
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const dx = x - fx, dy = y - fy;
      let main, side, overlap;
      if (dir === 'left' || dir === 'right') {
        main = dir === 'left' ? -dx : dx; side = Math.abs(dy);
        overlap = r.bottom > from.top + 2 && r.top < from.bottom - 2;
        if (r.right > from.left + 1 && dir === 'left') continue;
        if (r.left < from.right - 1 && dir === 'right') continue;
      } else {
        main = dir === 'up' ? -dy : dy; side = Math.abs(dx);
        overlap = r.right > from.left + 2 && r.left < from.right - 2;
        if (r.bottom > from.top + 1 && dir === 'up') continue;
        if (r.top < from.bottom - 1 && dir === 'down') continue;
      }
      if (main <= 0) continue;
      // Left/right stay on the same line, like a TV menu; up/down may go anywhere below/above.
      if ((dir === 'left' || dir === 'right') && !overlap) continue;
      // Prefer things in the same row/column, then the closest.
      const score = main + side * (overlap ? 0.5 : 3) + (overlap ? 0 : 400);
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (best) { this.focus(best); this.onAction('moved', best, dir); }
    else this.onAction('edge', this.current, dir);
  }

  // Controllers: D-pad, left stick and buttons, with key-repeat when held.
  pollPads() {
    const held = new Map(); // action -> { next }
    let wasActive = false;
    const tick = (t) => {
      if (this.destroyed) return;
      this.raf = requestAnimationFrame(tick);
      if (!this.isActive() || document.hidden) { held.clear(); wasActive = false; return; }
      const now = new Set();
      for (const gp of pads()) {
        gp.buttons.forEach((b, i) => { if (b.pressed && PAD_ACTIONS[i]) now.add(PAD_ACTIONS[i]); });
        const [ax = 0, ay = 0] = gp.axes;
        if (ax < -0.55) now.add('left'); else if (ax > 0.55) now.add('right');
        if (ay < -0.55) now.add('up'); else if (ay > 0.55) now.add('down');
      }
      // Buttons already down when this became active (e.g. the one that opened a menu) only
      // count once they've been let go.
      if (!wasActive) { wasActive = true; for (const a of now) held.set(a, { next: Infinity }); return; }
      for (const a of [...held.keys()]) if (!now.has(a)) held.delete(a);
      for (const a of now) {
        const h = held.get(a);
        const repeats = ['up', 'down', 'left', 'right', 'prev', 'next'].includes(a);
        if (!h) { held.set(a, { next: t + 380 }); this.setMode('pad'); this.act(a); }
        else if (repeats && t >= h.next) { h.next = t + 110; this.act(a); }
      }
    };
    this.raf = requestAnimationFrame(tick);
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    document.removeEventListener('keydown', this.onKey);
  }
}

// Little interface sounds, like a console menu (off unless chosen in settings).
let ctx;
export function blip(kind = 'move', on = false) {
  if (!on) return;
  try {
    ctx ||= new AudioContext();
    const o = ctx.createOscillator(), g = ctx.createGain();
    const f = { move: 660, select: 880, back: 440, error: 220 }[kind] || 660;
    o.type = kind === 'select' ? 'triangle' : 'sine';
    o.frequency.setValueAtTime(f, ctx.currentTime);
    if (kind === 'select') o.frequency.exponentialRampToValueAtTime(f * 1.5, ctx.currentTime + 0.08);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
    o.connect(g).connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.13);
  } catch { /* no audio */ }
}
