// Adding games to The Game Console from this device: drop files on it (or choose them), and each
// one is uploaded to the MediaDesk server, which works out the console and puts it in that
// console's folder. A .cue / .gdi / .m3u goes up together with the track files it names.

import { h, clear, formatBytes } from '../../ui.js';
import { SYSTEMS, ORDER } from './systems.js';

const SHEETS = ['cue', 'gdi', 'm3u'];
const extOf = (n) => (/\.([^.]+)$/.exec(n)?.[1] || '').toLowerCase();
const PICTURES = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp']);

// The files a sheet names.
async function sheetNames(file) {
  const text = await file.slice(0, 256 * 1024).text().catch(() => '');
  const ext = extOf(file.name);
  const out = [];
  if (ext === 'cue') for (const m of text.matchAll(/^\s*FILE\s+"?([^"\r\n]+?)"?\s+\w+\s*$/gim)) out.push(m[1]);
  if (ext === 'gdi') for (const line of text.split(/\r?\n/).slice(1)) { const m = /^\s*\d+\s+\d+\s+\d+\s+\d+\s+"?([^"]+?)"?\s+\d+\s*$/.exec(line); if (m) out.push(m[1]); }
  if (ext === 'm3u') for (const line of text.split(/\r?\n/)) { const l = line.trim(); if (l && !l.startsWith('#')) out.push(l); }
  return out.map((n) => n.split(/[\\/]/).pop().toLowerCase());
}

// [{ files: [File], name }]: a sheet and what it names (an .m3u's .cue files and theirs too), then
// every other file on its own.
export async function groupFiles(list) {
  const files = [...list].filter((f) => f.size > 0 && !PICTURES.has(extOf(f.name)));
  const byName = new Map(files.map((f) => [f.name.toLowerCase(), f]));
  const used = new Set();
  const groups = [];
  const sheets = files.filter((f) => SHEETS.includes(extOf(f.name))).sort((a, b) => (extOf(a.name) === 'm3u' ? -1 : 0) - (extOf(b.name) === 'm3u' ? -1 : 0));
  for (const s of sheets) {
    if (used.has(s)) continue;
    const g = [s];
    used.add(s);
    const add = async (sheet, depth) => {
      for (const n of await sheetNames(sheet)) {
        const f = byName.get(n);
        if (!f || used.has(f)) continue;
        used.add(f); g.push(f);
        if (depth < 1 && SHEETS.includes(extOf(f.name))) await add(f, depth + 1);
      }
    };
    await add(s, 0);
    groups.push({ files: g, name: s.name });
  }
  for (const f of files) if (!used.has(f)) groups.push({ files: [f], name: f.name });
  return groups;
}

