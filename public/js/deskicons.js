// Desktop icons you can arrange: drag them anywhere on a grid, drop one app onto another to make a
// named group (like Android folders), drop an app onto the dock to keep it there. Positions and
// groups are saved in this browser (layout.js); phones and computers keep separate arrangements.

import { h, clear, contextMenu, closeMenu, toast } from './ui.js';
import { icon } from './icons.js';
import { getApp, openApp } from './wm.js';
import { live, subscribe } from './live.js';
import { layout, updateDesktop, onLayout, itemKey, PLACEABLE_EXCLUDE } from './layout.js';
import { draggable, ghostOf, moveGhost } from './dragkit.js';
import { appMenu, addToDock, dockDropIndex } from './dock.js';

const narrow = () => innerWidth < 760;
const shape = () => (narrow() ? 'narrow' : 'wide');
let host, desktop, grid = null;
const els = new Map();                  // key -> element

export function startDesktopIcons() {
  host = document.getElementById('desktop-icons');
  desktop = document.getElementById('desktop');
  onLayout(render);
  addEventListener('resize', () => { clearTimeout(render.t); render.t = setTimeout(render, 120); });
  subscribe(paintBadges);
  desktop.addEventListener('pointerdown', (ev) => {
    if (!ev.target.closest('.desktop-icon')) host.querySelectorAll('.selected').forEach((x) => x.classList.remove('selected'));
  });
  render();
}

// ---- Grid geometry ----

function measure() {
  if (narrow()) {
    const cols = 4;
    const w = Math.max(280, host.parentElement.clientWidth - 24);
    return { cols, rows: Infinity, cw: Math.floor(w / cols), ch: 100, narrow: true };
  }
  const cw = 96, ch = 104;
  const rect = desktop.getBoundingClientRect();
  const dock = layout().dock;
  const bottomSpace = dock.position === 'bottom' && !dock.autohide ? dock.size + 40 : 20;
  const left = dock.position === 'left' && !dock.autohide ? dock.size + 30 : 0;
  const right = dock.position === 'right' && !dock.autohide ? dock.size + 30 : 0;
  return { cols: Math.max(1, Math.floor((rect.width - 28 - left - right) / cw)), rows: Math.max(2, Math.floor((rect.height - 14 - bottomSpace) / ch)), cw, ch, left };
}

// Work out a cell for every item: saved spots first, then the next free cell for the rest
// (down the columns on a computer, across the rows on a phone).
function arrange(items, pos, g) {
  const taken = new Map();
  const out = new Map();
  const free = (c, r) => c >= 0 && r >= 0 && c < g.cols && r < g.rows && !taken.has(`${c},${r}`);
  for (const it of items) {
    const p = pos[itemKey(it)];
    if (p && free(p[0], p[1])) { taken.set(`${p[0]},${p[1]}`, it); out.set(itemKey(it), p); }
  }
  let n = 0;
  const nth = (i) => (g.narrow ? [i % g.cols, Math.floor(i / g.cols)] : [Math.floor(i / g.rows), i % g.rows]);
  for (const it of items) {
    if (out.has(itemKey(it))) continue;
    let c, r;
    do { [c, r] = nth(n++); } while (!free(c, r) && n < 5000);
    taken.set(`${c},${r}`, it);
    out.set(itemKey(it), [c, r]);
  }
  return { cells: out, taken };
}

function render() {
  const l = layout();
  const items = l.desktop.items.filter((it) => (it.type === 'group' ? true : getApp(it.id) && !PLACEABLE_EXCLUDE.has(it.id)));
  grid = measure();
  const { cells } = arrange(items, l.desktop.pos[shape()] || {}, grid);
  grid.cells = cells;
  grid.items = items;
  const seen = new Set();
  let maxRow = 0;
  for (const it of items) {
    const key = itemKey(it);
    seen.add(key);
    let el = els.get(key);
    const sig = it.type === 'group' ? `${it.name}|${it.apps.join(',')}` : it.id;
    if (!el || el.dataset.sig !== sig) {
      el?.remove();
      el = makeIcon(it);
      el.dataset.sig = sig;
      els.set(key, el);
      host.append(el);
    }
    const [c, r] = cells.get(key);
    maxRow = Math.max(maxRow, r);
    el.style.transform = `translate(${c * grid.cw + (grid.narrow ? (grid.cw - 88) / 2 : 0)}px, ${r * grid.ch}px)`;
  }
  for (const [key, el] of els) if (!seen.has(key)) { el.remove(); els.delete(key); }
  host.classList.toggle('free-grid', true);
  host.style.height = grid.narrow ? `${(maxRow + 1) * grid.ch}px` : '';
  host.style.marginLeft = grid.left ? `${grid.left}px` : '';
  paintBadges();
}

