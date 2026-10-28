// Log Viewer: reads log files the way Microsoft's CMTrace does — a row per entry with its
// component, time and thread, errors in red and warnings in yellow, the full entry underneath,
// and the file followed live as it grows. Opens logs from the shared folders (Settings → Files)
// or from this computer, merges several into one timeline, and has Find, Highlight, Filter
// and an error-code lookup.

import { h, clear, toast, toastError, contextMenu, debounce, formatBytes } from '../ui.js';
import { icon, appIcon } from '../icons.js';
import { pickFile, fileUrl, filesEnabled } from '../fileapi.js';
import { parse, decode, lookupError, fmtTime, ERROR, WARN } from './log-parse.js';

const ROW = 22;
const RECENT_KEY = 'mediadesk.logs.recent';
const COLS_KEY = 'mediadesk.logs.cols';
const readJson = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const writeJson = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } };
const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const I = {
  open: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  merge: svg('<path d="M6 3v6a6 6 0 0 0 6 6h6M15 12l3 3-3 3M6 21v-4"/>'),
  pause: svg('<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>'),
  play: svg('<path d="M7 5v14l11-7z"/>'),
  find: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>'),
  filter: svg('<path d="M3 5h18l-7 8v6l-4-2v-4z"/>'),
  hilite: svg('<path d="m9 11-6 6v3h3l6-6M14 6l4 4M12 8l4 4-6 6-4-4z"/>'),
  lookup: svg('<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>'),
  bottom: svg('<path d="M12 5v14M6 13l6 6 6-6"/>'),
};

export const logViewerApp = {
  id: 'logs', name: 'Log Viewer', icon: appIcon.logs, size: [1180, 720], description: 'Read log files like CMTrace',
  open(win, opts = {}) {
    const v = new LogViewer(win);
    if (opts.root != null && opts.path) v.openShared({ root: Number(opts.root), path: opts.path, name: opts.path.split('/').pop() });
    else v.showWelcome();
    win.on('reopen', (o) => { if (o?.root != null && o.path) v.openShared({ root: Number(o.root), path: o.path, name: o.path.split('/').pop() }); });
    win.on('close', () => v.destroy());
  },
};

