// A flipbook: pages shown as an open book that turn like paper. Drag a page's corner and it curls
// over, following the pointer (the fold line, the back of the page and the shadows all move with
// it); let go past the middle and it turns, before it and it falls back. Hovering near a corner
// lifts it a little. Covers are stiff and swing over on the spine. A click or tap turns a page,
// and so does a swipe. One page at a time on narrow screens, two side by side otherwise; a closed
// book (on its front or back cover) sits in the middle.
//
// The pages themselves come from the caller: renderPage(i) returns an element for page i.

import { h } from '../../ui.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// The part of a W×H rectangle on one side of a line (through m, normal n): side(X) = (X−m)·n.
function clipRect(W, H, m, n, keepPositive) {
  const pts = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }];
  const s = (p) => (p.x - m.x) * n.x + (p.y - m.y) * n.y;
  const inside = (p) => (keepPositive ? s(p) > 0 : s(p) <= 0);
  const out = [];
  for (let i = 0; i < 4; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % 4];
    const ia = inside(a);
    const ib = inside(b);
    if (ia) out.push(a);
    if (ia !== ib) {
      const sa = s(a);
      const t = sa / (sa - s(b));
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}
const poly = (pts) => (pts.length >= 3 ? `polygon(${pts.map((p) => `${p.x.toFixed(2)}px ${p.y.toFixed(2)}px`).join(',')})` : 'polygon(0 0,0 0,0 0)');

// A soft "flip" sound: a short brush of filtered noise.
let audio = null;
function flipSound() {
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    const len = 0.32;
    const buf = audio.createBuffer(1, Math.floor(audio.sampleRate * len), audio.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) { const t = i / d.length; d[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * t) ** 2 * (1 - t * 0.6); }
    const src = audio.createBufferSource();
    src.buffer = buf;
    const bp = audio.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1800, audio.currentTime);
    bp.frequency.linearRampToValueAtTime(4200, audio.currentTime + len);
    bp.Q.value = 0.7;
    const g = audio.createGain();
    g.gain.value = 0.22;
    src.connect(bp).connect(g).connect(audio.destination);
    src.start();
  } catch { /* no sound */ }
}

