// The Game Console's on-screen controller (replaces EmulatorJS's own): every console gets a pad
// laid out like its real controller, and each control can be moved, resized, relabelled,
// recoloured and remapped in the editor. Every finger is tracked on its own, so B can be held
// while A is tapped, and a thumb resting between two buttons presses both (as on a real pad).
// A finger that slides onto another button presses that one too.
//
// Layouts are kept in this browser (a phone and a tablet want different ones), per console.

import { SYSTEMS, buttonsFor } from './systems.js';

const STORE = 'mediadesk.console.touch';
const VERSION = 1;
const AXES = new Set([16, 17, 18, 19, 20, 21, 22, 23]);   // analogue: pressed means 0x7fff
const STICK_IDS = { left: [16, 17, 18, 19], right: [20, 21, 22, 23], dpad: [7, 6, 5, 4] }; // +x, -x, +y(down), -y(up)

const readAll = () => { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; } };
const writeAll = (v) => { try { localStorage.setItem(STORE, JSON.stringify(v)); } catch { /* storage blocked */ } };

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') for (const [p, x] of Object.entries(v)) el.style.setProperty(p, x);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
};

// replaceChildren, skipping empty entries (it would print "null").
const fill = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));

// ---- Colours ----

const clampByte = (n) => Math.max(0, Math.min(255, Math.round(n)));
function mix(hex, other, t) {
  const p = (x) => [1, 3, 5].map((i) => parseInt(x.slice(i, i + 2), 16));
  const [a, b] = [p(hex), p(other)];
  return `#${a.map((v, i) => clampByte(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}
const lighten = (hex, t = 0.45) => mix(hex, '#ffffff', t);
const isHex = (s) => /^#[0-9a-f]{6}$/i.test(s || '');

// ---- Default layouts ----
//
// Positions are in "units" (about a fingertip, see unitFor) from an edge:
// h is l / r / c (left edge, right edge, centre) and v is t / b (top or bottom edge), and x / y
// say how far the control's centre is from them. That keeps controls under the thumbs when the
// screen turns or the window changes size.

const GREY = '#3a3d45', DARK = '#202226', TEXT = '#ffffff';
let seq = 0;
const nid = () => `c${Date.now().toString(36)}${(seq++).toString(36)}`;
const btn = (label, inputs, h, x, v, y, o = {}) => ({ id: nid(), type: 'button', label, inputs: [].concat(inputs), h, x, v, y, size: 1.15, shape: 'circle', color: GREY, text: TEXT, ...o });
const pill = (label, inputs, h, x, v, y, o = {}) => btn(label, inputs, h, x, v, y, { size: 0.8, shape: 'pill', color: DARK, ...o });
const dpad = (h = 'l', x = 2.05, v = 'b', y = 2.05, o = {}) => ({ id: nid(), type: 'dpad', label: '', dirs: [4, 5, 6, 7], diagonals: true, h, x, v, y, size: 2.9, color: GREY, text: TEXT, ...o });
const stick = (target, h = 'l', x = 2.05, v = 'b', y = 2.05, o = {}) => ({ id: nid(), type: 'stick', label: '', target, h, x, v, y, size: 2.9, color: GREY, text: TEXT, ...o });
const startSelect = (sel = [2, 'Select'], st = [3, 'Start']) => [
  sel ? pill(sel[1], sel[0], 'c', -0.8, 'b', 0.45) : null,
  st ? pill(st[1], st[0], 'c', sel ? 0.8 : 0, 'b', 0.45) : null,
].filter(Boolean);
const shoulders = (l = [10, 'L'], r = [11, 'R'], y = 0.7) => [pill(l[1], l[0], 'l', 1.3, 't', y, { size: 1 }), pill(r[1], r[0], 'r', 1.3, 't', y, { size: 1 })];
// Four buttons in a diamond around (x, y): top, right, bottom, left.
const diamond = (cx, cy, d, [top, right, bottom, left], o = {}) => [
  btn(top[1], top[0], 'r', cx, 'b', cy + d, { ...o, ...top[2] }),
  btn(right[1], right[0], 'r', cx - d, 'b', cy, { ...o, ...right[2] }),
  btn(bottom[1], bottom[0], 'r', cx, 'b', cy - d, { ...o, ...bottom[2] }),
  btn(left[1], left[0], 'r', cx + d, 'b', cy, { ...o, ...left[2] }),
];
const col = (color) => ({ color });

// N64 C buttons: four yellow buttons, or a stick that moves the right analogue stick (which is
// what the N64 emulator reads them as).
function cControls(mode) {
  const c = { color: '#e6b800', text: '#1a1a1a', size: 0.72, group: 'c' };
  if (mode === 'stick') return [stick('right', 'r', 1.25, 'b', 2.5, { size: 1.9, color: '#e6b800', text: '#1a1a1a', label: 'C', group: 'c' })];
  return [
    btn('C▲', 23, 'r', 1.2, 'b', 3.12, c), btn('C▶', 20, 'r', 0.55, 'b', 2.47, c),
    btn('C▼', 22, 'r', 1.2, 'b', 1.82, c), btn('C◀', 21, 'r', 1.85, 'b', 2.47, c),
  ];
}

const GENESIS = (sys) => {
  const black = { color: '#1c1c1e', size: 1.05 };
  const out = [dpad(),
    btn('A', 1, 'r', 3.1, 'b', 1.0, black), btn('B', 0, 'r', 1.95, 'b', 1.15, black), btn('C', 8, 'r', 0.8, 'b', 1.3, black),
    btn('X', sys === 'segaSaturn' ? 9 : 10, 'r', 3.25, 'b', 2.2, { ...black, size: 0.85 }), btn('Y', sys === 'segaSaturn' ? 10 : 9, 'r', 2.1, 'b', 2.35, { ...black, size: 0.85 }),
    btn('Z', 11, 'r', 0.95, 'b', 2.5, { ...black, size: 0.85 })];
  if (sys === 'segaSaturn') out.push(...shoulders([12, 'L'], [13, 'R']), ...startSelect(null));
  else out.push(...startSelect([2, 'Mode']));
  return out;
};

export function defaultLayout(system, { cMode = 'buttons' } = {}) {
  const sys = SYSTEMS[system] || { buttons: [] };
  let controls;
  switch (system) {
    case 'nes': case 'gb':
      controls = [dpad(), btn('B', 0, 'r', 2.5, 'b', 1.2, col('#b02a2a')), btn('A', 8, 'r', 1.15, 'b', 1.65, col('#b02a2a')), ...startSelect()];
      break;
    case 'gba':
      controls = [dpad(), btn('B', 0, 'r', 2.5, 'b', 1.2), btn('A', 8, 'r', 1.15, 'b', 1.65), ...shoulders(), ...startSelect()];
      break;
    case 'snes': case 'nds':
      controls = [dpad(), ...diamond(1.95, 1.95, 0.95, [[9, 'X', col('#3b5bdb')], [8, 'A', col('#c92a2a')], [0, 'B', col('#d4a106')], [1, 'Y', col('#2b8a3e')]]), ...shoulders(), ...startSelect()];
      break;
    case 'n64':
      controls = [stick('left'),
        btn('A', 0, 'r', 2.45, 'b', 0.95, { color: '#2f5fd0', size: 1.25 }), btn('B', 1, 'r', 3.55, 'b', 1.6, { color: '#2b8a3e', size: 1.05 }),
        ...cControls(cMode),
        pill('L', 10, 'l', 1.3, 't', 0.7, { size: 1 }), pill('R', 11, 'r', 1.3, 't', 0.7, { size: 1 }), pill('Z', 12, 'l', 1.3, 't', 1.65, { size: 1 }),
        pill('Start', 3, 'c', 0, 'b', 0.45, { color: '#b02a2a' })];
      break;
    case 'segaMD': case 'segaCD': case 'sega32x': case 'segaSaturn':
      controls = GENESIS(system);
      break;
    case 'segaMS':
      controls = [dpad(), btn('1', 0, 'r', 2.4, 'b', 1.3), btn('2', 8, 'r', 1.1, 'b', 1.3)];
      break;
    case 'segaGG':
      controls = [dpad(), btn('1', 0, 'r', 2.4, 'b', 1.3, col('#1f4fa0')), btn('2', 8, 'r', 1.1, 'b', 1.3, col('#1f4fa0')), ...startSelect(null)];
      break;
    case 'psx': case 'psp': {
      const ps = { color: '#26282e' };
      controls = [dpad(), ...diamond(1.95, 1.95, 0.95, [[9, '△', { text: '#40c0a0' }], [8, '○', { text: '#ff6b6b' }], [0, '✕', { text: '#7aa2ff' }], [1, '□', { text: '#f08cc8' }]], ps)];
      if (system === 'psx') controls.push(...shoulders([10, 'L1'], [11, 'R1']), pill('L2', 12, 'l', 3.6, 't', 0.7, { size: 1 }), pill('R2', 13, 'r', 3.6, 't', 0.7, { size: 1 }));
      else controls.push(...shoulders(), stick('left', 'l', 4.3, 'b', 3.4, { size: 1.8 }));
      controls.push(...startSelect());
      break;
    }
    case 'pce':
      controls = [dpad(), btn('II', 0, 'r', 2.5, 'b', 1.3), btn('I', 8, 'r', 1.15, 'b', 1.3), ...startSelect([2, 'Select'], [3, 'Run'])];
      break;
    case 'atari2600':
      controls = [dpad(), btn('Fire', 0, 'r', 1.6, 'b', 1.5, { color: '#b02a2a', size: 1.5 }), ...startSelect([2, 'Select'], [3, 'Reset'])];
      break;
    default:
      controls = genericLayout(sys);
  }
  return { version: VERSION, system, controls, scale: 1, opacity: 0.75, haptics: true, hideWithPad: true, cMode: system === 'n64' ? cMode : undefined };
}

// Any other console: D-pad (or stick) on the left, its buttons in rows on the right, Start and
// Select in the middle, shoulder buttons in the top corners.
function genericLayout(sys) {
  const ids = new Map(sys.buttons);
  const out = [];
  if ([4, 5, 6, 7].every((i) => ids.has(i))) out.push(dpad());
  else if (ids.has(16)) out.push(stick('left'));
  const short = (s) => s.replace(/^Button /, '').replace(/\s*\(.*\)$/, '');
  const faces = sys.buttons.filter(([id]) => ![2, 3, 4, 5, 6, 7, 10, 11, 12, 13].includes(id) && !(id >= 16 && id <= 23) && id < 24);
  faces.forEach(([id, label], i) => {
    const row = Math.floor(i / 3), c = i % 3;
    out.push(btn(short(label), id, 'r', 1.0 + (2 - c) * 1.25, 'b', 1.15 + row * 1.25, { size: faces.length > 6 ? 0.95 : 1.1 }));
  });
  const top = sys.buttons.filter(([id]) => [10, 11, 12, 13].includes(id));
  top.forEach(([id, label], i) => out.push(pill(short(label), id, i % 2 ? 'r' : 'l', 1.3 + Math.floor(i / 2) * 2.3, 't', 0.7, { size: 1 })));
  const sel = sys.buttons.find(([id]) => id === 2), st = sys.buttons.find(([id]) => id === 3);
  out.push(...startSelect(sel ? [2, short(sel[1])] : null, st ? [3, short(st[1])] : null));
  return out;
}

// Portrait screens have room above the controls but not beside them: Start / Select go above
// the D-pad and buttons, and the shoulder buttons (normally in the top corners, which are the
// game picture in portrait) go above those.
export function portraitOf(controls) {
  return controls.map((c) => {
    const o = { ...c, id: c.id };
    if (c.v === 't') { o.v = 'b'; o.y = 4.9 + (c.y - 0.7) + (c.x > 2 ? 0.95 : 0); o.x = c.x > 2 ? 1.3 : c.x; }
    else if (c.h === 'c' && c.y < 1.5) o.y = c.y + 3.55;
    // A second stick beside the D-pad (PSP) goes above the shoulder buttons.
    else if (c.type === 'stick' && c.h !== 'c' && c.x > 3) { o.x = 2.05; o.y = 6.5; }
    return o;
  });
}
export const isPortrait = (w = innerWidth, hgt = innerHeight) => hgt > w * 1.1;
// The controls in use for this screen shape. With `forEdit`, a portrait layout of its own is
// made first, so editing it doesn't change the landscape one.
export function controlsFor(layout, forEdit = false, w = innerWidth, hgt = innerHeight) {
  if (!isPortrait(w, hgt)) return layout.controls;
  if (!layout.portrait && forEdit) layout.portrait = structuredClone(portraitOf(layout.controls));
  return layout.portrait || portraitOf(layout.controls);
}

export function loadLayout(system) {
  const saved = readAll()[system];
  if (saved?.version === VERSION && Array.isArray(saved.controls)) return saved;
  return defaultLayout(system);
}
export function saveLayout(system, layout) {
  const all = readAll();
  all[system] = { ...layout, version: VERSION, system };
  writeAll(all);
}
export function resetLayout(system, opts) {
  const all = readAll();
  delete all[system];
  writeAll(all);
  return defaultLayout(system, opts);
}
export const isCustomLayout = (system) => Boolean(readAll()[system]);

// N64: swap the C buttons between four buttons and a stick, keeping everything else.
export function setCMode(layout, mode) {
  const swap = (list) => [...list.filter((c) => c.group !== 'c'), ...cControls(mode)];
  return { ...layout, cMode: mode, controls: swap(layout.controls), portrait: layout.portrait ? swap(layout.portrait) : undefined };
}

// What a control's mappings say, for the editor.
export function inputName(system, id) {
  const all = new Map(buttonsFor(system));
  if (all.has(id)) return all.get(id);
  return { 4: 'D-pad up', 5: 'D-pad down', 6: 'D-pad left', 7: 'D-pad right', 16: 'Left stick right', 17: 'Left stick left', 18: 'Left stick down', 19: 'Left stick up', 20: 'Right stick right', 21: 'Right stick left', 22: 'Right stick down', 23: 'Right stick up' }[id] || `Button ${id}`;
}

// ---- Drawing and input ----

// A unit is about a fingertip: the screen's height / 6.4, but narrow enough that a portrait
// phone fits the left and right clusters side by side (7.8 units across).
export const unitFor = (layout, w = innerWidth, hgt = innerHeight) => Math.max(34, Math.min(86, w / 7.8, hgt / 6.4)) * (layout.scale || 1);

// Centre of a control in px.
export function placeOf(c, u, w = innerWidth, hgt = innerHeight) {
  const x = c.h === 'l' ? c.x * u : c.h === 'r' ? w - c.x * u : w / 2 + c.x * u;
  const y = c.v === 't' ? c.y * u : hgt - c.y * u;
  return { x, y };
}
// A point relative to a control's centre, turned into the control's own (unrotated) frame.
function local(c, dx, dy) {
  const r = -((c.rot || 0) * Math.PI) / 180;
  if (!r) return { lx: dx, ly: dy };
  return { lx: dx * Math.cos(r) - dy * Math.sin(r), ly: dx * Math.sin(r) + dy * Math.cos(r) };
}

// Size of a control's face in px.
function boxOf(c, u) {
  const s = (c.size || 1) * u;
  if (c.type === 'button' && c.shape === 'pill') return { w: s * 1.9, h: s * 0.72 };
  return { w: s, h: s };
}

// Label text as big as fits: short labels large, longer ones smaller so they aren't cut off.
function fontFor(c, w, hh) {
  const base = Math.min(w, hh) * (c.shape === 'pill' ? 0.62 : 0.42);
  const chars = [...(c.label || '')].length || 1;
  const room = (c.shape === 'pill' ? w * 0.82 : w * 0.78) / (chars * 0.62);
  return Math.max(9, Math.min(base, room));
}

const DPAD_SVG = '<svg viewBox="0 0 100 100" aria-hidden="true"><path class="arm up" d="M36 4h28v32H36z"/><path class="arm down" d="M36 64h28v32H36z"/><path class="arm left" d="M4 36h32v28H4z"/><path class="arm right" d="M64 36h32v28H64z"/><path class="hub" d="M36 36h28v28H36z"/><path class="tri" d="M50 12l7 10H43zM50 88l-7-10h14zM12 50l10-7v14zM88 50l-10 7V43z"/></svg>';

export class TouchPad {
  // send(id, value): press (1, or 0x7fff for sticks) and release (0) RetroPad inputs.
  constructor({ system, layout, send, host = document.body, edit = null }) {
    this.system = system;
    this.layout = layout;
    this.send = send;
    this.edit = edit;               // editor callbacks: { onPointerDown(c, e) }
    this.host = host;
    this.root = h('div', { class: `tp ${edit ? 'tp-edit' : ''}`, 'aria-hidden': 'true' });
    this.pointers = new Map();      // pointerId -> { x, y, owner }
    this.held = new Map();          // input id -> current value sent
    this.turboOn = true;
    host.append(this.root);
    this.render();
    this.onResize = () => this.render();
    addEventListener('resize', this.onResize);
    this.root.addEventListener('pointermove', (e) => this.move(e));
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) this.root.addEventListener(t, (e) => this.up(e));
    this.onBlur = () => this.releaseAll();
    addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onBlur);
    this.turbo = setInterval(() => { this.turboOn = !this.turboOn; if (this.anyTurbo) this.compute(); }, 50);
  }

  destroy() {
    this.releaseAll();
    clearInterval(this.turbo);
    removeEventListener('resize', this.onResize);
    removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onBlur);
    this.root.remove();
  }

  setLayout(layout) { this.releaseAll(); this.layout = layout; this.render(); }
  show(on) { this.root.hidden = !on; if (!on) this.releaseAll(); }

  render() {
    const u = unitFor(this.layout);
    this.u = u;
    this.root.style.setProperty('--tp-opacity', String(this.layout.opacity ?? 0.75));
    this.els = new Map();
    this.list = controlsFor(this.layout);
    this.root.replaceChildren(...this.list.filter((c) => !c.hidden || this.edit).map((c) => {
      const { x, y } = placeOf(c, u);
      const { w, h: hh } = boxOf(c, u);
      // The touch area is a little bigger than the button, so gaps between buttons still count.
      const pad = c.type === 'button' ? Math.min(w, hh) * 0.18 : 0;
      const color = isHex(c.color) ? c.color : GREY;
      const el = h('div', {
        class: `tp-c tp-${c.type} ${c.type === 'button' ? `tp-${c.shape || 'circle'}` : ''} ${c.hidden ? 'tp-hidden' : ''} ${this.edit?.selected?.has?.(c.id) ? 'tp-sel' : ''}`,
        'data-id': c.id,
        style: {
          left: `${x - w / 2 - pad}px`, top: `${y - hh / 2 - pad}px`, width: `${w + pad * 2}px`, height: `${hh + pad * 2}px`, padding: `${pad}px`,
          '--c': color, '--p': isHex(c.pressed) ? c.pressed : lighten(color), '--t': isHex(c.text) ? c.text : TEXT, '--fs': `${fontFor(c, w, hh)}px`, '--rot': `${c.rot || 0}deg`,
        },
        onpointerdown: (e) => this.down(e, c),
      },
      c.type === 'button' ? h('div', { class: 'tp-face' }, h('span', {}, c.label || '')) : null,
      c.type === 'dpad' ? h('div', { class: 'tp-face', html: DPAD_SVG }) : null,
      c.type === 'stick' ? h('div', { class: 'tp-face' }, h('div', { class: 'tp-knob' }, h('span', {}, c.label || ''))) : null);
      this.els.set(c.id, el);
      return el;
    }));
    this.paint();
  }

  // ---- Fingers ----

  down(e, c) {
    e.preventDefault();
    e.stopPropagation();
    if (this.edit) return this.edit.onPointerDown(c, e, this);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* fine */ }
    const owner = c.type === 'button' ? 'buttons' : c.id;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, owner, origin: c.type === 'stick' ? placeOf(c, this.u) : null });
    this.compute(true);
  }
  move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    p.x = e.clientX; p.y = e.clientY;
    this.compute(true);
  }
  up(e) {
    if (!this.pointers.delete(e.pointerId)) return;
    this.compute();
  }
  releaseAll() {
    this.pointers.clear();
    this.compute();
  }

  // Works out what every finger is pressing and sends only the changes.
  compute(fromTouch = false) {
    const u = this.u;
    const want = new Map();          // input id -> value
    const lit = new Map();           // control id -> state for drawing
    const press = (id, v) => { if (v > (want.get(id) || 0)) want.set(id, v); };
    const buttons = this.list.filter((c) => c.type === 'button' && !c.hidden);
    let anyTurbo = false;
    for (const p of this.pointers.values()) {
      if (p.owner === 'buttons') {
        for (const c of buttons) {
          const { x, y } = placeOf(c, u);
          const { w, h: hh } = boxOf(c, u);
          const m = Math.min(w, hh) * 0.18;
          const { lx, ly } = local(c, p.x - x, p.y - y);
          let hit;
          if (c.shape === 'circle') hit = Math.hypot(lx, ly) <= w / 2 + m;
          else hit = Math.abs(lx) <= w / 2 + m && Math.abs(ly) <= hh / 2 + m;
          if (!hit) continue;
          lit.set(c.id, true);
          if (c.turbo) { anyTurbo = true; if (!this.turboOn) continue; }
          for (const id of c.inputs || []) press(id, AXES.has(id) ? 0x7fff : 1);
        }
        continue;
      }
      const c = this.list.find((x) => x.id === p.owner);
      if (!c) continue;
      const { x, y } = placeOf(c, u);
      const r = (c.size || 1) * u / 2;
      // Directions follow the control: a D-pad turned 45° has its "up" arm where you see it.
      const { lx: dx, ly: dy } = local(c, p.x - x, p.y - y);
      if (c.type === 'dpad') {
        const dist = Math.hypot(dx, dy);
        const dirs = { up: false, down: false, left: false, right: false };
        if (dist > r * 0.18) {
          const a = Math.atan2(dy, dx) * 180 / Math.PI;       // 0 right, 90 down
          const span = c.diagonals === false ? 45 : 67.5;
          const near = (t) => Math.abs(((a - t + 540) % 360) - 180) <= span;
          dirs.right = near(0); dirs.down = near(90); dirs.left = near(180); dirs.up = near(-90);
        }
        const [iu, idn, il, ir] = c.dirs || [4, 5, 6, 7];
        if (dirs.up) press(iu, AXES.has(iu) ? 0x7fff : 1);
        if (dirs.down) press(idn, AXES.has(idn) ? 0x7fff : 1);
        if (dirs.left) press(il, AXES.has(il) ? 0x7fff : 1);
        if (dirs.right) press(ir, AXES.has(ir) ? 0x7fff : 1);
        lit.set(c.id, dirs);
      } else if (c.type === 'stick') {
        // Measured from where the finger first landed, so it works without looking.
        const o = p.origin || { x, y };
        const v = local(c, p.x - o.x, p.y - o.y);
        let vx = v.lx / (r * 0.75), vy = v.ly / (r * 0.75);
        const len = Math.hypot(vx, vy);
        if (len > 1) { vx /= len; vy /= len; }
        const dead = 0.12;
        const ax = Math.abs(vx) < dead ? 0 : vx, ay = Math.abs(vy) < dead ? 0 : vy;
        const [px, nx, py, ny] = STICK_IDS[c.target] || STICK_IDS.left;
        if (c.target === 'dpad') {
          if (ax > 0.45) press(px, 1); if (ax < -0.45) press(nx, 1);
          if (ay > 0.45) press(py, 1); if (ay < -0.45) press(ny, 1);
        } else {
          if (ax > 0) press(px, Math.round(ax * 0x7fff)); if (ax < 0) press(nx, Math.round(-ax * 0x7fff));
          if (ay > 0) press(py, Math.round(ay * 0x7fff)); if (ay < 0) press(ny, Math.round(-ay * 0x7fff));
        }
        lit.set(c.id, { vx, vy });
      }
    }
    this.anyTurbo = anyTurbo;
    // Send releases first, then presses.
    for (const [id, v] of this.held) if (!want.has(id)) { this.send(id, 0); this.held.delete(id); }
    let newPress = false;
    for (const [id, v] of want) {
      if (this.held.get(id) === v) continue;
      if (!this.held.has(id)) newPress = true;
      this.send(id, v);
      this.held.set(id, v);
    }
    if (newPress && fromTouch && this.layout.haptics !== false) navigator.vibrate?.(8);
    this.lit = lit;
    this.paint();
  }

  paint() {
    const lit = this.lit || new Map();
    for (const [id, el] of this.els || []) {
      const s = lit.get(id);
      el.classList.toggle('down', Boolean(s));
      if (el.classList.contains('tp-dpad')) {
        for (const d of ['up', 'down', 'left', 'right']) el.querySelector(`.arm.${d}`)?.classList.toggle('on', Boolean(s?.[d]));
      }
      if (el.classList.contains('tp-stick')) {
        const k = el.querySelector('.tp-knob');
        const r = el.clientWidth * 0.28;
        if (k) k.style.transform = s ? `translate(${s.vx * r}px, ${s.vy * r}px)` : '';
      }
    }
  }
}

// ---- Editor ----
//
// Drag to move; tap to select and change its label, shape, size, rotation, colours and what it
// presses. Several controls can be selected (Select several, Shift/Ctrl-click, or drag a box
// around them) to move or rotate them together. `onDone(layout)` is called when it closes.

const SHAPES = [['circle', 'Round'], ['rounded', 'Rounded square'], ['pill', 'Pill']];
const ROTATE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>';
const normDeg = (d) => { let v = ((d + 180) % 360 + 360) % 360 - 180; if (Object.is(v, -0)) v = 0; return Math.round(v * 10) / 10; };

// Where a control sits from a point in px: anchored to the nearest side, so it stays under the
// same thumb on other screens.
function setPx(c, px, py, u, W = innerWidth, H = innerHeight) {
  const nx = Math.max(0, Math.min(W, px)), ny = Math.max(0, Math.min(H, py));
  c.h = nx < W * 0.36 ? 'l' : nx > W * 0.64 ? 'r' : 'c';
  c.v = ny < H * 0.5 ? 't' : 'b';
  const snap = (v) => Math.round(v * 20) / 20;
  c.x = snap(c.h === 'l' ? nx / u : c.h === 'r' ? (W - nx) / u : (nx - W / 2) / u);
  c.y = snap(c.v === 't' ? ny / u : (H - ny) / u);
}

export function openEditor({ system, host = document.body, accent = '#e5a00d', onDone, preview = false }) {
  const sys = SYSTEMS[system];
  let layout = structuredClone(loadLayout(system));
  const selected = new Set();
  let multi = false;          // "Select several": taps add and remove
  let testing = false;
  const save = () => saveLayout(system, layout);
  // Edit this orientation's own controls (in portrait, made from the landscape ones if new).
  controlsFor(layout, true);
  const shell = h('div', { class: 'tpe', style: { '--accent': accent } });
  if (preview) shell.append(h('div', { class: 'tpe-screen' }, h('span', {}, `${sys.short} game screen`)));
  host.append(shell);

  const testLog = h('div', { class: 'tpe-test', hidden: true });
  const pad = new TouchPad({
    system, layout, host: shell,
    send: (id, v) => {
      if (!testing) return;
      const names = [...pad.held.keys()].filter((x) => x !== id || v).map((x) => inputName(system, x));
      if (v && !names.includes(inputName(system, id))) names.push(inputName(system, id));
      testLog.textContent = names.length ? `Pressing: ${names.join(' + ')}` : 'Press the controls to try them';
    },
    edit: { selected, onPointerDown: (c, e) => startDrag(c, e) },
  });
  pad.edit0 = pad.edit;

  const bar = h('div', { class: 'tpe-bar' });
  const sheet = h('div', { class: 'tpe-sheet', hidden: true });
  const handle = h('button', { class: 'tpe-rotate', type: 'button', title: 'Drag to rotate', 'aria-label': 'Rotate', html: ROTATE_SVG, hidden: true });
  const marquee = h('div', { class: 'tpe-marquee', hidden: true });
  shell.append(marquee, handle, bar, sheet, testLog);
  const tbtn = (label, onclick, cls = '', attrs = {}) => h('button', { class: `tpe-btn ${cls}`, type: 'button', onclick, ...attrs }, label);
  const list = () => controlsFor(layout, true);
  const chosen = () => list().filter((c) => selected.has(c.id));
  const add = (c) => { list().push(c); save(); select([c.id]); };
  const center = { h: 'c', x: 0, v: 'b', y: 3.2 };

  // ---- Toolbar ----
  function drawBar() {
    fill(bar,
      h('strong', { class: 'tpe-title' }, `${sys.short} on-screen controls`, h('small', {}, isPortrait() ? ' · portrait' : ' · landscape')),
      h('label', { class: 'tpe-inline' }, h('select', { 'aria-label': 'Add a control', onchange: (e) => {
        const v = e.target.value;
        e.target.value = '';
        if (v === 'button') add(btn('New', [], center.h, center.x, center.v, center.y));
        if (v === 'dpad') add(dpad('c', 0, 'b', 3.2));
        if (v === 'stick') add(stick('left', 'c', 0, 'b', 3.2));
      } }, h('option', { value: '' }, '+ Add…'), h('option', { value: 'button' }, 'Button'), h('option', { value: 'dpad' }, 'D-pad'), h('option', { value: 'stick' }, 'Analogue stick'))),
      system === 'n64' ? h('label', { class: 'tpe-inline' }, 'C buttons ', h('select', { onchange: (e) => { layout = setCMode(layout, e.target.value); save(); select([]); refresh(); } },
        h('option', { value: 'buttons', selected: layout.cMode !== 'stick' }, 'Four buttons'), h('option', { value: 'stick', selected: layout.cMode === 'stick' }, 'Analogue stick'))) : null,
      tbtn(multi ? 'Selecting several ✓' : 'Select several', () => { multi = !multi; if (!multi) select([...selected]); else drawBar(); }, multi ? 'on' : '',
        { title: 'Tap controls to add them to the selection (or drag a box around them, or Shift-click)' }),
      selected.size ? tbtn(`Edit ${selected.size > 1 ? `${selected.size} selected` : 'selected'}…`, () => { multi = false; openPanel(); }, 'primary-outline') : null,
      tbtn('Layout…', () => { select([]); showGlobal(); }),
      tbtn(testing ? 'Stop trying' : 'Try it', () => {
        testing = !testing;
        pad.edit = testing ? null : pad.edit0;
        pad.root.classList.toggle('tp-edit', !testing);
        testLog.hidden = !testing;
        testLog.textContent = 'Press the controls to try them';
        select([]);
        drawBar();
      }, testing ? 'on' : ''),
      tbtn('Done', () => close(), 'primary'));
  }

  function refresh() {
    pad.layout = layout;
    pad.render();
    placeHandle();
    drawBar();
  }

  // ---- Selection ----
  // panel: open the settings for the selection (a tap does; a drag just selects).
  function select(ids, { panel = true } = {}) {
    selected.clear();
    for (const id of ids) selected.add(id);
    pad.render();
    placeHandle();
    const cs = chosen();
    // While picking several, the toolbar stays (with "Edit N selected") and no panel opens.
    if (multi || !panel) { sheet.hidden = true; bar.hidden = false; drawBar(); return; }
    // Otherwise the toolbar steps aside while the settings are open (small screens fit one).
    bar.hidden = cs.length > 0;
    if (!cs.length) { sheet.hidden = true; return; }
    openPanel(cs);
  }
  const openPanel = (cs = chosen()) => { bar.hidden = true; if (cs.length === 1) showSheet(cs[0]); else if (cs.length) showGroup(cs); };
  const toggle = (id) => select(selected.has(id) ? [...selected].filter((x) => x !== id) : [...selected, id]);

  // Centre of the selection, and the rotate handle above it.
  function bounds(cs = chosen()) {
    const u = pad.u;
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    for (const c of cs) {
      const p = placeOf(c, u), { w, h: hh } = boxOf(c, u);
      const rad = Math.hypot(w, hh) / 2;
      const ext = (c.rot || 0) % 180 ? rad : null;
      l = Math.min(l, p.x - (ext ?? w / 2)); r = Math.max(r, p.x + (ext ?? w / 2));
      t = Math.min(t, p.y - (ext ?? hh / 2)); b = Math.max(b, p.y + (ext ?? hh / 2));
    }
    return { l, t, r, b, cx: (l + r) / 2, cy: (t + b) / 2 };
  }
  function placeHandle() {
    const cs = chosen();
    if (!cs.length || testing) { handle.hidden = true; return; }
    const bx = bounds(cs);
    const top = bx.t - 34 < 4 ? bx.b + 8 : bx.t - 34;
    handle.hidden = false;
    handle.style.left = `${bx.cx - 14}px`;
    handle.style.top = `${top}px`;
  }

  // Rotating: the handle turns the selection about its centre (each control turns too).
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    try { handle.setPointerCapture(e.pointerId); } catch { /* fine */ }
    const snap = snapshot();
    const a0 = Math.atan2(e.clientY - snap.cy, e.clientX - snap.cx);
    const mv = (ev) => {
      let deg = (Math.atan2(ev.clientY - snap.cy, ev.clientX - snap.cx) - a0) * 180 / Math.PI;
      deg = ev.shiftKey ? Math.round(deg) : Math.round(deg / 5) * 5;
      applyRotation(snap, deg, true);
    };
    const upH = () => {
      handle.removeEventListener('pointermove', mv); handle.removeEventListener('pointerup', upH); handle.removeEventListener('pointercancel', upH);
      save(); select([...selected], { panel: !sheet.hidden });
    };
    handle.addEventListener('pointermove', mv); handle.addEventListener('pointerup', upH); handle.addEventListener('pointercancel', upH);
  });

  function snapshot(cs = chosen()) {
    const u = pad.u, bx = bounds(cs);
    return { u, cx: bx.cx, cy: bx.cy, items: cs.map((c) => ({ c, ...placeOf(c, u), rot: c.rot || 0 })) };
  }
  // Turn the snapshot by `deg` about its centre; `each` turns the controls themselves too.
  function applyRotation(snap, deg, each = true) {
    const r = deg * Math.PI / 180, cos = Math.cos(r), sin = Math.sin(r);
    for (const it of snap.items) {
      if (snap.items.length > 1) {
        const dx = it.x - snap.cx, dy = it.y - snap.cy;
        setPx(it.c, snap.cx + dx * cos - dy * sin, snap.cy + dx * sin + dy * cos, snap.u);
      }
      if (each || snap.items.length === 1) it.c.rot = normDeg(it.rot + deg);
    }
    pad.render();
    placeHandle();
  }

  // Dragging a control moves it (and the rest of the selection, if it's selected);
  // a tap selects it (or adds/removes it in "Select several", or with Shift / Ctrl).
  function startDrag(shown, e) {
    const c = list().find((x) => x.id === shown.id) || shown;
    const el = e.currentTarget;
    try { el.setPointerCapture(e.pointerId); } catch { /* fine */ }
    const u = pad.u;
    const start = { x: e.clientX, y: e.clientY };
    const group = selected.has(c.id) && selected.size > 1 ? chosen() : [c];
    const from = group.map((g) => ({ g, ...placeOf(g, u) }));
    const additive = multi || e.shiftKey || e.ctrlKey || e.metaKey;
    let moved = false;
    const mv = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
      if (!moved && Math.hypot(dx, dy) < 6) return;
      moved = true;
      for (const f of from) setPx(f.g, f.x + dx, f.y + dy, u);
      for (const f of from) {
        const el2 = pad.els.get(f.g.id), p = placeOf(f.g, u);
        if (el2) { el2.style.left = `${p.x - el2.offsetWidth / 2}px`; el2.style.top = `${p.y - el2.offsetHeight / 2}px`; }
      }
      placeHandle();
    };
    const upH = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', upH); el.removeEventListener('pointercancel', upH);
      if (moved) { save(); select(group.length > 1 ? [...selected] : additive && selected.size ? [...new Set([...selected, c.id])] : [c.id], { panel: false }); }
      else if (additive) toggle(c.id);
      else select([c.id]);
    };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', upH); el.addEventListener('pointercancel', upH);
  }

  // Drag on empty space: a box that selects everything it touches.
  shell.addEventListener('pointerdown', (e) => {
    if (testing || e.target.closest('.tpe-bar, .tpe-sheet, .tpe-rotate, .tp-c')) return;
    const start = { x: e.clientX, y: e.clientY };
    const additive = multi || e.shiftKey || e.ctrlKey || e.metaKey;
    const before = additive ? [...selected] : [];
    let moved = false;
    try { shell.setPointerCapture(e.pointerId); } catch { /* fine */ }
    const rect = (ev) => ({ l: Math.min(start.x, ev.clientX), t: Math.min(start.y, ev.clientY), r: Math.max(start.x, ev.clientX), b: Math.max(start.y, ev.clientY) });
    const mv = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 6) return;
      moved = true;
      const r = rect(ev);
      Object.assign(marquee.style, { left: `${r.l}px`, top: `${r.t}px`, width: `${r.r - r.l}px`, height: `${r.b - r.t}px` });
      marquee.hidden = false;
      const inside = list().filter((c) => { const p = placeOf(c, pad.u); return p.x >= r.l && p.x <= r.r && p.y >= r.t && p.y <= r.b; }).map((c) => c.id);
      selected.clear();
      for (const id of [...before, ...inside]) selected.add(id);
      pad.render();
    };
    const upH = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      shell.removeEventListener('pointermove', mv); shell.removeEventListener('pointerup', upH); shell.removeEventListener('pointercancel', upH);
      marquee.hidden = true;
      if (moved) select([...selected], { panel: selected.size > 0 });
      else if (!additive) { select([]); bar.hidden = false; }
    };
    shell.addEventListener('pointermove', mv); shell.addEventListener('pointerup', upH); shell.addEventListener('pointercancel', upH);
  });

  // ---- Settings for one control ----
  const field = (label, control, hint) => h('label', { class: 'tpe-field' }, h('span', {}, label), control, hint ? h('small', {}, hint) : null);
  const colorIn = (value, onchange) => h('input', { type: 'color', value, oninput: (e) => onchange(e.target.value) });
  const range = (min, max, step, value, oninput) => h('input', { type: 'range', min, max, step, value, oninput: (e) => oninput(Number(e.target.value)) });
  const changed = (c) => { save(); pad.render(); placeHandle(); if (c) placeSheet(c); };
  const closeBtn = () => h('button', { type: 'button', class: 'tpe-x', 'aria-label': 'Close', onclick: () => { select([]); bar.hidden = false; } }, '×');

  function placeSheet(c) {
    const p = placeOf(c, pad.u);
    sheet.classList.toggle('top', p.y > innerHeight / 2);
    sheet.classList.toggle('left', p.x > innerWidth / 2);
  }

  // Rotation: a slider with the angle, and quick turns.
  function rotationField(get, set, label = 'Rotation') {
    const out = h('output', {}, `${get()}°`);
    const slider = range(-180, 180, 1, get(), (v) => { set(v); out.textContent = `${get()}°`; });
    const nudge = (d) => { set(normDeg(get() + d)); slider.value = String(get()); out.textContent = `${get()}°`; };
    return h('div', { class: 'tpe-field tpe-rot' }, h('span', {}, label, ' ', out),
      h('div', { class: 'tpe-rot-row' }, tbtn('⟲ 15°', () => nudge(-15)), slider, tbtn('15° ⟳', () => nudge(15)), tbtn('0°', () => { set(0); slider.value = '0'; out.textContent = '0°'; })));
  }

  function inputPicker(c) {
    const all = buttonsFor(system);
    const extra = [[16, 'Left stick right'], [17, 'Left stick left'], [18, 'Left stick down'], [19, 'Left stick up'], [20, 'Right stick right'], [21, 'Right stick left'], [22, 'Right stick down'], [23, 'Right stick up'], [4, 'D-pad up'], [5, 'D-pad down'], [6, 'D-pad left'], [7, 'D-pad right']]
      .filter(([id]) => !all.some(([x]) => x === id));
    return h('div', { class: 'tpe-chips' }, [...all, ...extra].map(([id, name]) => {
      const on = (c.inputs || []).includes(id);
      return h('button', {
        type: 'button', class: `tpe-chip ${on ? 'on' : ''}`, title: on ? 'Pressed by this button (tap to remove)' : 'Tap to add', 'data-i': String(id),
        onclick: () => { c.inputs = on ? c.inputs.filter((x) => x !== id) : [...(c.inputs || []), id]; save(); showSheet(c); },
      }, name);
    }));
  }

  function showSheet(c) {
    sheet.hidden = false;
    placeSheet(c);
    const kind = c.type === 'button' ? 'Button' : c.type === 'dpad' ? 'D-pad' : 'Stick';
    const label = h('input', { type: 'text', value: c.label || '', maxlength: '8', placeholder: c.type === 'button' ? 'Text on the button' : 'Optional', oninput: (e) => { c.label = e.target.value; changed(c); } });
    const allInputs = [...buttonsFor(system).filter(([id]) => id < 24), [16, 'Left stick right'], [17, 'Left stick left'], [18, 'Left stick down'], [19, 'Left stick up'], [4, 'D-pad up'], [5, 'D-pad down'], [6, 'D-pad left'], [7, 'D-pad right']]
      .filter(([id], i, arr) => arr.findIndex(([x]) => x === id) === i);
    const dirSel = (i, name) => field(name, h('select', { onchange: (e) => { c.dirs[i] = Number(e.target.value); changed(c); } },
      allInputs.map(([id, n]) => h('option', { value: String(id), selected: c.dirs?.[i] === id }, n))));
    fill(sheet,
      h('div', { class: 'tpe-sheet-head' }, h('strong', {}, `${kind}${c.label ? `: ${c.label}` : ''}`), closeBtn()),
      h('div', { class: 'tpe-grid' },
        field('Label', label),
        c.type === 'button' ? field('Shape', h('select', { onchange: (e) => { c.shape = e.target.value; changed(c); } }, SHAPES.map(([v, n]) => h('option', { value: v, selected: (c.shape || 'circle') === v }, n)))) : null,
        field('Size', range(0.5, c.type === 'button' ? 2.5 : 4.5, 0.05, c.size || 1, (v) => { c.size = v; changed(c); })),
        field('Colour', colorIn(isHex(c.color) ? c.color : GREY, (v) => { c.color = v; if (!c.pressedSet) c.pressed = undefined; changed(c); })),
        field('Colour when pressed', colorIn(isHex(c.pressed) ? c.pressed : lighten(isHex(c.color) ? c.color : GREY), (v) => { c.pressed = v; c.pressedSet = true; changed(c); })),
        field('Label colour', colorIn(isHex(c.text) ? c.text : TEXT, (v) => { c.text = v; changed(c); }))),
      rotationField(() => c.rot || 0, (v) => { c.rot = normDeg(v); changed(c); }),
      c.type === 'button' ? h('div', { class: 'tpe-sec' },
        h('div', { class: 'tpe-sec-title' }, 'Presses', h('small', {}, ' — pick one, or several to press them together (e.g. B + A)')),
        inputPicker(c),
        h('label', { class: 'tpe-check' }, h('input', { type: 'checkbox', checked: Boolean(c.turbo), onchange: (e) => { c.turbo = e.target.checked; save(); } }), 'Turbo (repeats while held)')) : null,
      c.type === 'dpad' ? h('div', { class: 'tpe-sec' }, h('div', { class: 'tpe-grid' }, dirSel(0, 'Up'), dirSel(1, 'Down'), dirSel(2, 'Left'), dirSel(3, 'Right')),
        h('label', { class: 'tpe-check' }, h('input', { type: 'checkbox', checked: c.diagonals !== false, onchange: (e) => { c.diagonals = e.target.checked; save(); } }), 'Diagonals (8 directions)')) : null,
      c.type === 'stick' ? h('div', { class: 'tpe-sec' }, field('Moves', h('select', { onchange: (e) => { c.target = e.target.value; changed(c); } },
        [['left', 'Left analogue stick'], ['right', system === 'n64' ? 'Right stick (C buttons)' : 'Right analogue stick'], ['dpad', 'D-pad']].map(([v, n]) => h('option', { value: v, selected: c.target === v }, n))))) : null,
      h('div', { class: 'tpe-actions' },
        tbtn('Same colours for all', () => {
          for (const o of list()) if (o !== c && o.type === c.type) { o.color = c.color; o.pressed = c.pressed; o.text = c.text; o.pressedSet = c.pressedSet; }
          save(); pad.render();
        }),
        tbtn('Duplicate', () => add({ ...structuredClone(c), id: nid(), x: c.x + 0.6, y: c.y + 0.6 })),
        tbtn(c.hidden ? 'Show' : 'Hide', () => { c.hidden = !c.hidden; save(); pad.render(); showSheet(c); }),
        tbtn('Delete', () => { const l = list(); l.splice(l.indexOf(c), 1); save(); select([]); bar.hidden = false; }, 'danger')));
  }

  // ---- Settings for several controls ----
  function showGroup(cs) {
    sheet.hidden = false;
    const bx = bounds(cs);
    sheet.classList.toggle('top', bx.cy > innerHeight / 2);
    sheet.classList.toggle('left', bx.cx > innerWidth / 2);
    // Group rotation is measured from how they were when the panel opened.
    let snap = snapshot(cs), angle = 0, each = true;
    const sizeSnap = cs.map((c) => [c, c.size || 1]);
    const first = cs[0];
    fill(sheet,
      h('div', { class: 'tpe-sheet-head' }, h('strong', {}, `${cs.length} controls selected`), closeBtn()),
      h('p', { class: 'tpe-note tpe-tight' }, 'Drag any of them to move them together, or use the ↻ handle to turn them.'),
      rotationField(() => angle, (v) => { angle = normDeg(v); applyRotation(snap, angle, each); save(); }, 'Turn the group'),
      h('label', { class: 'tpe-check' }, h('input', { type: 'checkbox', checked: true, onchange: (e) => {
        each = e.target.checked;
        applyRotation(snap, angle, each); save();
      } }), 'Turn each control with the group (so they stay at the same angle to each other)'),
      h('div', { class: 'tpe-grid' },
        field('Size (all)', range(0.5, 1.8, 0.05, 1, (v) => { for (const [c, s0] of sizeSnap) c.size = Math.round(s0 * v * 100) / 100; changed(); })),
        field('Colour (all)', colorIn(isHex(first.color) ? first.color : GREY, (v) => { for (const c of cs) { c.color = v; if (!c.pressedSet) c.pressed = undefined; } changed(); })),
        field('Colour when pressed (all)', colorIn(isHex(first.pressed) ? first.pressed : lighten(isHex(first.color) ? first.color : GREY), (v) => { for (const c of cs) { c.pressed = v; c.pressedSet = true; } changed(); })),
        field('Label colour (all)', colorIn(isHex(first.text) ? first.text : TEXT, (v) => { for (const c of cs) c.text = v; changed(); }))),
      h('div', { class: 'tpe-actions' },
        tbtn('Straighten (0°)', () => { for (const c of cs) c.rot = 0; save(); snap = snapshot(cs); angle = 0; showGroup(cs); pad.render(); placeHandle(); }),
        tbtn('Duplicate', () => {
          const copies = cs.map((c) => ({ ...structuredClone(c), id: nid(), x: c.x + 0.6, y: c.y + 0.6 }));
          list().push(...copies); save(); select(copies.map((c) => c.id));
        }),
        tbtn('Delete all', () => { const l = list(); for (const c of cs) l.splice(l.indexOf(c), 1); save(); select([]); bar.hidden = false; }, 'danger')));
  }

  // ---- Whole layout ----
  function showGlobal() {
    sheet.hidden = false;
    bar.hidden = true;
    sheet.classList.remove('top', 'left');
    const pct = (v) => `${Math.round(v * 100)}%`;
    const sizeOut = h('output', {}, pct(layout.scale || 1)), opOut = h('output', {}, pct(layout.opacity ?? 0.75));
    fill(sheet,
      h('div', { class: 'tpe-sheet-head' }, h('strong', {}, 'Whole layout'), h('button', { type: 'button', class: 'tpe-x', 'aria-label': 'Close', onclick: () => { sheet.hidden = true; bar.hidden = false; } }, '×')),
      h('div', { class: 'tpe-grid' },
        field(h('span', {}, 'Size of everything ', sizeOut), range(0.6, 1.6, 0.05, layout.scale || 1, (v) => { layout.scale = v; sizeOut.textContent = pct(v); save(); pad.render(); })),
        field(h('span', {}, 'Opacity ', opOut), range(0.15, 1, 0.05, layout.opacity ?? 0.75, (v) => { layout.opacity = v; opOut.textContent = pct(v); save(); pad.render(); }))),
      h('label', { class: 'tpe-check' }, h('input', { type: 'checkbox', checked: layout.haptics !== false, onchange: (e) => { layout.haptics = e.target.checked; save(); } }), 'Vibrate when a button is pressed (phones that support it)'),
      h('label', { class: 'tpe-check' }, h('input', { type: 'checkbox', checked: layout.hideWithPad !== false, onchange: (e) => { layout.hideWithPad = e.target.checked; save(); } }), 'Hide while a game controller is being used'),
      h('div', { class: 'tpe-actions' },
        tbtn('Select all', () => { sheet.hidden = true; select(list().map((c) => c.id)); }),
        tbtn('Reset to the original layout', () => {
          if (!confirm(`Put the ${sys.short} on-screen controls back the way they started (portrait and landscape)?`)) return;
          layout = resetLayout(system, { cMode: layout.cMode });
          controlsFor(layout, true);
          sheet.hidden = true;
          select([]);
          bar.hidden = false;
          refresh();
        }, 'danger')),
      h('p', { class: 'tpe-note' }, 'Drag a control to move it, tap it to change it, and use ↻ to rotate it. To move or turn several together, use “Select several” (or Shift-click), or drag a box around them. Portrait and landscape each have their own layout: turn the screen to edit the other one. Saved in this browser.'));
  }

  let close = function closeEditor() {
    save();
    pad.destroy();
    shell.remove();
    removeEventListener('keydown', onKey, true);
    onDone?.(layout);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!sheet.hidden || selected.size) { select([]); bar.hidden = false; } else close(); }
    // Arrow keys nudge the selection (Shift: further).
    const step = e.shiftKey ? 20 : 4;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (d && selected.size && !/INPUT|SELECT/.test(document.activeElement?.tagName || '')) {
      e.preventDefault();
      for (const c of chosen()) { const p = placeOf(c, pad.u); setPx(c, p.x + d[0], p.y + d[1], pad.u); }
      save(); pad.render(); placeHandle();
    }
  };
  addEventListener('keydown', onKey, true);

  const onTurn = () => { controlsFor(layout, true); pad.render(); select([]); bar.hidden = false; drawBar(); };
  addEventListener('resize', onTurn);
  const closeBase = close;
  close = () => { removeEventListener('resize', onTurn); closeBase(); };
  drawBar();
  return { close: () => close() };
}
