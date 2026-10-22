// Small DOM + formatting helpers shared by every app.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function formatBytes(bytes, digits = 1) {
  if (!bytes || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : digits)} ${units[i]}`;
}

export const formatSpeed = (bytesPerSec) => `${formatBytes(bytesPerSec)}/s`;

export function formatDuration(sec) {
  sec = Math.max(0, Math.round(sec));
  if (!isFinite(sec)) return '—';
  const d = Math.floor(sec / 86400), hh = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (d) return `${d}d ${hh}h`;
  if (hh) return `${hh}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

export function timeAgo(date) {
  const diff = (Date.now() - new Date(date).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(date).toLocaleDateString();
}

export function dayLabel(date) {
  const d = new Date(date);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const that = new Date(d); that.setHours(0, 0, 0, 0);
  const diff = Math.round((that - today) / 864e5);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export const timeOf = (date) => new Date(date).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

export function debounce(fn, ms = 300) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

const history = [];
const listeners = new Set();
export const onNotify = (fn) => listeners.add(fn);
export const notifications = () => history;

export function toast(title, { body = '', type = 'info', icon = null, timeout = 5000 } = {}) {
  const host = document.getElementById('toasts');
  const el = h('div', { class: `toast toast-${type}` },
    icon ? h('div', { class: 'toast-icon', html: icon }) : null,
    h('div', { class: 'toast-text' }, h('strong', {}, title), body ? h('span', {}, body) : null),
    h('button', { class: 'toast-close', 'aria-label': 'Dismiss', onclick: () => dismiss() }, '×'),
  );
  const dismiss = () => { el.classList.add('leaving'); setTimeout(() => el.remove(), 250); };
  host.append(el);
  if (timeout) setTimeout(dismiss, timeout);
  history.unshift({ title, body, type, icon, at: new Date() });
  history.length = Math.min(history.length, 50);
  listeners.forEach((fn) => fn(history));
}

export const toastError = (err, title = 'Something went wrong') => toast(title, { body: err?.message || String(err), type: 'error', timeout: 8000 });

// ---------------------------------------------------------------------------
// Dialogs & menus
// ---------------------------------------------------------------------------

export function confirmDialog({ title, message, confirm = 'Confirm', danger = false, checkbox = null }) {
  return new Promise((resolve) => {
    const check = checkbox ? h('input', { type: 'checkbox' }) : null;
    const close = (ok) => { overlay.remove(); resolve(ok ? { ok: true, checked: check?.checked } : null); };
    const overlay = h('div', { class: 'dialog-overlay', onclick: (e) => { if (e.target === overlay) close(false); } },
      h('div', { class: 'dialog', role: 'dialog' },
        h('h3', {}, title),
        h('p', {}, message),
        checkbox ? h('label', { class: 'check' }, check, ' ', checkbox) : null,
        h('div', { class: 'dialog-actions' },
          h('button', { class: 'btn', onclick: () => close(false) }, 'Cancel'),
          h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, onclick: () => close(true) }, confirm),
        ),
      ),
    );
    document.body.append(overlay);
    overlay.querySelector('.dialog-actions .btn:last-child').focus();
    overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(false); });
  });
}

let openMenu = null;
export function contextMenu(x, y, items) {
  closeMenu();
  const menu = h('div', { class: 'context-menu' },
    items.map((it) => it === '-' ? h('div', { class: 'menu-sep' }) :
      h('button', { class: 'menu-item', disabled: it.disabled, onclick: () => { closeMenu(); it.action(); } },
        it.icon ? h('span', { class: 'menu-icon', html: it.icon }) : h('span', { class: 'menu-icon' }),
        it.label)),
  );
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, innerWidth - r.width - 8)}px`;
  menu.style.top = `${Math.min(y, innerHeight - r.height - 8)}px`;
  openMenu = menu;
}
export function closeMenu() { openMenu?.remove(); openMenu = null; }
document.addEventListener('pointerdown', (e) => { if (openMenu && !openMenu.contains(e.target)) closeMenu(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

// ---------------------------------------------------------------------------
// Common view pieces
// ---------------------------------------------------------------------------

export const spinner = (label = 'Loading…') => h('div', { class: 'empty' }, h('div', { class: 'spinner' }), label);
export const emptyState = (label, sub = '') => h('div', { class: 'empty' }, h('div', { class: 'empty-title' }, label), sub ? h('div', {}, sub) : null);
export const errorState = (err, retry) => h('div', { class: 'empty error' },
  h('div', { class: 'empty-title' }, 'Couldn’t load this'),
  h('div', {}, err?.message || String(err)),
  retry ? h('button', { class: 'btn', onclick: retry }, 'Try again') : null);

export const progressBar = (pct, cls = '') => h('div', { class: `progress ${cls}` },
  h('div', { class: 'progress-fill', style: { width: `${Math.max(0, Math.min(100, pct))}%` } }));

export const badge = (text, kind = '') => h('span', { class: `badge ${kind ? 'badge-' + kind : ''}` }, text);

// A sidebar + content layout used by most apps. `sections` = [{id, label, icon, render(container)}]
export function sidebarLayout(sections, { initial, header } = {}) {
  const content = h('div', { class: 'app-content' });
  const nav = h('nav', { class: 'app-sidebar' }, header || null);
  const buttons = new Map();
  let current = null;
  let cleanup = null;

  const show = (id) => {
    const sec = sections.find((s) => s.id === id) || sections[0];
    current = sec.id;
    buttons.forEach((b, key) => b.classList.toggle('active', key === sec.id));
    if (typeof cleanup === 'function') cleanup();
    clear(content);
    content.scrollTop = 0;
    cleanup = sec.render(content, { show });
  };
  for (const s of sections) {
    const b = h('button', { class: 'nav-item', onclick: () => show(s.id) }, h('span', { class: 'nav-icon', html: s.icon || '' }), h('span', {}, s.label));
    buttons.set(s.id, b);
    nav.append(b);
  }
  const root = h('div', { class: 'app-layout' }, nav, content);
  show(initial || sections[0].id);
  return { root, show, refresh: () => show(current), destroy: () => typeof cleanup === 'function' && cleanup() };
}

// Run `fn` now and every `ms` while the element is attached. Returns a stop function.
export function poll(el, fn, ms) {
  let stopped = false;
  let timer;
  let first = true;
  const tick = async () => {
    if (stopped) return;
    // The first tick may run before the view is attached to the window.
    if (!first && !el.isConnected) { stopped = true; return; }
    first = false;
    if (!document.hidden) { try { await fn(); } catch { /* shown by fn */ } }
    timer = setTimeout(tick, ms);
  };
  tick();
  return () => { stopped = true; clearTimeout(timer); };
}