function paintBadges() {
  for (const [key, el] of els) {
    const [type, id] = key.split(/:(.+)/);
    const it = grid?.items?.find((x) => itemKey(x) === key);
    const n = type === 'group' ? (it?.apps || []).reduce((a, x) => a + (live.unread[x] || 0), 0) : live.unread[id] || 0;
    const b = el.querySelector('.desktop-badge');
    b.hidden = !n;
    b.textContent = n > 99 ? '99+' : n;
  }
}

// ---- Icons ----

function groupArt(g) {
  return h('span', { class: 'desktop-icon-img group-art' }, g.apps.slice(0, 4).map((id) => h('span', { class: 'group-mini', html: getApp(id)?.icon || '' })));
}

function makeIcon(it) {
  const isGroup = it.type === 'group';
  const app = isGroup ? null : getApp(it.id);
  const open = () => (isGroup ? openGroup(it.id) : openApp(it.id));
  const el = h('button', { class: `desktop-icon ${isGroup ? 'is-group' : ''}`, dataset: { key: itemKey(it), ...(isGroup ? {} : { app: it.id }) } },
    isGroup ? groupArt(it) : h('span', { class: 'desktop-icon-img', html: app.icon }),
    h('span', { class: 'dock-badge desktop-badge', hidden: true }),
    h('span', { class: 'desktop-icon-label' }, isGroup ? it.name : app.name));
  el.addEventListener('click', () => {
    host.querySelectorAll('.selected').forEach((x) => x.classList.remove('selected'));
    el.classList.add('selected');
    if (matchMedia('(pointer: coarse)').matches || isGroup) open();
  });
  el.addEventListener('dblclick', () => { if (!isGroup) open(); });
  el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') open(); });
  el.addEventListener('contextmenu', (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    if (isGroup) groupMenu(ev, it.id);
    else appMenu(ev, it.id, ['-', ...groupChoices(it.id), { label: 'Remove from desktop', icon: icon.trash, action: () => updateDesktop((d) => { d.items = d.items.filter((x) => itemKey(x) !== itemKey(it)); }) }]);
  });
  makeDraggable(el, it);
  return el;
}

function groupChoices(appId) {
  const groups = layout().desktop.items.filter((x) => x.type === 'group');
  return [
    ...groups.map((g) => ({ label: `Add to “${g.name}”`, icon: icon.grid, action: () => moveIntoGroup(`app:${appId}`, g.id) })),
    { label: 'New group…', icon: icon.plus, action: async () => {
      const name = await askName('New group', 'Group name', 'New group');
      if (!name) return;
      const id = Math.random().toString(36).slice(2, 9);
      updateDesktop((d) => {
        const at = d.items.findIndex((x) => x.type === 'app' && x.id === appId);
        const g = { type: 'group', id, name, apps: [appId], keepEmpty: true };
        if (at >= 0) d.items.splice(at, 1, g); else d.items.push(g);
        for (const s of Object.values(d.pos)) { if (s[`app:${appId}`]) { s[`group:${id}`] = s[`app:${appId}`]; delete s[`app:${appId}`]; } }
      });
      toast(`Group “${name}” created`, { body: 'Drag more apps onto it, or use “Add to group” on an app.', timeout: 3500 });
    } },
  ];
}

