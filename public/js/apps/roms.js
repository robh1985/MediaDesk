// ROM Librarian: keeps a ROM collection matched to DAT files (No-Intro, Redump, MAME, TOSEC…).
// The tree on the left is the DAT folder; each DAT shows how many of its sets are complete, can
// be fixed or are missing. Pick a DAT to see its sets, a set to see each file and where a fix
// would come from. Update DATs, Scan and Fix run on the MediaDesk server (roms.js), one at a time.
// On narrow windows and phones the tree slides in from the left behind ☰.

import { h, clear, toast, toastError, contextMenu, confirmDialog, formatBytes, spinner, emptyState, errorState, debounce } from '../ui.js';
import { icon, appIcon } from '../icons.js';

const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const I = {
  dats: svg('<path d="M6 2.5h8l5 5V21a.5.5 0 0 1-.5.5h-12A.5.5 0 0 1 6 21z"/><path d="M14 2.5V8h5M9 13h6M9 17h6"/>'),
  scan: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>'),
  fix: svg('<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>'),
  report: svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  folder: '<svg viewBox="0 0 24 24"><path d="M2.5 6.5A2 2 0 0 1 4.5 4.5h4.2l2 2h8.8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2z" fill="#f5b82e"/></svg>',
  dat: '<svg viewBox="0 0 24 24"><path d="M6 2.5h8l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-17a1 1 0 0 1 1-1z" fill="#6366f1"/><path d="M14 2.5v4a1 1 0 0 0 1 1h4" fill="#fff" opacity=".5"/><path d="M8 13h8M8 16.5h6" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></svg>',
  tosort: '<svg viewBox="0 0 24 24"><path d="M3 7.5 5 4h14l2 3.5V19a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19z" fill="#0ea5e9"/><path d="M3 8h18M9 12h6" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></svg>',
  chev: svg('<path d="m9 6 6 6-6 6"/>'),
  more: svg('<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>'),
  back: svg('<path d="M15 18l-6-6 6-6"/>'),
};
// What each file's state means, with its colour (also used for the bars in the tree).
const STATES = {
  correct: ['Correct', 'ok'], missing: ['Missing', 'bad'], fixable: ['Can be fixed', 'fix'], rename: ['Wrong name (rename)', 'fix'], nodump: ['No good dump known', 'none'],
  needed: ['Needed for a fix', 'fix'], tosort: ['Not in any DAT (to ToSort)', 'unk'], delete: ['Duplicate (delete)', 'del'], corrupt: ['Damaged', 'corrupt'], intosort: ['In ToSort', 'unk'],
};
const SET_STATES = { complete: ['Complete', 'ok'], fixable: ['Fixable', 'fix'], partial: ['Partly there', 'part'], missing: ['Missing', 'bad'], empty: ['Nothing to collect', 'none'] };
const MERGE_LABEL = { auto: 'As the DAT says', split: 'Split', merged: 'Merged', nonmerged: 'Non-merged', fullnonmerged: 'Full non-merged (with BIOS)' };
const FORMAT_LABEL = { zip: 'ZIP', '7z': '7z', folder: 'Folders (uncompressed)' };
const FILTER_LABEL = { all: 'ROMs and disks (CHD)', roms: 'ROMs only', disks: 'Disks (CHD) only' };
const LEVEL_LABEL = { quick: 'Quick (read archive headers; new files hashed)', normal: 'Normal (hash new and changed files)', full: 'Full (hash everything again, find damage)' };

const readLs = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const writeLs = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } };

