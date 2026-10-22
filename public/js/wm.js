// Window manager: draggable, resizable, snappable windows with minimise/maximise.

import { h } from './ui.js';
import { icon } from './icons.js';

const apps = new Map();      // id -> app definition
const windows = new Map();   // key -> window record
const listeners = new Set();
let zTop = 10;
let layer;
let snapPreview;

const TOP = 34;              // menu bar height
const DOCK = 86;             // space reserved for the dock
const MIN_W = 360, MIN_H = 240;
const isMobile = () => innerWidth < 760;

export const onChange = (fn) => listeners.add(fn);
const emit = () => listeners.forEach((fn) => fn());

export function registerApp(app) { apps.set(app.id, app); }
export const getApps = () => [...apps.values()];
export const getApp = (id) => apps.get(id);
export const openWindows = () => [...windows.values()];
export const focusedWindow = () => [...windows.values()].find((w) => w.el.classList.contains('focused') && !w.minimized);

export function initWM(container) {
  layer = container;
  snapPreview = h('div', { class: 'snap-preview' });
  layer.append(snapPreview);
  addEventListener('resize', () => {
    for (const w of windows.values()) {
      if (w.maximized || isMobile()) applyMaximized(w);
      else clampToScreen(w);
    }
  });
}

function bounds() {
  return { x: 0, y: TOP, w: innerWidth, h: innerHeight - TOP - (isMobile() ? 72 : DOCK) };
}

function loadGeometry(id) {
  try { return JSON.parse(localStorage.getItem(`mediadesk.win.${id}`)); } catch { return null; }
}
function saveGeometry(w) {
  if (w.maximized || isMobile()) return;
  try { localStorage.setItem(`mediadesk.win.${w.appId}`, JSON.stringify(w.geom)); } catch { /* ignore */ }
}

function cascade(width, height) {
  const b = bounds();
  const n = windows.size % 8;
  return {
    x: Math.max(8, Math.round((b.w - width) / 2) - 120 + n * 32),
    y: Math.max(b.y + 8, b.y + Math.round((b.h - height) / 2) - 60 + n * 28),
    w: width, h: height,
  };
}

function place(w) {
  const g = w.geom;
  Object.assign(w.el.style, { left: `${g.x}px`, top: `${g.y}px`, width: `${g.w}px`, height: `${g.h}px` });
}

function clampToScreen(w) {
  const b = bounds();
  const g = w.geom;
  g.w = Math.min(g.w, b.w - 16);
  g.h = Math.min(g.h, b.h - 8);
  g.x = Math.min(Math.max(g.x, -g.w + 120), b.w - 120);
  g.y = Math.min(Math.max(g.y, b.y), b.y + b.h - 40);
  place(w);
}