function groupMenu(ev, id) {
  const g = layout().desktop.items.find((x) => x.type === 'group' && x.id === id);
  if (!g) return;
  contextMenu(ev.clientX, ev.clientY, [
    { label: 'Open', icon: icon.external, action: () => openGroup(id) },
    { label: 'Rename…', icon: icon.sliders, action: async () => { const n = await askName('Rename group', 'Group name', g.name); if (n) renameGroup(id, n); } },
    '-',
    { label: 'Ungroup', icon: icon.grid, action: () => ungroup(id) },
  ]);
}

// ---- Changes ----

// Save every visible icon's current cell, so the arrangement stays put from now on.
function freeze(d) {
  const s = (d.pos[shape()] = d.pos[shape()] || {});
  for (const [key, cell] of grid.cells) s[key] = cell;
  return s;
}

function moveIntoGroup(fromKey, groupId) {
  updateDesktop((d) => {
    const from = d.items.find((x) => itemKey(x) === fromKey);
    const g = d.items.find((x) => x.type === 'group' && x.id === groupId);
    if (!from || !g || from === g) return;
    const apps = from.type === 'group' ? from.apps : [from.id];
    g.apps.push(...apps.filter((a) => !g.apps.includes(a)));
    delete g.keepEmpty;
    d.items = d.items.filter((x) => x !== from);
  });
}

function makeGroup(fromKey, ontoKey) {
  let created = null;
  updateDesktop((d) => {
    const from = d.items.find((x) => itemKey(x) === fromKey);
    const onto = d.items.find((x) => itemKey(x) === ontoKey);
    if (!from || !onto || from === onto) return;
    if (onto.type === 'group') { created = onto.id; return; }
    const id = Math.random().toString(36).slice(2, 9);
    const apps = [onto.id, ...(from.type === 'group' ? from.apps : [from.id])].filter((a, i, all) => all.indexOf(a) === i);
    const g = { type: 'group', id, name: suggestName(apps), apps };
    const s = freeze(d);
    s[`group:${id}`] = s[ontoKey];
    delete s[ontoKey]; delete s[fromKey];
    d.items.splice(d.items.indexOf(onto), 1, g);
    d.items = d.items.filter((x) => x !== from);
    created = id;
  });
  return created;
}

// A sensible first name, like Android's folder suggestions.
function suggestName(apps) {
  const media = ['radarr', 'sonarr', 'nzbget', 'jellyfin'];
  if (apps.every((a) => media.includes(a))) return 'Media';
  if (apps.every((a) => ['notes', 'calculator', 'files', 'settings'].includes(a))) return 'Utilities';
  if (apps.every((a) => ['music', 'jellyfin'].includes(a))) return 'Entertainment';
  return 'New group';
}

function renameGroup(id, name) {
  updateDesktop((d) => { const g = d.items.find((x) => x.type === 'group' && x.id === id); if (g) g.name = name.trim().slice(0, 40) || g.name; });
}

function ungroup(id) {
  updateDesktop((d) => {
    const at = d.items.findIndex((x) => x.type === 'group' && x.id === id);
    if (at < 0) return;
    const g = d.items[at];
    d.items.splice(at, 1, ...g.apps.filter((a) => !d.items.some((x) => x.type === 'app' && x.id === a)).map((a) => ({ type: 'app', id: a })));
    for (const s of Object.values(d.pos)) delete s[`group:${id}`];
  });
}

// ---- Dragging ----

function cellAt(x, y) {
  const r = host.getBoundingClientRect();
  const c = Math.floor((x - r.left) / grid.cw), row = Math.floor((y - r.top) / grid.ch);
  if (c < 0 || row < 0 || c >= grid.cols || (Number.isFinite(grid.rows) && row >= grid.rows)) return null;
  return [c, row];
}