async function call(route, { method = 'GET', params, body } = {}) {
  const qs = params ? `?${new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null))}` : '';
  const res = await fetch(`/portal/roms/${route}${qs}`, { method, credentials: 'same-origin', headers: { 'X-MediaDesk': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (data.code === 'stale-page') window.dispatchEvent(new Event('mediadesk:stale'));
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status });
  return data;
}
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const plural = (n, w) => `${n.toLocaleString()} ${w}${n === 1 ? '' : 's'}`;

let cssLoaded = false;
function loadCss() {
  if (cssLoaded) return;
  cssLoaded = true;
  document.head.append(h('link', { rel: 'stylesheet', href: new URL('../../css/roms.css', import.meta.url).href }));
}

// A three-colour bar: have / can fix / missing.
function bar(c) {
  const total = c.total || 0;
  const el = h('span', { class: 'rl-bar', title: total ? `${c.have} of ${c.total} files (${pct(c.have, total)}%)${c.fix ? `, ${c.fix} can be fixed` : ''}` : 'Nothing to collect' });
  if (total) el.append(h('span', { class: 'rl-bar-ok', style: { width: `${(c.have / total) * 100}%` } }), h('span', { class: 'rl-bar-fix', style: { width: `${(c.fix / total) * 100}%` } }));
  return el;
}
const pill = (label, kind) => h('span', { class: `rl-pill rl-${kind}` }, label);

function dialog(title, body, { ok = 'Save', cancel = 'Cancel', onOk, wide = false } = {}) {
  return new Promise((resolve) => {
    const err = h('div', { class: 'rl-error small' });
    const okBtn = ok ? h('button', { class: 'btn btn-primary', type: 'submit' }, ok) : null;
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(null); } };
    const close = (v) => { document.removeEventListener('keydown', onKey, true); overlay.remove(); resolve(v); };
    const form = h('form', { class: `dialog rl-dialog${wide ? ' rl-wide' : ''}`, onsubmit: async (e) => {
      e.preventDefault();
      if (!onOk) return close(true);
      okBtn.disabled = true;
      try { err.textContent = ''; const v = await onOk(); if (v !== undefined && v !== false) close(v); } catch (ex) { err.textContent = ex.message; } finally { okBtn.disabled = false; }
    } }, h('h3', {}, title), h('div', { class: 'rl-dialog-body' }, body), err,
    h('div', { class: 'dialog-actions' }, cancel ? h('button', { class: 'btn', type: 'button', onclick: () => close(null) }, cancel) : null, okBtn));
    const overlay = h('div', { class: 'dialog-overlay', onclick: (e) => { if (e.target === overlay) close(null); } }, form);
    document.addEventListener('keydown', onKey, true);
    document.body.append(overlay);
    (form.querySelector('input:not([disabled]), select:not([disabled]), textarea:not([disabled])') || okBtn || form.querySelector('button'))?.focus();
  });
}
const selectOf = (options, value) => h('select', { class: 'input' }, Object.entries(options).map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
const field = (label, input, help) => h('label', { class: 'field rl-field' }, h('span', {}, label), input, help ? h('span', { class: 'small muted' }, help) : null);

class Librarian {
  constructor(win) {
    this.win = win;
    this.state = null;
    this.selected = readLs('mediadesk.roms.selected', '');
    this.open = new Set(readLs('mediadesk.roms.open', ['']));
    this.show = 'all';
    this.query = '';
    this.detail = null;
    this.drawerOpen = false;
    loadCss();
    this.treeBox = h('div', { class: 'rl-tree', role: 'tree' });
    this.main = h('div', { class: 'rl-main' });
    this.progress = h('div', { class: 'rl-progress', hidden: true });
    this.menuBtn = h('button', { class: 'btn btn-icon rl-menu-btn', title: 'DATs', 'aria-label': 'Show the DAT tree', html: icon.menu, onclick: () => this.toggleDrawer(true) });
    const tb = (label, ic, fn, title) => h('button', { class: 'btn rl-tool', title: title || label, onclick: fn }, h('span', { html: ic }), h('span', { class: 'rl-tool-label' }, label));
    this.tools = [
      tb('Update DATs', I.dats, () => this.runJob('dats'), 'Read new and changed DATs from the DAT folder'),
      tb('Scan', I.scan, (e) => this.scanMenu(e), 'Scan the ROM and ToSort folders'),
      tb('Fix', I.fix, () => this.fixAll(), 'Fix everything that can be fixed'),
    ];
    this.reportBtn = tb('Reports', I.report, (e) => this.reportsMenu(e));
    this.settingsBtn = h('button', { class: 'btn btn-icon', title: 'ROM Librarian settings', html: I.gear, onclick: () => this.settingsDialog() });
    this.toolbar = h('div', { class: 'rl-toolbar' }, this.menuBtn, ...this.tools, this.reportBtn, h('span', { class: 'rl-gap' }), this.settingsBtn);
    this.shade = h('div', { class: 'rl-shade', onclick: () => this.toggleDrawer(false) });
    this.side = h('aside', { class: 'rl-side', onkeydown: (e) => { if (e.key === 'Escape' && this.drawerOpen) { e.stopPropagation(); this.toggleDrawer(false); } } }, h('div', { class: 'rl-side-head' }, h('span', {}, 'DATs'), h('button', { class: 'btn btn-icon btn-sm rl-side-close', 'aria-label': 'Close', html: icon.x, onclick: () => this.toggleDrawer(false) })), this.treeBox);
    this.root = h('div', { class: 'rl-app' }, this.toolbar, this.progress, h('div', { class: 'rl-body' }, this.side, this.shade, this.main));
    win.body.append(this.root);
    // Narrow windows (and phones) put the tree in a drawer.
    this.ro = new ResizeObserver(() => { const narrow = this.root.clientWidth < 760; if (narrow !== this.narrow) { this.narrow = narrow; this.root.classList.toggle('rl-narrow', narrow); if (!narrow) this.toggleDrawer(false); } });
    this.ro.observe(this.root);
    this.load();
  }

  toggleDrawer(on) {
    if (!this.narrow && on) return;
    this.drawerOpen = on;
    if (on) { this.side.hidden = false; requestAnimationFrame(() => this.root.classList.toggle('rl-drawer-open', this.drawerOpen)); this.side.querySelector('.rl-node.sel, .rl-node')?.focus({ preventScroll: true }); }
    else this.root.classList.remove('rl-drawer-open');
  }

  async load({ keepMain = false } = {}) {
    try { this.state = await call('state'); } catch (err) { clear(this.main, errorState(err, () => this.load())); return; }
    const s = this.state;
    this.tools.forEach((b) => { b.disabled = !s.canChange; });
    this.settingsBtn.disabled = false;
    this.renderTree();
    this.watchJob(s.job);
    if (!s.configured) { this.toggleDrawer(false); return this.renderSetup(); }
    if (!keepMain) this.select(this.selected, { quiet: true });
  }

  // --- Tree ---------------------------------------------------------------------------------------
  renderTree() {
    const s = this.state;
    clear(this.treeBox);
    if (!s.tree) { this.treeBox.append(h('div', { class: 'rl-tree-empty small muted' }, s.configured ? 'No DATs yet. Put DAT files in the DAT folder and press Update DATs.' : 'Choose your folders to begin.')); return; }
    const row = (n, depth) => {
      const kids = n.children || [];
      const isOpen = this.open.has(n.path);
      const c = n.counts;
      const extra = [c.unknown ? h('span', { class: 'rl-tag rl-unk', title: `${c.unknown} file(s) no DAT needs` }, `?${c.unknown}`) : null, c.del ? h('span', { class: 'rl-tag rl-del', title: `${c.del} duplicate(s)` }, `×${c.del}`) : null, c.corrupt ? h('span', { class: 'rl-tag rl-corrupt', title: `${c.corrupt} damaged` }, `!${c.corrupt}`) : null];
      const el = h('div', { class: `rl-node${this.selected === n.path ? ' sel' : ''}`, role: 'treeitem', tabindex: '0', 'aria-expanded': kids.length ? String(isOpen) : null, style: { '--depth': depth }, dataset: { path: n.path },
        onclick: () => { this.select(n.path); if (this.narrow && (n.kind === 'dat' || !kids.length)) this.toggleDrawer(false); },
        onkeydown: (e) => {
          if (e.key === 'Enter') { e.preventDefault(); el.click(); }
          if (e.key === 'ArrowRight' && kids.length && !isOpen) { this.open.add(n.path); this.saveOpen(); this.renderTree(); }
          if (e.key === 'ArrowLeft' && isOpen) { this.open.delete(n.path); this.saveOpen(); this.renderTree(); }
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const all = [...this.treeBox.querySelectorAll('.rl-node')]; all[all.indexOf(el) + (e.key === 'ArrowDown' ? 1 : -1)]?.focus(); }
        },
        oncontextmenu: (e) => { e.preventDefault(); this.nodeMenu(n, e.clientX, e.clientY); } },
      kids.length ? h('button', { class: `rl-twist${isOpen ? ' open' : ''}`, tabindex: '-1', 'aria-label': isOpen ? 'Collapse' : 'Expand', html: I.chev, onclick: (e) => { e.stopPropagation(); if (isOpen) this.open.delete(n.path); else this.open.add(n.path); this.saveOpen(); this.renderTree(); } }) : h('span', { class: 'rl-twist-space' }),
      h('span', { class: 'rl-node-icon', html: n.kind === 'dat' ? I.dat : I.folder }),
      h('span', { class: 'rl-node-name', title: n.title || n.name }, n.path ? n.name : 'All DATs'),
      n.rule ? h('span', { class: 'rl-rule-dot', title: 'This folder has its own rules' }) : null,
      ...extra,
      h('span', { class: 'rl-node-count small muted' }, c.sets ? `${c.complete}/${c.sets}` : ''),
      bar(c));
      const out = [el];
      if (isOpen) for (const k of kids) out.push(...row(k, depth + 1));
      return out;
    };
    this.treeBox.append(...row(s.tree.root, 0));
    if (s.tree.toSort.length) {
      this.treeBox.append(h('div', { class: 'rl-tree-heading' }, 'ToSort'));
      for (const t of s.tree.toSort) {
        const c = t.counts;
        this.treeBox.append(h('div', { class: `rl-node${this.selected === t.path ? ' sel' : ''}`, role: 'treeitem', tabindex: '0', style: { '--depth': 0 }, onclick: () => { this.select(t.path); if (this.narrow) this.toggleDrawer(false); }, onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.click(); } } },
          h('span', { class: 'rl-twist-space' }), h('span', { class: 'rl-node-icon', html: I.tosort }), h('span', { class: 'rl-node-name', title: t.folder }, t.name, t.primary ? h('span', { class: 'small muted' }, ' (primary)') : null),
          c.needed ? h('span', { class: 'rl-tag rl-fix', title: `${c.needed} file(s) a DAT needs` }, `⚑${c.needed}`) : null, c.del ? h('span', { class: 'rl-tag rl-del' }, `×${c.del}`) : null,
          h('span', { class: 'rl-node-count small muted' }, c.files ? plural(c.files, 'file') : 'empty')));
      }
    }
  }
  saveOpen() { writeLs('mediadesk.roms.open', [...this.open]); }
  findNode(p) {
    const t = this.state?.tree;
    if (!t) return null;
    if (p.startsWith('tosort:')) return t.toSort.find((x) => x.path === p) || null;
    const walk = (n) => (n.path === p ? n : n.children.map(walk).find(Boolean) || null);
    return walk(t.root);
  }
  select(p, { quiet = false } = {}) {
    let n = this.findNode(p);
    if (!n && this.state?.tree) { n = this.state.tree.root; p = ''; }
    this.selected = p;
    writeLs('mediadesk.roms.selected', p);
    // Open the folders above it so it shows in the tree.
    const parts = p.startsWith('tosort:') ? [] : p.split('/');
    for (let i = 0; i < parts.length; i++) this.open.add(parts.slice(0, i).join('/'));
    this.renderTree();
    this.detail = null;
    if (!n) return this.renderSetup();
    if (n.kind === 'tosort') return this.renderFiles(n, true);
    if (n.kind === 'dat') return this.renderDat(n, quiet);
    return this.renderDir(n);
  }

  nodeMenu(n, x, y) {
    if (n.kind === 'tosort') return;
    const can = this.state.canChange;
    contextMenu(x, y, [
      { label: 'Folder rules…', icon: I.gear, disabled: !can, action: () => this.rulesDialog(n) },
      { label: `Fix ${n.path ? `“${n.name}”` : 'everything'}`, icon: I.fix, disabled: !can || !n.counts.need, action: () => this.fixScope(n) },
      '-',
      { label: 'Fix report', icon: I.report, action: () => this.openReport('fix', n.path) },
      { label: 'Missing files report', icon: I.report, action: () => this.openReport('missing', n.path) },
      { label: 'Full report', icon: I.report, action: () => this.openReport('full', n.path) },
      { label: 'Download fix DAT', icon: icon.download || I.dats, disabled: !n.counts.total || n.counts.have + n.counts.fix >= n.counts.total, action: () => this.download(`fixdat?path=${encodeURIComponent(n.path)}`) },
    ]);
  }

  // --- Pages -----------------------------------------------------------------------------------------
  head(n, ...extra) {
    const c = n.counts;
    return h('div', { class: 'rl-head' },
      h('div', { class: 'rl-head-title' }, h('span', { class: 'rl-head-icon', html: n.kind === 'dat' ? I.dat : n.kind === 'tosort' ? I.tosort : I.folder }), h('div', {},
        h('h2', {}, n.kind === 'tosort' ? n.name : n.title || (n.path ? n.name : 'All DATs')),
        h('div', { class: 'small muted rl-head-sub' }, n.kind === 'tosort' ? n.folder : [n.version ? `Version ${n.version}` : null, n.romDir ? `ROMs in ${n.romDir}` : null].filter(Boolean).join(' · ')))),
      n.kind !== 'tosort' ? h('div', { class: 'rl-stats' },
        stat(c.complete, 'complete', 'ok'), stat(c.fixable, 'fixable', 'fix'), stat(c.partial, 'partly there', 'part'), stat(c.missing, 'missing', 'bad'),
        h('div', { class: 'rl-stat-files small muted' }, `${c.have.toLocaleString()} of ${c.total.toLocaleString()} files (${pct(c.have, c.total)}%)${c.fix ? ` · ${c.fix.toLocaleString()} can be fixed` : ''}`)) : null,
      ...extra);
  }

  renderSetup() {
    const s = this.state;
    clear(this.main, h('div', { class: 'rl-setup' },
      h('div', { class: 'big-icon', html: appIcon.roms }),
      h('h2', {}, 'Keep your ROMs matched to DATs'),
      h('p', { class: 'muted' }, 'ROM Librarian checks your ROM collection against DAT files from No-Intro, Redump, MAME, TOSEC and others: what you have, what’s missing, what’s misnamed, and what can be fixed from files you already have. It can rebuild sets as TorrentZip ZIPs, 7z or folders, in split, merged or non-merged form.'),
      h('ol', { class: 'rl-steps' },
        h('li', {}, h('b', {}, 'DAT folder: '), 'where your DAT files are. Its sub-folders become the tree.'),
        h('li', {}, h('b', {}, 'ROM folder: '), 'where the collection lives. Each DAT gets a folder inside it with the same name.'),
        h('li', {}, h('b', {}, 'ToSort folder: '), 'new downloads go here; files nobody needs are moved here too.'),
        h('li', {}, 'Press ', h('b', {}, 'Update DATs'), ', then ', h('b', {}, 'Scan'), ', then ', h('b', {}, 'Fix'), '.')),
      s.canChange ? h('button', { class: 'btn btn-primary', onclick: () => this.settingsDialog() }, h('span', { html: I.gear }), 'Choose folders') : h('p', { class: 'notice' }, 'A parent or an admin sets ROM Librarian up.')));
  }

  renderDir(n) {
    const kids = n.children;
    const list = h('div', { class: 'rl-list' }, kids.map((k) => h('button', { class: 'rl-row rl-row-dir', onclick: () => this.select(k.path) },
      h('span', { class: 'rl-node-icon', html: k.kind === 'dat' ? I.dat : I.folder }),
      h('span', { class: 'rl-row-name' }, h('span', {}, k.title || k.name), h('span', { class: 'small muted' }, `${plural(k.counts.sets, 'set')} · ${k.counts.complete} complete${k.counts.fixable ? ` · ${k.counts.fixable} fixable` : ''}${k.counts.missing + k.counts.partial ? ` · ${k.counts.missing + k.counts.partial} incomplete` : ''}`)),
      bar(k.counts))));
    const files = h('div', {});
    clear(this.main, this.head(n, this.actions(n)), kids.length ? list : emptyState('No DATs in this folder'), files);
    if (n.counts.unknown || n.counts.del || n.counts.corrupt) this.filesInto(files, n.path, false);
  }

  actions(n) {
    const can = this.state.canChange;
    return h('div', { class: 'rl-actions' },
      can ? h('button', { class: 'btn btn-sm', onclick: () => this.rulesDialog(n) }, h('span', { html: I.gear }), 'Folder rules') : null,
      can && n.counts.need ? h('button', { class: 'btn btn-sm btn-primary', onclick: () => this.fixScope(n) }, h('span', { html: I.fix }), 'Fix here') : null,
      h('button', { class: 'btn btn-sm', onclick: () => this.openReport('fix', n.path) }, h('span', { html: I.report }), 'Report'));
  }

  async renderDat(n) {
    const filters = [['all', 'All'], ['have', 'Complete'], ['incomplete', 'Incomplete'], ['fixable', 'Fixable'], ['missing', 'Missing']];
    const search = h('input', { class: 'input rl-search', type: 'search', placeholder: 'Search sets', value: this.query, 'aria-label': 'Search sets' });
    const chips = h('div', { class: 'seg rl-seg' }, filters.map(([id, l]) => h('button', { class: `seg-btn${this.show === id ? ' active' : ''}`, onclick: () => { this.show = id; chips.querySelectorAll('.seg-btn').forEach((b, i) => b.classList.toggle('active', filters[i][0] === id)); refresh(); } }, l)));
    const info = h('div', { class: 'small muted rl-dat-info' });
    const list = h('div', { class: 'rl-list rl-sets' }, spinner());
    const files = h('div', {});
    const detail = h('div', { class: 'rl-detail', hidden: true });
    clear(this.main, this.head(n, this.actions(n)), info, h('div', { class: 'rl-filter' }, chips, search), list, files, detail);
    this.detailBox = detail;
    let offset = 0;
    let token = 0;
    const refresh = async (more = false) => {
      const my = ++token;
      if (!more) offset = 0;
      try {
        const r = await call('sets', { params: { path: n.path, show: this.show, q: this.query, offset, limit: 300 } });
        if (my !== token) return;
        info.textContent = [`${MERGE_LABEL[r.mode] || r.mode} sets`, FORMAT_LABEL[r.rule.format] + (r.rule.format === 'zip' && r.rule.torrentzip ? ' (TorrentZip)' : ''), r.file].filter(Boolean).join(' · ');
        if (!more) clear(list);
        list.querySelector('.rl-more')?.remove();
        if (!r.total) list.append(emptyState(this.query || this.show !== 'all' ? 'No sets match' : 'This DAT lists nothing to collect'));
        for (const s of r.sets) list.append(this.setRow(n, s));
        offset = r.offset + r.sets.length;
        if (offset < r.total) list.append(h('button', { class: 'btn rl-more', onclick: () => refresh(true) }, `Show more (${(r.total - offset).toLocaleString()} left)`));
      } catch (err) { clear(list, errorState(err, () => refresh())); }
    };
    search.addEventListener('input', debounce(() => { this.query = search.value.trim(); refresh(); }, 250));
    await refresh();
    if (n.counts.unknown || n.counts.del || n.counts.corrupt) this.filesInto(files, n.path, false);
  }

  setRow(n, s) {
    const [label, kind] = SET_STATES[s.status] || [s.status, 'none'];
    return h('button', { class: 'rl-row rl-set', dataset: { name: s.name }, onclick: () => this.openSet(n, s.name) },
      h('span', { class: `rl-dot rl-${kind}`, title: label }),
      h('span', { class: 'rl-row-name' }, h('span', {}, s.name, s.parent ? h('span', { class: 'small muted' }, ` · clone of ${s.parent}`) : null, s.bios ? h('span', { class: 'rl-tag' }, 'BIOS') : null),
        s.description && s.description !== s.name ? h('span', { class: 'small muted' }, s.description) : null),
      h('span', { class: 'rl-row-meta small muted' }, `${s.have}/${s.total}`, s.fix ? h('span', { class: 'rl-fixn' }, ` +${s.fix}`) : null, s.rezip ? h('span', { title: 'Will be rebuilt as TorrentZip' }, ' ↻') : null, s.extras ? h('span', { title: 'Files in the archive that don’t belong there' }, ` ·${s.extras} extra`) : null));
  }

  async openSet(n, name) {
    const box = this.detailBox;
    this.main.querySelectorAll('.rl-set').forEach((r) => r.classList.toggle('sel', r.dataset.name === name));
    box.hidden = false;
    this.root.classList.add('rl-has-detail');
    clear(box, spinner());
    try {
      const d = await call('set', { params: { path: n.path, name } });
      const [label, kind] = SET_STATES[d.status] || [d.status, 'none'];
      const rows = d.items.map((it) => {
        const [sl, sk] = STATES[it.state] || [it.state, 'none'];
        return h('div', { class: 'rl-item' },
          h('span', { class: `rl-dot rl-${sk}`, title: sl }),
          h('div', { class: 'rl-item-main' },
            h('div', { class: 'rl-item-name' }, it.name, it.disk ? h('span', { class: 'rl-tag' }, 'disk') : null, it.baddump ? h('span', { class: 'rl-tag rl-bad' }, 'bad dump') : null, it.header ? h('span', { class: 'rl-tag', title: `Has a ${it.header} header, which the DAT leaves out` }, 'headered') : null),
            h('div', { class: 'small muted rl-hash' }, [it.size != null ? formatBytes(it.size) : null, it.crc ? `CRC ${it.crc}` : null, it.sha1 ? `SHA-1 ${it.sha1}` : null].filter(Boolean).join(' · ')),
            it.from ? h('div', { class: 'small rl-from' }, it.state === 'rename' ? `Now named “${it.from.name}”` : `From ${it.from.region === 'tosort' ? 'ToSort: ' : ''}${it.from.file}${it.from.name ? ` → ${it.from.name}` : ''}`) : null),
          pill(sl, sk));
      });
      const extras = d.extras.map((e) => {
        const [sl, sk] = STATES[e.state] || [e.state, 'none'];
        return h('div', { class: 'rl-item' }, h('span', { class: `rl-dot rl-${sk}` }), h('div', { class: 'rl-item-main' }, h('div', { class: 'rl-item-name' }, e.name), h('div', { class: 'small muted' }, e.usedBy?.length ? `Needed by ${e.usedBy.join(', ')}` : e.corrupt || [e.size != null ? formatBytes(e.size) : null, e.crc ? `CRC ${e.crc}` : null].filter(Boolean).join(' · '))), pill(sl, sk));
      });
      clear(box,
        h('div', { class: 'rl-detail-head' },
          h('button', { class: 'btn btn-sm btn-icon rl-detail-back', 'aria-label': 'Back to the list', html: I.back, onclick: () => this.closeDetail() }),
          h('div', { class: 'rl-detail-title' }, h('h3', {}, d.name), h('div', { class: 'small muted' }, [d.description !== d.name ? d.description : null, d.year, d.manufacturer, d.parent ? `clone of ${d.parent}` : null].filter(Boolean).join(' · '))),
          pill(label, kind), h('button', { class: 'btn btn-sm btn-icon rl-detail-close', 'aria-label': 'Close', html: icon.x, onclick: () => this.closeDetail() })),
        h('div', { class: 'small muted rl-loc' }, d.found ? `${d.found}${d.format === 'zip' ? (d.tz ? ' · TorrentZip' : ' · not TorrentZip yet') : ''}` : `Not on disk yet · would be ${d.location}`),
        h('div', { class: 'rl-items' }, rows),
        extras.length ? [h('h4', { class: 'rl-sub' }, 'Also in there'), h('div', { class: 'rl-items' }, extras)] : null);
      box.scrollIntoView?.({ block: 'nearest' });
    } catch (err) { clear(box, errorState(err)); }
  }
  closeDetail() {
    if (!this.detailBox) return;
    this.detailBox.hidden = true;
    this.root.classList.remove('rl-has-detail');
    this.main.querySelectorAll('.rl-set.sel').forEach((r) => r.classList.remove('sel'));
  }

  renderFiles(n) {
    const box = h('div', {});
    clear(this.main, this.head(n), box);
    this.filesInto(box, n.path, true);
  }
  async filesInto(box, p, isToSort) {
    clear(box, spinner());
    try {
      const r = await call('files', { params: { path: p } });
      clear(box);
      if (!r.files.length) { box.append(emptyState(isToSort ? 'This ToSort folder is empty' : 'Nothing extra here')); return; }
      box.append(h('h4', { class: 'rl-sub' }, isToSort ? 'Files' : 'Files no set here needs'));
      const list = h('div', { class: 'rl-items' });
      for (const f of r.files) {
        const name = f.file.split(/[\\/]/).pop();
        if (f.state) { const [sl, sk] = STATES[f.state] || [f.state, 'corrupt']; list.append(h('div', { class: 'rl-item' }, h('span', { class: `rl-dot rl-${sk}` }), h('div', { class: 'rl-item-main' }, h('div', { class: 'rl-item-name' }, name), h('div', { class: 'small muted' }, f.corrupt || f.file)), pill(sl, sk))); continue; }
        for (const e of f.entries) {
          const [sl, sk] = STATES[e.state] || [e.state, 'none'];
          list.append(h('div', { class: 'rl-item' }, h('span', { class: `rl-dot rl-${sk}` }),
            h('div', { class: 'rl-item-main' }, h('div', { class: 'rl-item-name' }, f.kind === 'file' ? name : `${name} › ${e.name}`),
              h('div', { class: 'small muted' }, e.usedBy?.length ? `Needed by ${e.usedBy.join(', ')}` : e.corrupt || [e.size != null ? formatBytes(e.size) : null, e.crc ? `CRC ${e.crc}` : null, e.header ? `${e.header} header` : null].filter(Boolean).join(' · '))),
            pill(sl, sk)));
        }
      }
      box.append(list);
    } catch (err) { clear(box, errorState(err)); }
  }

  // --- Jobs -----------------------------------------------------------------------------------------------
  scanMenu(e) {
    const r = e.currentTarget.getBoundingClientRect();
    contextMenu(r.left, r.bottom + 4, [
      { label: 'Update DATs and scan', icon: I.dats, action: () => this.runJob('update') },
      '-',
      ...Object.entries(LEVEL_LABEL).map(([lv, l]) => ({ label: `${l.split(' (')[0]} scan`, icon: I.scan, checked: this.state.settings.scanLevel === lv, action: () => this.runJob('scan', { level: lv }) })),
    ]);
  }
  async fixAll() { return this.fixScope(this.state.tree?.root || { path: '', counts: {} }); }
  async fixScope(n) {
    const c = n.counts || {};
    if (!c.need && !c.unknown && !c.del && !c.corrupt) { toast('Nothing to fix', { body: 'Scan first if you’ve added files.' }); return; }
    const where = n.path ? `“${n.name}”` : 'the whole collection';
    const ok = await confirmDialog({ title: `Fix ${where}?`, message: `${c.need ? `${plural(c.need, 'set')} will be built or tidied. ` : ''}${c.unknown ? `${plural(c.unknown, 'file')} no DAT needs will move to ToSort. ` : ''}${c.del ? `${plural(c.del, 'duplicate')} will be deleted (a checked copy is kept). ` : ''}${c.corrupt ? `${c.corrupt} damaged file(s) will move to ToSort\\Corrupt. ` : ''}Files used from ToSort are moved into place.`, confirm: 'Fix' });
    if (ok) this.runJob('fix', { path: n.path });
  }
  async runJob(type, extra = {}) {
    try { const r = await call('jobs', { method: 'POST', body: { type, ...extra } }); this.watchJob(r.job); } catch (err) { toastError(err, 'Couldn’t start'); }
  }
  watchJob(j) {
    clearTimeout(this.jobTimer);
    if (!j || j.state !== 'running') { this.progress.hidden = true; this.root.classList.remove('rl-busy'); return; }
    this.root.classList.add('rl-busy');
    this.progress.hidden = false;
    const tick = async () => {
      let r;
      try { r = await call('job'); } catch { this.jobTimer = setTimeout(tick, 2000); return; }
      const job = r.job;
      if (!this.root.isConnected) return;
      if (job?.state === 'running') {
        const p = job.total ? Math.min(100, Math.round((job.done / job.total) * 100)) : 0;
        clear(this.progress,
          h('div', { class: 'rl-progress-row' }, h('b', {}, job.phase || job.label), h('span', { class: 'small muted rl-progress-cur' }, job.sub ? `${job.current} › ${job.sub}` : job.current), h('span', { class: 'small' }, job.total ? `${job.done.toLocaleString()} / ${job.total.toLocaleString()}` : ''),
            this.state.canChange ? h('button', { class: 'btn btn-sm', onclick: () => call('job/cancel', { method: 'POST' }).catch((e) => toastError(e)) }, 'Cancel') : null),
          h('div', { class: 'progress' }, h('div', { class: `progress-fill${job.total ? '' : ' rl-indeterminate'}`, style: { width: `${job.total ? p : 30}%` } })));
        this.jobTimer = setTimeout(tick, 500);
        return;
      }
      this.progress.hidden = true;
      this.root.classList.remove('rl-busy');
      if (job?.state === 'done') toast(job.label, { type: 'success', icon: appIcon.roms, body: job.log.slice(-2).join(' '), action: job.type === 'fix' || job.type === 'all' ? { label: 'Details', onClick: () => window.open('/portal/roms/log', '_blank', 'noopener') } : null });
      else if (job?.state === 'error') toast(job.label, { type: 'error', body: job.error, timeout: 10000 });
      else if (job?.state === 'cancelled') toast(`${job.label}: cancelled`);
      this.load();
    };
    this.jobTimer = setTimeout(tick, 300);
  }

  // --- Reports ---------------------------------------------------------------------------------------------
  reportsMenu(e) {
    const r = e.currentTarget.getBoundingClientRect();
    const p = this.selected.startsWith('tosort:') ? '' : this.selected;
    const where = p ? ` (${p.split('/').pop()})` : '';
    contextMenu(r.left, r.bottom + 4, [
      { label: `Fix report${where}`, icon: I.report, action: () => this.openReport('fix', p) },
      { label: `Missing files${where}`, icon: I.report, action: () => this.openReport('missing', p) },
      { label: `Full report${where}`, icon: I.report, action: () => this.openReport('full', p) },
      '-',
      { label: `Download fix DATs${where}`, icon: icon.download || I.dats, action: () => this.download(`fixdat?path=${encodeURIComponent(p)}`) },
      { label: 'Save fix DATs to the fix DAT folder', icon: icon.folder, disabled: !this.state.canChange || !this.state.settings.fixDatFolder, action: () => this.saveFixDats(p) },
      '-',
      { label: 'What the last fix did', icon: I.fix, disabled: !this.state.lastLog, action: () => window.open('/portal/roms/log', '_blank', 'noopener') },
    ]);
  }
  openReport(kind, p) { window.open(`/portal/roms/report?kind=${kind}&path=${encodeURIComponent(p || '')}`, '_blank', 'noopener'); }
  async download(route) {
    try {
      const res = await fetch(`/portal/roms/${route}`, { credentials: 'same-origin' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || 'fixdat.dat';
      const url = URL.createObjectURL(await res.blob());
      const a = h('a', { href: url, download: name });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) { toastError(err, 'No fix DAT'); }
  }
  async saveFixDats(p) {
    try { const r = await call('fixdats', { method: 'POST', body: { path: p } }); toast(r.saved ? `${plural(r.saved, 'fix DAT')} saved` : 'Nothing is missing', { body: r.saved ? r.folder : '', type: 'success', icon: appIcon.roms }); } catch (err) { toastError(err, 'Couldn’t save fix DATs'); }
  }

  // --- Settings -----------------------------------------------------------------------------------------------
  async settingsDialog() {
    const s = (await call('settings').catch(() => null)) || this.state.settings;
    const can = this.state.canChange;
    const mock = this.state.mock;
    const inp = (v, ph) => h('input', { class: 'input', value: v || '', placeholder: ph, spellcheck: 'false', disabled: !can || mock });
    const dat = inp(s.datRoot, 'For example D:\\ROMs\\DATs');
    const rom = inp(s.romRoot, 'For example D:\\ROMs\\Collection');
    const fixd = h('input', { class: 'input', value: s.fixDatFolder || '', placeholder: 'Optional, for example D:\\ROMs\\FixDATs', spellcheck: 'false', disabled: !can });
    const tsList = h('div', { class: 'rl-ts-list' });
    const toSort = (s.toSort || []).map((t) => ({ ...t }));
    const drawTs = () => {
      clear(tsList, toSort.map((t, i) => h('div', { class: 'rl-ts-row' },
        h('input', { class: 'input', value: t.path, spellcheck: 'false', disabled: !can || mock, placeholder: 'For example D:\\ROMs\\ToSort', oninput: (e) => { t.path = e.target.value; } }),
        h('label', { class: 'small rl-ts-primary', title: 'Files nobody needs are moved to the primary ToSort folder' }, h('input', { type: 'radio', name: 'rl-primary', checked: t.primary, disabled: !can || mock, onchange: () => { toSort.forEach((x, j) => { x.primary = j === i; }); } }), 'Primary'),
        can && !mock ? h('button', { class: 'btn btn-sm btn-icon', type: 'button', 'aria-label': 'Remove', html: icon.x, onclick: () => { toSort.splice(i, 1); drawTs(); } }) : null)),
      can && !mock ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { toSort.push({ path: '', primary: !toSort.length }); drawTs(); tsList.querySelector('.rl-ts-row:last-of-type input')?.focus(); } }, h('span', { html: icon.plus }), 'Add a ToSort folder') : null);
    };
    drawTs();
    const ignore = h('textarea', { class: 'input rl-ignore', rows: 3, spellcheck: 'false', disabled: !can }, (s.ignore || []).join('\n'));
    const level = selectOf(LEVEL_LABEL, s.scanLevel); level.disabled = !can;
    const dupes = h('input', { type: 'checkbox', checked: s.deleteToSortDupes, disabled: !can });
    const empty = h('input', { type: 'checkbox', checked: s.removeEmptyFolders, disabled: !can });
    await dialog('ROM Librarian settings', [
      mock ? h('div', { class: 'notice small' }, 'Demo mode: the folders hold a small made-up collection and can’t be changed. Everything else can be tried.') : null,
      !can ? h('div', { class: 'notice small' }, 'Only a parent or an admin can change these.') : null,
      field('DAT folder', dat, 'Your DAT files. Sub-folders become folders in the tree; a folder with several DATs gets one sub-folder per DAT.'),
      field('ROM folder', rom, 'The collection. Each tree folder (and DAT) has a folder of the same name in here, unless its folder rules pick another place.'),
      h('div', { class: 'field rl-field' }, h('span', {}, 'ToSort folders'), tsList, h('span', { class: 'small muted' }, 'Scanned for files to use in fixes. Files no DAT needs go to the primary one.')),
      field('Fix DAT folder', fixd, 'Where “Save fix DATs” writes a DAT of what’s missing, per DAT.'),
      field('Scan', level),
      field('Ignore these files', ignore, 'One name per line; * and ? work as wildcards. Ignored files are never scanned, moved or deleted.'),
      h('label', { class: 'pref-row' }, dupes, h('span', {}, 'Delete files in ToSort that the collection already has')),
      h('label', { class: 'pref-row' }, empty, h('span', {}, 'Remove empty folders after fixing')),
      h('p', { class: 'small muted' }, `7-Zip on the server: ${s.sevenZip ? 'found (7z archives can be read and made)' : 'not found — 7z archives are skipped. Install 7-Zip (see Settings → Files).'}`),
    ], {
      ok: can ? 'Save' : null, cancel: can ? 'Cancel' : 'Close', wide: true,
      onOk: async () => {
        const body = { fixDatFolder: fixd.value, ignore: ignore.value.split(/\r?\n/), scanLevel: level.value, deleteToSortDupes: dupes.checked, removeEmptyFolders: empty.checked };
        if (!mock) Object.assign(body, { datRoot: dat.value, romRoot: rom.value, toSort: toSort.filter((t) => t.path.trim()) });
        await call('settings', { method: 'POST', body });
        toast('ROM Librarian settings saved', { type: 'success', icon: appIcon.roms });
        await this.load();
        return true;
      },
    });
  }

  async rulesDialog(n) {
    const s = await call('settings');
    const own = s.rules[n.path] || {};
    const opt = (map) => ({ '': 'Same as the folder above', ...map });
    const merge = selectOf(opt(MERGE_LABEL), own.merge || '');
    const format = selectOf(opt(FORMAT_LABEL), own.format || '');
    const tz = selectOf({ '': 'Same as the folder above', yes: 'Yes', no: 'No' }, own.torrentzip === undefined ? '' : own.torrentzip ? 'yes' : 'no');
    const filter = selectOf(opt(FILTER_LABEL), own.filter || '');
    const folder = h('input', { class: 'input', value: own.romFolder || '', spellcheck: 'false', placeholder: n.romDir || 'Inside the ROM folder' });
    await dialog(`Folder rules: ${n.path ? n.name : 'All DATs'}`, [
      h('p', { class: 'small muted' }, 'These apply to this folder and everything in it, unless a folder further down has its own.'),
      field('Sets', merge, 'Split: each set has only its own files (clones need the parent, games need the BIOS). Merged: clones are kept inside the parent’s archive. Non-merged: every set stands alone (BIOS kept apart).'),
      field('Keep sets as', format),
      field('TorrentZip ZIPs', tz, 'Rebuilt ZIPs use TorrentZip’s fixed order, dates and compression, so the same set makes the same file anywhere.'),
      field('Collect', filter),
      field('ROM folder for this', folder, 'Leave empty to keep it inside the main ROM folder. Another drive works too.'),
    ], {
      onOk: async () => {
        const rule = {};
        if (merge.value) rule.merge = merge.value;
        if (format.value) rule.format = format.value;
        if (tz.value) rule.torrentzip = tz.value === 'yes';
        if (filter.value) rule.filter = filter.value;
        if (folder.value.trim()) rule.romFolder = folder.value.trim();
        await call('settings', { method: 'POST', body: { rules: { [n.path]: Object.keys(rule).length ? rule : null } } });
        toast('Folder rules saved', { body: 'Scan or Fix uses them from now on.', type: 'success', icon: appIcon.roms });
        await this.load({ keepMain: false });
        return true;
      },
    });
  }
}