class LogViewer {
  constructor(win) {
    this.win = win;
    this.sources = [];
    this.all = [];          // every entry from every open log, in time order when merged
    this.view = [];         // indexes into this.all after the filter
    this.sel = new Set();   // indexes into this.view
    this.cur = -1;
    this.anchor = -1;
    this.paused = false;
    this.follow = true;     // keep the newest line in view while tailing
    this.filter = { text: '', component: '', thread: '', level: 'all', exclude: false };
    this.highlight = '';
    this.find = { text: '', caseSensitive: false };
    this.cols = { component: 160, time: 195, thread: 115, source: 130, ...readJson(COLS_KEY, {}) };

    const tb = (ic, label, onclick, title) => h('button', { class: 'lv-tb', title: title || label, onclick }, h('span', { html: ic }), h('span', { class: 'lv-tb-label' }, label));
    this.pauseBtn = tb(I.pause, 'Pause', () => this.togglePause(), 'Pause / resume following the log (it keeps reading new lines)');
    this.hiInput = h('input', { class: 'input lv-hi', placeholder: 'Highlight…', 'aria-label': 'Highlight text', spellcheck: 'false' });
    this.hiInput.addEventListener('input', debounce(() => { this.highlight = this.hiInput.value; this.draw(); }, 150));
    this.fileLabel = h('span', { class: 'lv-file' });
    this.toolbar = h('div', { class: 'lv-toolbar' },
      tb(I.open, 'Open', (e) => this.openMenu(e), 'Open a log (Ctrl+O)'),
      tb(I.merge, 'Merge', (e) => this.openMenu(e, true), 'Add another log to this view, merged by time'),
      this.pauseBtn,
      h('span', { class: 'lv-sep' }),
      tb(I.find, 'Find', () => this.showFind(), 'Find (Ctrl+F, F3 for next)'),
      tb(I.filter, 'Filter', () => this.toggleFilter(), 'Show only some entries (Ctrl+L)'),
      h('span', { class: 'lv-hi-wrap', html: I.hilite }, this.hiInput),
      tb(I.lookup, 'Error lookup', () => this.errorLookup(), 'Look up a Windows / ConfigMgr error code'),
      h('span', { class: 'lv-sep' }),
      this.fileLabel);

    // Find bar
    this.findInput = h('input', { class: 'input', placeholder: 'Find what', spellcheck: 'false' });
    this.findCase = h('input', { type: 'checkbox' });
    this.findCount = h('span', { class: 'small muted' });
    this.findBar = h('div', { class: 'lv-bar', hidden: true },
      h('span', { html: I.find, class: 'lv-bar-icon' }), this.findInput,
      h('button', { class: 'btn btn-sm', onclick: () => this.findNext(-1) }, 'Previous'),
      h('button', { class: 'btn btn-sm', onclick: () => this.findNext(1) }, 'Next'),
      h('label', { class: 'check small' }, this.findCase, 'Match case'), this.findCount,
      h('button', { class: 'btn btn-icon btn-sm lv-bar-close', html: icon.x, title: 'Close', onclick: () => { this.findBar.hidden = true; this.find.text = ''; this.draw(); } }));
    this.findInput.addEventListener('input', debounce(() => { this.find.text = this.findInput.value; this.find.caseSensitive = this.findCase.checked; this.countFinds(); this.draw(); }, 150));
    this.findCase.addEventListener('change', () => { this.find.caseSensitive = this.findCase.checked; this.countFinds(); this.draw(); });
    this.findInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.findNext(e.shiftKey ? -1 : 1); } if (e.key === 'Escape') { this.findBar.hidden = true; this.find.text = ''; this.draw(); this.body.focus(); } });

    // Filter bar
    this.fText = h('input', { class: 'input', placeholder: 'Log text contains…', spellcheck: 'false' });
    this.fComp = h('select', { class: 'input' });
    this.fThread = h('select', { class: 'input' });
    this.fLevel = h('select', { class: 'input' }, [['all', 'All entries'], ['err', 'Errors only'], ['warn', 'Errors and warnings']].map(([v, l]) => h('option', { value: v }, l)));
    this.fExclude = h('input', { type: 'checkbox' });
    this.filterBar = h('div', { class: 'lv-bar', hidden: true },
      h('span', { html: I.filter, class: 'lv-bar-icon' }), this.fText, this.fComp, this.fThread, this.fLevel,
      h('label', { class: 'check small', title: 'Hide matching entries instead' }, this.fExclude, 'Exclude'),
      h('button', { class: 'btn btn-sm', onclick: () => this.clearFilter() }, 'Clear'),
      h('button', { class: 'btn btn-icon btn-sm lv-bar-close', html: icon.x, title: 'Close', onclick: () => { this.clearFilter(); this.filterBar.hidden = true; } }));
    const applyFilter = () => { this.filter = { text: this.fText.value, component: this.fComp.value, thread: this.fThread.value, level: this.fLevel.value, exclude: this.fExclude.checked }; this.applyFilter(); };
    this.fText.addEventListener('input', debounce(applyFilter, 200));
    for (const el of [this.fComp, this.fThread, this.fLevel, this.fExclude]) el.addEventListener('change', applyFilter);

    // Table
    this.head = h('div', { class: 'lv-head lv-grid' });
    this.sizer = h('div', { class: 'lv-sizer' });
    this.rows = h('div', { class: 'lv-rows' });
    this.body = h('div', { class: 'lv-body', tabindex: '0' }, this.sizer, this.rows);
    this.body.addEventListener('scroll', () => { this.follow = this.body.scrollTop + this.body.clientHeight >= this.body.scrollHeight - ROW * 2; this.draw(); }, { passive: true });
    this.body.addEventListener('keydown', (e) => this.onKey(e));
    this.rows.addEventListener('pointerdown', (e) => {
      const r = e.target.closest('.lv-row');
      if (!r) return;
      this.select(Number(r.dataset.i), e);
      this.body.focus({ preventScroll: true });
    });
    this.rows.addEventListener('contextmenu', (e) => {
      const r = e.target.closest('.lv-row');
      if (!r) return;
      e.preventDefault();
      const i = Number(r.dataset.i);
      if (!this.sel.has(i)) this.select(i, {});
      this.rowMenu(e, this.all[this.view[i]]);
    });
    this.detail = h('div', { class: 'lv-detail' });
    this.status = h('div', { class: 'lv-status' });
    this.split = h('div', { class: 'lv-split', title: 'Drag to resize' });
    this.table = h('div', { class: 'lv-table' }, this.head, this.body);
    this.main = h('div', { class: 'lv-main', style: { '--detail': `${readJson('mediadesk.logs.detail', 150)}px` } }, this.table, this.split, this.detail);
    this.root = h('div', { class: 'lv' }, this.toolbar, this.findBar, this.filterBar, this.main, this.status);
    win.body.append(this.root);
    this.setupSplit();
    this.setupDrop();
    this.applyCols();
    this.drawHead();
    this.onWinKey = (e) => {
      if (!this.root.isConnected || !this.win.el.classList.contains('focused')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); this.showFind(); }
      else if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); this.openShared(); }
      else if (mod && e.key.toLowerCase() === 'l') { e.preventDefault(); this.toggleFilter(); }
      else if (e.key === 'F3') { e.preventDefault(); if (!this.find.text) this.showFind(); else this.findNext(e.shiftKey ? -1 : 1); }
    };
    document.addEventListener('keydown', this.onWinKey);
    this.timer = setInterval(() => this.tail(), 1000);
    new ResizeObserver(() => this.draw()).observe(this.body);
  }

  destroy() {
    clearInterval(this.timer);
    document.removeEventListener('keydown', this.onWinKey);
  }

  // ---- Columns ----

  hasSources() { return this.sources.length > 1; }

  applyCols() {
    const c = this.cols;
    this.root.style.setProperty('--lv-cols', `minmax(200px, 1fr) ${c.component}px ${c.time}px ${c.thread}px${this.hasSources() ? ` ${c.source}px` : ''}`);
  }

  drawHead() {
    const cols = [['text', 'Log Text'], ['component', 'Component'], ['time', 'Date/Time'], ['thread', 'Thread'], ...(this.hasSources() ? [['source', 'Log']] : [])];
    clear(this.head, cols.map(([k, label]) => {
      const cell = h('div', { class: 'lv-hcell' }, label);
      if (k !== 'text') {
        const grip = h('span', { class: 'lv-grip' });
        grip.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          const x0 = e.clientX, w0 = this.cols[k];
          // Columns sit to the right of the text, so dragging a left edge leftwards widens them.
          const move = (ev) => { this.cols[k] = Math.max(50, Math.min(500, w0 - (ev.clientX - x0))); this.applyCols(); };
          const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); writeJson(COLS_KEY, this.cols); };
          addEventListener('pointermove', move); addEventListener('pointerup', up);
        });
        cell.prepend(grip);
      }
      return cell;
    }));
  }

  // ---- Opening ----

  showWelcome() {
    const recent = readJson(RECENT_KEY, []);
    clear(this.rows);
    this.sizer.style.height = '0px';
    this.rows.append(h('div', { class: 'lv-welcome' },
      h('div', { class: 'lv-welcome-icon', html: appIcon.logs }),
      h('h2', {}, 'Open a log file'),
      h('p', { class: 'muted' }, 'Configuration Manager (CMTrace) logs, Windows logs such as CBS.log and setupact.log, and any other text log. Drop files here to open them.'),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn-primary', disabled: !filesEnabled(), onclick: () => this.openShared() }, h('span', { html: I.open }), 'From shared folders'),
        h('button', { class: 'btn', onclick: () => this.openLocal() }, 'From this computer')),
      !filesEnabled() ? h('p', { class: 'small muted' }, 'Share folders in Settings → Files to open logs on the MediaDesk server.') : null,
      recent.length ? h('div', { class: 'lv-recent' }, h('div', { class: 'small muted' }, 'Recent'),
        recent.slice(0, 8).map((r) => h('button', { class: 'lv-recent-item', onclick: () => this.openShared(r) }, h('strong', {}, r.name), h('span', { class: 'small muted' }, r.path)))) : null));
    this.updateStatus();
  }

  openMenu(e, merge = false) {
    const r = e.currentTarget.getBoundingClientRect();
    const recent = readJson(RECENT_KEY, []);
    contextMenu(r.left, r.bottom + 4, [
      { label: 'From shared folders…', icon: I.open, disabled: !filesEnabled(), action: () => this.openShared(null, merge) },
      { label: 'From this computer…', icon: icon.download, action: () => this.openLocal(merge) },
      ...(recent.length ? ['-', ...recent.slice(0, 8).map((x) => ({ label: x.name, icon: icon.clock, action: () => this.openShared(x, merge) }))] : []),
    ]);
  }

  async openShared(pick = null, merge = false) {
    if (!pick) {
      // Start next to the log that's open (or the last one opened).
      const near = this.sources.find((x) => x.kind === 'shared') || readJson(RECENT_KEY, [])[0];
      const start = near ? { root: near.root, path: near.path.split('/').slice(0, -1).join('/') } : undefined;
      pick = await pickFile({ mode: 'open', start, title: merge ? 'Merge a log' : 'Open a log', accept: (e) => e.dir || /\.(log|lo_|txt|out|err|trace|csv)$/i.test(e.name) || !e.name.includes('.') });
      if (!pick) return;
    }
    const src = { kind: 'shared', name: pick.name || pick.path.split('/').pop(), root: pick.root, path: pick.path };
    writeJson(RECENT_KEY, [{ root: src.root, path: src.path, name: src.name }, ...readJson(RECENT_KEY, []).filter((x) => !(x.root === src.root && x.path === src.path))].slice(0, 12));
    await this.load(src, merge);
  }

  async openLocal(merge = false) {
    if (window.showOpenFilePicker) {
      // A file handle lets us keep reading the file as it grows.
      try {
        const handles = await window.showOpenFilePicker({ multiple: true });
        for (const [i, handle] of handles.entries()) await this.load({ kind: 'local', name: handle.name, handle }, merge || i > 0);
      } catch (err) { if (err.name !== 'AbortError') toastError(err); }
      return;
    }
    const input = h('input', { type: 'file', multiple: true, style: { display: 'none' } });
    input.addEventListener('change', async () => {
      for (const [i, file] of [...input.files].entries()) await this.load({ kind: 'local', name: file.name, file }, merge || i > 0);
      input.remove();
    });
    document.body.append(input);
    input.click();
  }

  setupDrop() {
    this.root.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); this.root.classList.add('drop'); } });
    this.root.addEventListener('dragleave', (e) => { if (!this.root.contains(e.relatedTarget)) this.root.classList.remove('drop'); });
    this.root.addEventListener('drop', async (e) => {
      if (![...e.dataTransfer.types].includes('Files')) return;
      e.preventDefault();
      this.root.classList.remove('drop');
      const items = [...e.dataTransfer.items].filter((i) => i.kind === 'file');
      // Holding Shift (or Ctrl) while dropping merges into what's open.
      const merge = e.shiftKey || e.ctrlKey;
      const handles = await Promise.all(items.map((i) => (i.getAsFileSystemHandle ? i.getAsFileSystemHandle().catch(() => null) : null)));
      const files = items.map((i) => i.getAsFile());
      for (let i = 0; i < items.length; i++) {
        const handle = handles[i]?.kind === 'file' ? handles[i] : null;
        await this.load(handle ? { kind: 'local', name: handle.name, handle } : { kind: 'local', name: files[i].name, file: files[i] }, merge || i > 0);
      }
    });
  }

  // Read a source from the start (or from where we got to, when tailing).
  async readBytes(src, from = 0) {
    if (src.kind === 'shared') {
      const res = await fetch(fileUrl(src.root, src.path), { credentials: 'same-origin', headers: from ? { Range: `bytes=${from}-` } : {} });
      if (res.status === 416) return { bytes: new Uint8Array(0), size: from };
      if (!res.ok) { let msg = `HTTP ${res.status}`; try { msg = (await res.json()).error || msg; } catch { /* not JSON */ } throw new Error(msg); }
      const total = Number((res.headers.get('content-range') || '').split('/')[1]) || null;
      const bytes = new Uint8Array(await res.arrayBuffer());
      // The server sent the whole file: it was replaced or shrank (logs roll over).
      if (from && res.status === 200) return { bytes, size: bytes.length, restart: true };
      return { bytes, size: total ?? from + bytes.length };
    }
    const file = src.handle ? await src.handle.getFile() : src.file;
    if (file.size < from) return { bytes: new Uint8Array(await file.arrayBuffer()), size: file.size, restart: true };
    return { bytes: new Uint8Array(await file.slice(from).arrayBuffer()), size: file.size };
  }

  async load(src, merge) {
    if (!merge) this.sources = [];
    this.rows.classList.add('loading');
    try {
      const { bytes, size } = await this.readBytes(src, 0);
      const { encoding } = decode(bytes.subarray(0, 4));
      src.encoding = encoding;
      src.decoder = new TextDecoder(encoding);
      const text = src.decoder.decode(bytes, { stream: true });
      const res = parse(text, { source: src.name });
      Object.assign(src, { offset: size, carry: res.carry, format: res.format, entries: res.entries, id: Math.random().toString(36).slice(2) });
      this.sources.push(src);
      this.rebuild({ toEnd: true });
      this.win.setTitle(`Log Viewer — ${this.sources.map((s) => s.name).join(' + ')}`);
    } catch (err) { toastError(err, `Couldn’t open ${src.name}`); }
    this.rows.classList.remove('loading');
  }

  // Follow every open log: read whatever has been added since last time.
  async tail() {
    if (this.paused || this.tailing || !this.sources.length || document.hidden) return;
    this.tailing = true;
    let added = 0;
    try {
      for (const src of this.sources) {
        if (src.kind === 'local' && !src.handle) continue; // a plain file pick can't be re-read
        let r;
        try { r = await this.readBytes(src, src.offset); } catch { continue; }
        if (r.restart) {
          src.decoder = new TextDecoder(src.encoding);
          const p = parse(src.decoder.decode(r.bytes, { stream: true }), { source: src.name });
          Object.assign(src, { offset: r.size, carry: p.carry, entries: p.entries, format: p.format });
          added += p.entries.length;
          toast(`${src.name} started over (it was replaced or rolled over)`, { icon: appIcon.logs, timeout: 3000 });
          continue;
        }
        if (!r.bytes.length) continue;
        const p = parse(src.decoder.decode(r.bytes, { stream: true }), { format: src.format, source: src.name, carry: src.carry });
        src.offset = r.size;
        src.carry = p.carry;
        src.entries.push(...p.entries);
        added += p.entries.length;
      }
    } finally { this.tailing = false; }
    if (added) this.rebuild({ toEnd: this.follow, keep: true });
  }

  togglePause() {
    this.paused = !this.paused;
    clear(this.pauseBtn, h('span', { html: this.paused ? I.play : I.pause }), h('span', { class: 'lv-tb-label' }, this.paused ? 'Resume' : 'Pause'));
    this.pauseBtn.classList.toggle('on', this.paused);
    this.updateStatus();
    if (!this.paused) this.tail();
  }

  // ---- The list ----

  rebuild({ toEnd = false, keep = false } = {}) {
    const selectedEntries = keep ? new Set([...this.sel].map((i) => this.all[this.view[i]])) : null;
    const curEntry = keep ? this.all[this.view[this.cur]] : null;
    if (this.sources.length === 1) this.all = this.sources[0].entries;
    else {
      // Merge by time (entries without a time keep their place after the one before).
      const tagged = [];
      for (const s of this.sources) { let last = 0; for (const e of s.entries) { last = e.time ?? last; tagged.push([last, tagged.length, e]); } }
      tagged.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      this.all = tagged.map((t) => t[2]);
    }
    this.fillFilterChoices();
    this.applyFilter({ keepSel: selectedEntries, keepCur: curEntry, toEnd });
    this.applyCols();
    this.drawHead();
  }

  fillFilterChoices() {
    const comps = [...new Set(this.all.map((e) => e.component).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const threads = [...new Set(this.all.map((e) => e.thread).filter(Boolean))].sort((a, b) => Number(a) - Number(b));
    const keep = (sel, list, label) => {
      const v = sel.value;
      clear(sel, h('option', { value: '' }, label), list.slice(0, 500).map((x) => h('option', { value: x, selected: x === v }, x)));
    };
    keep(this.fComp, comps, 'Any component');
    keep(this.fThread, threads, 'Any thread');
  }

  matches(e) {
    const f = this.filter;
    if (f.level === 'err' && e.type !== ERROR) return f.exclude;
    if (f.level === 'warn' && e.type < WARN) return f.exclude;
    let hit = true;
    if (f.text) hit = e.text.toLowerCase().includes(f.text.toLowerCase());
    if (hit && f.component) hit = e.component === f.component;
    if (hit && f.thread) hit = e.thread === f.thread;
    const any = f.text || f.component || f.thread;
    return any && f.exclude ? !hit : hit;
  }

  applyFilter({ keepSel = null, keepCur = null, toEnd = false } = {}) {
    const f = this.filter;
    const active = f.text || f.component || f.thread || f.level !== 'all';
    this.view = [];
    for (let i = 0; i < this.all.length; i++) if (!active || this.matches(this.all[i])) this.view.push(i);
    this.sel = new Set();
    this.cur = -1;
    if (keepSel?.size) this.view.forEach((ai, vi) => { if (keepSel.has(this.all[ai])) this.sel.add(vi); });
    if (keepCur) this.cur = this.view.findIndex((ai) => this.all[ai] === keepCur);
    this.toolbar.classList.toggle('filtered', Boolean(active));
    this.sizer.style.height = `${this.view.length * ROW}px`;
    if (toEnd) this.body.scrollTop = this.body.scrollHeight;
    this.countFinds();
    this.draw();
    this.showDetail();
  }

  clearFilter() {
    this.fText.value = ''; this.fComp.value = ''; this.fThread.value = ''; this.fLevel.value = 'all'; this.fExclude.checked = false;
    this.filter = { text: '', component: '', thread: '', level: 'all', exclude: false };
    this.applyFilter();
  }

  toggleFilter() {
    this.filterBar.hidden = !this.filterBar.hidden;
    if (!this.filterBar.hidden) this.fText.focus();
  }

  findHit(e) {
    const q = this.find.text;
    if (!q) return false;
    return this.find.caseSensitive ? e.text.includes(q) || e.component.includes(q) : `${e.text}\n${e.component}`.toLowerCase().includes(q.toLowerCase());
  }

  draw() {
    if (!this.sources.length) return;
    const top = this.body.scrollTop;
    const height = this.body.clientHeight;
    const first = Math.max(0, Math.floor(top / ROW) - 8);
    const last = Math.min(this.view.length, Math.ceil((top + height) / ROW) + 8);
    const hi = this.highlight.trim().toLowerCase();
    const frag = document.createDocumentFragment();
    const merged = this.hasSources();
    for (let i = first; i < last; i++) {
      const e = this.all[this.view[i]];
      const cls = ['lv-row', 'lv-grid'];
      if (e.type === ERROR) cls.push('err'); else if (e.type === WARN) cls.push('warn');
      if (hi && e.text.toLowerCase().includes(hi)) cls.push('hi');
      if (this.find.text && this.findHit(e)) cls.push('found');
      if (this.sel.has(i)) cls.push('sel');
      if (i === this.cur) cls.push('cur');
      const row = h('div', { class: cls.join(' '), dataset: { i }, style: { top: `${i * ROW}px` } },
        h('span', { class: 'lv-text' }, e.text.split('\n', 1)[0]),
        h('span', {}, e.component),
        h('span', {}, e.timeText),
        h('span', {}, e.thread ? (/^\d+$/.test(e.thread) ? `${e.thread} (0x${Number(e.thread).toString(16).toUpperCase()})` : e.thread) : ''),
        merged ? h('span', {}, e.source) : null);
      frag.append(row);
    }
    this.rows.replaceChildren(frag);
    this.updateStatus();
  }

  // ---- Selection ----

  select(i, e = {}) {
    if (i < 0 || i >= this.view.length) return;
    if (e.shiftKey && this.anchor >= 0) {
      this.sel = new Set();
      for (let x = Math.min(this.anchor, i); x <= Math.max(this.anchor, i); x++) this.sel.add(x);
    } else if (e.ctrlKey || e.metaKey) {
      if (this.sel.has(i)) this.sel.delete(i); else this.sel.add(i);
      this.anchor = i;
    } else {
      this.sel = new Set([i]);
      this.anchor = i;
    }
    this.cur = i;
    this.ensureVisible(i);
    this.draw();
    this.showDetail();
  }

  ensureVisible(i) {
    const y = i * ROW;
    if (y < this.body.scrollTop) this.body.scrollTop = y;
    else if (y + ROW > this.body.scrollTop + this.body.clientHeight) this.body.scrollTop = y + ROW - this.body.clientHeight;
  }

  onKey(e) {
    const page = Math.max(1, Math.floor(this.body.clientHeight / ROW) - 1);
    const go = (i) => { e.preventDefault(); this.select(Math.max(0, Math.min(this.view.length - 1, i)), e.shiftKey ? { shiftKey: true } : {}); };
    if (e.key === 'ArrowDown') go(this.cur + 1);
    else if (e.key === 'ArrowUp') go(this.cur - 1);
    else if (e.key === 'PageDown') go(this.cur + page);
    else if (e.key === 'PageUp') go(this.cur - page);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(this.view.length - 1);
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') { e.preventDefault(); this.copy(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); this.sel = new Set(this.view.map((_, i) => i)); this.draw(); this.showDetail(); }
  }

  selected() { return [...this.sel].sort((a, b) => a - b).map((i) => this.all[this.view[i]]); }

  copy(all = false) {
    const list = all ? this.view.map((i) => this.all[i]) : this.selected();
    if (!list.length) return;
    const text = list.map((e) => [e.text, e.component, e.timeText, e.thread].join('\t')).join('\n');
    navigator.clipboard?.writeText(text).then(() => toast(`Copied ${list.length} entr${list.length === 1 ? 'y' : 'ies'}`, { timeout: 1500 })).catch(() => {});
  }

  rowMenu(ev, entry) {
    contextMenu(ev.clientX, ev.clientY, [
      { label: 'Copy', icon: icon.check, shortcut: 'Ctrl+C', action: () => this.copy() },
      { label: `Show only “${entry.component || 'no component'}”`, icon: I.filter, disabled: !entry.component, action: () => { this.fComp.value = entry.component; this.filterBar.hidden = false; this.filter.component = entry.component; this.applyFilter(); } },
      { label: `Show only thread ${entry.thread}`, icon: I.filter, disabled: !entry.thread, action: () => { this.fThread.value = entry.thread; this.filterBar.hidden = false; this.filter.thread = entry.thread; this.applyFilter(); } },
      { label: 'Highlight this component', icon: I.hilite, disabled: !entry.component, action: () => { this.hiInput.value = entry.component; this.highlight = entry.component; this.draw(); } },
      '-',
      { label: 'Look up error codes in this entry', icon: I.lookup, action: () => this.errorLookup(codesIn(entry.text)[0] || '') },
    ]);
  }

  showDetail() {
    const list = this.selected();
    const e = this.all[this.view[this.cur]] || list[0];
    if (!e) { clear(this.detail, h('div', { class: 'small muted lv-detail-empty' }, this.sources.length ? 'Select a line to see all of it here.' : '')); return; }
    const codes = codesIn(e.text).map(lookupError).filter((x) => x?.message);
    clear(this.detail,
      h('div', { class: 'lv-detail-meta' },
        e.timeText ? h('span', {}, h('b', {}, 'Date/Time: '), e.timeText) : null,
        e.component ? h('span', {}, h('b', {}, 'Component: '), e.component) : null,
        e.thread ? h('span', {}, h('b', {}, 'Thread: '), e.thread) : null,
        e.file ? h('span', {}, h('b', {}, 'Source: '), e.file) : null,
        this.hasSources() ? h('span', {}, h('b', {}, 'Log: '), e.source) : null,
        h('span', { class: `lv-level t${e.type}` }, e.type === ERROR ? 'Error' : e.type === WARN ? 'Warning' : 'Information')),
      h('pre', { class: 'lv-detail-text' }, e.text),
      codes.length ? h('div', { class: 'lv-codes' }, codes.map((c) => h('div', {}, h('code', {}, c.hex), ' ', c.message))) : null);
  }

  updateStatus() {
    const list = this.selected();
    let elapsed = '';
    if (list.length > 1) {
      const times = list.map((e) => e.time).filter((t) => t != null);
      if (times.length > 1) {
        let ms = Math.max(...times) - Math.min(...times);
        const hh = Math.floor(ms / 3600e3); ms -= hh * 3600e3;
        const mm = Math.floor(ms / 60e3); ms -= mm * 60e3;
        const ss = Math.floor(ms / 1000); ms -= ss * 1000;
        elapsed = `Elapsed time is ${hh}h ${mm}m ${ss}s ${Math.round(ms)}ms (${list.length} lines selected)`;
      }
    }
    const errs = this.view.reduce((n, i) => n + (this.all[i].type === ERROR), 0);
    const warns = this.view.reduce((n, i) => n + (this.all[i].type === WARN), 0);
    const size = this.sources.reduce((n, s) => n + (s.offset || 0), 0);
    clear(this.status,
      this.sources.length ? [
        h('span', {}, `${this.view.length.toLocaleString()}${this.view.length !== this.all.length ? ` of ${this.all.length.toLocaleString()}` : ''} entries`),
        h('span', { class: 'lv-st-err' }, `${errs.toLocaleString()} errors`),
        h('span', { class: 'lv-st-warn' }, `${warns.toLocaleString()} warnings`),
        elapsed ? h('span', { class: 'lv-st-elapsed' }, elapsed) : null,
        h('span', { class: 'grow' }),
        h('span', {}, this.paused ? 'Paused' : this.sources.some((s) => s.kind === 'shared' || s.handle) ? 'Following' : 'Not following (pick files with a browser that allows it)'),
        h('span', {}, `${this.sources.map((s) => s.format === 'cmtrace' ? 'CMTrace' : s.format === 'sms' ? 'SMS' : 'Text').filter((v, i, a) => a.indexOf(v) === i).join(', ')} · ${this.sources[0]?.encoding?.toUpperCase()} · ${formatBytes(size)}`),
      ] : h('span', {}, 'No log open'));
    this.fileLabel.textContent = this.sources.length ? this.sources.map((s) => s.kind === 'shared' ? s.path : s.name).join(' + ') : '';
  }

  // ---- Find ----

  showFind() {
    this.findBar.hidden = false;
    this.findInput.focus();
    this.findInput.select();
  }

  countFinds() {
    if (!this.find.text) { this.findCount.textContent = ''; return; }
    let n = 0;
    for (const i of this.view) if (this.findHit(this.all[i])) n++;
    this.findCount.textContent = n ? `${n.toLocaleString()} found` : 'Not found';
  }

  findNext(dir) {
    if (!this.find.text) return this.showFind();
    const n = this.view.length;
    for (let k = 1; k <= n; k++) {
      const i = ((this.cur < 0 ? (dir > 0 ? -1 : 0) : this.cur) + dir * k + n * 2) % n;
      if (this.findHit(this.all[this.view[i]])) { this.select(i); this.follow = false; return; }
    }
    toast('Not found', { body: this.find.text, timeout: 1500 });
  }

  // ---- Error lookup ----

  errorLookup(code = '') {
    const input = h('input', { class: 'input', value: code, placeholder: 'e.g. 0x80070005, -2147024891, 1603 or 87D00324', spellcheck: 'false' });
    const out = h('div', { class: 'lv-lookup-out' });
    const run = () => {
      const r = lookupError(input.value);
      clear(out, !input.value.trim() ? null : !r ? h('div', { class: 'muted' }, 'That doesn’t look like an error code.') : [
        h('div', { class: 'lv-lookup-msg' }, r.message || 'Not in the built-in list.'),
        h('dl', { class: 'facts' }, h('dt', {}, 'Hex'), h('dd', {}, r.hex), h('dt', {}, 'Decimal'), h('dd', {}, String(r.decimal)), r.facility ? [h('dt', {}, 'Facility'), h('dd', {}, r.facility)] : null),
      ]);
    };
    input.addEventListener('input', run);
    const close = () => overlay.remove();
    const overlay = h('div', { class: 'dialog-overlay', onclick: (e) => { if (e.target === overlay) close(); } },
      h('div', { class: 'dialog lv-lookup' }, h('h3', {}, 'Error lookup'), input, out,
        h('div', { class: 'dialog-actions' }, h('button', { class: 'btn btn-primary', onclick: close }, 'Close'))));
    overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    document.body.append(overlay);
    input.focus();
    run();
  }

  setupSplit() {
    this.split.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const y0 = e.clientY;
      const h0 = this.detail.getBoundingClientRect().height;
      const move = (ev) => this.main.style.setProperty('--detail', `${Math.max(50, Math.min(this.main.clientHeight - 120, h0 - (ev.clientY - y0)))}px`);
      const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); writeJson('mediadesk.logs.detail', Math.round(this.detail.getBoundingClientRect().height)); };
      addEventListener('pointermove', move); addEventListener('pointerup', up);
    });
  }
}

// Error codes mentioned in a line: 0x8007..., "error 1603", "-2147024891".
function codesIn(text) {
  const out = new Set();
  for (const m of text.matchAll(/0x[0-9a-f]{8}\b|0x[0-9a-f]{1,4}\b|-21474\d{5}\b|(?:error|code|exit code|returned)[\s:=]+(\d{1,5})\b/gi)) out.add(m[1] || m[0]);
  return [...out].filter((c) => c !== '0x0' && c !== '0x00000000' && c !== '0');
}

export { fmtTime };