function applyMaximized(w) {
  const b = bounds();
  Object.assign(w.el.style, { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` });
}

export function openApp(appId, opts = {}) {
  const app = apps.get(appId);
  if (!app) throw new Error(`Unknown app ${appId}`);
  const key = opts.key ? `${appId}:${opts.key}` : appId;
  const existing = windows.get(key);
  if (existing) {
    restore(existing);
    existing.api.emit?.('reopen', opts);
    return existing;
  }

  const size = app.size || [960, 640];
  const saved = !opts.key && loadGeometry(appId);
  const geom = saved || cascade(Math.min(size[0], innerWidth - 40), Math.min(size[1], innerHeight - TOP - DOCK - 20));

  const titleEl = h('div', { class: 'window-title' }, opts.title || app.name);
  const btnMin = h('button', { class: 'wbtn wbtn-min', title: 'Minimise', html: icon.minimize });
  const btnMax = h('button', { class: 'wbtn wbtn-max', title: 'Maximise', html: icon.maximize });
  const btnClose = h('button', { class: 'wbtn wbtn-close', title: 'Close', html: icon.x });
  const titlebar = h('div', { class: 'titlebar' },
    h('div', { class: 'window-icon', html: app.icon }),
    titleEl,
    h('div', { class: 'titlebar-extra' }),
    h('div', { class: 'window-controls' }, btnMin, btnMax, btnClose));
  const body = h('div', { class: 'window-body' });
  const el = h('section', { class: 'window opening', role: 'dialog', 'aria-label': app.name, dataset: { app: appId } },
    titlebar, body, ...['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map((d) => h('div', { class: `rz rz-${d}`, dataset: { dir: d } })));

  const handlers = {};
  const w = {
    key, appId, el, body, geom, maximized: false, minimized: false,
    titlebarExtra: titlebar.querySelector('.titlebar-extra'),
    setTitle: (t) => { titleEl.textContent = t; emit(); },
    close: () => close(w),
    on: (evt, fn) => { (handlers[evt] = handlers[evt] || []).push(fn); },
  };
  w.api = { emit: (evt, data) => (handlers[evt] || []).forEach((fn) => fn(data)) };

  layer.append(el);
  place(w);
  windows.set(key, w);
  if (isMobile() || saved?.maximized) toggleMaximize(w, true);
  focus(w);
  requestAnimationFrame(() => el.classList.remove('opening'));

  btnClose.addEventListener('click', () => close(w));
  btnMin.addEventListener('click', () => minimize(w));
  btnMax.addEventListener('click', () => toggleMaximize(w));
  titlebar.addEventListener('dblclick', (e) => { if (!e.target.closest('button, input, select')) toggleMaximize(w); });
  el.addEventListener('pointerdown', () => focus(w), true);
  enableDrag(w, titlebar);
  enableResize(w);

  try {
    app.open(w, opts);
  } catch (err) {
    console.error(err);
    body.textContent = `Failed to start ${app.name}: ${err.message}`;
  }
  emit();
  return w;
}

export function focus(w) {
  if (!w) return;
  for (const other of windows.values()) other.el.classList.toggle('focused', other === w);
  if (Number(w.el.style.zIndex) !== zTop) w.el.style.zIndex = ++zTop;
  emit();
}

export function close(w) {
  w.api.emit('close');
  w.el.classList.add('closing');
  windows.delete(w.key);
  setTimeout(() => w.el.remove(), 180);
  const next = [...windows.values()].filter((x) => !x.minimized).sort((a, b) => b.el.style.zIndex - a.el.style.zIndex)[0];
  if (next) focus(next); else emit();
}

export function minimize(w) {
  const target = document.querySelector(`.dock-item[data-app="${w.appId}"]`);
  if (target) {
    const r = target.getBoundingClientRect();
    const wr = w.el.getBoundingClientRect();
    w.el.style.setProperty('--min-x', `${r.left + r.width / 2 - (wr.left + wr.width / 2)}px`);
    w.el.style.setProperty('--min-y', `${r.top - wr.top - wr.height / 2}px`);
  }
  w.minimized = true;
  w.el.classList.add('minimized');
  w.el.classList.remove('focused');
  const next = [...windows.values()].filter((x) => !x.minimized).sort((a, b) => b.el.style.zIndex - a.el.style.zIndex)[0];
  if (next) focus(next); else emit();
}

export function restore(w) {
  w.minimized = false;
  w.el.classList.remove('minimized');
  focus(w);
}

// Clicking a dock icon: open, focus, or minimise depending on state.
export function toggleApp(appId) {
  const wins = [...windows.values()].filter((w) => w.appId === appId);
  if (!wins.length) return openApp(appId);
  const top = wins.sort((a, b) => b.el.style.zIndex - a.el.style.zIndex)[0];
  if (top.minimized) restore(top);
  else if (top.el.classList.contains('focused')) minimize(top);
  else focus(top);
}

export function toggleMaximize(w, force) {
  const want = force ?? !w.maximized;
  w.maximized = want;
  w.el.classList.toggle('maximized', want);
  w.el.querySelector('.wbtn-max').innerHTML = want ? icon.restore : icon.maximize;
  if (want) applyMaximized(w); else place(w);
  try {
    if (!w.key.includes(':')) {
      const g = { ...w.geom, maximized: want };
      localStorage.setItem(`mediadesk.win.${w.appId}`, JSON.stringify(g));
    }
  } catch { /* ignore */ }
}

function snapZone(x, y) {
  if (y <= TOP + 2) return 'max';
  if (x <= 4) return 'left';
  if (x >= innerWidth - 4) return 'right';
  return null;
}

function snapRect(zone) {
  const b = bounds();
  if (zone === 'max') return b;
  if (zone === 'left') return { x: 0, y: b.y, w: Math.round(b.w / 2), h: b.h };
  return { x: Math.round(b.w / 2), y: b.y, w: b.w - Math.round(b.w / 2), h: b.h };
}

function enableDrag(w, handle) {
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button, input, select, a') || isMobile()) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX, startY = e.clientY;
    let { x, y } = w.geom;
    let moved = false;
    let zone = null;

    const move = (ev) => {
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      if (!moved) {
        moved = true;
        w.el.classList.add('dragging');
        if (w.maximized || w.snapped) {
          // Pull the window out of maximised/snapped state under the cursor.
          const ratio = (startX - w.el.getBoundingClientRect().left) / w.el.offsetWidth;
          w.geom = { ...(w.preSnap || w.geom) };
          w.maximized = false; w.snapped = false;
          w.el.classList.remove('maximized');
          w.el.querySelector('.wbtn-max').innerHTML = icon.maximize;
          x = startX - w.geom.w * ratio; y = startY - 16;
          w.geom.x = x; w.geom.y = y;
        }
      }
      w.geom.x = x + dx;
      w.geom.y = Math.max(TOP, y + dy);
      place(w);
      zone = snapZone(ev.clientX, ev.clientY);
      if (zone) {
        const r = snapRect(zone);
        Object.assign(snapPreview.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
        snapPreview.classList.add('visible');
      } else snapPreview.classList.remove('visible');
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      w.el.classList.remove('dragging');
      snapPreview.classList.remove('visible');
      if (!moved) return;
      if (zone === 'max') { w.preSnap = { ...w.geom, y: Math.max(TOP + 10, w.geom.y) }; w.geom = w.preSnap; toggleMaximize(w, true); return; }
      if (zone) {
        w.preSnap = { ...w.geom };
        w.snapped = true;
        const r = snapRect(zone);
        Object.assign(w.el.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
        return;
      }
      clampToScreen(w);
      saveGeometry(w);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });
}

function enableResize(w) {
  w.el.querySelectorAll('.rz').forEach((grip) => {
    grip.addEventListener('pointerdown', (e) => {
      if (w.maximized || isMobile()) return;
      e.preventDefault(); e.stopPropagation();
      grip.setPointerCapture(e.pointerId);
      const dir = grip.dataset.dir;
      if (w.snapped) { w.snapped = false; const r = w.el.getBoundingClientRect(); w.geom = { x: r.left, y: r.top, w: r.width, h: r.height }; }
      const start = { ...w.geom, mx: e.clientX, my: e.clientY };
      w.el.classList.add('dragging');
      const move = (ev) => {
        const dx = ev.clientX - start.mx, dy = ev.clientY - start.my;
        const g = w.geom;
        if (dir.includes('e')) g.w = Math.max(MIN_W, start.w + dx);
        if (dir.includes('s')) g.h = Math.max(MIN_H, start.h + dy);
        if (dir.includes('w')) { g.w = Math.max(MIN_W, start.w - dx); g.x = start.x + start.w - g.w; }
        if (dir.includes('n')) { g.h = Math.max(MIN_H, start.h - dy); g.y = Math.max(TOP, start.y + start.h - g.h); }
        place(w);
      };
      const up = () => {
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', up);
        w.el.classList.remove('dragging');
        saveGeometry(w);
        w.api.emit('resize');
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up);
    });
  });
}
