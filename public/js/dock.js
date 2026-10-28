// The dock, like the one on a Mac: pick its size, magnification and screen edge, hide it
// automatically, drag apps to reorder them, drag them off to remove them, and keep open apps
// that aren't in it after a divider. Settings live in layout.js (Settings → Dock & Desktop).

import { h, clear, debounce, contextMenu, toast } from './ui.js';
import { icon } from './icons.js';
import { serviceLink } from './api.js';
import { getApp, toggleApp, onChange, openWindows, focusedWindow, close as closeWindow } from './wm.js';
import { live, subscribe } from './live.js';
import { layout, updateDock, updateDesktop, onLayout, PLACEABLE_EXCLUDE } from './layout.js';
import { draggable, ghostOf, moveGhost } from './dragkit.js';

const isPhone = () => innerWidth < 760;
const fine = () => matchMedia('(pointer: fine)').matches;
let dockEl, inner, hooks;

export function startDock(h0) {
  hooks = h0;
  dockEl = document.getElementById('dock');
  const render = () => renderDock();
  onChange(render);
  subscribe(debounce(render, 50));
  onLayout(render);
  addEventListener('resize', debounce(render, 120));
  setupMagnify();
  setupAutohide();
  render();
}

function renderDock() {
  const d = layout().dock;
  const phone = isPhone();
  dockEl.className = `dock-${phone ? 'bottom' : d.position}${d.autohide && !phone ? ' autohide' : ''}${d.indicators ? '' : ' no-indicators'}${d.magnify && !phone ? ' magnify' : ''}`;
  if (!dockEl.classList.contains('autohide')) dockEl.classList.remove('away');
  else if (!dockEl.matches(':hover') && !dockEl.dataset.busy) dockEl.classList.add('away');
  dockEl.style.setProperty('--dock-size', `${phone ? 36 : d.size}px`);
  const running = new Set(openWindows().map((w) => w.appId));
  const focused = focusedWindow()?.appId;
  const pinned = d.apps.filter((id) => getApp(id) && !PLACEABLE_EXCLUDE.has(id));
  const extra = d.showOpen ? [...running].filter((id) => !pinned.includes(id) && id !== 'launcher' && getApp(id)) : [];
  const item = (id, opts = {}) => {
    const app = getApp(id);
    const n = live.unread[id] || 0;
    const webviews = id === 'webview' ? openWindows().filter((w) => w.appId === 'webview').length : 0;
    const el = h('button', {
      class: `dock-item ${running.has(id) ? 'running' : ''} ${focused === id ? 'focused' : ''}`,
      dataset: { app: id, ...(opts.pinned ? { pinned: '1' } : {}) }, 'aria-label': app.name,
      onclick: opts.onclick || (() => toggleApp(id)),
      oncontextmenu: (e) => { e.preventDefault(); e.stopPropagation(); appMenu(e, id); },
    },
    h('span', { class: 'dock-icon', html: opts.icon || app.icon }),
    h('span', { class: 'dock-label' }, opts.label || (webviews ? `Web UI (${webviews})` : app.name)),
    n ? h('span', { class: 'dock-badge', 'aria-label': `${n} unread` }, n > 99 ? '99+' : n) : null);
    if (id !== 'launcher' && !d.onlyOpen) makeDraggable(el, id);
    return el;
  };
  const launcher = item('launcher', { icon: `<span class="launcher-glyph">${icon.grid}</span>`, label: 'Search & apps', onclick: hooks.openLauncher });
  if (d.onlyOpen) {
    // Search & apps, whatever is open (in the order it was opened), then Settings.
    const open = [...running].filter((id) => id !== 'launcher' && id !== 'settings' && getApp(id));
    inner = h('div', { class: 'dock-inner glass' }, launcher, h('div', { class: 'dock-sep' }),
      open.map((id) => item(id)), open.length ? h('div', { class: 'dock-sep' }) : null, item('settings'));
  } else {
    inner = h('div', { class: 'dock-inner glass' }, launcher,
      h('div', { class: 'dock-sep' }),
      pinned.map((id) => item(id, { pinned: true })),
      extra.length ? [h('div', { class: 'dock-sep' }), extra.map((id) => item(id))] : null);
  }
  clear(dockEl, inner);
}