function makeDraggable(el, it) {
  let ghost = null, target = null, marker = null;
  const key = itemKey(it);
  draggable(el, {
    onStart: (st) => {
      ghost = ghostOf(el, st.x, st.y);
      el.classList.add('drag-source');
      marker = h('div', { class: 'desktop-drop' });
      host.append(marker);
    },
    onMove: (st) => {
      moveGhost(ghost, st.x, st.y);
      host.querySelectorAll('.merge-target').forEach((x) => x.classList.remove('merge-target'));
      document.getElementById('dock')?.classList.toggle('drop-hover', it.type === 'app' && dockDropIndex(st.x, st.y) >= 0);
      target = null;
      const cell = cellAt(st.x, st.y);
      marker.hidden = !cell;
      if (!cell) return;
      const other = [...grid.cells].find(([k, p]) => k !== key && p[0] === cell[0] && p[1] === cell[1]);
      if (other) {
        // Over another icon's middle: make or join a group.
        const oel = els.get(other[0]);
        const r = oel.getBoundingClientRect();
        if (Math.abs(st.x - (r.left + r.width / 2)) < 30 && Math.abs(st.y - (r.top + 30)) < 34) {
          oel.classList.add('merge-target');
          target = { merge: other[0] };
          marker.hidden = true;
          return;
        }
      }
      target = { cell, swap: other?.[0] };
      marker.style.transform = `translate(${cell[0] * grid.cw + (grid.narrow ? (grid.cw - 88) / 2 : 0)}px, ${cell[1] * grid.ch}px)`;
    },
    onEnd: (st, e, cancelled) => {
      ghost.remove(); marker.remove();
      el.classList.remove('drag-source');
      host.querySelectorAll('.merge-target').forEach((x) => x.classList.remove('merge-target'));
      document.getElementById('dock')?.classList.remove('drop-hover');
      if (cancelled) return;
      const di = it.type === 'app' ? dockDropIndex(st.x, st.y) : -1;
      if (di >= 0) { addToDock(it.id, di); toast(`${getApp(it.id).name} added to the Dock`, { timeout: 1800 }); return; }
      if (!target) return;
      if (target.merge) {
        const onto = layout().desktop.items.find((x) => itemKey(x) === target.merge);
        if (onto?.type === 'group') moveIntoGroup(key, onto.id);
        else { const id = makeGroup(key, target.merge); if (id) setTimeout(() => openGroup(id, { rename: true }), 80); }
        return;
      }
      updateDesktop((d) => {
        const s = freeze(d);
        if (target.swap) s[target.swap] = s[key];
        s[key] = target.cell;
      });
    },
  });
}

// ---- Group panel ----