function stat(n, label, kind) {
  return h('div', { class: `rl-stat rl-${kind}` }, h('b', {}, (n || 0).toLocaleString()), h('span', { class: 'small' }, label));
}

export const romsApp = {
  id: 'roms', name: 'ROM Librarian', icon: appIcon.roms, size: [1100, 700], description: 'Match your ROMs to DATs, fix and rebuild sets',
  open(win) {
    const app = new Librarian(win);
    win.on('reopen', () => app.load({ keepMain: true }));
  },
};

// For Settings → ROM Librarian: the main folders, saved straight to the app's own settings.
export async function renderRomsSettings(container, { section }) {
  loadCss();
  const box = h('div', {}, spinner());
  container.append(h('div', { class: 'pane-header' }, h('span', { class: 'settings-app-icon', html: appIcon.roms }), h('h2', {}, 'ROM Librarian')), box);
  try {
    const st = await call('state');
    const s = st.settings;
    const can = st.canChange && !st.mock;
    const dat = h('input', { class: 'input', value: s.datRoot, disabled: !can, spellcheck: 'false', placeholder: 'For example D:\\ROMs\\DATs' });
    const rom = h('input', { class: 'input', value: s.romRoot, disabled: !can, spellcheck: 'false', placeholder: 'For example D:\\ROMs\\Collection' });
    const ts = h('input', { class: 'input', value: (s.toSort.find((t) => t.primary) || s.toSort[0])?.path || '', disabled: !can, spellcheck: 'false', placeholder: 'For example D:\\ROMs\\ToSort' });
    const save = h('button', { class: 'btn btn-primary', disabled: !can }, h('span', { html: icon.check }), 'Save folders');
    save.onclick = async () => {
      save.disabled = true;
      try {
        const others = s.toSort.filter((t) => !t.primary);
        await call('settings', { method: 'POST', body: { datRoot: dat.value, romRoot: rom.value, toSort: ts.value.trim() ? [{ path: ts.value, primary: true }, ...others] : others } });
        toast('ROM Librarian folders saved', { type: 'success', icon: appIcon.roms });
      } catch (err) { toastError(err, 'Could not save'); } finally { save.disabled = !can; }
    };
    clear(box,
      st.mock ? h('div', { class: 'notice' }, 'Demo mode: ROM Librarian has a small made-up collection, and its folders can’t be changed.') : null,
      !st.canChange ? h('div', { class: 'notice' }, 'Only a parent or an admin can change ROM Librarian’s folders.') : null,
      section('Folders',
        h('p', { class: 'muted small' }, 'Full paths on the computer running MediaDesk. More ToSort folders, ignore lists, scan depth and per-folder rules (split, merged or non-merged sets; ZIP, 7z or folders; TorrentZip; another drive for a folder) are in ROM Librarian itself (⚙ and right-click a folder).'),
        h('label', { class: 'field' }, h('span', {}, 'DAT folder'), dat),
        h('label', { class: 'field' }, h('span', {}, 'ROM folder'), rom),
        h('label', { class: 'field' }, h('span', {}, 'Primary ToSort folder'), ts),
        h('div', { class: 'btn-row' }, save, h('button', { class: 'btn', onclick: () => import('../wm.js').then((wm) => wm.openApp('roms')) }, h('span', { html: icon.external }), 'Open ROM Librarian'))),
      section('Collection',
        h('p', { class: 'muted small' }, `${st.dats} DAT${st.dats === 1 ? '' : 's'} loaded · ${st.scanned.toLocaleString()} files scanned${st.tree ? ` · ${st.tree.root.counts.complete.toLocaleString()} of ${st.tree.root.counts.sets.toLocaleString()} sets complete` : ''}`),
        h('p', { class: 'muted small' }, s.sevenZip ? '7-Zip found: 7z archives can be read and made.' : '7-Zip wasn’t found, so 7z archives are skipped. Install it (Settings → Files).')));
  } catch (err) { clear(box, errorState(err)); }
}
