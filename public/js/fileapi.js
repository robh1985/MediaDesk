// Shared access to the server's shared folders (Settings → Files), plus an Open / Save As dialog
// for apps like Notes, Preview and the wallpaper picker.

import { h, clear, formatBytes } from './ui.js';
import { icon } from './icons.js';
import { state } from './api.js';

export async function filesCall(route, { method = 'GET', params, body } = {}) {
  const qs = params ? `?${new URLSearchParams(params)}` : '';
  const res = await fetch(`/portal/files/${route}${qs}`, {
    method, credentials: 'same-origin',
    headers: { 'X-MediaDesk': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (data.code === 'stale-page') window.dispatchEvent(new Event('mediadesk:stale'));
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status, code: data.code });
  return data;
}

export const fileUrl = (root, p, inline) => `/portal/files/download?${new URLSearchParams({ root, path: p, ...(inline ? { inline: 1 } : {}) })}`;
export const filesEnabled = () => Boolean(state.config?.files?.enabled);
export const joinPath = (dir, name) => (dir ? `${dir}/${name}` : name);
export const extOf = (name) => (name.includes('.') ? name.split('.').pop().toLowerCase() : '');

const FOLDER = '<svg viewBox="0 0 24 24"><path d="M2.5 6.5A2 2 0 0 1 4.5 4.5h4.2l2 2h8.8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2z" fill="#f5b82e"/></svg>';
const FILE = '<svg viewBox="0 0 24 24"><path d="M6 2.5h8l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-17a1 1 0 0 1 1-1z" fill="#94a3b8"/><path d="M14 2.5v4a1 1 0 0 0 1 1h4" fill="#fff" opacity=".45"/></svg>';

// pickFile({ mode: 'open' | 'save', title, name, accept: (entry) => bool, start: { root, path } })
// resolves to { root, path, name, entry } or null.
export function pickFile({ mode = 'open', title, name = '', accept = () => true, start } = {}) {
  return new Promise((resolve) => {
    let roots = [], root = start?.root ?? null, dir = start?.path ?? '', entries = [], chosen = null;
    const list = h('div', { class: 'fp-list', tabindex: '0' });
    const crumbs = h('div', { class: 'fp-crumbs' });
    const side = h('div', { class: 'fp-roots' });
    const nameInput = h('input', { class: 'input fp-name', value: name, spellcheck: 'false', placeholder: 'File name' });
    const ok = h('button', { class: 'btn btn-primary', type: 'submit' }, mode === 'save' ? 'Save' : 'Open');
    const err = h('div', { class: 'fp-error small' });
    const done = (v) => { overlay.remove(); resolve(v); };
    const form = h('form', { class: 'dialog fp', onsubmit: (e) => { e.preventDefault(); submit(); } },
      h('h3', {}, title || (mode === 'save' ? 'Save as' : 'Open')),
      h('div', { class: 'fp-body' }, side, h('div', { class: 'fp-main' }, crumbs, list)),
      mode === 'save' ? h('label', { class: 'field fp-name-row' }, h('span', {}, 'Name'), nameInput) : null,
      err,
      h('div', { class: 'dialog-actions' }, h('button', { class: 'btn', type: 'button', onclick: () => done(null) }, 'Cancel'), ok));
    const overlay = h('div', { class: 'dialog-overlay', onclick: (e) => { if (e.target === overlay) done(null); } }, form);
    overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') done(null); });
    document.body.append(overlay);

    const submit = () => {
      if (root === null) return;
      if (mode === 'save') {
        const n = nameInput.value.trim();
        if (!n) { nameInput.focus(); return; }
        if (/[\\/]/.test(n)) { err.textContent = 'Names can’t contain / or \\'; return; }
        const existing = entries.find((e) => e.name === n);
        if (existing?.dir) { go(joinPath(dir, n)); return; }
        done({ root, path: joinPath(dir, n), dir, name: n, exists: Boolean(existing) });
      } else if (chosen) {
        if (chosen.dir) go(joinPath(dir, chosen.name));
        else done({ root, path: joinPath(dir, chosen.name), dir, name: chosen.name, entry: chosen });
      }
    };

    const renderRoots = () => clear(side, roots.map((r) => h('button', {
      type: 'button', class: `fp-root ${r.id === root ? 'active' : ''}`, title: r.path, onclick: () => { root = r.id; go(''); },
    }, h('span', { html: icon.disk }), h('span', {}, r.name))));

    async function go(path) {
      dir = path;
      chosen = null;
      err.textContent = '';
      renderRoots();
      const r = roots.find((x) => x.id === root);
      const parts = dir ? dir.split('/') : [];
      clear(crumbs, h('button', { type: 'button', class: 'fp-crumb', onclick: () => go('') }, r?.name || 'Folder'),
        parts.map((p, i) => [h('span', { class: 'muted' }, '›'), h('button', { type: 'button', class: 'fp-crumb', onclick: () => go(parts.slice(0, i + 1).join('/')) }, p)]));
      clear(list, h('div', { class: 'muted small fp-empty' }, 'Loading…'));
      try {
        const res = await filesCall('list', { params: { root, path: dir } });
        entries = res.entries || [];
      } catch (e) { clear(list, h('div', { class: 'fp-empty fp-error' }, e.message)); return; }
      const shown = entries.filter((e) => e.dir || accept(e)).sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, undefined, { numeric: true }));
      ok.disabled = mode === 'open';
      clear(list,
        dir ? h('button', { type: 'button', class: 'fp-row', ondblclick: () => go(parts.slice(0, -1).join('/')), onclick: () => go(parts.slice(0, -1).join('/')) },
          h('span', { class: 'fp-icon', html: FOLDER }), h('span', { class: 'grow' }, '..')) : null,
        shown.length ? shown.map((e) => {
          const row = h('button', { type: 'button', class: 'fp-row', dataset: { name: e.name } },
            h('span', { class: 'fp-icon', html: e.dir ? FOLDER : FILE }), h('span', { class: 'grow fp-label' }, e.name),
            h('span', { class: 'small muted' }, e.dir ? '' : formatBytes(e.size || 0)));
          row.addEventListener('click', () => {
            list.querySelectorAll('.selected').forEach((x) => x.classList.remove('selected'));
            row.classList.add('selected');
            chosen = e;
            if (mode === 'save' && !e.dir) nameInput.value = e.name;
            ok.disabled = false;
            // One tap opens folders on phones.
            if (e.dir && matchMedia('(pointer: coarse)').matches) go(joinPath(dir, e.name));
          });
          row.addEventListener('dblclick', () => {
            if (e.dir) { go(joinPath(dir, e.name)); return; }
            chosen = e;
            if (mode === 'save') nameInput.value = e.name;
            submit();
          });
          return row;
        }) : h('div', { class: 'muted small fp-empty' }, mode === 'open' ? 'No matching files here' : 'Empty folder'));
      if (mode === 'save') ok.disabled = false;
    }

    filesCall('roots').then((r) => {
      roots = r;
      if (!roots.length) throw new Error('No folders are shared yet. Add some in Settings → Files.');
      if (root === null || !roots.some((x) => x.id === root)) { root = roots[0].id; dir = ''; }
      go(dir);
      (mode === 'save' ? nameInput : list).focus();
      if (mode === 'save') { const dot = nameInput.value.lastIndexOf('.'); nameInput.setSelectionRange(0, dot > 0 ? dot : nameInput.value.length); }
    }).catch((e) => { clear(list, h('div', { class: 'fp-empty fp-error' }, e.message)); ok.disabled = true; });
  });
}