function openGroup(id, { rename = false } = {}) {
  closeMenu();
  document.querySelector('.group-overlay')?.remove();
  const g = layout().desktop.items.find((x) => x.type === 'group' && x.id === id);
  if (!g) return;
  const title = h('input', { class: 'group-title', value: g.name, maxlength: 40, spellcheck: 'false', 'aria-label': 'Group name' });
  const commit = () => { if (title.value.trim() && title.value.trim() !== g.name) renameGroup(id, title.value); };
  title.addEventListener('change', commit);
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } });
  const gridEl = h('div', { class: 'group-grid' });
  const panel = h('div', { class: 'group-panel glass', role: 'dialog', 'aria-label': g.name }, title, gridEl);
  const overlay = h('div', { class: 'group-overlay', onclick: (e) => { if (e.target === overlay) close(); } }, panel);
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const close = () => { document.removeEventListener('keydown', onKey); commit(); overlay.classList.add('leaving'); setTimeout(() => overlay.remove(), 160); };
  document.addEventListener('keydown', onKey);
  const draw = () => {
    const cur = layout().desktop.items.find((x) => x.type === 'group' && x.id === id);
    if (!cur) { close(); return; }
    clear(gridEl, cur.apps.filter((a) => getApp(a)).map((a) => {
      const b = h('button', { class: 'group-app', dataset: { app: a }, onclick: () => { close(); openApp(a); } },
        h('span', { class: 'group-app-img', html: getApp(a).icon }), h('span', { class: 'group-app-label' }, getApp(a).name),
        live.unread[a] ? h('span', { class: 'dock-badge' }, live.unread[a]) : null);
      b.addEventListener('contextmenu', (e) => {
        e.preventDefault(); e.stopPropagation();
        appMenu(e, a, ['-', { label: 'Remove from group', icon: icon.minimize, action: () => takeOut(a) }]);
      });
      // Drag an app out of the panel to put it back on the desktop.
      let ghost = null;
      draggable(b, {
        onStart: (st) => { ghost = ghostOf(b.querySelector('.group-app-img'), st.x, st.y); b.classList.add('drag-source'); },
        onMove: (st) => {
          moveGhost(ghost, st.x, st.y);
          const r = panel.getBoundingClientRect();
          const out = st.x < r.left || st.x > r.right || st.y < r.top || st.y > r.bottom;
          overlay.classList.toggle('dragging-out', out);
          // Reorder within the group.
          if (!out) {
            const before = [...gridEl.children].find((x) => x !== b && (() => { const q = x.getBoundingClientRect(); return st.y < q.bottom && st.x < q.left + q.width / 2 && st.y > q.top - 10; })());
            if (before && b.nextElementSibling !== before) gridEl.insertBefore(b, before);
          }
        },
        onEnd: (st, e, cancelled) => {
          ghost.remove(); b.classList.remove('drag-source');
          const out = overlay.classList.contains('dragging-out');
          overlay.classList.remove('dragging-out');
          if (cancelled) return;
          if (out) { close(); takeOut(a, cellAt(st.x, st.y)); return; }
          const order = [...gridEl.children].map((x) => x.dataset.app);
          updateDesktop((d) => { const gg = d.items.find((x) => x.type === 'group' && x.id === id); if (gg) gg.apps = order; });
        },
      });
      return b;
    }));
  };
  const takeOut = (a, cell) => {
    updateDesktop((d) => {
      const gg = d.items.find((x) => x.type === 'group' && x.id === id);
      if (!gg) return;
      gg.apps = gg.apps.filter((x) => x !== a);
      if (!d.items.some((x) => x.type === 'app' && x.id === a)) d.items.push({ type: 'app', id: a });
      if (cell) {
        const s = freeze(d);
        if (![...Object.entries(s)].some(([k, p]) => k !== `app:${a}` && p[0] === cell[0] && p[1] === cell[1])) s[`app:${a}`] = cell;
      }
    });
    draw();
  };
  draw();
  const off = onLayout(() => { if (overlay.isConnected) draw(); else off(); });
  document.body.append(overlay);
  // Place the panel over the group's icon on a computer; centred on a phone.
  const anchor = els.get(`group:${id}`)?.getBoundingClientRect();
  if (anchor && !narrow()) {
    const pr = panel.getBoundingClientRect();
    panel.style.position = 'absolute';
    panel.style.left = `${Math.max(12, Math.min(innerWidth - pr.width - 12, anchor.left + anchor.width / 2 - pr.width / 2))}px`;
    panel.style.top = `${Math.max(46, Math.min(innerHeight - pr.height - 12, anchor.top - 20))}px`;
  }
  if (rename) { title.focus(); title.select(); } else panel.querySelector('.group-app')?.focus();
}

// ---- Desktop menu extras ----

export function desktopMenuItems() {
  return [
    { label: 'Clean up icons', icon: icon.grid, action: () => updateDesktop((d) => { delete d.pos[shape()]; }) },
    { label: 'Sort icons by name', icon: icon.sliders, action: () => updateDesktop((d) => {
      d.items.sort((a, b) => (a.type === 'group' ? a.name : getApp(a.id)?.name || '').localeCompare(b.type === 'group' ? b.name : getApp(b.id)?.name || ''));
      delete d.pos[shape()];
    }) },
  ];
}

function askName(titleText, label, value) {
  return new Promise((resolve) => {
    const input = h('input', { class: 'input', value, maxlength: 40 });
    const done = (v) => { overlay.remove(); resolve(v); };
    const overlay = h('div', { class: 'dialog-overlay', onclick: (e) => { if (e.target === overlay) done(null); } },
      h('form', { class: 'dialog', onsubmit: (e) => { e.preventDefault(); done(input.value.trim() || null); } },
        h('h3', {}, titleText),
        h('label', { class: 'field', style: { margin: '14px 0 0' } }, h('span', {}, label), input),
        h('div', { class: 'dialog-actions' }, h('button', { class: 'btn', type: 'button', onclick: () => done(null) }, 'Cancel'), h('button', { class: 'btn btn-primary', type: 'submit' }, 'OK'))));
    overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') done(null); });
    document.body.append(overlay);
    input.focus(); input.select();
  });
}