export class Flipbook {
  // opts: count, renderPage(i) → element, aspect (page width / height), mode ('auto' | 'single' |
  // 'double'), hardCovers, sound, onChange(page), onResize({ width, height, double }),
  // onZoom(zoom), onTap(page, event) (a click on a page that didn't turn it)
  constructor(container, opts) {
    this.c = container;
    this.o = { mode: 'auto', aspect: 0.7, hardCovers: true, sound: true, ...opts };
    this.count = opts.count;
    this.page = 0; // the first page in view
    this.cache = new Map();
    this.zoom = 1;
    this.pan = { x: 0, y: 0 };
    this.flip = null; // the page being turned
    this.anim = null;
    this.book = h('div', { class: 'fb-book' });
    this.zoomer = h('div', { class: 'fb-zoom' }, this.book);
    this.root = h('div', { class: 'fb', tabindex: '-1' }, this.zoomer);
    container.append(this.root);
    this.blank = h('div', { class: 'fb-page fb-blank' });
    this.bind();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.root);
    this.resize(true);
  }

  // --- Layout -------------------------------------------------------------------------------

  get double() { return this.isDouble; }
  // The spread (or, one at a time, the page) that page i is in.
  spreadOf(i) { return this.isDouble ? Math.ceil(clamp(i, 0, this.count - 1) / 2) : clamp(i, 0, this.count - 1); }
  get spread() { return this.spreadOf(this.page); }
  get lastSpread() { return this.spreadOf(this.count - 1); }
  // [left, right] page numbers of a spread (null where there's no page).
  pagesAt(s) {
    if (!this.isDouble) return [null, s];
    const l = 2 * s - 1;
    const r = 2 * s;
    return [l >= 0 && l < this.count ? l : null, r < this.count ? r : null];
  }

  resize(first = false) {
    const cw = this.root.clientWidth;
    const ch = this.root.clientHeight;
    if (!cw || !ch) return;
    const a = this.o.aspect;
    const padX = cw < 600 ? 10 : 70;
    const padY = cw < 600 ? 10 : 26;
    const fitH = (across) => Math.min(ch - padY * 2, (cw - padX * 2) / across / a);
    const wantDouble = this.o.mode === 'double' || (this.o.mode === 'auto' && fitH(2) >= fitH(1) * 0.62 && cw > 700);
    const H = Math.max(120, Math.floor(fitH(wantDouble ? 2 : 1)));
    const W = Math.floor(H * a);
    const changed = W !== this.W || H !== this.H || wantDouble !== this.isDouble;
    this.W = W;
    this.H = H;
    this.isDouble = wantDouble;
    this.book.style.width = `${W * (wantDouble ? 2 : 1)}px`;
    this.book.style.height = `${H}px`;
    this.root.classList.toggle('fb-double', wantDouble);
    if (changed || first) {
      this.stopFlip();
      this.o.onResize?.({ width: W, height: H, double: wantDouble });
      this.draw();
    }
  }

  setMode(mode) { this.o.mode = mode; this.resize(true); }
  setAspect(a) { this.o.aspect = a; this.resize(true); }
  // New pages (a different page size or font): forget the drawn pages.
  reset(count = this.count, page = this.page) {
    this.stopFlip();
    this.count = count;
    this.cache.clear();
    this.page = clamp(page, 0, Math.max(0, count - 1));
    this.draw();
  }
  // Redraw some pages (a PDF page drawn sharper, say).
  refreshPages(test = () => true) {
    for (const i of [...this.cache.keys()]) if (test(i)) this.cache.delete(i);
    if (!this.flip) this.draw();
  }

  pageEl(i) {
    if (i == null || i < 0 || i >= this.count) return null;
    let el = this.cache.get(i);
    if (!el) {
      el = h('div', { class: 'fb-page', dataset: { page: i }, 'aria-label': `Page ${i + 1}` });
      const content = this.o.renderPage(i, { width: this.W, height: this.H, double: this.isDouble });
      if (content instanceof Promise) content.then((c) => { if (c) el.replaceChildren(c); }).catch(() => {});
      else if (content) el.append(content);
      this.cache.set(i, el);
      // Keep the pages near the reader; let the rest go.
      if (this.cache.size > 24) {
        const near = new Set(this.nearby());
        for (const k of this.cache.keys()) if (!near.has(k) && this.cache.size > 16) this.cache.delete(k);
      }
    }
    if (this.o.hardCovers) el.classList.toggle('fb-hard', i === 0 || (i === this.count - 1 && this.count > 2));
    return el;
  }
  nearby() {
    const s = this.spread;
    const out = [];
    for (let k = s - 2; k <= s + 2; k++) out.push(...this.pagesAt(k).filter((x) => x != null));
    return out;
  }

  place(el, x, side, z = 1) {
    if (!el) return null;
    Object.assign(el.style, { left: `${x}px`, top: '0px', width: `${this.W}px`, height: `${this.H}px`, zIndex: z, clipPath: '', transform: '' });
    el.classList.toggle('fb-left', side === 'left');
    el.classList.toggle('fb-right', side === 'right');
    this.book.append(el);
    return el;
  }

  // The book's offset: a closed book sits in the middle.
  shiftFor(s) {
    if (!this.isDouble) return 0;
    const [l, r] = this.pagesAt(s);
    if (l == null && r != null) return -this.W / 2;
    if (r == null && l != null) return this.W / 2;
    return 0;
  }

  draw() {
    if (!this.W) return;
    this.book.replaceChildren();
    const [l, r] = this.pagesAt(this.spread);
    if (this.isDouble) {
      this.place(this.pageEl(l), 0, 'left');
      this.place(this.pageEl(r), this.W, 'right');
    } else this.place(this.pageEl(r), 0, 'right');
    this.book.style.setProperty('--shift', `${this.shiftFor(this.spread)}px`);
    this.book.classList.toggle('fb-closed', this.isDouble && (l == null || r == null));
    // Draw the neighbours ahead of time.
    for (const i of this.nearby()) this.pageEl(i);
    this.o.onChange?.(this.page);
  }

  // --- Turning --------------------------------------------------------------------------------

  canGo(d) { const s = this.spread + d; return s >= 0 && s <= this.lastSpread; }
  next() { return this.go(this.pageOfSpread(this.spread + 1)); }
  prev() { return this.go(this.pageOfSpread(this.spread - 1)); }
  pageOfSpread(s) { const [l, r] = this.pagesAt(clamp(s, 0, this.lastSpread)); return l ?? r ?? 0; }

  // Turn to the spread with page i (one turn, however far).
  go(i, { animate = true } = {}) {
    if (this.anim) this.finishNow();
    const to = this.spreadOf(i);
    const from = this.spread;
    if (to === from) { this.page = this.pageOfSpread(to); this.o.onChange?.(this.page); return Promise.resolve(); }
    if (!animate || this.zoom > 1 || matchMedia('(prefers-reduced-motion: reduce)').matches) { this.page = this.pageOfSpread(to); this.draw(); return Promise.resolve(); }
    const f = this.startFlip(from, to, 'bottom');
    return this.run(f, true, { arc: true });
  }

  // Set up a turn from one spread to another: which pages lie where, and how it turns.
  startFlip(from, to, corner) {
    const dir = to > from ? 1 : -1;
    const W = this.W;
    const single = !this.isDouble;
    const [fl, fr] = this.pagesAt(from);
    const [tl, tr] = this.pagesAt(to);
    let front, back, under, still;
    if (single) {
      // One page at a time: the page turns over the left edge, showing its plain back.
      front = dir > 0 ? fr : tr;
      under = dir > 0 ? tr : fr;
      back = null;
    } else if (dir > 0) { front = fr; back = tl; under = tr; still = fl; } else { front = fl; back = tr; under = tl; still = fr; }
    const hard = this.o.hardCovers && [front, back].some((i) => i != null && (i === 0 || (i === this.count - 1 && this.count > 2)));
    this.book.replaceChildren();
    const spineX = single ? 0 : W;
    const f = { from, to, dir: single ? 1 : dir, back: single && dir < 0, corner, hard, spineX, single,
      shiftFrom: this.shiftFor(from), shiftTo: this.shiftFor(to), done: false };
    // What stays put, and what the turning page uncovers.
    if (!single) {
      if (dir > 0) { this.place(this.pageEl(still), 0, 'left'); this.place(this.pageEl(under), W, 'right'); } else { this.place(this.pageEl(under), 0, 'left'); this.place(this.pageEl(still), W, 'right'); }
    } else this.place(this.pageEl(under), 0, 'right');
    const frontEl = this.pageEl(front) || this.blank.cloneNode();
    const backEl = single ? h('div', { class: 'fb-page fb-blank' }) : this.pageEl(back) || h('div', { class: 'fb-page fb-blank' });
    f.frontEl = frontEl;
    f.backEl = backEl;
    if (hard) {
      // A stiff page: both sides on one leaf that swings on the spine.
      const leftSlot = f.dir < 0;
      f.leaf = h('div', { class: `fb-leaf ${leftSlot ? 'fb-leaf-l' : ''}`, style: { left: `${leftSlot ? 0 : spineX}px`, width: `${W}px`, height: `${this.H}px` } },
        h('div', { class: 'fb-face fb-face-front' }, frontEl, h('div', { class: 'fb-face-shade' })),
        h('div', { class: 'fb-face fb-face-back' }, backEl, h('div', { class: 'fb-face-shade' })));
      Object.assign(frontEl.style, { left: '0px', top: '0px', width: `${W}px`, height: `${this.H}px`, clipPath: '', transform: '', zIndex: '' });
      Object.assign(backEl.style, { left: '0px', top: '0px', width: `${W}px`, height: `${this.H}px`, clipPath: '', transform: '', zIndex: '' });
      frontEl.classList.toggle('fb-left', leftSlot); frontEl.classList.toggle('fb-right', !leftSlot);
      backEl.classList.toggle('fb-left', !leftSlot); backEl.classList.toggle('fb-right', leftSlot);
      this.book.append(f.leaf);
    } else {
      // A soft page: the part still flat, the curled-over back, and the shadows between.
      this.place(frontEl, f.dir > 0 ? spineX : spineX - W, f.dir > 0 ? 'right' : 'left', 3);
      f.underShade = h('div', { class: 'fb-clip', style: { zIndex: 2 } }, f.underBand = h('div', { class: 'fb-band fb-band-under' }));
      f.frontShade = h('div', { class: 'fb-clip', style: { zIndex: 4 } }, f.frontBand = h('div', { class: 'fb-band fb-band-front' }));
      f.backClip = h('div', { class: 'fb-clip', style: { zIndex: 5 } }, backEl, f.backBand = h('div', { class: 'fb-band fb-band-back' }));
      f.backWrap = h('div', { class: 'fb-backwrap', style: { zIndex: 5 } }, f.backClip);
      Object.assign(backEl.style, { left: '0px', top: '0px', width: `${W}px`, height: `${this.H}px`, clipPath: '', zIndex: '' });
      backEl.classList.toggle('fb-left', f.dir > 0 && !single);
      backEl.classList.toggle('fb-right', f.dir < 0);
      this.book.append(f.underShade, f.frontShade, f.backWrap);
      // A soft page's under-side is drawn from the start of the clip.
      backEl.style.transformOrigin = '0 0';
    }
    this.flip = f;
    return f;
  }

  // The local corner a soft page is lifted from, and where it ends up.
  cornerStart(f) { return { x: this.W, y: f.corner === 'top' ? 0 : this.H }; }
  cornerEnd(f) { return { x: -this.W, y: f.corner === 'top' ? 0 : this.H }; }

  // Lay the turning page out for a point: for a soft page the dragged corner, for a stiff one how
  // far over it is (0 … 1).
  layout(f, P) {
    const W = this.W;
    const H = this.H;
    if (f.hard) {
      const p = clamp(P, 0, 1);
      f.progress = p;
      const angle = (f.dir > 0 ? -180 : 180) * p;
      f.leaf.style.transform = `rotateY(${angle}deg)`;
      for (const s of f.leaf.querySelectorAll('.fb-face-shade')) s.style.opacity = String(Math.sin(p * Math.PI) * 0.35);
      this.book.style.setProperty('--shift', `${f.shiftFrom + (f.shiftTo - f.shiftFrom) * p}px`);
      return;
    }
    const C0 = this.cornerStart(f);
    // The page stays fixed at the spine: the corner can't be pulled further than the page allows.
    const A1 = { x: 0, y: C0.y };
    const A2 = { x: 0, y: H - C0.y };
    let p = { ...P };
    let d = dist(p, A1);
    if (d > W) p = { x: A1.x + (p.x - A1.x) * W / d, y: A1.y + (p.y - A1.y) * W / d };
    const diag = Math.hypot(W, H);
    d = dist(p, A2);
    if (d > diag) p = { x: A2.x + (p.x - A2.x) * diag / d, y: A2.y + (p.y - A2.y) * diag / d };
    if (dist(p, C0) < 0.5) p = { x: C0.x - 0.5, y: C0.y + (C0.y ? -0.5 : 0.5) };
    f.P = p;
    f.progress = clamp((W - p.x) / (2 * W), 0, 1);
    const m = { x: (C0.x + p.x) / 2, y: (C0.y + p.y) / 2 };
    const len = dist(C0, p);
    const n = { x: (C0.x - p.x) / len, y: (C0.y - p.y) / len };
    const side = (X) => (X.x - m.x) * n.x + (X.y - m.y) * n.y;
    const reflect = (X) => { const s = side(X); return { x: X.x - 2 * s * n.x, y: X.y - 2 * s * n.y }; };
    // Local (spine at 0, turning towards −x) → book coordinates.
    const toBook = (X) => ({ x: f.spineX + f.dir * X.x, y: X.y });
    // The part of the page still lying flat.
    const flat = clipRect(W, H, m, n, false);
    const frontLocal = (X) => (f.dir > 0 ? X : { x: W - X.x, y: X.y }); // flat part, in the page's own coordinates
    f.frontEl.style.clipPath = poly(flat.map(frontLocal));
    // The curled-over part: the cut-off corner, folded over the line.
    const flap = clipRect(W, H, m, n, true).map((X) => toBook(reflect(X)));
    f.backClip.style.clipPath = poly(flap);
    // The back page, drawn where the fold puts it: a page point (u, v) lies, once turned, at
    // local (u − W, v) [(−u, v) turning back]; on the leaf that's its mirror across the spine.
    const map = (u, v) => {
      const b = f.dir > 0 ? { x: u - W, y: v } : { x: -u, y: v };
      return toBook(reflect({ x: -b.x, y: b.y }));
    };
    const o = map(0, 0);
    const ux = map(1, 0);
    const vy = map(0, 1);
    f.backEl.style.transform = `matrix(${ux.x - o.x},${ux.y - o.y},${vy.x - o.x},${vy.y - o.y},${o.x},${o.y})`;
    // Shadows: on the back near the fold, cast on the page beneath, and a crease on the front.
    const foldPt = toBook(m);
    const into = { x: f.dir * n.x, y: n.y }; // towards the uncovered page
    const band = (el, dirv, width) => {
      const ang = Math.atan2(dirv.y, dirv.x) * 180 / Math.PI;
      Object.assign(el.style, { left: `${foldPt.x}px`, top: `${foldPt.y}px`, width: `${Math.max(1, width)}px`, height: `${diag * 2.2}px`, transform: `rotate(${ang}deg) translateY(-50%)` });
    };
    const lift = Math.min(len, W);
    band(f.backBand, { x: -into.x, y: -into.y }, lift * 0.55);
    band(f.underBand, into, Math.max(18, lift * 0.35));
    band(f.frontBand, { x: -into.x, y: -into.y }, Math.max(10, Math.min(46, lift * 0.25)));
    const under = f.dir > 0 ? [{ x: f.spineX, y: 0 }, { x: f.spineX + W, y: 0 }, { x: f.spineX + W, y: H }, { x: f.spineX, y: H }] : [{ x: f.spineX - W, y: 0 }, { x: f.spineX, y: 0 }, { x: f.spineX, y: H }, { x: f.spineX - W, y: H }];
    f.underShade.style.clipPath = poly(under);
    f.frontShade.style.clipPath = poly(flat.map(toBook));
    const strength = Math.sin(clamp(f.progress, 0, 1) * Math.PI);
    f.underBand.style.opacity = String(0.25 + strength * 0.75);
    f.backWrap.style.setProperty('--fb-shadow', `${(4 + strength * 14).toFixed(1)}px`);
    this.book.style.setProperty('--shift', `${f.shiftFrom + (f.shiftTo - f.shiftFrom) * clamp(f.progress * 1.15, 0, 1)}px`);
  }

  // Animate the turning page to the end (complete) or back to the start (cancel).
  run(f, complete, { arc = false, from = null } = {}) {
    return new Promise((resolve) => {
      const W = this.W;
      const H = this.H;
      const top = f.corner === 'top';
      let a, b;
      if (f.hard) {
        a = from ?? f.progress ?? (f.back ? 1 : 0);
        b = complete !== f.back ? 1 : 0;
      } else {
        const start = f.back ? this.cornerEnd(f) : this.cornerStart(f);
        const end = f.back ? this.cornerStart(f) : this.cornerEnd(f);
        a = from ?? f.P ?? (arc ? { x: start.x - (f.back ? -2 : 2), y: start.y + (top ? 2 : -2) } : start);
        b = complete ? end : start;
      }
      const span = f.hard ? Math.abs(b - a) : dist(a, b) / (2 * W);
      const dur = clamp(260 + span * 640, 200, 900);
      if (complete && this.o.sound) flipSound();
      const t0 = performance.now();
      const step = (now) => {
        const t = clamp((now - t0) / dur, 0, 1);
        const e = ease(t);
        if (f.hard) this.layout(f, a + (b - a) * e);
        else {
          // Lift the corner a little on the way over, like a real page.
          const liftAmt = (arc || complete) ? Math.sin(Math.PI * e) * H * (complete ? 0.12 : 0.04) : 0;
          this.layout(f, { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e + (top ? liftAmt : -liftAmt) });
        }
        if (t < 1) this.anim = requestAnimationFrame(step);
        else {
          this.anim = null;
          if (complete) this.page = this.pageOfSpread(f.to);
          this.flip = null;
          this.draw();
          resolve(complete);
        }
      };
      this.anim = requestAnimationFrame(step);
    });
  }

  finishNow() {
    if (this.anim) cancelAnimationFrame(this.anim);
    this.anim = null;
    if (this.flip && this.flip.complete !== false) { /* leave where it was */ }
    this.flip = null;
    this.draw();
  }
  stopFlip() {
    if (this.anim) cancelAnimationFrame(this.anim);
    this.anim = null;
    this.flip = null;
    this.peek = null;
  }

  // --- Pointer: corners, drags, clicks, swipes, zoom --------------------------------------------

  bind() {
    const book = this.book;
    let drag = null;
    const local = (e) => {
      const r = book.getBoundingClientRect();
      const sx = r.width / book.offsetWidth || 1;
      return { x: (e.clientX - r.left) / sx, y: (e.clientY - r.top) / sx };
    };
    // Where on the book: which side, and near which corner.
    const zoneAt = (pt) => {
      const W = this.W;
      const H = this.H;
      if (pt.y < 0 || pt.y > H) return null;
      const x0 = this.isDouble ? W : 0;
      const right = pt.x >= x0;
      if (!this.isDouble && pt.x < 0) return null;
      const edge = right ? (this.isDouble ? 2 * W : W) - pt.x : pt.x;
      const corner = pt.y > H / 2 ? 'bottom' : 'top';
      const nearCorner = edge < Math.min(90, W * 0.22) && (corner === 'bottom' ? H - pt.y : pt.y) < Math.min(110, H * 0.2);
      return { dir: this.isDouble ? (right ? 1 : -1) : (pt.x > W / 2 ? 1 : -1), corner, nearCorner, edge };
    };
    // The local point (spine at 0, page turning towards −x) for a book point.
    const toLocal = (f, pt) => ({ x: f.dir * (pt.x - f.spineX), y: pt.y });

    const startDrag = (e, zone) => {
      const to = this.spread + zone.dir;
      if (to < 0 || to > this.lastSpread) return false;
      this.clearPeek();
      const f = this.startFlip(this.spread, to, zone.corner);
      drag = { f, id: e.pointerId, start: local(e), t0: performance.now(), moved: false };
      if (f.hard) this.layout(f, f.back ? 1 : 0);
      else this.layout(f, f.back ? this.cornerEnd(f) : { x: this.W - 1, y: zone.corner === 'top' ? 1 : this.H - 1 });
      return true;
    };

    book.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (this.zoom > 1) { this.panStart(e); return; }
      if (this.anim) return;
      const pt = local(e);
      const zone = zoneAt(pt);
      if (!zone) return;
      // A link or button under the pointer (pointer capture hides it from the release).
      const target = e.target.closest?.('a, button, [data-tap]');
      drag = { pending: true, zone, id: e.pointerId, start: pt, t0: performance.now(), e, target };
      book.setPointerCapture(e.pointerId);
    });
    book.addEventListener('pointermove', (e) => {
      if (this.zoom > 1) { this.panMove(e); return; }
      const pt = local(e);
      if (drag && drag.id === e.pointerId) {
        if (drag.pending) {
          // Start turning once the pointer has moved (a drag from anywhere on the page, or a corner).
          if (Math.hypot(pt.x - drag.start.x, pt.y - drag.start.y) < 6) return;
          const dirFromMove = pt.x < drag.start.x ? 1 : -1;
          const zone = drag.zone.nearCorner ? drag.zone : { ...drag.zone, dir: this.isDouble ? drag.zone.dir : dirFromMove };
          if (!this.isDouble || zone.nearCorner || (zone.dir === dirFromMove)) {
            const t = { ...drag };
            if (!startDrag(t.e, zone)) { drag = null; return; }
            drag.moved = true;
          } else return;
        }
        const f = drag.f;
        if (!f) return;
        if (f.hard) {
          const lx = toLocal(f, pt).x;
          this.layout(f, clamp((this.W - lx) / (2 * this.W), 0, 1));
        } else this.layout(f, toLocal(f, pt));
        return;
      }
      if (this.anim || (this.flip && !this.peek) || e.pointerType === 'touch') return;
      const zone = zoneAt(pt);
      if (zone?.nearCorner && this.canGo(zone.dir)) this.showPeek(zone, pt, toLocal);
      else this.clearPeek();
    });
    const end = (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      const d = drag;
      drag = null;
      if (d.pending) {
        // A click: turn the page that was clicked (outer half), or pass it on.
        const zone = d.zone;
        if (d.target) { this.o.onTap?.(this.page, { target: d.target, preventDefault: () => {} }); return; }
        if (zone.dir > 0 ? this.canGo(1) : this.canGo(-1)) {
          const f = this.startFlip(this.spread, this.spread + zone.dir, zone.corner);
          this.run(f, true, { arc: true });
        }
        return;
      }
      const f = d.f;
      if (!f) return;
      const fast = performance.now() - d.t0 < 280;
      const done = f.back ? f.progress < (fast ? 0.9 : 0.5) : f.progress > (fast ? 0.1 : 0.5);
      this.run(f, done);
    };
    book.addEventListener('pointerup', (e) => { if (this.zoom > 1) { this.panEnd(e); return; } end(e); });
    book.addEventListener('pointercancel', (e) => { if (drag?.f) { const f = drag.f; drag = null; this.run(f, false); } else drag = null; });
    book.addEventListener('pointerleave', () => { if (!drag) this.clearPeek(); });
    // Double-click (or double-tap) zooms in at that point, and out again.
    book.addEventListener('dblclick', (e) => { e.preventDefault(); if (this.zoom > 1) this.setZoom(1); else this.setZoom(2, e.clientX, e.clientY); });
    // Ctrl + wheel (and pinch on a trackpad) zooms.
    this.root.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      this.setZoom(clamp(this.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 1, 4), e.clientX, e.clientY);
    }, { passive: false });
  }

  // Hovering near a corner lifts it a little.
  showPeek(zone, pt, toLocal) {
    if (!this.peek || this.peek.dir !== zone.dir || this.peek.corner !== zone.corner) {
      this.clearPeek();
      const f = this.startFlip(this.spread, this.spread + zone.dir, zone.corner);
      if (f.hard) { this.flip = null; this.draw(); return; }
      this.peek = { dir: zone.dir, corner: zone.corner, f };
    }
    const f = this.peek.f;
    if (f.back) { this.clearPeek(); return; }
    const lp = toLocal(f, pt);
    const C0 = this.cornerStart(f);
    // Follow the pointer, but only as far as a small curl.
    const max = Math.min(110, this.W * 0.24);
    const base = Math.min(46, this.W * 0.1);
    const dx = clamp(C0.x - lp.x + base, base, max);
    const dy = clamp(Math.abs(C0.y - lp.y) + base * 0.7, base * 0.7, max);
    this.layout(f, { x: C0.x - dx, y: C0.y + (zone.corner === 'top' ? dy : -dy) });
  }
  clearPeek() {
    if (!this.peek) return;
    this.peek = null;
    this.flip = null;
    this.draw();
  }

  // --- Zoom -----------------------------------------------------------------------------------

  setZoom(z, cx, cy) {
    const old = this.zoom;
    this.zoom = clamp(z, 1, 4);
    if (this.zoom === 1) this.pan = { x: 0, y: 0 };
    else if (cx != null) {
      // Keep the point under the pointer where it is.
      const r = this.root.getBoundingClientRect();
      const px = cx - r.left - r.width / 2 - this.pan.x;
      const py = cy - r.top - r.height / 2 - this.pan.y;
      this.pan.x -= px * (this.zoom / old - 1);
      this.pan.y -= py * (this.zoom / old - 1);
    }
    this.applyZoom();
    this.root.classList.toggle('fb-zoomed', this.zoom > 1);
    this.o.onZoom?.(this.zoom);
  }
  applyZoom() {
    const r = this.root.getBoundingClientRect();
    const bw = this.book.offsetWidth * this.zoom;
    const bh = this.book.offsetHeight * this.zoom;
    const mx = Math.max(0, (bw - r.width) / 2 + 40);
    const my = Math.max(0, (bh - r.height) / 2 + 40);
    this.pan.x = clamp(this.pan.x, -mx, mx);
    this.pan.y = clamp(this.pan.y, -my, my);
    this.zoomer.style.transform = this.zoom > 1 ? `translate(${this.pan.x}px, ${this.pan.y}px) scale(${this.zoom})` : '';
  }
  panStart(e) { this.panning = { id: e.pointerId, x: e.clientX, y: e.clientY, px: this.pan.x, py: this.pan.y }; this.book.setPointerCapture(e.pointerId); }
  panMove(e) {
    const p = this.panning;
    if (!p || p.id !== e.pointerId) return;
    this.pan.x = p.px + (e.clientX - p.x);
    this.pan.y = p.py + (e.clientY - p.y);
    this.applyZoom();
  }
  panEnd() { this.panning = null; }

  destroy() {
    this.stopFlip();
    this.ro.disconnect();
    this.root.remove();
  }
}