// Right-click menu for an app, shared by the dock and the desktop.
export function appMenu(e, id, more = []) {
  const wins = openWindows().filter((w) => w.appId === id);
  const d = layout().dock;
  const inDock = d.apps.includes(id);
  const placeable = !PLACEABLE_EXCLUDE.has(id);
  const items = [{ label: wins.length ? 'Show' : 'Open', icon: icon.external, action: () => toggleApp(id) }];
  if (['radarr', 'sonarr', 'nzbget', 'jellyfin', 'plex', 'pikvm'].includes(id) && serviceLink(id)) items.push({ label: 'Open full web UI', icon: icon.globe, action: () => hooks.openWebView(id) });
  if (placeable) {
    items.push('-');
    // With "only open apps" the dock has nothing to keep, so there's nothing to add or remove.
    if (!d.onlyOpen) {
      items.push(inDock
        ? { label: 'Remove from Dock', icon: icon.minimize, action: () => updateDock({ apps: d.apps.filter((x) => x !== id) }) }
        : { label: 'Keep in Dock', icon: icon.plus, action: () => addToDock(id) });
    }
    const onDesk = layout().desktop.items.some((it) => (it.type === 'app' && it.id === id) || (it.type === 'group' && it.apps.includes(id)));
    if (!onDesk) items.push({ label: 'Add to desktop', icon: icon.grid, action: () => updateDesktop((dk) => { dk.items.push({ type: 'app', id }); }) });
  }
  items.push(...more);
  if (wins.length) items.push('-', { label: wins.length > 1 ? `Close ${wins.length} windows` : 'Close', icon: icon.x, action: () => wins.forEach(closeWindow) });
  contextMenu(e.clientX, e.clientY - 10, items);
}

export function addToDock(id, index) {
  const apps = layout().dock.apps.filter((x) => x !== id);
  apps.splice(index ?? apps.length, 0, id);
  updateDock({ apps });
}

// Where in the dock a point falls: the index among kept apps, or -1 when not over the dock.
export function dockDropIndex(x, y) {
  if (layout().dock.onlyOpen) return -1;
  const r = inner?.getBoundingClientRect();
  if (!r || x < r.left - 20 || x > r.right + 20 || y < r.top - 30 || y > r.bottom + 20) return -1;
  const vertical = !dockEl.classList.contains('dock-bottom');
  const pinnedEls = [...inner.querySelectorAll('.dock-item[data-pinned]')];
  let i = pinnedEls.findIndex((el) => { const b = el.getBoundingClientRect(); return vertical ? y < b.top + b.height / 2 : x < b.left + b.width / 2; });
  if (i === -1) i = pinnedEls.length;
  return i;
}

// ---- Dragging inside the dock ----

