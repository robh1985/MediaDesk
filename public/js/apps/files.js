// Files: a file manager for the folders shared in Settings → Files.

import { h, clear, formatBytes, debounce, toast, toastError, confirmDialog, contextMenu, spinner, emptyState, errorState, progressBar } from '../ui.js';
import { icon, appIcon } from '../icons.js';
import { state } from '../api.js';
import { openApp } from '../wm.js';

// --- API -----------------------------------------------------------------------

async function call(route, { method = 'GET', params, body } = {}) {
  const qs = params ? `?${new URLSearchParams(params)}` : '';
  const res = await fetch(`/portal/files/${route}${qs}`, {
    method, credentials: 'same-origin',
    headers: { 'X-MediaDesk': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status });
  return data;
}
const fileUrl = (root, p, inline) => `/portal/files/download?${new URLSearchParams({ root, path: p, ...(inline ? { inline: 1 } : {}) })}`;
const join = (dir, name) => (dir ? `${dir}/${name}` : name);
const parentOf = (p) => p.split('/').slice(0, -1).join('/');

// Shared between windows so you can copy in one folder and paste in another.
const clipboard = { mode: null, root: null, paths: [] };

const ICON_CUT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="6" cy="18" r="3"/><circle cx="18" cy="18" r="3"/><path d="M8 16 20 4M16 16 4 4"/></svg>';
const ICON_COPY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>';
const ICON_RENAME = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13 7 4 4"/></svg>';
const ICON_PASTE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6"/></svg>';

// --- File types ----------------------------------------------------------------

const KINDS = {
  video: ['mkv', 'mp4', 'm4v', 'avi', 'mov', 'wmv', 'webm', 'ts', 'm2ts', 'mpg', 'mpeg', 'flv'],
  audio: ['mp3', 'flac', 'm4a', 'aac', 'ogg', 'opus', 'wav', 'wma', 'alac'],
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif', 'tbn'],
  text: ['txt', 'nfo', 'srt', 'ass', 'ssa', 'sub', 'vtt', 'log', 'md', 'json', 'xml', 'yml', 'yaml', 'ini', 'conf', 'cfg', 'config', 'csv',
    'tsv', 'sh', 'bat', 'cmd', 'ps1', 'py', 'js', 'ts', 'css', 'html', 'htm', 'env', 'properties', 'toml', 'm3u', 'm3u8', 'cue', 'sfv', 'nzb'],
  archive: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso', 'r00', 'r01', 'par2'],
  pdf: ['pdf'],
};
const extOf = (name) => (name.includes('.') ? name.split('.').pop().toLowerCase() : '');
function kindOf(entry) {
  if (entry.dir) return 'folder';
  const ext = extOf(entry.name);
  if (/^r\d\d$/.test(ext) || /^part\d*$/.test(ext)) return 'archive';
  return Object.keys(KINDS).find((k) => KINDS[k].includes(ext)) || 'file';
}
const PLAYABLE = { video: ['mp4', 'm4v', 'webm', 'mov', 'mkv'], audio: ['mp3', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'wav'] };
const KIND_LABEL = { folder: 'Folder', video: 'Video', audio: 'Audio', image: 'Image', text: 'Text', archive: 'Archive', pdf: 'PDF', file: 'File' };
const KIND_COLOR = { folder: '#f5b82e', video: '#8b5cf6', audio: '#ec4899', image: '#10b981', text: '#64748b', archive: '#f97316', pdf: '#ef4444', file: '#94a3b8' };

function fileIcon(kind) {
  const c = KIND_COLOR[kind];
  if (kind === 'folder') {
    return `<svg viewBox="0 0 24 24"><path d="M2.5 6.5A2 2 0 0 1 4.5 4.5h4.2l2 2h8.8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2z" fill="${c}"/><path d="M2.5 9h19v8.5a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2z" fill="#fff" opacity=".22"/></svg>`;
  }
  const glyph = {
    video: '<path d="M10 11.5v5l4-2.5z" fill="#fff"/>',
    audio: '<path d="M11 16.5a1.5 1.5 0 1 1-1.5-1.5H11v-4.5l3-1v1.5l-2 .6v4.9z" fill="#fff"/>',
    image: '<path d="m7.5 17 3-3.5 2 2 1.5-1.5 2.5 3z" fill="#fff"/><circle cx="10" cy="11" r="1.2" fill="#fff"/>',
    text: '<path d="M8 11h8M8 13.5h8M8 16h5" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/>',
    archive: '<path d="M12 9v1.5M12 11.5V13M12 14v1.5" stroke="#fff" stroke-width="1.6"/><rect x="10.8" y="15.5" width="2.4" height="2" rx=".5" fill="#fff"/>',
    pdf: '<text x="12" y="16.8" font-size="5" font-family="system-ui,sans-serif" font-weight="800" text-anchor="middle" fill="#fff">PDF</text>',
    file: '',
  }[kind];
  return `<svg viewBox="0 0 24 24"><path d="M6 2.5h8l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-17a1 1 0 0 1 1-1z" fill="${c}"/><path d="M14 2.5v4a1 1 0 0 0 1 1h4" fill="#fff" opacity=".45"/>${glyph}</svg>`;
}

// --- App -----------------------------------------------------------------------

export const filesApp = {
  id: 'files', name: 'Files', icon: appIcon.files, size: [1080, 700], description: 'Manage files on the server',
  open(win, opts = {}) {
    const status = state.config.files;
    if (!status?.enabled) return clear(win.body, filesDisabled(status));
    new FileBrowser(win, opts);
  },
};

function filesDisabled(status) {
  const needsPassword = status?.reason === 'password';
  return h('div', { class: 'empty not-configured' },
    h('div', { class: 'big-icon', html: appIcon.files }),
    h('div', { class: 'empty-title' }, needsPassword ? 'Files needs a portal password' : 'No folders shared yet'),
    h('div', {}, needsPassword
      ? 'Files can change anything in the folders you share, so it only works when MediaDesk is protected by a password. On Windows, run install-windows.cmd again to set one; otherwise set PORTAL_PASSWORD.'
      : 'Choose which folders on the server MediaDesk may manage.'),
    needsPassword ? null : h('button', { class: 'btn btn-primary', onclick: () => openApp('settings', { tab: 'files' }) }, 'Choose folders'));
}

class FileBrowser {
  constructor(win, opts) {
    this.win = win;
    this.roots = [];
    this.root = 0;
    this.path = '';
    this.entries = [];
    this.selected = new Set();
    this.anchor = null;
    this.history = [];
    this.future = [];
    this.sort = JSON.parse(localStorage.getItem('mediadesk.files.sort') || '{"key":"name","dir":1}');
    this.showHidden = localStorage.getItem('mediadesk.files.hidden') === '1';
    this.build();
    this.loadRoots().then(() => this.go(opts.root ?? 0, opts.path ?? '', false));
    win.on('reopen', (o) => { if (o?.root !== undefined) this.go(o.root, o.path || ''); });
  }

  // ---- Layout ----
  build() {
    const b = (title, ic, onclick, extra = {}) => h('button', { class: 'btn btn-icon btn-sm', title, 'aria-label': title, html: ic, onclick, ...extra });
    this.backBtn = b('Back', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 5l-7 7 7 7"/></svg>', () => this.back());
    this.fwdBtn = b('Forward', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 5l7 7-7 7"/></svg>', () => this.forward());
    this.upBtn = b('Up one level', icon.arrowUp, () => this.up());
    this.crumbs = h('div', { class: 'fm-crumbs' });
    this.filter = h('input', { class: 'input fm-filter', type: 'search', placeholder: 'Filter this folder…' });
    this.filter.addEventListener('input', debounce(() => this.render(), 120));

    const act = (label, ic, onclick, cls = '') => h('button', { class: `btn btn-sm ${cls}`, title: label, onclick }, h('span', { html: ic }), h('span', { class: 'fm-btn-label' }, label));
    this.uploadInput = h('input', { type: 'file', multiple: true, hidden: true, onchange: () => { this.upload([...this.uploadInput.files]); this.uploadInput.value = ''; } });
    this.pasteBtn = act('Paste', ICON_PASTE, () => this.paste());
    this.selActions = [
      act('Cut', ICON_CUT, () => this.toClipboard('move')),
      act('Copy', ICON_COPY, () => this.toClipboard('copy')),
      act('Rename', ICON_RENAME, () => this.rename()),
      act('Download', icon.download, () => this.download()),
      act('Delete', icon.trash, () => this.remove(), 'btn-danger'),
    ];
    this.hiddenToggle = h('input', { type: 'checkbox', checked: this.showHidden, onchange: () => {
      this.showHidden = this.hiddenToggle.checked;
      try { localStorage.setItem('mediadesk.files.hidden', this.showHidden ? '1' : '0'); } catch { /* ignore */ }
      this.refresh();
    } });

    this.sidebar = h('nav', { class: 'app-sidebar fm-sidebar' });
    this.list = h('div', { class: 'fm-list', tabindex: 0 });
    this.statusBar = h('div', { class: 'fm-status small muted' });
    this.uploads = h('div', { class: 'fm-uploads', hidden: true });
    this.dropHint = h('div', { class: 'fm-drop' }, h('span', { html: icon.download }), 'Drop to upload here');

    const main = h('div', { class: 'fm-main' },
      h('div', { class: 'fm-toolbar' }, this.backBtn, this.fwdBtn, this.upBtn, this.crumbs,
        b('Refresh', icon.refresh, () => this.refresh()), this.filter),
      h('div', { class: 'fm-actions' },
        act('New folder', icon.folder, () => this.newFolder()),
        act('Upload', icon.arrowUp, () => this.uploadInput.click()), this.uploadInput,
        h('span', { class: 'fm-sep' }), ...this.selActions, this.pasteBtn,
        h('div', { class: 'spacer' }),
        h('label', { class: 'check small' }, this.hiddenToggle, ' Hidden files')),
      this.list, this.statusBar, this.uploads, this.dropHint);
    this.win.body.append(h('div', { class: 'app-layout fm' }, this.sidebar, main));

    this.list.addEventListener('keydown', (e) => this.onKey(e));
    this.list.addEventListener('click', (e) => { if (e.target === this.list || e.target.classList.contains('fm-rows')) this.select([]); });
    this.list.addEventListener('contextmenu', (e) => {
      if (e.target.closest('.fm-row')) return;
      e.preventDefault();
      this.select([]);
      contextMenu(e.clientX, e.clientY, [
        { label: 'New folder', icon: icon.folder, action: () => this.newFolder() },
        { label: 'Upload files…', icon: icon.arrowUp, action: () => this.uploadInput.click() },
        { label: clipboard.paths.length ? `Paste ${clipboard.paths.length} item${clipboard.paths.length > 1 ? 's' : ''}` : 'Paste', icon: ICON_PASTE, disabled: !clipboard.paths.length, action: () => this.paste() },
        '-', { label: 'Refresh', icon: icon.refresh, action: () => this.refresh() },
      ]);
    });

    // Drag files in from the computer to upload them.
    let depth = 0;
    main.addEventListener('dragenter', (e) => { if (e.dataTransfer.types.includes('Files')) { depth++; main.classList.add('dragging-files'); } });
    main.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; main.classList.remove('dragging-files'); } });
    main.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
    main.addEventListener('drop', (e) => {
      depth = 0; main.classList.remove('dragging-files');
      if (!e.dataTransfer.files.length) return;
      e.preventDefault();
      this.upload([...e.dataTransfer.files]);
    });
  }

  async loadRoots() {
    try { this.roots = await call('roots'); } catch (err) { this.roots = []; toastError(err); }
    clear(this.sidebar,
      h('div', { class: 'fm-side-title' }, 'Shared folders'),
      this.roots.map((r) => {
        const used = r.total ? ((r.total - r.free) / r.total) * 100 : 0;
        const btn = h('button', { class: 'nav-item fm-root', dataset: { root: r.id }, title: r.path, onclick: () => this.go(r.id, '') },
          h('span', { class: 'nav-icon', html: r.ok ? fileIcon('folder') : icon.alert }),
          h('span', { class: 'fm-root-text' }, h('span', {}, r.name),
            r.total ? h('span', { class: 'fm-root-free' }, progressBar(used, used > 90 ? 'bad' : used > 75 ? 'warn' : ''), `${formatBytes(r.free)} free`) : null));
        this.dropTarget(btn, () => ({ root: r.id, path: '' }));
        return btn;
      }),
      h('div', { class: 'spacer' }),
      h('button', { class: 'nav-item small', onclick: () => openApp('settings', { tab: 'files' }) }, h('span', { class: 'nav-icon', html: icon.sliders }), 'Manage folders'));
  }

  // ---- Navigation ----
  async go(root, path, record = true) {
    if (!this.roots[root]) return clear(this.list, emptyState('Folder unavailable'));
    if (record && (root !== this.root || path !== this.path)) { this.history.push([this.root, this.path]); this.future = []; }
    this.root = root;
    this.path = path;
    this.filter.value = '';
    this.selected.clear();
    await this.refresh();
    this.list.focus({ preventScroll: true });
  }
  back() { const prev = this.history.pop(); if (prev) { this.future.push([this.root, this.path]); this.go(prev[0], prev[1], false); } }
  forward() { const next = this.future.pop(); if (next) { this.history.push([this.root, this.path]); this.go(next[0], next[1], false); } }
  up() { if (this.path) this.go(this.root, parentOf(this.path)); }

  async refresh() {
    const root = this.roots[this.root];
    this.sidebar.querySelectorAll('.fm-root').forEach((el) => el.classList.toggle('active', Number(el.dataset.root) === this.root));
    this.win.setTitle(this.path ? `Files — ${this.path.split('/').pop()}` : `Files — ${root?.name || ''}`);
    this.renderCrumbs();
    if (!this.entries.length) clear(this.list, spinner());
    try {
      const data = await call('list', { params: { root: this.root, path: this.path, hidden: this.showHidden ? 1 : 0 } });
      this.entries = data.entries;
      const names = new Set(this.entries.map((e) => e.name));
      this.selected = new Set([...this.selected].filter((n) => names.has(n)));
      this.render();
    } catch (err) {
      this.entries = [];
      clear(this.list, errorState(err, () => this.refresh()));
      this.updateStatus();
    }
  }

  renderCrumbs() {
    const root = this.roots[this.root];
    const parts = this.path ? this.path.split('/') : [];
    const crumb = (label, p) => {
      const el = h('button', { class: 'fm-crumb', onclick: () => this.go(this.root, p) }, label);
      this.dropTarget(el, () => ({ root: this.root, path: p }));
      return el;
    };
    clear(this.crumbs, crumb(root?.name || '…', ''), parts.map((name, i) => [h('span', { class: 'fm-crumb-sep' }, '›'), crumb(name, parts.slice(0, i + 1).join('/'))]));
    this.crumbs.scrollLeft = this.crumbs.scrollWidth;
    this.backBtn.disabled = !this.history.length;
    this.fwdBtn.disabled = !this.future.length;
    this.upBtn.disabled = !this.path;
  }

  // ---- Listing ----
  visible() {
    const q = this.filter.value.trim().toLowerCase();
    const { key, dir } = this.sort;
    const val = (e) => key === 'size' ? (e.size ?? -1) : key === 'modified' ? (e.modified ?? 0) : key === 'type' ? KIND_LABEL[kindOf(e)] + extOf(e.name) : e.name.toLowerCase();
    return this.entries
      .filter((e) => !q || e.name.toLowerCase().includes(q))
      .sort((a, b) => (b.dir - a.dir) || (val(a) < val(b) ? -dir : val(a) > val(b) ? dir : a.name.localeCompare(b.name, undefined, { numeric: true })));
  }

  render() {
    const items = this.visible();
    const head = (key, label) => h('button', { class: `fm-th ${this.sort.key === key ? 'sorted' : ''}`, onclick: () => {
      this.sort = { key, dir: this.sort.key === key ? -this.sort.dir : 1 };
      try { localStorage.setItem('mediadesk.files.sort', JSON.stringify(this.sort)); } catch { /* ignore */ }
      this.render();
    } }, label, this.sort.key === key ? (this.sort.dir > 0 ? ' ↑' : ' ↓') : '');
    const rows = h('div', { class: 'fm-rows' });
    clear(this.list, h('div', { class: 'fm-row fm-head' }, h('span'), head('name', 'Name'), head('modified', 'Modified'), head('type', 'Type'), head('size', 'Size')), rows);
    if (!items.length) rows.append(emptyState(this.entries.length ? 'Nothing matches the filter' : 'This folder is empty', this.entries.length ? '' : 'Drag files here to upload them.'));

    // Large folders render in chunks as you scroll.
    let shown = 0;
    const sentinel = h('div', { class: 'sentinel' });
    rows.append(sentinel);
    const more = () => {
      const chunk = items.slice(shown, shown + 300);
      shown += chunk.length;
      sentinel.before(...chunk.map((e) => this.row(e)));
      if (shown >= items.length) { this.observer?.disconnect(); sentinel.remove(); }
    };
    this.observer?.disconnect();
    this.observer = new IntersectionObserver((en) => { if (en[0].isIntersecting) more(); }, { root: this.list, rootMargin: '400px' });
    more();
    if (shown < items.length) this.observer.observe(sentinel);
    this.updateStatus();
  }

  row(e) {
    const kind = kindOf(e);
    const el = h('div', { class: `fm-row ${this.selected.has(e.name) ? 'selected' : ''} ${this.isCut(e.name) ? 'cut' : ''}`, draggable: 'true', dataset: { name: e.name } },
      h('span', { class: 'fm-icon', html: fileIcon(kind) }),
      h('span', { class: 'fm-name', title: e.name }, e.name, e.link ? h('span', { class: 'fm-link', title: 'Link' }, ' ↗') : null),
      h('span', { class: 'fm-date' }, e.modified ? new Date(e.modified).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—'),
      h('span', { class: 'fm-type' }, e.dir ? 'Folder' : `${KIND_LABEL[kind]}${extOf(e.name) ? ` (.${extOf(e.name)})` : ''}`),
      h('span', { class: 'fm-size' }, e.dir ? '' : e.size == null ? '—' : formatBytes(e.size)));
    el.addEventListener('click', (ev) => {
      if (ev.detail > 1) return;
      if (matchMedia('(pointer: coarse)').matches && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey) return this.open(e);
      this.clickSelect(e.name, ev);
    });
    el.addEventListener('dblclick', () => this.open(e));
    el.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      if (!this.selected.has(e.name)) this.select([e.name]);
      this.rowMenu(ev, e);
    });
    el.addEventListener('dragstart', (ev) => {
      if (!this.selected.has(e.name)) this.select([e.name]);
      ev.dataTransfer.setData('application/x-mediadesk-files', JSON.stringify({ root: this.root, paths: this.selectedPaths() }));
      ev.dataTransfer.effectAllowed = 'copyMove';
    });
    if (e.dir) this.dropTarget(el, () => ({ root: this.root, path: join(this.path, e.name) }));
    return el;
  }

  // Accept items dragged from this list (move; hold Ctrl to copy).
  dropTarget(el, dest) {
    el.addEventListener('dragover', (ev) => {
      if (!ev.dataTransfer.types.includes('application/x-mediadesk-files')) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = ev.ctrlKey || ev.altKey ? 'copy' : 'move';
      el.classList.add('drop-over');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drop-over'));
    el.addEventListener('drop', (ev) => {
      el.classList.remove('drop-over');
      const raw = ev.dataTransfer.getData('application/x-mediadesk-files');
      if (!raw) return;
      ev.preventDefault();
      ev.stopPropagation();
      const src = JSON.parse(raw);
      const d = dest();
      if (src.paths.includes(d.path) && src.root === d.root) return;
      this.transfer(ev.ctrlKey || ev.altKey ? 'copy' : 'move', src.root, src.paths, d.root, d.path);
    });
  }

  updateStatus() {
    const n = this.entries.length;
    const sel = this.entries.filter((e) => this.selected.has(e.name));
    const bytes = sel.reduce((a, e) => a + (e.size || 0), 0);
    const root = this.roots[this.root];
    clear(this.statusBar,
      h('span', {}, `${n} item${n === 1 ? '' : 's'}`),
      sel.length ? h('span', {}, ` · ${sel.length} selected${bytes ? ` (${formatBytes(bytes)})` : ''}`) : null,
      clipboard.paths.length ? h('span', { class: 'fm-clip' }, ` · ${clipboard.paths.length} item${clipboard.paths.length > 1 ? 's' : ''} ${clipboard.mode === 'move' ? 'cut' : 'copied'}`) : null,
      h('span', { class: 'spacer' }),
      root?.free != null ? h('span', {}, `${formatBytes(root.free)} free`) : null);
    const one = sel.length === 1;
    this.selActions.forEach((btn, i) => { btn.disabled = !sel.length || (i === 2 && !one); });
    this.pasteBtn.disabled = !clipboard.paths.length;
  }

  // ---- Selection ----
  select(names) {
    this.selected = new Set(names);
    this.list.querySelectorAll('.fm-row[data-name]').forEach((r) => r.classList.toggle('selected', this.selected.has(r.dataset.name)));
    this.updateStatus();
  }
  clickSelect(name, ev) {
    const items = this.visible().map((e) => e.name);
    if (ev.shiftKey && this.anchor && items.includes(this.anchor)) {
      const [a, b] = [items.indexOf(this.anchor), items.indexOf(name)].sort((x, y) => x - y);
      return this.select(items.slice(a, b + 1));
    }
    this.anchor = name;
    if (ev.ctrlKey || ev.metaKey) {
      const next = new Set(this.selected);
      next.has(name) ? next.delete(name) : next.add(name);
      return this.select([...next]);
    }
    this.select([name]);
  }
  selectedPaths() { return [...this.selected].map((n) => join(this.path, n)); }
  selectedEntries() { return this.entries.filter((e) => this.selected.has(e.name)); }
  isCut(name) { return clipboard.mode === 'move' && clipboard.root === this.root && clipboard.paths.includes(join(this.path, name)); }

  onKey(e) {
    if (e.target !== this.list) return;
    const mod = e.ctrlKey || e.metaKey;
    const items = this.visible();
    const idx = items.findIndex((x) => x.name === this.anchor);
    const move = (to) => {
      const t = items[Math.max(0, Math.min(items.length - 1, to))];
      if (!t) return;
      this.anchor = t.name;
      this.select([t.name]);
      this.list.querySelector(`.fm-row[data-name="${CSS.escape(t.name)}"]`)?.scrollIntoView({ block: 'nearest' });
    };
    if (e.key === 'ArrowDown') { e.preventDefault(); move(idx + 1); }
    else if (e.key === 'ArrowUp' && !e.altKey) { e.preventDefault(); move(idx - 1); }
    else if (e.key === 'Enter') { const one = this.selectedEntries(); if (one.length === 1) this.open(one[0]); }
    else if (e.key === 'Backspace' || (e.altKey && e.key === 'ArrowUp')) { e.preventDefault(); this.up(); }
    else if (e.key === 'Delete') this.remove();
    else if (e.key === 'F2') this.rename();
    else if (e.key === 'Escape') this.select([]);
    else if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); this.select(items.map((x) => x.name)); }
    else if (mod && e.key.toLowerCase() === 'c') this.toClipboard('copy');
    else if (mod && e.key.toLowerCase() === 'x') this.toClipboard('move');
    else if (mod && e.key.toLowerCase() === 'v') this.paste();
  }

  rowMenu(ev, e) {
    const many = this.selected.size > 1;
    contextMenu(ev.clientX, ev.clientY, [
      { label: e.dir ? 'Open' : 'Open / preview', icon: e.dir ? icon.folder : icon.eye, disabled: many, action: () => this.open(e) },
      !e.dir ? { label: 'Download', icon: icon.download, action: () => this.download() } : null,
      '-',
      { label: 'Cut', icon: ICON_CUT, action: () => this.toClipboard('move') },
      { label: 'Copy', icon: ICON_COPY, action: () => this.toClipboard('copy') },
      e.dir && clipboard.paths.length ? { label: 'Paste into folder', icon: ICON_PASTE, action: () => this.paste(join(this.path, e.name)) } : null,
      { label: 'Rename', icon: ICON_RENAME, disabled: many, action: () => this.rename() },
      '-',
      { label: many ? `Delete ${this.selected.size} items` : 'Delete', icon: icon.trash, action: () => this.remove() },
    ].filter(Boolean));
  }

  // ---- Actions ----
  open(e) {
    if (e.dir) return this.go(this.root, join(this.path, e.name));
    this.preview(e);
  }

  async newFolder() {
    const name = await promptName('New folder', 'Folder name', 'New folder');
    if (!name) return;
    try {
      await call('mkdir', { method: 'POST', body: { root: this.root, path: this.path, name } });
      await this.refresh();
      this.select([name]);
    } catch (err) { toastError(err, 'Could not create folder'); }
  }

  async rename() {
    const [e] = this.selectedEntries();
    if (!e || this.selected.size !== 1) return;
    const name = await promptName('Rename', 'New name', e.name, true);
    if (!name || name === e.name) return;
    try {
      await call('rename', { method: 'POST', body: { root: this.root, path: join(this.path, e.name), name } });
      await this.refresh();
      this.select([name]);
    } catch (err) { toastError(err, 'Could not rename'); }
  }

  async remove() {
    const sel = this.selectedEntries();
    if (!sel.length) return;
    const folders = sel.filter((e) => e.dir).length;
    const what = sel.length === 1 ? `“${sel[0].name}”` : `${sel.length} items`;
    const ok = await confirmDialog({
      title: `Delete ${what}?`, danger: true, confirm: 'Delete permanently',
      message: `This can’t be undone — files are deleted from the server, not moved to a recycle bin.${folders ? ' Folders are deleted with everything inside them.' : ''}`,
    });
    if (!ok) return;
    try {
      await call('delete', { method: 'POST', body: { root: this.root, paths: this.selectedPaths() } });
      toast(`Deleted ${what}`, { icon: appIcon.files });
      this.selected.clear();
      this.refresh();
      this.loadRootsQuiet();
    } catch (err) { toastError(err, 'Could not delete'); this.refresh(); }
  }

  toClipboard(mode) {
    if (!this.selected.size) return;
    Object.assign(clipboard, { mode, root: this.root, paths: this.selectedPaths() });
    toast(`${clipboard.paths.length} item${clipboard.paths.length > 1 ? 's' : ''} ${mode === 'move' ? 'cut' : 'copied'}`, { body: 'Go to another folder and choose Paste.', icon: appIcon.files, timeout: 2500 });
    this.render();
  }

  async paste(destPath = this.path) {
    if (!clipboard.paths.length) return;
    const { mode, root, paths } = clipboard;
    const ok = await this.transfer(mode, root, paths, this.root, destPath);
    if (ok && mode === 'move') Object.assign(clipboard, { mode: null, root: null, paths: [] });
    this.updateStatus();
  }

  async transfer(mode, root, paths, destRoot, destPath) {
    const label = `${mode === 'move' ? 'Moving' : 'Copying'} ${paths.length} item${paths.length > 1 ? 's' : ''}`;
    const busy = h('div', { class: 'fm-busy' }, h('div', { class: 'spinner sm' }), `${label}…`);
    this.uploads.hidden = false;
    this.uploads.append(busy);
    try {
      await call(mode, { method: 'POST', body: { root, paths, destRoot, destPath } });
      toast(`${mode === 'move' ? 'Moved' : 'Copied'} ${paths.length} item${paths.length > 1 ? 's' : ''}`, { icon: appIcon.files, type: 'success', timeout: 3000 });
      return true;
    } catch (err) {
      toastError(err, `${mode === 'move' ? 'Move' : 'Copy'} failed`);
      return false;
    } finally {
      busy.remove();
      if (!this.uploads.children.length) this.uploads.hidden = true;
      this.refresh();
      this.loadRootsQuiet();
    }
  }

  download() {
    const files = this.selectedEntries().filter((e) => !e.dir);
    if (!files.length) return toast('Select one or more files to download (folders can’t be downloaded).', { type: 'error' });
    files.forEach((e, i) => setTimeout(() => {
      const a = h('a', { href: fileUrl(this.root, join(this.path, e.name)), download: e.name });
      document.body.append(a); a.click(); a.remove();
    }, i * 400));
  }

  loadRootsQuiet() {
    call('roots').then((r) => { this.roots = r; this.updateStatus(); }).catch(() => {});
  }

  // ---- Upload ----
  async upload(fileList) {
    if (!fileList.length) return;
    const root = this.root, path = this.path;
    this.uploads.hidden = false;
    for (const file of fileList) {
      await this.uploadOne(file, root, path, false);
    }
    if (!this.uploads.querySelector('.fm-upload')) this.uploads.hidden = true;
    if (root === this.root && path === this.path) this.refresh();
    this.loadRootsQuiet();
  }

  uploadOne(file, root, path, overwrite) {
    return new Promise((resolve) => {
      const bar = progressBar(0);
      const label = h('span', { class: 'small muted' }, `0 of ${formatBytes(file.size)}`);
      const xhr = new XMLHttpRequest();
      const cancel = h('button', { class: 'btn btn-icon btn-sm', title: 'Cancel', html: icon.x, onclick: () => xhr.abort() });
      const item = h('div', { class: 'fm-upload' }, h('span', { class: 'fm-icon', html: fileIcon(kindOf({ name: file.name })) }),
        h('div', { class: 'grow' }, h('div', { class: 'fm-upload-name' }, file.name), bar, label), cancel);
      this.uploads.append(item);
      const done = () => { item.remove(); resolve(); };
      xhr.open('POST', `/portal/files/upload?${new URLSearchParams({ root, path, name: file.name, ...(overwrite ? { overwrite: 1 } : {}) })}`);
      xhr.setRequestHeader('X-MediaDesk', '1');
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        bar.firstChild.style.width = `${(e.loaded / e.total) * 100}%`;
        label.textContent = `${formatBytes(e.loaded)} of ${formatBytes(e.total)}`;
      };
      xhr.onload = async () => {
        if (xhr.status === 409 && !overwrite) {
          item.remove();
          const ok = await confirmDialog({ title: `Replace “${file.name}”?`, message: 'A file with this name already exists in this folder.', confirm: 'Replace', danger: true });
          if (ok) await this.uploadOne(file, root, path, true);
          return resolve();
        }
        if (xhr.status >= 400) {
          let msg = `HTTP ${xhr.status}`;
          try { msg = JSON.parse(xhr.responseText).error || msg; } catch { /* ignore */ }
          toastError(new Error(msg), `Upload failed: ${file.name}`);
        }
        done();
      };
      xhr.onerror = () => { toastError(new Error('Connection lost'), `Upload failed: ${file.name}`); done(); };
      xhr.onabort = () => { toast(`Upload cancelled: ${file.name}`); done(); };
      xhr.send(file);
    });
  }

  // ---- Preview ----
  async preview(e) {
    const kind = kindOf(e);
    const p = join(this.path, e.name);
    const root = this.root;
    this.win.body.querySelector('.sheet')?.remove();
    const close = () => { sheet.classList.add('leaving'); setTimeout(() => sheet.remove(), 200); this.list.focus({ preventScroll: true }); };
    const body = h('div', { class: 'fm-preview-body' });
    const actions = h('div', { class: 'btn-row' },
      h('a', { class: 'btn', href: fileUrl(root, p), download: e.name }, h('span', { html: icon.download }), 'Download'),
      ['image', 'pdf', 'video', 'audio', 'text'].includes(kind) ? h('a', { class: 'btn', href: fileUrl(root, p, true), target: '_blank', rel: 'noopener' }, h('span', { html: icon.external }), 'Open in new tab') : null);
    const sheet = h('div', { class: 'sheet fm-sheet' },
      h('div', { class: 'sheet-inner fm-preview' },
        h('button', { class: 'btn btn-icon sheet-close', title: 'Close', html: icon.x, onclick: close }),
        h('div', { class: 'fm-preview-head' },
          h('span', { class: 'fm-preview-icon', html: fileIcon(kind) }),
          h('div', { class: 'grow' }, h('h2', {}, e.name),
            h('div', { class: 'muted small' }, [formatBytes(e.size || 0), e.modified ? new Date(e.modified).toLocaleString() : null, p].filter(Boolean).join(' · '))),
          actions),
        body));
    sheet.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') close(); });
    this.win.body.append(sheet);

    const ext = extOf(e.name);
    if (kind === 'image' && ext !== 'tbn') {
      body.append(h('div', { class: 'fm-media' }, h('img', { src: fileUrl(root, p, true), alt: e.name })));
    } else if ((kind === 'video' || kind === 'audio') && PLAYABLE[kind].includes(ext)) {
      const media = h(kind, { src: fileUrl(root, p, true), controls: true, preload: 'metadata', class: 'fm-player' });
      media.addEventListener('error', () => body.append(h('p', { class: 'muted small' }, 'Your browser can’t play this format. Download it or open it in Jellyfin instead.')));
      body.append(h('div', { class: 'fm-media' }, media));
    } else if (kind === 'text' || (kind === 'file' && (e.size || 0) < 512 * 1024)) {
      this.textEditor(body, actions, root, p, e, kind === 'text');
    } else {
      body.append(emptyState('No preview available', 'Download the file to open it.'));
    }
  }

  async textEditor(body, actions, root, p, e, expected) {
    body.append(spinner());
    let doc;
    try { doc = await call('text', { params: { root, path: p } }); }
    catch (err) {
      clear(body, expected || err.status !== 415 ? errorState(err) : emptyState('No preview available', 'This is not a text file.'));
      return;
    }
    const area = h('textarea', { class: 'fm-text', spellcheck: 'false' });
    area.value = doc.text;
    const save = h('button', { class: 'btn btn-primary', disabled: true }, h('span', { html: icon.check }), 'Save');
    const saveNow = async () => {
      save.disabled = true;
      try {
        const r = await call('text', { method: 'POST', body: { root, path: p, text: area.value, modified: doc.modified, bom: doc.bom } });
        doc.modified = r.modified;
        doc.text = area.value;
        toast('Saved', { body: e.name, type: 'success', icon: appIcon.files, timeout: 2000 });
        if (root === this.root) this.refresh();
      } catch (err) { save.disabled = false; toastError(err, 'Could not save'); }
    };
    save.onclick = saveNow;
    area.addEventListener('input', () => { save.disabled = area.value === doc.text; });
    area.addEventListener('keydown', (ev) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') { ev.preventDefault(); if (!save.disabled) saveNow(); }
      if (ev.key === 'Tab') { ev.preventDefault(); area.setRangeText('\t', area.selectionStart, area.selectionEnd, 'end'); area.dispatchEvent(new Event('input')); }
    });
    actions.prepend(save);
    clear(body, area);
  }
}

function promptName(title, label, value, selectStem = false) {
  return new Promise((resolve) => {
    const input = h('input', { class: 'input', value, spellcheck: 'false' });
    const done = (v) => { overlay.remove(); resolve(v); };
    const overlay = h('div', { class: 'dialog-overlay', onclick: (ev) => { if (ev.target === overlay) done(null); } },
      h('form', { class: 'dialog', onsubmit: (ev) => { ev.preventDefault(); done(input.value.trim() || null); } },
        h('h3', {}, title),
        h('label', { class: 'field', style: { margin: '14px 0 0' } }, h('span', {}, label), input),
        h('div', { class: 'dialog-actions' },
          h('button', { class: 'btn', type: 'button', onclick: () => done(null) }, 'Cancel'),
          h('button', { class: 'btn btn-primary', type: 'submit' }, 'OK'))));
    overlay.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') done(null); });
    document.body.append(overlay);
    input.focus();
    const dot = value.lastIndexOf('.');
    input.setSelectionRange(0, selectStem && dot > 0 ? dot : value.length);
  });
}
