// ROM Manager: keeps a ROM collection matched to DAT files, with RomVault's engine (a JavaScript port of RomVault
// by Gordon J, Apache-2.0) running on the MediaDesk server (roms.js, romvault/). The window follows RomVault's:
//   • left: the DAT tree. Tick a folder to include it in scans and fixes (right-click the tick box to lock it:
//     locked folders are read, never changed). The icon is red when nothing is there, yellow when some is, green
//     when everything is; ToSort folders are blue. Tree pre-sets 1–4 remember ticks.
//   • right: the DAT's details, the filters, the sets (games) in that folder and the files (ROMs) in the set picked.
//     Rows are coloured by status, the same colours as RomVault.
//   • the toolbar runs Update DATs, Scan ROMs, Find Fixes and Fix ROMs; progress, errors and every fix are listed
//     in the panel at the bottom while it runs.
// On narrow windows and phones the tree is a drawer behind ☰, and a set's files open over the list of sets.

import { h, clear, toast, toastError, contextMenu, confirmDialog, spinner, emptyState, errorState, debounce } from '../ui.js';
import { icon, appIcon } from '../icons.js';

const svg = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${extra}>${d}</svg>`;
const I = {
  dats: svg('<path d="M6 2.5h8l5 5V21a.5.5 0 0 1-.5.5h-12A.5.5 0 0 1 6 21z"/><path d="M14 2.5V8h5M9 13h6M9 17h6"/>'),
  scan: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>'),
  find: svg('<path d="M9 11l3 3 8-8"/><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/>'),
  fix: svg('<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>'),
  report: svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>'),
  key: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h2M7 13h2M7 17h2M12 9h5M12 13h5M12 17h5"/>'),
  caret: svg('<path d="m6 9 6 6 6-6"/>'),
  back: svg('<path d="M15 18l-6-6 6-6"/>'),
  stop: svg('<rect x="6" y="6" width="12" height="12" rx="2"/>'),
  chevUp: svg('<path d="m6 15 6-6 6 6"/>'),
  help: svg('<circle cx="12" cy="12" r="9.5"/><path d="M9.5 9.2a2.6 2.6 0 0 1 5 .9c0 1.8-2.5 2.2-2.5 3.9M12 17.2v.1"/>'),
  bolt: svg('<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>'),
  folder: svg('<path d="M2.5 6.5A2 2 0 0 1 4.5 4.5h4.2l2 2h8.8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2z"/>'),
};

// RepStatus, in the engine's order (romvault/enums.js).
const RS = ['Error', 'UnSet', 'UnScanned', 'DirCorrect', 'DirMissing', 'DirUnknown', 'DirInToSort', 'DirCorrupt', 'Missing', 'Correct', 'NotCollected', 'UnNeeded', 'Unknown', 'InToSort', 'Corrupt', 'Ignore', 'CanBeFixed', 'MoveToSort', 'Delete', 'NeededForFix', 'Rename', 'CorruptCanBeFixed', 'MoveToCorrupt', 'Deleted', 'IncompleteRemove', 'Incomplete', 'MissingMIA', 'CorrectMIA', 'CanBeFixedMIA', 'MissingNew'];
const R = Object.fromEntries(RS.map((n, i) => [n, i]));
// RepairStatus.DisplayOrder (the order the game list shows counts in).
const DISPLAY_ORDER = ['Error', 'UnSet', 'UnScanned', 'DirCorrupt', 'MoveToCorrupt', 'CorruptCanBeFixed', 'CanBeFixedMIA', 'CanBeFixed', 'MoveToSort', 'Delete', 'NeededForFix', 'Rename', 'Corrupt', 'Unknown', 'UnNeeded', 'Incomplete', 'Missing', 'MissingNew', 'MissingMIA', 'CorrectMIA', 'Correct', 'InToSort', 'NotCollected', 'Ignore', 'Deleted'];
// UIDisplayColors.cs
const COLOR = {
  UnScanned: '#d6d6ff', DirCorrect: '#d6ffd6', DirMissing: '#ffd6d6', DirCorrupt: '#ff0000', Missing: '#ffd6d6', MissingNew: '#96c896', Correct: '#d6ffd6',
  CorrectMIA: '#64ff64', NotCollected: '#d6d6d6', UnNeeded: '#d6e1e1', Unknown: '#d6ffff', InToSort: '#ffd6ff', MissingMIA: '#96c896', Corrupt: '#ff0000',
  Ignore: '#d6e0ff', CanBeFixed: '#ffffd6', CanBeFixedMIA: '#ffff64', MoveToSort: '#d68cd6', Delete: '#8c5050', NeededForFix: '#ffd68c', Rename: '#ffd68c',
  CorruptCanBeFixed: '#ffffd6', MoveToCorrupt: '#d68cd6', Incomplete: '#ffebeb', Deleted: '#ffffff', IncompleteRemove: '#ffebeb', DirUnknown: '#d6ffff', DirInToSort: '#ffd6ff',
};
const LABEL = {
  Correct: 'Correct', Missing: 'Missing', CanBeFixed: 'Can be fixed', MoveToSort: 'Move to ToSort', Delete: 'Delete (a copy is kept elsewhere)', NeededForFix: 'Needed for a fix',
  Rename: 'Rename', Corrupt: 'Corrupt', Unknown: 'Unknown (no DAT has it)', UnNeeded: 'Unneeded (merged here, kept elsewhere)', InToSort: 'In ToSort', NotCollected: 'Not collected (merged)',
  Ignore: 'Ignored', UnScanned: 'Not scanned (locked)', Incomplete: 'Incomplete set', IncompleteRemove: 'Remove (set incomplete)', CorruptCanBeFixed: 'Corrupt, can be fixed', MoveToCorrupt: 'Move to ToSort\\Corrupt',
  DirCorrupt: 'Corrupt archive', Deleted: 'Deleted', DirCorrect: 'Folder correct', DirMissing: 'Folder missing', DirUnknown: 'Folder unknown', DirInToSort: 'Folder in ToSort', Error: 'Error', UnSet: 'Not checked yet',
  MissingMIA: 'Missing (MIA)', CorrectMIA: 'Correct (was MIA)', CanBeFixedMIA: 'Can be fixed (MIA)', MissingNew: 'Newly missing',
};
const KEY_ORDER = ['Correct', 'Missing', 'CanBeFixed', 'Rename', 'NeededForFix', 'MoveToSort', 'Delete', 'Unknown', 'InToSort', 'Corrupt', 'MoveToCorrupt', 'CorruptCanBeFixed', 'NotCollected', 'UnNeeded', 'Incomplete', 'Ignore', 'UnScanned'];
const DS = ['In DAT', 'In DAT (merged)', 'In DAT (no dump)', 'Not in any DAT', 'In ToSort'];
const TYPE = {
  Zip: ['ZIP', 'ZIP'], ZipTrrnt: ['TZ', 'TorrentZip'], ZipTDC: ['TDC', 'TDC zip'], ZipZSTD: ['ZST', 'Zip (ZSTD)'], ZipDTD: ['DTD', 'Zip (DTD)'], ZipDTZ: ['DTZ', 'Zip (DTZ)'],
  SevenZip: ['7Z', '7z'], SevenZipTrrnt: ['T7Z', 'Torrent 7z'], SevenZipSLZMA: ['RV7Z', 'RomVault 7z (solid LZMA)'], SevenZipNLZMA: ['7Z', '7z (non-solid LZMA)'], SevenZipSZSTD: ['7ZS', '7z (solid ZSTD)'], SevenZipNZSTD: ['7ZN', '7z (non-solid ZSTD)'], Dir: ['DIR', 'Folder'],
};
const FIX_LEVEL = ['Level 1 - Fast copy Match on CRC', 'Level 2 - Fast copy if SHA1 scanned', 'Level 3 - Uncompress/Hash/Compress'];
const SEVENZ_DEFAULT = ['LZMA Solid - rv7z', 'LZMA Non-Solid'];
const ARCHIVE_TYPE = [[1, 'Uncompressed'], [2, 'Zip'], [3, 'SevenZip'], [100, 'Mixed (Archive as File)']];
const MERGE = ['Nothing', 'Split', 'Merge', 'NonMerge'];
const FILTER = ['Roms & CHDs', 'Roms Only', 'CHDs Only'];
const HEADER = ['Optional', 'Headered', 'Headerless'];
const SUBDIR = ['Use subdirs for all sets', 'Do not use subdirs for sets', 'Use subdirs for rom name conflicts', 'Use subdirs for multi-rom sets', 'Use subdirs for multi-rom sets or set/rom name mismatches'];
const TICK = { UnSelected: 0, Selected: 1, Locked: 2 };
const SCAN = [[1, 'Scan', 'New and changed files, with a full hash check'], [0, 'Scan Quick (Headers Only)', 'New files: read archive headers only'], [2, 'Scan Full (Complete Re-Scan)', 'Every file again, with a full hash check']];

const readLs = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const writeLs = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } };
const num = (n) => (n ?? 0).toLocaleString();

async function call(route, { method = 'GET', params, body } = {}) {
  const qs = params ? `?${new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null))}` : '';
  const res = await fetch(`/portal/roms/${route}${qs}`, { method, credentials: 'same-origin', headers: { 'X-MediaDesk': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json().catch(() => ({})) : await res.text();
  if (data?.code === 'stale-page') window.dispatchEvent(new Event('mediadesk:stale'));
  if (!res.ok) throw Object.assign(new Error(data?.error || `HTTP ${res.status}`), { status: res.status });
  return data;
}
function download(route, params) {
  const a = h('a', { href: `/portal/roms/${route}?${new URLSearchParams(params)}`, download: '' });
  document.body.append(a); a.click(); a.remove();
}

let cssLoaded = false;
function loadCss() {
  if (cssLoaded) return;
  cssLoaded = true;
  document.head.append(h('link', { rel: 'stylesheet', href: new URL('../../css/roms.css', import.meta.url).href }));
}

const swatch = (st) => h('span', { class: 'rv-sw', style: { '--c': COLOR[RS[st]] || '#ccc' } });
const statusChip = (st, text) => h('span', { class: 'rv-chip', style: { '--c': COLOR[RS[st]] || '#ccc' }, title: LABEL[RS[st]] || RS[st] }, text ?? (LABEL[RS[st]] || RS[st]));
const treeIconSvg = (n) => {
  const fill = { 1: '#ef4444', 2: '#eab308', 3: '#22c55e', 4: '#3b82f6' }[n] || '#94a3b8';
  return `<svg viewBox="0 0 24 24"><path d="M2.5 6.5A2 2 0 0 1 4.5 4.5h4.2l2 2h8.8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2z" fill="${fill}"/><path d="M2.5 9.5h19" stroke="#fff" stroke-opacity=".45" stroke-width="1.2"/></svg>`;
};
function typeBadge(row) {
  const out = h('span', { class: 'rv-type' });
  const b = (t, cls) => { const [s, l] = TYPE[t] || [t, t]; return h('span', { class: `rv-tb ${cls}`, title: l }, s); };
  if (row.dt && row.gt && row.dt !== row.gt) out.append(b(row.gt, ''), h('span', { class: 'rv-conv', title: row.conv === 1 ? 'Will be converted when fixing' : 'Different from the DAT rule (not converted)' }, '→'), b(row.dt, 'rv-tb-miss'));
  else if (row.dt && row.gt) out.append(b(row.gt, ''));
  else if (row.dt) out.append(b(row.dt, 'rv-tb-miss'));
  else if (row.gt) out.append(b(row.gt, row.corrupt ? 'rv-tb-bad' : ''));
  return out;
}

// --- A virtual table: only the rows in view are in the page, so 40,000 MAME sets scroll smoothly. --------------
class VTable {
  constructor({ cols, rowH = 26, onSelect, onOpen, onContext, rowStyle, empty = 'Nothing here' }) {
    Object.assign(this, { cols, rowH, onSelect, onOpen, onContext, rowStyle, emptyText: empty });
    this.rows = []; this.view = []; this.sel = -1; this.sort = null;
    this.head = h('div', { class: 'rv-th', role: 'row' });
    this.spacer = h('div', { class: 'rv-spacer' });
    this.body = h('div', { class: 'rv-tbody', role: 'rowgroup' });
    this.empty = h('div', { class: 'rv-tempty small muted', hidden: true });
    this.el = h('div', { class: 'rv-table', role: 'grid', tabindex: '0', onscroll: () => this.paint(), onkeydown: (e) => this.key(e) }, this.head, this.spacer, this.empty);
    this.spacer.append(this.body);
    new ResizeObserver(() => this.paint()).observe(this.el);
    this.setCols(cols);
  }
  setCols(cols) {
    this.cols = cols.filter((c) => !c.hidden);
    this.el.style.setProperty('--cols', this.cols.map((c) => c.w || '1fr').join(' '));
    this.el.style.setProperty('--minw', `${this.cols.reduce((a, c) => a + (c.min || parseInt(c.w, 10) || 120), 0)}px`);
    clear(this.head, this.cols.map((c, i) => h('div', { class: `rv-thc${c.cls ? ` ${c.cls}` : ''}`, role: 'columnheader', title: c.title || c.label, onclick: () => c.sortKey && this.sortBy(i) },
      c.label, this.sort?.col === c.key ? h('span', { class: 'rv-sort' }, this.sort.dir > 0 ? '▲' : '▼') : null)));
  }
  sortBy(i) {
    const c = this.cols[i];
    this.sort = this.sort?.col === c.key ? (this.sort.dir > 0 ? { col: c.key, dir: -1, fn: c.sortKey } : null) : { col: c.key, dir: 1, fn: c.sortKey };
    this.setCols(this.cols);
    this.applySort();
    this.paint(true);
  }
  applySort() {
    const selRow = this.view[this.sel];
    this.view = [...this.rows];
    if (this.sort) {
      const { fn, dir } = this.sort;
      this.view.sort((a, b) => { const x = fn(a); const y = fn(b); return (x < y ? -1 : x > y ? 1 : 0) * dir; });
    }
    this.sel = selRow ? this.view.indexOf(selRow) : -1;
  }
  setRows(rows, { keep } = {}) {
    const keepKey = keep ? keep(this.view[this.sel]) : null;
    this.rows = rows;
    this.applySort();
    this.sel = keepKey != null ? this.view.findIndex((r) => keep(r) === keepKey) : -1;
    this.empty.hidden = rows.length > 0;
    this.empty.textContent = this.emptyText;
    this.spacer.style.height = `${this.view.length * this.rowH}px`;
    this.paint(true);
  }
  // Taller rows for fingers on narrow windows and phones.
  setRowH(n) {
    if (n === this.rowH) return;
    this.rowH = n;
    this.el.style.setProperty('--rh', `${n}px`);
    this.spacer.style.height = `${this.view.length * n}px`;
    this.paint(true);
  }
  paint(force) {
    const top = this.el.scrollTop; const hgt = this.el.clientHeight || 400;
    const a = Math.max(0, Math.floor(top / this.rowH) - 8);
    const b = Math.min(this.view.length, Math.ceil((top + hgt) / this.rowH) + 8);
    if (!force && a === this.a && b === this.b) return;
    this.a = a; this.b = b;
    const frag = [];
    for (let i = a; i < b; i++) {
      const r = this.view[i];
      const style = { top: `${i * this.rowH}px`, ...(this.rowStyle?.(r) || {}) };
      frag.push(h('div', { class: `rv-tr${i === this.sel ? ' sel' : ''}`, role: 'row', style, dataset: { i },
        onclick: () => this.select(i, true), ondblclick: () => this.onOpen?.(r),
        oncontextmenu: (e) => { e.preventDefault(); this.select(i, false); this.onContext?.(r, e.clientX, e.clientY); } },
      this.cols.map((c) => { const v = c.render(r); return h('div', { class: `rv-td${c.cls ? ` ${c.cls}` : ''}`, role: 'gridcell', title: c.tip ? c.tip(r) : typeof v === 'string' ? v : null }, v); })));
    }
    clear(this.body, frag);
  }
  select(i, user) {
    if (i < 0 || i >= this.view.length) return;
    this.sel = i;
    this.paint(true);
    const top = i * this.rowH; const st = this.el.scrollTop; const vis = this.el.clientHeight - this.rowH - 30;
    if (top < st) this.el.scrollTop = top; else if (top > st + vis) this.el.scrollTop = top - vis;
    this.onSelect?.(this.view[i], user);
  }
  selected() { return this.view[this.sel] || null; }
  key(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); this.select(Math.max(0, this.sel + (e.key === 'ArrowDown' ? 1 : -1)), true); }
    if (e.key === 'Enter' && this.sel >= 0) this.onOpen?.(this.view[this.sel]);
  }
}

// --- dialogs ------------------------------------------------------------------------------------------------------
function dialog(title, body, { ok = 'Save', cancel = 'Cancel', onOk, wide = false, extra = null } = {}) {
  return new Promise((resolve) => {
    const err = h('div', { class: 'rv-error small' });
    const okBtn = ok ? h('button', { class: 'btn btn-primary', type: 'submit' }, ok) : null;
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(null); } };
    const close = (v) => { document.removeEventListener('keydown', onKey, true); overlay.remove(); resolve(v); };
    const form = h('form', { class: `dialog rv-dialog${wide ? ' rv-wide' : ''}`, onsubmit: async (e) => {
      e.preventDefault();
      if (!onOk) return close(true);
      okBtn.disabled = true;
      try { err.textContent = ''; const v = await onOk(); if (v !== undefined && v !== false) close(v); } catch (ex) { err.textContent = ex.message; } finally { okBtn.disabled = false; }
    } }, h('h3', {}, title), h('div', { class: 'rv-dialog-body' }, body), err,
    h('div', { class: 'dialog-actions' }, extra ? extra(close) : null, h('span', { class: 'rv-gap' }), cancel ? h('button', { class: 'btn', type: 'button', onclick: () => close(null) }, cancel) : null, okBtn));
    const overlay = h('div', { class: 'dialog-overlay', onclick: (e) => { if (e.target === overlay) close(null); } }, form);
    document.addEventListener('keydown', onKey, true);
    document.body.append(overlay);
    (form.querySelector('input:not([disabled]), select:not([disabled]), textarea:not([disabled])') || okBtn || form.querySelector('button'))?.focus();
  });
}
const selectOf = (options, value, attrs = {}) => h('select', { class: 'input', ...attrs }, options.map(([v, l]) => h('option', { value: String(v), selected: String(v) === String(value) }, l)));
const field = (label, input, help) => h('label', { class: 'field rv-field' }, h('span', {}, label), input, help ? h('span', { class: 'small muted' }, help) : null);
const check = (label, on, attrs = {}) => { const c = h('input', { type: 'checkbox', checked: !!on, ...attrs }); return [c, h('label', { class: 'pref-row rv-check' }, c, h('span', {}, label))]; };
const pathInput = (value, placeholder, disabled) => h('input', { class: 'input', value: value || '', placeholder, spellcheck: 'false', disabled });

// Pick a folder on the MediaDesk server (the browser can't see the server's disks, so the server lists them).
async function folderPicker(start, title) {
  let cur = '';
  const where = h('input', { class: 'input', spellcheck: 'false', placeholder: 'Type a path, or pick below', onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); go(where.value.trim()); } } });
  const upBtn = h('button', { class: 'btn btn-sm', type: 'button', onclick: () => go(upTo) }, h('span', { html: I.chevUp }), 'Up');
  const list = h('div', { class: 'rv-picker-list', role: 'listbox' });
  const msg = h('div', { class: 'small muted rv-picker-msg' });
  let upTo = null;
  async function go(p) {
    msg.textContent = '';
    let r;
    try { r = await call('browse', { params: { path: p } }); } catch (err) { msg.textContent = err.message; return false; }
    cur = r.path; upTo = r.parent; where.value = r.path;
    upBtn.disabled = r.parent == null;
    clear(list, r.dirs.length ? r.dirs.map((d) => h('button', { class: 'rv-picker-item', type: 'button', role: 'option', onclick: () => go(r.full ? d : joinPath(r.path, d)) }, h('span', { html: I.folder }), d))
      : h('div', { class: 'small muted rv-picker-empty' }, r.path ? 'No folders in here. Use this one, or type a new folder name at the end of the path: it’s created when you save.' : 'No drives found.'));
    return true;
  }
  const startAt = String(start || '').trim();
  if (!startAt || !(await go(startAt))) {
    const parent = startAt.replace(/[\\/]+$/, '').replace(/[\\/][^\\/]*$/, '');
    if (!parent || !(await go(parent))) await go('');
    if (startAt) where.value = startAt;
  }
  return dialog(title, [h('div', { class: 'rv-picker-bar' }, upBtn, where), list, msg], {
    ok: 'Use this folder', wide: true,
    onOk: () => { const v = where.value.trim(); if (!v) throw new Error('Pick a folder first.'); return v; },
  });
}
const joinPath = (a, b) => (/[\\/]$/.test(a) ? a + b : `${a}${a.includes('\\') ? '\\' : '/'}${b}`);

// The main settings (RomVault Settings): used by the app's ⚙ and by Settings → ROM Manager.
function settingsForm(s, { can, mock, setup = false }) {
  const dat = pathInput(s.DatRoot, 'For example D:\\ROMs\\DATs', !can || mock);
  const rom = pathInput(s.RomRoot, 'For example D:\\ROMs\\RomRoot', !can || mock);
  const ts = pathInput((s.toSort.find((t) => t.primary) || s.toSort[0])?.path, 'For example D:\\ROMs\\ToSort', !can || mock);
  const fixd = pathInput(s.FixDatOutPath, 'Optional, for example D:\\ROMs\\FixDATs', !can);
  const level = selectOf(FIX_LEVEL.map((l, i) => [i, l]), s.FixLevel, { disabled: !can });
  const sevenz = selectOf(SEVENZ_DEFAULT.map((l, i) => [i, l]), s.sevenZDefaultStruct, { disabled: !can });
  const ignore = h('textarea', { class: 'input rv-textarea', rows: 4, spellcheck: 'false', disabled: !can }, (s.IgnoreFiles || []).join('\n'));
  const [dbl, dblRow] = check('Double check file exists elsewhere before deleting', s.DoubleCheckDelete, { disabled: !can });
  const [det, detRow] = check('Show detailed actions in the fix list', s.DetailedFixReporting, { disabled: !can });
  const [cue, cueRow] = check('Delete previous Cue file zips in ToSort', s.DeleteOldCueFiles, { disabled: !can });
  const [tim, timRow] = check('Save the cache while fixing, every', s.CacheSaveTimerEnabled, { disabled: !can });
  const mins = h('input', { class: 'input rv-mins', type: 'number', min: 1, max: 600, value: s.CacheSaveTimePeriod, disabled: !can });
  timRow.append(mins, h('span', {}, 'minutes'));
  const browse = (input, title) => (can && !mock ? h('div', { class: 'rv-path' }, input, h('button', { class: 'btn', type: 'button', onclick: async () => { const v = await folderPicker(input.value, title); if (v) input.value = v; } }, h('span', { html: I.folder }), 'Browse…')) : input);
  const more = [
    h('div', { class: 'rv-group' }, h('div', { class: 'rv-group-title' }, 'Core settings'),
      field('Fixing level', level, 'Level 1 copies a file straight from another archive when the CRC matches; level 2 does that only once it has been hashed with SHA1; level 3 always unpacks, checks and packs again.'),
      dblRow, detRow, cueRow, timRow,
      field('Files not to remove', ignore, 'One rule per line. * and ? work as wildcards; regex rules start with regex:, and rules that also skip scanning start with ignore:.')),
    h('div', { class: 'rv-group' }, h('div', { class: 'rv-group-title' }, 'Compression'),
      field('Default 7z type', sevenz, 'Used for 7z sets whose rule doesn’t pick one. (RomVault’s ZSTD 7z needs a 7-Zip with ZSTD, so it isn’t offered here.)'),
      h('p', { class: 'small muted' }, `7-Zip on the server: ${s.sevenZip ? 'found, so 7z archives can be read and made.' : 'not found, so 7z archives are skipped. Install 7-Zip (Settings → Files shows how).'}`)),
  ];
  const step = (n, label) => (setup ? h('span', { class: 'rv-step' }, h('b', { class: 'rv-step-n' }, String(n)), label) : label);
  const body = [
    mock ? h('div', { class: 'notice small' }, 'Demo mode: the folders hold a small made-up collection and can’t be changed. Everything else can be tried.') : null,
    !can ? h('div', { class: 'notice small' }, 'Only a parent or an admin can change these.') : null,
    h('div', { class: 'rv-group' }, h('div', { class: 'rv-group-title' }, 'Folders'),
      h('p', { class: 'small muted' }, 'Folders on the computer running MediaDesk. Any that don’t exist yet are created.'),
      field(step(1, 'DAT folder (DATRoot)'), browse(dat, 'Choose the DAT folder'), 'Where your DAT files are: the lists of every game and ROM, from No-Intro, Redump, TOSEC or MAME. Each sub-folder becomes a folder in the tree.'),
      field(step(2, 'ROM folder (RomRoot)'), browse(rom, 'Choose the ROM folder'), 'Where your collection lives. ROM Manager keeps it organised to match the DATs, with a folder for each folder in the tree.'),
      field(step(3, 'ToSort folder'), browse(ts, 'Choose the ToSort folder'), 'Put new or unsorted files here and ROM Manager files them where they belong. Files no DAT needs are moved here, not deleted.'),
      setup ? null : field('Fix DAT folder', browse(fixd, 'Choose the fix DAT folder'), 'Where “Save fix DATs to the folder” writes the lists of what’s missing.')),
    ...(setup ? [h('details', { class: 'rv-more' }, h('summary', {}, 'More settings (you can change these later)'), field('Fix DAT folder', browse(fixd, 'Choose the fix DAT folder'), 'Where “Save fix DATs to the folder” writes the lists of what’s missing.'), ...more)] : more),
  ];
  const read = () => {
    const b = { FixLevel: Number(level.value), DoubleCheckDelete: dbl.checked, DetailedFixReporting: det.checked, DeleteOldCueFiles: cue.checked, CacheSaveTimerEnabled: tim.checked,
      CacheSaveTimePeriod: Number(mins.value) || 10, sevenZDefaultStruct: Number(sevenz.value), FixDatOutPath: fixd.value, IgnoreFiles: ignore.value.split(/\r?\n/) };
    if (!mock) Object.assign(b, { DatRoot: dat.value, RomRoot: rom.value, ToSort: ts.value });
    return b;
  };
  return { body, read };
}

class RomManager {
  constructor(win) {
    this.win = win;
    this.st = null; this.tree = []; this.selId = readLs('mediadesk.roms.sel', 'RomVault');
    this.show = readLs('mediadesk.roms.show', null);
    this.q = ''; this.game = null; this.job = null; this.lastJobId = null;
    loadCss();
    const tb = (label, ic, fn, title, caret) => h('button', { class: 'btn rv-tool', title: title || label, onclick: fn }, h('span', { html: ic }), h('span', { class: 'rv-tool-label' }, label), caret ? h('span', { class: 'rv-caret', html: I.caret }) : null);
    this.menuBtn = h('button', { class: 'btn btn-icon rv-menu-btn', title: 'DAT tree', 'aria-label': 'Show the DAT tree', html: icon.menu, onclick: () => this.drawer(true) });
    this.tools = {
      dats: tb('Update DATs', I.dats, (e) => this.datsMenu(e), 'Step 1: read new and changed DAT files from your DAT folder', true),
      scan: tb('Scan ROMs', I.scan, (e) => this.scanMenu(e), 'Step 2: look at the files in the ticked folders and your ToSort folder', true),
      find: tb('Find Fixes', I.find, () => this.run('findFixes'), 'Step 3: work out which files can be renamed, moved or rebuilt to fill in your sets'),
      fix: tb('Fix ROMs', I.fix, (e) => this.fixMenu(e), 'Step 4: make the changes Find Fixes worked out, in the ticked folders', true),
      reports: tb('Reports', I.report, (e) => this.reportsMenu(e), 'Fix DATs and reports', true),
    };
    this.keyBtn = h('button', { class: 'btn btn-icon', title: 'Colour key', 'aria-label': 'Colour key', html: I.key, onclick: () => this.colourKey() });
    this.helpBtn = h('button', { class: 'btn btn-icon', title: 'How ROM Manager works', 'aria-label': 'How ROM Manager works', html: I.help, onclick: () => this.help() });
    this.gearBtn = h('button', { class: 'btn btn-icon', title: 'Settings', 'aria-label': 'Settings', html: I.gear, onclick: (e) => this.settingsMenu(e) });
    this.toolbar = h('div', { class: 'rv-toolbar' }, this.menuBtn, ...Object.values(this.tools), h('span', { class: 'rv-gap' }), this.helpBtn, this.keyBtn, this.gearBtn);

    // Left: tree and pre-sets
    this.treeBox = h('div', { class: 'rv-tree', role: 'tree' });
    this.presets = h('div', { class: 'rv-presets' }, h('span', { class: 'small muted' }, 'Tree pre-sets'),
      [1, 2, 3, 4].map((n) => h('button', { class: 'btn btn-sm rv-preset', title: `Click: load pre-set ${n}. Right-click or long-press: save the ticks you have now as pre-set ${n}.`,
        onclick: () => this.preset(n, false), oncontextmenu: (e) => { e.preventDefault(); this.preset(n, true); } }, String(n))));
    this.side = h('aside', { class: 'rv-side', onkeydown: (e) => { if (e.key === 'Escape' && this.drawerOpen) { e.stopPropagation(); this.drawer(false); } } },
      h('div', { class: 'rv-side-head' }, h('span', {}, 'DATs'), h('button', { class: 'btn btn-icon btn-sm', 'aria-label': 'Close', html: icon.x, onclick: () => this.drawer(false) })),
      this.treeBox, this.presets);
    this.shade = h('div', { class: 'rv-shade', onclick: () => this.drawer(false) });

    // Right: DAT info, filters, games, ROMs
    this.guide = h('div', { class: 'rv-guide', hidden: true });
    this.info = h('div', { class: 'rv-info' });
    this.folders = h('div', { class: 'rv-folders' });
    this.filterBox = h('div', { class: 'rv-filters' });
    this.games = new VTable({
      cols: this.gameCols(false), empty: 'No sets to show here. Pick a DAT in the tree, or change the filters.',
      rowStyle: (r) => (r.st != null ? { '--c': COLOR[RS[r.st]] } : null),
      onSelect: (r) => this.pickGame(r), onOpen: (r) => this.pickGame(r, true), onContext: (r, x, y) => this.gameMenu(r, x, y),
    });
    this.romTitle = h('div', { class: 'rv-rom-title' });
    this.romsT = new VTable({ cols: this.romCols({}), empty: 'Pick a set to see its files.', rowStyle: (r) => ({ '--c': COLOR[RS[r.st]] }), onContext: (r, x, y) => this.romMenu(r, x, y) });
    this.romPane = h('div', { class: 'rv-roms' },
      h('div', { class: 'rv-pane-head' }, h('button', { class: 'btn btn-sm rv-back', html: `${I.back}<span>Sets</span>`, onclick: () => this.root.classList.remove('rv-show-roms') }), this.romTitle),
      this.romsT.el);
    this.gamePane = h('div', { class: 'rv-games' }, this.gamesT = this.games.el, this.folders);
    this.main = h('div', { class: 'rv-main' }, this.guide, this.info, this.filterBox, h('div', { class: 'rv-split' }, this.gamePane, h('div', { class: 'rv-splitter', title: 'Drag to resize', onpointerdown: (e) => this.dragSplit(e) }), this.romPane));
    this.jobBox = h('div', { class: 'rv-job', hidden: true });
    this.root = h('div', { class: 'rv-app' }, this.toolbar, h('div', { class: 'rv-body' }, this.side, this.shade, this.main), this.jobBox);
    win.body.append(this.root);
    const split = readLs('mediadesk.roms.split', 55);
    this.root.style.setProperty('--split', `${split}%`);
    this.ro = new ResizeObserver(() => {
      const narrow = this.root.clientWidth < 760;
      if (narrow !== this.narrow) {
        this.narrow = narrow;
        this.root.classList.toggle('rv-narrow', narrow);
        if (!narrow) { this.drawer(false); this.root.classList.remove('rv-show-roms'); }
        this.games.setRowH(narrow ? 34 : 26); this.romsT.setRowH(narrow ? 34 : 26);
        this.games.setCols(this.gameCols(this.showDesc));
      }
    });
    this.ro.observe(this.root);
    win.on?.('close', () => { clearTimeout(this.pollT); this.closed = true; });
    this.load();
  }

  // --- loading ------------------------------------------------------------------------------------------------
  async load() {
    try { this.st = await call('status'); } catch (err) { this.showOver(errorState(err, () => this.load())); return; }
    this.showOver(null);
    const s = this.st;
    this.can = s.canChange;
    if (!this.show) this.show = s.settings.show;
    Object.values(this.tools).forEach((b) => { b.disabled = !s.configured || (!this.can && b !== this.tools.reports); });
    this.renderFilters();
    this.setJob(s.job);
    if (!s.configured) { this.guide.hidden = true; this.renderSetup(); return; }
    this.renderGuide();
    await this.loadTree();
    await this.select(this.selId, { quiet: true });
  }
  async loadTree() {
    try { const t = await call('tree'); this.tree = t.tree; } catch (err) { clear(this.treeBox, errorState(err, () => this.loadTree())); return; }
    this.renderTree();
  }
  findNode(id, list = this.tree) {
    for (const n of list) { if (n.id === id) return n; const k = n.kids && this.findNode(id, n.kids); if (k) return k; }
    return null;
  }

  renderSetup() {
    this.root.classList.add('rv-setup');
    const s = this.st.settings;
    const f = settingsForm(s, { can: this.can, mock: this.st.mock, setup: true });
    const save = h('button', { class: 'btn btn-primary', disabled: !this.can }, h('span', { html: icon.check }), 'Save and continue');
    save.onclick = async () => {
      save.disabled = true;
      try { await call('settings', { method: 'POST', body: f.read() }); this.root.classList.remove('rv-setup'); toast('ROM Manager is set up', { body: 'The bar at the top shows what to do next.', type: 'success', icon: appIcon.roms }); await this.load(); } catch (err) { toastError(err, 'Not saved'); } finally { save.disabled = !this.can; }
    };
    clear(this.treeBox, h('div', { class: 'rv-tree-empty small muted' }, 'Your DATs show here once the folders are chosen.'));
    this.showOver(h('div', { class: 'rv-setup-box' },
      h('div', { class: 'rv-setup-head' }, h('span', { class: 'rv-setup-icon', html: appIcon.roms }), h('div', {}, h('h2', {}, 'Set up ROM Manager'),
        h('p', { class: 'muted' }, 'ROM Manager checks your ROMs against DAT files, the lists of every game and ROM from No-Intro, Redump, TOSEC or MAME. Then it fixes what it can: renaming files, rebuilding zips and filing new files where they belong. It uses RomVault’s engine.'),
        h('p', { class: 'muted' }, 'To start, choose three folders on the MediaDesk server.'))),
      f.body, h('div', { class: 'btn-row' }, save)));
  }

  // The setup page and load errors cover the right-hand side without replacing it.
  showOver(el) {
    this.over?.remove();
    this.over = el ? h('div', { class: 'rv-over' }, el) : null;
    if (this.over) this.main.parentElement.append(this.over); else this.root.classList.remove('rv-setup');
  }

  // --- tree (UITree) ---------------------------------------------------------------------------------------------
  renderTree() {
    const rows = [];
    const add = (n, depth, top) => {
      const tickCls = ['rv-tick-off', 'rv-tick-on', 'rv-tick-lock'][n.ck];
      const tickTitle = ['Not ticked: left out of scans and fixes', 'Ticked: scanned and fixed', 'Locked: scanned, never changed'][n.ck];
      const sub = n.tosort ? `(Files: ${num(n.files)})` : `( Have: ${num(n.have)} \\ Missing: ${num(n.missing)} )`;
      const name = top && n.tosort ? n.name.split(/[\\/]/).filter(Boolean).pop() || n.name : n.name;
      const el = h('div', { class: `rv-node${this.selId === n.id ? ' sel' : ''}`, role: 'treeitem', tabindex: '0', 'aria-expanded': n.kids ? String(n.ex) : null, style: { '--depth': depth }, dataset: { id: n.id },
        onclick: () => { this.select(n.id); if (this.narrow) this.drawer(false); },
        onkeydown: (e) => {
          if (e.key === 'Enter') { e.preventDefault(); el.click(); }
          if (e.key === ' ') { e.preventDefault(); this.tick(n, e); }
          if (e.key === 'ArrowRight' && n.kids && !n.ex) this.expand(n, true);
          if (e.key === 'ArrowLeft' && n.ex && n.kids) this.expand(n, false);
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const all = [...this.treeBox.querySelectorAll('.rv-node')]; all[all.indexOf(el) + (e.key === 'ArrowDown' ? 1 : -1)]?.focus(); }
        },
        oncontextmenu: (e) => { e.preventDefault(); this.treeMenu(n, e.clientX, e.clientY); } },
      n.kids ? h('button', { class: `rv-twist${n.ex ? ' open' : ''}`, tabindex: '-1', 'aria-label': n.ex ? 'Collapse' : 'Expand', title: 'Click: open or close. Right-click: open or close the folders inside.',
        onclick: (e) => { e.stopPropagation(); this.expand(n, !n.ex); }, oncontextmenu: (e) => { e.preventDefault(); e.stopPropagation(); this.expand(n, null, true); } }, n.ex ? '−' : '+') : h('span', { class: 'rv-twist-space' }),
      h('button', { class: `rv-tick ${tickCls}`, tabindex: '-1', title: `${tickTitle}. Click to tick or untick (Shift: this folder only). Right-click to lock.`, 'aria-label': tickTitle, disabled: !this.can,
        onclick: (e) => { e.stopPropagation(); this.tick(n, e); }, oncontextmenu: (e) => { e.preventDefault(); e.stopPropagation(); this.tick(n, e, true); } }),
      h('span', { class: 'rv-node-icon', html: treeIconSvg(n.icon) }),
      h('span', { class: 'rv-node-name', title: `${n.name}${n.role ? ` (${n.role})` : ''}` }, name, n.role ? h('b', { class: 'rv-role' }, ` (${n.role})`) : null, ' ', h('span', { class: 'rv-node-sub' }, sub)));
      rows.push(el);
      if (n.dats && n.ex) for (const d of n.dats) rows.push(h('div', { class: 'rv-node-dat small muted', style: { '--depth': depth + 1 } }, d));
      if (n.ex && n.kids) for (const k of n.kids) add(k, depth + 1, false);
    };
    for (const n of this.tree) add(n, 0, true);
    clear(this.treeBox, rows);
  }
  async tick(n, e, lock = false) {
    if (!this.can) return;
    if (this.busy()) { toast('Wait for the job to finish', { type: 'info' }); return; }
    const value = lock ? TICK.Locked : n.ck === TICK.Selected ? TICK.UnSelected : TICK.Selected;
    try { const r = await call('check', { method: 'POST', body: { id: n.id, value, shift: !!e?.shiftKey } }); this.tree = r.tree; this.renderTree(); } catch (err) { toastError(err, 'Not changed'); }
  }
  async expand(n, value, children = false) {
    if (children) { if (n.kids?.length) { const v = !n.kids[0].ex; for (const k of n.kids) if (k.kids) k.ex = v; if (!n.ex) n.ex = true; } } else n.ex = value;
    this.renderTree();
    if (this.can) call('expand', { method: 'POST', body: { id: n.id, value: n.ex, children } }).catch(() => {});
  }
  async preset(n, save) {
    if (!this.can) return;
    try {
      if (save && !(await confirmDialog({ title: `Save tree pre-set ${n}?`, message: `Pre-set ${n} will remember which folders are ticked and open now.`, confirm: 'Save' }))) return;
      const r = await call('preset', { method: 'POST', body: { n, save } });
      this.tree = r.tree; this.renderTree();
      toast(save ? `Saved as pre-set ${n}` : `Pre-set ${n} loaded`, { type: 'success', timeout: 2000 });
    } catch (err) { toastError(err, 'Pre-set'); }
  }
  drawer(on) {
    if (!this.narrow && on) return;
    this.drawerOpen = on;
    this.root.classList.toggle('rv-drawer-open', on);
    if (on) this.side.querySelector('.rv-node.sel, .rv-node')?.focus({ preventScroll: true });
  }

  // --- selecting a folder: DAT info and games (UIDatInfo, UIGameGrid) ----------------------------------------------
  async select(id, { quiet = false, keepGame = false } = {}) {
    if (!this.findNode(id)) id = this.tree[0]?.id || 'RomVault';
    if (this.selId !== id) keepGame = false;
    this.selId = id;
    writeLs('mediadesk.roms.sel', id);
    // Open the folders above it.
    let opened = false;
    const openTo = (list, trail) => { for (const n of list) { if (n.id === id) { for (const t of trail) if (!t.ex) { t.ex = true; opened = true; } return true; } if (n.kids && openTo(n.kids, [...trail, n])) return true; } return false; };
    openTo(this.tree, []);
    this.renderTree();
    if (opened && !quiet) this.treeBox.querySelector('.rv-node.sel')?.scrollIntoView({ block: 'nearest' });
    if (!keepGame) { this.game = null; this.root.classList.remove('rv-show-roms'); }
    await this.loadGames({ keepGame });
  }
  async loadGames({ keepGame = false } = {}) {
    const id = this.selId;
    let r;
    try { r = await call('games', { params: { id, q: this.q, show: JSON.stringify(this.show) } }); } catch (err) { clear(this.info, errorState(err, () => this.loadGames())); return; }
    if (id !== this.selId) return;
    this.renderInfo(r.info);
    this.showDesc = r.showDescription;
    this.games.setCols(this.gameCols(r.showDescription));
    this.looseFiles = r.looseFiles;
    this.games.setRows(r.games, { keep: keepGame ? (g) => g?.n : null });
    this.renderFolders(!r.games.length && !this.q ? this.findNode(id) : null);
    const sel = this.games.selected();
    if (keepGame && sel) this.loadRoms(sel.n, true);
    else { this.game = null; this.loadRoms(null); }
  }
  renderInfo(i) {
    // Empty rows are left out (the top folder has no DAT details); on phones only name, description and path show.
    const row = (l, v, extra) => (v ? h('div', { class: `rv-info-row${extra ? ' rv-info-extra' : ''}` }, h('span', { class: 'rv-info-l' }, l), h('span', { class: 'rv-info-v', title: v }, v)) : null);
    const stat = (l, v, st) => h('div', { class: 'rv-stat', style: { '--c': COLOR[st] } }, h('b', {}, num(v)), h('span', {}, l));
    clear(this.info,
      h('div', { class: 'rv-info-grid' }, row('Name', i.name), row('Description', i.description), row('Category', i.category, true), row('Version', i.version, true), row('Author', i.author, true), row('Date', i.date, true), row('ROM Path', i.path)),
      h('div', { class: 'rv-stats' }, stat('ROMs you have', i.have, 'Correct'), stat('ROMs missing', i.missing, 'Missing'), stat('Fixes ready', i.fixes, 'CanBeFixed'), stat('Files no DAT needs', i.unknown, 'Unknown')));
  }
  renderFilters() {
    const f = this.show || {};
    const box = (k, l) => h('label', { class: 'rv-filter' }, h('input', { type: 'checkbox', checked: !!f[k], onchange: (e) => { this.show = { ...this.show, [k]: e.target.checked }; writeLs('mediadesk.roms.show', this.show); this.loadGames({ keepGame: true }); } }), l);
    const search = h('input', { class: 'input input-sm rv-search', type: 'search', placeholder: 'Filter sets', value: this.q, oninput: debounce((e) => { this.q = e.target.value.trim(); this.loadGames({ keepGame: true }); }, 250) });
    clear(this.filterBox, box('complete', 'Show Complete'), box('partial', 'Show Partial'), box('empty', 'Show Empty'), box('fixes', 'Show Fixes'), box('merged', 'Show Merged'), search);
  }
  gameCols(showDesc) {
    const statusCell = (r) => h('span', { class: 'rv-counts' }, r.c.map(([st, n]) => h('span', { class: 'rv-count', title: `${LABEL[RS[st]] || RS[st]}: ${num(n)}` }, swatch(st), num(n))));
    return [
      { key: 'type', label: 'Type', w: this.narrow ? '56px' : '78px', render: typeBadge, sortKey: (r) => r.gt || r.dt || '' },
      { key: 'name', label: 'Game', w: this.narrow ? 'minmax(150px, 1fr)' : showDesc ? 'minmax(160px, 1.1fr)' : 'minmax(200px, 2fr)', min: this.narrow ? 150 : 180, render: (r) => (this.narrow && showDesc && r.d ? h('span', { class: 'rv-two' }, h('span', {}, r.n), h('span', { class: 'small muted' }, r.d)) : r.fn ? `${r.n} (Found: ${r.fn})` : r.n), tip: (r) => [r.n, r.fn ? `Found: ${r.fn}` : null, r.d].filter(Boolean).join('\n'), sortKey: (r) => r.n.toLowerCase() },
      { key: 'desc', label: 'Description', w: 'minmax(160px, 1.3fr)', min: 160, hidden: !showDesc || this.narrow, render: (r) => r.d || '', sortKey: (r) => (r.d || '').toLowerCase() },
      { key: 'status', label: 'ROM Status', w: this.narrow ? 'minmax(110px, auto)' : 'minmax(150px, 1fr)', min: this.narrow ? 110 : 150, render: statusCell, tip: (r) => r.c.map(([st, n]) => `${LABEL[RS[st]] || RS[st]}: ${n}`).join('\n'), sortKey: (r) => (r.st == null ? 99 : DISPLAY_ORDER.indexOf(RS[r.st])) },
    ];
  }
  romCols(show) {
    const fl = (v, f) => (v == null || v === '' ? '' : f ? `${v} (${f})` : String(v));
    return [
      { key: 'got', label: 'Got', w: '118px', render: (r) => statusChip(r.st), tip: (r) => `${LABEL[RS[r.st]] || RS[r.st]} · ${DS[r.ds] || ''}`, sortKey: (r) => DISPLAY_ORDER.indexOf(RS[r.st]) },
      { key: 'rom', label: 'ROM', w: 'minmax(200px, 2fr)', min: 200, render: (r) => `${r.n}${r.fn ? ` (Found: ${r.fn})` : ''}${r.chd != null ? ` (V${r.chd})` : ''}${r.hdr ? ` (${r.hdr})` : ''}`, sortKey: (r) => r.n.toLowerCase() },
      { key: 'merge', label: 'Merge', w: '120px', hidden: !show.merge, render: (r) => r.mg || '', sortKey: (r) => r.mg || '' },
      { key: 'size', label: 'Size', w: '110px', cls: 'rv-num', render: (r) => fl(r.sz != null ? num(r.sz) : '', r.fl?.sz), sortKey: (r) => r.sz ?? -1 },
      { key: 'crc', label: 'CRC32', w: '112px', cls: 'rv-mono', render: (r) => fl(r.crc, r.fl?.crc), sortKey: (r) => r.crc || '' },
      { key: 'sha1', label: 'SHA1', w: '330px', cls: 'rv-mono', render: (r) => fl(r.sha1, r.fl?.sha1), sortKey: (r) => r.sha1 || '' },
      { key: 'md5', label: 'MD5', w: '270px', cls: 'rv-mono', render: (r) => fl(r.md5, r.fl?.md5), sortKey: (r) => r.md5 || '' },
      { key: 'asize', label: 'Alt Size', w: '90px', cls: 'rv-num', hidden: !show.alt, render: (r) => (r.asz != null ? num(r.asz) : ''), sortKey: (r) => r.asz ?? -1 },
      { key: 'acrc', label: 'Alt CRC32', w: '90px', cls: 'rv-mono', hidden: !show.alt, render: (r) => r.acrc || '', sortKey: (r) => r.acrc || '' },
      { key: 'asha1', label: 'Alt SHA1', w: '310px', cls: 'rv-mono', hidden: !show.alt, render: (r) => r.asha1 || '', sortKey: (r) => r.asha1 || '' },
      { key: 'amd5', label: 'Alt MD5', w: '250px', cls: 'rv-mono', hidden: !show.alt, render: (r) => r.amd5 || '', sortKey: (r) => r.amd5 || '' },
      { key: 'status', label: 'Status', w: '90px', hidden: !show.status, render: (r) => r.status || '', sortKey: (r) => r.status || '' },
      { key: 'mt', label: 'Modified', w: '150px', hidden: !show.mt, render: (r) => (r.mt ? new Date(r.mt).toLocaleString() : ''), sortKey: (r) => r.mt || 0 },
      { key: 'zi', label: 'ZipIndex', w: '72px', cls: 'rv-num', render: (r) => (r.zi ?? ''), sortKey: (r) => r.zi ?? -1 },
      { key: 'dup', label: 'Dup Count', w: '80px', cls: 'rv-num', render: (r) => (r.dup ?? ''), sortKey: (r) => r.dup ?? -1 },
    ];
  }
  pickGame(r, open) {
    this.game = r.n;
    this.loadRoms(r.n, true);
    if (this.narrow && open !== false) this.root.classList.add('rv-show-roms');
  }
  async loadRoms(game, keep) {
    const id = this.selId;
    if (game == null && !this.looseFilesAt(id)) { clear(this.romTitle, h('span', { class: 'muted small' }, 'Files')); this.romsT.setRows([]); return; }
    let r;
    try { r = await call('roms', { params: { id, game: game ?? undefined, merged: this.show?.merged ? '1' : '0' } }); } catch (err) { toastError(err, 'Could not load the files'); return; }
    if (id !== this.selId || game !== (this.game ?? null)) return;
    const show = { merge: r.roms.some((x) => x.mg), alt: r.roms.some((x) => x.asz != null || x.acrc || x.asha1 || x.amd5), status: r.roms.some((x) => x.status), mt: r.roms.some((x) => x.mt) };
    this.romsT.setCols(this.romCols(show));
    this.romsT.setRows(r.roms, { keep: keep ? (x) => x?.n : null });
    const meta = [r.info.Description && r.info.Description !== '¤' ? r.info.Description : null, r.info.Year, r.info.Manufacturer, r.info.CloneOf ? `clone of ${r.info.CloneOf}` : null, r.info.RomOf && r.info.RomOf !== r.info.CloneOf ? `ROMs of ${r.info.RomOf}` : null].filter(Boolean).join(' · ');
    clear(this.romTitle, h('b', { title: r.info.path }, game ?? 'Loose files'), meta ? h('span', { class: 'small muted' }, ` ${meta}`) : null, r.info.type ? h('span', { class: 'rv-tb', title: TYPE[r.info.type]?.[1] }, TYPE[r.info.type]?.[0] || r.info.type) : null);
  }
  looseFilesAt() { return this.looseFiles > 0; }

  // --- menus -----------------------------------------------------------------------------------------------------
  pos(e) { const r = e.currentTarget.getBoundingClientRect(); return [r.left, r.bottom + 4]; }
  datsMenu(e) {
    const [x, y] = this.pos(e);
    contextMenu(x, y, [
      { label: 'Update New DATs', icon: I.dats, action: () => this.run('updateDats') },
      { label: 'Refresh All DATs', icon: icon.refresh, action: () => this.run('refreshDats') },
    ]);
  }
  scanMenu(e, id) {
    const [x, y] = e.clientX && id ? [e.clientX, e.clientY] : this.pos(e);
    contextMenu(x, y, [
      { label: 'Scan ticked new ROMs with full hash check', icon: I.scan, action: () => this.run('scan', { level: 1, id }) },
      { label: 'Scan ticked new ROMs headers only', action: () => this.run('scan', { level: 0, id }) },
      { label: 'ReScan all ticked ROMs with full hash check', action: () => this.run('scan', { level: 2, id }) },
    ]);
  }
  fixMenu(e) {
    const [x, y] = this.pos(e);
    contextMenu(x, y, [
      { label: 'Fix ROMs', icon: I.fix, action: () => this.run('fix') },
      { label: 'Scan, Find Fixes and Fix', icon: I.find, action: () => this.run('auto') },
      { label: 'Update DATs, Scan, Find Fixes and Fix', icon: I.bolt, action: () => this.run('all') },
      '-',
      { label: 'Last fix list', action: () => this.fixLog() },
    ]);
  }
  reportsMenu(e) {
    const [x, y] = this.pos(e);
    const fixd = this.st?.settings?.FixDatOutPath;
    contextMenu(x, y, [
      { label: 'Fix DATs (missing only)', icon: icon.download, action: () => download('fixdat', { red: '1' }) },
      { label: 'Fix DATs (missing and fixable)', icon: icon.download, action: () => download('fixdat', { red: '0' }) },
      { label: fixd ? 'Save fix DATs to the fix DAT folder' : 'Save fix DATs to the folder (choose it in Settings)', disabled: !fixd || !this.can, action: () => this.saveFixDats('') },
      '-',
      { label: 'Full Report', icon: I.report, action: () => this.report('full') },
      { label: 'Fix Report', action: () => this.report('fix') },
      { label: 'Last fix list', action: () => this.fixLog() },
    ]);
  }
  settingsMenu(e) {
    const [x, y] = this.pos(e);
    contextMenu(x, y, [
      { label: 'ROM Manager Settings', icon: I.gear, action: () => this.settingsDialog() },
      { label: 'Directory Dat Rules', disabled: !this.can, action: () => this.ruleDialog(this.ruleKeyFor(this.selId)) },
      { label: 'Directory Mappings', disabled: !this.can || this.st?.mock, action: () => this.mappingDialog(this.ruleKeyFor(this.selId)) },
      { label: 'Add ToSort', disabled: !this.can || this.st?.mock, action: () => this.addToSort() },
      '-',
      { label: 'How ROM Manager works', icon: I.help, action: () => this.help() },
      { label: 'Colour key', icon: I.key, action: () => this.colourKey() },
      { label: 'About ROM Manager', action: () => this.about() },
    ]);
  }
  ruleKeyFor(id) { return id && id.startsWith('RomVault') ? id : 'RomVault'; }
  treeMenu(n, x, y) {
    const st = this.st?.settings;
    const ts = st?.toSort?.find((t) => t.path === n.id);
    const items = [
      { label: 'Scan', icon: I.scan, disabled: !this.can, action: () => this.run('scan', { level: 1, id: n.id }) },
      { label: 'Scan Quick (Headers Only)', disabled: !this.can, action: () => this.run('scan', { level: 0, id: n.id }) },
      { label: 'Scan Full (Complete Re-Scan)', disabled: !this.can, action: () => this.run('scan', { level: 2, id: n.id }) },
    ];
    if (ts) {
      const i = st.toSort.indexOf(ts);
      items.push('-',
        { label: 'Set To Primary ToSort', checked: ts.primary, disabled: !this.can || ts.primary, action: () => this.toSort(n, 'primary') },
        { label: 'Set To Cache ToSort', checked: ts.cache, disabled: !this.can || ts.cache, action: () => this.toSort(n, 'cache') },
        ts.fileOnly ? { label: 'Clear File Only ToSort', disabled: !this.can, action: () => this.toSort(n, 'clearFileOnly') } : { label: 'Set To File Only ToSort', disabled: !this.can || ts.primary || ts.cache, action: () => this.toSort(n, 'fileOnly') },
        { label: 'Remove', disabled: !this.can || ts.primary || ts.cache, action: () => this.toSort(n, 'remove') },
        '-',
        { label: 'Move Up', disabled: !this.can || i < 1, action: () => this.toSort(n, 'up') },
        { label: 'Move Down', disabled: !this.can || i >= st.toSort.length - 1, action: () => this.toSort(n, 'down') },
        { label: 'Copy folder path', icon: icon.link, action: () => this.copy(n.id) });
    } else if (n.id.startsWith('RomVault')) {
      items.push(
        { label: 'Set Dir Dat Settings', icon: I.gear, disabled: !this.can, action: () => this.ruleDialog(n.id) },
        { label: 'Set Dir Mappings', disabled: !this.can || this.st?.mock, action: () => this.mappingDialog(n.id) },
        '-',
        { label: 'Save fix DATs (download)', icon: icon.download, action: () => download('fixdat', { id: n.id, red: '1' }) },
        { label: 'Save fix DATs to the fix DAT folder', disabled: !this.can || !st?.FixDatOutPath, action: () => this.saveFixDats(n.id) },
        { label: 'Copy folder path', icon: icon.link, action: () => this.copy(this.info.querySelector('.rv-info-row:last-child .rv-info-v')?.textContent || n.id) },
      );
    }
    contextMenu(x, y, items);
  }
  gameMenu(r, x, y) {
    contextMenu(x, y, [
      { label: 'Show files', action: () => this.pickGame(r, true) },
      { label: 'Copy name', icon: icon.link, action: () => this.copy(r.n) },
    ]);
  }
  romMenu(r, x, y) {
    contextMenu(x, y, [
      { label: 'Copy name', icon: icon.link, action: () => this.copy(r.n) },
      r.crc ? { label: 'Copy CRC32', action: () => this.copy(r.crc) } : null,
      r.sha1 ? { label: 'Copy SHA1', action: () => this.copy(r.sha1) } : null,
      r.md5 ? { label: 'Copy MD5', action: () => this.copy(r.md5) } : null,
    ].filter(Boolean));
  }
  async copy(text) { try { await navigator.clipboard.writeText(text); toast('Copied', { type: 'success', timeout: 1200 }); } catch { toast('Could not copy', { body: text, type: 'error' }); } }

  // --- jobs (the progress windows) ----------------------------------------------------------------------------
  busy() { return this.job?.state === 'running'; }
  async run(type, opts = {}) {
    if (!this.can) { toast('Only a parent or an admin can change the ROM collection', { type: 'error' }); return; }
    if (this.busy()) { toast('Wait for the job to finish first', { type: 'info' }); return; }
    if (type === 'fix' || type === 'auto' || type === 'all') {
      const title = { fix: 'Fix ROMs?', auto: 'Scan, find fixes and fix?', all: 'Update, scan and fix everything?' }[type];
      const first = { fix: '', auto: 'This scans the ticked folders, works out what can be fixed, then fixes it. ', all: 'This reads your DATs again, scans the ticked folders, works out what can be fixed, then fixes it. ' }[type];
      const ok = await confirmDialog({ title, message: `${first}Fixing renames and rebuilds sets in the ticked folders, moves files no DAT needs to your ToSort folder, and deletes a file only once a good copy is in the right place. Locked folders are left alone.`, confirm: type === 'fix' ? 'Fix ROMs' : 'Start' });
      if (!ok) return;
    }
    try { const r = await call('job', { method: 'POST', body: { type, ...opts } }); this.startedId = r.job?.id; this.setJob(r.job); } catch (err) { toastError(err, 'Could not start'); }
  }
  setJob(j) {
    const was = this.job;
    this.job = j;
    this.root.classList.toggle('rv-busy', !!j && j.state === 'running');
    if ((was?.state === 'running') !== (j?.state === 'running')) this.renderGuide();
    if (!j) { this.jobBox.hidden = true; return; }
    const mine = this.startedId === j.id; // a quick job can already be finished when the reply that started it arrives
    if (j.state === 'running' || mine || this.lastJobId === j.id || (was && was.id === j.id)) this.renderJob();
    if (j.state === 'running') {
      clearTimeout(this.pollT);
      this.pollT = setTimeout(() => this.poll(), 400);
      if (!this.treeT || Date.now() - this.treeT > 2500) { this.treeT = Date.now(); this.loadTree(); }
    } else if ((was?.state === 'running' || mine) && this.finishedId !== j.id) {
      this.finishedId = j.id;
      this.finished(j);
      // A clean finish needs no panel: the toast and the "next step" bar say how it went.
      clearTimeout(this.hideT);
      if (j.state !== 'error' && !j.errorCount) this.hideT = setTimeout(() => { if (this.job?.id === j.id && !this.busy()) this.jobBox.hidden = true; }, 5000);
    }
    this.lastJobId = j.id;
  }
  async poll() {
    if (this.closed) return;
    try { const r = await call('job'); this.setJob(r.job); } catch { this.pollT = setTimeout(() => this.poll(), 1500); }
  }
  async finished(j) {
    const msg = { done: 'Finished', cancelled: 'Cancelled', error: 'Stopped with an error' }[j.state] || j.state;
    const body = j.result ? `${num(j.result.totalFixed)} of ${num(j.result.totalFixes)} fixes made.${j.result.failed ? ` Stopped at ${j.result.failed.file}: ${j.result.failed.message}` : ''}` : j.errorCount ? `${num(j.errorCount)} problem${j.errorCount === 1 ? '' : 's'} listed below.` : '';
    toast(`${j.label}: ${msg}`, { body, type: j.state === 'done' && !j.result?.failed ? 'success' : 'error', icon: appIcon.roms });
    await this.loadTree();
    this.st = await call('status').catch(() => this.st);
    this.renderGuide();
    await this.select(this.selId, { quiet: true, keepGame: true });
  }
  renderJob() {
    const j = this.job;
    const running = j.state === 'running';
    const pct = j.range ? Math.min(100, (j.value / j.range) * 100) : null;
    const pct2 = j.range2 ? Math.min(100, (j.value2 / j.range2) * 100) : null;
    const bar = (p) => h('div', { class: `progress${p == null ? ' rv-indet' : ''}` }, h('div', { class: 'progress-fill', style: { width: `${p ?? 30}%` } }));
    const errs = (j.errors || []).slice(-50).reverse();
    this.jobBox.hidden = false;
    this.jobBox.classList.toggle('rv-job-min', !!this.jobMin && !running);
    clear(this.jobBox,
      h('div', { class: 'rv-job-head' },
        h('b', {}, j.label), h('span', { class: 'small muted' }, running ? (j.phase && j.type === 'auto' ? ` · ${j.phase}` : '') : ` · ${{ done: 'finished', cancelled: 'cancelled', error: 'stopped with an error' }[j.state] || j.state}`),
        j.fixes ? h('span', { class: 'small muted' }, ` · ${num(j.fixes)} fix action${j.fixes === 1 ? '' : 's'}`) : null,
        h('span', { class: 'rv-gap' }),
        j.fixes || (j.type === 'fix' && !running) ? h('button', { class: 'btn btn-sm', onclick: () => this.fixLog() }, 'Fix list') : null,
        running ? h('button', { class: 'btn btn-sm btn-danger', onclick: () => this.cancel() }, h('span', { html: I.stop }), 'Cancel')
          : h('button', { class: 'btn btn-sm btn-icon', title: 'Close', 'aria-label': 'Close', html: icon.x, onclick: () => { this.jobBox.hidden = true; } })),
      running ? h('div', { class: 'rv-job-rows' },
        h('div', { class: 'rv-job-text small' }, j.text || ' '), bar(pct),
        j.text2 || j.range2 ? h('div', { class: 'rv-job-text small muted' }, j.text2 || ' ') : null, j.range2 ? bar(pct2) : null,
        j.text3 ? h('div', { class: 'rv-job-text small muted' }, j.text3) : null) : null,
      errs.length ? h('details', { class: 'rv-job-errors', open: running || j.state === 'error' ? true : null }, h('summary', { class: 'small' }, `${num(j.errorCount || errs.length)} error${(j.errorCount || errs.length) === 1 ? '' : 's'}`),
        h('div', { class: 'rv-err-list small' }, errs.map((e) => h('div', { class: 'rv-err' }, h('b', {}, e.file || ''), h('span', {}, e.msg))))) : null);
  }
  async cancel() { try { const r = await call('cancel', { method: 'POST', body: {} }); this.setJob(r.job); toast('Cancelling…', { timeout: 1500 }); } catch (err) { toastError(err); } }

  async fixLog() {
    let r;
    try { r = await call('fixlog'); } catch (err) { toastError(err); return; }
    const rows = r.rows || [];
    const t = new VTable({
      cols: [
        { key: 'dir', label: 'Directory', w: 'minmax(160px,1fr)', render: (x) => x.dir || '' },
        { key: 'zip', label: 'Zip', w: 'minmax(120px,.8fr)', render: (x) => x.archive || '' },
        { key: 'file', label: 'File', w: 'minmax(140px,1fr)', render: (x) => x.file || '' },
        { key: 'size', label: 'Size', w: '80px', cls: 'rv-num', render: (x) => (x.size != null ? num(x.size) : '') },
        { key: 'act', label: 'Action', w: '110px', render: (x) => (x.error ? h('span', { class: 'rv-bad' }, `${x.action} (${x.error})`) : x.action) },
        { key: 'sdir', label: 'Source Dir', w: 'minmax(140px,1fr)', render: (x) => x.srcDir || '' },
        { key: 'szip', label: 'Source Zip', w: 'minmax(110px,.7fr)', render: (x) => x.srcArchive || '' },
        { key: 'sfile', label: 'Source File', w: 'minmax(110px,.7fr)', render: (x) => x.srcFile || '' },
      ], empty: 'Nothing has been fixed yet.',
    });
    t.el.classList.add('rv-fixlog');
    setTimeout(() => t.setRows(rows), 0);
    await dialog('Fix list', [h('p', { class: 'small muted' }, r.finished ? `${num(rows.length)} action${rows.length === 1 ? '' : 's'}, finished ${new Date(r.finished).toLocaleString()}.` : 'The actions of the last Fix ROMs show here.'), t.el], { ok: null, cancel: 'Close', wide: true });
  }
  async report(kind) {
    let text;
    try { text = await call('report', { params: { kind } }); } catch (err) { toastError(err); return; }
    await dialog(kind === 'fix' ? 'Fix Report' : 'Full Report', h('pre', { class: 'rv-report' }, text), {
      ok: null, cancel: 'Close', wide: true,
      extra: () => h('button', { class: 'btn', type: 'button', onclick: () => download('report', { kind, download: '1' }) }, h('span', { html: icon.download }), 'Download'),
    });
  }
  async saveFixDats(id) {
    try { const r = await call('fixdats', { method: 'POST', body: { id, redOnly: true } }); toast(r.saved ? `${r.saved} fix DAT${r.saved === 1 ? '' : 's'} saved` : 'Nothing is missing, so no fix DATs', { body: r.folder, type: 'success' }); } catch (err) { toastError(err, 'Fix DATs not saved'); }
  }

  // --- settings dialogs ------------------------------------------------------------------------------------------
  async settingsDialog() {
    const st = await call('status').catch((err) => { toastError(err); return null; });
    if (!st) return;
    const f = settingsForm(st.settings, { can: this.can, mock: st.mock });
    await dialog('ROM Manager Settings', f.body, {
      ok: this.can ? 'Save' : null, cancel: this.can ? 'Cancel' : 'Close', wide: true,
      onOk: async () => { await call('settings', { method: 'POST', body: f.read() }); toast('Settings saved', { type: 'success', icon: appIcon.roms }); this.load(); return true; },
    });
  }
  async ruleDialog(key) {
    let s;
    try { s = await call('settings'); } catch (err) { toastError(err); return; }
    const rules = s.DatRules;
    // FindDatRule: the longest rule that covers this folder is what applies now.
    const applying = rules.filter((r) => key === r.DirKey || key.startsWith(`${r.DirKey}\\`)).sort((a, b) => b.DirKey.length - a.DirKey.length)[0];
    const own = rules.find((r) => r.DirKey === key);
    const r = { ...(own || applying), DirKey: key };
    const loc = h('input', { class: 'input', value: key, spellcheck: 'false' });
    const ft = selectOf(ARCHIVE_TYPE, r.Compression);
    const comp = h('select', { class: 'input' });
    const [ftOver, ftOverRow] = check('Override DAT', r.CompressionOverrideDAT);
    const [conv, convRow] = check('Convert when fixing', r.ConvertWhileFixing);
    const fillComp = () => {
      const v = Number(ft.value);
      const opts = v === 2 ? [[1, 'Deflate - Trrntzip'], ...(s.zstd ? [[5, 'ZSTD']] : [])] : v === 3 ? [[8, 'LZMA Solid - rv7z'], [9, 'LZMA Non-Solid']] : [];
      clear(comp, opts.map(([x, l]) => h('option', { value: String(x), selected: x === r.CompressionSub }, l)));
      comp.disabled = !opts.length; conv.disabled = !opts.length; ftOver.disabled = v === 100;
    };
    ft.onchange = fillComp; fillComp();
    const merge = selectOf(MERGE.map((l, i) => [i, l]), r.Merge);
    const [mOver, mOverRow] = check('Override DAT', r.MergeOverrideDAT);
    const filter = selectOf(FILTER.map((l, i) => [i, l]), r.Filter);
    const header = selectOf(HEADER.map((l, i) => [i, l]), r.HeaderType);
    const [single, singleRow] = check('Single Archive', r.SingleArchive);
    const sub = selectOf(SUBDIR.map((l, i) => [i, l]), r.SubDirType);
    single.onchange = () => { sub.disabled = !single.checked; }; sub.disabled = !single.checked;
    const [multi, multiRow] = check('Don’t auto add DAT directories', r.MultiDATDirOverride);
    const [desc, descRow] = check('Use description (instead of name) for auto added paths', r.UseDescriptionAsDirName);
    const [useId, useIdRow] = check('Use ID for Numbered DAT Names (No-Intro DATs)', r.UseIdForName);
    const [complete, completeRow] = check('Only Keep Complete Sets', r.CompleteOnly);
    const ignore = h('textarea', { class: 'input rv-textarea', rows: 3, spellcheck: 'false' }, (own?.IgnoreFiles || []).join('\n'));
    const list = h('div', { class: 'rv-rule-list' }, rules.map((x) => h('button', { type: 'button', class: `rv-rule-row${x.DirKey === key ? ' sel' : key.startsWith(`${x.DirKey}\\`) ? ' parent' : ''}`, onclick: () => { close?.(null); this.ruleDialog(x.DirKey); } },
      h('span', { class: 'rv-rule-key' }, x.DirKey), h('span', { class: 'small muted' }, `${(ARCHIVE_TYPE.find((a) => a[0] === x.Compression) || [0, '?'])[1]} · ${MERGE[x.Merge]}${x.SingleArchive ? ' · single' : ''}`))));
    let close = null;
    await dialog('Set DAT Rules', [
      h('p', { class: 'small muted' }, own ? 'This folder has its own rule.' : `This folder uses the rule for ${applying?.DirKey || 'RomVault'}. Saving makes a rule of its own for it, and for the folders inside it that don’t have one.`),
      field('Rule Path', loc),
      h('div', { class: 'rv-group' }, h('div', { class: 'rv-group-title' }, 'DAT Rule Settings'),
        h('div', { class: 'rv-row2' }, field('Archive Type', ft), h('div', { class: 'rv-inline' }, ftOverRow)),
        h('div', { class: 'rv-row2' }, field('Compression Type', comp), h('div', { class: 'rv-inline' }, convRow)),
        h('div', { class: 'rv-row2' }, field('Merge Type', merge), h('div', { class: 'rv-inline' }, mOverRow)),
        h('div', { class: 'rv-row2' }, field('ROM/CHD Filter', filter), field('Header Type', header)),
        singleRow, field('Sets in a single archive', sub), descRow),
      h('div', { class: 'rv-group' }, h('div', { class: 'rv-group-title' }, 'Multi DAT Directory Setting'), multiRow),
      h('div', { class: 'rv-group' }, h('div', { class: 'rv-group-title' }, 'Advanced Options'), useIdRow, completeRow,
        field('Filenames not to remove from this folder', ignore, 'One rule per line. * and ? work as wildcards; regex rules start with regex:.')),
      h('div', { class: 'rv-group' }, h('div', { class: 'rv-group-title' }, 'Existing Dat Rules'), list),
    ], {
      ok: 'Apply', wide: true,
      extra: (c) => { close = c; return own && key !== 'RomVault' ? h('button', { class: 'btn btn-danger', type: 'button', onclick: async () => { try { await call('rule/delete', { method: 'POST', body: { DirKey: key } }); c(true); this.afterRuleChange(); } catch (err) { toastError(err); } } }, 'Delete') : null; },
      onOk: async () => {
        await call('rule', { method: 'POST', body: {
          DirKey: loc.value.trim(), Compression: Number(ft.value), CompressionSub: comp.value ? Number(comp.value) : 0, CompressionOverrideDAT: ftOver.checked, ConvertWhileFixing: conv.checked,
          Merge: Number(merge.value), MergeOverrideDAT: mOver.checked, Filter: Number(filter.value), HeaderType: Number(header.value), SingleArchive: single.checked, SubDirType: Number(sub.value),
          MultiDATDirOverride: multi.checked, UseDescriptionAsDirName: desc.checked, UseIdForName: useId.checked, CompleteOnly: complete.checked, IgnoreFiles: ignore.value.split(/\r?\n/),
        } });
        this.afterRuleChange();
        return true;
      },
    });
  }
  // FrmDirectorySettings: a changed rule re-reads the DATs it covers.
  afterRuleChange() { toast('DAT rule saved', { body: 'Updating DATs so the rule takes effect.', type: 'success', icon: appIcon.roms }); this.run('updateDats'); }
  async mappingDialog(key) {
    let s;
    try { s = await call('settings'); } catch (err) { toastError(err); return; }
    const own = s.DirMappings.find((m) => m.DirKey === key);
    const loc = h('input', { class: 'input', value: key, spellcheck: 'false' });
    const dirIn = pathInput(own?.DirPath, 'For example E:\\MAME');
    const list = h('div', { class: 'rv-rule-list' }, s.DirMappings.map((m) => h('button', { type: 'button', class: `rv-rule-row${m.DirKey === key ? ' sel' : ''}`, onclick: () => { close?.(null); this.mappingDialog(m.DirKey); } }, h('span', { class: 'rv-rule-key' }, m.DirKey), h('span', { class: 'small muted' }, m.DirPath))));
    let close = null;
    await dialog('Set Directory Mapping', [
      h('p', { class: 'small muted' }, 'Keep this part of the tree in another folder, for example on another drive. Folders inside it follow it unless they have a mapping of their own.'),
      field('Rule Path', loc), field('Dir Location', dirIn, 'A full path on the computer running MediaDesk.'),
      h('div', { class: 'rv-group' }, h('div', { class: 'rv-group-title' }, 'Existing Mapping'), list),
    ], {
      ok: 'Apply', wide: true,
      extra: (c) => { close = c; return own && key !== 'RomVault' ? h('button', { class: 'btn btn-danger', type: 'button', onclick: async () => { try { await call('mapping/delete', { method: 'POST', body: { DirKey: key } }); c(true); toast('Mapping deleted', { body: 'Scan ROMs to find the files where they are now.', type: 'success' }); } catch (err) { toastError(err); } } }, 'Delete') : null; },
      onOk: async () => { await call('mapping', { method: 'POST', body: { DirKey: loc.value.trim(), DirPath: dirIn.value } }); toast('Mapping saved', { body: 'Scan ROMs to find the files in their new place.', type: 'success' }); return true; },
    });
  }
  async addToSort() {
    const p = pathInput('', 'For example E:\\Downloads\\ROMs');
    await dialog('Add ToSort', [h('p', { class: 'small muted' }, 'Files in ToSort folders are used to fix sets. The primary ToSort folder also gets the files no DAT needs.'), field('Folder', p)], {
      ok: 'Add', onOk: async () => { const r = await call('tosort', { method: 'POST', body: { action: 'add', path: p.value } }); this.st.settings = r; await this.loadTree(); toast('ToSort folder added', { body: 'Scan ROMs to read what’s in it.', type: 'success' }); return true; },
    });
  }
  async toSort(n, action) {
    if (action === 'remove' && !(await confirmDialog({ title: 'Remove this ToSort folder?', message: `${n.id} stays on disk; ROM Manager just stops using it.`, confirm: 'Remove', danger: true }))) return;
    try { const r = await call('tosort', { method: 'POST', body: { action, id: n.id } }); this.st.settings = r; await this.loadTree(); if (action === 'remove') this.select('RomVault'); } catch (err) { toastError(err); }
  }
  // --- "what to do next": one plain sentence about the collection and the step that comes next -----------------
  renderGuide() {
    const o = this.st?.overview;
    if (!o || !this.st.configured || readLs('mediadesk.roms.guide', true) === false) { this.guide.hidden = true; return; }
    const t = o.steps || {};
    const s = this.st.settings;
    const total = o.have + o.missing;
    const pct = total ? Math.floor((o.have / total) * 100) : 0;
    const busy = this.busy();
    const btn = (label, ic, fn, primary) => h('button', { class: `btn btn-sm${primary ? ' btn-primary' : ''}`, disabled: !this.can || busy, onclick: fn }, ic ? h('span', { html: ic }) : null, label);
    const plural = (n, one, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;
    let tone = 'step'; let title; let text; let acts; let meter = false;
    if (!t.dats) {
      title = 'Step 1 of 4: load your DATs';
      text = `ROM Manager reads the DAT files in ${s.DatRoot} to learn which ROMs make up each set. Copy your DATs there first (zipped is fine); each sub-folder becomes a folder in the tree.`;
      acts = [btn('Load DATs', I.dats, () => this.run('updateDats'), true)];
    } else if (!o.dats) {
      tone = 'warn'; title = 'No DAT files found';
      text = `There are no DATs in ${s.DatRoot} yet. Copy some there (.dat or .xml, zipped is fine), then look again.`;
      acts = [btn('Look again', I.dats, () => this.run('updateDats'), true), h('button', { class: 'btn btn-sm', onclick: () => this.settingsDialog() }, h('span', { html: I.gear }), 'Change folders')];
    } else if (!t.scan || t.scan < t.dats) {
      title = 'Step 2 of 4: scan your ROMs';
      text = `${plural(o.dats, 'DAT')} loaded. Next, ROM Manager looks at the files in your ROM and ToSort folders to see what you have. The first scan of a big collection can take a while.`;
      acts = [btn('Scan ROMs', I.scan, () => this.run('scan', { level: 1 }), true), btn('Scan and fix in one go', I.bolt, () => this.run('auto'))];
    } else if (!t.find || t.find < t.scan) {
      title = 'Step 3 of 4: find fixes'; meter = true;
      text = 'Next, ROM Manager works out which files it can rename, move or rebuild to complete your sets. Nothing is changed yet.';
      acts = [btn('Find Fixes', I.find, () => this.run('findFixes'), true)];
    } else if (o.fixes > 0) {
      tone = 'fix'; meter = true;
      title = `Step 4 of 4: ${plural(o.fixes, 'fix', 'fixes')} ready`;
      text = 'Fixing renames, moves and rebuilds files so your sets match the DATs, and moves files no DAT needs to ToSort. Yellow and orange rows show what will change.';
      acts = [btn('Fix ROMs', I.fix, () => this.run('fix'), true), h('button', { class: 'btn btn-sm', onclick: () => this.report('fix') }, h('span', { html: I.report }), 'See the list first')];
    } else if (o.missing > 0) {
      tone = 'info'; meter = true;
      title = `You have ${num(o.have)} of ${plural(total, 'ROM')} (${pct}%)`;
      text = `${plural(o.missing, 'ROM is', 'ROMs are')} missing, and none of your files can fill ${o.missing === 1 ? 'it' : 'them'} in. To add more, put files in your ToSort folder, then scan and fix. A fix DAT lists exactly what’s missing.`;
      acts = [btn('Scan and fix', I.bolt, () => this.run('auto'), true), h('button', { class: 'btn btn-sm', onclick: () => download('fixdat', { red: '1' }) }, h('span', { html: icon.download }), 'List what’s missing')];
    } else {
      tone = 'ok'; meter = total > 0;
      title = total ? `Complete: you have all ${plural(total, 'ROM')}` : 'Nothing to collect yet';
      text = total ? 'Every set in the ticked folders matches its DAT. When you add DATs or files, check again.' : 'The ticked folders list no ROMs. Tick some folders in the tree, or add DATs.';
      acts = [btn('Check for changes', I.bolt, () => this.run('all'), true)];
    }
    if (busy) text = `${this.job.label}… ${text}`;
    if (!this.can) text += ' Only a parent or an admin can run these.';
    this.guide.dataset.tone = tone;
    this.guide.hidden = false;
    clear(this.guide,
      h('div', { class: 'rv-guide-main' },
        h('div', { class: 'rv-guide-title' }, title),
        h('div', { class: 'rv-guide-text small' }, text),
        meter && total ? h('div', { class: 'rv-meter', title: `${num(o.have)} of ${num(total)} ROMs (${pct}%)` }, h('span', { style: { width: `${(o.have / total) * 100}%` } })) : null),
      h('div', { class: 'rv-guide-acts' }, acts),
      h('button', { class: 'btn btn-icon btn-sm rv-guide-x', title: 'Hide these tips (bring them back from ? )', 'aria-label': 'Hide these tips', html: icon.x, onclick: () => { writeLs('mediadesk.roms.guide', false); this.guide.hidden = true; } }));
  }
  // A folder with no sets of its own (the top, or a folder of DATs) lists its folders instead of an empty table.
  renderFolders(n) {
    const kids = (n?.kids || []).filter((k) => !k.tosort);
    this.gamePane.classList.toggle('rv-show-folders', kids.length > 0);
    this.root.classList.toggle('rv-folders-mode', kids.length > 0);
    if (!kids.length) { clear(this.folders); return; }
    clear(this.folders, h('div', { class: 'rv-folders-head small muted' }, 'Pick a folder to see its sets.'),
      kids.map((k) => {
        const tot = k.have + k.missing;
        const p = tot ? (k.have / tot) * 100 : 0;
        return h('button', { class: 'rv-folder', onclick: () => this.select(k.id) },
          h('span', { class: 'rv-node-icon', html: treeIconSvg(k.icon) }),
          h('span', { class: 'rv-folder-main' },
            h('span', { class: 'rv-folder-name' }, k.name),
            h('span', { class: 'rv-meter' }, h('span', { style: { width: `${p}%` } })),
            h('span', { class: 'small muted' }, tot ? `${num(k.have)} of ${num(tot)} ROMs (${Math.floor(p)}%)${k.fixes ? ` · ${num(k.fixes)} fixes ready` : ''}` : 'No ROMs listed')));
      }));
  }
  help() {
    const stepRow = (n, ic, name, what) => h('div', { class: 'rv-help-step' }, h('b', { class: 'rv-step-n' }, String(n)), h('div', {}, h('div', { class: 'rv-help-name' }, h('span', { html: ic }), name), h('div', { class: 'small muted' }, what)));
    const hidden = readLs('mediadesk.roms.guide', true) === false;
    dialog('How ROM Manager works', [
      h('p', { class: 'small' }, 'ROM Manager compares your files with DAT files, which list every ROM in every set, and fixes what it can. It works in four steps, each a button on the toolbar. The bar at the top of the window always says which one comes next.'),
      h('div', { class: 'rv-help-steps' },
        stepRow(1, I.dats, 'Update DATs', 'Reads the DAT files in your DAT folder and builds the tree from them. Run it again when you add or change DATs.'),
        stepRow(2, I.scan, 'Scan ROMs', 'Looks at the files in your ROM folder and your ToSort folder, so it knows what you have.'),
        stepRow(3, I.find, 'Find Fixes', 'Works out which files can be renamed, moved or rebuilt to complete your sets. Nothing changes yet.'),
        stepRow(4, I.fix, 'Fix ROMs', 'Makes those changes. Files no DAT needs go to ToSort; a file is only deleted once a good copy is in the right place.')),
      h('p', { class: 'small' }, h('b', {}, 'Shortcut: '), 'Fix ROMs → “Update DATs, Scan, Find Fixes and Fix” does all four.'),
      h('div', { class: 'rv-group' }, h('div', { class: 'rv-group-title' }, 'Good to know'),
        h('ul', { class: 'small rv-help-list' },
          h('li', {}, h('b', {}, 'Ticks: '), 'only ticked folders are scanned and fixed. Right-click a tick box to lock a folder: it’s read but never changed.'),
          h('li', {}, h('b', {}, 'ToSort: '), 'drop new downloads or unsorted files here, then Scan and fix. They’re filed where they belong.'),
          h('li', {}, h('b', {}, 'Colours: '), 'green means you have it, red means missing, yellow means it can be fixed. The colour key button lists them all.'),
          h('li', {}, h('b', {}, 'Missing list: '), 'Reports → Fix DATs makes a DAT of only what’s missing, to share or search with.'))),
    ], { ok: null, cancel: 'Close', extra: (close) => [
      h('button', { class: 'btn', type: 'button', onclick: () => { close(null); this.colourKey(); } }, h('span', { html: I.key }), 'Colour key'),
      hidden ? h('button', { class: 'btn', type: 'button', onclick: () => { writeLs('mediadesk.roms.guide', true); close(null); this.renderGuide(); } }, 'Show the next-step bar again') : null,
    ] });
  }

  colourKey() {
    dialog('Colour key', [
      h('p', { class: 'small muted' }, 'Sets and files are coloured by status, as in RomVault. A set takes the colour of the most important status among its files.'),
      h('div', { class: 'rv-key' }, KEY_ORDER.map((k) => h('div', { class: 'rv-key-row' }, statusChip(R[k], RS[k]), h('span', { class: 'small' }, LABEL[k])))),
      h('div', { class: 'rv-group' }, h('div', { class: 'rv-group-title' }, 'Tree'),
        h('div', { class: 'rv-key' }, [[1, 'Nothing collected yet'], [2, 'Some collected'], [3, 'Everything collected'], [4, 'ToSort folder']].map(([n, l]) => h('div', { class: 'rv-key-row' }, h('span', { class: 'rv-node-icon', html: treeIconSvg(n) }), h('span', { class: 'small' }, l)))),
        h('p', { class: 'small muted' }, 'Hashes: D = from the DAT, F = read from the file, V = verified by hashing the data.')),
    ], { ok: null, cancel: 'Close' });
  }
  about() {
    dialog('About ROM Manager', [
      h('p', {}, 'ROM Manager uses a JavaScript port of the RomVault engine (RomVaultCore, DATReader, FileScanner and Compress) by Gordon J, from github.com/RomVault/RVWorld, under the Apache License 2.0.'),
      h('p', { class: 'small muted' }, 'The port runs on the MediaDesk server with no extra install; 7z archives use 7-Zip if it is installed there. Not included: MIA reporting, DatVault, the Structured Archive Maker, emulator launching and deep CHD checks. The licence and the list of changes are in the romvault folder of MediaDesk (LICENSE and NOTICE).'),
    ], { ok: null, cancel: 'Close' });
  }
  dragSplit(e) {
    if (this.narrow) return;
    e.preventDefault();
    const box = e.currentTarget.parentElement.getBoundingClientRect();
    const move = (ev) => { const p = Math.max(20, Math.min(80, ((ev.clientY - box.top) / box.height) * 100)); this.root.style.setProperty('--split', `${p}%`); this.splitPct = p; };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); if (this.splitPct) writeLs('mediadesk.roms.split', Math.round(this.splitPct)); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  }
}

export const romsApp = {
  id: 'roms', name: 'ROM Manager', icon: appIcon.roms, size: [1180, 760], description: 'Match your ROMs to DATs and fix sets, with RomVault’s engine',
  open(win) {
    const app = new RomManager(win);
    win.on('reopen', () => app.load());
  },
};

// Settings → ROM Manager: the main settings, saved straight to the app's own.
export async function renderRomsSettings(container, { section }) {
  loadCss();
  const box = h('div', {}, spinner());
  container.append(h('div', { class: 'pane-header' }, h('span', { class: 'settings-app-icon', html: appIcon.roms }), h('h2', {}, 'ROM Manager')), box);
  try {
    const st = await call('status');
    const can = st.canChange;
    const f = settingsForm(st.settings, { can, mock: st.mock });
    const save = h('button', { class: 'btn btn-primary', disabled: !can }, h('span', { html: icon.check }), 'Save');
    save.onclick = async () => {
      save.disabled = true;
      try { await call('settings', { method: 'POST', body: f.read() }); toast('ROM Manager settings saved', { type: 'success', icon: appIcon.roms }); } catch (err) { toastError(err, 'Could not save'); } finally { save.disabled = !can; }
    };
    clear(box, section('Settings', ...f.body,
      h('p', { class: 'muted small' }, 'DAT rules (zip, 7z or folders; split, merged or non-merged sets), directory mappings and more ToSort folders are in ROM Manager itself: ⚙, or right-click a folder in its tree.'),
      h('div', { class: 'btn-row' }, save, h('button', { class: 'btn', onclick: () => import('../wm.js').then((wm) => wm.openApp('roms')) }, h('span', { html: icon.external }), 'Open ROM Manager'))),
    section('Collection', h('p', { class: 'muted small' }, st.configured ? 'Set up. Open ROM Manager to update DATs, scan and fix.' : 'Not set up yet: fill in the folders above.')));
  } catch (err) { clear(box, errorState(err)); }
}