function makeDraggable(el, id) {
  let ghost = null, away = false;
  const vertical = () => !dockEl.classList.contains('dock-bottom');
  const wasPinned = Boolean(el.dataset.pinned);
  draggable(el, {
    onStart: (st) => {
      dockEl.dataset.busy = '1';
      resetMagnify(true);
      ghost = ghostOf(el.querySelector('.dock-icon'), st.x, st.y);
      ghost.classList.add('dock-ghost');
      el.classList.add('dock-dragging');
    },
    onMove: (st) => {
      moveGhost(ghost, st.x, st.y);
      const r = inner.getBoundingClientRect();
      const pos = layout().dock.position;
      // Far enough off the dock: let go to remove it.
      const off = isPhone() || pos === 'bottom' ? r.top - st.y : pos === 'left' ? st.x - r.right : r.left - st.x;
      away = off > 70;
      ghost.classList.toggle('dock-remove', away);
      el.classList.toggle('dock-collapsed', away);
      if (away) return;
      // Move the real item to where it would land, so neighbours make room.
      const pinnedEls = [...inner.querySelectorAll('.dock-item[data-pinned]')].filter((x) => x !== el);
      const before = pinnedEls.find((x) => { const b = x.getBoundingClientRect(); return vertical() ? st.y < b.top + b.height / 2 : st.x < b.left + b.width / 2; });
      const lastPinned = pinnedEls[pinnedEls.length - 1];
      if (before) { if (el.nextElementSibling !== before) inner.insertBefore(el, before); }
      else if (lastPinned && lastPinned.nextElementSibling !== el) lastPinned.after(el);
      el.dataset.pinned = '1';
    },
    onEnd: (st, e, cancelled) => {
      delete dockEl.dataset.busy;
      const g = ghost;
      ghost = null;
      if (cancelled) { g.remove(); renderDock(); return; }
      if (away) {
        // Poof.
        g.classList.add('dock-poof');
        setTimeout(() => g.remove(), 380);
        updateDock({ apps: layout().dock.apps.filter((x) => x !== id) });
        if (wasPinned) toast(`${getApp(id).name} removed from the Dock`, { timeout: 2000 });
        return;
      }
      g.remove();
      const order = [...inner.querySelectorAll('.dock-item[data-pinned]')].map((x) => x.dataset.app);
      updateDock({ apps: order });
    },
  });
}

// ---- Magnification ----

let bases = null;
function resetMagnify(instant) {
  bases = null;
  inner?.querySelectorAll('.dock-item').forEach((it) => { it.style.removeProperty('--s'); });
  inner?.classList.toggle('settling', !instant);
}
function setupMagnify() {
  dockEl.addEventListener('pointermove', (e) => {
    const d = layout().dock;
    if (e.pointerType !== 'mouse' || !d.magnify || isPhone() || !fine() || dockEl.dataset.busy || !inner) return;
    const vertical = d.position !== 'bottom';
    const items = [...inner.querySelectorAll('.dock-item')];
    if (!bases || bases.length !== items.length) {
      inner.classList.remove('settling');
      items.forEach((it) => it.style.removeProperty('--s'));
      bases = items.map((it) => { const r = it.getBoundingClientRect(); return vertical ? r.top + r.height / 2 : r.left + r.width / 2; });
    }
    const p = vertical ? e.clientY : e.clientX;
    const reach = d.size * 3.2;
    items.forEach((it, i) => {
      const dist = Math.abs(p - bases[i]);
      const f = dist < reach ? (1 + Math.cos(Math.PI * dist / reach)) / 2 : 0;
      it.style.setProperty('--s', `${d.size + (Math.max(d.size, d.magnifySize) - d.size) * f}px`);
    });
  });
  dockEl.addEventListener('pointerleave', () => resetMagnify(false));
}

// ---- Hiding ----

function setupAutohide() {
  let timer;
  const show = () => { clearTimeout(timer); dockEl.classList.remove('away'); };
  const hideSoon = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (dockEl.classList.contains('autohide') && !dockEl.matches(':hover') && !dockEl.dataset.busy && !document.querySelector('.context-menu')) dockEl.classList.add('away');
    }, 700);
  };
  document.addEventListener('pointermove', (e) => {
    if (!dockEl.classList.contains('autohide')) return;
    const pos = layout().dock.position;
    const near = pos === 'bottom' ? e.clientY >= innerHeight - 6 : pos === 'left' ? e.clientX <= 5 : e.clientX >= innerWidth - 6;
    if (near) show();
  }, { passive: true });
  dockEl.addEventListener('pointerenter', show);
  dockEl.addEventListener('pointerleave', hideSoon);
  // After a menu from the dock closes.
  document.addEventListener('pointerdown', () => { if (dockEl.classList.contains('autohide') && !dockEl.contains(document.activeElement)) hideSoon(); });
}