const newBatch = () => [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('');

function put(url, file, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('PUT', url);
    x.setRequestHeader('X-MediaDesk', '1');
    x.setRequestHeader('Content-Type', 'application/octet-stream');
    x.upload.onprogress = (e) => onProgress(e.loaded);
    x.onload = () => {
      let data = {};
      try { data = JSON.parse(x.responseText); } catch { /* not JSON */ }
      if (x.status >= 200 && x.status < 300) resolve(data); else reject(new Error(data.error || `HTTP ${x.status}`));
    };
    x.onerror = () => reject(new Error('The connection to MediaDesk dropped'));
    x.send(file);
  });
}
async function post(url, body) {
  const res = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'X-MediaDesk': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// The panel over the Game Console while games go up. mine: into your own library.
// Resolves with the games added ([{ id, title, system }]).
export function addGames(root, list, { mine = false, onDone } = {}) {
  const base = `/portal/games${mine ? '/mine' : ''}/upload`;
  const rows = h('div', { class: 'gc-add-rows' });
  const title = h('h2', {}, 'Adding games…');
  const sub = h('p', { class: 'gc-small' }, mine ? 'Into your own games.' : 'Into the shared games folder.');
  const close = h('button', { class: 'gc-btn', type: 'button', disabled: true, onclick: () => { panel.remove(); onDone?.(added); } }, 'Done');
  const panel = h('div', { class: 'gc-add' }, h('div', { class: 'gc-add-box' }, title, sub, rows, h('div', { class: 'gc-row' }, close)));
  root.append(panel);
  const added = [];
  let left = 0;
  const finished = () => {
    if (--left > 0) return;
    close.disabled = false;
    close.classList.add('primary');
    close.focus();
    title.textContent = added.length ? `Added ${added.length} game${added.length === 1 ? '' : 's'}` : 'Nothing was added';
  };
  (async () => {
    const groups = await groupFiles(list);
    if (!groups.length) { rows.append(h('p', {}, 'Those aren’t game files.')); left = 1; finished(); return; }
    left = groups.length;
    // A few at a time.
    const queue = groups.map((g) => () => one(g));
    const worker = async () => { while (queue.length) await queue.shift()(); };
    await Promise.all([worker(), worker()]);
  })();

  async function one(g) {
    const total = g.files.reduce((n, f) => n + f.size, 0);
    const bar = h('div', { class: 'gc-add-bar' }, h('i', {}));
    const status = h('span', { class: 'gc-small' }, g.files.length > 1 ? `${g.files.length} files · ${formatBytes(total)}` : formatBytes(total));
    const row = h('div', { class: 'gc-add-row' }, h('div', { class: 'gc-add-name' }, h('b', {}, g.name), status), bar);
    rows.append(row);
    const batch = newBatch();
    const set = (txt, cls) => { status.textContent = txt; row.className = `gc-add-row ${cls || ''}`; };
    try {
      let done = 0;
      for (const f of g.files) {
        await put(`${base}/${batch}?name=${encodeURIComponent(f.name)}`, f, (n) => { bar.firstChild.style.width = `${Math.min(100, ((done + n) / total) * 100)}%`; });
        done += f.size;
      }
      bar.firstChild.style.width = '100%';
      set('Working out the console…');
      let r = await post(`${base}/${batch}/finish`, {});
      if (r.needsSystem) r = await askSystem(row, set, (system) => post(`${base}/${batch}/finish`, { system }), () => fetch(`${base}/${batch}`, { method: 'DELETE', headers: { 'X-MediaDesk': '1' } }));
      if (!r) { set('Not added', 'skip'); return; }
      if (r.bios) set(`✓ BIOS for ${r.consoleName || 'a console'} → ${r.folder}`, 'ok');
      else {
        set(`${r.existed ? '✓ Already there' : '✓ Added'} · ${SYSTEMS[r.system]?.short || r.consoleName} → ${r.folder}`, 'ok');
        if (r.game && !r.existed) added.push({ ...r.game, system: r.system });
      }
    } catch (err) {
      set(err.message, 'bad');
    } finally { finished(); }
  }
  return panel;
}

// The server can't tell which console: ask (with every console in a list).
function askSystem(row, set, finish, cancel) {
  return new Promise((resolve) => {
    set('Which console is it for?', 'ask');
    const sel = h('select', { class: 'gc-add-select' }, h('option', { value: '' }, 'Choose a console…'), ORDER.map((s) => h('option', { value: s }, SYSTEMS[s].name)));
    const ok = h('button', { class: 'gc-btn primary', type: 'button', onclick: async () => {
      if (!sel.value) { sel.focus(); return; }
      ok.disabled = true;
      try { const r = await finish(sel.value); pick.remove(); resolve(r); } catch (err) { set(err.message, 'bad'); pick.remove(); resolve(null); }
    } }, 'Add');
    const skip = h('button', { class: 'gc-btn', type: 'button', onclick: () => { cancel(); pick.remove(); resolve(null); } }, 'Skip');
    const pick = h('div', { class: 'gc-add-pick' }, sel, ok, skip);
    row.append(pick);
    sel.focus();
  });
}

// Dropping files on the Game Console. canDrop(): whether it takes games now. target(e): mine or not.
export function dropZone(root, { canDrop, personal, onFiles }) {
  let shown = null;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  const zone = (mine, label, hint) => h('div', { class: 'gc-drop-zone', 'data-mine': mine ? '1' : '' }, h('b', {}, label), h('span', {}, hint));
  const show = () => {
    if (shown) return;
    shown = h('div', { class: 'gc-drop' }, personal()
      ? [zone(false, 'Shared games', 'Drop here for everyone'), zone(true, 'My games', 'Drop here for just you')]
      : [zone(false, 'Drop games to add them', 'They go into each console’s folder on the MediaDesk server')]);
    root.append(shown);
  };
  const hide = () => { shown?.remove(); shown = null; };
  let depth = 0;
  root.addEventListener('dragenter', (e) => { if (!hasFiles(e) || !canDrop()) return; e.preventDefault(); depth++; show(); });
  root.addEventListener('dragover', (e) => {
    if (!hasFiles(e) || !canDrop()) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    shown?.querySelectorAll('.gc-drop-zone').forEach((z) => z.classList.toggle('over', z.contains(e.target)));
  });
  root.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; hide(); } });
  root.addEventListener('drop', (e) => {
    if (!hasFiles(e) || !canDrop()) return;
    e.preventDefault();
    depth = 0;
    const mine = Boolean(e.target.closest?.('.gc-drop-zone')?.dataset.mine);
    hide();
    if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files, { mine });
  });
}

// Choosing games on this device instead (phones and tablets can't drag).
export function chooseGames(onFiles) {
  const input = h('input', { type: 'file', multiple: true, style: { display: 'none' } });
  input.onchange = () => { const f = [...input.files]; input.remove(); if (f.length) onFiles(f); };
  document.body.append(input);
  input.click();
}
